# projects

这是一个基于 [Next.js 16](https://nextjs.org) + [shadcn/ui](https://ui.shadcn.com) 的全栈应用项目，由扣子编程 CLI 创建。

## 快速开始

### 启动开发服务器

```bash
coze dev
```

启动后，在浏览器中打开 [http://localhost:5000](http://localhost:5000) 查看应用。

开发服务器支持热更新，修改代码后页面会自动刷新。

### 构建生产版本

```bash
coze build
```

### 启动生产服务器

```bash
coze start
```

## 项目结构

```
src/
├── app/                      # Next.js App Router 目录
│   ├── layout.tsx           # 根布局组件
│   ├── page.tsx             # 首页
│   ├── globals.css          # 全局样式（包含 shadcn 主题变量）
│   └── [route]/             # 其他路由页面
├── components/              # React 组件目录
│   └── ui/                  # shadcn/ui 基础组件（优先使用）
│       ├── button.tsx
│       ├── card.tsx
│       └── ...
├── lib/                     # 工具函数库
│   └── utils.ts            # cn() 等工具函数
└── hooks/                   # 自定义 React Hooks（可选）

server/
├── index.ts                 # 自定义服务器入口
├── tsconfig.json           # Server TypeScript 配置
└── dist/                    # 编译输出目录（自动生成）
```

## 核心开发规范

### 1. 组件开发

**优先使用 shadcn/ui 基础组件**

本项目已预装完整的 shadcn/ui 组件库，位于 `src/components/ui/` 目录。开发时应优先使用这些组件作为基础：

```tsx
// ✅ 推荐：使用 shadcn 基础组件
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

export default function MyComponent() {
  return (
    <Card>
      <CardHeader>标题</CardHeader>
      <CardContent>
        <Input placeholder="输入内容" />
        <Button>提交</Button>
      </CardContent>
    </Card>
  );
}
```

**可用的 shadcn 组件清单**

- 表单：`button`, `input`, `textarea`, `select`, `checkbox`, `radio-group`, `switch`, `slider`
- 布局：`card`, `separator`, `tabs`, `accordion`, `collapsible`, `scroll-area`
- 反馈：`alert`, `alert-dialog`, `dialog`, `toast`, `sonner`, `progress`
- 导航：`dropdown-menu`, `menubar`, `navigation-menu`, `context-menu`
- 数据展示：`table`, `avatar`, `badge`, `hover-card`, `tooltip`, `popover`
- 其他：`calendar`, `command`, `carousel`, `resizable`, `sidebar`

详见 `src/components/ui/` 目录下的具体组件实现。

### 2. 路由开发

Next.js 使用文件系统路由，在 `src/app/` 目录下创建文件夹即可添加路由：

```bash
# 创建新路由 /about
src/app/about/page.tsx

# 创建动态路由 /posts/[id]
src/app/posts/[id]/page.tsx

# 创建路由组（不影响 URL）
src/app/(marketing)/about/page.tsx

# 创建 API 路由
src/app/api/users/route.ts
```

**页面组件示例**

```tsx
// src/app/about/page.tsx
import { Button } from '@/components/ui/button';

export const metadata = {
  title: '关于我们',
  description: '关于页面描述',
};

export default function AboutPage() {
  return (
    <div>
      <h1>关于我们</h1>
      <Button>了解更多</Button>
    </div>
  );
}
```

**动态路由示例**

```tsx
// src/app/posts/[id]/page.tsx
export default async function PostPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <div>文章 ID: {id}</div>;
}
```

**API 路由示例**

```tsx
// src/app/api/users/route.ts
import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({ users: [] });
}

export async function POST(request: Request) {
  const body = await request.json();
  return NextResponse.json({ success: true });
}
```

### 3. 依赖管理

**必须使用 pnpm 管理依赖**

```bash
# ✅ 安装依赖
pnpm install

# ✅ 添加新依赖
pnpm add package-name

# ✅ 添加开发依赖
pnpm add -D package-name

# ❌ 禁止使用 npm 或 yarn
# npm install  # 错误！
# yarn add     # 错误！
```

项目已配置 `preinstall` 脚本，使用其他包管理器会报错。

### 4. 样式开发

**使用 Tailwind CSS v4**

本项目使用 Tailwind CSS v4 进行样式开发，并已配置 shadcn 主题变量。

```tsx
// 使用 Tailwind 类名
<div className="flex items-center gap-4 p-4 rounded-lg bg-background">
  <Button className="bg-primary text-primary-foreground">
    主要按钮
  </Button>
</div>

// 使用 cn() 工具函数合并类名
import { cn } from '@/lib/utils';

<div className={cn(
  "base-class",
  condition && "conditional-class",
  className
)}>
  内容
</div>
```

**主题变量**

主题变量定义在 `src/app/globals.css` 中，支持亮色/暗色模式：

- `--background`, `--foreground`
- `--primary`, `--primary-foreground`
- `--secondary`, `--secondary-foreground`
- `--muted`, `--muted-foreground`
- `--accent`, `--accent-foreground`
- `--destructive`, `--destructive-foreground`
- `--border`, `--input`, `--ring`

### 5. 表单开发

推荐使用 `react-hook-form` + `zod` 进行表单开发：

```tsx
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const formSchema = z.object({
  username: z.string().min(2, '用户名至少 2 个字符'),
  email: z.string().email('请输入有效的邮箱'),
});

export default function MyForm() {
  const form = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: { username: '', email: '' },
  });

  const onSubmit = (data: z.infer<typeof formSchema>) => {
    console.log(data);
  };

  return (
    <form onSubmit={form.handleSubmit(onSubmit)}>
      <Input {...form.register('username')} />
      <Input {...form.register('email')} />
      <Button type="submit">提交</Button>
    </form>
  );
}
```

### 6. 数据获取

**服务端组件（推荐）**

```tsx
// src/app/posts/page.tsx
async function getPosts() {
  const res = await fetch('https://api.example.com/posts', {
    cache: 'no-store', // 或 'force-cache'
  });
  return res.json();
}

export default async function PostsPage() {
  const posts = await getPosts();

  return (
    <div>
      {posts.map(post => (
        <div key={post.id}>{post.title}</div>
      ))}
    </div>
  );
}
```

**客户端组件**

```tsx
'use client';

import { useEffect, useState } from 'react';

export default function ClientComponent() {
  const [data, setData] = useState(null);

  useEffect(() => {
    fetch('/api/data')
      .then(res => res.json())
      .then(setData);
  }, []);

  return <div>{JSON.stringify(data)}</div>;
}
```

## 常见开发场景

### 添加新页面

1. 在 `src/app/` 下创建文件夹和 `page.tsx`
2. 使用 shadcn 组件构建 UI
3. 根据需要添加 `layout.tsx` 和 `loading.tsx`

### 创建业务组件

1. 在 `src/components/` 下创建组件文件（非 UI 组件）
2. 优先组合使用 `src/components/ui/` 中的基础组件
3. 使用 TypeScript 定义 Props 类型

### 添加全局状态

推荐使用 React Context 或 Zustand：

```tsx
// src/lib/store.ts
import { create } from 'zustand';

interface Store {
  count: number;
  increment: () => void;
}

export const useStore = create<Store>((set) => ({
  count: 0,
  increment: () => set((state) => ({ count: state.count + 1 })),
}));
```

### 集成数据库

推荐使用 Prisma 或 Drizzle ORM，在 `src/lib/db.ts` 中配置。

## 待办推送配置指南

系统内置了将行动项待办通过内部 IM 推送给责任人的定时任务，默认关闭。按照下面的步骤启用并验证：

### 1. 配置聊天系统环境变量

`.env` 中需要先填写聊天系统的基础信息（若已有可跳过）：

```env
CHAT_ADMIN_API_BASE_URL=http://example.com/admin
CHAT_API_BASE_URL=http://example.com/chat
CHAT_ADMIN_ACCOUNT=管理员账号
CHAT_ADMIN_PASSWORD=管理员密码
CHAT_SENDER_USER_ID=IM发送账号
```

### 2. 启用定时推送

新增（或修改）以下变量来控制推送计划：

```env
CHAT_TODO_PUSH_ENABLED=true            # true 开启，其他值均视为关闭
CHAT_TODO_PUSH_TIMES=09:00,17:30        # 支持多个 HH:mm，逗号分隔
CHAT_TODO_PUSH_PROJECT_ID=             # 可选：仅推送指定项目 ID 的行动项
CHAT_TODO_PUSH_FORMAT=text             # text 或 card
CHAT_TODO_PUSH_MAX_ITEMS=20            # 可选：每人最多包含多少条，留空不限
CHAT_TODO_INCLUDE_HEADER=true          # false 时不显示总标题
CHAT_TODO_PUSH_ID_PREFIX=hyzs          # 可选：幂等键前缀，跨多实例时区分来源
CHAT_TODO_PUSH_RUN_ON_START=false      # true 时，服务启动约 20s 后立即跑一次
```

保存 `.env` 后重启服务（本地 `pnpm dev` 直接 Ctrl+C 再启动，Docker 需重新部署）。日志会输出下一次执行时间，例如：

```
[TodoPush] 下次推送(09:00): 2026/06/04 09:00:00（14小时37分钟后）
```

> 提示：推送依赖组织架构数据中的 `loginid`。请确保已同步 OA 员工信息，否则找不到责任人的 OA 账号会被跳过并在日志中告警。

### 3. 手动触发与排查

若需要临时验证，可直接调用已有的接口：

```bash
curl -X POST http://localhost:5000/api/chat/send-todo \
  -H "Content-Type: application/json" \
  -d '{
    "oaUserId": "10001",
    "ownerLoginId": "zhangsan",
    "maxItems": 10
  }'
```

响应会返回发送成功/失败详情；在服务日志中也能看到失败原因及被跳过的负责人名单。

常见排查方向：

1. **未登录聊天接口**：检查聊天环境变量是否填写正确。
2. **未找到账户**：确认行动项的 `ownerLoginId` 或组织架构中员工 `loginid` 是否存在。
3. **幂等重复**：同一用户当天多次触发会命中幂等，日志中会标记 `idempotentHit`，属正常现象。

## 测试数据初始化

需要快速演示项目/会议/行动项联动时，可使用内置的 `/api/seed` 路由批量生成测试数据。该接口具备幂等保护：

- 如果项目或会议已存在（按名称匹配），会复用并更新摘要，不会重复插入。
- 行动项按 `meetingId + originalId` 检查，已存在的记录不会再次写入。
- 会自动补齐演示用的项目文档（Artifact）。

### 1. 启动服务

```bash
pnpm dev
```

默认监听 `http://localhost:5000`，确保数据库连接已配置（或使用内存模式）。

### 2. 调用 Seed 接口

```bash
curl -X POST http://localhost:5000/api/seed
```

成功响应示例：

```json
{
  "success": true,
  "data": {
    "projects": [
      { "id": "PRJ_...", "name": "智能客服提效计划", "status": "created" },
      { "id": "PRJ_...", "name": "用户中心重构", "status": "existing" }
    ],
    "meetings": [
      { "id": "MTG_...", "title": "产品Q3季度规划会", "status": "created" },
      { "id": "MTG_...", "title": "技术评审 - 用户中心重构方案", "status": "updated" }
    ],
    "createdArtifacts": 3,
    "createdActionItems": 10,
    "createdRequirements": 3,
    "createdRisks": 2
  }
}
```

数据内容概览：

1. **项目**：智能客服提效计划、用户中心重构、营销自动化 MVP（含 owner、成员、阶段、目标日期）。
2. **会议**：每个项目附带 1 场示例纪要，内含摘要、决策和行动项列表。
3. **行动项**：覆盖 `candidate/in_progress/block/done` 等状态，预填负责人与截止日期，用于验证推送与看板筛选。
4. **需求**：按项目生成 3 条样例需求，覆盖草稿、评审、已通过等状态。
5. **风险**：注入典型项目风险与缓解方案，支撑风险台账调试。
6. **文档**：每个项目自动挂载一份示例 Artifact，便于前端文档列表展示。

### 3. 清理演示数据（可选）

目前未提供一键回滚，请按需手动清理：

1. 删除相关会议/项目记录（可在对应页面或数据库中操作）。
2. 运行调试接口移除悬挂行动项：

```bash
curl -X POST http://localhost:5000/api/debug/cleanup-orphan-actions
```

该接口仅会删除 `meeting_id` 为空或关联会议已不存在的行动项，安全可控。

## 技术栈

- **框架**: Next.js 16.1.1 (App Router)
- **UI 组件**: shadcn/ui (基于 Radix UI)
- **样式**: Tailwind CSS v4
- **表单**: React Hook Form + Zod
- **图标**: Lucide React
- **字体**: Geist Sans & Geist Mono
- **包管理器**: pnpm 9+
- **TypeScript**: 5.x

## 参考文档

- [Next.js 官方文档](https://nextjs.org/docs)
- [shadcn/ui 组件文档](https://ui.shadcn.com)
- [Tailwind CSS 文档](https://tailwindcss.com/docs)
- [React Hook Form](https://react-hook-form.com)

## 重要提示

1. **必须使用 pnpm** 作为包管理器
2. **优先使用 shadcn/ui 组件** 而不是从零开发基础组件
3. **遵循 Next.js App Router 规范**，正确区分服务端/客户端组件
4. **使用 TypeScript** 进行类型安全开发
5. **使用 `@/` 路径别名** 导入模块（已配置）
