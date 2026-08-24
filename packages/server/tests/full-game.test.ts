/** 完整对局：两个机器人客户端通过 Socket.IO 打完一局，直到 game:over。 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SERVER_EVENTS, type GameOverEvent, type PublicState } from '../src/protocol.js';
import {
  attachBot,
  closeAll,
  setupTwoPlayers,
  startGame,
  startTestServer,
  waitFor,
  type TestServer,
} from './helpers.js';

describe('完整对局（双机器人）', () => {
  let ts: TestServer;
  beforeEach(async () => {
    ts = await startTestServer();
  });
  afterEach(async () => {
    await ts.server.close();
  });

  it('两个 socket 客户端自动打完一局并分出胜负', async () => {
    const { host, guest } = await setupTwoPlayers(ts.url);
    const logs: string[] = [];
    host.socket.on(SERVER_EVENTS.log, ({ message }: { message: string }) => logs.push(message));
    const states: PublicState[] = [];
    host.socket.on(SERVER_EVENTS.stateUpdate, (s: PublicState) => states.push(s));

    const overHost = waitFor<GameOverEvent>(host.socket, SERVER_EVENTS.gameOver, undefined, 60_000);
    const overGuest = waitFor<GameOverEvent>(guest.socket, SERVER_EVENTS.gameOver, undefined, 60_000);
    attachBot(host);
    attachBot(guest);
    await startGame(host, guest, { seed: 42 });

    const [overA, overB] = await Promise.all([overHost, overGuest]);
    expect(overA).toEqual(overB);
    expect(['p1', 'p2']).toContain(overA.winnerId);
    expect(logs.some((l) => l.includes('使用【杀】'))).toBe(true);
    expect(logs.some((l) => l.includes('死亡'))).toBe(true);

    // 终局状态：status=over 且有胜者（game:over 与最终 state:update 同拍发出，用收集器避免竞态）
    await new Promise((r) => setTimeout(r, 100));
    const final = states[states.length - 1];
    expect(final.status).toBe('over');
    expect(final.winnerId).toBe(overA.winnerId);
    expect(final.turn).toBeGreaterThan(0);
    await closeAll(ts.server, host.socket, guest.socket);
  }, 70_000);
});
