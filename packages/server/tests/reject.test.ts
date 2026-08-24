/** 非法操作：不该你动时发操作被拒；不合法的牌由引擎重问，状态不被破坏。 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CLIENT_EVENTS, SERVER_EVENTS, type AskEvent, type PublicState } from '../src/protocol.js';
import {
  closeAll,
  emitAck,
  setupTwoPlayers,
  startGame,
  startTestServer,
  waitFor,
  type TestServer,
} from './helpers.js';

describe('非法操作拒绝', () => {
  let ts: TestServer;
  beforeEach(async () => {
    ts = await startTestServer();
  });
  afterEach(async () => {
    await ts.server.close();
  });

  it('不该你动时发操作 → ack 报错；出非法牌 → 引擎重问且状态不变', async () => {
    const { host, guest } = await setupTwoPlayers(ts.url);
    const states: PublicState[] = [];
    host.socket.on(SERVER_EVENTS.stateUpdate, (s: PublicState) => states.push(s));
    // 首个询问（空白武将：p1 的出牌阶段）
    const firstAsk = waitFor<AskEvent>(host.socket, SERVER_EVENTS.ask);
    const guestWaiting = waitFor<{ playerId: string }>(guest.socket, SERVER_EVENTS.waiting);
    await startGame(host, guest, { seed: 42 });
    const ask = await firstAsk;
    expect(ask.ask.kind).toBe('play');
    expect(ask.ask.playerId).toBe('p1');
    expect(ask.timeoutMs).toBeGreaterThan(0);
    // 其余玩家收到 waiting 广播
    expect((await guestWaiting).playerId).toBe('p1');

    // 1) p2 在不该动时发操作 → 拒绝
    const wrong = await emitAck<any>(guest.socket, CLIENT_EVENTS.respond, {
      response: { pass: true },
    });
    expect(wrong.ok).toBe(false);
    expect(wrong.error).toContain('还没轮到你');

    // 2) p1 出不存在的牌 → 接受路由（ack ok），引擎判非法并重问
    const reAsk = waitFor<AskEvent>(
      host.socket,
      SERVER_EVENTS.ask,
      (a) => a.seq > ask.seq,
    );
    const accepted = await emitAck<any>(host.socket, CLIENT_EVENTS.respond, {
      response: { cardId: 'card-does-not-exist' },
    });
    expect(accepted.ok).toBe(true);
    const again = await reAsk;
    expect(again.ask.kind).toBe('play');
    expect(again.ask.playerId).toBe('p1');

    // 状态仍然是等 p1，手牌数没变（非法操作没有破坏状态）
    // 等一小会儿让重问时的 state:update 到齐，再检查最近一份状态
    await new Promise((r) => setTimeout(r, 100));
    const state = states[states.length - 1];
    expect(state.pendingPlayerId).toBe('p1');
    expect(state.players.find((p) => p.id === 'p1')!.handCount).toBe(6); // 起手4+摸牌阶段2

    // 3) p1 正常 pass，出牌阶段结束，轮到 p2（不再等 p1）
    const next = waitFor<PublicState>(
      host.socket,
      SERVER_EVENTS.stateUpdate,
      (s) => s.pendingPlayerId !== 'p1',
    );
    await emitAck(host.socket, CLIENT_EVENTS.respond, { response: { pass: true } });
    expect(['p2', null]).toContain((await next).pendingPlayerId);

    await closeAll(ts.server, host.socket, guest.socket);
  }, 20_000);
});
