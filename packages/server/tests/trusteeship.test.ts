/**
 * 断线 AI 托管：
 * - 断线立即进入托管，轮到该玩家由服务器机器人快速应答，整桌不等超时；
 * - 重连自动解除托管，恢复手动操作；
 * - 真人超时一次后转托管，后续回合不再等满超时。
 */

import { afterEach, describe, expect, it } from 'vitest';
import { CLIENT_EVENTS, SERVER_EVENTS, type AskEvent, type GameOverEvent, type PublicState } from '../src/protocol.js';
import {
  attachBot,
  closeAll,
  connect,
  emitAck,
  setupPlayers,
  setupTwoPlayers,
  startGame,
  startTestServer,
  waitFor,
} from './helpers.js';

describe('断线托管', () => {
  it('断线后进入托管：该玩家回合不阻塞，整局能跑完', async () => {
    const ts = await startTestServer({ botDelayMs: 20 });
    const { host, guest } = await setupTwoPlayers(ts.url);
    const logs: string[] = [];
    guest.socket.on(SERVER_EVENTS.log, ({ message }: { message: string }) => logs.push(message));

    const firstAsk = waitFor<AskEvent>(host.socket, SERVER_EVENTS.ask);
    // guest 由客户端机器人代打；host 断线后由服务器托管代打
    attachBot(guest);
    const over = waitFor<GameOverEvent>(guest.socket, SERVER_EVENTS.gameOver, undefined, 60_000);
    await startGame(host, guest, { seed: 42 });
    await firstAsk; // 第一个询问是 p1（host）的出牌阶段

    // host 断线 → 进入托管，guest 在状态里看到 p1 的托管标记
    const trustedSeen = waitFor<PublicState>(
      guest.socket,
      SERVER_EVENTS.stateUpdate,
      (s) => s.players.find((p) => p.id === 'p1')?.trusted === true,
    );
    host.socket.disconnect();
    const state = await trustedSeen;
    expect(state.players[0].trusted).toBe(true);
    expect(logs.some((l) => l.includes('进入托管'))).toBe(true);

    // 整局跑完：p1 全程由托管机器人应答，没有卡在任何 30s 超时上
    const result = await over;
    expect(['p1', 'p2']).toContain(result.winnerId);
    expect(logs.some((l) => l.includes('超时未响应'))).toBe(false);

    await closeAll(ts.server, guest.socket);
  }, 70_000);

  it('重连解除托管：恢复手动操作，继续应答自己的询问', async () => {
    // botDelay 拉长：托管机器人不会抢在重连前把 p1 的询问答掉
    const ts = await startTestServer({ botDelayMs: 5000 });
    const { host, guest } = await setupTwoPlayers(ts.url);
    const logs: string[] = [];
    guest.socket.on(SERVER_EVENTS.log, ({ message }: { message: string }) => logs.push(message));

    const firstAsk = waitFor<AskEvent>(host.socket, SERVER_EVENTS.ask);
    await startGame(host, guest, { seed: 42 });
    await firstAsk;

    // 断线 → 托管
    const trustedSeen = waitFor<PublicState>(
      guest.socket,
      SERVER_EVENTS.stateUpdate,
      (s) => s.players.find((p) => p.id === 'p1')?.trusted === true,
    );
    host.socket.disconnect();
    await trustedSeen;

    // 凭 token 重连 → 解除托管，状态里托管标记消失，重发等待中的询问
    const socket2 = await connect(ts.url);
    const rejoinedState = waitFor<PublicState>(socket2, SERVER_EVENTS.stateUpdate);
    const rejoinedAsk = waitFor<AskEvent>(socket2, SERVER_EVENTS.ask);
    const ack = await emitAck<{ ok: boolean; playerId: string }>(socket2, CLIENT_EVENTS.rejoin, {
      code: host.code,
      token: host.token,
    });
    expect(ack.ok).toBe(true);

    const state = await rejoinedState;
    expect(state.players.find((p) => p.id === 'p1')?.trusted).toBe(false);
    expect(state.pendingPlayerId).toBe('p1');
    await rejoinedAsk; // 仍是 p1 的询问
    expect(logs.some((l) => l.includes('恢复手动操作'))).toBe(true);

    // 手动应答，对局继续推进
    const progressed = waitFor<PublicState>(
      guest.socket,
      SERVER_EVENTS.stateUpdate,
      (s) => s.pendingPlayerId !== 'p1',
    );
    const resAck = await emitAck<{ ok: boolean }>(socket2, CLIENT_EVENTS.respond, {
      response: { pass: true },
    });
    expect(resAck.ok).toBe(true);
    await progressed;

    await closeAll(ts.server, socket2, guest.socket);
  }, 20_000);

  it('超时一次转托管：后续回合由机器人代答，不再等满超时', async () => {
    const ts = await startTestServer({ askTimeoutMs: 300, botDelayMs: 20 });
    const { host, guest } = await setupTwoPlayers(ts.url);
    attachBot(guest); // p2 正常应答，只有 p1 会先超时一次

    const firstAsk = waitFor<AskEvent>(host.socket, SERVER_EVENTS.ask);
    await startGame(host, guest, { seed: 42 });
    const ask = await firstAsk;
    expect(ask.ask.playerId).toBe('p1');

    // p1 不响应：300ms 超时自动放弃，并转入托管
    const trustedSeen = waitFor<PublicState>(
      guest.socket,
      SERVER_EVENTS.stateUpdate,
      (s) => s.players.find((p) => p.id === 'p1')?.trusted === true,
    );
    await trustedSeen;

    // p1 的下一个回合：从"等待 p1"到"p1 行动完毕"应远快于 300ms 的真人超时
    const p1TurnStarts = waitFor<PublicState>(
      guest.socket,
      SERVER_EVENTS.stateUpdate,
      (s) => s.pendingPlayerId === 'p1',
      8000,
    );
    const t0 = Date.now();
    await p1TurnStarts;
    await waitFor<PublicState>(
      guest.socket,
      SERVER_EVENTS.stateUpdate,
      (s) => s.pendingPlayerId !== null && s.pendingPlayerId !== 'p1',
      8000,
    );
    expect(Date.now() - t0).toBeLessThan(300);

    await closeAll(ts.server, host.socket, guest.socket);
  }, 20_000);

  it('选将阶段断线：不等待超时，直接自动分配武将', async () => {
    const ts = await startTestServer({ askTimeoutMs: 5000, botDelayMs: 20 });
    // 4 人身份局且不指定武将 → 进入选将；其他三人点选，host 断线
    const clients = await setupPlayers(ts.url, 4);
    const [host] = clients;
    for (const c of clients.slice(1)) attachBot(c);
    const started = clients.slice(1).map((c) =>
      waitFor(c.socket, SERVER_EVENTS.generalChoose, undefined, 8000),
    );
    const ack = await emitAck<{ ok: boolean; error?: string }>(host.socket, CLIENT_EVENTS.startGame, {
      seed: 42,
    });
    expect(ack.ok).toBe(true);
    await Promise.all(started);

    // host 断线时选将还挂着：应在 botDelay 量级内自动分配，对局进入主循环
    host.socket.disconnect();
    const playing = await waitFor<PublicState>(
      clients[1].socket,
      SERVER_EVENTS.stateUpdate,
      (s) => s.players.every((p) => p.generalId && p.generalId !== 'blank'),
      8000,
    );
    expect(playing.players.length).toBe(4);

    await closeAll(ts.server, ...clients.slice(1).map((c) => c.socket));
  }, 20_000);
});
