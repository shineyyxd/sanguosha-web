/** 断线重连：凭 token 找回座位，全量状态 + 重发等待中的询问。 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CLIENT_EVENTS, SERVER_EVENTS, type AskEvent, type PublicState, type RoomInfo } from '../src/protocol.js';
import {
  closeAll,
  connect,
  emitAck,
  setupTwoPlayers,
  startGame,
  startTestServer,
  waitFor,
  type TestServer,
} from './helpers.js';

describe('断线重连', () => {
  let ts: TestServer;
  beforeEach(async () => {
    // botDelay 拉长：断线后由机器人代答前留出充足的重连窗口，避免与测试动作竞争
    ts = await startTestServer({ botDelayMs: 5000 });
  });
  afterEach(async () => {
    await ts.server.close();
  });

  it('断线不踢人（标记离线）；重连后恢复座位、全量状态与 pending 询问', async () => {
    const { host, guest } = await setupTwoPlayers(ts.url);
    const firstAsk = waitFor<AskEvent>(host.socket, SERVER_EVENTS.ask);
    await startGame(host, guest, { seed: 42 });
    const ask = await firstAsk;
    expect(ask.ask.playerId).toBe('p1');

    // p1 断线：不踢人，p2 看到 p1 离线
    const offlineNotice = waitFor<RoomInfo>(
      guest.socket,
      SERVER_EVENTS.roomUpdate,
      (r) => r.players.find((p) => p.id === 'p1')?.online === false,
    );
    host.socket.disconnect();
    await offlineNotice;

    // p1 换个 socket 凭 token 重连
    const socket2 = await connect(ts.url);
    const rejoinedAsk = waitFor<AskEvent>(socket2, SERVER_EVENTS.ask);
    const rejoinedState = waitFor<PublicState>(socket2, SERVER_EVENTS.stateUpdate);
    // 提前注册：p2 应看到 p1 重新上线
    const backOnline = waitFor<RoomInfo>(
      guest.socket,
      SERVER_EVENTS.roomUpdate,
      (r) => r.players.find((p) => p.id === 'p1')?.online === true,
    );
    const ack = await emitAck<any>(socket2, CLIENT_EVENTS.rejoin, {
      code: host.code,
      token: host.token,
    });
    expect(ack.ok).toBe(true);
    expect(ack.playerId).toBe('p1');

    // 全量状态 + 重发 pending 询问（同一条 ask）
    const state = await rejoinedState;
    expect(state.me.id).toBe('p1');
    expect(state.me.hand.length).toBe(6);
    expect(state.pendingPlayerId).toBe('p1');
    const resent = await rejoinedAsk;
    expect(resent.seq).toBe(ask.seq);
    expect(resent.ask.kind).toBe('play');

    // 重连后可以正常响应，游戏继续推进
    const progressed = waitFor<PublicState>(
      socket2,
      SERVER_EVENTS.stateUpdate,
      (s) => s.pendingPlayerId !== 'p1',
    );
    const resAck = await emitAck<any>(socket2, CLIENT_EVENTS.respond, { response: { pass: true } });
    expect(resAck.ok).toBe(true);
    await progressed;

    // p2 已在重连广播里看到 p1 重新上线
    expect((await backOnline).players[0].online).toBe(true);

    await closeAll(ts.server, socket2, guest.socket);
  }, 20_000);

  it('错误 token 重连被拒', async () => {
    const { host, guest } = await setupTwoPlayers(ts.url);
    const socket = await connect(ts.url);
    const ack = await emitAck<any>(socket, CLIENT_EVENTS.rejoin, {
      code: host.code,
      token: 'bad-token',
    });
    expect(ack.ok).toBe(false);
    expect(ack.error).toContain('token');
    await closeAll(ts.server, host.socket, guest.socket, socket);
  });

  it('座位仍在线时拒绝重连（防止第二个标签页共享 localStorage 静默抢座）', async () => {
    const { host, guest } = await setupTwoPlayers(ts.url);
    // host 的 socket 仍然在线，另一个连接凭同一 token 重连 → 拒绝，座位不被抢
    const socket2 = await connect(ts.url);
    const ack = await emitAck<any>(socket2, CLIENT_EVENTS.rejoin, {
      code: host.code,
      token: host.token,
    });
    expect(ack.ok).toBe(false);
    expect(ack.error).toContain('在线');

    // 原连接仍是座位的主人：断开后同一 token 可以正常重连
    host.socket.disconnect();
    await waitFor<RoomInfo>(
      guest.socket,
      SERVER_EVENTS.roomUpdate,
      (r) => r.players.find((p) => p.id === 'p1')?.online === false,
    );
    const ack2 = await emitAck<any>(socket2, CLIENT_EVENTS.rejoin, {
      code: host.code,
      token: host.token,
    });
    expect(ack2.ok).toBe(true);
    expect(ack2.playerId).toBe('p1');
    await closeAll(ts.server, socket2, guest.socket);
  });
});
