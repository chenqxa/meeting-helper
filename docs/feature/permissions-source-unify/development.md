# 权限点同源·侧栏看板入口即时生效

> 涉及：侧边栏菜单显隐链路 vs 看板页面拦截链路
> 触发场景：管理员在 /org/board-permission-panel 给员工单独开「月度看板」权限后，侧边栏没有出现入口（但直接访问 URL 可进）

## 根因

两套权限判断走不同表，互不同源：

| 链路 | 接口 | 数据源 |
|------|------|--------|
| 侧栏菜单显隐 | /api/permissions/mine | 只查 hyzs_role_permissions（角色级）+ RoleGuard 兜底 |
| 看板页面拦截 | /api/board-permissions/check | 系统管理员 > hyzs_board_permissions（人员级）> 角色级 > 兜底 |

结果：管理员给某人在 hyzs_board_permissions 加了 monthly=true，链路 ② 放行，但链路 ① 没读这张表，侧栏菜单仍然 false。

附加问题：dashboard-layout 用 sessionStorage['auth_perms'] 缓存权限集，TTL = 整个浏览器会话；管理员改了，用户不重新登录 / 强制刷新就还是旧值。

## 修复

1. /api/permissions/mine 新增对看板权限点（canViewWeeklyBoard / canViewMonthlyBoard / canViewProductionBoard）走 canViewBoard 综合判断，与 /api/board-permissions/check 完全同源。
2. /org/board-permission-panel 保存/清除后派发 'permissions-changed' 自定义事件；dashboard-layout 监听并清 sessionStorage 后立即重拉 /api/permissions/mine → 侧栏入口即时出现/消失，无需重新登录或清缓存。
3. board-permission-storage.ts 暴露 BOARD_KEY_TO_PERM 常量供 /api/permissions/mine 复用，避免硬编码重复。

## 改动文件

| 文件 | 改动 |
|------|------|
| src/app/api/permissions/mine/route.ts | 看板权限点改走 canViewBoard；其他权限点保留原行为 |
| src/storage/database/board-permission-storage.ts | export const BOARD_KEY_TO_PERM |
| src/components/layout/dashboard-layout.tsx | useEffect 监听 'permissions-changed' 事件，清缓存重拉 |
| src/app/org/board-permission-panel.tsx | save / clearPerson 后 dispatch 'permissions-changed' |

## 验证

- typecheck：pnpm exec tsc --noEmit 通过
- 手工用例：
  1. admin 把廖新平月度看板关掉 → 廖新平重新加载 /monthly-board（不重新登录）→ 侧栏入口消失 + 页面显示「无权访问」
  2. admin 再勾上 → 廖新平浏览器收到事件 → 侧栏入口即时出现，无需 F5
