# 项目问题清单

## 🔴 待解决

### 1. 听悟 ASR - Invalid app key（服务器）
- **现象**：服务器启动录音报 `code: 400, Invalid app key.`
- **根因**：`NEXT_PUBLIC_TINGWU_APP_KEY` 是构建时烧录，`.env` 编码问题导致构建时读取失败，客户端发送 `'default'` 给阿里云
- **当前状态**：已改为服务端读取 `TINGWU_APP_KEY`，最新镜像已推送，待最终测试确认
- **服务器操作**：确认 `.env` 中 `TINGWU_APP_KEY=GhuPY5p5GAY3Kv2g`

### 2. 麦克风录音 - HTTP 环境下失败
- **现象**：`Cannot read properties of undefined (reading 'getUserMedia')`
- **根因**：浏览器安全限制，`getUserMedia` 仅在 HTTPS 或 localhost 下可用
- **访问地址**：`http://hjoa.chinahy-soft.com:15815`（HTTP，非 HTTPS）
- **临时方案**：Chrome 地址栏访问 `chrome://flags/#unsafely-treat-insecure-origin-as-secure`，添加该地址
- **彻底方案**：服务器配置 HTTPS（Nginx + Let's Encrypt 或 Caddy）

---

## 🟡 已修复（待验证）

### 3. .env 编码问题
- **现象**：`docker run` 报 `invalid utf8 bytes at line 2`
- **根因**：`.env` 文件 GBK 编码含中文注释
- **修复**：服务器 `.env` 已转换为 UTF-8，或使用 `--env-file` 指定 `.env.utf8`

### 4. Docker 多架构问题
- **现象**：服务器（arm64）拉取 amd64 镜像报 warning
- **现状**：使用 `--platform linux/amd64` 强制拉取，以模拟层运行，功能正常但性能略低
- **彻底方案**：构建时加 `--platform linux/arm64` 生成原生 arm64 镜像

---

## 🟢 正常功能

| 功能 | 状态 |
|------|------|
| 腾讯分段 ASR（Flash + VAD） | ✅ 正常 |
| 讯飞实时 ASR | ✅ 正常 |
| 会议纪要生成 | ✅ 正常 |
| OA 集成登录 | ✅ 正常 |
| 行动项看板 | ✅ 正常 |
| 项目空间 | ✅ 正常 |

---

## 📝 部署说明

- **镜像**：`chenqxa/meeting:latest`（amd64）
- **服务器**：`mac@macdeMac-Studio`，Mac Studio（arm64）
- **端口**：18081（外部）→ 5000（容器内部）
- **env 文件**：`/Users/mac/hjgd-IM/docker/meeting-assistant/.env`
- **重要**：`TINGWU_APP_KEY` 为运行时读取，改值只需更新 `.env` 并重启容器，无需重新构建镜像
