# 接口权限管控（RBAC 后端鉴权）测试文档

> 版本：v1.0  ·  测试形式：手工用例表（curl / 浏览器双账号）

## 1. 测试范围

后端接口角色校验（403/401）、责任人自助汇报放行、admin 功能回归、middleware 收紧。

## 2. 环境

- 本地 dev：http://localhost:5000
- 账号：admin（chenqiaoxia）、manager（马雅雯）、employee（李玉英）、secretary（徐蓉）
- 工具：curl（带 meeting_session cookie）或浏览器开发者工具复制请求

## 3. 测试用例

### 3.1 越权拦截（核心）

| 编号 | 用例 | 账号 | 步骤 | 预期 | 优先级 |
|------|------|------|------|------|--------|
| R-01 | employee 改稽核分 | 李玉英 | PUT /api/actions/[id] body 含 oa_score:1 | 403 FORBIDDEN，数据不变，日志出现 forbidden 记录 | P0 |
| R-02 | employee 改任务状态为 done | 李玉英 | PUT body 含 status:'done' | 403 | P0 |
| R-03 | employee 重派任务 | 李玉英 | PUT body 含 next_due_date | 403 | P0 |
| R-04 | employee 新建独立任务 | 李玉英 | POST /api/actions | 403 | P0 |
| R-05 | manager 改稽核分 | 马雅雯 | 同 R-01 | 403 | P0 |
| R-06 | manager 结算 | 马雅雯 | POST /api/actions/settle | 403 | P1 |
| R-07 | secretary 改角色名单 | 徐蓉 | POST /api/roles | 403 | P1 |
| R-08 | manager 改推送配置 | 马雅雯 | POST /api/cadence | 403 | P1 |
| R-09 | manager 改组织架构 | 马雅雯 | POST /api/org/employees | 403 | P1 |
| R-10 | 越权日志留痕 | 任意非 admin | 执行 R-01 后查操作日志页 | 存在 action=forbidden 记录（含 loginid/角色） | P0 |

### 3.2 自助汇报放行

| 编号 | 用例 | 账号 | 步骤 | 预期 | 优先级 |
|------|------|------|------|------|--------|
| R-20 | 责任人汇报自己任务 | 李玉英 | PUT body 仅含 oa_result/oa_attachments，status=in_progress | 200 成功，进展写入 | P0 |
| R-21 | 非责任人伪汇报 | 马雅雯 | 对李玉英名下任务发同样请求 | 403 | P0 |
| R-22 | 汇报夹带稽核字段 | 李玉英 | PUT body 含 oa_result + oa_score | 403（黑名单字段触发管理校验） | P0 |
| R-23 | 汇报夹带改 owner | 李玉英 | PUT body 含 oa_result + owner | 403 | P1 |
| R-24 | 汇报带辅助字段不误伤 | 李玉英 | PUT body 含 oa_result + _tmpFlag/updatedAt 等辅助字段 | 200（黑名单方案：辅助字段不影响判定） | P0 |
| R-25 | 汇报改描述被拦 | 李玉英 | PUT body 含 oa_result + description | 403（描述属管理编辑） | P1 |

### 3.2.1 校验顺序（锁定优先）

| 编号 | 用例 | 前置 | 步骤 | 预期 | 优先级 |
|------|------|------|------|------|--------|
| R-26 | 锁定项不借自助通道解锁 | 存在已重派X项 | 责任人对其发纯汇报请求 | 403（转派锁定判断先于分层校验） | P0 |

### 3.3 admin 回归

| 编号 | 用例 | 账号 | 步骤 | 预期 | 优先级 |
|------|------|------|------|------|--------|
| R-30 | admin 正常稽核 | chenqiaoxia | 台账打 V/X/0 | 与改造前一致 | P0 |
| R-31 | admin 重派 | chenqiaoxia | 未完成+下次时间 | 生成新任务链 | P0 |
| R-32 | admin 批量导入/结算/同步 | chenqiaoxia | 各按钮 | 正常 | P1 |
| R-33 | admin 会议创建锁定 | chenqiaoxia | 会议中心操作 | 正常 | P1 |
| R-34 | 转派锁定项不受影响 | chenqiaoxia | 尝试改已重派 X 项 | 403（原有锁定逻辑仍生效） | P1 |

### 3.4 middleware 收紧

| 编号 | 用例 | 前置 | 步骤 | 预期 | 优先级 |
|------|------|------|------|------|--------|
| R-40 | 生产模式 debug 接口 | NODE_ENV=production | 未登录 POST /api/debug/cleanup-orphan-actions | 401 | P1 |
| R-41 | dev 模式 debug 接口 | 本地 dev | 同上 | 维持放行（现状） | P2 |
| R-42 | 健康检查不误伤 | 任意环境 | 未登录 GET /api/health | 200（永久公开白名单） | P0 |

### 3.5 全局回归

- [ ] 登录/登出、我的待办、看板三页、持续项跟进、OA 回拉（等一轮调度）均正常。
- [ ] 前端各页面无新增报错弹窗。

## 4. 缺陷记录模板

| 编号 | 日期 | 描述 | 严重度 | 状态 |
|------|------|------|--------|------|
|      |      |      |        |      |
