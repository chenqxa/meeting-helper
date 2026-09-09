// 持续项「自动取数」引擎
// 业务：开启「自动取数」的持续项每周由系统定时自动写入"上一自然周"进展，不再催责任人人工填报。
// 数据源通过「取数源注册表」接入：每条持续项绑定一个 source key（见 action.autoFetchSource），
// 每个源 = 一张报表 SQL，输出"简短文字 + 结构化明细(detail)"，前端看板格点击 detail 穿透展示明细表。
// 数据源通过链接服务器跨库读取（K3: k3sv.AIS... ；OA: FWsv.ecology），无需独立连接串。
import * as sql from 'mssql';
import { parseConnectionString } from '@/storage/database/sqlserver-storage';
import { getAllActionItems } from '@/storage/database/action-storage';
import { upsertContinuousProgress } from '@/storage/database/continuous-progress-storage';
import { AUTO_FETCH_SOURCES } from './auto-fetch-sources-meta';

export interface AutoFetchWindow {
  start: Date;
  end: Date;        // 周期截止（周日 23:59:59）
  startLabel: string; // YYYY-MM-DD（周一）
  endLabel: string;   // YYYY-MM-DD（周日）
}

const fmtYmd = (x: Date) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`;
};

// 给定一个周日，返回它所在自然周（该周日-6 ~ 该周日）
export function resolveWeekEnding(sundayStr: string): AutoFetchWindow | null {
  const d = new Date(sundayStr + 'T12:00:00');
  if (isNaN(d.getTime())) return null;
  const end = new Date(d); end.setHours(23, 59, 59, 999);
  const start = new Date(end); start.setDate(end.getDate() - 6); start.setHours(0, 0, 0, 0);
  return { start, end, startLabel: fmtYmd(start), endLabel: fmtYmd(end) };
}

// 默认数据窗口 = 上一自然周（周一~周日），与周例会看板"数据周"一致
export function resolvePrevNaturalWeek(now: Date = new Date()): AutoFetchWindow {
  const day = (now.getDay() + 6) % 7; // 周一=0
  const thisMonday = new Date(now);
  thisMonday.setHours(0, 0, 0, 0);
  thisMonday.setDate(now.getDate() - day);
  const sunday = new Date(thisMonday);
  sunday.setDate(thisMonday.getDate() - 1); // 上周日
  const win = resolveWeekEnding(fmtYmd(sunday));
  return win!;
}

// 一条自动取数结果（某条持续项本期写入内容）
export interface AutoFetchRecord {
  actionId: string;
  progress: string;      // 简短展示文字（如"呆滞出库 · 本周 1 张单"）
  detail?: any[] | null; // 结构化明细：按单据分组的物料明细，前端点击后渲染表格
}

export interface AutoFetchCandidate {
  id: string;
  description: string;
  owner?: string | null;
  sourceText?: string | null;
}

// 生成四段名：server.db → [server].[db]（链接服务器/库分别加方括号）
function linkedObject(linked: string): string {
  const parts = linked.split('.').filter(Boolean);
  return parts.length >= 2 ? `[${parts[0]}].[${parts.slice(1).join('].[')}]` : `[${linked}]`;
}

// 把 mssql 可能返回的 Date/字符串统一成 YYYY-MM-DD
function ymd(v: unknown): string {
  if (!v) return '';
  if (v instanceof Date && !isNaN(v.getTime())) {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${v.getUTCFullYear()}-${p(v.getUTCMonth() + 1)}-${p(v.getUTCDate())}`;
  }
  return String(v).slice(0, 10);
}
const numOrNull = (v: unknown): number | null => (v == null || v === '' || isNaN(Number(v)) ? null : Number(v));

// ─────────────────────────────────────────────────────────────
// 取数源实现注册表
// ─────────────────────────────────────────────────────────────
type SourceFetcher = (win: AutoFetchWindow, candidates: AutoFetchCandidate[]) => Promise<AutoFetchRecord[]>;

// 1) 呆滞出库：K3 其他出库单（ICStockBill FTranType=29，FUse 含"呆滞"）
async function fetchK3ScrapIssue(win: AutoFetchWindow, candidates: AutoFetchCandidate[]): Promise<AutoFetchRecord[]> {
  if (candidates.length === 0) return [];
  const linked = process.env.AUTO_FETCH_K3_LINKED || 'k3sv.AIS20161019115614';
  const qname = linkedObject(linked);
  const pool = await new sql.ConnectionPool(parseConnectionString()).connect();
  try {
    const r = await pool.request()
      .input('s', sql.NVarChar, win.startLabel)
      .input('e', sql.NVarChar, win.endLabel)
      .query(`
        SELECT h.FBillNo, CONVERT(varchar(10), h.FDate, 120) AS FDate, h.FStatus, h.FUse,
               e.FEntryID, item.FNumber AS ItemNo, item.FName AS ItemName,
               e.Fauxqty AS Qty, e.FUnitID AS UnitId
        FROM ${qname}.dbo.ICStockBill h
        INNER JOIN ${qname}.dbo.ICStockBillEntry e ON h.FInterID = e.FInterID
        LEFT JOIN ${qname}.dbo.t_ICItem item ON e.FItemID = item.FItemID
        WHERE h.FTranType = 29 AND h.FUse LIKE '%呆滞%' AND h.FDate >= @s AND h.FDate <= @e
        ORDER BY h.FDate, h.FBillNo, e.FEntryID
      `);
    const rows: any[] = r.recordset || [];

    const byBill = new Map<string, { bill: string; date: string; status: number; use: string; lines: any[] }>();
    for (const row of rows) {
      if (!byBill.has(row.FBillNo)) {
        byBill.set(row.FBillNo, { bill: row.FBillNo, date: row.FDate, status: row.FStatus, use: row.FUse || '', lines: [] });
      }
      byBill.get(row.FBillNo)!.lines.push(row);
    }
    const bills = [...byBill.values()].sort((a, b) => a.date.localeCompare(b.date));

    const statusLabel = (s: number | null) => (s === 1 ? '已审核' : s === 3 ? '已关闭' : s === 0 ? '未审核' : String(s ?? ''));
    const detail = bills.map(b => ({
      kind: 'scrap',
      bill: b.bill,
      date: b.date,
      status: statusLabel(b.status),
      supplier: '',
      use: b.use || '',
      lines: b.lines.map(ln => ({
        itemNo: ln.ItemNo || '',
        itemName: ln.ItemName || '',
        spec: '',
        qty: numOrNull(ln.Qty),
        unit: ln.UnitId == null ? '' : String(ln.UnitId),
        priceOld: null,
        priceNew: null,
        final: null,
      })),
    }));
    return candidates.map(c => ({ actionId: c.id, progress: `呆滞出库 · 本周 ${bills.length} 张单`, detail }));
  } finally {
    await pool.close();
  }
}

// 2) 采购价格维护：OA 价格审批单（formtable_main_29 + 明细 dt1，已批准/归档 currentnodetype 1/3）
async function fetchOaPriceMaintenance(win: AutoFetchWindow, candidates: AutoFetchCandidate[]): Promise<AutoFetchRecord[]> {
  if (candidates.length === 0) return [];
  const linked = process.env.AUTO_FETCH_OA_LINKED || 'FWsv.ecology';
  const qname = linkedObject(linked);
  const pool = await new sql.ConnectionPool(parseConnectionString()).connect();
  try {
    const r = await pool.request()
      .input('s', sql.NVarChar, win.startLabel)
      .input('e', sql.NVarChar, win.endLabel)
      .query(`
        SELECT f.id, f.djbh, f.gysnm, f.rq, f.sqr, f.bz, w.currentnodetype,
               d.wldm, d.wlmc, d.gg, d.dw, d.yj, d.xj, d.zf
        FROM ${qname}.dbo.formtable_main_29 f
        LEFT JOIN ${qname}.dbo.formtable_main_29_dt1 d ON f.id = d.mainid
        INNER JOIN ${qname}.dbo.workflow_requestbase w ON f.requestid = w.requestid
        WHERE w.currentnodetype IN (1, 3) AND f.rq >= @s AND f.rq <= @e
        ORDER BY f.rq, f.id, d.id
      `);
    const rows: any[] = r.recordset || [];

    const byBill = new Map<string, { bill: string; date: string; status: string; supplier: string; use: string; lines: any[] }>();
    for (const row of rows) {
      if (!byBill.has(row.djbh)) {
        const nt = Number(row.currentnodetype);
        byBill.set(row.djbh, {
          bill: row.djbh || String(row.id || ''),
          date: ymd(row.rq),
          status: nt === 1 ? '已批准' : nt === 3 ? '已归档' : String(row.currentnodetype ?? ''),
          supplier: row.gysnm || '',
          use: row.bz || '',
          lines: [],
        });
      }
      byBill.get(row.djbh)!.lines.push(row);
    }
    const bills = [...byBill.values()].sort((a, b) => a.date.localeCompare(b.date));

    const detail = bills.map(b => ({
      kind: 'price',
      bill: b.bill,
      date: b.date,
      status: b.status,
      supplier: b.supplier,
      use: b.use,
      lines: b.lines.map(ln => ({
        itemNo: String(ln.wldm || '').trim(),
        itemName: String(ln.wlmc || '').trim(),
        spec: String(ln.gg || '').trim(),
        qty: null,
        unit: String(ln.dw || '').trim(), // dw=单位名称（pcs/个/米）；dwnm 才是内码
        priceOld: numOrNull(ln.yj),
        priceNew: numOrNull(ln.xj),
        final: numOrNull(ln.zf),
      })),
    }));
    const totalLines = detail.reduce((s, b) => s + b.lines.length, 0);
    return candidates.map(c => ({ actionId: c.id, progress: `采购价格维护 · 本周 ${detail.length} 单（${totalLines} 条物料）`, detail }));
  } finally {
    await pool.close();
  }
}

// 5) 打样及时率：OA 样品申请单（formtable_main_198），比较收到样品日期 vs 预计交样日期
async function fetchOaSampleTimeliness(win: AutoFetchWindow, candidates: AutoFetchCandidate[]): Promise<AutoFetchRecord[]> {
  if (candidates.length === 0) return [];
  const linked = process.env.AUTO_FETCH_OA_LINKED || 'FWsv.ecology';
  const qname = linkedObject(linked);
  const pool = await new sql.ConnectionPool(parseConnectionString()).connect();
  try {
    const r = await pool.request()
      .input('s', sql.NVarChar, win.startLabel)
      .input('e', sql.NVarChar, win.endLabel)
      .query(`
        SELECT f.djbh, f.sqrq, f.yjjyrq, f.sdyprq
        FROM ${qname}.dbo.formtable_main_198 f
        WHERE LTRIM(RTRIM(ISNULL(f.sdyprq, ''))) >= @s
          AND LTRIM(RTRIM(ISNULL(f.sdyprq, ''))) <= @e
          AND LTRIM(RTRIM(ISNULL(f.yjjyrq, ''))) <> ''
        ORDER BY f.sdyprq
      `);
    const rows: any[] = r.recordset || [];
    const clean = (v: unknown) => String(v || '').trim().slice(0, 10);
    const valid = rows.filter(row => clean(row.sdyprq) && clean(row.yjjyrq));

    const total = valid.length;
    const onTime = valid.filter(row => clean(row.sdyprq) <= clean(row.yjjyrq)).length;
    const rate = total > 0 ? Math.round((onTime / total) * 100) : 0;

    const detail = [{
      kind: 'sample',
      bill: `打样明细`,
      date: `${win.startLabel}~${win.endLabel}`,
      status: '',
      supplier: '',
      use: total > 0 ? `及时 ${onTime}/${total}（${rate}%）` : '本周无收到样品',
      lines: valid.map(row => ({
        djbh: clean(row.djbh) || '—',
        sqrq: clean(row.sqrq),
        yjjyrq: clean(row.yjjyrq),
        sdyprq: clean(row.sdyprq),
        onTime: clean(row.sdyprq) <= clean(row.yjjyrq) ? '✓' : '✗',
      })),
    }];
    const progress = total > 0 ? `打样及时率 · 本周 ${rate}%（${onTime}/${total}）` : '打样及时率 · 本周无收到样品';
    return candidates.map(c => ({ actionId: c.id, progress, detail }));
  } finally {
    await pool.close();
  }
}

// 3) 工价维护：OA 工价审批单（formtable_main_51 + 明细 dt1，已批准/归档）
// 主表一张 = 整机工价审批（车间/整机/工价合计），明细 = 按工序拆分的工价行
async function fetchOaWorkPriceMaintenance(win: AutoFetchWindow, candidates: AutoFetchCandidate[]): Promise<AutoFetchRecord[]> {
  if (candidates.length === 0) return [];
  const linked = process.env.AUTO_FETCH_OA_LINKED || 'FWsv.ecology';
  const qname = linkedObject(linked);
  const pool = await new sql.ConnectionPool(parseConnectionString()).connect();
  try {
    const r = await pool.request()
      .input('s', sql.NVarChar, win.startLabel)
      .input('e', sql.NVarChar, win.endLabel)
      .query(`
        SELECT f.djbh, f.sqrq, f.cj, f.gjje, w.currentnodetype,
               d.wlbm, d.wlmc, d.gx, d.pph, d.pjgs, d.dj, d.rs, d.bz
        FROM ${qname}.dbo.formtable_main_51 f
        LEFT JOIN ${qname}.dbo.formtable_main_51_dt1 d ON f.id = d.mainid
        INNER JOIN ${qname}.dbo.workflow_requestbase w ON f.requestid = w.requestid
        WHERE w.currentnodetype IN (1, 3) AND f.sqrq >= @s AND f.sqrq <= @e
        ORDER BY f.id, d.id
      `);
    const rows: any[] = r.recordset || [];

    const byBill = new Map<string, { bill: string; date: string; status: string; cj: string; gjje: number | null; lines: any[] }>();
    for (const row of rows) {
      if (!byBill.has(row.djbh)) {
        const nt = Number(row.currentnodetype);
        byBill.set(row.djbh, {
          bill: row.djbh || '',
          date: ymd(row.sqrq),
          status: nt === 1 ? '已批准' : nt === 3 ? '已归档' : String(row.currentnodetype ?? ''),
          cj: String(row.cj ?? '').trim(),
          gjje: numOrNull(row.gjje),
          lines: [],
        });
      }
      byBill.get(row.djbh)!.lines.push(row);
    }
    const bills = [...byBill.values()].sort((a, b) => a.date.localeCompare(b.date));

    const detail = bills.map(b => ({
      kind: 'work',
      bill: b.bill,
      date: b.date,
      status: b.status,
      supplier: '',
      use: `车间${b.cj}${b.cj ? '｜' : ''}整机工价合计 ${b.gjje == null ? '' : b.gjje} 元`,
      lines: b.lines.map(ln => ({
        itemNo: String(ln.wlbm || '').trim(),
        itemName: String(ln.wlmc || '').trim(),
        spec: '',
        qty: null,
        unit: '',
        priceOld: null,
        priceNew: null,
        final: null,
        gx: ln.gx == null ? '' : String(ln.gx),
        pph: numOrNull(ln.pph),
        pjgs: numOrNull(ln.pjgs),
        dj: numOrNull(ln.dj),
        rs: numOrNull(ln.rs),
        bz: String(ln.bz || '').trim(),
      })),
    }));
    const totalLines = detail.reduce((s, b) => s + b.lines.length, 0);
    return candidates.map(c => ({ actionId: c.id, progress: `工价维护 · 本周 ${detail.length} 单（${totalLines} 条工价）`, detail }));
  } finally {
    await pool.close();
  }
}

// 4) 新供应商评审：OA 供应商评审（formtable_main_178，主表一家=一次评审，已批准/归档）
async function fetchOaSupplierReview(win: AutoFetchWindow, candidates: AutoFetchCandidate[]): Promise<AutoFetchRecord[]> {
  if (candidates.length === 0) return [];
  const linked = process.env.AUTO_FETCH_OA_LINKED || 'FWsv.ecology';
  const qname = linkedObject(linked);
  const pool = await new sql.ConnectionPool(parseConnectionString()).connect();
  try {
    const r = await pool.request()
      .input('s', sql.NVarChar, win.startLabel)
      .input('e', sql.NVarChar, win.endLabel)
      .query(`
        SELECT f.djbh, f.sqrq, f.gfmc, f.lxr, f.gycpmc, f.gyslb, f.zldf, f.jl, w.currentnodetype
        FROM ${qname}.dbo.formtable_main_178 f
        INNER JOIN ${qname}.dbo.workflow_requestbase w ON f.requestid = w.requestid
        WHERE w.currentnodetype IN (1, 3) AND f.sqrq >= @s AND f.sqrq <= @e
        ORDER BY f.sqrq, f.id
      `);
    const rows: any[] = r.recordset || [];

    // 本周合并成一张汇总表（一家供应商一行），避免 N 张单/单行卡片的碎片感
    const lines = rows.map((row) => ({
      date: ymd(row.sqrq),
      supplier: String(row.gfmc || '').trim(),
      contact: String(row.lxr || '').trim(),
      product: String(row.gycpmc || '').trim(),
      cat: String(row.gyslb ?? '').trim(),
      score: numOrNull(row.zldf),
      verdict: String(row.jl || '').trim(),
    }));
    const detail = [{
      kind: 'supplier',
      bill: `新供应商评审`,
      date: `${win.startLabel}~${win.endLabel}`,
      status: '',
      supplier: '',
      use: '',
      lines,
    }];
    return candidates.map(c => ({ actionId: c.id, progress: `新供应商评审 · 本周 ${lines.length} 家`, detail }));
  } finally {
    await pool.close();
  }
}

// 6) 账期改善：K3 采购发票 + 供应商付款条件，按月统计60天以上占比（三层穿透）
const TERM_MAP: Record<number, { name: string; days60: boolean }> = {
  1002: { name: '票到30天', days60: false },
  1003: { name: '票到60天', days60: true },
  1004: { name: '票到90天', days60: true },
  1005: { name: '票到120天', days60: true },
  1006: { name: '票到付款', days60: false },
  1008: { name: '预付款',   days60: false },
  1032: { name: '月结',     days60: false },
  0:    { name: '未设置',   days60: false },
};

async function fetchK3PaymentTerms(win: AutoFetchWindow, candidates: AutoFetchCandidate[]): Promise<AutoFetchRecord[]> {
  if (candidates.length === 0) return [];
  const linked = process.env.AUTO_FETCH_K3_LINKED || 'k3sv.AIS20161019115614';
  const qname = linkedObject(linked);
  const pool = await new sql.ConnectionPool(parseConnectionString()).connect();
  try {
    // 口径：统计截止"上月末"（9月展示1~8月，10月展示1~9月，依此类推）
    // 根据数据窗口所在月份（win.endLabel 的月份），往前推一个月作为数据截止
    const windowYM = win.endLabel.slice(0, 7);
    const [wy, wm] = windowYM.split('-').map(Number);
    const prevYM = wm === 1 ? `${wy - 1}-12` : `${wy}-${String(wm - 1).padStart(2, '0')}`;
    const [y, m] = prevYM.split('-').map(Number);
    const year = String(y);
    const lastDay = new Date(y, m, 0).getDate(); // 上月最后一天
    const monthStart = year + '-01-01';
    const monthEnd = `${prevYM}-${String(lastDay).padStart(2, '0')}`;

    // 按付款条件分组统计家数+金额
    const r = await pool.request()
      .input('s', sql.NVarChar, monthStart)
      .input('e', sql.NVarChar, monthEnd)
      .query(`
        SELECT s.FCreditDays, COUNT(DISTINCT s.FItemID) AS supCnt, SUM(v.FTotalCostFor) AS totalAmt
        FROM ${qname}.dbo.v_rp_PurchaseInvoice v
        INNER JOIN ${qname}.dbo.t_Supplier s ON s.FItemID = v.FSupplyID
        WHERE v.FDate >= @s AND v.FDate <= @e
        GROUP BY s.FCreditDays
        ORDER BY SUM(v.FTotalCostFor) DESC`);
    const rows: any[] = r.recordset || [];
    if (rows.length === 0) {
      return candidates.map(c => ({ actionId: c.id, progress: `账期改善 · ${year}年暂无发票数据`, detail: [] }));
    }

    let totalSup = 0, total60Sup = 0, totalAmt = 0, total60Amt = 0;
    const termLines: any[] = [];
    for (const row of rows) {
      const cd = Number(row.FCreditDays || 0);
      const term = TERM_MAP[cd] || { name: `未知(${cd})`, days60: false };
      totalSup += row.supCnt;
      totalAmt += Number(row.totalAmt || 0);
      if (term.days60) { total60Sup += row.supCnt; total60Amt += Number(row.totalAmt || 0); }
      termLines.push({
        termName: term.name, supCnt: row.supCnt,
        amt: Math.round(Number(row.totalAmt || 0)),
        days60: term.days60,
      });
    }
    const supRate = totalSup > 0 ? ((total60Sup / totalSup) * 100).toFixed(1) : '0';
    const amtRate = totalAmt > 0 ? ((total60Amt / totalAmt) * 100).toFixed(1) : '0';

    // 每个付款条件下的供应商明细（按金额倒序，取前20家）
    const suppliersByTerm: Record<string, { number: string; name: string; amt: number }[]> = {};
    for (const line of termLines) {
      // 找到该条件的 FCreditDays 值
      const cdEntry = Object.entries(TERM_MAP).find(([, v]) => v.name === line.termName);
      if (!cdEntry) continue;
      const cdVal = cdEntry[0];
      const sup = await pool.request()
        .input('s', sql.NVarChar, monthStart)
        .input('e', sql.NVarChar, monthEnd)
        .input('cd', sql.Int, parseInt(cdVal))
        .query(`
          SELECT TOP 20 s.FNumber, s.FName, SUM(v.FTotalCostFor) AS amt
          FROM ${qname}.dbo.v_rp_PurchaseInvoice v
          INNER JOIN ${qname}.dbo.t_Supplier s ON s.FItemID = v.FSupplyID
          WHERE v.FDate >= @s AND v.FDate <= @e AND s.FCreditDays = @cd
          GROUP BY s.FNumber, s.FName
          ORDER BY SUM(v.FTotalCostFor) DESC`);
      suppliersByTerm[line.termName] = (sup.recordset || []).map((d: any) => ({
        number: String(d.FNumber || ''), name: String(d.FName || '').trim(),
        amt: Math.round(Number(d.amt || 0)),
      }));
    }

    // 月度趋势（按月统计家数和金额占比）
    const trend = await pool.request()
      .input('s', sql.NVarChar, monthStart)
      .input('e', sql.NVarChar, monthEnd)
      .query(`
        SELECT
          CONVERT(varchar(7), v.FDate, 120) AS [month],
          COUNT(DISTINCT s.FItemID) AS supCnt,
          SUM(v.FTotalCostFor) AS totalAmt,
          COUNT(DISTINCT CASE WHEN s.FCreditDays IN (1003, 1004, 1005) THEN s.FItemID END) AS sup60Cnt,
          SUM(CASE WHEN s.FCreditDays IN (1003, 1004, 1005) THEN v.FTotalCostFor ELSE 0 END) AS amt60
        FROM ${qname}.dbo.v_rp_PurchaseInvoice v
        INNER JOIN ${qname}.dbo.t_Supplier s ON s.FItemID = v.FSupplyID
        WHERE v.FDate >= @s AND v.FDate <= @e
        GROUP BY CONVERT(varchar(7), v.FDate, 120)
        ORDER BY [month]`);
    const monthlyTrend = (trend.recordset || []).map((t: any) => {
      const ts = Number(t.supCnt || 0), ts60 = Number(t.sup60Cnt || 0);
      const ta = Number(t.totalAmt || 0), ta60 = Number(t.amt60 || 0);
      return {
        month: String(t.month || ''),
        supCnt: ts, sup60: ts60,
        supRate: ts > 0 ? Number(((ts60 / ts) * 100).toFixed(1)) : 0,
        totalAmt: Math.round(ta), amt60: Math.round(ta60),
        amtRate: ta > 0 ? Number(((ta60 / ta) * 100).toFixed(1)) : 0,
      };
    });

    const detail = [{
      kind: 'payment-terms',
      bill: `付款条件分布`,
      date: `${year}年1~${m}月`,
      status: '',
      supplier: '',
      use: `60天以上 家数${supRate}% / 金额${amtRate}%（目标65%/75%）`,
      lines: termLines,
      suppliers: suppliersByTerm,
      summary: { totalSup, total60Sup, supRate, totalAmt, total60Amt, amtRate },
      monthlyTrend,
    }];

    const progress = `账期改善 · ${year}年1~${m}月 60天以上${supRate}%（目标65%）`;
    return candidates.map(c => ({ actionId: c.id, progress, detail }));
  } finally {
    await pool.close();
  }
}

const SOURCE_IMPLS: Record<string, SourceFetcher> = {
  'k3-scrap-issue': fetchK3ScrapIssue,
  'oa-price-maintenance': fetchOaPriceMaintenance,
  'oa-work-price-maintenance': fetchOaWorkPriceMaintenance,
  'oa-supplier-review': fetchOaSupplierReview,
  'oa-sample-timeliness': fetchOaSampleTimeliness,
  'k3-payment-terms': fetchK3PaymentTerms,
};

export function isValidSourceKey(key?: string | null): boolean {
  return !!key && AUTO_FETCH_SOURCES.some(s => s.key === key);
}

// ─────────────────────────────────────────────────────────────
// 执行一轮自动取数
// opts.endDate：指定数据周日（补某周）；缺省 = 上一自然周。dryRun：不写库，仅返回内容用于验证。
// ─────────────────────────────────────────────────────────────
export interface AutoFetchResult {
  window: AutoFetchWindow;
  candidates: number;
  written: number;
  dryRun: boolean;
  previews: { actionId: string; progress: string; detail: any[] | null }[]; // dryRun 时携带拟写入内容；正式跑时为空
  missing: string[];
}

export async function runAutoFetch(
  _now: Date = new Date(),
  opts: { endDate?: string; dryRun?: boolean } = {},
): Promise<AutoFetchResult> {
  const win = opts.endDate ? resolveWeekEnding(opts.endDate) : resolvePrevNaturalWeek(_now);
  if (!win) throw new Error('无效的 endDate（需为周日 YYYY-MM-DD）');

  const all = await getAllActionItems();
  const candidates = all.filter(i =>
    i.dueDateType === 'continuous' &&
    !!i.autoFetch &&
    isValidSourceKey(i.autoFetchSource) &&
    i.status !== 'cancelled' &&
    i.status !== 'done'
  );

  const base: AutoFetchResult = { window: win, candidates: candidates.length, written: 0, dryRun: !!opts.dryRun, previews: [], missing: candidates.map(c => c.id) };
  if (candidates.length === 0) {
    console.log(`[auto-fetch] 无可执行的自动取数持续项（${win.startLabel} ~ ${win.endLabel}）`);
    return base;
  }

  const bySource = new Map<string, AutoFetchCandidate[]>();
  for (const c of candidates) {
    const k = c.autoFetchSource!;
    if (!bySource.has(k)) bySource.set(k, []);
    bySource.get(k)!.push(c);
  }

  const previews: AutoFetchResult['previews'] = [];
  let written = 0;
  const missing: string[] = [];

  for (const [key, group] of bySource) {
    const impl = SOURCE_IMPLS[key];
    if (!impl) {
      console.warn(`[auto-fetch] 取数源实现缺失：${key}`);
      group.forEach(c => missing.push(c.id));
      continue;
    }
    let records: AutoFetchRecord[] = [];
    try {
      records = await impl(win, group);
    } catch (e) {
      console.error(`[auto-fetch] 取数源执行失败 ${key}:`, e instanceof Error ? e.message : e);
    }
    const byAction = new Map<string, AutoFetchRecord>();
    for (const rec of records) if (rec?.actionId && rec.progress) byAction.set(rec.actionId, rec);

    for (const c of group) {
      const rec = byAction.get(c.id);
      if (!rec) { missing.push(c.id); continue; }
      if (opts.dryRun) {
        previews.push({ actionId: c.id, progress: rec.progress, detail: rec.detail ?? null });
        continue;
      }
      try {
        const cycleDate = win.endLabel;
        await upsertContinuousProgress({
          actionId: c.id,
          cycleDate,
          oaTaskId: `AUTO_${c.id}_${cycleDate}`,
          progress: rec.progress,
          oaStatus: 1,
          source: '自动取数',
          dataMonth: null,
          isNone: false,
          detail: rec.detail ?? null,
        });
        written++;
      } catch (e) {
        console.error(`[auto-fetch] 写入失败 actionId=${c.id}:`, e instanceof Error ? e.message : e);
        missing.push(c.id);
      }
    }
  }

  console.log(`[auto-fetch] ${opts.dryRun ? '【dryRun】' : ''}${win.startLabel} ~ ${win.endLabel}：候选 ${candidates.length}，写入 ${written}，缺失 ${missing.length}`);
  return { window: win, candidates: candidates.length, written, dryRun: !!opts.dryRun, previews, missing };
}
