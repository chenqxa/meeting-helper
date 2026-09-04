import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { resolveRole, UserRole, clearRoleCache } from '@/lib/roles';
import sql from 'mssql';
import { getAppPool } from '@/lib/oa-task-push';

async function readConfig() {
  if (!process.env.DATABASE_URL) return { admins: [], roles: {} };
  try {
    const pool = await getAppPool();
    const result = await pool.request().query('SELECT loginid, role FROM hyzs_user_roles');
    const admins: string[] = [];
    const roles: Record<string, UserRole> = {};
    for (const row of result.recordset) {
      if (row.role === 'admin') {
        admins.push(row.loginid);
      } else {
        roles[row.loginid] = row.role;
      }
    }
    return { admins, roles };
  } catch {
    return { admins: [], roles: {} };
  }
}

async function writeConfig(config: { admins: string[]; roles: Record<string, UserRole> }) {
  if (!process.env.DATABASE_URL) return;
  const pool = await getAppPool();
  const transaction = new sql.Transaction(pool);
  try {
    await transaction.begin();
    await transaction.request().query('DELETE FROM hyzs_user_roles');
    for (const loginid of config.admins) {
      await transaction.request()
        .input('loginid', sql.VarChar(50), loginid)
        .input('role', sql.VarChar(20), 'admin')
        .query('INSERT INTO hyzs_user_roles (loginid, role) VALUES (@loginid, @role)');
    }
    for (const [loginid, role] of Object.entries(config.roles)) {
      await transaction.request()
        .input('loginid', sql.VarChar(50), loginid)
        .input('role', sql.VarChar(20), role)
        .query('INSERT INTO hyzs_user_roles (loginid, role) VALUES (@loginid, @role)');
    }
    await transaction.commit();
  } catch {
    await transaction.rollback();
    throw new Error('Failed to save roles');
  }
}

/** GET /api/roles — 返回当前角色配置（仅 admin） */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: '未登录' }, { status: 401 });
  if ((await resolveRole(user.loginid)) !== 'admin') {
    return NextResponse.json({ success: false, error: '无权限' }, { status: 403 });
  }
  const config = await readConfig();
  return NextResponse.json({ success: true, data: config });
}

/** POST /api/roles — 更新角色配置（仅 admin） */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: '未登录' }, { status: 401 });
  if ((await resolveRole(user.loginid)) !== 'admin') {
    return NextResponse.json({ success: false, error: '无权限' }, { status: 403 });
  }

  const body = await req.json();
  const { action, loginid, role } = body as { action: string; loginid: string; role?: UserRole };

  if (!loginid?.trim()) {
    return NextResponse.json({ success: false, error: '请提供 loginid' }, { status: 400 });
  }

  const config = await readConfig();

  if (action === 'set') {
    if (role === 'admin') {
      if (!config.admins.includes(loginid)) config.admins.push(loginid);
      delete config.roles[loginid];
    } else if (role === 'employee') {
      config.admins = config.admins.filter((id: string) => id !== loginid);
      delete config.roles[loginid];
    } else if (role) {
      config.admins = config.admins.filter((id: string) => id !== loginid);
      config.roles[loginid] = role;
    }
  } else if (action === 'remove') {
    config.admins = config.admins.filter((id: string) => id !== loginid);
    delete config.roles[loginid];
  }

  await writeConfig(config);
  clearRoleCache(); // 角色变更立即生效（清 10 分钟缓存）
  return NextResponse.json({ success: true });
}
