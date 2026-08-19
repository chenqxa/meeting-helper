# ASR 说话人识别集成记录

> **项目**：会议纪要助手 (hyzs) — 会议录音自动转写并标注说话人，用于生成结构化会议纪要
> **最后更新**：2026-05-25
> **目标**：录音过程中或结束后，输出「说话人1：…  说话人2：…」格式的带标注转写文稿

---

## 🏁 当前架构（2026-05-25 重构后）

> **架构升级**：从「两阶段 豆包流式 + 腾讯Flash后处理」重构为「**三选一纯实时 WebSocket**」架构。
> 所有 Provider 全程 WebSocket 流式推流，**不需要对象存储，不需要文件上传**。

### ✅ 三个可用 Provider 对比

| | 讯飞实时 (`xf_rt`) | 腾讯实时 (`tencent_rt`) | 听悟 (`tingwu`) |
|---|---|---|---|
| **说话人分离时机** | ✅ 每字实时（最快） | ✅ 每句断句后补标 | ✅ 停止后精确处理（~15s） |
| **说话人数据字段** | `result.rt[].rl`（0-indexed） | `result.word_list[].spk_id` | `payload.speaker_id` / 停止后 `Paragraphs[].SpeakerId` |
| **协议** | 纯 WebSocket 二进制 PCM | WebSocket 二进制 PCM | WebSocket 二进制 PCM（先 HTTP 创建任务） |
| **说话人参数** | URL 参数 `roleType=2` 自动开启 | URL 参数 `speaker_diarization=1` | 创建任务时 `SpeakerCount`（0=自动） |
| **重连机制** | 无需（25分钟超时） | 每4分钟自动重连 | 无需（任务制） |
| **停止额外动作** | 发 `{"end":true}`，等800ms | 发最后PCM，等500ms | 发 StopTranscription + 调 stop-task API，轮询完成 |
| **需要存储桶** | ❌ 不需要 | ❌ 不需要 | ❌ 不需要 |
| **UI 说话人颜色** | 蓝/绿/紫/橙循环 | 蓝/绿/紫/橙循环 | 蓝/绿/紫/橙循环 |

### 👤 用户体验流程

**讯飞实时 / 腾讯实时：**
1. 点击「开始录音」→ 说话人标签实时出现（讯飞每字级，腾讯每句级）
2. 点击「停止」→ 300ms 后回调完整文本，立即可用

**听悟：**
1. 点击「开始录音」→ 实时显示转写（含初步说话人）
2. 点击「停止」→ 显示「分析说话人...」转圈
3. 等待约 15 秒 → 文本自动替换为高精度带标签版本，显示「说话人已标注」

---

## 📋 所有方案测试汇总

> 状态说明：**🟢 生产中** = 当前 UI 可选；**🟡 代码保留** = 不在 UI 展示但代码存在；**🔴 失败/放弃** = 已验证不可用

| # | 方案 | 类型 | 状态 | 说话人识别 | 中文质量 | 备注 |
|---|------|------|------|-----------|---------|------|
| **1** | **讯飞实时 RTASR** | **实时 WebSocket** | **🟢 生产中** | **✅ 每字实时** | **⭐⭐⭐⭐** | **参数 rl 标注说话人序号** |
| **2** | **腾讯实时 ASR** | **实时 WebSocket** | **🟢 生产中** | **❌ 不支持** | **⭐⭐⭐⭐⭐** | **16k 引擎均不支持 speaker_diarization，纯转写** |
| **3** | **通义听悟 实时** | **任务制 WebSocket** | **� 生产中** | **✅ 停止后精确** | **⭐⭐⭐⭐⭐** | **SpeakerCount 自动检测，停止后轮询** |
| 4 | 豆包 SAUC 流式 | 实时流式 | 🟡 代码保留 | ❌ 不支持 | ⭐⭐⭐⭐⭐ | 已从 UI 移除，代码保留 |
| 5 | 讯飞 LFASR 文件转写 | 批量异步 | 🔴 失败 | ✅ 支持 | ⭐⭐⭐⭐ | 付费服务，无法免费使用 |
| 6 | 百度短语音 | 实时流式 | 🟡 代码保留 | ❌ 不支持 | ⭐⭐⭐ | 已从 UI 移除 |
| 7 | 腾讯云 Flash ASR | 文件同步 HTTP | � 代码保留 | ✅ 支持 | ⭐⭐⭐⭐⭐ | 已不在主流程，代码保留 |
| 8 | 火山引擎 AUC 异步 | 批量异步 | � 放弃 | ✅ 支持 | ⭐⭐⭐⭐⭐ | 必须提供公网 audio.url，架构复杂 |
| 9 | 百度 AASR 文件转写 | 批量异步 | 🔴 放弃 | ✅ 支持 | ⭐⭐⭐ | 必须提供 speech_url，架构复杂 |

---

## 🎵 音频格式要求

| Provider | 采样率 | 声道 | 格式 | 发送间隔 | 单次限制 |
|----------|--------|------|------|---------|---------|
| 讯飞实时 | 16kHz | 单声道 | PCM 二进制 | 40ms | 无硬限制 |
| 腾讯实时 | 16kHz | 单声道 | PCM 二进制 | 100ms | ≤3秒音频/次（96000字节） |
| 听悟 | 16kHz | 单声道 | PCM 二进制 | 40ms | 无硬限制 |

> 前端 AudioWorklet 采集 48kHz，`pcm-processor.js` 内部降采样到 16kHz 16bit 单声道，满足所有 Provider。

---

## 🔍 各方案接入详情

---

### 1. 讯飞实时 RTASR 🟢 生产中

| 项目 | 详情 |
|------|------|
| 签名路由 | `/api/asr/xf-rt-sign` |
| **端点** | `wss://rtasr.xfyun.cn/v1/ws` |
| 鉴权 | HMAC-MD5 签名 URL（含 `ts`、`signa`） |
| 说话人参数 | URL 参数 `roleType=2`（开启说话人分离），`roleNum=0`（自动检测人数） |
| 说话人字段 | `result.rt[0].rl`（0-indexed，+1 转为「说话人1」） |
| 结果类型 | `pgs=rpl` 中间结果，`pgs=apd` 最终结果 |
| **Env（必填）** | `IFLYTEK_ASR_APPID` · `IFLYTEK_ASR_API_KEY` |

**踩坑记录：**

| 报错 | 原因 | 解决方案 |
|------|------|---------|
| code `10105` | 未开通 RTASR 服务 | 前往讯飞控制台开通「实时语音转写」服务 |

---

### 2. 腾讯实时 ASR � 生产中

| 项目 | 详情 |
|------|------|
| 签名路由 | `/api/asr/tencent-ws-sign` |
| **端点** | `wss://asr.cloud.tencent.com/asr/v2/{AppId}` |
| 鉴权 | HMAC-SHA1 + Base64，所有参数字典序排列签名 |
| **引擎** | `16k_zh`（普通话） |
| **说话人分离** | ❌ 不支持（16k 引擎均返回 4001 错误） |
| 转写字段 | `result.voice_text_str` |
| 结果类型 | `slice_type=0/1` 中间结果，`slice_type=2` 最终结果 |
| 超时处理 | 每 4 分钟自动重连（腾讯 WS 约 5 分钟超时） |
| **Env（必填）** | `TENCENT_ASR_APPID` · `TENCENT_ASR_SECRET_ID` · `TENCENT_ASR_SECRET_KEY` |

**重要说明：**
- `speaker_diarization=1` 对 `16k_zh` 和 `16k_zh_en` 均返回 `4001: parameter not supported`，实测确认不可用
- 腾讯实时 WebSocket 只提供纯转写，**无说话人分离**
- 不需要 COS 存储桶，完全 WebSocket 流式
- `TENCENT_ASR_APPID` 为纯数字 ID，非 SecretId

---

### 3. 通义听悟 实时 � 生产中

| 项目 | 详情 |
|------|------|
| API 路由 | `/api/tingwu/create-task`、`/api/tingwu/stop-task`、`/api/tingwu/get-task` |
| **流程** | HTTP 创建任务 → 获取推流 URL → WebSocket 推流 → HTTP 停止任务 → 轮询完成 |
| **端点** | 创建任务：`https://tingwu.cn-beijing.aliyuncs.com/openapi/...` |
| 说话人参数 | 创建任务时 `SpeakerCount: participantCount`（0=自动检测） |
| **实时说话人字段** | `payload.speaker_id`（SentenceEnd / TranscriptionResultChanged，0-indexed，+1 转为「说话人1」） |
| **最终说话人字段** | 停止后轮询 OSS URL，`Paragraphs[].SpeakerId`（0-indexed，+1 转为「说话人1」） |
| 停止流程 | 发 `StopTranscription`（含 `task_id`、`appkey`）→ 调 stop-task API → 轮询 get-task → 下载 OSS 结果 |
| UI 状态 | 轮询中显示「分析说话人...」，完成显示「说话人已标注」 |
| **Env（必填）** | `TINGWU_ACCESS_KEY_ID` · `TINGWU_ACCESS_KEY_SECRET` · `NEXT_PUBLIC_TINGWU_APP_KEY` |

**踩坑记录：**

| 问题 | 原因 | 解决方案 |
|------|------|---------|
| StopTranscription 无响应 | header 里缺 `task_id` 和 `appkey` | 已修复，两个字段必填 |
| 说话人编号不一致 | 实时路径 `+1`，轮询路径未 `+1` | 已统一，两条路径均 `parseInt(id, 10) + 1` |
| 轮询最终结果为空 | `Result.Transcription` 字段在 `_debug` 里 | 通过 `data._debug?.Result?.Transcription` 取 OSS URL |

---

## 🔑 环境变量速查

```env
# ── 讯飞实时（必填）────────────────────────────────────────────
IFLYTEK_ASR_APPID=            # 讯飞应用 AppId
IFLYTEK_ASR_API_KEY=          # 讯飞应用 ApiKey

# ── 腾讯实时（必填）────────────────────────────────────────────
TENCENT_ASR_APPID=            # 纯数字 ID（如 1302000000），非 SecretId
TENCENT_ASR_SECRET_ID=        # 腾讯云 SecretId
TENCENT_ASR_SECRET_KEY=       # 腾讯云 SecretKey

# ── 通义听悟（必填）────────────────────────────────────────────
TINGWU_ACCESS_KEY_ID=         # 阿里云 AccessKeyId
TINGWU_ACCESS_KEY_SECRET=     # 阿里云 AccessKeySecret
NEXT_PUBLIC_TINGWU_APP_KEY=   # 听悟 AppKey（前端可见）

# ── 旧版保留（当前不在 UI 中，代码存在）──────────────────────────
VOLCENGINE_APP_KEY=           # 豆包 SAUC（已隐藏）
VOLCENGINE_ACCESS_KEY=        # 豆包 SAUC（已隐藏）
VOLCENGINE_ASR_RESOURCE_ID=volc.seedasr.sauc.duration
BAIDU_ASR_APP_ID=             # 百度短语音（已隐藏）
BAIDU_ASR_API_KEY=
BAIDU_ASR_SECRET_KEY=
```

---

## 🚨 快速故障排查

### 讯飞实时无说话人标签
1. 确认讯飞控制台已开通「实时语音转写 RTASR」服务
2. 检查 URL 参数中是否有 `roleType=2`（签名路由里已内置）
3. code `10105` = 服务未开通，切换腾讯实时

### 腾讯实时无说话人标签
1. 确认签名路由里有 `speaker_diarization: '1'`
2. 说话人只在 `slice_type=2`（句子结束）时才有 spk_id，中间状态无标签是正常的
3. 确认 `TENCENT_ASR_APPID` 为纯数字 ID

### 听悟停止后一直转圈
1. 查看控制台 `[Tingwu] 轮询中...` 后的 `taskStatus` 值
2. 如果一直是 `RUNNING`，检查 stop-task API 是否正确调用
3. 确认 StopTranscription 的 `task_id` 和 `appkey` 字段是否正确传入
4. 最多轮询 30 次（60 秒），超时后静默结束，使用实时流式结果

### 听悟说话人不准确
1. `participantCount` 是否从会议页面正确传入（`meeting.participants?.length`）
2. 参与人数为 0 时启用自动检测，准确度依赖录音质量
3. 建议录音 ≥30 秒，说话人间有明显停顿

---

## 📜 历史踩坑记录（归档）

### 旧版豆包 SAUC 踩坑

| 报错 | 原因 | 解决方案 |
|------|------|---------|
| `403: resource not granted` | resource_id 用了 `volc.bigasr.sauc.duration` | **正确值**：`volc.seedasr.sauc.duration` |
| `400 Bad Request` | 端点路径用了 `/bigmodel` | **正确值**：`/bigmodel_async` |
| 返回空结果 | init 帧加了 `enable_speaker_info: true` | 流式接口不支持，删除即可 |

### 旧版腾讯 Flash ASR 踩坑

| 报错 | 原因 | 解决方案 |
|------|------|---------|
| 鉴权失败 | Query 参数顺序与签名不一致 | 参数必须字典序排列，签名和 URL 顺序严格一致 |
| AppId 错误 | 填了 SecretId 而非数字 AppId | `TENCENT_ASR_APPID` 为 `1302000000` 格式纯数字 |
