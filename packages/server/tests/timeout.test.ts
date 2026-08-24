/** 询问超时：到期自动视为放弃（出牌阶段超时 = 结束出牌）。 */

import { afterEach, describe, expect, it } from 'vitest';
import { SERVER_EVENTS, type AskEvent, type PublicState } from '../src/protocol.js';
import {
  closeAll,
  setupTwoPlayers,
  startGame,
  startTestServer,
  waitFor,
} from './helpers.js';

describe('超时托管', () => {
  it('出牌阶段 300ms 未响应 → 自动结束出牌，轮到下一位', async () => {
    const ts = await startTestServer({ askTimeoutMs: 300 });
    const { host, guest } = await setupTwoPlayers(ts.url);
    const logs: string[] = [];
    guest.socket.on(SERVER_EVENTS.log, ({ message }: { message: string }) => logs.push(message));

    const firstAsk = waitFor<AskEvent>(host.socket, SERVER_EVENTS.ask);
    await startGame(host, guest, { seed: 42 });
    const ask = await firstAsk;
    expect(ask.ask.playerId).toBe('p1');
    expect(ask.timeoutMs).toBe(300);

    // 不响应：超时后广播超时日志，且不再等 p1
    const moved = waitFor<PublicState>(
      guest.socket,
      SERVER_EVENTS.stateUpdate,
      (s) => s.pendingPlayerId !== 'p1',
    );
    await moved;
    expect(logs.some((l) => l.includes('超时未响应'))).toBe(true);

    await closeAll(ts.server, host.socket, guest.socket);
  }, 15_000);

  afterEach(() => {});
});
