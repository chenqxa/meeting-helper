# 看板权限体系（角色级 + 人员级）需求方案

> 版本：v1.0（待评审）
> 创建：2026-09-06
> 涉及看板：周例会 `/weekly-board`、月度 `/monthly-board`、产销会 `/production-board`

---

## 一、背景

三块看板目前共用一个权限点 `canViewBoard`（admin/manager/secretary），存在三个问题：
1. **不能按看板类型区分**：要么全开、要么全关，无法做到"secretary 只能看周例会"
2. **不能按人授权**：某个员工需要看某块看板时，只能改整个角色的权限（影响同类所有人）
3. **页面无强制拦截**：靠侧边栏隐藏 + 数据过滤兜底，直接输 URL 仍能打开页面看到残缺数据

## 二、目标

| 层 | 能力 | 示例 |
|----|------|------|
| **角色级默认** | 每类角色配置默认能看到哪几块看板 | secretary 默认只看周例会 |
| **人员级覆盖** | 单独给某个人开/关某块看板 | 沈意玲（employee）单独开周例会看板 |
| **页面强制拦截** | 无权限的人打开 URL 显示"无权访问" | 张三没月度看板权限 → 打开显示提示页 |

## 三、权限判断逻辑

```
用户能否看某块看板（优先级从高到低）：
  ① 系统管理员（hyzs_system_admins）→ 恒可看
  ② 人员级有配置（hyzs_board_permissions）→ 按配置
  ③ 无人员级配置 → 按角色默认（hyzs_role_permissions 中 canViewXxxBoard）
```

## 四、数据模型

### 4.1 角色级（复用现有 `hyzs_role_permissions` 表）

新增 3 个权限点：

| 权限点 | 控制页面 | admin | manager | secretary | employee |
|--------|---------|-------|---------|-----------|----------|
| `canViewWeeklyBoard` | /weekly-board | ✓ | ✓ | ✓ | ✗ |
| `canViewMonthlyBoard` | /monthly-board | ✓ | ✓ | ✓ | ✗ |
| `canViewProductionBoard` | /production-board | ✓ | ✓ | ✓ | ✗ |

- 复用现有权限矩阵 UI（/org → 权限管理 tab），矩阵自动多 3 列
- 保留旧 `canViewBoard` 作为总开关（3 个新权限点任一开启时自动有 `canViewBoard`）

### 4.2 人员级（新增 `hyzs_board_permissions` 表）

| 字段 | 类型 | 说明 |
|------|------|------|
| loginid | NVARCHAR(64) PK | 员工 OA 登录名 |
| board_key | NVARCHAR(20) PK | `weekly` / `monthly` / `production` |
| allowed | BIT | 1=允许 / 0=禁止 |
| updated_at | NVARCHAR(30) | 更新时间 |
| updated_by | NVARCHAR(64) | 操作人 |

联合主键 `(loginid, board_key)`；无记录 = 无覆盖（按角色默认走）。

## 五、前台配置 UI

### 5.1 角色级（复用现有权限矩阵）

/org → 权限管理 tab 的权限矩阵表格自动多 3 列，系统管理员点击格子即可开/关（现有逻辑，零改动或微调）。

### 5.2 人员级（新增，放在 /org 角色管理 tab 下方或独立 tab）

```
┌─────────────────────────────────────────────────┐
│  🎛️ 看板人员授权                                 │
│  说明：人员授权优先于角色默认权限                    │
├─────────────────────────────────────────────────┤
│  选择员工：[搜索或选择员工 ▼]                       │
│                                                 │
│  ☑ 周例会看板    ☐ 月度看板    ☐ 产销会看板         │
│                                                 │
│  [保存授权]  [清除（恢复角色默认）]                  │
├─────────────────────────────────────────────────┤
│  已授权人员列表：                                  │
│  ┌────────┬──────┬──────┬──────┬────────┐       │
│  │ 员工    │ 周例会 │ 月度  │ 产销会 │ 操作   │       │
│  ├────────┼──────┼──────┼──────┼────────┤       │
│  │ 沈意玲  │  ✓   │  —  │  —  │ 编辑/清除│       │
│  │ 张三    │  ✓   │  ✓  │  —  │ 编辑/清除│       │
│  └────────┴──────┴──────┴──────┴────────┘       │
│  （— 表示未配置，按角色默认走）                       │
└─────────────────────────────────────────────────┘
```

- 仅系统管理员可操作（与权限矩阵一致）
- 搜索员工复用现有 `/api/org/employees` 接口
- 保存后即时生效（清缓存）

## 六、页面级强制拦截

三个看板页面（客户端组件）在渲染前做权限校验：

```typescript
// 页面顶层
const [denied, setDenied] = useState(false);
useEffect(() => {
  fetch('/api/board-permissions/check?key=weekly')
    .then(r => r.json())
    .then(j => { if (!j.success || !j.data?.allowed) setDenied(true); });
}, []);
if (denied) return <无权访问提示页 />;
```

**同时**在数据 API 层（或 middleware）加服务端校验，防止绕过前端直接调 API。

## 七、接口设计

| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| GET | `/api/board-permissions/check?key=weekly` | 当前用户能否看某块看板 | 登录即可 |
| GET | `/api/board-permissions` | 全部人员授权列表 | 系统管理员 |
| POST | `/api/board-permissions` | 设置某人某看板 allowed | 系统管理员 |
| DELETE | `/api/board-permissions?loginid=xx` | 清除某人全部人员级配置（恢复角色默认） | 系统管理员 |

**check 接口判断逻辑**：
```
① isSystemAdmin(loginid) → true
② hyzs_board_permissions 有记录 → allowed 值
③ 否则 → hasPermission(loginid, 'canViewWeeklyBoard')
```

## 八、侧边栏菜单

三块看板入口分别绑定对应权限点：

```
周例会看板 → canViewWeeklyBoard
月度看板   → canViewMonthlyBoard
产销会看板 → canViewProductionBoard
```

侧边栏过滤逻辑改为：先查人员级 → 无则查角色级（与 check 接口一致）。

## 九、权限与安全

| 操作 | 权限要求 |
|------|---------|
| 查看/打开看板 | 人员级 or 角色级对应权限点 |
| 修改角色级权限矩阵 | 系统管理员（现有逻辑） |
| 人员级授权/清除 | 系统管理员 |
| 调用看板数据 API | 与页面权限一致（服务端校验） |

## 十、改动清单

| 文件 | 改动 |
|------|------|
| `src/lib/roles.ts` | RoleGuard + PERMISSION_MATRIX 加 3 个权限点 |
| `src/storage/database/role-permission-storage.ts` | 种子数据加 3 个权限点（admin/manager/secretary 全开） |
| **新增** `src/storage/database/board-permission-storage.ts` | `hyzs_board_permissions` 表 + CRUD |
| **新增** `src/app/api/board-permissions/route.ts` | GET 列表 / POST 设置 / DELETE 清除 |
| **新增** `src/app/api/board-permissions/check/route.ts` | 当前用户权限检查 |
| `src/app/org/page.tsx` | 角色管理 tab 下方加"看板人员授权"面板（或独立 tab） |
| `src/components/layout/dashboard-layout.tsx` | 侧边栏三块看板分别用新权限点 + 人员级查询 |
| `src/app/weekly-board/page.tsx` | 页面级权限校验 + 无权提示页 |
| `src/app/monthly-board/page.tsx` | 同上 |
| `src/app/production-board/page.tsx` | 同上 |

## 十一、验收标准

- [ ] 角色权限矩阵中出现 3 列新权限点，系统管理员可开/关
- [ ] 人员授权面板：搜索员工 → 勾选看板 → 保存后即时生效
- [ ] employee 角色默认看不到三块看板（侧边栏隐藏 + URL 拦截）
- [ ] 单独给某个 employee 开周例会看板 → 该员工能看到周例会看板
- [ ] 单独给某个 manager 关掉月度看板 → 该 manager 看不到月度看板
- [ ] 清除人员级配置 → 恢复角色默认行为
- [ ] 系统管理员恒可看所有看板
- [ ] 无权限的人直接输 URL → 显示"无权访问"（不是空白或报错）
- [ ] 不影响其他页面/功能

## 十二、工期估计

| 项 | 工期 |
|----|------|
| 权限点定义 + 角色级种子 + 存储层 | 0.5 天 |
| 人员级存储 + API（含 check） | 0.5 天 |
| 前台 UI（授权面板 + 侧边栏 + 三页拦截） | 0.5 天 |
| 自测 + 文档 | 0.5 天 |
| **合计** | **约 2 天** |
