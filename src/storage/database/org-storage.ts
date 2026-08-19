// 组织架构存储 — 仿泛微OA
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

// ── 数据模型 ──

export interface Employee {
  id: string;
  name: string;              // 姓名
  loginid?: string;          // OA 登录账号（loginid）
  oaId?: string;             // OA 系统中的数字 ID (如 149)
  code: string;              // 工号
  position: string;          // 职位
  departmentId: string;      // 所属部门ID
  email?: string;            // 邮箱
  phone?: string;            // 手机
  managerId?: string;       // 直属领导ID
  status: 'active' | 'inactive' | 'resigned';
  joinedAt: string;          // 入职日期
  createdAt: string;
  updatedAt: string;
}

export interface Department {
  id: string;
  name: string;              // 部门名称
  code: string;              // 部门编码
  parentId: string | null;   // 上级部门ID（根部门为null）
  managerId?: string;       // 部门负责人ID
  description?: string;      // 部门描述
  sort: number;              // 排序号
  status: 'active' | 'inactive';
  createdAt: string;
  updatedAt: string;
}

export interface OrgNode {
  type: 'department' | 'employee';
  id: string;
  name: string;
  departmentId?: string;
  parentId?: string | null;
  children?: OrgNode[];
  // 部门特有字段
  code?: string;
  managerId?: string;  // 部门负责人或员工直属领导
  sort?: number;
  // 员工特有字段
  position?: string;
  email?: string;
  phone?: string;
  status?: string;
}

// ── 存储 ──

const ORG_FILE = join(process.cwd(), 'org-data.json');

interface OrgState {
  departments: Department[];
  employees: Employee[];
  nextDeptId: number;
  nextEmpId: number;
}

const GLOBAL_KEY = '__org_storage__';

function getState(): OrgState {
  if (!(globalThis as any)[GLOBAL_KEY]) {
    (globalThis as any)[GLOBAL_KEY] = { departments: [], employees: [], nextDeptId: 1, nextEmpId: 1 };
    loadFromFile();
  }
  return (globalThis as any)[GLOBAL_KEY];
}

function loadFromFile() {
  try {
    if (existsSync(ORG_FILE)) {
      const data = readFileSync(ORG_FILE, 'utf-8');
      const parsed = JSON.parse(data);
      const state = getState();
      state.departments = parsed.departments || [];
      state.employees = parsed.employees || [];
      state.nextDeptId = parsed.nextDeptId || 1;
      state.nextEmpId = parsed.nextEmpId || 1;
    }
  } catch (err) {
    console.error('Failed to load org data:', err);
  }
}

function saveToFile() {
  try {
    const state = getState();
    writeFileSync(ORG_FILE, JSON.stringify(state, null, 2));
  } catch (error) {
    console.error('Failed to save org data:', error);
  }
}

function freshRead(): OrgState {
  try {
    if (existsSync(ORG_FILE)) {
      const data = readFileSync(ORG_FILE, 'utf-8');
      const parsed = JSON.parse(data);
      const state = getState();
      state.departments = parsed.departments || [];
      state.employees = parsed.employees || [];
      state.nextDeptId = parsed.nextDeptId || 1;
      state.nextEmpId = parsed.nextEmpId || 1;
    }
  } catch { /* use in-memory fallback */ }
  return getState();
}

// ── 部门 CRUD ──

export const createDepartment = async (data: Omit<Department, 'id' | 'createdAt' | 'updatedAt'>): Promise<Department> => {
  const state = freshRead();
  const dept: Department = {
    ...data,
    id: `D${state.nextDeptId.toString().padStart(4, '0')}`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  state.departments.push(dept);
  state.nextDeptId++;
  saveToFile();
  return dept;
};

export const getDepartments = async (): Promise<Department[]> => {
  const state = freshRead();
  return state.departments.sort((a, b) => a.sort - b.sort);
};

export const getDepartmentById = async (id: string): Promise<Department | null> => {
  const state = freshRead();
  return state.departments.find(d => d.id === id) || null;
};

export const updateDepartment = async (id: string, data: Partial<Department>): Promise<Department | null> => {
  const state = freshRead();
  const index = state.departments.findIndex(d => d.id === id);
  if (index === -1) return null;
  state.departments[index] = {
    ...state.departments[index],
    ...data,
    updatedAt: new Date().toISOString(),
  };
  saveToFile();
  return state.departments[index];
};

export const deleteDepartment = async (id: string): Promise<boolean> => {
  const state = freshRead();
  const index = state.departments.findIndex(d => d.id === id);
  if (index === -1) return false;
  // 检查是否有子部门
  const hasChildren = state.departments.some(d => d.parentId === id);
  if (hasChildren) return false;
  // 检查是否有员工
  const hasEmployees = state.employees.some(e => e.departmentId === id);
  if (hasEmployees) return false;
  state.departments.splice(index, 1);
  saveToFile();
  return true;
};

// 级联删除部门：先递归删子部门，再将员工标记离职，最后删本部门
export const deleteDepartmentCascade = async (id: string): Promise<void> => {
  const state = freshRead();
  // 递归收集所有子孙部门 ID（从叶子到根）
  const collectDescendants = (parentId: string): string[] => {
    const children = state.departments.filter(d => d.parentId === parentId).map(d => d.id);
    return [...children.flatMap(collectDescendants), ...children];
  };
  const toDelete = [...collectDescendants(id), id];
  const toDeleteSet = new Set(toDelete);
  // 员工标记离职（不物理删除，保留历史）
  state.employees.forEach(e => {
    if (e.departmentId && toDeleteSet.has(e.departmentId)) {
      e.status = 'resigned';
      e.departmentId = undefined as unknown as string;
      e.updatedAt = new Date().toISOString();
    }
  });
  // 从叶子到根依次删除部门
  state.departments = state.departments.filter(d => !toDeleteSet.has(d.id));
  saveToFile();
};

// ── 员工 CRUD ──

export const createEmployee = async (data: Omit<Employee, 'id' | 'createdAt' | 'updatedAt'>): Promise<Employee> => {
  const state = freshRead();
  const emp: Employee = {
    ...data,
    id: `E${state.nextEmpId.toString().padStart(4, '0')}`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  state.employees.push(emp);
  state.nextEmpId++;
  saveToFile();
  return emp;
};

export const getEmployees = async (departmentId?: string): Promise<Employee[]> => {
  const state = freshRead();
  let emps = state.employees;
  if (departmentId) {
    emps = emps.filter(e => e.departmentId === departmentId);
  }
  return emps.filter(e => e.status === 'active');
};

export const getEmployeeById = async (id: string): Promise<Employee | null> => {
  const state = freshRead();
  return state.employees.find(e => e.id === id) || null;
};

export const updateEmployee = async (id: string, data: Partial<Employee>): Promise<Employee | null> => {
  const state = freshRead();
  const index = state.employees.findIndex(e => e.id === id);
  if (index === -1) return null;
  state.employees[index] = {
    ...state.employees[index],
    ...data,
    updatedAt: new Date().toISOString(),
  };
  saveToFile();
  return state.employees[index];
};

export const deleteEmployee = async (id: string): Promise<boolean> => {
  const state = freshRead();
  const index = state.employees.findIndex(e => e.id === id);
  if (index === -1) return false;
  state.employees.splice(index, 1);
  saveToFile();
  return true;
};

// ── 树形结构构建 ──

export const getOrgTree = async (): Promise<OrgNode[]> => {
  const state = freshRead();
  const deptMap = new Map<string, Department>();
  state.departments.forEach(d => deptMap.set(d.id, d));
  
  const empMap = new Map<string, Employee[]>();
  state.employees.filter(e => e.status === 'active').forEach(e => {
    if (!empMap.has(e.departmentId)) empMap.set(e.departmentId, []);
    empMap.get(e.departmentId)!.push(e);
  });

  function buildTree(parentId: string | null): OrgNode[] {
    const depts = state.departments.filter(d => d.parentId === parentId && d.status === 'active').sort((a, b) => a.sort - b.sort);
    return depts.map(dept => {
      const node: OrgNode = {
        type: 'department',
        id: dept.id,
        name: dept.name,
        code: dept.code,
        parentId: dept.parentId,
        managerId: dept.managerId,
        sort: dept.sort,
        children: buildTree(dept.id),
      };
      // 添加员工
      const emps = empMap.get(dept.id) || [];
      emps.forEach(emp => {
        node.children!.push({
          type: 'employee',
          id: emp.id,
          name: emp.name,
          departmentId: emp.departmentId,
          position: emp.position,
          email: emp.email,
          phone: emp.phone,
          managerId: emp.managerId,
          status: emp.status,
        });
      });
      return node;
    });
  }

  return buildTree(null);
};

// ── 搜索 ──

export const searchEmployees = async (keyword: string): Promise<Employee[]> => {
  const state = freshRead();
  const kw = keyword.toLowerCase();
  return state.employees.filter(e =>
    e.status === 'active' &&
    (e.name.toLowerCase().includes(kw) ||
     e.code.toLowerCase().includes(kw) ||
     e.position?.toLowerCase().includes(kw) ||
     e.email?.toLowerCase().includes(kw))
  );
};

// ── 清空所有数据 ──

export const clearAllData = async (): Promise<void> => {
  const state = getState();
  state.departments = [];
  state.employees = [];
  writeFileSync(ORG_FILE, JSON.stringify(state, null, 2), 'utf-8');
};
