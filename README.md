# 三国杀网页版

npm workspaces 单仓：`packages/engine`（规则引擎）、`packages/server`（Socket.IO 联机服务器，:3000）、
`packages/client`（Phaser + Vite 浏览器客户端，dev :5173）。

## 局域网面杀（手机扫码入局）

```bash
npm run play
```

一条命令完成：构建 client + 构建 server + 启动服务器。服务器绑定 `0.0.0.0`，
直接用 Node 静态托管 `client/dist`——手机连同一 Wi-Fi，浏览器打开终端里打印的
`http://<电脑IP>:3000`（或扫终端二维码）即可加入，不需要 vite、不需要第二个端口。

**macOS 防火墙**：首次启动若弹出「是否允许 node 接受传入连接」，点允许；
若手机打不开页面，到 系统设置 → 网络 → 防火墙，确认 node（或关闭防火墙）允许传入连接。
Windows 同理需在防火墙提示中允许 Node.js 的专用网络访问。

## 开发模式

```bash
npm run server   # 终端 1：游戏服务器（:3000，tsx watch）
npm run client   # 终端 2：Vite dev server（:5173，/socket.io 代理到 :3000）
```

开发模式保持 vite 代理不变；生产模式（`npm run play` / `npm start -w @sanguosha/server`）
由服务器自动探测并托管 `packages/client/dist`（也可用 `CLIENT_DIST` 环境变量指定）。

## 账号与战绩（可选）

- 大厅可注册/登录（用户名 + 密码，scrypt 加盐哈希存储），也可跳过直接以游客身份游玩；
  登录后昵称默认用账号名，战绩（模式/身份/武将/胜负/存活回合数）在局末自动入库，
  「我的战绩」面板可查看总场次、胜率、按身份胜负与最近 10 场。游客不写战绩。
- 登录态凭 localStorage 里的会话 token（30 天有效）自动恢复，刷新/换设备不掉身份；
  座位 token 丢失时还可凭账号会话找回房间座位。
- 数据库用 Node 26 内置的 `node:sqlite`，默认文件 `./data/sgs.db`，
  可用 `DB_PATH` 环境变量改路径（`DB_PATH=:memory:` 为纯内存、不持久化）。
  数据层是 repository 接口（`server/src/repository.ts`），以后换 PostgreSQL 只换实现。

## 测试

```bash
npm test                              # 全部 vitest 单测
npm run typecheck                     # 全部 workspace typecheck
npm run test:e2e -w @sanguosha/client # Playwright e2e（桌面 + 手机视口，自动起服务）
npm run smoke -w @sanguosha/client    # 真实服务器 + 双机器人全链路冒烟
```

## 手机端说明

- 牌桌为横屏设计：竖屏进入对局会显示「请横屏游玩」提示（不强制旋转）；
  大厅 / 房间 / 选将界面竖屏可正常使用。
- 布局随窗口大小动态计算（Phaser Scale RESIZE），桌面宽屏与手机窄屏均可玩。
- 手牌过多时自动缩小牌面并加大重叠，保证一屏内全部可点。
