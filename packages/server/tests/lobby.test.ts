/** 大厅流程：建房 / 加入 / 准备 / 开局校验。 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CLIENT_EVENTS, SERVER_EVENTS, type RoomInfo } from '../src/protocol.js';
import {
  closeAll,
  connect,
  emitAck,
  setupTwoPlayers,
  startTestServer,
  waitFor,
  type TestServer,
} from './helpers.js';

describe('大厅', () => {
  let ts: TestServer;
  beforeEach(async () => {
    ts = await startTestServer();
  });
  afterEach(async () => {
    await ts.server.close();
  });

  it('创建房间：返回 4 位房间码、token 与房主身份', async () => {
    const socket = await connect(ts.url);
    const ack = await emitAck<any>(socket, CLIENT_EVENTS.createRoom, { name: '甲' });
    expect(ack.ok).toBe(true);
    expect(ack.room.code).toMatch(/^[A-Z2-9]{4}$/);
    expect(ack.token).toBeTruthy();
    expect(ack.playerId).toBe('p1');
    expect(ack.room.status).toBe('lobby');
    expect(ack.room.players).toHaveLength(1);
    expect(ack.room.players[0]).toMatchObject({ name: '甲', isHost: true, ready: false, online: true });
    socket.disconnect();
  });

  it('加入不存在的房间被拒', async () => {
    const socket = await connect(ts.url);
    const ack = await emitAck<any>(socket, CLIENT_EVENTS.joinRoom, { code: 'XXXX', name: '乙' });
    expect(ack.ok).toBe(false);
    expect(ack.error).toContain('房间不存在');
    socket.disconnect();
  });

  it('加入与准备状态广播给房间内所有人', async () => {
    const { host, guest } = await setupTwoPlayers(ts.url);
    expect(guest.playerId).toBe('p2');
    // 切一次准备状态触发广播，host 应看到两人且 guest 已准备
    await emitAck(guest.socket, CLIENT_EVENTS.ready, { ready: false });
    const update = waitFor<RoomInfo>(
      host.socket,
      SERVER_EVENTS.roomUpdate,
      (r) => r.players.length === 2 && r.players[1].ready,
    );
    await emitAck(guest.socket, CLIENT_EVENTS.ready, { ready: true });
    const info = await update;
    expect(info.players.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(info.players[1]).toMatchObject({ name: '乙', isHost: false, ready: true });
  });

  it('非房主开局被拒；未准备齐全不能开局', async () => {
    const hostSocket = await connect(ts.url);
    const created = await emitAck<any>(hostSocket, CLIENT_EVENTS.createRoom, { name: '甲' });
    const guestSocket = await connect(ts.url);
    await emitAck(guestSocket, CLIENT_EVENTS.joinRoom, { code: created.room.code, name: '乙' });

    const byGuest = await emitAck<any>(guestSocket, CLIENT_EVENTS.startGame, {});
    expect(byGuest.ok).toBe(false);
    expect(byGuest.error).toContain('房主');

    const notReady = await emitAck<any>(hostSocket, CLIENT_EVENTS.startGame, {});
    expect(notReady.ok).toBe(false);
    expect(notReady.error).toContain('未准备');

    hostSocket.disconnect();
    guestSocket.disconnect();
  });

  it('一人不能开局', async () => {
    const socket = await connect(ts.url);
    await emitAck<any>(socket, CLIENT_EVENTS.createRoom, { name: '甲' });
    const ack = await emitAck<any>(socket, CLIENT_EVENTS.startGame, {});
    expect(ack.ok).toBe(false);
    expect(ack.error).toContain('至少');
    socket.disconnect();
  });

  it('开局分配座位与武将；房主可指定测试武将', async () => {
    const { host, guest } = await setupTwoPlayers(ts.url);
    const hostState = waitFor<any>(host.socket, SERVER_EVENTS.stateUpdate);
    const ack = await emitAck<any>(host.socket, CLIENT_EVENTS.startGame, {
      seed: 42,
      generals: ['guanyu', 'machao'],
    });
    expect(ack.ok).toBe(true);
    const state = await hostState;
    expect(state.status).toBe('playing');
    // 首份状态在 p1 摸牌阶段后才广播（伴随首个询问）：p1 已摸 2 张，p2 还是 4 张
    expect(state.players[0]).toMatchObject({ id: 'p1', seat: 0, generalName: '关羽', handCount: 6 });
    expect(state.players[1]).toMatchObject({ id: 'p2', seat: 1, generalName: '马超', handCount: 4 });
    expect(state.me.id).toBe('p1');
    // 随机分配：不指定时从 7 个已实现武将里出
    await closeAll(ts.server, host.socket, guest.socket);

    const ts2 = await startTestServer();
    const pair = await setupTwoPlayers(ts2.url);
    const s = waitFor<any>(pair.host.socket, SERVER_EVENTS.stateUpdate);
    await emitAck(pair.host.socket, CLIENT_EVENTS.startGame, { seed: 7 });
    const state2 = await s;
    const names = state2.players.map((p: any) => p.generalName);
    expect(names[0]).not.toBe('白板武将');
    expect(new Set(names).size).toBe(2); // 不重复
    await closeAll(ts2.server, pair.host.socket, pair.guest.socket);
  });

  it('指定未实现武将被拒', async () => {
    const { host, guest } = await setupTwoPlayers(ts.url);
    // shen_guanyu（神关羽）不在标准包 25 将里，必定未实现
    const ack = await emitAck<any>(host.socket, CLIENT_EVENTS.startGame, { generals: ['shen_guanyu'] });
    expect(ack.ok).toBe(false);
    expect(ack.error).toContain('武将');
    await closeAll(ts.server, host.socket, guest.socket);
  });
});
