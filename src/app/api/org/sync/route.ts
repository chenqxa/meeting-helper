import { NextRequest, NextResponse } from 'next/server';

import { guardWrite } from '@/lib/api-guard';
import {
  createDepartment, updateDepartment, deleteDepartment, getDepartments,
  createEmployee, updateEmployee, deleteEmployee, getEmployees
} from '@/storage/database/org-storage';

// 泛微OA部门数据格式（示例）
interface WeaverDept {
  id?: string;           // 泛微部门ID（可选，用于映射）
  name: string;          // 部门名称
  code: string;          // 部门编码
  parentId?: string;     // 上级部门ID（泛微ID或本地ID）
  managerId?: string;    // 部门负责人ID
  description?: string;  // 部门描述
  sort?: number;         // 排序
}

// 泛微OA员工数据格式（示例）
interface WeaverEmp {
  id?: string;           // 泛微员工ID（可选，用于映射）
  name: string;          // 姓名
  loginid?: string;      // OA 登录账号
  code: string;          // 工号
  position?: string;     // 职位
  departmentCode: string; // 部门编码（用于关联部门）
  email?: string;        // 邮箱
  phone?: string;        // 手机
  managerCode?: string;  // 直属领导工号
  joinedAt?: string;     // 入职日期
  status?: string;       // 状态
}

// 同步请求体
interface SyncRequest {
  type: 'full' | 'incremental';  // 同步类型：全量/增量
  departments?: WeaverDept[];    // 部门数据
  employees?: WeaverEmp[];       // 员工数据
  removeMissing?: boolean;       // 是否处理本地不在外部数据中的记录（全量同步时生效，员工标记离职而非删除）
}

// POST /api/org/sync - 泛微OA组织架构同步
export async function POST(request: NextRequest) {
  try {
    // 内部同步通道（x-sync-token 正确）直接放行；普通请求需 admin
    const syncToken = request.headers.get('x-sync-token');
    const secret = process.env.INTERNAL_SYNC_SECRET;
    const isInternal = !!(secret && syncToken === secret);
    if (!isInternal) {
      const guard = await guardWrite('admin');
      if (!guard.ok) return guard.response;
    }

    const body: SyncRequest = await request.json();
    const { type = 'incremental', departments = [], employees = [], removeMissing = false } = body;

    // 获取现有数据（用于映射和冲突检测）
    const existingDepts = await getDepartments();
    const existingEmps = await getEmployees();
    
    // 建立映射：code -> id
    const deptCodeMap = new Map(existingDepts.map(d => [d.code, d.id]));
    const empCodeMap = new Map(existingEmps.map(e => [e.code, e.id]));

    // 部门映射：泛微ID -> 本地ID
    const weaverDeptIdMap = new Map<string, string>();

    // 同步部门
    const deptResults: { created: number; updated: number; deleted: number } = { created: 0, updated: 0, deleted: 0 };
    
    for (const dept of departments) {
      const existingId = deptCodeMap.get(dept.code);
      
      if (existingId) {
        // 更新
        await updateDepartment(existingId, {
          name: dept.name,
          code: dept.code,
          parentId: dept.parentId ? deptCodeMap.get(dept.parentId) || null : null,
          managerId: dept.managerId,
          description: dept.description,
          sort: dept.sort || 0,
        });
        deptResults.updated++;
      } else {
        // 创建
        const created = await createDepartment({
          name: dept.name,
          code: dept.code,
          parentId: dept.parentId ? deptCodeMap.get(dept.parentId) || null : null,
          managerId: dept.managerId,
          description: dept.description,
          sort: dept.sort || 0,
          status: 'active',
        });
        deptCodeMap.set(dept.code, created.id);
        deptResults.created++;
      }

      // 记录泛微ID映射
      if (dept.id) {
        weaverDeptIdMap.set(dept.id, deptCodeMap.get(dept.code)!);
      }
    }

    // 全量同步时删除本地不存在的外部数据
    if (type === 'full' && removeMissing) {
      const externalCodes = new Set(departments.map(d => d.code));
      for (const dept of existingDepts) {
        if (!externalCodes.has(dept.code)) {
          await deleteDepartment(dept.id);
          deptResults.deleted++;
          deptCodeMap.delete(dept.code);
        }
      }
    }

    // 同步员工
    const empResults: { created: number; updated: number; resigned: number; deptChanged: number; skipped: number } = { created: 0, updated: 0, resigned: 0, deptChanged: 0, skipped: 0 };
    
    for (const emp of employees) {
      const deptId = deptCodeMap.get(emp.departmentCode);
      if (!deptId) {
        console.warn(`员工 ${emp.name} 的部门 ${emp.departmentCode} 不存在，已归入未分类部门`);
        empResults.skipped++;
        continue;
      }

      const existingId = empCodeMap.get(emp.code);
      
      if (existingId) {
        // 更新 — 检测是否换部门
        const existing = existingEmps.find(e => e.id === existingId);
        const deptChanged = existing && existing.departmentId !== deptId;
        await updateEmployee(existingId, {
          name: emp.name,
          loginid: emp.loginid || undefined,
          code: emp.code,
          position: emp.position,
          departmentId: deptId,
          email: emp.email,
          phone: emp.phone,
          managerId: emp.managerCode ? empCodeMap.get(emp.managerCode) : undefined,
          status: 'active',
          joinedAt: emp.joinedAt || new Date().toISOString().split('T')[0],
        });
        if (deptChanged) empResults.deptChanged++;
        empResults.updated++;
      } else {
        // 新员工
        await createEmployee({
          name: emp.name,
          loginid: emp.loginid || undefined,
          code: emp.code,
          position: emp.position || '',
          departmentId: deptId,
          email: emp.email || '',
          phone: emp.phone || '',
          managerId: emp.managerCode ? empCodeMap.get(emp.managerCode) : undefined,
          status: 'active',
          joinedAt: emp.joinedAt || new Date().toISOString().split('T')[0],
        });
        empResults.created++;
      }
    }

    // 全量同步：本地有但OA不再有的员工 → 标记离职（不物理删除，保留历史）
    if (type === 'full' && removeMissing) {
      const externalCodes = new Set(employees.map(e => e.code));
      for (const emp of existingEmps) {
        if (emp.status !== 'resigned' && !externalCodes.has(emp.code)) {
          await updateEmployee(emp.id, { status: 'resigned' });
          empResults.resigned++;
        }
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        departments: deptResults,
        employees: empResults,
      },
    });
  } catch (error) {
    console.error('Sync Error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
