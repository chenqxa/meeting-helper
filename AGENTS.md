# 项目上下文

### 版本技术栈

- **Framework**: Next.js 16 (App Router)
- **Core**: React 19
- **Language**: TypeScript 5
- **UI 组件**: shadcn/ui (基于 Radix UI)
- **Styling**: Tailwind CSS 4

## 目录结构

```
├── public/                 # 静态资源
├── scripts/                # 构建与启动脚本
│   ├── build.sh            # 构建脚本
│   ├── dev.sh              # 开发环境启动脚本
│   ├── prepare.sh          # 预处理脚本
│   └── start.sh            # 生产环境启动脚本
├── src/
│   ├── app/                # 页面路由与布局
│   ├── components/ui/      # Shadcn UI 组件库
│   ├── hooks/              # 自定义 Hooks
│   ├── lib/                # 工具库
│   │   └── utils.ts        # 通用工具函数 (cn)
│   └── server.ts           # 自定义服务端入口
├── next.config.ts          # Next.js 配置
├── package.json            # 项目依赖管理
└── tsconfig.json           # TypeScript 配置
```

- 项目文件（如 app 目录、pages 目录、components 等）默认初始化到 `src/` 目录下。

## 包管理规范

**仅允许使用 pnpm** 作为包管理器，**严禁使用 npm 或 yarn**。
**常用命令**：
- 安装依赖：`pnpm add <package>`
- 安装开发依赖：`pnpm add -D <package>`
- 安装所有依赖：`pnpm install`
- 移除依赖：`pnpm remove <package>`

## 开发规范

- **项目理解加速**：初始可以依赖项目下`package.json`文件理解项目类型，如果没有或无法理解退化成阅读其他文件。
- **Hydration 错误预防**：严禁在 JSX 渲染逻辑中直接使用 typeof window、Date.now()、Math.random() 等动态数据。必须使用 'use client' 并配合 useEffect + useState 确保动态内容仅在客户端挂载后渲染；同时严禁非法 HTML 嵌套（如 <p> 嵌套 <div>）。
- **文件改动安全（防编码事故）**：所有源码文件的增删改**必须逐个使用安全的编辑/写入工具**（按文件读取→精确替换），**严禁**用 PowerShell 的 `Get-Content -Raw` + `Set-Content` / `-replace` 批量覆写源码文件——这类操作会把 UTF-8 文件按系统 ANSI 编码重写导致中文乱码（2026-09 曾因此破坏三个看板页面）。大文件、涉及多文件的一律拆成单文件逐条改动。
- **改动即备份**：重要改动（尤其批量/多文件）前先 `git add -A && git commit` 落一个安全点，改坏可一键回退。


## UI 设计与组件规范 (UI & Styling Standards)

- 模板默认预装核心组件库 `shadcn/ui`，位于`src/components/ui/`目录下
- Next.js 项目**必须默认**采用 shadcn/ui 组件、风格和规范，**除非用户指定用其他的组件和规范。**

## 文档交付规范 (Documentation Deliverables)

**每次开发新功能（新增页面/接口/重要改动）都必须同步产出「三件套」文档**，缺一不可：

1. **需求文档** `requirement.md` — 背景、目标、用户故事、功能范围（含/不含）、数据来源、页面/接口结构、交互需求、入口与权限、非功能需求、验收标准。
2. **开发文档** `development.md` — 技术栈、目录与改动清单、组件结构、数据流、字段映射、扩展机制、样式要点、已知限制、验证命令。
3. **测试文档** `test.md` — 测试范围、环境、前置条件、**测试用例表**（编号/用例/前置/步骤/预期/优先级）、回归清单、缺陷记录模板。

### 存放位置与命名

- 路径：`docs/feature/<功能名>/`，每个功能一个子目录。
- 文件名固定：`requirement.md`、`development.md`、`test.md`。
- 文档语言：**中文**（技术字段/接口名保留英文）。
- 测试形式：**手工用例表**（项目当前无自动化测试框架；如引入需先确认）。

### 执行时机

- 文档与代码**同批交付**，不允许「先上线后补文档」。
- 每个功能的第一版三件套同时作为该功能后续迭代的模板。

## 变更记录规范 (Changelog)

生成 Obsidian 变更记录时，必须遵守《变更记录契约》：

1. **触发条件**：仅当变更涉及**行为、口径、数据、权限、风险或跨团队协作**时，才生成 Obsidian 文件；改文案、样式、小 bug **不生成**，只在回复里给 5 行以内摘要。
2. **不混写**：架构决策另写 ADR；需求方案另写需求文档（`docs/feature/<功能名>/`）；都不混进 changelog。
3. **路径**：Obsidian 库内**按项目分文件夹**，避免跨项目相混：`01-工作/<项目名>/changelog/YYYY-MM-DD-slug.md`（已完成变更）、`01-工作/<项目名>/analysis/YYYY-MM-DD-slug.md`（分析/待确认）。本项目（hyzs）：`E:\75597\我的私人空间\01-工作\会议助手\`。slug 用简短英文/拼音，不加 emoji。
4. **必含 YAML frontmatter**：`date, type, status, project, area, risk, files, rollback, tags`（`project: hyzs`）。
5. **正文只允许 5 个二级标题**：结论、原因、影响与风险、验证与回滚、关联。
6. **总字数 ≤ 600 中文字**；每节 ≤ 5 行；每条变更一行（最多 2 行）。
7. **禁止**出现：TL;DR、详细变更、影响范围、我的复盘、代码涉及、一句话总结；**禁止 emoji 装饰**；标签只放 YAML。
8. **只列关键文件 3–5 个**；完整 diff 放 PR/commit。
9. **未确认项**单独写在「关联」下的「待确认」，不得混入「已完成」。
10. **生成后自检**：frontmatter 完整、字数、二级标题数、禁用词、重复内容；不满足就重写。可用 `node scripts/check-changelog.mjs <file>` 校验。
11. 模板：`docs/_templates/changelog.md`。


