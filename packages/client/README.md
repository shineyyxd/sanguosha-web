# @sanguosha/client

三国杀网页版 Phaser 3 客户端（Vite + TypeScript）。

## 启动

开发模式：

```bash
npm run server   # 终端 1：游戏服务器（:3000）
npm run client   # 终端 2：Vite dev server（:5173，/socket.io 代理到 :3000）
```

生产/局域网面杀模式（单端口，详见根 README）：

```bash
npm run play     # 根目录：构建 client+server，:3000 同端口托管页面与 Socket.IO
```

浏览器开两个标签访问 http://localhost:5173：一个创建房间，另一个输入房间码加入，
都准备后房主点「开始游戏」。刷新页面会凭 localStorage 里的 token 自动重连。

直连远端服务器：`VITE_SERVER_URL=http://host:3000 npm run client`（跳过代理）。

## 手机端适配

- Phaser Scale 用 RESIZE 模式，画布跟随窗口实际尺寸；牌桌所有坐标由
  `src/ui/layout.ts` 的 `computeTableLayout(w, h)` 动态计算（基准 1280x800，
  纵向按比例、横向以中心排布，牌面/面板缩放并设触屏下限）。
- 牌桌横屏设计：竖屏时显示「请横屏游玩」遮罩（选将阶段除外，DOM 覆盖层竖屏可用）。
- 手牌过多时自动缩牌 + 压缩重叠（间距有触屏热区下限）；按钮高度 ≥44px。
- `index.html`：viewport-fit=cover + 安全区内边距、禁止双击缩放与橡皮筋滚动。
- e2e 通过 `window.__sgsTable`（TableScene 每次重绘发布的可点元素实际坐标）点击，
  不再硬编码布局公式；`e2e/mobile.spec.ts` 覆盖 iPhone 13 竖屏/横屏用例。

## 结构

- `src/protocol.ts` —— 协议类型，**拷贝自 `packages/server/src/protocol.ts`（手工同步，
  差异仅引擎类型的 import 路径）**；改服务器协议后必须同步此文件。
- `src/core/client.ts` —— ClientCore：socket 封装 + 会话状态机（房间/状态/询问/等待/日志），
  不依赖 Phaser，可单测、可无头运行。
- `src/core/vm.ts` —— 视图模型：PublicState/AskRequest → 提示文案、可出/可选预判、
  Selection → AskResponse 组装。纯逻辑，vitest 覆盖。
- `src/scenes/` —— LobbyScene / RoomScene（DOM 覆盖层表单）、TableScene（Phaser 图形牌桌）。
- `src/ui/layout.ts` —— 响应式布局公式（纯函数，不依赖 Phaser，vitest 覆盖）。
- `src/ui/widgets.ts` —— 纯色卡牌/按钮组件（无美术素材）。
- `tests/` —— vitest 单测；`smoke/` —— 真实服务器 + 双机器人冒烟（`npm run smoke`）。

## 原则

客户端零信任：只渲染服务器下发的视角状态，点击只组装 AskResponse 发意图，
所有合法性由服务器/引擎最终校验（vm 里的预判只用于高亮和按钮可用性）。
