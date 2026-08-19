# OA 单点登录到会议纪要助手 开发文档

> 版本：v1.0  ·  状态：待评审
> 关联需求：`docs/feature/oa-sso-login/requirement.md`
> 参考实现：`E:\贞观\源码\源码备份\源码备份\泛微单点登陆到其他系统\dddl\EntranceDddl.jsp`

---

## 一、技术栈与架构

| 项 | 说明 |
|----|------|
| 会议助手 | Next.js 16 (App Router) + TypeScript |
| OA 侧 | 泛微 E-Cology 9，JSP（服务器端取当前用户）|
| 通信 | HTTP 302 重定向 + HMAC-SHA256 签名 |
| 数据源 | SQL Server（`183.134.254.14:2807/AI`），OA 通过链接服务器 `FWsv.ecology` |

---

## 二、改动清单

| 文件 | 改动 | 状态 |
|------|------|------|
| `src/lib/weaver-sso.ts` | 新增 `generateHmacSign` / `verifyHmacSign`（HMAC-SHA256 + Base64）| ✅ 已改 |
| `src/app/api/auth/weaver/callback/route.ts` | ① 兼容 `username` 参数；② 签名验证新增 HMAC-SHA256 分支 | ✅ 已改 |
| `.env` | 新增 `WEAVER_SSO_HMAC_SECRET` | ✅ 已加 |
| `scripts/EntranceHyzs.jsp` | 新增（OA 服务器部署用，基于参考 JSP 改造）| ✅ 已建 |
| `src/middleware.ts` | 无改动（callback 已在公开路径内）| — |

---

## 三、签名算法实现

### 3.1 会议助手侧（`src/lib/weaver-sso.ts`）

```ts
// 与 EntranceDddl.jsp 一致：
// data = loginid + "|" + timestamp; sign = Base64(HMAC-SHA256(secret, data))
export function generateHmacSign(data: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(data, 'utf8').digest('base64');
}

export function verifyHmacSign(data: string, sign: string, secret: string): boolean {
  const expected = generateHmacSign(data, secret);
  // 兼容 URL 编码后的 base64（+ / = 可能被编码）
  const decoded = sign.replace(/%2B/g, '+').replace(/%2F/g, '/').replace(/%3D/g, '=');
  return expected === decoded;
}
```

### 3.2 OA 侧 JSP（`scripts/EntranceHyzs.jsp`）

```jsp
<%
User user = HrmUserVarify.getUser(request, response);
if (user == null) { response.sendRedirect(request.getContextPath() + "/login/Login.jsp"); return; }
String loginid = user.getLoginid();
String targetUrl = "https://hjoa.chinahy-soft.com:15815/api/auth/weaver/callback?redirect=/";
String secret = "<与 .env WEAVER_SSO_HMAC_SECRET 一致>";
long ts = System.currentTimeMillis();
String data = loginid + "|" + ts;
Mac mac = Mac.getInstance("HmacSHA256");
mac.init(new SecretKeySpec(secret.getBytes("UTF-8"), "HmacSHA256"));
String sign = Base64.getEncoder().encodeToString(mac.doFinal(data.getBytes("UTF-8")));
String url = targetUrl + "&username=" + URLEncoder.encode(loginid, "UTF-8")
    + "&timestamp=" + ts + "&sign=" + URLEncoder.encode(sign, "UTF-8");
response.sendRedirect(url);
%>
```

> ⚠️ 时间戳必须**毫秒级**（13位），不能 `/1000`；分隔符是**竖线**；编码是 **Base64**（非 Hex）。

---

## 四、回调处理流程（`callback/route.ts`）

### 4.1 GET 分支

```
1. 读 redirect 参数（默认 /）
2. 无 WEAVER_OA_URL → 跳 login?error=oa_unavailable
3. 若有 ssoToken/token/_key → checkSsoToken 验证（E9 token 方式，保留）
4. 否则：loginid = loginid || username || lastname
5. 无 loginid → 跳 missing_loginid
6. 若有 sign + timestamp：
   a. 时间差 > 5分钟 → 跳 expired
   b. verifyHmacSign(loginid|timestamp) 用 WEAVER_SSO_HMAC_SECRET → 通过
   c. 否则 verifySign({loginid,timestamp}) 用 WEAVER_OA_SECRET (MD5) → 通过
   d. 都不通过 → 跳 sso_failed
7. resolveUser(loginid) 补全姓名/部门
8. buildSessionResponse → 302 首页 + Set-Cookie
```

### 4.2 POST 分支

同样兼容 `loginid || username`，逻辑同 GET 的签名校验。

### 4.3 resolveUser 降级链

```
getUserInfoFromOA(loginid)   // OA REST API（可能 500）
  └─ 失败 → resolveNameFromSQL(loginid)  // 链接服务器查 hrmresource
```

> ⚠️ 已知问题：`getHrmUserInfoByLoginId` 在当前 OA 返回 500（HTML）。代码已用 SQL 降级兜底，不影响登录。

---

## 五、配置

### 5.1 `.env` 新增

```
# OA EntranceJSP 单点跳转 HMAC 签名密钥（须与 OA 服务器 EntranceHyzs.jsp 中 secret 一致）
WEAVER_SSO_HMAC_SECRET=REDACTED_WEAVER_SSO_HMAC_SECRET
```

### 5.2 JSP 部署

```
源文件: scripts/EntranceHyzs.jsp
目标:   D:\WEAVER\ecology\interface\EntranceHyzs.jsp   （OA 服务器）
```

### 5.3 OA 菜单配置

| 配置项 | 值 |
|--------|-----|
| 菜单链接类型 | 自定义 URL |
| 链接地址 | `/interface/EntranceHyzs.jsp` |

---

## 六、数据流与字段映射

```
OA 菜单 → /interface/EntranceHyzs.jsp
  → 取 loginid（当前 OA 用户）
  → sign = Base64(HMAC-SHA256(secret, loginid|timestamp))
  → 302: /api/auth/weaver/callback?username={loginid}&timestamp={ts}&sign={sign}

callback 收到：
  username  → 作为登录账号（兼容 loginid/lastname）
  timestamp → 校验时效（5 分钟）
  sign      → 校验签名（HMAC-SHA256 优先，MD5 兜底）

建会话 → meeting_session cookie → 用户进入系统
```

---

## 七、安全

- HMAC-SHA256 签名，密钥仅 OA 服务器 + 会议助手 `.env` 两处持有。
- 时间戳防重放（±5 分钟）。
- 签名失败/过期/缺参数均有明确 error 标识跳转。
- 未配置 `WEAVER_SSO_HMAC_SECRET` 时：有 sign 则强制验证（失败拒绝）；无 sign 则保持原行为（兼容）。

---

## 八、已知限制

- **OA 集成登录模块**（方案 B）未采用，若后续 OA 侧希望走该模块，callback 已兼容 `username` 参数，仅需 OA 后台配置。
- `getHrmUserInfoByLoginId` 返回 500，依赖 SQL 降级，OA 修复该接口后可去掉降级。
- 正式部署到 Mac 服务器后，需确认 `.env` 中密钥与 JSP 一致，且 OA 白名单已加 Mac 出口 IP。

---

## 九、验证命令

```bash
# 类型检查
npx tsc --noEmit

# 构建
pnpm build

# 本地启动（Node24 兼容补丁）
node scripts/start-node24.cjs

# 手动测试：正确签名登录
node scripts/test-sso-login.cjs   # 或 curl 带 HMAC 签名访问 callback
```

---

## 十、测试要点（详见 test.md）

1. 正确签名 → 登录成功
2. 错误签名 → 拒绝（sso_failed）
3. 过期时间戳 → 拒绝（expired）
4. 空 loginid → 拒绝（missing_loginid）
5. username 参数（无 loginid）→ 正常登录
6. 手动登录 `/api/auth/login` 不受影响
