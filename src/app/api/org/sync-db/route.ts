import { NextRequest, NextResponse } from 'next/server';
import sql from 'mssql';

// 泛微OA数据库配置（从环境变量读取）
const WEAVER_DB_HOST = process.env.WEAVER_DB_HOST || '';
const WEAVER_DB_PORT = process.env.WEAVER_DB_PORT || '1433';
const WEAVER_DB_USER = process.env.WEAVER_DB_USER || '';
const WEAVER_DB_PASSWORD = process.env.WEAVER_DB_PASSWORD || '';
const WEAVER_DB_NAME = process.env.WEAVER_DB_NAME || '';

// 泛微OA数据库表结构（根据实际情况调整）
const DEPT_TABLE = 'FWsv.ecology.dbo.HrmDepartment';  // 部门表
const EMP_TABLE = 'FWsv.ecology.dbo.HrmResource';     // 人员表

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

    // 查询部门（先不限制 canceled，查看数据情况）
    const deptResult = await sql.query(`
      SELECT id, departmentname as name, departmentcode as code,
             supdepid as parentId, departmentmark as description,
             showorder as sort, canceled
      FROM ${DEPT_TABLE}
    `);
    console.log('Raw departments count:', deptResult.recordset.length);
    console.log('Sample canceled values:', deptResult.recordset.slice(0, 5).map((d: any) => ({ id: d.id, name: d.name, canceled: d.canceled })));

    // 查询人员（获取所有人员，包括status为NULL的）
    const empResult = await sql.query(`
      SELECT id, lastname as name, workcode as code,
             jobtitle as position, departmentid, email, mobile,
             managerid, createdate as joinedAt, status
      FROM ${EMP_TABLE}
    `);
    console.log('Raw employees count:', empResult.recordset.length);

    // 构建部门ID到编码的映射（转换为字符串确保Map匹配，code为空时用id）
    const deptIdToCode = new Map(deptResult.recordset.map((d: any) => [String(d.id), d.code || String(d.id)]));
    console.log('Department ID to Code mapping:', Array.from(deptIdToCode.entries()).slice(0, 5));

    // 转换部门数据（如果 code 为空，使用 id 作为 code）
    const departments = deptResult.recordset.map((d: any) => ({
      name: d.name,
      code: d.code || String(d.id),  // 如果部门编码为空，使用 id
      parentId: d.parentId ? deptIdToCode.get(String(d.parentId)) || null : null,
      sort: d.sort || 0,
    }));

    // 添加默认部门（用于没有有效部门的员工）
    const defaultDeptCode = 'UNCATEGORIZED';
    const hasDefaultDept = departments.some(d => d.code === defaultDeptCode);
    if (!hasDefaultDept) {
      departments.push({
        name: '未分类',
        code: defaultDeptCode,
        parentId: null,
        sort: 9999,
      });
    }
    deptIdToCode.set(defaultDeptCode, defaultDeptCode);

    // 转换人员数据
    const employees = empResult.recordset.map((e: any) => {
      const deptCode = deptIdToCode.get(String(e.departmentid));
      return {
        name: e.name,
        code: e.code,
        position: e.position || '',
        departmentCode: deptCode || defaultDeptCode,  // 没有部门的员工归入"未分类"
        email: e.email || '',
        phone: e.mobile || '',
        managerCode: e.managerid ? empResult.recordset.find((emp: any) => emp.id === e.managerid)?.code : undefined,
        joinedAt: e.joinedAt?.split('T')[0] || new Date().toISOString().split('T')[0],
        status: e.status === null || e.status === undefined || e.status === 0 || e.status === 1 || e.status === 2 ? 'active' : 'inactive', // NULL/0/1/2:在职, 其他:离职/封存
      };
    });

    // mssql v12 自动管理连接池，无需手动关闭
    // await sql.close();

    // 调试日志
    console.log('Departments count:', departments.length);
    console.log('Employees count:', employees.length);
    console.log('Sample department:', departments[0]);
    console.log('Sample employee:', employees[0]);
    console.log('Employees without departmentCode:', employees.filter((e: any) => !e.departmentCode).length);

    // 转发到同步接口
    const syncRes = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:5000'}/api/org/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'full',
        removeMissing: true,
        departments,
        employees,
      }),
    });
    const syncResult = await syncRes.json();

    return NextResponse.json(syncResult);
  } catch (error) {
    console.error('DB Sync Error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
