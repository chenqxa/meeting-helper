# OA 单点登录到会议纪要助手 需求文档

> 版本：v1.0  ·  状态：待评审
> 涉及：OA 门户菜单、`/interface/EntranceHyzs.jsp`（OA 服务器）、`api/auth/weaver/callback/`、`lib/weaver-sso.ts`、`.env`
> 关联参考：`docs/feature/continuous-weekly-oa-push/`（同风格）、本地备份 `泛微单点登陆到其他系统/`（参考实现）

---

## 一、背景与问题

用户在 OA 里建了「会议纪要助手」菜单，链接直接指向 `https://hjoa.chinahy-soft.com:15815/`。点击后**直接打开会议助手首页，但被要求重新登录**，体验割裂。

**期望**：用户在 OA 已登录的前提下，点击菜单进入会议助手，**无需二次登录**，直接以对应的 OA 账号身份进入。

---

## 二、为什么之前不成功（根因分析）

### 2.1 尝试方式与失败原因

| 尝试方式 | 结果 | 失败原因 |
|----------|------|----------|
| 菜单 URL 直接跳会议助手首页 | ❌ 要重新登录 | **没带任何用户身份凭证** |
| 菜单 URL 直接带 `loginid=xxx` | ❌ 空白 / 跳转失败 | 泛微 E9 菜单自定义 URL 是**纯静态字符串**，**不解析占位符变量**，无法把"当前点击用户"动态传入 |
| 放过 JSP 但签名算法不匹配 | ❌ 校验失败 | 参考 JSP 用 **HMAC-SHA256** + `username` 参数；会议助手之前只认 **MD5** + `loginid` 参数，两边对不上 |

### 2.2 核心结论

> **菜单 URL 无法动态获取"当前登录用户是谁"**。必须在 OA 服务器上放一个 JSP，用 `HrmUserVarify.getUser()` 取当前用户，再签名跳转。这是参考系统（dddl）和所有成功对接泛微 OA 的系统的共同做法。

---

## 三、方案选型

### 3.1 候选方案对比

| 方案 | 机制 | OA 侧操作 | 会议助手侧 | 安全 | 结论 |
|------|------|----------|-----------|------|------|
| **A. JSP + HMAC-SHA256 签名** | OA 放 JSP 取当前用户 → 签名跳转 | 放 1 个 JSP + 改菜单链接 | 校验签名 + 建会话 | 签名防伪造 + 时间戳防重放 | ✅ **采用**（参考系统已验证）|
| B. OA 集成登录模块 | OA 后台配置集成登录，自动带 username | OA 后台配集成登录项 | 识别 username 建会话 | 无签名，GET 传参弱 | ⚠️ 备选（依赖 OA 模块权限）|

### 3.2 采用方案 A

采用与参考系统（dddl）**完全一致**的 JSP + HMAC-SHA256 方案，复用已验证的成熟链路，降低风险。

---

## 四、完整流程

```
用户在 OA 已登录
    ↓ 点击 OA 菜单
┌─────────────────────────────────────────────┐
│ OA 服务器 /interface/EntranceHyzs.jsp        │
│ 1. HrmUserVarify.getUser() 取当前用户 loginid │
│ 2. 未登录 → 跳回 OA 登录页                    │
│ 3. 已登录 → 生成 HMAC-SHA256 签名             │
│    data = loginid + "|" + 时间戳(毫秒)        │
│    sign = Base64(HMAC-SHA256(secret, data))  │
│ 4. 302 跳转会议助手回调                       │
└──────────────────┬──────────────────────────┘
                   ↓
┌─────────────────────────────────────────────┐
│ 会议助手 /api/auth/weaver/callback           │
│ ?username=loginid&timestamp=..&sign=..      │
│ 1. 兼容读取 username / loginid               │
│ 2. 校验时间戳（5 分钟内）                     │
│ 3. 校验 HMAC-SHA256 签名                     │
│ 4. 通过 → resolveUser 补全姓名/部门 → 建会话   │
│ 5. 302 跳转会议助手首页                       │
└──────────────────┬──────────────────────────┘
                   ↓
        用户免登录进入会议助手
```

---

## 五、入口与权限

| 入口 | 说明 |
|------|------|
| **OA 菜单** | 链接改为 `/interface/EntranceHyzs.jsp`（自定义 URL）|
| **JSP** | 部署在 OA 服务器 `D:\WEAVER\ecology\interface\EntranceHyzs.jsp` |
| **会议助手回调** | `/api/auth/weaver/callback`（GET），**公开路径**（`middleware.ts` 白名单）|
| **配置** | `.env` 增加 `WEAVER_SSO_HMAC_SECRET`（与 JSP 内 secret 一致）|

---

## 六、签名安全机制

| 攻击场景 | 防护 |
|----------|------|
| 伪造 `username` 直接访问 | HMAC-SHA256 签名，无密钥无法伪造 |
| URL 截获重放 | 时间戳 5 分钟内有效，过期拒绝 |
| 密钥泄露 | 定期更换 `WEAVER_SSO_HMAC_SECRET` + JSP 同步 |

**签名算法规范**（必须与参考 JSP 一致）：

```
签名数据  = loginid + "|" + 时间戳(毫秒, 13位)
签名结果  = Base64( HmacSHA256(签名数据, secret) )
```

| 参数 | 规范 |
|------|------|
| timestamp | 毫秒级，13 位（`System.currentTimeMillis()`）|
| 分隔符 | 竖线 `\|` |
| 编码 | Base64（非 Hex）|
| 容差 | ±5 分钟（毫秒比较）|

---

## 七、非功能需求

- **兼容**：回调同时兼容 `loginid` / `username` / `lastname` 参数；签名兼容 HMAC-SHA256（新）与 MD5（旧），平滑过渡。
- **安全**：签名失败/过期统一跳 `login?error=sso_failed|expired`；未配置密钥时不强制签名（保持现状兼容）。
- **幂等**：重复点击菜单重复签名跳转，无副作用。
- **性能**：回调只做签名校验 + 用户信息查询（OA API 优先，SQL 降级），毫秒级。
- **扩展**：新增系统只改 JSP 的 targetUrl 即可复用。

---

## 八、验收标准

- [ ] OA 服务器已部署 `EntranceHyzs.jsp`，菜单链接指向它。
- [ ] OA 已登录用户点菜单 → 直接进入会议助手，**无需重新登录**。
- [ ] 进入后身份为 OA 当前用户（如 chenqiaoxia → 陈巧霞）。
- [ ] 未登录 OA 直接访问 JSP → 跳回 OA 登录页。
- [ ] 伪造/篡改签名 → 拒绝（跳 `sso_failed`）。
- [ ] 过期时间戳（>5 分钟）→ 拒绝（跳 `expired`）。
- [ ] `.env` 中 `WEAVER_SSO_HMAC_SECRET` 与 JSP 内 secret 一致。
- [ ] 会议助手手动登录（原 `/api/auth/login`）不受影响。
