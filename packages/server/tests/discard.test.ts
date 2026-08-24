/** 弃牌阶段（服务器侧）：询问路由给本人；玩家自选弃哪些；超时兜底自动弃末尾的牌。 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CLIENT_EVENTS, SERVER_EVENTS, type AskEvent, type PublicState } from '../src/protocol.js';
import {
  closeAll,
  emitAck,
  setupTwoPlayers,
  startGame,
  startTestServer,
  waitFor,
  type TestClient,
  type TestServer,
} from './helpers.js';

describe('弃牌阶段', () => {
  let ts: TestServer;
  beforeEach(async () => {
    ts = await startTestServer();
  });
  afterEach(async () => {
    await ts.server.close();
  });

  /** 开局 → p1 结束出牌 → 等到 p1 的弃牌询问（p1 手牌 6 > 体力 4，需弃 2 张）。 */
  async function reachDiscardAsk(host: TestClient, guest: TestClient) {
    const firstAsk = waitFor<AskEvent>(host.socket, SERVER_EVENTS.ask);
    const hostStates: PublicState[] = [];
    host.socket.on(SERVER_EVENTS.stateUpdate, (s: PublicState) => hostStates.push(s));
    await startGame(host, guest, { seed: 42 });
    const playAsk = await firstAsk;
    expect(playAsk.ask.kind).toBe('play');

    const discardAskP = waitFor<AskEvent>(
      host.socket,
      SERVER_EVENTS.ask,
      (e) => e.ask.kind === 'discard',
    );
    await emitAck(host.socket, CLIENT_EVENTS.respond, { response: { pass: true } });
    const discardAsk = await discardAskP;
    return { discardAsk, hostStates };
  }

  it('手牌数 > 体力时询问玩家弃牌（恰好 count 张），玩家自选', async () => {
    const { host, guest } = await setupTwoPlayers(ts.url);
    const { discardAsk, hostStates } = await reachDiscardAsk(host, guest);

    expect(discardAsk.ask).toMatchObject({ kind: 'discard', playerId: 'p1', count: 2 });

    // 玩家自选：弃手牌的前两张
    const myHand = hostStates[hostStates.length - 1].me.hand;
    expect(myHand).toHaveLength(6);
    const drop = [myHand[0].id, myHand[1].id];
    const kept = myHand.slice(2).map((c) => c.id);

    // 少选被拒（引擎重问）；恰好 2 张后通过
    const reAsk = waitFor<AskEvent>(
      host.socket,
      SERVER_EVENTS.ask,
      (e) => e.ask.kind === 'discard',
    );
    await emitAck(host.socket, CLIENT_EVENTS.respond, { response: { cardIds: [drop[0]] } });
    expect((await reAsk).ask.kind).toBe('discard');

    const done = waitFor<PublicState>(
      host.socket,
      SERVER_EVENTS.stateUpdate,
      (s) => s.me.hand.length === 4,
    );
    const ack = await emitAck<{ ok: boolean }>(host.socket, CLIENT_EVENTS.respond, {
      response: { cardIds: drop },
    });
    expect(ack.ok).toBe(true);
    const after = await done;
    expect(after.me.hand.map((c) => c.id)).toEqual(kept); // 留下的正是玩家选剩的
    expect(after.discardCount).toBeGreaterThanOrEqual(2);

    await closeAll(ts.server, host.socket, guest.socket);
  }, 15_000);

  it('弃牌询问 300ms 超时 → 兜底自动弃末尾的牌，对局继续', async () => {
    await ts.server.close();
    ts = await startTestServer({ askTimeoutMs: 300 });
    const { host, guest } = await setupTwoPlayers(ts.url);
    const { discardAsk, hostStates } = await reachDiscardAsk(host, guest);
    expect(discardAsk.ask.kind).toBe('discard');

    const before = hostStates[hostStates.length - 1];
    const expectedKept = before.me.hand.slice(0, 4).map((c) => c.id); // 弃末尾 2 张

    // 不响应：等超时兜底，手牌降到 4，且轮到 p2
    const settled = waitFor<PublicState>(
      host.socket,
      SERVER_EVENTS.stateUpdate,
      (s) => s.me.hand.length === 4 && s.pendingPlayerId === 'p2',
    );
    const after = await settled;
    expect(after.me.hand.map((c) => c.id)).toEqual(expectedKept);

    await closeAll(ts.server, host.socket, guest.socket);
  }, 15_000);
});
