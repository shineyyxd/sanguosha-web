/**
 * 浏览器入口：建立 socket 连接 + ClientCore，启动 Phaser 游戏。
 *
 * 服务器地址：默认走同源（Vite dev server 把 /socket.io 代理到 :3000）；
 * 也可用 VITE_SERVER_URL 环境变量直连远端服务器。
 */

import Phaser from 'phaser';
import { io } from 'socket.io-client';
import { ClientCore } from './core/client.js';
import { LobbyScene } from './scenes/LobbyScene.js';
import { RoomScene } from './scenes/RoomScene.js';
import { TableScene } from './scenes/TableScene.js';

const serverUrl = import.meta.env.VITE_SERVER_URL as string | undefined;
// 握手带上账号会话 token（ws 与 http 轮询都会带）：刷新/换设备后服务器据此恢复登录态。
// 用回调形式：登录后 socket.io 自动重连时会重新读取最新 token。
const auth = (cb: (data: { token: string }) => void) =>
  cb({ token: window.localStorage.getItem(ClientCore.sessionTokenKey()) ?? '' });
const socket = serverUrl ? io(serverUrl, { auth }) : io({ auth });
const core = new ClientCore(socket, window.localStorage);

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'app',
  // RESIZE：画布跟随窗口实际尺寸，牌桌布局由场景按实际宽高动态计算（手机/桌面自适应）
  width: window.innerWidth,
  height: window.innerHeight,
  backgroundColor: '#1a1f2b',
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [LobbyScene, RoomScene, TableScene],
});

game.registry.set('core', core);

// 调试 / e2e 钩子：暴露会话内核，便于在浏览器控制台或端到端测试中读取状态、注入操作
(window as unknown as { __sgs: ClientCore; __game: Phaser.Game }).__sgs = core;
(window as unknown as { __sgs: ClientCore; __game: Phaser.Game }).__game = game;
