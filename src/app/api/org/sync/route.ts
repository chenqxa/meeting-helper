import { NextRequest, NextResponse } from 'next/server';
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
  removeMissing?: boolean;     // 是否删除本地不存在的外部数据（仅全量同步）
}

// POST /api/org/sync - 泛微OA组织架构同步
export async function POST(request: NextRequest) {
  try {
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
    const empResults: { created: number; updated: number; deleted: number } = { created: 0, updated: 0, deleted: 0 };
    
    for (const emp of employees) {
      const deptId = deptCodeMap.get(emp.departmentCode);
      if (!deptId) {
        console.warn(`员工 ${emp.name} 的部门 ${emp.departmentCode} 不存在，跳过`);
        continue;
      }

      const existingId = empCodeMap.get(emp.code);
      
      if (existingId) {
        // 更新
        await updateEmployee(existingId, {
          name: emp.name,
          code: emp.code,
          position: emp.position,
          departmentId: deptId,
          email: emp.email,
          phone: emp.phone,
          managerId: emp.managerCode ? empCodeMap.get(emp.managerCode) : undefined,
          status: (emp.status === 'active' || emp.status === 'inactive' || emp.status === 'resigned') ? emp.status : 'active',
          joinedAt: emp.joinedAt || new Date().toISOString().split('T')[0],
        });
        empResults.updated++;
      } else {
        // 创建
        await createEmployee({
          name: emp.name,
          code: emp.code,
          position: emp.position || '',
          departmentId: deptId,
          email: emp.email || '',
          phone: emp.phone || '',
          managerId: emp.managerCode ? empCodeMap.get(emp.managerCode) : undefined,
          status: (emp.status === 'active' || emp.status === 'inactive' || emp.status === 'resigned') ? emp.status : 'active',
          joinedAt: emp.joinedAt || new Date().toISOString().split('T')[0],
        });
        empResults.created++;
      }
    }

    // 全量同步时删除本地不存在的外部员工
    if (type === 'full' && removeMissing) {
      const externalCodes = new Set(employees.map(e => e.code));
      for (const emp of existingEmps) {
        if (!externalCodes.has(emp.code)) {
          await deleteEmployee(emp.id);
          empResults.deleted++;
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
