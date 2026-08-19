# 部署文档

## 1. 切换到项目目录
```bash
e:
cd e:\traexm\hyzs\projects
```

## 2. 本地启动
```bash
pnpm dev
```

## 3. 构建项目
```bash
pnpm run build
```

## 4. 构建 Docker 镜像（多架构）
```bash
docker buildx build --platform linux/amd64,linux/arm64 -t chenqxa/meeting:latest --push .
```

## 5. 服务器更新
```bash
# 停止并删除旧容器
docker stop meeting-app && docker rm meeting-app

# 拉取新镜像
docker pull chenqxa/meeting:latest

# 启动新容器
docker run -d --name meeting-app -p 18081:5000 --env-file /Users/mac/hjgd-IM/docker/meeting-assistant/.env chenqxa/meeting:latest
```
