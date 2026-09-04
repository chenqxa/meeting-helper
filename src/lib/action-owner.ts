import { getEmployees, getDepartments } from '@/storage/database/org-storage';
import { searchOAUsers } from './weaver-notify';

export interface ActionOwnerIdentityInput {
  owner?: string | null;
  ownerLoginId?: string | null;
  ownerOaId?: string | null;
  dept?: string | null;
}

export interface ActionOwnerIdentity {
  owner: string | null;
  ownerLoginId: string | null;
  ownerOaId: string | null;
  dept: string | null;
}

function normalize(value?: string | null): string {
  return (value || '').trim();
}

// 姓名 → 部门名（先查本地组织架构，查不到降级 OA 通讯录反查），找不到返回 null
export async function resolveDeptByName(name: string | null | undefined): Promise<string | null> {
  const n = normalize(name);
  if (!n) return null;
  try {
    const [employees, departments] = await Promise.all([getEmployees(), getDepartments()]);
    const deptName = new Map(departments.map(d => [d.id, d.name]));
    const emp = employees.find(e => e.name?.trim() === n && e.status === 'active');
    if (emp && emp.departmentId) return deptName.get(emp.departmentId) || null;
  } catch { /* ignore */ }
  // 本地组织架构缺失/未同步（如生产容器无 org-data.json）时，降级用 OA 通讯录反查部门
  try {
    const matches = await searchOAUsers(n);
    const exact = matches.find(u => u.lastname === n) || matches.find(u => u.lastname?.includes(n));
    if (exact?.departmentname) return exact.departmentname;
  } catch { /* ignore */ }
  return null;
}

export async function resolveActionOwnerIdentity(
  input: ActionOwnerIdentityInput
): Promise<ActionOwnerIdentity> {
  const owner = normalize(input.owner) || null;
  const ownerLoginId = normalize(input.ownerLoginId) || null;
  const ownerOaId = normalize(input.ownerOaId) || null;
  const dept = normalize(input.dept) || null;

  let resolved: ActionOwnerIdentity = {
    owner,
    ownerLoginId,
    ownerOaId,
    dept,
  };

  try {
    const employees = await getEmployees();
    const byLogin = new Map(
      employees
        .filter(emp => emp.loginid)
        .map(emp => [emp.loginid!.trim().toLowerCase(), emp])
    );
    const byName = new Map(
      employees
        .filter(emp => emp.name)
        .map(emp => [emp.name.trim(), emp])
    );
    const byOaId = new Map(
      employees
        .filter(emp => emp.oaId)
        .map(emp => [emp.oaId!.trim(), emp])
    );

    const localMatch =
      (resolved.ownerOaId && byOaId.get(resolved.ownerOaId)) ||
      (resolved.ownerLoginId && byLogin.get(resolved.ownerLoginId.toLowerCase())) ||
      (resolved.owner && byName.get(resolved.owner));

    if (localMatch) {
      // 本地命中时反查部门名（弥补原逻辑 dept 恒为 null 的缺陷）
      const localDept = await resolveDeptByName(localMatch.name || resolved.owner);
      resolved = {
        owner: resolved.owner || localMatch.name || null,
        ownerLoginId: resolved.ownerLoginId || localMatch.loginid || null,
        ownerOaId: resolved.ownerOaId || localMatch.oaId || null,
        dept: resolved.dept || localDept || null,
      };
    }
  } catch {
    // Ignore local org lookup failure and continue with fallback search.
  }

  if (resolved.ownerOaId && resolved.ownerLoginId && resolved.owner) {
    return resolved;
  }

  if (!resolved.owner) {
    return resolved;
  }

  try {
    const matches = await searchOAUsers(resolved.owner);
    if (!matches.length) return resolved;

    const exact =
      matches.find(user => user.lastname === resolved.owner) ||
      matches.find(user => user.lastname.includes(resolved.owner as string)) ||
      matches[0];

    return {
      owner: resolved.owner || exact.lastname || null,
      ownerLoginId: resolved.ownerLoginId || exact.loginid || null,
      ownerOaId: resolved.ownerOaId || exact.oaId || null,
      dept: resolved.dept || exact.departmentname || null,
    };
  } catch {
    return resolved;
  }
}
