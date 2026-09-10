import { NextRequest, NextResponse } from 'next/server';
import * as sql from 'mssql';
import { getAppPool } from '@/lib/oa-task-push';

// ── 战略目标稽核表（GSMALT）月度查询 ──
// 数据源：OA 链接服务器 FWsv.ecology.dbo
//   uf_GSMALT 主表 + uf_GSMALT 明细（jh=稽核 0:V 1:X 2:0，jd=节点日期）
// X 项「新节点」：同 KPI + 同责任人 + 同原因分析 在全表中 jd 最大且晚于原节点的记录
// 稽核覆盖：若系统内该 gsmalt 项已有 oa_score（人工打了 V/X/0），以系统为准覆盖 OA 的 jh

// OA 链接服务器四段表名
const oaTable = (n: string) =>
  `[${process.env.OA_LINKED_SERVER || 'FWsv'}].[${process.env.OA_DATABASE_NAME || 'ecology'}].[dbo].[${n}]`;

interface GsmaltItem {
  kpi: string | null;
  dept: string | null;
  owner: string | null;
  audit: number | null; // 原始稽核值：0=V 1=X 2=0
  jd: string | null;    // 原节点
  yyfx: string | null;  // 原因分析
  xdjh: string | null;  // 行动计划
  cl: string | null;    // 策略
  hl: string | null;    // 衡量
  newJd: string | null; // X 项新节点（无更晚节点时为 null）
}

// 轻量缓存：同一数据月 60s 内复用，避免翻页/刷新反复打链接服务器
const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { at: number; payload: Record<string, unknown> }>();

// 日期归一：'2026/08/31 ...' → '2026-08-31'（前10位），便于字符串比较
const normDate = (s: unknown) => String(s ?? '').replace(/\//g, '-').trim().slice(0, 10);

// 「同一项」匹配键：KPI + 责任人 + 原因分析（去首尾空白）
const keyOf = (kpiId: unknown, zrr: unknown, yyfx: unknown) =>
  `${String(kpiId ?? '')}|${String(zrr ?? '')}|${String(yyfx ?? '').trim()}`;

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    let month = (searchParams.get('month') || '').trim();
    if (!/^\d{4}-\d{2}$/.test(month)) {
      const ref = new Date();
      ref.setDate(1);
      ref.setMonth(ref.getMonth() - 1); // 默认数据月 = 上月
      month = `${ref.getFullYear()}-${String(ref.getMonth() + 1).padStart(2, '0')}`;
    }

    const hit = cache.get(month);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
      return NextResponse.json({ ...hit.payload, cached: true });
    }

    const pool = await getAppPool();

    // 1) 数据月明细（与业务提供的口径一致：left(jd,7) = 数据月）
    // 额外取 b.id（dt1Id）用于匹配系统内 gsmalt 同步项
    const monthRes = await pool.request()
      .input('month', sql.NVarChar, month)
      .query(`
        SELECT b.id AS dt1Id, c.kpiz AS kpi, d.departmentname AS dept, e.lastname AS owner,
               b.jh AS audit, b.jd AS jd, b.yyfx2 AS yyfx, b.xdjh2 AS xdjh,
               b.cl AS cl, b.hl AS hl, b.clzbkpi AS kpiId, b.zrr AS zrr
        FROM ${oaTable('uf_GSMALT')} a
        LEFT JOIN ${oaTable('uf_GSMALT_dt1')} b ON a.id = b.mainid
        LEFT JOIN ${oaTable('uf_KPI')} c ON b.clzbkpi = c.id
        LEFT JOIN ${oaTable('hrmdepartment')} d ON b.zrbm = d.id
        LEFT JOIN ${oaTable('hrmresource')} e ON b.zrr = e.id
        WHERE b.id IS NOT NULL AND LEFT(b.jd, 7) = @month
      `);

    // 2) 每个「同一项」在全表的最大节点（供 X 项回填新节点）
    const maxRes = await pool.request().query(`
      SELECT b.clzbkpi AS kpiId, b.zrr AS zrr, ISNULL(b.yyfx2, '') AS yyfx, MAX(b.jd) AS maxJd
      FROM ${oaTable('uf_GSMALT')} a
      LEFT JOIN ${oaTable('uf_GSMALT_dt1')} b ON a.id = b.mainid
      WHERE b.id IS NOT NULL
      GROUP BY b.clzbkpi, b.zrr, ISNULL(b.yyfx2, '')
    `);
    const maxMap = new Map<string, string>();
    for (const r of maxRes.recordset) {
      const k = keyOf(r.kpiId, r.zrr, r.yyfx);
      const v = normDate(r.maxJd);
      if (v) maxMap.set(k, v);
    }

    // ── 系统打分覆盖：系统内 gsmalt 项已有 oa_score 时以系统为准 ──
    // key = originalId（OA dt1.id）→ { oa_score }
    // 系统打分 → audit 映射：1(V)→0, -1(X)→1, 0(待定)→2, null→不覆盖（保持OA的jh）
    let sysScoreMap = new Map<string, number | null>();
    // 系统侧"新派发节点"映射：key = OA dt1.id → 系统内 due_date 最晚且 > 原 jd 的新节点
    // OA 后续不回写（只读），重派后产生的新节点全在 hyzs_action_items（source_type='gsmalt'，
    // originalId=同一个 OA dt1.id，可能有 1~N 条重派链），需要并入 newJd 计算。
    let sysNewJdMap = new Map<string, string>();
    try {
      const sysPool = await import('@/storage/database/sqlserver-storage').then(m => m.getPool());
      const sysRes = await sysPool.request().query(`
        SELECT original_id, oa_score, due_date FROM hyzs_action_items
        WHERE source_type = 'gsmalt' AND original_id IS NOT NULL AND due_date IS NOT NULL`);
      for (const row of sysRes.recordset) {
        const oid = String(row.original_id);
        const od = String(row.due_date).slice(0, 10);
        if (!oid || !od) continue;
        // 同一 dt1.id 可能有多行（重派链），取 due_date 最晚
        const cur = sysNewJdMap.get(oid);
        if (!cur || od > cur) sysNewJdMap.set(oid, od);
        sysScoreMap.set(oid, row.oa_score === null ? null : Number(row.oa_score));
      }
    } catch (e) {
      console.warn('[gsmalt] 系统打分覆盖查询失败（跳过覆盖）:', e instanceof Error ? e.message : e);
    }

    const items: GsmaltItem[] = monthRes.recordset.map((r: Record<string, unknown>) => {
      const jd = normDate(r.jd);

      // OA 原始 audit（强制数字）
      let audit: number | null = (r.audit === null || r.audit === undefined || String(r.audit).trim() === '')
        ? null
        : Number(r.audit);

      // 系统打分覆盖：系统已打分则优先
      //   系统 1(V) → audit 0, 系统 -1(X) → audit 1, 系统 0(圈0待定) → audit 2
      const dt1Id = String(r.dt1Id || '');
      const sysScore = sysScoreMap.get(dt1Id);
      if (sysScore !== undefined && sysScore !== null) {
        const nScore = Number(sysScore);
        if (nScore === 1) audit = 0;
        else if (nScore === -1) audit = 1;
        else if (nScore === 0) audit = 2;
      }

      let newJd: string | null = null;
      if (Number(audit) === 1) {
        // 候选 1：OA 主表里同 KPI+责任人+原因分析的最大 jd（历史遗留场景）
        const maxJd = maxMap.get(keyOf(r.kpiId, r.zrr, r.yyfx)) || '';
        // 候选 2：系统侧同一 dt1.id 的最晚 due_date（重派后产生的，OA 不回写）
        const sysJd = sysNewJdMap.get(dt1Id) || '';
        // 取两者中更晚且 > 原 jd 的
        let best: string | null = null;
        if (maxJd && maxJd > jd) best = maxJd;
        if (sysJd && sysJd > jd && (!best || sysJd > best)) best = sysJd;
        newJd = best;
      }
      return {
        dt1Id: dt1Id || null, // OA uf_GSMALT_dt1.id（用于前端关联系统内 source_type='gsmalt' 的行动项）
        kpi: (r.kpi as string) || null,
        dept: (r.dept as string) || null,
        owner: (r.owner as string) || null,
        audit,
        jd: jd || null,
        yyfx: (r.yyfx as string) || null,
        xdjh: (r.xdjh as string) || null,
        cl: (r.cl as string) || null,
        hl: (r.hl as string) || null,
        newJd,
      };
    }).sort((a, b) =>
      (a.owner || '').localeCompare(b.owner || '', 'zh') ||
      (a.kpi || '').localeCompare(b.kpi || '', 'zh')
    );

    const payload: Record<string, unknown> = { success: true, month, items };
    cache.set(month, { at: Date.now(), payload });
    return NextResponse.json(payload);
  } catch (e) {
    console.error('[gsmalt] 查询失败:', e instanceof Error ? e.message : e);
    return NextResponse.json({ success: false, error: '战略稽核数据查询失败' }, { status: 500 });
  }
}
