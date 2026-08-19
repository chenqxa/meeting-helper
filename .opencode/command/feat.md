---
description: "启动新功能开发，按 需求/开发/测试 三件套流程交付。用法：/feat 功能名"
agent: build
---

你要开始开发一个新功能：**$ARGUMENTS**

请严格按以下流程执行，任何一步都不得跳过。这是本项目的强制交付规范（详见 `AGENTS.md` 的「文档交付规范」与 `.opencode/skills/feature-docs/SKILL.md`）。

## 第 1 步：确认范围
- 用 1-2 句话复述你对这个功能的理解。
- 用 `question` 工具问清关键决策点（数据来源、入口位置、是否含交互、权限范围等），不要凭空假设。
- 明确告知：本次会产出三件套文档（`docs/feature/<name>/requirement.md`、`development.md`、`test.md`）。

## 第 2 步：先出文档骨架
在写业务代码之前，先创建：
- `docs/feature/<name>/requirement.md` —— 至少含背景、目标、功能范围、数据来源、验收标准。
- `docs/feature/<name>/development.md` —— 至少含技术栈、目录与改动清单、组件结构。
- `docs/feature/<name>/test.md` —— 至少含测试范围、前置条件、核心 P0 测试用例表。

让用户确认方向后再进入开发。

## 第 3 步：开发 + 同步文档
- 边写代码边补 `development.md`（字段映射、扩展机制、数据流）。
- 核心逻辑写完即补 `test.md` 的 P0 用例，作为自测依据。

## 第 4 步：交付前自检
- 运行 `pnpm ts-check`，必须通过。
- 运行 `pnpm exec eslint <改动文件>`，不得引入新 error。
- 对照 `test.md` 回归清单逐条过一遍。
- 三件套文档齐全且与最终代码一致（不是写完代码才补的陈旧版本）。

## 参考范本
`docs/feature/weekly-board/` 是完整三件套范本，结构与质量对齐它即可。

现在从第 1 步开始。
