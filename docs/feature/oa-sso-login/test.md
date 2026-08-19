# OA 单点登录到会议纪要助手 测试文档

> 版本：v1.0  ·  状态：待评审
> 关联需求：`docs/feature/oa-sso-login/requirement.md`
> 测试方式：手工用例表（项目当前无自动化测试框架）

---

## 一、测试范围

| 范围 | 说明 |
|------|------|
| 会议助手侧 | `callback/route.ts` 签名验证、参数兼容、会话建立 |
| OA 侧 | JSP 部署、菜单配置、跳转参数 |
| 集成 | 完整链路 OA → 会议助手免登录 |

---

## 二、环境与前置条件

| 项 | 说明 |
|----|------|
| 会议助手 | 本地 `http://localhost:5000`（开发验证）或正式 `https://hjoa.chinahy-soft.com:15815` |
| OA | `http://hjoa.chinahy-soft.com:9099`，管理员账号 |
| 测试账号 | `chenqiaoxia`（陈巧霞）|
| 前置 | ① `.env` 已配 `WEAVER_SSO_HMAC_SECRET`；② JSP 已部署 OA 服务器；③ 菜单已指向 JSP |
| 密钥 | `REDACTED_WEAVER_SSO_HMAC_SECRET` |

---

## 三、测试用例表

### 3.1 会议助手侧（可本地验证）

| 编号 | 用例 | 前置 | 步骤 | 预期 | 优先级 |
|------|------|------|------|------|--------|
| T01 | 正确签名登录 | 服务已启动 | 用正确 secret 生成 `sign=HMAC-SHA256(loginid\|ts)`，访问 `callback?username=chenqiaoxia&timestamp=ts&sign=sign&redirect=/` | HTTP 307 → 首页，Set-Cookie 有 session | P0 |
| T02 | 登录后身份正确 | T01 后 | 用返回 cookie 访问 `/api/auth/me` | `loginid=chenqiaoxia, name=陈巧霞, role=admin` | P0 |
| T03 | 错误签名被拒 | 服务已启动 | 用错误 secret 生成签名访问 callback | 307 → `login?error=sso_failed` | P0 |
| T04 | 过期时间戳被拒 | 服务已启动 | 用 10 分钟前的时间戳 + 正确签名访问 | 307 → `login?error=expired` | P0 |
| T05 | 空 loginid 被拒 | 服务已启动 | 访问 `callback?loginid=&redirect=/` | 307 → `login?error=missing_loginid` | P1 |
| T06 | username 参数兼容 | 服务已启动 | 只传 `username=chenqiaoxia`（无 sign）访问 | 307 → 首页，正常登录 | P1 |
| T07 | 手动登录不受影响 | 服务已启动 | `POST /api/auth/login {loginid:chenqiaoxia}` | success，正常建会话 | P1 |
| T08 | 无 sign 仍可登录 | 服务已启动 | 访问 `callback?loginid=chenqiaoxia&redirect=/`（无 sign）| 307 → 首页（保持原兼容）| P2 |

### 3.2 OA 侧（需 OA 管理员）

| 编号 | 用例 | 前置 | 步骤 | 预期 | 优先级 |
|------|------|------|------|------|--------|
| T09 | JSP 部署生效 | JSP 已放 `ecology/interface/` | 浏览器直接访问 `http://OA/interface/EntranceHyzs.jsp` | 未登录 OA → 跳 OA 登录页；已登录 → 跳会议助手 | P0 |
| T10 | 菜单跳转 | 菜单已指向 JSP | OA 登录后点菜单 | 自动进入会议助手首页，免登录 | P0 |

### 3.3 集成回归

| 编号 | 用例 | 前置 | 步骤 | 预期 | 优先级 |
|------|------|------|------|------|--------|
| T11 | 未登录 OA 直接访问 JSP | JSP 已部署 | 退出 OA 后访问 JSP URL | 跳回 OA 登录页（不泄露身份）| P1 |
| T12 | 篡改 username 被拒 | 已登录 OA | 手动改 URL 中 username 为他人 + 保留原 sign | 签名不匹配 → 拒绝（sso_failed）| P1 |

---

## 四、回归清单

- [ ] 会议助手手动登录（`/login` + `/api/auth/login`）正常
- [ ] 归档分享链接（`/meeting/[id]?shared=true`）正常
- [ ] 持续项推送 / 填报统计正常
- [ ] 待办推送（企微）正常

---

## 五、缺陷记录模板

| 字段 | 值 |
|------|-----|
| 编号 | BUG-001 |
| 发现日期 |  |
| 用例编号 | T0x |
| 现象 |  |
| 期望 |  |
| 实际 |  |
| 根因 |  |
| 修复 |  |
| 状态 | 待修复 |
