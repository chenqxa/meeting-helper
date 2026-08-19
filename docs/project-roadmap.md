# 项目知识管理蓝图对齐摘要

## 1. 设计文档实体 vs 现有数据模型

| 设计实体 | 现有实现 | 状态 | 说明 |
| --- | --- | --- | --- |
| Project 项目 | `hyzs_projects` 表 + `Project` 接口，包含名称、状态、负责人、成员、目标日期等字段 (@src/storage/database/project-storage.ts#1-179) | ✅ 已具备 | 已支持 CRUD API 与前端项目详情页，满足基础项目元数据管理。 |
| Artifact 内容资产 | `hyzs_artifacts` 表 + `Artifact` 接口，区分 `meeting/document/research/proposal/email/other` (@src/storage/database/project-storage.ts#18-114) | ✅ 已具备 | 可关联项目并记录解析状态，适合作为“需求/文档中心”底层。 |
| Requirement 需求 | ⛔ 未单独建模 | 待补充 | 需求当前仅以会议或行动项描述存在，需要新增需求实体表。 |
| Meeting 会议 | `hyzs_meetings` 表 + `Meeting` 对象 (含 `project_id`) (@src/storage/database/sqlserver-storage.ts#115-221) | ✅ 已具备 | 已能关联项目、存储纪要/行动项。 |
| ActionItem 行动项 | `hyzs_action_items` 表 + API (@src/storage/database/action-storage.ts#1-179) | ✅ 已具备 | 已支持项目字段、责任人、状态；我们刚完善了定时推送。 |
| Evidence 证据 | ⚠️ 未独立实体 | 可复用 | 行动项中有 `sourceText` 等字段，但缺少通用“证据”存储，后续可抽象。 |
| Risk 风险 | ⛔ 未建模 | 待补充 | 文档要求风险识别，需要新增表/接口支持录入与追踪。 |
| Decision 决策 | ⛔ 未建模 | 待补充 | 会议纪要中有决策信息，但尚无结构化数据。 |

## 2. 数据缺口与兼容建议

1. **需求（Requirement）**
   - 建议新增 `hyzs_requirements` 表，包含：id、projectId、title、status（draft/review/approved/live）、owner、relatedArtifactId、tags、priority、dueDate、createdAt、updatedAt。
   - 行动项可通过 `requirementId` 关联需求，实现“需求→任务”闭环。

2. **证据（Evidence）与知识图谱**
   - 当前行动项的 `sourceText`/`source_sentence` 可以作为轻量证据字段。
   - 建议补充 `Evidence` 表（记录上传的文档片段、会议引用、AI 提炼摘要），逐步构建图谱。

3. **风险（Risk）**
   - 新增 `hyzs_project_risks` 表，字段：id、projectId、title、description、level（low/medium/high）、status（open/mitigated/closed）、owner、relatedActionId、detectedBy（AI/manual）、createdAt、updatedAt。
   - 可与现有台账/看板联动，先支持人工录入。

4. **决策（Decision）**
   - 在会议纪要解析中抽取关键决策，存入 `hyzs_project_decisions` 表；字段：id、projectId、meetingId、summary、owner、dueDate、status。

以上新增表均通过 SQL Server schema 扩展，不影响现有 API，可逐步上线。

## 3. MVP 阶段增强（保持兼容）

- **项目空间 / 工作台**：基于现有 `/api/projects` 与 `/project/[id]` 页面，补充需求、风险、文档等标签页，前端只需新增组件，不改动旧逻辑。
- **会议→项目关联**：字段已存在，需在会议详情页显示并允许重新绑定项目，保持原数据兼容。
- **AI 行动项候选库**：在现有行动项推送逻辑上扩展一层 `candidate` 状态（已支持），新增 `候选池` API + 审核界面，审核通过后写入 `hyzs_action_items`。
- **台账 / 导出**：复用 `getActionItemsByOwner` 等接口，新增 `/api/projects/{id}/ledger` 返回按项目聚合的数据即可。

## 4. 不影响现有功能的约束

- 所有新增表/接口采用可选关联（外键可空），旧数据无需迁移即可继续使用。
- 在 UI 上提供“旧流程入口”保持原有功能可达；新增模块通过导航/侧边栏补充且可逐步启用。
- 对核心 API（会议创建、行动项更新）仅做向后兼容字段扩展，避免 break change。

## 5. 后续文档归档

- 本文件作为蓝图对齐记录，后续更新请写在 `docs/project-roadmap.md`。
- 每次功能迭代完成后补充章节描述改动内容与测试结果，便于追踪。

## 6. MVP 增量交付清单（保持兼容）

### 6.1 Phase 0（1~2 天）

1. **术语与字段核对**：完成会议、项目、行动项与新增实体的字段对照表（已启动）。
2. **API 影响评估**：确认 `/api/meetings`、`/api/actions/*`、`/api/projects/*` 的兼容字段扩展方式。
3. **实验环境准备**：建立 feature flag（如 `PROJECT_MVP_PHASE`）或独立分支，隔离后续开发。

### 6.2 Phase 1（MVP 4~6 周）

| 模块 | 目标 | 兼容策略 |
| --- | --- | --- |
| 项目工作台 | 在现有 `/project/[id]` 页新增需求/风险/文档 tab | 仅新增组件和接口，不改动原有 overview/meetings 逻辑 |
| 项目空间 | 扩展 `/api/projects` 返回成员、阶段、统计数据 | 新字段保持可选，旧页面读取现有字段不受影响 |
| 需求与文档中心 | 新增 `hyzs_requirements` + `hyzs_artifacts` 组合视图 | 需求表独立存在，原文档逻辑继续运行 |
| 会议记录中心 | 会议详情页展示项目关联 & AI 候选 | 原会议编辑流程保留，仅增加显示与绑定操作 |
| 行动项看板/台账 | 基于 `hyzs_action_items` 新增 `/api/projects/{id}/ledger` | 复用现有查询，不修改 `/api/actions` 行为 |
| AI 候选库 | 引入 `candidate` 状态 + 审核 API/UI | 现有 `pending` 等状态保持不变，老任务数据无需迁移 |

### 6.3 Phase 2（M1/M2 拓展）

1. **风险/决策模型**：逐步上线 `Risk`、`Decision` 表，并在 UI 中提供录入页；上线时新增菜单项，不改变旧页面。
2. **AI 周报/洞察**：以新增 API 输出报告，不改动原推送逻辑，结合定时任务形成新任务类型。
3. **知识图谱可视化**：在独立页面 `/project/graph` 展示关系图，与现有详情页解耦。
4. **权限细化**：在 session 中引入角色控制开关，默认关闭，确保老用户体验一致。

### 6.4 测试与回归

- 每个迭代完成后，跑核心回归用例：会议创建→纪要→行动项编辑→定时推送。
- 新增功能统一编写 `docs/test-cases/project-mvp.md`，对照执行并记录结果。
