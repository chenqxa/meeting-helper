# 泛微OA单点登录配置说明

## 配置流程

### 1. Next.js应用端配置

#### 环境变量配置

在 `.env` 文件中添加以下配置：

```env
# 泛微OA单点登录配置
WEAVER_OA_URL=https://your-oa-domain.com
WEAVER_OA_SECRET=your_shared_secret_key
```

- `WEAVER_OA_URL`: 泛微OA系统的访问地址
- `WEAVER_OA_SECRET`: 共享密钥，用于验证请求来源（可选，建议配置）

#### SSO回调接口

Next.js应用已内置SSO回调接口：`/api/auth/weaver/callback`

支持两种请求方式：

**GET方式（推荐）：**
```
https://yourapp.com/api/auth/weaver/callback?loginid=用户工号&username=用户名
```

**POST方式：**
```json
POST https://yourapp.com/api/auth/weaver/callback
{
  "loginid": "用户工号",
  "username": "用户名"
}
```

---

### 2. 泛微OA端配置

#### 方式一：集成登录（推荐）

1. **登录OA管理员后台**
   - 使用管理员账号登录泛微OA系统

2. **进入集成登录配置**
   - 路径：`系统设置` → `集成中心` → `集成登录`
   - 或直接访问：`/integration/login`

3. **创建新的集成登录项**
   - 点击【新建】按钮
   - 填写以下信息：
     - **类型**：选择"通用"（E9版本）
     - **标识**：唯一标识符，如 `meeting-system`
     - **名称**：显示名称，如"会议纪要系统"
     - **地址**：Next.js应用的SSO回调地址
       ```
       https://yourapp.com/api/auth/weaver/callback?loginid={loginid}&username={username}
       ```
     - **表达式**：用户信息表达式
       - `{loginid}` - 用户工号
       - `{username}` - 用户名
       - `{department}` - 部门
       - `{email}` - 邮箱

4. **保存配置**
   - 点击【保存】按钮

5. **测试**
   - 点击【测试】按钮验证配置是否正确
   - 测试成功后，用户在OA门户点击菜单即可跳转到Next.js应用

---

#### 方式二：通过Token认证

如果OA要求使用Token方式验证：

1. **配置接口白名单**
   
   编辑OA服务器配置文件 `ecology/WEB-INF/prop/weaver_session_filter.properties`，在 `unchecksessionurl=` 后追加：
   ```
   /api/ec/dev/auth/regist;/api/ec/dev/auth/applytoken;
   ```

2. **发放许可证（APPID）**
   
   在OA数据库执行SQL：
   ```sql
   INSERT INTO ECOLOGY_BIZ_EC(ID, APPID, NAME)
   VALUES('1001', '生成的UUID', '会议纪要系统');
   COMMIT;
   ```

3. **注册许可（只需调用一次）**
   
   ```
   POST http://OA地址/api/ec/dev/auth/regist
   Headers:
     appid: <你的APPID>
     cpk: "123"
   ```
   
   返回：OA的公钥（spk）和加密后的secret

4. **获取Token**
   
   ```
   POST http://OA地址/api/ec/dev/auth/applytoken
   Headers:
     appid: <你的APPID>
     secret: <用OA公钥加密后的secret>
     time: <当前时间戳>
   ```
   
   返回：token（一次性有效）

5. **跳转到OA页面**
   
   获取token后，拼接到OA页面URL：
   ```
   http://OA地址/目标页面.jsp?ssoToken=<token值>
   ```

---

## 安全建议

1. **使用HTTPS**
   - 生产环境必须使用HTTPS协议
   - 避免敏感信息在传输过程中被截获

2. **验证来源**
   - Next.js回调接口会验证Referer是否来自OA
   - 建议配置 `WEAVER_OA_SECRET` 进行额外验证

3. **会话管理**
   - Cookie设置为HttpOnly和Secure
   - 设置合理的过期时间（当前配置为7天）

4. **IP白名单（可选）**
   - 在OA端配置允许访问的IP地址
   - 或在Next.js端验证请求来源IP

---

## 故障排查

### 问题1：跳转后显示"来源验证失败"

**原因**：Referer验证失败

**解决方案**：
1. 检查 `.env` 中的 `WEAVER_OA_URL` 配置是否正确
2. 确保OA跳转时携带了正确的Referer头
3. 如果OA使用内网地址，需要配置内网URL

### 问题2：跳转后未创建会话

**原因**：缺少用户标识参数

**解决方案**：
1. 检查OA集成登录配置中的地址是否包含 `{loginid}` 或 `{username}` 参数
2. 查看浏览器控制台是否有错误信息

### 问题3：Cookie未设置

**原因**：Cookie SameSite属性限制

**解决方案**：
1. 确保OA和Next.js应用使用相同的域名或子域名
2. 或将SameSite设置为`none`（需配合Secure）

---

## 测试步骤

1. **本地测试**
   - 在本地环境配置OA地址
   - 手动访问回调接口测试：
     ```
     http://localhost:5000/api/auth/weaver/callback?loginid=testuser&username=测试用户
     ```
   - 检查是否成功跳转到首页并创建会话

2. **OA集成测试**
   - 在OA端配置集成登录
   - 点击测试按钮验证
   - 在OA门户点击菜单测试实际跳转

3. **生产部署**
   - 更新环境变量为生产环境配置
   - 验证HTTPS配置
   - 进行端到端测试
