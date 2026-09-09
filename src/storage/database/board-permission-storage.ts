// 看板人员级权限存储：hyzs_board_permissions 表 CRUD
// 优先级：系统管理员 > 人员级配置 > 角色级默认（hyzs_role_permissions 的 canViewXxxBoard）
import * as sql from 'mssql';
import { parseConnectionString } from './sqlserver-storage';

export interface BoardPermissionRecord {
  loginid: string;
  boardKey: string; // weekly / monthly / production
  allowed: boolean;
  updatedAt: string;
  updatedBy?: string | null;
}

const BOARD_KEYS = ['weekly', 'monthly', 'production'] as const;
export type BoardKey = typeof BOARD_KEYS[number];

const PERM_KEY_MAP: Record<BoardKey, string> = {
  weekly: 'canViewWeeklyBoard',
  monthly: 'canViewMonthlyBoard',
  production: 'canViewProductionBoard',
};

let pool: sql.ConnectionPool | null = null;

async function getPool(): Promise<sql.ConnectionPool> {
  if (!pool || !pool.connected) {
    pool = new sql.ConnectionPool(parseConnectionString());
    await pool.connect();
    await ensureTable(pool);
  }
  return pool;
}

async function ensureTable(p: sql.ConnectionPool) {
  await p.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'hyzs_board_permissions')
    CREATE TABLE hyzs_board_permissions(
      loginid NVARCHAR(64) NOT NULL,
      board_key NVARCHAR(20) NOT NULL,
      allowed BIT NOT NULL DEFAULT 1,
      updated_at NVARCHAR(30) NOT NULL,
      updated_by NVARCHAR(64) NULL,
      CONSTRAINT PK_board_permissions PRIMARY KEY (loginid, board_key)
    );`);
}

/** 获取全部人员级看板权限 */
export const getAllBoardPermissions = async (): Promise<BoardPermissionRecord[]> => {
  const p = await getPool();
  const r = await p.request().query(`SELECT * FROM hyzs_board_permissions ORDER BY loginid, board_key`);
  return r.recordset.map(rowToRecord);
};

/** 设置某人某看板的权限（upsert） */
export const setBoardPermission = async (loginid: string, boardKey: BoardKey, allowed: boolean, updatedBy?: string): Promise<void> => {
  const p = await getPool();
  const now = new Date().toISOString();
  await p.request()
    .input('loginid', sql.NVarChar, loginid)
    .input('board_key', sql.NVarChar, boardKey)
    .input('allowed', sql.Bit, allowed ? 1 : 0)
    .input('updated_at', sql.NVarChar, now)
    .input('updated_by', sql.NVarChar, updatedBy || null)
    .query(`
      MERGE hyzs_board_permissions AS t
      USING (SELECT @loginid AS loginid, @board_key AS board_key) AS s
      ON t.loginid = s.loginid AND t.board_key = s.board_key
      WHEN MATCHED THEN
        UPDATE SET allowed = @allowed, updated_at = @updated_at, updated_by = @updated_by
      WHEN NOT MATCHED THEN
        INSERT (loginid, board_key, allowed, updated_at, updated_by)
        VALUES (@loginid, @board_key, @allowed, @updated_at, @updated_by);`);
};

/** 清除某人全部人员级看板权限（恢复角色默认） */
export const clearBoardPermissions = async (loginid: string): Promise<number> => {
  const p = await getPool();
  const r = await p.request().input('loginid', sql.NVarChar, loginid)
    .query(`DELETE FROM hyzs_board_permissions WHERE loginid=@loginid`);
  return r.rowsAffected[0] || 0;
};

/**
 * 判断某人能否看某块看板（综合判断：系统管理员 > 人员级 > 角色级）
 */
export const canViewBoard = async (loginid: string, boardKey: BoardKey): Promise<boolean> => {
  // ① 系统管理员恒可看
  try {
    const { isSystemAdmin } = await import('@/lib/roles');
    if (await isSystemAdmin(loginid)) return true;
  } catch { /* ignore */ }

  const p = await getPool();

  // ② 人员级有配置 → 按配置
  const personal = await p.request()
    .input('loginid', sql.NVarChar, loginid)
    .input('board_key', sql.NVarChar, boardKey)
    .query(`SELECT allowed FROM hyzs_board_permissions WHERE loginid=@loginid AND board_key=@board_key`);
  if (personal.recordset.length > 0) return !!personal.recordset[0].allowed;

  // ③ 无人员级配置 → 角色级默认
  const { resolveRole } = await import('@/lib/roles');
  const role = await resolveRole(loginid);
  const permKey = PERM_KEY_MAP[boardKey];
  const r2 = await p.request()
    .input('role', sql.NVarChar, role)
    .input('pk', sql.NVarChar, permKey)
    .query(`SELECT allowed FROM hyzs_role_permissions WHERE role=@role AND permission_key=@pk`);
  if (r2.recordset.length > 0) return !!r2.recordset[0].allowed;

  // ④ 表里没行 → 降级硬编码
  const { RoleGuard } = await import('@/lib/roles');
  const guard = (RoleGuard as any)[permKey];
  return guard ? guard(role) : false;
};

function rowToRecord(row: any): BoardPermissionRecord {
  return {
    loginid: row.loginid,
    boardKey: row.board_key,
    allowed: !!row.allowed,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by || null,
  };
}
