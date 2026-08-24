/**
 * @sanguosha/server —— Node + Socket.IO 联机服务器入口。
 *
 * 职责：
 * - 房间管理（创建/加入/座次分配，纯内存）
 * - 作为引擎的驱动层：GameSession 消费 Game 产出的 AskRequest，
 *   路由给对应玩家的 socket，收集响应（含 30s 超时托管）后 resume 引擎
 * - 按视角过滤下发 PublicState，断线凭 token 重连恢复
 *
 * 启动：
 * - 开发：npm run dev（tsx watch）
 * - 产物：npm run build && npm start
 * - 端口：PORT 环境变量，默认 3000；ASK_TIMEOUT_MS 可配置询问超时
 * - 静态托管：自动探测 packages/client/dist（或 CLIENT_DIST 指定），存在则
 *   同端口托管游戏页面；绑定 0.0.0.0，启动时打印局域网入局地址
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lanAddresses } from './lan.js';
import { createGameServer } from './server.js';

export * from './protocol.js';
export { createGameServer, didWin, type GameServer, type GameServerOptions } from './server.js';
export { GameSession, type SessionOptions } from './session.js';
export { RoomManager, Room } from './rooms.js';
export { createStaticHandler } from './static.js';
export { lanAddresses } from './lan.js';
export { AuthService, SESSION_TTL_MS, hashPassword, verifyPassword } from './auth.js';
export {
  SqliteRepository,
  type GameRepository,
  type MatchRecord,
  type NewMatchRecord,
  type UserRow,
  type UserStats,
} from './repository.js';

/**
 * 探测 client 构建产物位置：
 * - CLIENT_DIST 环境变量优先；
 * - tsx 开发时本文件在 packages/server/src/ → ../../client/dist；
 * - 构建产物在 packages/server/dist/server/src/ → ../../../../client/dist。
 * 都找不到则返回 undefined（纯 Socket.IO 服务，不托管页面）。
 */
export function resolveStaticDir(): string | undefined {
  if (process.env.CLIENT_DIST) return process.env.CLIENT_DIST;
  const candidates = [
    '../../client/dist',
    '../../../../client/dist',
  ];
  for (const rel of candidates) {
    const dir = fileURLToPath(new URL(rel, import.meta.url));
    if (existsSync(join(dir, 'index.html'))) return dir;
  }
  return undefined;
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop()!);

if (isMain) {
  const port = Number(process.env.PORT ?? 3000);
  const askTimeoutMs = process.env.ASK_TIMEOUT_MS ? Number(process.env.ASK_TIMEOUT_MS) : undefined;
  const staticDir = resolveStaticDir();
  // 账号系统数据库：DB_PATH 环境变量，默认 ./data/sgs.db；':memory:' 为纯内存（不持久化）
  const dbPath = process.env.DB_PATH ?? './data/sgs.db';
  const server = createGameServer({
    askTimeoutMs,
    staticDir,
    dbPath,
    debugLog: process.env.DEBUG_ENGINE ? (msg) => console.log(`[engine] ${msg}`) : undefined,
  });
  await server.listen(port);
  console.log(`三国杀服务器已启动：http://localhost:${port}（Socket.IO${staticDir ? ' + 静态托管' : ''}，账号数据库 ${dbPath}）`);
  for (const ip of lanAddresses()) {
    console.log(`  局域网入口（手机浏览器打开）：http://${ip}:${port}`);
  }
}
