/**
 * 4 人身份局整局冒烟：四个机器人 socket 客户端打完一局（可复现种子），
 * 验证身份私发、主公公开标记、胜负方判定与终局身份全亮。
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { STANDARD_GENERALS } from '../../engine/src/index.js';
import {
  SERVER_EVENTS,
  type GameOverEvent,
  type PublicState,
  type RoleAssignEvent,
} from '../src/protocol.js';
import {
  attachBot,
  closeAll,
  setupPlayers,
  startGame,
  startTestServer,
  waitFor,
  type TestServer,
} from './helpers.js';

const ROLES = ['rebel', 'loyalist', 'lord', 'rebel'] as const; // 主公在 p3

describe('4 人身份局整局（四机器人）', () => {
  let ts: TestServer;
  beforeEach(async () => {
    ts = await startTestServer();
  });
  afterEach(async () => {
    await ts.server.close();
  });

  it('打完一局分出胜负方，身份按规则可见', async () => {
    const clients = await setupPlayers(ts.url, 4);

    // 身份私发收集（开局前注册）
    const roleEvents: RoleAssignEvent[][] = clients.map(() => []);
    clients.forEach((c, i) =>
      c.socket.on(SERVER_EVENTS.roleAssign, (e: RoleAssignEvent) => roleEvents[i].push(e)),
    );
    const logs: string[] = [];
    clients[0].socket.on(SERVER_EVENTS.log, ({ message }: { message: string }) => logs.push(message));
    const finalStates: PublicState[][] = clients.map(() => []);
    clients.forEach((c, i) =>
      c.socket.on(SERVER_EVENTS.stateUpdate, (s: PublicState) => finalStates[i].push(s)),
    );

    const overs = clients.map((c) =>
      waitFor<GameOverEvent>(c.socket, SERVER_EVENTS.gameOver, undefined, 90_000),
    );
    for (const c of clients) attachBot(c); // 机器人会完成选将（拿第一个候选）
    await startGame(clients[0], clients.slice(1), {
      seed: 42,
      roles: [...ROLES],
      generals: undefined, // 不指定武将：走完整选将流程
    });

    // 每人恰好收到一条自己的身份
    clients.forEach((_, i) => {
      expect(roleEvents[i]).toHaveLength(1);
      expect(roleEvents[i][0].role).toBe(ROLES[i]);
      expect(roleEvents[i][0].objective.length).toBeGreaterThan(0);
    });

    const [over] = await Promise.all(overs);
    expect(over.winSide).toBe('rebel'); // 该种子 + 25 武将池（标准包齐）下的可复现结果（反贼方获胜）
    expect(over.winnerId).toBeNull(); // 阵营胜利无单一胜者

    // 主公先行动
    expect(logs.find((l) => l.includes('的回合'))).toContain('丙'); // p3 = 丙

    await new Promise((r) => setTimeout(r, 100));
    for (const states of finalStates) {
      const final = states[states.length - 1];
      expect(final.status).toBe('over');
      // 终局全员亮身份
      expect(final.players.map((p) => p.role)).toEqual([...ROLES]);
    }

    // 对局中（非终局）的视角快照：主公公开、其他人隐藏
    const mid = finalStates[0].find((s) => s.status === 'playing' && s.turn >= 1);
    expect(mid).toBeDefined();
    const lordEntry = mid!.players.find((p) => p.id === 'p3')!;
    expect(lordEntry.role).toBe('lord');
    // 主公上限 = 武将基础体力 + 1（武将由选将流程从池中随机，按名字反查）
    const baseHp = STANDARD_GENERALS.find((g) => g.name === lordEntry.generalName)?.hp;
    expect(baseHp).toBeDefined();
    expect(lordEntry.maxHp).toBe(baseHp! + 1);
    const aliveOthers = mid!.players.filter((p) => p.alive && p.id !== 'p3' && p.id !== mid!.me.id);
    expect(aliveOthers.every((p) => p.role === null)).toBe(true);

    await closeAll(ts.server, ...clients.map((c) => c.socket));
  }, 100_000);
});
