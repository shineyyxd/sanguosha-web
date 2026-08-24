# 公网部署指南

把三国杀网页版扔到一台 VPS 上跑起来。全程只需 Docker，单容器、单端口。

## 架构

- 一个 Node 进程同时干两件事：Socket.IO 游戏服务 + 静态托管前端产物（`packages/server/src/static.ts`），默认端口 **3000**
- 账号/战绩数据是单个 SQLite 文件（`node:sqlite`），由 `DB_PATH` 指定，容器内默认 `/data/sgs.db`
- 前端生产模式走**同源相对路径**连接 Socket.IO（`packages/client/src/main.ts`），所以反代只需透传一个域名，不需要额外的 WS 端口或 CORS 配置

## VPS 要求

- 1 核 1G 内存足够（Node + Socket.IO + SQLite，无重计算）
- 任意主流 Linux（Ubuntu/Debian/...），装好 Docker 和 Docker Compose 插件
- 需要 HTTPS 的话准备一个域名，A 记录指向 VPS 公网 IP

## 快速开始（无域名，IP 直连）

```bash
git clone <你的仓库地址> sanguosha-web
cd sanguosha-web
docker compose up -d --build
```

防火墙放行 3000 端口（云厂商安全组 + 系统防火墙都要开）：

```bash
# ufw 示例
sudo ufw allow 3000/tcp
```

浏览器打开 `http://<VPS_IP>:3000` 即可开局。

## 域名 + HTTPS（Caddy，推荐）

Caddy 自动申请/续期 Let's Encrypt 证书，且默认透传 WebSocket，配置只需要三行。

先放行 80/443：

```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
```

Caddyfile：

```caddyfile
sgs.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

启动 Caddy（与游戏同机）：

```bash
docker run -d --name caddy --restart unless-stopped \
  -p 80:80 -p 443:443 \
  -v $PWD/Caddyfile:/etc/caddy/Caddyfile \
  -v caddy-data:/data \
  caddy:2
```

此时游戏容器的 3000 端口可以只绑定到本机，避免绕过 HTTPS 直连。改 `docker-compose.yml`：

```yaml
    ports:
      - "127.0.0.1:3000:3000"
```

> Socket.IO 的 WebSocket 和长轮询都在 `/socket.io/` 路径下走标准 HTTP 升级，Caddy 反代开箱即用，无需额外配置。

## 域名 + HTTPS（Nginx 备选）

证书自行用 certbot 管理，反代配置要点是 WebSocket 升级头：

```nginx
server {
    listen 443 ssl;
    server_name sgs.example.com;

    ssl_certificate     /etc/letsencrypt/live/sgs.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/sgs.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        # WebSocket 透传（Socket.IO 必需）
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        # 对局中的长连接，避免空闲被掐
        proxy_read_timeout 3600s;
    }
}

# 80 端口跳转 HTTPS
server {
    listen 80;
    server_name sgs.example.com;
    return 301 https://$host$request_uri;
}
```

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | 监听端口（容器内），绑定 0.0.0.0 |
| `DB_PATH` | `/data/sgs.db` | SQLite 文件路径；设为空则关闭账号系统（游客模式） |
| `ASK_TIMEOUT_MS` | `30000` | 出牌/响应询问超时，超时由系统托管响应 |
| `CLIENT_DIST` | `/app/client/dist` | 前端产物目录，容器内一般不用改 |
| `DEBUG_ENGINE` | 关 | 设为任意值打印引擎调试日志 |

在 `docker-compose.yml` 的 `environment:` 段修改即可。

## 数据备份

账号和战绩就一个 SQLite 文件，备份 = 拷文件：

```bash
# 从命名卷里拷出来
docker compose cp sanguosha:/data/sgs.db ./backup/sgs-$(date +%F).db
```

恢复：停服 → 把文件拷回卷的对应位置 → 启动。建议 cron 每天备份一次。

## 更新流程

```bash
git pull
docker compose up -d --build
```

数据在命名卷里，重建镜像不影响。SQLite 无迁移框架，版本升级如涉及表结构变更会在 release note 里说明。

## 日志与排障

```bash
# 看日志
docker compose logs -f

# 进容器
docker compose exec sanguosha sh

# 健康检查：首页应返回 HTML，Socket.IO 握手应返回 0{...} JSON
curl -s http://127.0.0.1:3000/ | head -c 200
curl -s 'http://127.0.0.1:3000/socket.io/?EIO=4&transport=polling'
```

常见问题：

- **浏览器能打开但一直转圈/断连**：反代没透传 WebSocket（Nginx 缺 Upgrade 头），Socket.IO 会降级到长轮询，体验差但能用；按上面的配置补齐即可
- **重启后账号没了**：`DB_PATH` 没指向挂载卷，确认 compose 里的 volume 配置
- **容器起不来**：`docker compose logs` 看报错，多数是端口被占（改 ports 左侧）或数据目录权限

## 不用 Docker 的裸机部署（备选）

Node ≥ 22.5（需要 `node:sqlite`，建议 26）：

```bash
npm ci
npm run build -w @sanguosha/client && npm run build -w @sanguosha/server
PORT=3000 DB_PATH=./data/sgs.db node packages/server/dist/server/src/index.js
```

进程管理用 systemd 或 pm2，反代配置同上。

## 局域网模式不受影响

`npm run play` 仍是本地局域网入口：不传 `DB_PATH` 时账号系统关闭，打印二维码即开即玩，与公网部署互不影响。
