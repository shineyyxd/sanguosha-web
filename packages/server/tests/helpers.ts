/**
 * 集成测试工具：起真实服务器（端口 0 随机分配）+ socket.io-client 连接 + 机器人策略。
 */

import { io as clientIo, type Socket } from 'socket.io-client';
import { createGameServer, type GameServer, type GameServerOptions } from '../src/index.js';
import {
  CLIENT_EVENTS,
  SERVER_EVENTS,
  type AskEvent,
  type GeneralChooseEvent,
  type PublicPlayer,
  type PublicState,
  type RoomInfo,
} from '../src/protocol.js';
import type { AskRequest, AskResponse } from '../../engine/src/index.js';

export interface TestServer {
  server: GameServer;
  url: string;
}

export async function startTestServer(options: GameServerOptions = {}): Promise<TestServer> {
  const server = createGameServer(options);
  await server.listen(0);
  return { server, url: `http://127.0.0.1:${server.port()}` };
}

export function connect(url: string): Promise<Socket> {
  const socket = clientIo(url, { transports: ['websocket'], forceNew: true });
  return new Promise((resolve, reject) => {
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', reject);
  });
}

/** emit + ack 的 Promise 封装（载荷缺省为 {}）。 */
export function emitAck<T>(socket: Socket, event: string, payload: unknown = {}): Promise<T> {
  return new Promise((resolve) => socket.emit(event, payload, resolve));
}

/** 等待一条满足条件的服务器推送。 */
export function waitFor<T>(
  socket: Socket,
  event: string,
  pred?: (data: T) => boolean,
  timeoutMs = 8000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`等待 ${event} 超时（${timeoutMs}ms）`));
    }, timeoutMs);
    const handler = (data: T) => {
      if (pred && !pred(data)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(data);
    };
    socket.on(event, handler);
  });
}

export interface TestClient {
  socket: Socket;
  code: string;
  playerId: string;
  token: string;
}

/** 建房 + 加入 + 双方准备，返回两个客户端（host 为房主）。 */
export async function setupTwoPlayers(url: string): Promise<{ host: TestClient; guest: TestClient }> {
  const [host, guest] = await setupPlayers(url, 2);
  return { host, guest };
}

/** 建房 + N-1 人加入 + 全部非房主准备，返回 N 个客户端（第一个为房主）。 */
export async function setupPlayers(url: string, count: number): Promise<TestClient[]> {
  const names = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛'];
  const hostSocket = await connect(url);
  const created = await emitAck<{ ok: boolean; room: RoomInfo; token: string; playerId: string }>(
    hostSocket,
    CLIENT_EVENTS.createRoom,
    { name: names[0] },
  );
  if (!created.ok) throw new Error('建房失败');

  const clients: TestClient[] = [
    { socket: hostSocket, code: created.room.code, playerId: created.playerId, token: created.token },
  ];
  for (let i = 1; i < count; i++) {
    const socket = await connect(url);
    const joined = await emitAck<{ ok: boolean; token: string; playerId: string }>(
      socket,
      CLIENT_EVENTS.joinRoom,
      { code: created.room.code, name: names[i] },
    );
    if (!joined.ok) throw new Error('加入房间失败');
    clients.push({ socket, code: created.room.code, playerId: joined.playerId, token: joined.token });
    await emitAck(socket, CLIENT_EVENTS.ready, { ready: true });
  }
  return clients;
}

/** 开始一场对局（默认空白武将 + 固定种子，可复现），并等所有人都收到首份状态。 */
export async function startGame(
  host: TestClient,
  others: TestClient | TestClient[],
  payload: { seed?: number; generals?: string[]; roles?: ('lord' | 'loyalist' | 'rebel' | 'renegade')[] } = {},
): Promise<void> {
  const rest = Array.isArray(others) ? others : [others];
  const all = [host, ...rest];
  const states = all.map((c) => waitFor<PublicState>(c.socket, SERVER_EVENTS.stateUpdate));
  const ack = await emitAck<{ ok: boolean; error?: string }>(host.socket, CLIENT_EVENTS.startGame, {
    seed: 42,
    generals: all.map(() => 'blank'),
    ...payload,
  });
  if (!ack.ok) throw new Error(`开局失败：${ack.error}`);
  await Promise.all(states);
}

export function closeAll(server: GameServer, ...sockets: Socket[]): Promise<void> {
  for (const s of sockets) s.disconnect();
  return server.close();
}

// ---------- 机器人策略（客户端侧，只能看到 PublicState + AskRequest） ----------

/**
 * 简单机器人：响应窗口有所求的牌就打（无懈只在自己成为目标时打），
 * 没有则用转化技；出牌阶段残血吃桃、每回合至多杀一刀（攻击存活环上最近的目标，
 * 保证距离合法），其余放弃；选将时拿第一个候选。
 * 通过 state:update 跟踪自己的手牌；每回合只杀一刀以免引擎重问死循环。
 */
export function attachBot(client: TestClient): void {
  const { socket } = client;
  let state: PublicState | null = null;
  let lastShaTurn = -1;

  socket.on(SERVER_EVENTS.stateUpdate, (s: PublicState) => {
    state = s;
  });

  // 选将：拿第一个候选（确定性，便于可复现）
  socket.on(SERVER_EVENTS.generalChoose, ({ candidates }: GeneralChooseEvent) => {
    socket.emit(CLIENT_EVENTS.pickGeneral, { generalId: candidates[0].id }, () => {});
  });

  socket.on(SERVER_EVENTS.ask, ({ ask }: AskEvent) => {
    const respond = (response: AskResponse) =>
      socket.emit(CLIENT_EVENTS.respond, { response }, () => {});
    const me = state?.me.id === ask.playerId ? state.me : null;
    const hand = me?.hand ?? [];

    if (ask.kind === 'choose-card') return respond({ cardId: ask.cards[0].id });
    if (ask.kind === 'confirm') return respond({ confirm: true });
    if (ask.kind === 'choose-target') return respond({ pass: true });
    // 互斥选项（刚烈/反间）：选第一项
    if (ask.kind === 'choose-option') return respond({ choice: ask.options[0].id });
    // 遗计分配：自己保留；鬼才改判：不改；观星：全部回顶
    if (ask.kind === 'give-card') return respond({ pass: true });
    if (ask.kind === 'judge-retrial') return respond({ pass: true });
    if (ask.kind === 'guanxing') return respond({ pass: true });
    // 弃牌阶段（不可放弃）：自动弃末尾的牌
    if (ask.kind === 'discard') return respond({ cardIds: hand.slice(-ask.count).map((c) => c.id) });

    if (ask.kind === 'response') {
      if (ask.wants === 'wuxie' && ask.targetId !== ask.playerId) return respond({ pass: true });
      const card = hand.find((c) => c.name === ask.wants);
      if (card) return respond({ cardId: card.id });
      // 转化技：多牌转化（丈八蛇矛）按 count 凑齐 cardIds
      const conv = ask.converts?.find((c) => c.cardIds.length >= (c.count ?? 1));
      if (conv) {
        const need = conv.count ?? 1;
        return respond(
          need > 1
            ? { useSkill: conv.skillId, cardIds: conv.cardIds.slice(0, need) }
            : { useSkill: conv.skillId, cardId: conv.cardIds[0] },
        );
      }
      return respond({ pass: true });
    }

    // 出牌阶段
    const turn = state?.turn ?? -1;
    const mePub = state?.players.find((p) => p.id === ask.playerId);
    if (mePub && mePub.hp < mePub.maxHp) {
      const tao = hand.find((c) => c.name === 'tao');
      if (tao) return respond({ cardId: tao.id });
    }
    if (turn !== lastShaTurn) {
      const sha = hand.find((c) => c.name === 'sha');
      const target = sha ? nearestTarget(state, ask.playerId) : undefined;
      if (sha && target) {
        lastShaTurn = turn;
        return respond({ cardId: sha.id, targetId: target.id });
      }
    }
    return respond({ pass: true });
  });
}

/** 存活玩家中座位环上距离最近者（最近邻在存活环上距离为 1，保证杀得到）。 */
function nearestTarget(state: PublicState | null, playerId: string): PublicPlayer | undefined {
  if (!state) return undefined;
  const n = state.players.length;
  const me = state.players.find((p) => p.id === playerId);
  if (!me) return undefined;
  const ring = (p: { seat: number }) => {
    const d = Math.abs(p.seat - me.seat);
    return Math.min(d, n - d);
  };
  return state.players
    .filter(
      (p) =>
        p.id !== playerId &&
        p.alive &&
        // 空城中的诸葛亮不能成为杀的目标（客户端机器人按公开信息规避）
        !(p.generalId === 'zhugeliang' && p.handCount === 0),
    )
    .sort((a, b) => ring(a) - ring(b))[0];
}
