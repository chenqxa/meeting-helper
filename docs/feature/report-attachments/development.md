# 汇报附件（图片放大 + 全类型上传 + 在线预览）开发文档

> 版本：v1.0 · 对应需求：`docs/feature/report-attachments/requirement.md`

## 1. 技术方案

- 抽两个公共组件：`ImagePreview`（图片放大）与 `FilePreview`（按 MIME/扩展名分派）。
- 上传侧放开类型：前端去掉 `accept`/过滤/写死 type；后端 `/api/upload` 增 `file` 类型、放宽白名单（保留 50MB 与魔数探测）。
- 读取侧补 MIME 映射，危险类型强制 `attachment`。
- 复用已有依赖：`mammoth`（docx）、`xlsx`（Excel）。

## 2. 目录与改动清单

```
src/components/ui/image-preview.tsx          新增  图片放大（多图/ESC/下载）
src/components/ui/file-preview.tsx           新增  按类型分派预览
src/app/api/upload/route.ts                  改动  放开类型（新增 'file'）
src/lib/file-validator.ts                    改动  不再按白名单拦截；魔数探测选 MIME
src/app/api/files/[id]/route.ts              改动  补 MIME 映射；危险类型 attachment
src/app/page.tsx                             改动  accept/过滤/type + 缩略图接 ImagePreview（:1077,1084,1097,1148）
src/app/mytasks/page.tsx                     改动  同上（:494,498,508,567）
src/app/kanban/page.tsx                      改动  同上（:2192,2193,2203,2252）
src/app/tracking/page.tsx                    改动  同上（:1476,1480,1490,1538）
src/app/project/[id]/page.tsx                改动  同上（:1922,1929,1942,1994）
src/components/feedback-submit-dialog.tsx    改动  同上（:38,41,51,179,204）
src/app/feedback/page.tsx                    改动  同上（:126,129,139,595）
docs/feature/report-attachments/             新增  三件套
```

## 3. 组件设计

### 3.1 `ImagePreview`

```tsx
export function ImagePreview({
  images,        // string[]
  index,         // 初始索引
  open, onClose,
}: Props) {
  // 大图 + 左右切换 + 下载 + ESC/遮罩关闭
  // 内部用 absolute 覆盖层，无需 shadcn Dialog 也能跑
}
```

### 3.2 `FilePreview`

```tsx
type Kind = 'image'|'pdf'|'docx'|'sheet'|'text'|'audio'|'video'|'other';

export function FilePreview({ url, filename, mime }: { url:string; filename:string; mime?:string }) {
  const kind = detectKind(filename, mime);
  // image  → <img>（可选 ImagePreview）
  // pdf    → <iframe src={url}>
  // docx   → mammoth.convertToHtml(await (await fetch(url)).arrayBuffer())
  // sheet  → XLSX.read + 渲染 table
  // text   → <pre>
  // audio/video → 原生标签
  // other  → 下载卡片
}
```

> docx/xlsx 动态 `import()`，避免首屏加载。

## 4. 上传侧放开

### 4.1 后端 `/api/upload`

```ts
const SUPPORTED_MIME_TYPES = {
  recording: [...],
  image:     [...],
  file:      [], // 空数组 = 不做 MIME 白名单限制
};
```

- `file` 类型：不校验 MIME 白名单，仅校验大小（50MB）+ 基本安全检查；
- `file-validator.ts`：`validateFile` 对 `file` 类型跳过扩展名白名单，仅做魔数探测（用于决定 Content-Type），危险后缀强制 attachment。

### 4.2 前端（7 处）

- `<input type="file" multiple>` 去掉 `accept`；
- 去掉 `f.type.startsWith('image/')` 过滤（图片进图片列表，其余进文件列表）；
- `fd.append('type', isImage ? 'image' : 'file')`；
- 缩略图：图片接 `ImagePreview`；文件渲染文件卡片（图标+名+大小+预览/下载）。

## 5. 读取侧

`src/app/api/files/[id]/route.ts`：

- 补全 MIME：pdf/doc/docx/xls/xlsx/ppt/pptx、txt/csv/json、mp3/wav/m4a、mp4/webm、zip/rar/7z；
- 危险类型（text/html、image/svg+xml、application/javascript、application/x-msdownload 等）：
  `Content-Disposition: attachment` + `X-Content-Type-Options: nosniff`，禁止内联。

## 6. 已知限制

- PPT/旧 Office/压缩包仅下载；
- docx/xlsx 预览为只读、复杂排版会有差异；
- 大文件预览（PDF iframe）依赖浏览器能力。

## 7. 验证命令

```bash
pnpm ts-check
pnpm exec eslint src/components/ui/image-preview.tsx src/components/ui/file-preview.tsx
# 手工：6 个入口上传各类型 + 预览，见 test.md
```

## 8. 工期评估

| 项 | 工时 |
|---|---|
| `ImagePreview` + 接入 6 处 | 0.5~1 天 |
| 放开类型（前端 7 处 + 后端） | 0.5~1 天 |
| `FilePreview`（docx/xlsx/pdf/text/av） | 1~1.5 天 |
| 安全（危险类型 attachment）+ 回归 | 0.5 天 |
| **合计** | **约 2~3.5 天** |
