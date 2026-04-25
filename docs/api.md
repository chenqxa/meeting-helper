# 会议纪要与行动项助手 — 后端 API 文档

> 版本: 1.0.0 | 2024-04-07  
> 规范: RESTful | 协议: HTTPS  
> 认证: Bearer Token (JWT)

---

## 统一响应格式

```json
{
  "code": 0,
  "message": "success",
  "data": {},
  "timestamp": "2024-04-07T06:00:00.000Z"
}
```

### 错误码一览

| code | 含义 | HTTP Status |
|------|------|------------|
| `0` | 成功 | 200 |
| `1001` | 文件格式不支持 | 400 |
| `1002` | ASR 服务不可用 | 503 |
| `1003` | 文件大小超限 | 413 |
| `2001` | AI 生成超时 | 504 |
| `2002` | AI 服务不可用 | 503 |
| `2003` | Prompt 超出 token 限制 | 400 |
| `3001` | 版本未锁定，无法导出 | 409 |
| `3002` | 存在未确认的低置信度行动项 | 409 |
| `4001` | 无权限操作 | 403 |
| `4004` | 资源不存在 | 404 |
| `5000` | 服务器内部错误 | 500 |

---

## 一、会议管理

### `POST /api/meetings/create`

创建新会议记录。

**Request Body**

```json
{
  "title": "产品双周会 2024-W14",
  "type": "weekly",
  "meeting_time": "2024-04-07T14:00:00+08:00",
  "organizer": "张三",
  "attendees": ["张三", "李四", "王五"],
  "source_type": "text"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| title | string | ✅ | 会议主题，最长 200 字 |
| type | enum | ✅ | `weekly` \| `review` \| `retrospective` \| `general` |
| meeting_time | datetime | ❌ | ISO 8601 格式，默认为当前时间 |
| organizer | string | ❌ | 组织者姓名 |
| attendees | string[] | ❌ | 参会人列表 |
| source_type | enum | ❌ | `text`（默认）\| `audio` |

**Response**

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "meeting_id": "MTG_20240407_001",
    "id": 1
  },
  "timestamp": "2024-04-07T06:00:00.000Z"
}
```

---

### `GET /api/meetings/list`

分页查询会议列表，支持筛选。

**Query Parameters**

| 参数 | 类型 | 说明 |
|------|------|------|
| page | integer | 页码，默认 1 |
| page_size | integer | 每页数量，默认 20，最大 100 |
| type | string | 按类型筛选 |
| organizer | string | 按组织者筛选 |
| status | string | `draft` \| `locked` \| `archived` |
| start_date | date | 开始日期（YYYY-MM-DD） |
| end_date | date | 结束日期（YYYY-MM-DD） |
| keyword | string | 标题关键词搜索 |

**Response**

```json
{
  "code": 0,
  "data": {
    "list": [
      {
        "id": 1,
        "meeting_id": "MTG_20240407_001",
        "title": "产品双周会 2024-W14",
        "type": "weekly",
        "meeting_time": "2024-04-07T14:00:00+08:00",
        "organizer": "张三",
        "status": "draft",
        "has_low_confidence": true,
        "action_count": 4,
        "created_at": "2024-04-07T06:00:00.000Z"
      }
    ],
    "total": 42,
    "page": 1,
    "page_size": 20
  }
}
```

---

### `GET /api/meetings/{id}`

获取单个会议详情（含转写文本、摘要、行动项）。

**Path Parameters**: `id` 为 `meeting_id`（字符串）

**Response**

```json
{
  "code": 0,
  "data": {
    "meeting": {
      "meeting_id": "MTG_20240407_001",
      "title": "产品双周会 2024-W14",
      "type": "weekly",
      "status": "draft",
      "locked_version": null,
      "attendees": ["张三", "李四"]
    },
    "transcript": {
      "source": "转写文本内容...",
      "asr_status": "success",
      "word_count": 1234
    },
    "summary": [
      {
        "section_type": "agenda",
        "content": "讨论了Q2路线图、AI接入进展...",
        "confidence": 0.92,
        "is_edited": false
      }
    ],
    "actionItems": [
      {
        "id": "1",
        "description": "完成Q2路线图文档",
        "owner": "张三",
        "due_date": "2024-04-12",
        "priority": "high",
        "status": "pending",
        "confidence_owner": 0.95,
        "confidence_date": 0.88,
        "source_sentence": "张三你来负责整理，下周五之前要同步"
      }
    ]
  }
}
```

---

### `PUT /api/meetings/{id}`

更新会议基本信息（标题、参会人等）。

**Request Body**: 与 create 相同字段，全部可选。

---

## 二、文件上传与 ASR 转写

### `POST /api/upload/file`

上传会议文件（文本/音频）。

**Request**: `multipart/form-data`

| 字段 | 说明 |
|------|------|
| file | 文件对象 |
| meeting_id | 关联的会议 ID |
| file_type | `transcript`（转写文本）\| `audio`（录音） |

**支持格式**: `.txt` `.docx` `.mp3` `.wav`  
**大小限制**: 文档 ≤ 10MB，音频 ≤ 500MB

**Response**

```json
{
  "code": 0,
  "data": {
    "file_url": "https://storage.example.com/...",
    "file_name": "meeting_audio.mp3",
    "file_size": 12345678,
    "file_type": "audio"
  }
}
```

**错误**: `1001` 格式不支持 | `1003` 文件过大

---

### `POST /api/transcribe/{meeting_id}`

触发异步 ASR 转写任务。

**Request Body**

```json
{
  "file_url": "https://storage.example.com/audio.mp3",
  "language": "zh-CN"
}
```

**Response**（立即返回，异步处理）

```json
{
  "code": 0,
  "data": {
    "task_id": "TASK_ASR_20240407_001",
    "status": "processing",
    "estimated_seconds": 120
  }
}
```

---

### `GET /api/transcribe/status/{task_id}`

轮询 ASR 任务状态（推荐每 3 秒轮询一次）。

**Response**

```json
{
  "code": 0,
  "data": {
    "task_id": "TASK_ASR_20240407_001",
    "status": "success",
    "progress": 100,
    "transcript": {
      "source": "会议转写文本内容...",
      "word_count": 2341
    },
    "error": null
  }
}
```

| status | 说明 |
|--------|------|
| `pending` | 排队等待 |
| `processing` | 转写中 |
| `success` | 转写完成 |
| `failed` | 转写失败，需文本兜底 |

**错误**: `1002` ASR 服务不可用

---

## 三、AI 能力接口

### `POST /api/ai/summary/{meeting_id}`

异步触发 AI 摘要生成。

**Request Body**

```json
{
  "force_regenerate": false
}
```

**Response**

```json
{
  "code": 0,
  "data": {
    "task_id": "TASK_AI_SUM_001",
    "status": "processing"
  }
}
```

---

### `POST /api/ai/actions/{meeting_id}`

异步触发 AI 行动项抽取（含置信度打分）。

**Response**

```json
{
  "code": 0,
  "data": {
    "task_id": "TASK_AI_ACT_001",
    "status": "processing",
    "partial": false
  }
}
```

**超时处理**: 若 120 秒未完成，返回 `code: 2001`，`data.partial: true`，附已完成的部分结果。

---

## 四、行动项编辑

### `PUT /api/actions/{action_id}`

更新单条行动项（支持增量更新）。

**Request Body**

```json
{
  "description": "修改后的描述",
  "owner": "李四",
  "due_date": "2024-04-20",
  "priority": "high",
  "status": "confirmed",
  "confirmed_by": "张三"
}
```

所有字段均为可选，只传需要修改的字段。

**Response**

```json
{
  "code": 0,
  "data": {
    "action_id": "1",
    "updated_fields": ["owner", "status"],
    "updated_at": "2024-04-07T07:00:00.000Z"
  }
}
```

---

## 五、版本管理

### `POST /api/meetings/{id}/lock`

锁定版本，生成正式稿。

**前置条件**:
- 会议状态为 `draft`
- 无 `status=pending` 且置信度 `< 0.7` 的行动项（否则返回 `3002`）

**Response**

```json
{
  "code": 0,
  "data": {
    "version": 1,
    "locked_at": "2024-04-07T07:00:00.000Z",
    "locked_by": "张三"
  }
}
```

---

### `GET /api/meetings/{id}/versions`

查询历史版本列表。

**Response**

```json
{
  "code": 0,
  "data": {
    "versions": [
      {
        "version_no": 1,
        "locked_at": "2024-04-07T07:00:00.000Z",
        "locked_by": "张三",
        "export_count": 2
      }
    ]
  }
}
```

---

## 六、导出

### `POST /api/meetings/{id}/export`

导出会议纪要文件（需先锁定版本）。

**Request Body**

```json
{
  "format": "word",
  "include_action_items": true,
  "include_transcript": false
}
```

| format | 说明 |
|--------|------|
| `word` | .docx 格式，含可编辑样式 |
| `pdf` | .pdf 格式，含书签导航 |

**Response**

```json
{
  "code": 0,
  "data": {
    "file_url": "https://storage.example.com/exports/...",
    "filename": "产品双周会 2024-W14_2024-04-07_v1.docx",
    "expires_at": "2024-04-14T07:00:00.000Z"
  }
}
```

**错误**: `3001` 版本未锁定

**文件命名规则**: `{会议主题}_{日期}_v{版本号}.{格式}`

---

## 七、操作日志

### `GET /api/meetings/{id}/logs`

查询会议操作日志（保留 90 天）。

**Query Parameters**: `page`, `page_size`, `action`（筛选操作类型）

**Response**

```json
{
  "code": 0,
  "data": {
    "list": [
      {
        "id": 1,
        "action": "lock",
        "operator": "张三",
        "detail": "{\"version\": 1}",
        "ip_address": "192.168.1.1",
        "created_at": "2024-04-07T07:00:00.000Z"
      }
    ],
    "total": 15
  }
}
```

---

## 八、WebSocket 实时推送

针对异步任务（ASR/AI生成），支持 WebSocket 订阅：

```
ws://api.example.com/ws/tasks/{task_id}
```

**推送消息格式**

```json
{
  "event": "task_progress",
  "task_id": "TASK_AI_ACT_001",
  "status": "processing",
  "progress": 65,
  "partial_data": null
}
```

**事件类型**: `task_progress` | `task_complete` | `task_failed` | `task_timeout`

---

## 九、接口安全规范

1. **认证**: 所有接口需携带 `Authorization: Bearer {JWT_TOKEN}`
2. **频率限制**: 
   - 普通接口: 100 req/min/user
   - AI 接口: 10 req/min/user
   - 导出接口: 5 req/min/user
3. **幂等性**: `POST /api/meetings/create` 支持 `Idempotency-Key` 请求头
4. **日志**: 所有写操作自动写入 `operation_logs` 表，含 `operator`、`ip_address`、`detail`
5. **文件安全**: 上传文件进行病毒扫描，仅允许白名单 MIME 类型

---

## 十、部署建议

```yaml
# 推荐技术栈
runtime: Node.js 20+ / Python 3.11+
framework: Next.js API Routes / FastAPI
database: SQL Server 2019+
cache: Redis 7.x (任务状态缓存)
storage: Azure Blob / AWS S3
asr: 讯飞开放平台 / Azure Speech
llm: Azure OpenAI / 阿里云百炼
queue: Azure Service Bus / RabbitMQ (AI异步任务)
```
