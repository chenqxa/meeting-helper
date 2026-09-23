# 汇报附件（图片放大 + 全类型上传 + 在线预览）需求文档

> 版本：v1.0 · 状态：待开发 · 创建：2026-09-18
> 背景：用户反馈"汇报只能传图片""上传后不能放大"。

## 1. 背景与问题

| 问题 | 现状 |
|---|---|
| 只能传图片 | 前端 `accept="image/*"` + `f.type.startsWith('image/')` + `type='image'` 三层写死；后端 `SUPPORTED_MIME_TYPES`/`ALLOWED_EXTENSIONS` 无 pdf/doc/xls/ppt |
| 不能放大 | 汇报弹窗缩略图 `object-cover` 无点击事件；放大逻辑只长在看板"已完成详情"（`action-done-detail-dialog.tsx:159`） |
| 无在线预览 | 项目内已有"图片 img / PDF iframe / Office 下载"范式（`continuous/page.tsx:1015`），未在汇报场景复用 |

## 2. 目标

1. 汇报附件**不限制类型**（图片/文档/表格/PPT/PDF/压缩包/音视频/文本等），上限 50MB；
2. 图片上传后可点击放大（多图切换、下载、关闭）；
3. 在线预览：能预览就预览、不能就下载；
4. 抽公共预览组件，6 个汇报入口统一复用。

## 3. 用户故事

| 角色 | 诉求 |
|---|---|
| 汇报人 | 能上传 Word/Excel/PDF 等佐证材料；图片能点开放大看 |
| 查看人 | 不用下载就能看 PDF/Word/Excel/文本/音视频 |

## 4. 功能范围

### 含
- 前端 7 处去掉 `accept`/`image` 过滤，`type` 改通用 `file`；
- 后端 `/api/upload` 放开类型白名单（保留 50MB 上限与安全校验）；
- 新建 `ImagePreview`（图片放大）与 `FilePreview`（按类型分派预览）组件；
- 接入 6 个汇报入口 + 统一下载/预览体验；
- 安全：html/svg/js/exe 等强制 `Content-Disposition: attachment`。

### 不含
- PPT 高保真在线预览（本期下载）；
- 旧 `.doc`/`.xls`/`.ppt` 在线渲染（下载）；
- 第三方 Office 在线预览服务（需公网 URL，不做）。

## 5. 预览能力分级

| 类型 | 预览方式 | 依赖 |
|---|---|---|
| jpg/png/gif/webp/bmp | ImagePreview 放大 | 新建组件 |
| PDF | `<iframe>` | 浏览器原生 |
| docx | `mammoth` 转 HTML | 已有 |
| xlsx/xls | `xlsx`(SheetJS) 转表格 | 已有 |
| txt/md/csv/json/log | `<pre>` | 无 |
| 音频/视频 | `<audio>`/`<video>` | 浏览器原生 |
| pptx/pptx、doc、压缩包、未知 | 下载 | 无 |

## 6. 页面/接口结构

| 接口 | 方法 | 说明 |
|---|---|---|
| `/api/upload` | POST | 放开类型；`type` 支持 `file` |
| `/api/files/[id]` | GET | 已有 MIME 映射；补全类型；危险类型强制 attachment |

页面：待办中心 / 我的任务 / 看板 / 追踪 / 项目详情 / 反馈 六个汇报弹窗。

## 7. 交互需求

- 缩略图点击 → 大图；多图左右切换；ESC/遮罩关闭；下载按钮；
- 文件卡片 → 点击预览（可预览）或下载；
- 上传前不因类型被拒。

## 8. 非功能需求

- 上限 50MB（保持）；
- 不做服务端执行、不进可执行目录；
- 预览组件懒加载，避免拖慢汇报弹窗。

## 9. 验收标准

- [ ] 6 个入口均可上传任意类型文件；
- [ ] 图片可放大、多图切换、下载；
- [ ] PDF/Word/Excel/文本/音视频可在线上看；PPT/压缩包/未知可下载；
- [ ] 伪造扩展名仍被魔数校验/安全策略处理，html/svg 不内联渲染；
- [ ] 6 个入口无回归。
