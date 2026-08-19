import { NextResponse } from 'next/server';
import sql from 'mssql';
import {
  createDepartment, updateDepartment, deleteDepartmentCascade, getDepartments,
  createEmployee, updateEmployee, getEmployees,
} from '@/storage/database/org-storage';

// 泛微OA数据库配置（从环境变量读取）
const WEAVER_DB_HOST = process.env.WEAVER_DB_HOST || '';
const WEAVER_DB_PORT = process.env.WEAVER_DB_PORT || '1433';
const WEAVER_DB_USER = process.env.WEAVER_DB_USER || '';
const WEAVER_DB_PASSWORD = process.env.WEAVER_DB_PASSWORD || '';
const WEAVER_DB_NAME = process.env.WEAVER_DB_NAME || '';

// 泛微OA数据库表结构（根据实际情况调整）
const SC_TABLE   = 'FWsv.ecology.dbo.HrmSubcompany';  // 分公司/子公司表（多公司模式）
const DEPT_TABLE = 'FWsv.ecology.dbo.HrmDepartment';  // 部门表
const EMP_TABLE  = 'FWsv.ecology.dbo.HrmResource';    // 人员表

// POST /api/org/sync-db - 从泛微OA数据库直连同步
export async function POST() {
  try {
    if (!WEAVER_DB_HOST || !WEAVER_DB_USER || !WEAVER_DB_PASSWORD || !WEAVER_DB_NAME) {
      return NextResponse.json(
        { success: false, error: '未配置泛微OA数据库连接，请在.env文件中设置 WEAVER_DB_HOST、WEAVER_DB_USER、WEAVER_DB_PASSWORD、WEAVER_DB_NAME' },
        { status: 400 }
      );
    }

    // 构建连接字符串
    const connectionString = `Server=${WEAVER_DB_HOST},${WEAVER_DB_PORT};Database=${WEAVER_DB_NAME};User Id=${WEAVER_DB_USER};Password=${WEAVER_DB_PASSWORD};Encrypt=false;TrustServerCertificate=true;`;

    await sql.connect(connectionString);

    // ── 1. 查询子公司（多公司模式）──────────────────────────────────
    let scRecords: any[] = [];
    try {
      const scResult = await sql.query(`
        SELECT id, subcompanyname as name, subcompanycode as code,
               supsubcomid as parentId, showorder as sort
        FROM ${SC_TABLE}
        WHERE (canceled IS NULL OR canceled = 0)
          AND id > 0
          AND subcompanyname IS NOT NULL
          AND LTRIM(RTRIM(subcompanyname)) != ''
          AND LOWER(LTRIM(RTRIM(subcompanyname))) NOT IN ('default', '默认')
      `);
      scRecords = scResult.recordset;
      console.log('[OA Sync] SubCompany count:', scRecords.length);
    } catch {
      console.log('[OA Sync] HrmSubcompany not available, single-company mode');
    }

    // ── 2a. 诊断查询：查出所有字段以确认"封存"使用哪个字段（首次运行后可移除）──
    try {
      const diagResult = await sql.query(`
        SELECT TOP 5 id, departmentname, canceled, subcompanyid1,
               ISNULL(CAST(outerdeptid AS NVARCHAR), 'N/A')  AS outerdeptid,
               ISNULL(CAST(depttype AS NVARCHAR), 'N/A')     AS depttype
        FROM ${DEPT_TABLE}
        WHERE departmentname IN (N'中山办事处', N'渠道销售部', N'IT部', N'内销部', N'市场运营部')
      `);
      console.log('[OA Sync] ── 封存部门字段诊断 ──', JSON.stringify(diagResult.recordset));
    } catch (e) {
      console.log('[OA Sync] 诊断查询失败（字段不存在属正常）:', (e as Error).message);
    }

    // ── 2. 查询部门：排除已撤销的 ────────────────────────────────────
    const deptResult = await sql.query(`
      SELECT id, departmentname as name, departmentcode as code,
             supdepid as parentId, subcompanyid1 as subcompanyid,
             showorder as sort, canceled
      FROM ${DEPT_TABLE}
      WHERE (canceled IS NULL OR canceled = 0)
    `);
    console.log('[OA Sync] Department count:', deptResult.recordset.length);

    // ── 3. 查询在职人员（工号从 cus_fielddata.field0，职位从 HrmJobTitles）────
    const empResult = await sql.query(`
      SELECT r.id, r.loginid, r.lastname as name,
             ISNULL(jt.jobtitlename, '') as position,
             r.departmentid, r.email, r.mobile, r.managerid, r.createdate as joinedAt, r.status,
             ISNULL(NULLIF(c.field0,''), ISNULL(NULLIF(r.workcode,''), CAST(r.id AS NVARCHAR))) as code,
             CAST(r.id AS NVARCHAR) as oaId
      FROM ${EMP_TABLE} r
      LEFT JOIN FWsv.ecology.dbo.cus_fielddata c
        ON r.id = c.id
        AND c.scopeid = -1
        AND c.scope = 'HrmCustomFieldByInfoType'
        AND c.field0 <> ''
      LEFT JOIN FWsv.ecology.dbo.HrmJobTitles jt
        ON r.jobtitle = jt.id
      WHERE (r.status IS NULL OR r.status IN (0, 1, 2, 3))
    `);
    console.log('[OA Sync] Employee count:', empResult.recordset.length);

    // ── 4. 构建 code 映射 ─────────────────────────────────────────────

    // 子公司 code：'SC_' + id，保证与部门 code 命名空间不冲突
    const scIdToCode = new Map<string, string>(
      scRecords.map((s: any) => [String(s.id), s.code || `SC_${s.id}`])
    );

    // 部门 code：优先用 departmentcode，否则用 id
    const deptIdToCode = new Map<string, string>(
      deptResult.recordset.map((d: any) => [String(d.id), d.code || String(d.id)])
    );

    // ── 5. 汇总部门列表（子公司 + 部门合并） ─────────────────────────
    const departments: Array<{ name: string; code: string; parentId: string | null; sort: number }> = [];

    // 5a. 子公司节点
    for (const sc of scRecords) {
      const code = scIdToCode.get(String(sc.id))!;
      const parentScCode = sc.parentId && sc.parentId !== '0' && sc.parentId !== 0
        ? scIdToCode.get(String(sc.parentId)) || null
        : null;
      departments.push({ name: sc.name, code, parentId: parentScCode, sort: sc.sort || 0 });
    }

    // 5b. 部门节点
    for (const d of deptResult.recordset) {
      const code = deptIdToCode.get(String(d.id))!;
      let parentId: string | null = null;

      if (d.parentId && d.parentId !== '0' && d.parentId !== 0) {
        // 有上级部门 → 父节点是部门
        parentId = deptIdToCode.get(String(d.parentId)) || null;
      } else if (scRecords.length > 0) {
        if (!d.subcompanyid || d.subcompanyid === 0 || d.subcompanyid === '0') {
          // 游离部门：在多公司模式下没有归属公司，跳过不导入
          console.log(`[OA Sync] 跳过游离部门（无公司归属）: ${d.name}`);
          continue;
        }
        // 根部门 + 多公司模式 → 父节点是子公司
        parentId = scIdToCode.get(String(d.subcompanyid)) || null;
      }
      // 单公司模式下根部门 parentId 保持 null

      departments.push({ name: d.name, code, parentId, sort: d.sort || 0 });
    }

    // 5c. 兜底：没有任何部门的员工放入"未分类"
    const defaultDeptCode = 'UNCATEGORIZED';
    if (!departments.some(d => d.code === defaultDeptCode)) {
      departments.push({ name: '未分类', code: defaultDeptCode, parentId: null, sort: 9999 });
    }
    deptIdToCode.set(defaultDeptCode, defaultDeptCode);

    // ── 6. 转换人员数据 ───────────────────────────────────────────────
    const employees = empResult.recordset.map((e: any) => {
      const deptCode = deptIdToCode.get(String(e.departmentid)) || defaultDeptCode;
      return {
        name: e.name,
        loginid: e.loginid || '',
        code: e.code,
        position: e.position || '',
        departmentCode: deptCode,
        email: e.email || '',
        phone: e.mobile || '',
        managerCode: e.managerid
          ? empResult.recordset.find((emp: any) => emp.id === e.managerid)?.code
          : undefined,
        joinedAt: e.joinedAt?.split('T')[0] || new Date().toISOString().split('T')[0],
        status: (e.status === null || e.status === undefined || [0, 1, 2, 3].includes(e.status))
          ? 'active' : 'resigned',
      };
    });

    console.log('[OA Sync] Total departments (incl. companies):', departments.length);
    console.log('[OA Sync] Total employees:', employees.length);

    // ── 7. 直接调用 storage 层同步（避免内部 HTTP 调用经过 middleware 鉴权）──

    const existingDepts = await getDepartments();
    const existingEmps  = await getEmployees();
    const deptCodeMap   = new Map(existingDepts.map(d => [d.code, d.id]));
    // 多 key 匹配：loginid > code，防止 code 变更导致重复创建
    const empCodeMap    = new Map(existingEmps.filter(e => e.code).map(e => [e.code, e.id]));
    const empLoginidMap = new Map(existingEmps.filter(e => e.loginid).map(e => [e.loginid!, e.id]));

    const deptResults = { created: 0, updated: 0, deleted: 0 };
    const empResults  = { created: 0, updated: 0, resigned: 0, deptChanged: 0, skipped: 0 };

    // 同步部门（先处理父级，再处理子级：按 parentId 排序，null 优先）
    const sortedDepts = [...departments].sort((a, b) => {
      if (!a.parentId && b.parentId) return -1;
      if (a.parentId && !b.parentId) return 1;
      return 0;
    });

    for (const dept of sortedDepts) {
      const existingId = deptCodeMap.get(dept.code);
      const parentDbId = dept.parentId ? deptCodeMap.get(dept.parentId) || null : null;
      if (existingId) {
        await updateDepartment(existingId, { name: dept.name, code: dept.code, parentId: parentDbId, sort: dept.sort || 0 });
        deptResults.updated++;
      } else {
        const created = await createDepartment({ name: dept.name, code: dept.code, parentId: parentDbId, sort: dept.sort || 0, status: 'active' });
        deptCodeMap.set(dept.code, created.id);
        deptResults.created++;
      }
    }

    // 全量同步：删除本地多余部门（级联：先删子孙再清员工）
    const externalDeptCodes = new Set(departments.map(d => d.code));
    // 只删顶层多余部门（子部门由级联处理，避免重复删除已被级联清理的项）
    const toRemoveCodes = existingDepts.filter(d => !externalDeptCodes.has(d.code));
    const toRemoveIds = new Set(toRemoveCodes.map(d => d.id));
    const topLevelRemove = toRemoveCodes.filter(d => !d.parentId || !toRemoveIds.has(d.parentId));
    for (const dept of topLevelRemove) {
      await deleteDepartmentCascade(dept.id);
      deptResults.deleted++;
    }

    // 同步员工
    for (const emp of employees) {
      const deptId = deptCodeMap.get(emp.departmentCode);
      if (!deptId) { empResults.skipped++; continue; }
      
      // 优先 loginid 匹配（稳定），其次 code（可能变更）
      const existingId = (emp.loginid ? empLoginidMap.get(emp.loginid) : undefined) || empCodeMap.get(emp.code);
      
      if (existingId) {
        const existing = existingEmps.find(e => e.id === existingId);
        if (existing && existing.departmentId !== deptId) empResults.deptChanged++;
        await updateEmployee(existingId, {
          name: emp.name, loginid: emp.loginid || undefined, code: emp.code,
          position: emp.position, departmentId: deptId,
          email: emp.email, phone: emp.phone,
          managerId: emp.managerCode ? empCodeMap.get(emp.managerCode) : undefined,
          status: 'active', joinedAt: emp.joinedAt || new Date().toISOString().split('T')[0],
        });
        empResults.updated++;
      } else {
        await createEmployee({
          name: emp.name, loginid: emp.loginid || undefined, code: emp.code,
          position: emp.position || '', departmentId: deptId,
          email: emp.email || '', phone: emp.phone || '',
          managerId: emp.managerCode ? empCodeMap.get(emp.managerCode) : undefined,
          status: 'active', joinedAt: emp.joinedAt || new Date().toISOString().split('T')[0],
        });
        empResults.created++;
      }
    }

    // 全量同步：OA 已不存在的员工标记离职
    const externalEmpCodes = new Set(employees.map(e => e.code));
    for (const emp of existingEmps) {
      if (emp.status !== 'resigned' && !externalEmpCodes.has(emp.code)) {
        await updateEmployee(emp.id, { status: 'resigned' });
        empResults.resigned++;
      }
    }

    return NextResponse.json({ success: true, data: { departments: deptResults, employees: empResults } });
  } catch (error) {
    console.error('DB Sync Error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
