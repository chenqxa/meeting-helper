import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { getPool } from '@/storage/database/sqlserver-storage';

// 非个人责任人（群体/部门名）排除
const GROUP_OWNERS = new Set([
  '全体', '各部门', '采购', '研发', '销售', '品质', '生产', '计划', '项目部', '总经办',
  '采购部', '研发部', '销售部', '品质部', '生产部', '计划部', '工程部', '财务部',
  '品质部/生产部', '财务与研发', '各部门负责人', '各业务部门', '全体成员',
]);

// 权限：仅 admin/manager
// GET /api/contribution?granularity=week|month|year&offset=0
export async function GET(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ success: false, error: '未登录' }, { status: 401 });
    // 绩效敏感，仅 admin/manager
    const { resolveRole } = await import('@/lib/roles');
    const role = await resolveRole(user.loginid);
    if (role !== 'admin' && role !== 'manager') {
      return NextResponse.json({ success: false, error: '无权限查看绩效看板' }, { status: 403 });
    }

    const url = new URL(request.url);
    const granularity = (url.searchParams.get('granularity') || 'week') as 'week' | 'month' | 'year';
    const offset = parseInt(url.searchParams.get('offset') || '0', 10);

    const pool = await getPool();

    // 1. 任务榜：所有个人责任人的任务，按周期归集
    const r = await pool.request().query(`
      SELECT
        a.owner,
        a.dept,
        a.due_date,
        a.status,
        a.oa_score,
        a.description,
        a.due_date_type
      FROM hyzs_action_items a
      WHERE a.owner IS NOT NULL AND a.owner <> ''
        AND a.due_date IS NOT NULL AND a.due_date <> ''
        AND a.status <> 'cancelled'
        AND a.due_date_type <> 'continuous'
    `);
    const rows = r.recordset;

    // 提出人数：同一人作为 proposer 提出的任务数（独立聚合，避免子查询）
    const proposerR = await pool.request().query(`
      SELECT proposer, COUNT(*) AS cnt FROM hyzs_action_items
      WHERE proposer IS NOT NULL AND proposer <> '' AND status <> 'cancelled'
      GROUP BY proposer
    `);
    const proposerCntMap: Record<string, number> = {};
    for (const p of proposerR.recordset) proposerCntMap[String(p.proposer).trim()] = Number(p.cnt) || 0;

    // 计算周期（ISO周 / 月 / 年）归属
    const periodKeyOf = (dateStr: string): { key: string; label: string; start: string; end: string } => {
      const d = new Date(dateStr.slice(0, 10) + 'T00:00:00');
      if (granularity === 'year') {
        const y = d.getFullYear();
        return { key: String(y), label: `${y}年`, start: `${y}-01-01`, end: `${y}-12-31` };
      }
      if (granularity === 'month') {
        const y = d.getFullYear(), m = d.getMonth();
        const mm = String(m + 1).padStart(2, '0');
        return { key: `${y}-${mm}`, label: `${y}-${mm}`, start: `${y}-${mm}-01`, end: `${y}-${mm}-${new Date(y, m + 1, 0).getDate()}` };
      }
      // ISO 周
      const day = (d.getDay() + 6) % 7;
      const monday = new Date(d); monday.setDate(d.getDate() - day);
      const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
      const fmt = (dt: Date) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
      const isoWeek = isoWeekNumber(monday);
      return { key: `${monday.getFullYear()}-W${String(isoWeek).padStart(2, '0')}`, label: `${monday.getFullYear()}-W${isoWeek}`, start: fmt(monday), end: fmt(sunday) };
    };

    // 汇总：person → period → {recv,done,x,overdue,tbd}
    const agg: Record<string, Record<string, { recv: number; done: number; x: number; overdue: number; tbd: number }>> = {};
    const raw: Record<string, Record<string, Array<{ description: string; due_date: string; status: string; oa_score: number | null }>>> = {};
    const personInfo: Record<string, { dept: string; proposerCnt: number }> = {};
    const today = new Date(); today.setHours(0, 0, 0, 0);

    for (const row of rows) {
      const owner = String(row.owner || '').trim();
      if (!owner || GROUP_OWNERS.has(owner)) continue; // 排除群体/部门责任人
      const pk = periodKeyOf(String(row.due_date));
      if (!agg[owner]) { agg[owner] = {}; personInfo[owner] = { dept: row.dept || '', proposerCnt: proposerCntMap[owner] || 0 }; }
      if (!agg[owner][pk.key]) agg[owner][pk.key] = { recv: 0, done: 0, x: 0, overdue: 0, tbd: 0 };
      const s = agg[owner][pk.key];
      s.recv++;
      const isDone = row.status === 'done' || row.oa_score === 1;
      const isX = row.oa_score === -1 || row.status === 'blocked';
      const isTbd = row.oa_score === 0;
      if (isDone) s.done++;
      if (isX) s.x++;
      if (isTbd) s.tbd++;
      // 超期未完成：due 已过 且 未完成（打X 或 未处理）
      if (new Date(String(row.due_date).slice(0, 10) + 'T00:00:00') < today && !isDone && row.status !== 'cancelled') {
        s.overdue++;
      }
      // 明细
      if (!raw[owner]) raw[owner] = {};
      if (!raw[owner][pk.key]) raw[owner][pk.key] = [];
      raw[owner][pk.key].push({
        description: String(row.description || '').slice(0, 60),
        due_date: String(row.due_date).slice(0, 10),
        status: String(row.status || ''),
        oa_score: row.oa_score === null ? null : Number(row.oa_score),
      });
    }

    // 2. 持续项填报率（SQL 聚合，避免全量拉 progress）
    const contR = await pool.request().query(`
      SELECT a.owner, a.id,
             CASE WHEN EXISTS (SELECT 1 FROM hyzs_continuous_progress p WHERE p.action_id = a.id) THEN 1 ELSE 0 END AS has_fill
      FROM hyzs_action_items a
      WHERE a.due_date_type = 'continuous' AND a.owner IS NOT NULL AND a.owner <> ''
    `);
    const contByPerson: Record<string, { total: number; filled: number }> = {};
    for (const row of contR.recordset) {
      const owner = String(row.owner || '').trim();
      if (!owner || GROUP_OWNERS.has(owner)) continue;
      if (!contByPerson[owner]) contByPerson[owner] = { total: 0, filled: 0 };
      contByPerson[owner].total++;
      if (row.has_fill === 1) contByPerson[owner].filled++;
    }

    return NextResponse.json({ success: true, data: { granularity, offset, agg, raw, personInfo, continuous: contByPerson } });
  } catch (error) {
    console.error('[contribution]', error);
    return NextResponse.json({ success: false, error: '统计失败' }, { status: 500 });
  }
}

function isoWeekNumber(d: Date): number {
  const date = new Date(d); date.setHours(0, 0, 0, 0);
  const day = (date.getDay() + 6) % 7;
  const thursday = new Date(date); thursday.setDate(date.getDate() - day + 3);
  const firstThu = new Date(thursday.getFullYear(), 0, 4);
  const diff = ((firstThu.getDay() + 6) % 7);
  const firstThuAdjusted = new Date(firstThu); firstThuAdjusted.setDate(firstThu.getDate() - diff);
  return Math.floor((thursday.getTime() - firstThuAdjusted.getTime()) / (7 * 86400000)) + 1;
}
