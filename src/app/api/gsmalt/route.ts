import { NextRequest, NextResponse } from 'next/server';
import * as sql from 'mssql';
import { getAppPool } from '@/lib/oa-task-push';

// ── 战略目标稽核表（GSMALT）月度查询 ──
// 数据源：OA 链接服务器 FWsv.ecology.dbo
//   uf_GSMALT 主表 + uf_GSMALT_dt1 明细（jh=稽核 0:V 1:X 2:0，jd=节点日期）
// X 项「新节点」：同 KPI + 同责任人 + 同原因分析 在全表中 jd 最大且晚于原节点的记录

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
    const monthRes = await pool.request()
      .input('month', sql.NVarChar, month)
      .query(`
        SELECT c.kpiz AS kpi, d.departmentname AS dept, e.lastname AS owner,
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

    const items: GsmaltItem[] = monthRes.recordset.map((r: Record<string, unknown>) => {
      const jd = normDate(r.jd);
      let newJd: string | null = null;
      if (Number(r.audit) === 1) {
        const maxJd = maxMap.get(keyOf(r.kpiId, r.zrr, r.yyfx)) || '';
        if (maxJd && maxJd > jd) newJd = maxJd;
      }
      return {
        kpi: (r.kpi as string) || null,
        dept: (r.dept as string) || null,
        owner: (r.owner as string) || null,
        // 空值（NULL/''/whitespace）归一为 null = 未稽核，避免 Number('') === 0 被误判为 V
        audit: r.audit === null || r.audit === undefined || String(r.audit).trim() === '' ? null : Number(r.audit),
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
