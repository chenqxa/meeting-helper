# 需求文档：持续项推送历史与时间修复

> 对应路线图：`docs/feature/continuous-push-history/`
> 关联代码：`src/server.ts`、`src/lib/continuous-push.ts`、`src/lib/beijing-time.ts`、`src/storage/database/continuous-push-log-storage.ts`、`src/app/api/continuous/push-history/`、`src/app/api/continuous/push/`、`src/app/settings/page.tsx`

## 背景与目标

- **背景**：持续项推送配置为"每周五 09:00"，但生产容器运行在 UTC 时区，调度器拿 UTC 钟面时间比对，导致实际在**下午 17:00** 才推送、上午 9 点不推；且手动推送不更新"上次推送时间"、也没有可查询的推送历史。
- **目标**：
  1. 推送严格按**北京时间**执行（不依赖容器时区）。
  2. 手动推送与自动推送都更新配置的"上次推送时间"。
  3. 每次推送（自动/手动）落库，可在设置页查询历史。

## 功能范围

### 含
- 调度器按北京时间（UTC+8）判断星期/时/分/日期。
- "今天已推过"去重也按北京时间比较。
- 手动推送接口 `/api/continuous/push` 更新对应配置的 `lastPushedAt`，并标记来源 `manual`。
- 新建推送历史表 `hyzs_continuous_push_log` 记录每次推送（时间/会议类型/来源/条数/OA 结果）。
- 新增查询接口 `/api/continuous/push-history`（支持按会议类型过滤、分页）。
- 设置页「持续项推送配置」下方新增「推送记录」列表展示最近 30 条。

### 不含
- 不做推送失败重试。
- 不回溯补记历史（旧数据不迁移）。

## 数据来源
- 会议类型、节奏配置：`hyzs_cadence_config`。
- 推送结果：`pushContinuousByType` 返回值（items/pushed/failed）。
- 推送历史：新表 `hyzs_continuous_push_log`。

## 接口结构
- `POST /api/continuous/push`：body `{ meeting_type, item_ids? }`，返回 `{ success, data: { items, pushed, failed } }`。
- `GET /api/continuous/push-history?meeting_type=&page=&pageSize=`：返回 `{ success, data: PushLog[], total }`。

## 交互需求
- 设置页「推送记录」表：推送时间（本地）、会议类型、来源（自动/手动）、条数、结果（OA 成功数 / 失败数）。

## 入口与权限
- 入口：设置页 →「持续项推送配置」下方。
- 权限：设置页本身仅管理员/特定用户可见；手动推送接口沿用既有权限校验（`chenqiaoxia` 或 admin）。

## 验收标准
1. 在 UTC 时区容器与本地同时运行，配置"每周五 09:00"均在北京时间周五 09:00 触发。
2. 手动点击「推送」后，该配置"上次推送"时间更新为当前时间。
3. 每次推送后，设置页「推送记录」新增一条记录，来源正确标识自动/手动。
4. 空推送（无持续项）不产生记录，不报错。

## 测试文档
见 `test.md`。
