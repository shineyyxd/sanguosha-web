/**
 * 再来一局：game:over 后房间进入 over 状态，座位与连接保留，
 * 房主可直接 game:start 重开（重新发牌/发身份/选将），不需要重建房。
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  CLIENT_EVENTS,
  SERVER_EVENTS,
  type Card,
  type GameOverEvent,
  type GeneralChooseEvent,
  type PublicState,
  type RoleAssignEvent,
  type RoomInfo,
} from '../src/protocol.js';
import {
  attachBot,
  closeAll,
  emitAck,
  setupPlayers,
  setupTwoPlayers,
  startTestServer,
  waitFor,
} from './helpers.js';

/** 等房间状态进入 over（game:over 与状态翻转同拍，收 room:update 更稳）。 */
function waitRoomOver(socket: Parameters<typeof waitFor>[0]): Promise<RoomInfo> {
  return waitFor<RoomInfo>(socket, SERVER_EVENTS.roomUpdate, (r) => r.status === 'over', 60_000);
}

describe('再来一局', () => {
  it('1v1 结算后可直接重开：座位保留，两局各自跑完且初始手牌独立', async () => {
    const ts = await startTestServer();
    const { host, guest } = await setupTwoPlayers(ts.url);
    attachBot(host);
    attachBot(guest);

    // 每局的第一份带手牌状态（gameOver 计数区分两局）
    let games = 0;
    host.socket.on(SERVER_EVENTS.gameOver, () => games++);
    const firstHands: string[][] = [];
    host.socket.on(SERVER_EVENTS.stateUpdate, (s: PublicState) => {
      // 比较 牌名+花色+点数（id 含全局发牌序号，跨局必然不同，没有比较意义）
      if (s.status === 'playing' && s.me.hand.length > 0 && firstHands.length === games) {
        firstHands.push(s.me.hand.map((c: Card) => `${c.name}:${c.suit}:${c.rank ?? ''}`));
      }
    });

    // 第一局（seed 42）
    const over1 = waitFor<GameOverEvent>(host.socket, SERVER_EVENTS.gameOver, undefined, 60_000);
    const roomOver1 = waitRoomOver(host.socket);
    let ack = await emitAck<{ ok: boolean; error?: string }>(host.socket, CLIENT_EVENTS.startGame, {
      seed: 42,
      generals: ['blank', 'blank'],
    });
    expect(ack.ok).toBe(true);
    await over1;
    const room1 = await roomOver1;
    // 房间还在，座位与连接保留
    expect(room1.players.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(room1.players.every((p) => p.online)).toBe(true);

    // 第二局（seed 43，无需重新准备/重建房）
    const playing2 = waitFor<PublicState>(
      guest.socket,
      SERVER_EVENTS.stateUpdate,
      (s) => s.status === 'playing',
    );
    const over2 = waitFor<GameOverEvent>(host.socket, SERVER_EVENTS.gameOver, undefined, 60_000);
    ack = await emitAck<{ ok: boolean; error?: string }>(host.socket, CLIENT_EVENTS.startGame, {
      seed: 43,
      generals: ['blank', 'blank'],
    });
    expect(ack.ok).toBe(true);
    await playing2;

    const result2 = await over2;
    expect(['p1', 'p2']).toContain(result2.winnerId);
    // 两局初始手牌由各自种子独立洗牌
    expect(firstHands.length).toBe(2);
    expect(firstHands[1]).not.toEqual(firstHands[0]);

    await closeAll(ts.server, host.socket, guest.socket);
  }, 90_000);

  it('同种子重开可复现（状态完全重置，不是上一局的延续）', async () => {
    const ts = await startTestServer();
    const { host, guest } = await setupTwoPlayers(ts.url);
    attachBot(host);
    attachBot(guest);

    const firstHands: string[][] = [];
    let games = 0;
    host.socket.on(SERVER_EVENTS.gameOver, () => games++);
    host.socket.on(SERVER_EVENTS.stateUpdate, (s: PublicState) => {
      // 每局的第一份带手牌状态：gameOver 计数区分两局
      // 比较 牌名+花色+点数（id 含全局发牌序号，两局不同；同种子洗牌结果应一致）
      if (s.status === 'playing' && s.me.hand.length > 0 && firstHands.length === games) {
        firstHands.push(s.me.hand.map((c: Card) => `${c.name}:${c.suit}:${c.rank ?? ''}`));
      }
    });

    const over1 = waitFor<GameOverEvent>(host.socket, SERVER_EVENTS.gameOver, undefined, 60_000);
    const roomOver1 = waitRoomOver(host.socket);
    let ack = await emitAck<{ ok: boolean }>(host.socket, CLIENT_EVENTS.startGame, {
      seed: 42,
      generals: ['blank', 'blank'],
    });
    expect(ack.ok).toBe(true);
    await over1;
    await roomOver1;

    const over2 = waitFor<GameOverEvent>(host.socket, SERVER_EVENTS.gameOver, undefined, 60_000);
    ack = await emitAck<{ ok: boolean }>(host.socket, CLIENT_EVENTS.startGame, {
      seed: 42,
      generals: ['blank', 'blank'],
    });
    expect(ack.ok).toBe(true);
    await over2;

    expect(firstHands.length).toBe(2);
    expect(firstHands[1]).toEqual(firstHands[0]); // 同种子 → 同样的初始手牌

    await closeAll(ts.server, host.socket, guest.socket);
  }, 90_000);

  it('身份局重开：重新私发身份 + 重新选将', async () => {
    const ts = await startTestServer();
    const clients = await setupPlayers(ts.url, 4);
    for (const c of clients) attachBot(c);
    const host = clients[0];

    const roles: (RoleAssignEvent | null)[] = [null, null];
    const drafts: (GeneralChooseEvent | null)[] = [null, null];
    let games = 0;
    host.socket.on(SERVER_EVENTS.gameOver, () => games++);
    host.socket.on(SERVER_EVENTS.roleAssign, (e: RoleAssignEvent) => {
      if (games < 2) roles[games] = e;
    });
    host.socket.on(SERVER_EVENTS.generalChoose, (e: GeneralChooseEvent) => {
      if (games < 2) drafts[games] = e;
    });

    // 第一局（不指定武将 → 走选将）
    const over1 = waitFor<GameOverEvent>(host.socket, SERVER_EVENTS.gameOver, undefined, 120_000);
    const roomOver1 = waitRoomOver(host.socket);
    let ack = await emitAck<{ ok: boolean; error?: string }>(host.socket, CLIENT_EVENTS.startGame, {
      seed: 7,
    });
    expect(ack.ok).toBe(true);
    await over1;
    await roomOver1;
    expect(roles[0]).not.toBeNull();
    expect(drafts[0]).not.toBeNull();

    // 第二局：身份与选将都重新走一遍
    const over2 = waitFor<GameOverEvent>(host.socket, SERVER_EVENTS.gameOver, undefined, 120_000);
    ack = await emitAck<{ ok: boolean; error?: string }>(host.socket, CLIENT_EVENTS.startGame, {
      seed: 8,
    });
    expect(ack.ok).toBe(true);
    await over2;
    expect(roles[1]).not.toBeNull();
    expect(drafts[1]).not.toBeNull();
    // 两局都完整分出胜负
    expect(roles[1]!.role).toBeTruthy();

    await closeAll(ts.server, ...clients.map((c) => c.socket));
  }, 240_000);

  it('对局进行中不能重开；非房主不能重开', async () => {
    const ts = await startTestServer();
    const { host, guest } = await setupTwoPlayers(ts.url);
    attachBot(host);
    attachBot(guest);

    const over = waitFor<GameOverEvent>(host.socket, SERVER_EVENTS.gameOver, undefined, 60_000);
    const roomOver = waitRoomOver(host.socket);
    await emitAck(host.socket, CLIENT_EVENTS.startGame, { seed: 42, generals: ['blank', 'blank'] });

    // 进行中：房主重开被拒，非房主开局被拒
    let ack = await emitAck<{ ok: boolean; error?: string }>(host.socket, CLIENT_EVENTS.startGame, {});
    expect(ack.ok).toBe(false);
    ack = await emitAck<{ ok: boolean; error?: string }>(guest.socket, CLIENT_EVENTS.startGame, {});
    expect(ack.ok).toBe(false);

    await over;
    await roomOver;

    // 结算后：非房主仍然不能开
    ack = await emitAck<{ ok: boolean; error?: string }>(guest.socket, CLIENT_EVENTS.startGame, {});
    expect(ack.ok).toBe(false);
    expect(ack.error).toContain('房主');

    await closeAll(ts.server, host.socket, guest.socket);
  }, 90_000);
});
