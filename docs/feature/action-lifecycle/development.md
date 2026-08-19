# 行动项闭环与多端支持 开发文档

> 版本：v1.0  ·  对应需求：`requirement.md`
> 技术栈：Next.js 16 / React 19 / TypeScript 5 / shadcn/ui / Tailwind 4 / mssql

---

## 一、技术栈与选型

| 层 | 现有 | 本次改动 |
|----|------|---------|
| 前端 Web | Next.js App Router | 修复 viewport + 响应式（方案A） |
| 推送 | `lib/chat-client.ts`（企微应用消息） | 复用，方向扩展为「→ proposer」 |
| 数据库 | SQL Server（`hyzs_*`） | 可能新增 `hyzs_notifications` 表、`verify_status` 列 |
| 移动端小程序 | 无 | 新工程：Taro 4 + React（方案C，复用 Web API） |
| AI 提取 | `lib/minutes-derive.ts` | prompt 增加 proposer 提取（方案1-A） |

---

## 二、改动点清单（按问题划分）

### 2.1 问题1：提出人识别

| 文件 | 改动 | 关联方案 |
|------|------|---------|
| `lib/minutes-derive.ts` 或对应 prompt | prompt 增加「识别提出人，从转写找"X提出/按X意见"」 | 1-A |
| `app/api/meetings/[id]/generate/route.ts:77-96` | 去掉 organizer 兜底，proposer 默认 null | 1-B |
| `app/meeting/[id]/page.tsx:1352-1354` | 同上去兜底 | 1-B |
| `app/batch/[id]/page.tsx` | 新增 + 编辑表单加 proposer OAUserPicker | 1-B |
| `app/kanban/page.tsx` | 编辑对话框 + 批量新增加 proposer | 1-B |
| `app/tracking/page.tsx` | 转派表单加 proposer | 1-B |

**proposer 字段底层数据结构已就绪**（`action-storage.ts:19-21`），无需迁移。

---

### 2.2 问题2：完成闭环

按选定方案实施，以下为全部方案的开发点：

#### 方案1：企微消息通知（复用现有能力，改动最小）

| 文件 | 改动 |
|------|------|
| `app/api/actions/[id]/route.ts` PUT 分支 | 当 `status→done` 时，调用通知函数 |
| `lib/notify-proposer.ts`（新增） | 封装：查 action.proposerOaId → 组装消息文本 → 调 `batchSendOAUserMessage` |

核心代码示意：
```ts
// api/actions/[id]/route.ts PUT 内，updateActionItem 后
if (newStatus === 'done' && action.proposerOaId && action.proposerOaId !== action.ownerOaId) {
  await notifyProposer({ action, completionNote, evidenceFiles });
}
```

#### 方案2：站内消息中心（新建表+页面）

| 文件 | 改动 |
|------|------|
| `storage/database/notification-storage.ts`（新增） | `hyzs_notifications` 表 CRUD |
| `app/api/notifications/route.ts`（新增） | GET 列表 / PATCH 标记已读 |
| `app/notifications/page.tsx`（新增） | 消息列表页 |
| `components/layout/dashboard-layout.tsx` | 侧边栏加「消息中心」+未读角标 |
| `api/actions/[id]/route.ts` | done 时同时写一条 notification |

表结构：
```sql
CREATE TABLE hyzs_notifications (
  id NVARCHAR(64) PRIMARY KEY,
  user_login_id NVARCHAR(64),    -- 接收人（proposer）
  action_id NVARCHAR(64),
  type NVARCHAR(32),             -- 'completion_report'
  content NVARCHAR(MAX),
  read BIT DEFAULT 0,
  created_at DATETIME DEFAULT GETDATE()
);
```

#### 方案3：提出人验收（新增状态机）

| 文件 | 改动 |
|------|------|
| `action-storage.ts` | ActionItem 加 `verifyStatus?: 'submitted'|'accepted'|'rejected'` + ensureColumn 迁移 |
| `app/api/actions/[id]/verify/route.ts`（新增） | POST：proposer 提交验收结果 |
| `app/mytasks/page.tsx` | 完成按钮文案改「提交验收」，状态置 submitted |
| `app/propose/page.tsx`（新增「我提出的」） | proposer 视角列表 + 通过/打回按钮 |

状态流转：
```
pending → in_progress → submitted → accepted（闭环）
                                  → rejected → in_progress
```

#### 方案4：企微消息 + 验收

= 方案1 + 方案3，两套改动叠加。验收结果（accepted/rejected）同样触发企微通知对侧。

#### 方案5：分期实施

按需求文档「五、综合实施建议」的 P0→P3 顺序逐期开发。

---

### 2.3 问题3：移动端

#### 方案A：响应式 Web 修复（必做基础）

| 文件 | 改动 |
|------|------|
| `app/layout.tsx` | 加 `export const viewport: Viewport = { width:'device-width', initialScale:1, maximumScale:1 }` |
| `components/layout/dashboard-layout.tsx` | aside 加 `-translate-x-full lg:translate-x-0`；主内容区移动端去 ml，改 padding-top |
| `app/tracking/page.tsx`、`project/[id]/page.tsx` | 表格 `lg:hidden` + 卡片视图降级 |

#### 方案B：PWA

| 文件 | 改动 |
|------|------|
| `public/manifest.json`（新增） | 应用名/图标/主题色 |
| `next.config.mjs` | 接入 `next-pwa` 或手写 SW |
| Service Worker 缓存策略 | 静态资源 cache-first，API network-first |

#### 方案C：微信小程序（另起工程）

**新工程目录**（与 projects/ 同级）：
```
hyzs-miniapp/                    新工程
├── src/
│   ├── app.config.ts            Taro 配置
│   ├── app.tsx                  入口
│   ├── pages/
│   │   ├── login/index.tsx      企微 wx.login 授权
│   │   ├── mytasks/index.tsx    我的任务（核心高频）
│   │   ├── propose/index.tsx    我提出的（配合验收）
│   │   ├── meetings/index.tsx   会议列表
│   │   └── meeting-detail/index.tsx
│   ├── services/
│   │   ├── request.ts           封装 Taro.request → Web API
│   │   └── auth.ts              token 管理
│   └── components/              小程序 UI 组件
├── project.config.json
└── package.json
```

**复用 Web 的**：全部 `/api/*`（需保证 CORS 或同域）；数据库；AI；OA。

**小程序特有改动**：
- 登录：`wx.login` 换 code → 后端新增 `/api/auth/wecom/miniapp-login` 用 code 换 session。
- 图片：`wx.chooseImage` + `wx.uploadFile` 替代 `<input type=file>`。
- 推送：申请「订阅消息」模板，完成事件触发 `subscribeMessage.send`。

**技术选型**：Taro 4 + React（与现有栈一致）。

---

## 三、分阶段实现计划

### 第一期（P0，1-2 周）
- 问题1-B：去 organizer 兜底 + 补 batch/kanban/tracking 表单
- 问题3-A：viewport 修复 + 侧边栏响应式 + 表格页降级
- 验证：手机浏览器可正常浏览所有页面；proposer 不再误填主持人

### 第二期（P1，1 周）
- 问题2-方案1：企微消息通知提出人
- 问题1-A：AI prompt 增加提出人识别
- 验证：责任人完成后，提出人 5 秒内收到企微消息

### 第三期（P2，3-4 周）
- 问题3-C：小程序工程搭建 + 核心页面（login/mytasks/propose）
- 验证：小程序可登录、查看任务、提交完成

### 第四期（P3，1-2 周）
- 问题2-方案3/4：验收状态机 + 「我提出的」页面
- 验证：完整 提→做→验 闭环

---

## 四、关键风险

| 风险 | 影响 | 缓解 |
|------|------|------|
| AI 识别提出人准确率低 | proposer 仍需手改 | 留空优先于误填，配合表单手选兜底 |
| 企微消息频次过高打扰 | 用户关通知 | 仅 done 触发，不推 in_progress；聚合发送 |
| 小程序录音转写 | 会议录制功能受限 | 小程序仅做任务管理，录音仍走 Web |
| proposer 为空时闭环失效 | 部分老数据无 proposer | 通知前判空，空则跳过并提示补全 |

---

## 五、验证命令

```bash
pnpm ts-check                                      # 类型检查
pnpm exec eslint <改动文件>                          # lint
# 小程序工程（如实施方案C）
cd hyzs-miniapp && pnpm dev:weapp                  # Taro 微信小程序预览
```
