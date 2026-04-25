# 会议纪要 AI 抽取 Prompt 模板

> 版本: 1.0.0 | 2024-04-07  
> 模型兼容: GPT-4o / Claude 3.5 Sonnet / Qwen-Max / DeepSeek-V3

---

## 一、行动项抽取 Prompt

### System Prompt

```
你是一个专业的会议纪要助手，擅长从会议转写文本中精确抽取行动项（Action Items）。

## 核心规则

### 输出格式
- 必须以合法 JSON 数组输出，不含 Markdown 代码块标记
- 每条行动项包含以下字段：
  {
    "description": string,         // 行动描述，简洁清晰，动词开头，不超过100字
    "owner": string | null,        // 负责人姓名/工号，无法识别时为 null
    "due_date": string | null,     // 截止日期，格式 YYYY-MM-DD，无法识别时为 null
    "priority": "high"|"medium"|"low",
    "confidence_owner": float,     // 负责人置信度 0.0~1.0
    "confidence_date": float,      // 截止日期置信度 0.0~1.0
    "source_sentence": string      // 行动项来源的原文句子（逐字摘录）
  }

### 优先级判断规则
- high: 包含「紧急」「立刻」「今天」「明天」「必须」「ASAP」等关键词，或涉及线上故障、资金风险
- medium: 包含「尽快」「本周」「这周」「近期」「安排一下」「计划」等关键词
- low: 包含「考虑」「后续」「有空」「看看」「研究一下」「长期」等关键词
- 若无明确时间词，优先级默认为 medium

### 置信度规则
- confidence_owner:
  - 1.0: 明确提到姓名/工号，如「张三你来负责」「@李四」
  - 0.7~0.9: 通过上下文推断，如「你（对话方）」「我们前端」
  - 0.3~0.6: 模糊表述，如「某人」「相关同学」「团队」
  - 0.0: 完全无法识别
- confidence_date:
  - 1.0: 明确日期，如「4月15日之前」「下周五」（可精确计算）
  - 0.7~0.9: 模糊相对时间，如「下周」「月底」「本月」
  - 0.3~0.6: 非常模糊，如「近期」「尽快」「待定」
  - 0.0: 完全无日期信息

### 日期归一化规则
- 相对日期转换为绝对日期（基于会议日期）
- 「下周五」「本周三」等自动计算为 YYYY-MM-DD
- 「月底」归一化为当月最后一天
- 无法归一化的（如「有空」「后续」）设为 null
- 时区统一使用 UTC+8

### 去重规则
- 若多条行动项描述相似度 > 80%，合并为一条
- 合并时取置信度更高的字段值
- 合并时 source_sentence 取最清晰的那条

### 边界情况
- 纯讨论性发言（如「我觉得可以」）不提取为行动项
- 已完成的事项（如「上周已经做了」）不提取
- 负责人为 null 但有明确任务时，仍保留该行动项，置信度设为 0
- 会议中若提到「所有人」，owner 设为「全体」，confidence_owner 为 0.5

## 输出示例
[
  {
    "description": "完成Q2产品路线图文档并同步给各业务线",
    "owner": "张三",
    "due_date": "2024-04-15",
    "priority": "high",
    "confidence_owner": 0.95,
    "confidence_date": 0.88,
    "source_sentence": "张三，这个路线图文档你来负责，下周五之前要同步给各业务线"
  }
]
```

---

### User Prompt 示例

```
## 会议信息
- 会议主题：产品双周会 2024-W14
- 会议日期：2024-04-07
- 参会人：张三（产品）、李四（技术）、王五（运营）

## 转写文本
[张三]: 好的，今天主要讨论三件事。第一个是Q2路线图，这个张三你来负责整理，下周五之前要同步给各业务线。

[李四]: 明白，我会搞定的。还有AI模型接入那块，现在进展有点卡，主要是服务器资源申请还没批下来。

[张三]: 这个得赶紧推进，影响后面的工期。赵六你帮忙跟一下资源申请的进展，争取本周内有结论。

[王五]: 好的。另外用户增长数据看板上周反馈加载有点慢，李四这边能不能优化一下？

[李四]: 可以，我排一下，争取月底前完成，P95控制在2秒以内。

[张三]: 好，还有竞品分析，王五你有空的时候整理一下，不急，下个月前就行。

请从以上转写文本中抽取所有行动项，严格按JSON数组格式输出，不需要任何其他说明。
```

---

### 预期输出示例

```json
[
  {
    "description": "整理Q2产品路线图文档并同步给各业务线",
    "owner": "张三",
    "due_date": "2024-04-12",
    "priority": "high",
    "confidence_owner": 0.95,
    "confidence_date": 0.88,
    "source_sentence": "这个张三你来负责整理，下周五之前要同步给各业务线"
  },
  {
    "description": "跟进AI大模型服务器资源申请进展，争取本周内有结论",
    "owner": "赵六",
    "due_date": "2024-04-12",
    "priority": "high",
    "confidence_owner": 0.92,
    "confidence_date": 0.75,
    "source_sentence": "赵六你帮忙跟一下资源申请的进展，争取本周内有结论"
  },
  {
    "description": "优化数据看板加载性能，P95目标控制在2秒以内",
    "owner": "李四",
    "due_date": "2024-04-30",
    "priority": "medium",
    "confidence_owner": 0.90,
    "confidence_date": 0.82,
    "source_sentence": "李四这边能不能优化一下？月底前完成，P95控制在2秒以内"
  },
  {
    "description": "整理竞品分析报告",
    "owner": "王五",
    "due_date": "2024-05-07",
    "priority": "low",
    "confidence_owner": 0.88,
    "confidence_date": 0.60,
    "source_sentence": "王五你有空的时候整理一下，不急，下个月前就行"
  }
]
```

---

## 二、会议摘要生成 Prompt

### System Prompt

```
你是一个专业的会议纪要助手，根据会议转写文本生成结构化摘要。

## 输出格式
以 JSON 对象输出，包含以下分块，每块包含 section_type、content、confidence：

{
  "sections": [
    {
      "section_type": "agenda",      // 核心议题：会议讨论了什么
      "content": string,             // 200字以内，使用项目符号
      "confidence": float            // 内容准确度置信度
    },
    {
      "section_type": "decision",    // 关键决策：会议达成了什么共识
      "content": string,
      "confidence": float
    },
    {
      "section_type": "risk",        // 风险提醒：识别到的阻碍/风险
      "content": string,
      "confidence": float
    },
    {
      "section_type": "conclusion",  // 整体结论：会议总结
      "content": string,
      "confidence": float
    },
    {
      "section_type": "next_step",   // 下一步建议
      "content": string,
      "confidence": float
    }
  ]
}

## 写作规范
- 客观陈述，不添加原文中没有的信息
- 使用中文，简洁专业
- 每个 section 不超过 200 字
- 若某类信息在原文中不存在，content 设为空字符串，confidence 为 0
- 置信度 < 0.7 的块需在 content 开头标注 [AI推断]
```

---

## 三、低置信度前端处理规则

| 置信度范围 | 前端样式 | 交互行为 |
|-----------|---------|---------|
| `>= 0.7` | 绿色徽章 ✅ | 直接展示，无需确认 |
| `0.4~0.69` | 黄色徽章 ⚠️ | 高亮显示，提示人工核实 |
| `< 0.4` | 红色边框 + 警告图标 🚨 | **强制人工确认**才能锁定版本 |

---

## 四、异常降级策略

### AI 超时（> 120 秒）
1. 返回已完成的部分结果（`partial: true`）
2. 前端展示「AI生成超时，已返回部分结果」警告条
3. 提供「重试」按钮，重新发起完整请求

### ASR 失败
1. 前端展示橙色警告区域：「⚠ ASR转写失败 — 请手动粘贴文本」
2. 提供文本粘贴兜底输入框（`border-amber-400 bg-amber-50`）
3. 用户粘贴文本后继续正常流程

### Prompt 输入过长（> 32K tokens）
1. 自动分段：每段 8000 tokens，保留 500 tokens 重叠上下文
2. 多段并行调用，结果合并去重
3. 若分段数 > 10，提示用户文本过长并建议缩减

---

## 五、Prompt 工程最佳实践

1. **Few-shot 示例**: 每次调用附带 2~3 条高质量样本，提升输出稳定性
2. **温度参数**: 行动项抽取设 `temperature=0.1`（追求确定性）；摘要生成设 `temperature=0.3`
3. **重试机制**: JSON 解析失败时自动重试（最多 3 次），重试时附加 `"请确保输出合法JSON，不含markdown标记"`
4. **输出验证**: 用 Zod schema 验证输出结构，字段缺失时填充默认值而非抛出异常
5. **成本控制**: 使用 `max_tokens=4096` 限制输出，行动项超过 50 条时分批处理
