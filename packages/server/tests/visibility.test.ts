/** 视角过滤：手牌内容只有本人可见；公共日志不含私有信息。 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SERVER_EVENTS, type PublicState } from '../src/protocol.js';
import {
  attachBot,
  closeAll,
  setupTwoPlayers,
  startGame,
  startTestServer,
  waitFor,
  type TestServer,
} from './helpers.js';

describe('视角过滤', () => {
  let ts: TestServer;
  beforeEach(async () => {
    ts = await startTestServer();
  });
  afterEach(async () => {
    await ts.server.close();
  });

  it('A 只能看到 B 的手牌数量，看不到内容；自己的手牌完整可见', async () => {
    const { host, guest } = await setupTwoPlayers(ts.url);
    // 注意：waitFor 要在 startGame 之前注册，否则错过首份状态
    const stateAPromise = waitFor<PublicState>(
      host.socket,
      SERVER_EVENTS.stateUpdate,
      (s) => s.me.hand.length >= 4,
    );
    const stateBPromise = waitFor<PublicState>(
      guest.socket,
      SERVER_EVENTS.stateUpdate,
      (s) => s.me.hand.length >= 4,
    );
    await startGame(host, guest, { seed: 42 });
    const [stateA, stateB] = await Promise.all([stateAPromise, stateBPromise]);

    // 自己的手牌：有完整内容
    expect(stateA.me.id).toBe('p1');
    expect(stateA.me.hand.every((c) => typeof c.name === 'string' && c.id)).toBe(true);

    // 对方玩家条目：只有 handCount，没有 hand 字段
    const bInA = stateA.players.find((p) => p.id === 'p2')!;
    expect(bInA.handCount).toBe(4);
    expect('hand' in bInA).toBe(false);

    // B 手牌的任何一张牌 id 都不应出现在 A 的状态序列化里
    const bHandIds = stateB.me.hand.map((c) => c.id);
    const serializedA = JSON.stringify(stateA);
    for (const id of bHandIds) expect(serializedA.includes(id)).toBe(false);

    // 公共字段齐全：阶段 / 回合 / 牌堆剩余 / 弃牌堆
    expect(stateA.turn).toBeGreaterThanOrEqual(1);
    expect(stateA.deckCount).toBeGreaterThan(0);
    expect(stateA).toHaveProperty('discardTop');
    expect(stateA).toHaveProperty('pendingPlayerId');
    expect(stateA.players[0].currentPhase).not.toBeUndefined();

    await closeAll(ts.server, host.socket, guest.socket);
  });

  it('公共日志只含公开事件（摸牌只有数量，没有牌面）', async () => {
    const { host, guest } = await setupTwoPlayers(ts.url);
    const logs: string[] = [];
    host.socket.on(SERVER_EVENTS.log, ({ message }: { message: string }) => logs.push(message));
    attachBot(host);
    attachBot(guest);
    await startGame(host, guest, { seed: 42 });

    // 等到双方都行动过（至少 2 个回合）
    await waitFor<PublicState>(host.socket, SERVER_EVENTS.stateUpdate, (s) => s.turn >= 2, 15_000);

    const drawLogs = logs.filter((l) => l.includes('摸了'));
    expect(drawLogs.length).toBeGreaterThan(0);
    // 摸牌日志不得带牌面（牌面形如 【杀】/【闪】）
    for (const l of drawLogs) expect(l).not.toContain('【');

    await closeAll(ts.server, host.socket, guest.socket);
  }, 20_000);
});
