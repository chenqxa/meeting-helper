# 企业微信域名验证指南

## 步骤1：下载验证文件

1. 登录企业微信管理后台
2. 进入 **应用管理** → **会议助手** 应用
3. 找到 **网页授权及JS-SDK** 或 **可信域名** 设置
4. 点击"下载文件"，得到 `WW_verify_xxxxx.txt` 文件
5. 用记事本打开，复制文件内容（一串字母数字）

## 步骤2：配置验证文件

打开文件：`src/app/WW_verify_placeholder.txt/route.ts`

修改以下两个变量：

```typescript
// 1. 将验证文件的内容粘贴到这里
const VERIFY_CONTENT = '1234567890abcdef...'; // 替换为你复制的内容

// 2. 修改为实际的文件名
const VERIFY_FILENAME = 'WW_verify_abc123.txt'; // 替换为实际文件名
```

## 步骤3：重命名路由文件

将文件名从 `src/app/WW_verify_placeholder.txt/route.ts` 
重命名为 `src/app/WW_verify_你的验证码.txt/route.ts`

例如：如果你的文件是 `WW_verify_abc123.txt`，
则重命名为：`src/app/WW_verify_abc123.txt/route.ts`

## 步骤4：测试访问

```bash
# 重启服务
pnpm dev

# 在浏览器访问（替换为你的实际文件名）
http://hjoa.chinahy-soft.com:15815/WW_verify_abc123.txt

# 应该看到一串验证码
```

## 步骤5：在企业微信后台验证

1. 回到企业微信管理后台
2. 在可信域名输入框填写：`hjoa.chinahy-soft.com:15815`
3. 点击"确定"或"申请校验"
4. 等待验证通过

## 步骤6：添加IP白名单

验证域名后，还需要添加服务器IP到白名单：

1. 在企业微信后台找到 **企业可信IP** 设置
2. 添加你的外网IP或内网IP
3. 如果不知道IP，可以暂时填 `0.0.0.0/0`（测试用）

## 完成！

配置完成后，再次运行测试：
```bash
pnpm tsx scripts/test-wecom.ts
```

应该能成功获取用户列表并发送测试消息了！
