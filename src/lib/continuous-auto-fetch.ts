// 持续项「自动取数」引擎
// 业务：开启「自动取数」的持续项每周由系统定时自动写入"上一自然周"进展，不再催责任人人工填报。
// 数据源通过「取数源注册表」接入：每条持续项绑定一个 source key（见 action.autoFetchSource），
// 每个源 = 一张报表 SQL，输出"简短文字 + 结构化明细(detail)"，前端看板格点击 detail 穿透展示明细表。
// 数据源通过链接服务器跨库读取（K3: k3sv.AIS... ；OA: FWsv.ecology），无需独立连接串。
import * as sql from 'mssql';
import { parseConnectionString } from '@/storage/database/sqlserver-storage';
import { getAllActionItems } from '@/storage/database/action-storage';
import { getMeetings } from '@/storage';
import { upsertContinuousProgress } from '@/storage/database/continuous-progress-storage';
import { AUTO_FETCH_SOURCES } from './auto-fetch-sources-meta';
import { listCustomSources, type AutoFetchSourceRecord } from '@/storage/database/auto-fetch-source-storage';

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
  cycleDate?: string;        // 周期归属日：周例会源默认=周窗口末日（周日）；月度源传产销会周期末（15号），同周期重跑覆盖同一条
  dataMonth?: string | null; // 数据归属月（YYYY-MM）：周例会源 null；产销会/月度源=周期起始月，看板按 data_month 统计"本周期已填报"
}

export interface AutoFetchCandidate {
  id: string;
  description: string;
  owner?: string | null;
  sourceText?: string | null;
  meetingType?: string | null; // 来源会议类型（周例会/公司月会/产销会…）：月度源据此决定按周还是按月落窗
  params?: Record<string, unknown> | null; // 绑定参数（如 {dept:'精益'}）：同一源按参数区分多条项
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

    // 供应商变更申请单（OA formtable_main_181）：变更后付款条件 bgfktj 到 60天以上 且已批准/归档
    // 权威口径来自 OA：本周是否有"变更到60天以上"的申请（取代早期按名单快照对比的做法）
    const oa = linkedObject(process.env.AUTO_FETCH_OA_LINKED || 'FWsv.ecology');
    const changeStart = process.env.AUTO_FETCH_TERMS_CHANGE_START || '2025-01-01';
    const chg = await pool.request()
      .input('cs', sql.NVarChar, changeStart)
      .query(`
        SELECT f.djbh, f.gysdm, f.gysmc, f.fktj, f.bgfktj,
               CONVERT(varchar(10), w.createdate, 120) AS d
        FROM ${oa}.dbo.formtable_main_181 f
        JOIN ${oa}.dbo.workflow_requestbase w ON w.requestid = f.requestId
        WHERE f.bgfktj IN (N'票到60天', N'票到90天', N'票到120天')
          AND w.currentnodetype IN ('1', '3')
          AND CONVERT(varchar(10), w.createdate, 120) >= @cs
        ORDER BY w.createdate DESC`);
    const allChanges: any[] = (chg.recordset || []).map((x: any) => ({
      djbh: String(x.djbh || ''), gysdm: String(x.gysdm || ''), gysmc: String(x.gysmc || '').trim(),
      from: String(x.fktj || '').trim(), to: String(x.bgfktj || '').trim(), date: String(x.d || '').slice(0, 10),
    }));

    const mLabel2 = (s: string) => `${parseInt(s.slice(5, 7), 10)}/${parseInt(s.slice(8, 10), 10)}`;
    const curCycle = win.endLabel;
    const base = `账期改善 · ${year}年1~${m}月 60天以上${supRate}%（目标65%）`;
    const detailBase = {
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
    };

    return candidates.map(c => {
      const isWeekly = /周会|周例会/.test(c.meetingType || '');
      const w = isWeekly ? win : resolvePrevMonth(win);
      const weekChanges = allChanges.filter(x => x.date >= w.startLabel && x.date <= w.endLabel);
      const label = isWeekly ? `${mLabel2(win.startLabel)}~${mLabel2(win.endLabel)}` : resolvePrevMonth(win).label;

      // 逐月变更家数趋势（含本期高亮）
      const byMonth = new Map<string, number>();
      for (const x of allChanges) {
        const ym = x.date.slice(0, 7);
        byMonth.set(ym, (byMonth.get(ym) || 0) + 1);
      }
      const curYm = w.endLabel.slice(0, 7);
      const changeTrend = [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0]))
        .map(([ym, cnt]) => ({ ym, cnt, current: ym === curYm ? '◀ 本期' : '' }));

      const progress = `${base}，${isWeekly ? '本周' : '本月'}变更至60天以上${weekChanges.length}家`;
      const detail = [{
        ...detailBase,
        changePeriod: label,
        changesWeek: weekChanges,
        changesTrend: changeTrend,
      }];
      return { actionId: c.id, progress, detail, cycleDate: curCycle };
    });
  } finally {
    await pool.close();
  }
}

// 7) 验货订单提前2天入库（产销会·月度源）：OA 验货申请单(formtable_main_25) vs K3 cp其他入库单
// 窗口 = 产销会周期（上月16 ~ 本月15，与产销会看板 prodCycleRange 口径一致），按申请日期(sqrq)落窗
// 匹配：ddh2=销售订单分录编码 → SEOrderEntry 取物料 → [申请日前5天,验货日后30天]内同物料 cp 入库单(FTranType=2)，
// 每张验货单取离验货日最近的一张；dy = 入库日 - 验货日（正=验货早于入库N天，0=同天，负=入库早于验货）
function resolveProdCycle(win: AutoFetchWindow): { startLabel: string; endLabel: string; dataMonth: string } {
  const [y, m] = win.endLabel.split('-').map(Number);
  const pm = m === 1 ? 12 : m - 1;
  const py = m === 1 ? y - 1 : y;
  const p2 = (n: number) => String(n).padStart(2, '0');
  return { startLabel: `${py}-${p2(pm)}-16`, endLabel: `${y}-${p2(m)}-15`, dataMonth: `${py}-${p2(pm)}` };
}

async function fetchInspectionInbound(win: AutoFetchWindow, candidates: AutoFetchCandidate[]): Promise<AutoFetchRecord[]> {
  if (candidates.length === 0) return [];
  const cycle = resolveProdCycle(win);
  const oa = linkedObject(process.env.AUTO_FETCH_OA_LINKED || 'FWsv.ecology');
  const k3 = linkedObject(process.env.AUTO_FETCH_K3_LINKED || 'k3sv.AIS20161019115614');
  const pool = await new sql.ConnectionPool(parseConnectionString()).connect();
  try {
    const r = await pool.request()
      .input('s', sql.NVarChar, cycle.startLabel)
      .input('e', sql.NVarChar, cycle.endLabel)
      .query(`
        SELECT f.id, f.sqdh,
               CONVERT(varchar(10), f.sqrq, 120) AS sqrq,
               CONVERT(varchar(10), f.yhrq, 120) AS yhrq,
               CONVERT(varchar(300), f.ddh2) AS ddh2
        INTO #src
        FROM ${oa}.dbo.formtable_main_25 f
        WHERE f.ddh2 IS NOT NULL AND CONVERT(varchar(300), f.ddh2) <> ''
          AND f.sqrq >= @s AND f.sqrq < DATEADD(day, 1, @e);

        SELECT s.id, s.sqdh, s.sqrq, s.yhrq,
               CONVERT(int, LTRIM(RTRIM(SUBSTRING(',' + s.ddh2 + ',', n + 1,
                     CHARINDEX(',', ',' + s.ddh2 + ',', n + 1) - n - 1)))) AS raw_id
        INTO #oa
        FROM #src s
        JOIN (SELECT (a.number*256 + b.number) AS n
              FROM master..spt_values a, master..spt_values b
              WHERE a.type='P' AND b.type='P' AND a.number<40 AND b.number<256) num
          ON n < LEN(',' + s.ddh2 + ',')
         AND SUBSTRING(',' + s.ddh2 + ',', n, 1) = ',';

        SELECT a.id, a.sqdh, a.sqrq, a.yhrq, o.FBillNo AS so_no, e.FItemID
        INTO #oe
        FROM #oa a
        JOIN ${k3}.dbo.SEOrder     o ON o.FInterID = a.raw_id / 10
        JOIN ${k3}.dbo.SEOrderEntry e ON e.FInterID = a.raw_id / 10
                                      AND e.FEntryID = a.raw_id % 10;

        SELECT x.id, x.sqdh, x.sqrq, x.yhrq, x.so_no,
               h.FBillNo AS rk_no,
               CONVERT(varchar(10), h.FDate, 120) AS rk_date,
               DATEDIFF(day, x.yhrq, h.FDate) AS dy
        INTO #q
        FROM #oe x
        JOIN ${k3}.dbo.ICStockBillEntry e ON e.FItemID = x.FItemID
        JOIN ${k3}.dbo.ICStockBill h     ON h.FInterID = e.FInterID
        WHERE h.FTranType = 2
          AND h.FDate >= DATEADD(day, -5,  x.sqrq)
          AND h.FDate <= DATEADD(day, 30, x.yhrq);

        SELECT r.* INTO #best
        FROM (
          SELECT r.id, r.sqdh, r.sqrq, r.yhrq, r.so_no, r.rk_no, r.rk_date, r.dy,
                 ROW_NUMBER() OVER (PARTITION BY r.id ORDER BY ABS(r.dy), r.dy DESC) AS rn
          FROM #q r
          WHERE ABS(r.dy) <= 30
        ) r WHERE rn = 1;

        -- 全部验货申请单 LEFT JOIN 匹配结果（未匹配的 dy 为 NULL）→ 文案可标注"总需求 N、匹配 M、未匹配 K"
        SELECT s.id, s.sqdh, s.sqrq, s.yhrq,
               b.so_no, b.rk_no, b.rk_date, b.dy
        FROM #src s
        LEFT JOIN #best b ON b.id = s.id
        ORDER BY s.sqrq, s.id;

        DROP TABLE #src; DROP TABLE #oa; DROP TABLE #oe; DROP TABLE #q; DROP TABLE #best;
      `);
    // rows = 窗口内全部验货申请单（未匹配 cp 入库单的 dy 为 null）
    const rows: any[] = r.recordset || [];
    const isMatched = (x: any) => x.dy !== null && x.dy !== undefined;
    const best = rows.filter(isMatched);              // 已匹配 cp 入库单的验货单
    const requested = rows.length;                    // 窗口内验货申请单总数
    const total = best.length;                        // 匹配数
    const unmatched = requested - total;
    const dyOf = (b: any) => Number(b.dy);
    const cnt = (fn: (dy: number) => boolean) => best.filter(b => fn(dyOf(b))).length;
    const avg = total > 0 ? best.reduce((s, b) => s + dyOf(b), 0) / total : null;
    const c1 = cnt(d => d === 1), c2 = cnt(d => d === 2), c3 = cnt(d => d === 3);
    const early13 = cnt(d => d >= 1 && d <= 3);
    const same = cnt(d => d === 0);
    const within3 = cnt(d => d >= -3 && d <= 3);
    const neg = cnt(d => d < 0);
    const late = cnt(d => d > 3);
    const pct = total > 0 ? Math.round((early13 / total) * 100) : 0;
    const mLabel = (s: string) => `${parseInt(s.slice(5, 7), 10)}/${parseInt(s.slice(8, 10), 10)}`;
    const head = `验货订单提前2天入库 · ${mLabel(cycle.startLabel)}~${mLabel(cycle.endLabel)}`;
    const progress = requested > 0
      ? `${head} 验货${requested}单`
        + (total > 0 ? `，匹配${total}单，平均提前${avg!.toFixed(1)}天，早1-3天${early13}单（${pct}%）` : '')
        + (unmatched > 0 ? `（未匹配${unmatched}单）` : '')
      : `${head} 无验货申请单`;

    const detail = [{
      kind: 'inspection',
      bill: '验货 vs cp入库明细',
      date: `${cycle.startLabel} ~ ${cycle.endLabel}`,
      status: '',
      supplier: '',
      use: `验货${requested}单 · 匹配${total}（未匹配${unmatched}） · 早1天${c1}/早2天${c2}/早3天${c3} · 同天${same} · 正负3天内${within3} · 入库早于验货${neg} · 晚3天以上${late}`,
      lines: rows.map(b => {
        const matchedRow = isMatched(b);
        const dy = matchedRow ? dyOf(b) : null;
        return {
          sqdh: String(b.sqdh || ''),
          sqrq: ymd(b.sqrq),
          yhrq: ymd(b.yhrq),
          soNo: String(b.so_no || ''),
          rkNo: String(b.rk_no || ''),
          rkDate: ymd(b.rk_date),
          dy,
          dyText: !matchedRow ? '未匹配' : dy! > 0 ? `验货早${dy}天` : dy === 0 ? '同天' : `入库早${Math.abs(dy!)}天`,
        };
      }),
    }];
    return candidates.map(c => ({ actionId: c.id, progress, detail, cycleDate: cycle.endLabel, dataMonth: cycle.dataMonth }));
  } finally {
    await pool.close();
  }
}

// 8) 账随物动（公司月会/公司月会来源·月度源）：K3 检验汇报单(ICMORpt，合格) → cp其他入库单(源单=汇报单 FSourceTranType=551)
// 指标：cp 入库相对汇报的时差 dy（天），"小于2天"= dy∈[0,2)（当日/次日入库）的占比与平均天数
// 窗口按会议类型：周例会/周会 → 上一自然周；其余（公司月会等）→ 上一自然月（data_month=该月）
const LEDGER_TREND_START = process.env.AUTO_FETCH_LEDGER_START || '2024-01-01';

// 报告月 = 周窗口结束日所在月；数据窗口 = 报告月的上一自然月
function resolvePrevMonth(win: AutoFetchWindow): { startLabel: string; endLabel: string; dataMonth: string; label: string } {
  const [y, m] = win.endLabel.split('-').map(Number);
  const pm = m === 1 ? 12 : m - 1;
  const py = m === 1 ? y - 1 : y;
  const p2 = (n: number) => String(n).padStart(2, '0');
  const lastDay = new Date(py, pm, 0).getDate();
  return { startLabel: `${py}-${p2(pm)}-01`, endLabel: `${py}-${p2(pm)}-${p2(lastDay)}`, dataMonth: `${py}-${p2(pm)}`, label: `${py}年${pm}月` };
}

// 账随物动（公司月会/周例会·按会议类型落窗）：K3 生产任务单(ICMO) 开工日期 ±3天内是否有生产领料(FTranType=24，SO 前缀)
// 指标：有领料任务单数、开工±3天内有领料数(命中率)；另有"开工日但全程无领料"任务单数
async function fetchLedgerMove(win: AutoFetchWindow, candidates: AutoFetchCandidate[]): Promise<AutoFetchRecord[]> {
  if (candidates.length === 0) return [];
  const k3 = linkedObject(process.env.AUTO_FETCH_K3_LINKED || 'k3sv.AIS20161019115614');
  const monthWin = resolvePrevMonth(win);
  const weekWin = win;
  const pool = await new sql.ConnectionPool(parseConnectionString()).connect();
  try {
    const r = await pool.request()
      .input('trendStart', sql.NVarChar, LEDGER_TREND_START)
      .input('ms', sql.NVarChar, monthWin.startLabel)
      .input('me', sql.NVarChar, monthWin.endLabel)
      .input('ws', sql.NVarChar, weekWin.startLabel)
      .input('we', sql.NVarChar, weekWin.endLabel)
      .query(`
        SET NOCOUNT ON;
        IF OBJECT_ID('tempdb..#mo')   IS NOT NULL DROP TABLE #mo;
        IF OBJECT_ID('tempdb..#ll')   IS NOT NULL DROP TABLE #ll;
        IF OBJECT_ID('tempdb..#j')    IS NOT NULL DROP TABLE #j;
        IF OBJECT_ID('tempdb..#noll') IS NOT NULL DROP TABLE #noll;

        -- 1) 有开工日期的任务单
        SELECT FInterID, FBillNo, CONVERT(varchar(10), FStartDate, 120) AS start_d
        INTO #mo
        FROM ${k3}.dbo.ICMO
        WHERE FStartDate IS NOT NULL AND FStartDate >= @trendStart;

        -- 2) 生产领料单(SO 前缀, 类型24) 按任务单归集
        SELECT e.FSourceInterId AS mo_id, CONVERT(varchar(10), h.FDate, 120) AS ll_date
        INTO #ll
        FROM ${k3}.dbo.ICStockBill h
        JOIN ${k3}.dbo.ICStockBillEntry e ON h.FInterID = e.FInterID
        WHERE h.FTranType = 24 AND LEFT(h.FBillNo, 2) = 'SO';

        -- 3) 有领料的任务单：判断开工日 ±3 天内是否有领料
        SELECT m.FInterID, m.FBillNo, m.start_d,
               CASE WHEN EXISTS (SELECT 1 FROM #ll l WHERE l.mo_id = m.FInterID
                          AND l.ll_date BETWEEN CONVERT(varchar(10), DATEADD(day, -3, m.start_d), 120)
                                            AND CONVERT(varchar(10), DATEADD(day,  3, m.start_d), 120))
                    THEN 1 ELSE 0 END AS hit_pm3
        INTO #j
        FROM #mo m
        WHERE EXISTS (SELECT 1 FROM #ll l2 WHERE l2.mo_id = m.FInterID);

        -- 4) 有开工日但全程无领料的任务单
        SELECT m.FInterID, m.FBillNo, m.start_d
        INTO #noll
        FROM #mo m WHERE NOT EXISTS (SELECT 1 FROM #ll l WHERE l.mo_id = m.FInterID);

        -- 5) 逐月趋势
        SELECT LEFT(start_d, 7) AS ym, COUNT(*) AS n, SUM(hit_pm3) AS hit
        FROM #j GROUP BY LEFT(start_d, 7) ORDER BY ym;

        -- 6) 月 / 周聚合（有领料任务单 + 命中）
        SELECT COUNT(*) AS n, ISNULL(SUM(hit_pm3), 0) AS hit FROM #j WHERE start_d >= @ms AND start_d <= @me;
        SELECT COUNT(*) AS n, ISNULL(SUM(hit_pm3), 0) AS hit FROM #j WHERE start_d >= @ws AND start_d <= @we;

        -- 7) 月 / 周「开工日但全程无领料」数
        SELECT COUNT(*) AS c FROM #noll WHERE start_d >= @ms AND start_d <= @me;
        SELECT COUNT(*) AS c FROM #noll WHERE start_d >= @ws AND start_d <= @we;

        -- 8) 明细：有领料但开工±3天无领料（月 / 周）
        SELECT TOP 300 j.FBillNo, j.start_d,
               (SELECT MIN(l.ll_date) FROM #ll l WHERE l.mo_id = j.FInterID) AS first_ll,
               (SELECT MAX(l.ll_date) FROM #ll l WHERE l.mo_id = j.FInterID) AS last_ll
        FROM #j j WHERE j.hit_pm3 = 0 AND j.start_d >= @ms AND j.start_d <= @me ORDER BY j.start_d DESC;
        SELECT TOP 300 j.FBillNo, j.start_d,
               (SELECT MIN(l.ll_date) FROM #ll l WHERE l.mo_id = j.FInterID) AS first_ll,
               (SELECT MAX(l.ll_date) FROM #ll l WHERE l.mo_id = j.FInterID) AS last_ll
        FROM #j j WHERE j.hit_pm3 = 0 AND j.start_d >= @ws AND j.start_d <= @we ORDER BY j.start_d DESC;

        -- 9) 明细：开工日但全程无领料（月 / 周）
        SELECT TOP 300 FBillNo, start_d FROM #noll WHERE start_d >= @ms AND start_d <= @me ORDER BY start_d DESC;
        SELECT TOP 300 FBillNo, start_d FROM #noll WHERE start_d >= @ws AND start_d <= @we ORDER BY start_d DESC;

        DROP TABLE #mo; DROP TABLE #ll; DROP TABLE #j; DROP TABLE #noll;
      `);
    const sets = (r.recordsets || []) as any[][];
    const trend: any[] = sets[0] || [];
    const monthAgg = sets[1]?.[0] || { n: 0, hit: 0 };
    const weekAgg = sets[2]?.[0] || { n: 0, hit: 0 };
    const monthNoLl = Number(sets[3]?.[0]?.c || 0);
    const weekNoLl = Number(sets[4]?.[0]?.c || 0);
    const monthMiss: any[] = sets[5] || [];
    const weekMiss: any[] = sets[6] || [];
    const monthNoLlRows: any[] = sets[7] || [];
    const weekNoLlRows: any[] = sets[8] || [];
    const num = (v: unknown) => (v == null || isNaN(Number(v)) ? 0 : Number(v));
    const rateOf = (a: any) => num(a.n) > 0 ? Math.round((num(a.hit) / num(a.n)) * 1000) / 10 : 0;
    const mLabel = (s: string) => `${parseInt(s.slice(5, 7), 10)}/${parseInt(s.slice(8, 10), 10)}`;

    return candidates.map(c => {
      const isWeekly = /周会|周例会/.test(c.meetingType || '');
      const w = isWeekly ? weekWin : monthWin;
      const agg = isWeekly ? weekAgg : monthAgg;
      const noLl = isWeekly ? weekNoLl : monthNoLl;
      const label = isWeekly ? `${mLabel(weekWin.startLabel)}~${mLabel(weekWin.endLabel)}` : monthWin.label;
      const curYm = (isWeekly ? weekWin.endLabel : monthWin.endLabel).slice(0, 7);
      const progress = num(agg.n) > 0
        ? `账随物动 · ${label} 有领料任务单${num(agg.n)}单，开工±3天有领料${num(agg.hit)}单（${rateOf(agg)}%）；开工无领料${noLl}单`
        : `账随物动 · ${label} 无领料任务单`;
      const detail = [{
        kind: 'ledger-move',
        bill: '账随物动 · 逐月',
        date: `${w.startLabel} ~ ${w.endLabel}`,
        status: '',
        supplier: '',
        use: `本期 有领料任务单${num(agg.n)}单 · ±3天有领料${num(agg.hit)}单（${rateOf(agg)}%）· 开工无领料${noLl}单`,
        lines: trend.map(t => ({
          ym: String(t.ym || ''),
          n: num(t.n),
          hit: num(t.hit),
          pct: num(t.n) > 0 ? Math.round((num(t.hit) / num(t.n)) * 1000) / 10 : 0,
          current: String(t.ym || '') === curYm ? '◀ 本期' : '',
        })),
        missRows: (isWeekly ? weekMiss : monthMiss).map(x => ({
          no: String(x.FBillNo || ''), start: String(x.start_d || ''),
          first: String(x.first_ll || ''), last: String(x.last_ll || ''),
        })),
        noLlRows: (isWeekly ? weekNoLlRows : monthNoLlRows).map(x => ({
          no: String(x.FBillNo || ''), start: String(x.start_d || ''),
        })),
      }];
      return {
        actionId: c.id,
        progress,
        detail,
        cycleDate: isWeekly ? weekWin.endLabel : monthWin.endLabel,
        dataMonth: isWeekly ? null : monthWin.dataMonth,
      };
    });
  } finally {
    await pool.close();
  }
}

// 9) 委外按单领料（周例会/月会·按会议类型落窗）：K3 委外订单(ICSubContract) 是否下推了领料单(FTranType=5)
// 指标：委外订单数、有领料数、下推率 = 有领料 / 订单数；明细=逐月趋势 + 本期高亮
const WW_TREND_START = process.env.AUTO_FETCH_WW_START || '2026-01-01';

async function fetchSubcontractIssue(win: AutoFetchWindow, candidates: AutoFetchCandidate[]): Promise<AutoFetchRecord[]> {
  if (candidates.length === 0) return [];
  const k3 = linkedObject(process.env.AUTO_FETCH_K3_LINKED || 'k3sv.AIS20161019115614');
  const monthWin = resolvePrevMonth(win);
  const weekWin = win;
  const pool = await new sql.ConnectionPool(parseConnectionString()).connect();
  try {
    const r = await pool.request()
      .input('trendStart', sql.NVarChar, WW_TREND_START)
      .input('ms', sql.NVarChar, monthWin.startLabel)
      .input('me', sql.NVarChar, monthWin.endLabel)
      .input('ws', sql.NVarChar, weekWin.startLabel)
      .input('we', sql.NVarChar, weekWin.endLabel)
      .query(`
        SET NOCOUNT ON;
        IF OBJECT_ID('tempdb..#ww') IS NOT NULL DROP TABLE #ww;
        SELECT sc.FInterID, CONVERT(varchar(10), sc.FDate, 120) AS ww_date,
               CASE WHEN EXISTS (SELECT 1 FROM ${k3}.dbo.ICStockBillEntry e
                     JOIN ${k3}.dbo.ICStockBill h ON h.FInterID = e.FInterID
                     WHERE h.FTranType = 5 AND e.FOrderInterID = sc.FInterID) THEN 1 ELSE 0 END AS has_ll
        INTO #ww
        FROM ${k3}.dbo.ICSubContract sc
        WHERE sc.FDate >= @trendStart;

        SELECT LEFT(ww_date, 7) AS ym, COUNT(*) AS total,
               SUM(has_ll) AS hasll, COUNT(*) - SUM(has_ll) AS noll
        FROM #ww GROUP BY LEFT(ww_date, 7) ORDER BY ym;

        SELECT COUNT(*) AS total, SUM(has_ll) AS hasll, COUNT(*) - SUM(has_ll) AS noll
        FROM #ww WHERE ww_date >= @ms AND ww_date <= @me;

        SELECT COUNT(*) AS total, SUM(has_ll) AS hasll, COUNT(*) - SUM(has_ll) AS noll
        FROM #ww WHERE ww_date >= @ws AND ww_date <= @we;

        DROP TABLE #ww;
      `);
    const sets = (r.recordsets || []) as any[][];
    const trend: any[] = sets[0] || [];
    const monthAgg = sets[1]?.[0] || { total: 0, hasll: 0, noll: 0 };
    const weekAgg = sets[2]?.[0] || { total: 0, hasll: 0, noll: 0 };
    const num = (v: unknown) => (v == null || isNaN(Number(v)) ? 0 : Number(v));
    const rateOf = (a: any) => num(a.total) > 0 ? Math.round((num(a.hasll) / num(a.total)) * 1000) / 10 : 0;
    const mLabel = (s: string) => `${parseInt(s.slice(5, 7), 10)}/${parseInt(s.slice(8, 10), 10)}`;

    return candidates.map(c => {
      const isWeekly = /周会|周例会/.test(c.meetingType || '');
      const w = isWeekly ? weekWin : monthWin;
      const agg = isWeekly ? weekAgg : monthAgg;
      const label = isWeekly ? `${mLabel(weekWin.startLabel)}~${mLabel(weekWin.endLabel)}` : monthWin.label;
      const curYm = (isWeekly ? weekWin.endLabel : monthWin.endLabel).slice(0, 7);
      const progress = num(agg.total) > 0
        ? `委外按单领料 · ${label} 订单${num(agg.total)}，有领料${num(agg.hasll)}（下推率${rateOf(agg)}%）`
        : `委外按单领料 · ${label} 无委外订单`;
      const detail = [{
        kind: 'subcontract-issue',
        bill: '委外按单领料 · 逐月',
        date: `${w.startLabel} ~ ${w.endLabel}`,
        status: '',
        supplier: '',
        use: `本期 订单${num(agg.total)} · 有领料${num(agg.hasll)}（下推率${rateOf(agg)}%）· 无领料${num(agg.noll)}`,
        lines: trend.map(t => ({
          ym: String(t.ym || ''),
          total: num(t.total),
          hasll: num(t.hasll),
          noll: num(t.noll),
          pct: num(t.total) > 0 ? Math.round((num(t.hasll) / num(t.total)) * 1000) / 10 : 0,
          current: String(t.ym || '') === curYm ? '◀ 本期' : '',
        })),
      }];
      return {
        actionId: c.id,
        progress,
        detail,
        cycleDate: isWeekly ? weekWin.endLabel : monthWin.endLabel,
        dataMonth: isWeekly ? null : monthWin.dataMonth,
      };
    });
  } finally {
    await pool.close();
  }
}

// 10) 采购来料与有效订单对应（公司月会·月度源）：K3 外购入库(FTranType=1) 全链路匹配销售订单
// 未匹配原因：wg没挂采购订单 / 采购单手输无源单 / 投料单已删 / 任务单已删 / 任务单无销售订单
// 指标：外购入库分录数、未匹配数、未匹配率；明细=按月趋势(本期高亮)+原因分布+未匹配清单(Top300)
const POMATCH_TREND_START = process.env.AUTO_FETCH_POMATCH_START || '2026-01-01';

async function fetchPoMatch(win: AutoFetchWindow, candidates: AutoFetchCandidate[]): Promise<AutoFetchRecord[]> {
  if (candidates.length === 0) return [];
  const k3 = linkedObject(process.env.AUTO_FETCH_K3_LINKED || 'k3sv.AIS20161019115614');
  const monthWin = resolvePrevMonth(win);
  const weekWin = win;
  const pool = await new sql.ConnectionPool(parseConnectionString()).connect();
  try {
    const r = await pool.request()
      .input('trendStart', sql.NVarChar, POMATCH_TREND_START)
      .input('ms', sql.NVarChar, monthWin.startLabel)
      .input('me', sql.NVarChar, monthWin.endLabel)
      .input('ws', sql.NVarChar, weekWin.startLabel)
      .input('we', sql.NVarChar, weekWin.endLabel)
      .query(`
        SET NOCOUNT ON;
        IF OBJECT_ID('tempdb..#wg') IS NOT NULL DROP TABLE #wg;
        IF OBJECT_ID('tempdb..#j')  IS NOT NULL DROP TABLE #j;

        -- 1) 外购入库分录
        SELECT h.FBillNo AS wg_no, CONVERT(varchar(10), h.FDate, 120) AS wg_date,
               e.FItemID, e.FQty, ISNULL(e.FOrderInterID, 0) AS po_id, ISNULL(e.FOrderEntryID, 0) AS po_entry
        INTO #wg
        FROM ${k3}.dbo.ICStockBill h
        JOIN ${k3}.dbo.ICStockBillEntry e ON h.FInterID = e.FInterID
        WHERE h.FTranType = 1 AND h.FDate >= @trendStart;

        -- 2) 全链路关联，只保留匹配不上销售订单的
        SELECT w.wg_no, w.wg_date, w.FItemID, w.FQty, w.po_id,
               pe.FSourceTranType AS po_src, pe.FSourceInterId AS ppbom_id,
               m.FBillNo AS mo_no, o.FBillNo AS so_no,
               CASE WHEN w.po_id = 0 THEN N'wg没挂采购订单'
                    WHEN pe.FSourceTranType <> 70 OR pe.FSourceTranType IS NULL THEN N'采购单手输无源单'
                    WHEN pe.FSourceInterId IS NULL THEN N'投料单已删'
                    WHEN m.FBillNo IS NULL THEN N'任务单已删'
                    ELSE N'任务单无销售订单' END AS reason
        INTO #j
        FROM #wg w
        LEFT JOIN ${k3}.dbo.POOrderEntry pe ON w.po_id > 0 AND pe.FInterID = w.po_id AND pe.FEntryID = w.po_entry
        LEFT JOIN ${k3}.dbo.PPBOM p ON pe.FSourceTranType = 70 AND p.FInterID = pe.FSourceInterId
        LEFT JOIN ${k3}.dbo.ICMO m ON p.FICMOInterID = m.FInterID
        LEFT JOIN ${k3}.dbo.SEOrder o ON m.FOrderInterID = o.FInterID
        WHERE NOT EXISTS (
          SELECT 1 FROM ${k3}.dbo.POOrderEntry pe2
          JOIN ${k3}.dbo.PPBOM p2 ON pe2.FSourceTranType = 70 AND p2.FInterID = pe2.FSourceInterId
          JOIN ${k3}.dbo.ICMO m2 ON p2.FICMOInterID = m2.FInterID AND m2.FOrderInterID > 0
          WHERE pe2.FInterID = w.po_id AND pe2.FEntryID = w.po_entry);

        -- 3) 逐月趋势（总量 / 未匹配）
        SELECT LEFT(wg_date, 7) AS ym, COUNT(*) AS total FROM #wg GROUP BY LEFT(wg_date, 7) ORDER BY ym;
        SELECT LEFT(wg_date, 7) AS ym, COUNT(*) AS unmatched FROM #j GROUP BY LEFT(wg_date, 7) ORDER BY ym;

        -- 4) 月窗口 / 周窗口 聚合
        SELECT COUNT(*) AS total FROM #wg WHERE wg_date >= @ms AND wg_date <= @me;
        SELECT COUNT(*) AS unmatched FROM #j WHERE wg_date >= @ms AND wg_date <= @me;
        SELECT COUNT(*) AS total FROM #wg WHERE wg_date >= @ws AND wg_date <= @we;
        SELECT COUNT(*) AS unmatched FROM #j WHERE wg_date >= @ws AND wg_date <= @we;

        -- 5) 原因分布（月 / 周）
        SELECT reason, COUNT(*) AS cnt FROM #j WHERE wg_date >= @ms AND wg_date <= @me GROUP BY reason ORDER BY cnt DESC;
        SELECT reason, COUNT(*) AS cnt FROM #j WHERE wg_date >= @ws AND wg_date <= @we GROUP BY reason ORDER BY cnt DESC;

        -- 6) 未匹配清单（月 / 周，各 Top300）
        SELECT TOP 300 j.wg_no, j.wg_date, i.FNumber AS item_no, i.FName AS item_name, j.FQty AS qty, j.reason
        FROM #j j JOIN ${k3}.dbo.t_ICItem i ON i.FItemID = j.FItemID
        WHERE j.wg_date >= @ms AND j.wg_date <= @me ORDER BY j.wg_no DESC;
        SELECT TOP 300 j.wg_no, j.wg_date, i.FNumber AS item_no, i.FName AS item_name, j.FQty AS qty, j.reason
        FROM #j j JOIN ${k3}.dbo.t_ICItem i ON i.FItemID = j.FItemID
        WHERE j.wg_date >= @ws AND j.wg_date <= @we ORDER BY j.wg_no DESC;

        DROP TABLE #wg; DROP TABLE #j;
      `);
    const sets = (r.recordsets || []) as any[][];
    const num = (v: unknown) => (v == null || isNaN(Number(v)) ? 0 : Number(v));
    const totalsMap = new Map<string, number>();
    const unmap = new Map<string, number>();
    for (const x of sets[0] || []) totalsMap.set(String(x.ym), num(x.total));
    for (const x of sets[1] || []) unmap.set(String(x.ym), num(x.unmatched));
    const allYm = [...new Set([...totalsMap.keys(), ...unmap.keys()])].sort();
    const monthTotal = num(sets[2]?.[0]?.total), monthUnm = num(sets[3]?.[0]?.unmatched);
    const weekTotal = num(sets[4]?.[0]?.total), weekUnm = num(sets[5]?.[0]?.unmatched);
    const monthReasons = sets[6] || [], weekReasons = sets[7] || [];
    const monthRows = sets[8] || [], weekRows = sets[9] || [];
    const mLabel = (s: string) => `${parseInt(s.slice(5, 7), 10)}/${parseInt(s.slice(8, 10), 10)}`;
    const rateOf = (t: number, u: number) => (t > 0 ? Math.round((u / t) * 1000) / 10 : 0);

    return candidates.map(c => {
      const isWeekly = /周会|周例会/.test(c.meetingType || '');
      const w = isWeekly ? weekWin : monthWin;
      const total = isWeekly ? weekTotal : monthTotal;
      const unm = isWeekly ? weekUnm : monthUnm;
      const label = isWeekly ? `${mLabel(weekWin.startLabel)}~${mLabel(weekWin.endLabel)}` : monthWin.label;
      const curYm = (isWeekly ? weekWin.endLabel : monthWin.endLabel).slice(0, 7);
      const rate = rateOf(total, unm);
      const progress = total > 0
        ? `采购来料匹配 · ${label} 外购入库${total}条，未匹配${unm}条（未匹配率${rate}%）`
        : `采购来料匹配 · ${label} 无外购入库`;
      const detail = [{
        kind: 'po-match',
        bill: '采购来料匹配 · 逐月',
        date: `${w.startLabel} ~ ${w.endLabel}`,
        status: '',
        supplier: '',
        use: `本期 外购入库${total}条 · 未匹配${unm}条（未匹配率${rate}%）`,
        lines: allYm.map(ym => {
          const t = totalsMap.get(ym) || 0;
          const u = unmap.get(ym) || 0;
          return { ym, total: t, unmatched: u, pct: rateOf(t, u), current: ym === curYm ? '◀ 本期' : '' };
        }),
        reasons: (isWeekly ? weekReasons : monthReasons).map(x => ({ reason: String(x.reason || ''), cnt: num(x.cnt) })),
        rows: (isWeekly ? weekRows : monthRows).map(x => ({
          wgNo: String(x.wg_no || ''), date: String(x.wg_date || ''),
          itemNo: String(x.item_no || ''), itemName: String(x.item_name || ''),
          qty: x.qty == null ? null : Number(x.qty), reason: String(x.reason || ''),
        })),
      }];
      return {
        actionId: c.id,
        progress,
        detail,
        cycleDate: isWeekly ? weekWin.endLabel : monthWin.endLabel,
        dataMonth: isWeekly ? null : monthWin.dataMonth,
      };
    });
  } finally {
    await pool.close();
  }
}

// 11) 生产退料（周例会/月会·按会议类型落窗）：K3 生产领料单(FTranType=24) 红字行(FQty<0)
// 部门→车间映射：54152/54153/54156/80254=装配；77629=精益；34807/56354/56355=光电；其余=其他
// 每项按责任人对应车间过滤（RETURN_WORKSHOP_BY_OWNER）：李玉英=光电；田鹏/吴建英=精益
const RETURN_TREND_START = process.env.AUTO_FETCH_RETURN_START || '2026-01-01';
const RETURN_WORKSHOP_BY_OWNER: Record<string, string> = {
  '李玉英': '光电',
  '田鹏': '精益',
  '吴建英': '精益',
};

async function fetchMaterialReturn(win: AutoFetchWindow, candidates: AutoFetchCandidate[]): Promise<AutoFetchRecord[]> {
  if (candidates.length === 0) return [];
  const k3 = linkedObject(process.env.AUTO_FETCH_K3_LINKED || 'k3sv.AIS20161019115614');
  const monthWin = resolvePrevMonth(win);
  const weekWin = win;
  const pool = await new sql.ConnectionPool(parseConnectionString()).connect();
  try {
    // 按车间分组：优先取绑定参数 params.dept；未配参数时回退按责任人映射（兼容历史绑定）
    const byWs = new Map<string | null, AutoFetchCandidate[]>();
    for (const c of candidates) {
      const pv = c.params?.dept;
      const ws = (typeof pv === 'string' && pv.trim())
        ? pv.trim()
        : (RETURN_WORKSHOP_BY_OWNER[String(c.owner || '').trim()] ?? null);
      if (!byWs.has(ws)) byWs.set(ws, []);
      byWs.get(ws)!.push(c);
    }

    const num = (v: unknown) => (v == null || isNaN(Number(v)) ? 0 : Number(v));
    const mLabel = (s: string) => `${parseInt(s.slice(5, 7), 10)}/${parseInt(s.slice(8, 10), 10)}`;
    const out: AutoFetchRecord[] = [];

    for (const [wsp, group] of byWs) {
      const r = await pool.request()
        .input('trendStart', sql.NVarChar, RETURN_TREND_START)
        .input('wsp', sql.NVarChar, wsp)
        .input('ms', sql.NVarChar, monthWin.startLabel)
        .input('me', sql.NVarChar, monthWin.endLabel)
        .input('ws', sql.NVarChar, weekWin.startLabel)
        .input('we', sql.NVarChar, weekWin.endLabel)
        .query(`
          SET NOCOUNT ON;
          IF OBJECT_ID('tempdb..#tl') IS NOT NULL DROP TABLE #tl;
          SELECT h.FBillNo AS tl_no, CONVERT(varchar(10), h.FDate, 120) AS tl_date,
                 CASE WHEN h.FDeptID IN (54152, 54153, 54156, 80254) THEN N'装配'
                      WHEN h.FDeptID = 77629                      THEN N'精益'
                      WHEN h.FDeptID IN (34807, 56354, 56355)     THEN N'光电'
                      ELSE N'其他' END AS ws,
                 e.FItemID, -e.FQty AS ret_qty, ISNULL(e.FPrice, 0) AS price
          INTO #tl
          FROM ${k3}.dbo.ICStockBill h
          JOIN ${k3}.dbo.ICStockBillEntry e ON h.FInterID = e.FInterID
          WHERE h.FTranType = 24 AND h.FDate >= @trendStart AND e.FQty < 0;

          SELECT LEFT(tl_date, 7) AS ym, COUNT(*) AS lines, COUNT(DISTINCT tl_no) AS bills,
                 SUM(ret_qty) AS qty, SUM(ret_qty * price) AS amt
          FROM #tl WHERE (@wsp IS NULL OR ws = @wsp)
          GROUP BY LEFT(tl_date, 7) ORDER BY ym;

          SELECT COUNT(*) AS lines, COUNT(DISTINCT tl_no) AS bills,
                 ISNULL(SUM(ret_qty), 0) AS qty, ISNULL(SUM(ret_qty * price), 0) AS amt
          FROM #tl WHERE tl_date >= @ms AND tl_date <= @me AND (@wsp IS NULL OR ws = @wsp);

          SELECT COUNT(*) AS lines, COUNT(DISTINCT tl_no) AS bills,
                 ISNULL(SUM(ret_qty), 0) AS qty, ISNULL(SUM(ret_qty * price), 0) AS amt
          FROM #tl WHERE tl_date >= @ws AND tl_date <= @we AND (@wsp IS NULL OR ws = @wsp);

          SELECT TOP 500 tl_no, tl_date, ws, i.FNumber AS item_no, i.FName AS item_name,
                 ret_qty AS qty, price, ret_qty * price AS amt
          FROM #tl JOIN ${k3}.dbo.t_ICItem i ON i.FItemID = #tl.FItemID
          WHERE tl_date >= @ws AND tl_date <= @we AND (@wsp IS NULL OR ws = @wsp)
          ORDER BY tl_date DESC, tl_no, item_no;

          SELECT TOP 500 tl_no, tl_date, ws, i.FNumber AS item_no, i.FName AS item_name,
                 ret_qty AS qty, price, ret_qty * price AS amt
          FROM #tl JOIN ${k3}.dbo.t_ICItem i ON i.FItemID = #tl.FItemID
          WHERE tl_date >= @ms AND tl_date <= @me AND (@wsp IS NULL OR ws = @wsp)
          ORDER BY tl_date DESC, tl_no, item_no;

          DROP TABLE #tl;
        `);
      const sets = (r.recordsets || []) as any[][];
      const trend: any[] = sets[0] || [];
      const monthAgg = sets[1]?.[0] || { lines: 0, bills: 0, qty: 0, amt: 0 };
      const weekAgg = sets[2]?.[0] || { lines: 0, bills: 0, qty: 0, amt: 0 };
      const weekRows: any[] = sets[3] || [];
      const monthRows: any[] = sets[4] || [];
      const wsLabel = wsp ? `${wsp}车间` : '全部车间';

      for (const c of group) {
        const isWeekly = /周会|周例会/.test(c.meetingType || '');
        const w = isWeekly ? weekWin : monthWin;
        const agg = isWeekly ? weekAgg : monthAgg;
        const label = isWeekly ? `${mLabel(weekWin.startLabel)}~${mLabel(weekWin.endLabel)}` : monthWin.label;
        const curYm = (isWeekly ? weekWin.endLabel : monthWin.endLabel).slice(0, 7);
        const bills = num(agg.bills), lines = num(agg.lines), qty = num(agg.qty), amt = num(agg.amt);
        const progress = bills > 0
          ? `生产退料 · ${wsLabel} ${label} 退料${bills}单/${lines}条，数量${qty}，金额¥${Math.round(amt)}`
          : `生产退料 · ${wsLabel} ${label} 无退料`;
        const detail = [{
          kind: 'material-return',
          bill: `生产退料 · ${wsLabel}`,
          date: `${w.startLabel} ~ ${w.endLabel}`,
          status: '',
          supplier: '',
          use: `本期 退料${bills}单/${lines}条 · 数量${qty} · 金额¥${Math.round(amt)}`,
          lines: trend.map(t => ({
            ym: String(t.ym || ''),
            bills: num(t.bills),
            lines: num(t.lines),
            qty: num(t.qty),
            amt: Math.round(num(t.amt)),
            current: String(t.ym || '') === curYm ? '◀ 本期' : '',
          })),
          rows: (isWeekly ? weekRows : monthRows).map(x => ({
            no: String(x.tl_no || ''),
            date: String(x.tl_date || ''),
            ws: String(x.ws || ''),
            itemNo: String(x.item_no || ''),
            itemName: String(x.item_name || ''),
            qty: x.qty == null ? null : Number(x.qty),
            price: x.price == null ? null : Number(x.price),
            amt: x.amt == null ? null : Math.round(Number(x.amt) * 100) / 100,
          })),
        }];
        out.push({
          actionId: c.id,
          progress,
          detail,
          cycleDate: isWeekly ? weekWin.endLabel : monthWin.endLabel,
          dataMonth: isWeekly ? null : monthWin.dataMonth,
        });
      }
    }
    return out;
  } finally {
    await pool.close();
  }
}

// 12) 物料来料3天入库（周例会/月会·按会议类型落窗）：K3 收料通知单(DD) → 外购入库单(FTranType=1，源单类型72)
// 每张收料通知取最早入库计算间隔天数 dy；指标=收料通知数、3天内(dy∈[0,3])入库数、达标率、平均天数
const INBOUND_TREND_START = process.env.AUTO_FETCH_INBOUND_START || '2025-01-01';

async function fetchMaterialInbound(win: AutoFetchWindow, candidates: AutoFetchCandidate[]): Promise<AutoFetchRecord[]> {
  if (candidates.length === 0) return [];
  const k3 = linkedObject(process.env.AUTO_FETCH_K3_LINKED || 'k3sv.AIS20161019115614');
  const monthWin = resolvePrevMonth(win);
  const weekWin = win;
  const pool = await new sql.ConnectionPool(parseConnectionString()).connect();
  try {
    const r = await pool.request()
      .input('trendStart', sql.NVarChar, INBOUND_TREND_START)
      .input('ms', sql.NVarChar, monthWin.startLabel)
      .input('me', sql.NVarChar, monthWin.endLabel)
      .input('ws', sql.NVarChar, weekWin.startLabel)
      .input('we', sql.NVarChar, weekWin.endLabel)
      .query(`
        SET NOCOUNT ON;
        IF OBJECT_ID('tempdb..#rk')   IS NOT NULL DROP TABLE #rk;
        IF OBJECT_ID('tempdb..#j')    IS NOT NULL DROP TABLE #j;
        IF OBJECT_ID('tempdb..#best') IS NOT NULL DROP TABLE #best;

        -- 1) wg入库单（源单=收料通知，类型码72）
        SELECT DISTINCT se.FSourceInterId AS dd_id, h.FBillNo AS wg_no,
               CONVERT(varchar(10), h.FDate, 120) AS wg_date
        INTO #rk
        FROM ${k3}.dbo.ICStockBill h
        JOIN ${k3}.dbo.ICStockBillEntry se ON h.FInterID = se.FInterID
        WHERE h.FTranType = 1 AND se.FSourceTranType = 72 AND h.FDate >= @trendStart;

        -- 2) 配对收料通知（排除POOUT委外，只看DD）
        SELECT r.dd_id, n.FBillNo AS dd_no, CONVERT(varchar(10), n.FDate, 120) AS dd_date,
               r.wg_no, r.wg_date, DATEDIFF(day, n.FDate, r.wg_date) AS dy
        INTO #j
        FROM #rk r
        JOIN ${k3}.dbo.POInStock n ON n.FInterID = r.dd_id
        WHERE n.FDate >= @trendStart AND n.FBillNo LIKE 'DD%';

        -- 3) 每张通知取最早入库
        SELECT dd_id, dd_no, dd_date, wg_no, wg_date, dy,
               ROW_NUMBER() OVER (PARTITION BY dd_id ORDER BY dy) AS rn
        INTO #best FROM #j;

        -- 4) 逐月趋势（每张通知取最早入库）
        SELECT LEFT(dd_date, 7) AS ym, COUNT(*) AS total,
               SUM(CASE WHEN dy >= 0 AND dy <= 3 THEN 1 ELSE 0 END) AS within3, AVG(1.0 * dy) AS avgdy
        FROM #best WHERE rn = 1 GROUP BY LEFT(dd_date, 7) ORDER BY ym;

        -- 5) 上一自然月聚合
        SELECT COUNT(*) AS total, SUM(CASE WHEN dy >= 0 AND dy <= 3 THEN 1 ELSE 0 END) AS within3, AVG(1.0 * dy) AS avgdy
        FROM #best WHERE rn = 1 AND dd_date >= @ms AND dd_date <= @me;

        -- 6) 上一自然周聚合
        SELECT COUNT(*) AS total, SUM(CASE WHEN dy >= 0 AND dy <= 3 THEN 1 ELSE 0 END) AS within3, AVG(1.0 * dy) AS avgdy
        FROM #best WHERE rn = 1 AND dd_date >= @ws AND dd_date <= @we;

        -- 7) 超3天未及时入库明细（周 / 月）
        SELECT TOP 300 dd_no, dd_date, wg_no, wg_date, dy
        FROM #best WHERE rn = 1 AND dy > 3 AND dd_date >= @ws AND dd_date <= @we ORDER BY dy DESC;
        SELECT TOP 300 dd_no, dd_date, wg_no, wg_date, dy
        FROM #best WHERE rn = 1 AND dy > 3 AND dd_date >= @ms AND dd_date <= @me ORDER BY dy DESC;

        DROP TABLE #rk; DROP TABLE #j; DROP TABLE #best;
      `);
    const sets = (r.recordsets || []) as any[][];
    const trend: any[] = sets[0] || [];
    const monthAgg = sets[1]?.[0] || { total: 0, within3: 0, avgdy: null };
    const weekAgg = sets[2]?.[0] || { total: 0, within3: 0, avgdy: null };
    const weekRows: any[] = sets[3] || [];
    const monthRows: any[] = sets[4] || [];
    const num = (v: unknown) => (v == null || isNaN(Number(v)) ? 0 : Number(v));
    const rateOf = (a: any) => num(a.total) > 0 ? Math.round((num(a.within3) / num(a.total)) * 1000) / 10 : 0;
    const avgTxt = (a: any) => (a.avgdy == null ? '—' : Number(a.avgdy).toFixed(1));
    const mLabel = (s: string) => `${parseInt(s.slice(5, 7), 10)}/${parseInt(s.slice(8, 10), 10)}`;

    return candidates.map(c => {
      const isWeekly = /周会|周例会/.test(c.meetingType || '');
      const w = isWeekly ? weekWin : monthWin;
      const agg = isWeekly ? weekAgg : monthAgg;
      const label = isWeekly ? `${mLabel(weekWin.startLabel)}~${mLabel(weekWin.endLabel)}` : monthWin.label;
      const curYm = (isWeekly ? weekWin.endLabel : monthWin.endLabel).slice(0, 7);
      const progress = num(agg.total) > 0
        ? `物料来料3天入库 · ${label} 收料通知${num(agg.total)}单，3天内${num(agg.within3)}单（${rateOf(agg)}%，平均${avgTxt(agg)}天）`
        : `物料来料3天入库 · ${label} 无收料通知`;
      const detail = [{
        kind: 'material-inbound',
        bill: '物料来料3天入库 · 逐月',
        date: `${w.startLabel} ~ ${w.endLabel}`,
        status: '',
        supplier: '',
        use: `本期 收料通知${num(agg.total)}单 · 3天内${num(agg.within3)}单（${rateOf(agg)}%）· 平均${avgTxt(agg)}天`,
        lines: trend.map(t => ({
          ym: String(t.ym || ''),
          total: num(t.total),
          within3: num(t.within3),
          pct: num(t.total) > 0 ? Math.round((num(t.within3) / num(t.total)) * 1000) / 10 : 0,
          avg: t.avgdy == null ? null : Number(t.avgdy),
          current: String(t.ym || '') === curYm ? '◀ 本期' : '',
        })),
        rows: (isWeekly ? weekRows : monthRows).map(x => ({
          ddNo: String(x.dd_no || ''),
          ddDate: String(x.dd_date || ''),
          wgNo: String(x.wg_no || ''),
          wgDate: String(x.wg_date || ''),
          dy: x.dy == null ? null : Number(x.dy),
        })),
      }];
      return {
        actionId: c.id,
        progress,
        detail,
        cycleDate: isWeekly ? weekWin.endLabel : monthWin.endLabel,
        dataMonth: isWeekly ? null : monthWin.dataMonth,
      };
    });
  } finally {
    await pool.close();
  }
}

// 13) 研发其他领料（周例会/月会·按会议类型落窗）：K3 其他出库单(FTranType=29)，研发体系部门
const RD_TREND_START = process.env.AUTO_FETCH_RD_START || '2026-01-01';
const RD_DEPTS = [56362, 34795, 34796, 34797, 54780, 54781, 54782];

async function fetchRdIssue(win: AutoFetchWindow, candidates: AutoFetchCandidate[]): Promise<AutoFetchRecord[]> {
  if (candidates.length === 0) return [];
  const k3 = linkedObject(process.env.AUTO_FETCH_K3_LINKED || 'k3sv.AIS20161019115614');
  const monthWin = resolvePrevMonth(win);
  const weekWin = win;
  const deptList = RD_DEPTS.join(', ');
  const pool = await new sql.ConnectionPool(parseConnectionString()).connect();
  try {
    const r = await pool.request()
      .input('trendStart', sql.NVarChar, RD_TREND_START)
      .input('ms', sql.NVarChar, monthWin.startLabel)
      .input('me', sql.NVarChar, monthWin.endLabel)
      .input('ws', sql.NVarChar, weekWin.startLabel)
      .input('we', sql.NVarChar, weekWin.endLabel)
      .query(`
        SET NOCOUNT ON;
        IF OBJECT_ID('tempdb..#rd') IS NOT NULL DROP TABLE #rd;
        SELECT h.FBillNo AS qo_no, CONVERT(varchar(10), h.FDate, 120) AS qo_date, d.FName AS dept,
               i.FNumber AS item_no, i.FName AS item_name, e.FQty, e.FPrice, ISNULL(e.FAmount, 0) AS FAmount
        INTO #rd
        FROM ${k3}.dbo.ICStockBill h
        JOIN ${k3}.dbo.ICStockBillEntry e ON h.FInterID = e.FInterID
        JOIN ${k3}.dbo.t_ICItem i ON i.FItemID = e.FItemID
        LEFT JOIN ${k3}.dbo.t_Department d ON d.FItemID = h.FDeptID
        WHERE h.FTranType = 29 AND h.FDate >= @trendStart AND h.FDeptID IN (${deptList});

        SELECT LEFT(qo_date, 7) AS ym, COUNT(*) AS lines, COUNT(DISTINCT qo_no) AS bills,
               SUM(FAmount) AS amt FROM #rd GROUP BY LEFT(qo_date, 7) ORDER BY ym;

        SELECT COUNT(*) AS lines, COUNT(DISTINCT qo_no) AS bills, ISNULL(SUM(FAmount), 0) AS amt
        FROM #rd WHERE qo_date >= @ms AND qo_date <= @me;
        SELECT COUNT(*) AS lines, COUNT(DISTINCT qo_no) AS bills, ISNULL(SUM(FAmount), 0) AS amt
        FROM #rd WHERE qo_date >= @ws AND qo_date <= @we;

        SELECT dept, COUNT(*) AS lines, SUM(FAmount) AS amt FROM #rd
        WHERE qo_date >= @ms AND qo_date <= @me GROUP BY dept ORDER BY amt DESC;
        SELECT dept, COUNT(*) AS lines, SUM(FAmount) AS amt FROM #rd
        WHERE qo_date >= @ws AND qo_date <= @we GROUP BY dept ORDER BY amt DESC;

        SELECT TOP 500 qo_no, qo_date, dept, item_no, item_name, FQty AS qty, FPrice AS price, FAmount AS amt
        FROM #rd WHERE qo_date >= @ms AND qo_date <= @me ORDER BY qo_date DESC, qo_no;
        SELECT TOP 500 qo_no, qo_date, dept, item_no, item_name, FQty AS qty, FPrice AS price, FAmount AS amt
        FROM #rd WHERE qo_date >= @ws AND qo_date <= @we ORDER BY qo_date DESC, qo_no;

        DROP TABLE #rd;
      `);
    const sets = (r.recordsets || []) as any[][];
    const trend: any[] = sets[0] || [];
    const monthAgg = sets[1]?.[0] || { lines: 0, bills: 0, amt: 0 };
    const weekAgg = sets[2]?.[0] || { lines: 0, bills: 0, amt: 0 };
    const deptMonth: any[] = sets[3] || [];
    const deptWeek: any[] = sets[4] || [];
    const rowsMonth: any[] = sets[5] || [];
    const rowsWeek: any[] = sets[6] || [];
    const num = (v: unknown) => (v == null || isNaN(Number(v)) ? 0 : Number(v));
    const mLabel = (s: string) => `${parseInt(s.slice(5, 7), 10)}/${parseInt(s.slice(8, 10), 10)}`;
    const mapRow = (x: any) => ({
      no: String(x.qo_no || ''), date: String(x.qo_date || ''), dept: String(x.dept || ''),
      itemNo: String(x.item_no || ''), itemName: String(x.item_name || ''),
      qty: x.qty == null ? null : Number(x.qty), price: x.price == null ? null : Number(x.price),
      amt: x.amt == null ? null : Math.round(Number(x.amt) * 100) / 100,
    });
    const mapDept = (x: any) => ({ dept: String(x.dept || '未标注'), lines: num(x.lines), amt: Math.round(num(x.amt)) });

    return candidates.map(c => {
      const isWeekly = /周会|周例会/.test(c.meetingType || '');
      const w = isWeekly ? weekWin : monthWin;
      const agg = isWeekly ? weekAgg : monthAgg;
      const label = isWeekly ? `${mLabel(weekWin.startLabel)}~${mLabel(weekWin.endLabel)}` : monthWin.label;
      const curYm = (isWeekly ? weekWin.endLabel : monthWin.endLabel).slice(0, 7);
      const bills = num(agg.bills), lines = num(agg.lines), amt = num(agg.amt);
      const progress = bills > 0
        ? `研发其他领料 · ${label} 出库${bills}单/${lines}条，金额¥${Math.round(amt)}`
        : `研发其他领料 · ${label} 无出库`;
      const detail = [{
        kind: 'rd-issue',
        bill: '研发其他领料 · 逐月',
        date: `${w.startLabel} ~ ${w.endLabel}`,
        status: '',
        supplier: '',
        use: `本期 出库${bills}单/${lines}条 · 金额¥${Math.round(amt)}`,
        lines: trend.map(t => ({
          ym: String(t.ym || ''),
          bills: num(t.bills),
          lines: num(t.lines),
          amt: Math.round(num(t.amt)),
          current: String(t.ym || '') === curYm ? '◀ 本期' : '',
        })),
        deptLines: (isWeekly ? deptWeek : deptMonth).map(mapDept),
        rows: (isWeekly ? rowsWeek : rowsMonth).map(mapRow),
      }];
      return {
        actionId: c.id,
        progress,
        detail,
        cycleDate: isWeekly ? weekWin.endLabel : monthWin.endLabel,
        dataMonth: isWeekly ? null : monthWin.dataMonth,
      };
    });
  } finally {
    await pool.close();
  }
}

// 14) 成品送检2天入库（周例会/月会·按会议类型落窗）：K3 检验汇报单(ICMORpt，合格) → 产品入库单(FTranType=2，源单类型551)
// 指标：合格汇报单数、2天内入库数(dy∈[0,2])、占比、平均天数；窗口按「汇报单(送检)日期」
const INSPECT_TREND_START = process.env.AUTO_FETCH_INSPECT_START || '2024-01-01';

async function fetchInspectInbound(win: AutoFetchWindow, candidates: AutoFetchCandidate[]): Promise<AutoFetchRecord[]> {
  if (candidates.length === 0) return [];
  const k3 = linkedObject(process.env.AUTO_FETCH_K3_LINKED || 'k3sv.AIS20161019115614');
  const monthWin = resolvePrevMonth(win);
  const weekWin = win;
  const pool = await new sql.ConnectionPool(parseConnectionString()).connect();
  try {
    const r = await pool.request()
      .input('trendStart', sql.NVarChar, INSPECT_TREND_START)
      .input('ms', sql.NVarChar, monthWin.startLabel)
      .input('me', sql.NVarChar, monthWin.endLabel)
      .input('ws', sql.NVarChar, weekWin.startLabel)
      .input('we', sql.NVarChar, weekWin.endLabel)
      .query(`
        SET NOCOUNT ON;
        -- 1) 汇报单按单归集：合格 = 无不合格且合格数>0
        SELECT r.FInterID AS rpt_id,
               CASE WHEN SUM(ISNULL(e.FNotPassQty, 0)) = 0
                     AND SUM(ISNULL(e.FQtyPass, 0)) > 0 THEN 1 ELSE 0 END AS is_ok
        INTO #rpt
        FROM ${k3}.dbo.ICMORpt r
        JOIN ${k3}.dbo.ICMORptEntry e ON r.FInterID = e.FInterID
        WHERE r.FDate >= @trendStart AND ISNULL(r.FCancellation, 0) = 0
        GROUP BY r.FInterID;

        -- 2) 产品入库单（源单=汇报单）
        SELECT DISTINCT se.FSourceInterId AS rpt_id, h.FBillNo AS cp_no,
               CONVERT(varchar(10), h.FDate, 120) AS cp_date
        INTO #cp
        FROM ${k3}.dbo.ICStockBill h
        JOIN ${k3}.dbo.ICStockBillEntry se ON h.FInterID = se.FInterID
        WHERE h.FTranType = 2 AND se.FSourceTranType = 551 AND h.FDate >= @trendStart;

        -- 3) 配对（每张合格汇报单选最早入库）
        SELECT p.rpt_id, r.FBillNo AS rpt_no, CONVERT(varchar(10), r.FDate, 120) AS rpt_date,
               c.cp_no, c.cp_date, DATEDIFF(day, CONVERT(varchar(10), r.FDate, 120), c.cp_date) AS dy
        INTO #j
        FROM #rpt p
        JOIN #cp c ON c.rpt_id = p.rpt_id
        JOIN ${k3}.dbo.ICMORpt r ON r.FInterID = p.rpt_id
        WHERE p.is_ok = 1;

        -- 4) 逐月趋势（按汇报单日期）
        SELECT LEFT(rpt_date, 7) AS ym, COUNT(*) AS total,
               SUM(CASE WHEN dy >= 0 AND dy <= 2 THEN 1 ELSE 0 END) AS within2, AVG(1.0 * dy) AS avgdy
        FROM #j GROUP BY LEFT(rpt_date, 7) ORDER BY ym;

        -- 5) 上一自然月聚合
        SELECT COUNT(*) AS total, SUM(CASE WHEN dy >= 0 AND dy <= 2 THEN 1 ELSE 0 END) AS within2, AVG(1.0 * dy) AS avgdy
        FROM #j WHERE rpt_date >= @ms AND rpt_date <= @me;

        -- 6) 上一自然周聚合
        SELECT COUNT(*) AS total, SUM(CASE WHEN dy >= 0 AND dy <= 2 THEN 1 ELSE 0 END) AS within2, AVG(1.0 * dy) AS avgdy
        FROM #j WHERE rpt_date >= @ws AND rpt_date <= @we;

        -- 7) 超2天未及时入库明细（周 / 月）
        SELECT TOP 300 rpt_no, rpt_date, cp_no, cp_date, dy FROM #j
        WHERE dy > 2 AND rpt_date >= @ws AND rpt_date <= @we ORDER BY dy DESC;
        SELECT TOP 300 rpt_no, rpt_date, cp_no, cp_date, dy FROM #j
        WHERE dy > 2 AND rpt_date >= @ms AND rpt_date <= @me ORDER BY dy DESC;

        DROP TABLE #rpt; DROP TABLE #cp; DROP TABLE #j;
      `);
    const sets = (r.recordsets || []) as any[][];
    const trend: any[] = sets[0] || [];
    const monthAgg = sets[1]?.[0] || { total: 0, within2: 0, avgdy: null };
    const weekAgg = sets[2]?.[0] || { total: 0, within2: 0, avgdy: null };
    const weekRows: any[] = sets[3] || [];
    const monthRows: any[] = sets[4] || [];
    const num = (v: unknown) => (v == null || isNaN(Number(v)) ? 0 : Number(v));
    const rateOf = (a: any) => num(a.total) > 0 ? Math.round((num(a.within2) / num(a.total)) * 1000) / 10 : 0;
    const avgTxt = (a: any) => (a.avgdy == null ? '—' : Number(a.avgdy).toFixed(1));
    const mLabel = (s: string) => `${parseInt(s.slice(5, 7), 10)}/${parseInt(s.slice(8, 10), 10)}`;

    return candidates.map(c => {
      const isWeekly = /周会|周例会/.test(c.meetingType || '');
      const w = isWeekly ? weekWin : monthWin;
      const agg = isWeekly ? weekAgg : monthAgg;
      const label = isWeekly ? `${mLabel(weekWin.startLabel)}~${mLabel(weekWin.endLabel)}` : monthWin.label;
      const curYm = (isWeekly ? weekWin.endLabel : monthWin.endLabel).slice(0, 7);
      const progress = num(agg.total) > 0
        ? `成品送检2天入库 · ${label} 汇报单${num(agg.total)}单，2天内入库${num(agg.within2)}单（${rateOf(agg)}%，平均${avgTxt(agg)}天）`
        : `成品送检2天入库 · ${label} 无合格汇报单`;
      const detail = [{
        kind: 'inspect-inbound',
        bill: '成品送检2天入库 · 逐月',
        date: `${w.startLabel} ~ ${w.endLabel}`,
        status: '',
        supplier: '',
        use: `本期 汇报单${num(agg.total)}单 · 2天内入库${num(agg.within2)}单（${rateOf(agg)}%）· 平均${avgTxt(agg)}天`,
        lines: trend.map(t => ({
          ym: String(t.ym || ''),
          total: num(t.total),
          within2: num(t.within2),
          pct: num(t.total) > 0 ? Math.round((num(t.within2) / num(t.total)) * 1000) / 10 : 0,
          avg: t.avgdy == null ? null : Number(t.avgdy),
          current: String(t.ym || '') === curYm ? '◀ 本期' : '',
        })),
        rows: (isWeekly ? weekRows : monthRows).map(x => ({
          rptNo: String(x.rpt_no || ''), rptDate: String(x.rpt_date || ''),
          cpNo: String(x.cp_no || ''), cpDate: String(x.cp_date || ''),
          dy: x.dy == null ? null : Number(x.dy),
        })),
      }];
      return {
        actionId: c.id, progress, detail,
        cycleDate: isWeekly ? weekWin.endLabel : monthWin.endLabel,
        dataMonth: isWeekly ? null : monthWin.dataMonth,
      };
    });
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
  'oa-inspection-inbound': fetchInspectionInbound,
  'k3-ledger-move': fetchLedgerMove,
  'k3-subcontract-issue': fetchSubcontractIssue,
  'k3-po-match': fetchPoMatch,
  'k3-material-return': fetchMaterialReturn,
  'k3-material-inbound': fetchMaterialInbound,
  'k3-rd-issue': fetchRdIssue,
  'k3-inspect-inbound': fetchInspectInbound,
};

export function isValidSourceKey(key?: string | null): boolean {
  return !!key && AUTO_FETCH_SOURCES.some(s => s.key === key);
}

// 自定义源执行：汇总 SQL(返回一行) + 明细 SQL(返回多行) + 文字模板
// SQL 占位符：@ws/@we 上一自然周一/日；@ms/@me 上一自然月初/末；模板变量：{{列名}} + {{label}}（周期标签）
async function runCustomSource(
  rec: AutoFetchSourceRecord,
  win: AutoFetchWindow,
  candidates: AutoFetchCandidate[],
): Promise<AutoFetchRecord[]> {
  if (candidates.length === 0) return [];
  const monthWin = resolvePrevMonth(win);
  const mLabel = (s: string) => `${parseInt(s.slice(5, 7), 10)}/${parseInt(s.slice(8, 10), 10)}`;
  const pool = await new sql.ConnectionPool(parseConnectionString()).connect();
  try {
    const out: AutoFetchRecord[] = [];
    for (const c of candidates) {
      const isWeekly = /周会|周例会/.test(c.meetingType || '');
      const w = isWeekly ? win : monthWin;
      const label = isWeekly ? `${mLabel(win.startLabel)}~${mLabel(win.endLabel)}` : monthWin.label;
      const runSql = async (text: string): Promise<any[]> => {
        const r = await pool.request()
          .input('ws', sql.NVarChar, win.startLabel).input('we', sql.NVarChar, win.endLabel)
          .input('ms', sql.NVarChar, monthWin.startLabel).input('me', sql.NVarChar, monthWin.endLabel)
          .query(text);
        return r.recordset || [];
      };
      const summary: Record<string, unknown> = rec.summarySql ? ((await runSql(rec.summarySql))[0] || {}) : {};
      const rawRows = rec.detailSql ? await runSql(rec.detailSql) : [];
      const rows = rawRows.map((r0: any) => {
        const o: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(r0)) o[k] = v instanceof Date ? ymd(v) : v;
        return o;
      });
      const vars: Record<string, unknown> = { ...summary, label, name: rec.name };
      const progress = (rec.progressTpl || `${rec.name} · ${label}`).replace(
        /\{\{\s*([\w\u4e00-\u9fa5]+)\s*\}\}/g,
        (_m, k: string) => (vars[k] == null ? '' : String(vars[k])),
      );
      const detail = [{
        kind: 'custom',
        bill: rec.name,
        date: `${w.startLabel} ~ ${w.endLabel}`,
        status: '',
        supplier: '',
        use: '',
        cols: rec.detailCols || null,
        lines: rows,
      }];
      out.push({
        actionId: c.id, progress, detail,
        cycleDate: isWeekly ? win.endLabel : monthWin.endLabel,
        dataMonth: isWeekly ? null : monthWin.dataMonth,
      });
    }
    return out;
  } finally {
    await pool.close();
  }
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
  opts: { endDate?: string; dryRun?: boolean; only?: { actionId: string; source?: string; params?: Record<string, unknown> | null } } = {},
): Promise<AutoFetchResult> {
  const win = opts.endDate ? resolveWeekEnding(opts.endDate) : resolvePrevNaturalWeek(_now);
  if (!win) throw new Error('无效的 endDate（需为周日 YYYY-MM-DD）');

  const all = await getAllActionItems();

  // 自定义取数源（前台维护，SQL 存库）
  const customSources = new Map<string, AutoFetchSourceRecord>();
  try {
    for (const s of await listCustomSources()) if (s.enabled) customSources.set(s.key, s);
  } catch (e) {
    console.warn('[auto-fetch] 读取自定义取数源失败:', e instanceof Error ? e.message : e);
  }
  const validKey = (k?: string | null): boolean => isValidSourceKey(k) || (!!k && customSources.has(k));

  const execItems = all.filter(i =>
    i.dueDateType === 'continuous' &&
    !!i.autoFetch &&
    validKey(i.autoFetchSource) &&
    i.status !== 'cancelled' &&
    i.status !== 'done'
  );

  const base: AutoFetchResult = { window: win, candidates: execItems.length, written: 0, dryRun: !!opts.dryRun, previews: [], missing: execItems.map(c => c.id) };
  if (execItems.length === 0) {
    console.log(`[auto-fetch] 无可执行的自动取数持续项（${win.startLabel} ~ ${win.endLabel}）`);
    return base;
  }

  // 会议类型映射：月度源据此区分「月会按月 / 周例会按周」；批次项用 sourceText 兜底
  const meetingTypeById = new Map<string, string>();
  try {
    for (const m of await getMeetings()) meetingTypeById.set(m.id, m.type);
  } catch (e) {
    console.warn('[auto-fetch] 读取会议类型失败（月度源窗口可能退化）:', e instanceof Error ? e.message : e);
  }

  const bySource = new Map<string, AutoFetchCandidate[]>();

  // 单条预演（绑定前预览本期结果，不写库）：仅跑指定持续项与指定源/参数
  if (opts.only?.actionId) {
    const item = all.find(i => i.id === opts.only!.actionId);
    if (!item) {
      return { window: win, candidates: 0, written: 0, dryRun: true, previews: [], missing: [opts.only.actionId] };
    }
    const srcKey = opts.only.source || item.autoFetchSource || null;
    if (!validKey(srcKey)) {
      return { window: win, candidates: 1, written: 0, dryRun: true, previews: [], missing: [item.id] };
    }
    const cand: AutoFetchCandidate = {
      id: item.id,
      description: item.description,
      owner: item.owner ?? null,
      sourceText: item.sourceText ?? null,
      meetingType: (item.meetingId ? meetingTypeById.get(item.meetingId) : null)
        || (item.sourceType === 'batch' ? (item.sourceText || null) : null),
      params: opts.only.params ?? (item as any).autoFetchParams ?? null,
    };
    let previews: AutoFetchResult['previews'] = [];
    try {
      const impl = SOURCE_IMPLS[srcKey!];
      const custom = customSources.get(srcKey!);
      const records = impl ? await impl(win, [cand]) : await runCustomSource(custom!, win, [cand]);
      const rec = records.find(r => r.actionId === item.id);
      if (rec?.progress) previews = [{ actionId: item.id, progress: rec.progress, detail: rec.detail ?? null }];
    } catch (e) {
      console.error(`[auto-fetch][preview] 取数源执行失败 ${srcKey}:`, e instanceof Error ? e.message : e);
    }
    console.log(`[auto-fetch][preview] ${srcKey} actionId=${item.id} → ${previews[0]?.progress || '(无结果)'}`);
    return { window: win, candidates: 1, written: 0, dryRun: true, previews, missing: previews.length ? [] : [item.id] };
  }
  for (const i of execItems) {
    const k = i.autoFetchSource!;
    const cand: AutoFetchCandidate = {
      id: i.id,
      description: i.description,
      owner: i.owner ?? null,
      sourceText: i.sourceText ?? null,
      meetingType: (i.meetingId ? meetingTypeById.get(i.meetingId) : null)
        || (i.sourceType === 'batch' ? (i.sourceText || null) : null),
      params: (i as any).autoFetchParams ?? null,
    };
    if (!bySource.has(k)) bySource.set(k, []);
    bySource.get(k)!.push(cand);
  }

  const previews: AutoFetchResult['previews'] = [];
  let written = 0;
  const missing: string[] = [];

  for (const [key, group] of bySource) {
    const impl = SOURCE_IMPLS[key];
    const custom = customSources.get(key);
    if (!impl && !custom) {
      console.warn(`[auto-fetch] 取数源实现缺失：${key}`);
      group.forEach(c => missing.push(c.id));
      continue;
    }
    let records: AutoFetchRecord[] = [];
    try {
      records = impl ? await impl(win, group) : await runCustomSource(custom!, win, group);
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
        // 周期归属：周例会源=周窗口末日（周日）；月度源（产销会）=源自带 cycleDate（周期末日15号）+ dataMonth
        const cycleDate = rec.cycleDate || win.endLabel;
        await upsertContinuousProgress({
          actionId: c.id,
          cycleDate,
          oaTaskId: `AUTO_${c.id}_${cycleDate}`,
          progress: rec.progress,
          oaStatus: 1,
          source: '自动取数',
          dataMonth: rec.dataMonth ?? null,
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

  console.log(`[auto-fetch] ${opts.dryRun ? '【dryRun】' : ''}${win.startLabel} ~ ${win.endLabel}：候选 ${execItems.length}，写入 ${written}，缺失 ${missing.length}`);
  return { window: win, candidates: execItems.length, written, dryRun: !!opts.dryRun, previews, missing };
}
