import { NextRequest, NextResponse } from 'next/server';
import { guardWrite } from '@/lib/api-guard';
import sql from 'mssql';
import { getAppPool } from '@/lib/oa-task-push';

export interface MeetingType {
  id: string;
  name: string;
  defaultDept: string;
  defaultOwner: string;
  sort: number;
}

async function read(): Promise<MeetingType[]> {
  if (!process.env.DATABASE_URL) return [];
  try {
    const pool = await getAppPool();
    const result = await pool.request().query(`
      SELECT id, name, default_dept as defaultDept, default_owner as defaultOwner, sort
      FROM hyzs_meeting_types
      ORDER BY sort
    `);
    return result.recordset as MeetingType[];
  } catch {
    return [];
  }
}

async function write(types: MeetingType[]): Promise<void> {
  if (!process.env.DATABASE_URL) return;
  const pool = await getAppPool();
  const transaction = new sql.Transaction(pool);
  try {
    await transaction.begin();
    await transaction.request().query('DELETE FROM hyzs_meeting_types');
    for (const t of types) {
      await transaction.request()
        .input('id', sql.VarChar(50), t.id)
        .input('name', sql.NVarChar(50), t.name)
        .input('default_dept', sql.NVarChar(100), t.defaultDept)
        .input('default_owner', sql.NVarChar(50), t.defaultOwner)
        .input('sort', sql.Int, t.sort)
        .query(`
          INSERT INTO hyzs_meeting_types (id, name, default_dept, default_owner, sort)
          VALUES (@id, @name, @default_dept, @default_owner, @sort)
        `);
    }
    await transaction.commit();
  } catch {
    await transaction.rollback();
    throw new Error('Failed to save meeting types');
  }
}

// GET /api/meeting-types
export async function GET() {
  const data = await read();
  return NextResponse.json({ success: true, data });
}

// POST /api/meeting-types  { name, defaultDept?, defaultOwner? }
export async function POST(req: NextRequest) {
  try {
    const guard = await guardWrite('admin');
    if (!guard.ok) return guard.response;
    const body = await req.json();
    const { name, defaultDept = '', defaultOwner = '' } = body;
    if (!name?.trim()) return NextResponse.json({ success: false, error: '类别名称不能为空' }, { status: 400 });
    const types = await read();
    if (types.some((t: MeetingType) => t.name === name.trim())) return NextResponse.json({ success: false, error: '该类别已存在' }, { status: 400 });
    const newType: MeetingType = {
      id: `mt_${Date.now()}`,
      name: name.trim(),
      defaultDept: defaultDept.trim(),
      defaultOwner: defaultOwner.trim(),
      sort: types.length + 1,
    };
    types.push(newType);
    await write(types);
    return NextResponse.json({ success: true, data: types });
  } catch (e) {
    return NextResponse.json({ success: false, error: (e as Error).message }, { status: 500 });
  }
}

// PUT /api/meeting-types  { id, name?, defaultDept?, defaultOwner? }
export async function PUT(req: NextRequest) {
  try {
    const guard = await guardWrite('admin');
    if (!guard.ok) return guard.response;
    const { id, ...updates } = await req.json();
    if (!id) return NextResponse.json({ success: false, error: '缺少 id' }, { status: 400 });
    const types = await read();
    const updated = types.map((t: MeetingType) => t.id === id ? { ...t, ...updates } : t);
    await write(updated);
    return NextResponse.json({ success: true, data: updated });
  } catch (e) {
    return NextResponse.json({ success: false, error: (e as Error).message }, { status: 500 });
  }
}

// DELETE /api/meeting-types  { id }
export async function DELETE(req: NextRequest) {
  try {
    const guard = await guardWrite('admin');
    if (!guard.ok) return guard.response;
    const { id } = await req.json();
    const types = await read();
    const filtered = types.filter((t: MeetingType) => t.id !== id);
    await write(filtered);
    return NextResponse.json({ success: true, data: filtered });
  } catch (e) {
    return NextResponse.json({ success: false, error: (e as Error).message }, { status: 500 });
  }
}
