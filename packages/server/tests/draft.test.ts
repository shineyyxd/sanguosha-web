/**
 * 选将流程：身份局未指定武将时，开局先给每人发候选（主公多 1 个），
 * 点选生效；超时/不响应由服务器随机分配；非法候选被拒。
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IMPLEMENTED_GENERAL_IDS } from '../../engine/src/index.js';
import {
  CLIENT_EVENTS,
  SERVER_EVENTS,
  type GeneralChooseEvent,
  type PublicState,
} from '../src/protocol.js';
import {
  closeAll,
  emitAck,
  setupPlayers,
  startGame,
  startTestServer,
  waitFor,
  type TestServer,
} from './helpers.js';

const ROLES = ['lord', 'loyalist', 'rebel', 'rebel'] as const; // 主公是 p1（房主）

/** 轮询直到条件满足。 */
async function until(pred: () => boolean, ms = 5000): Promise<void> {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error('until 等待超时');
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe('选将流程', () => {
  let ts: TestServer;
  beforeEach(async () => {
    ts = await startTestServer({ askTimeoutMs: 400 });
  });
  afterEach(async () => {
    await ts.server.close();
  });

  it('每人收到候选（主公 4 个、其余 3 个），点选生效，超时随机分配', async () => {
    const clients = await setupPlayers(ts.url, 4);
    const chooses: GeneralChooseEvent[][] = clients.map(() => []);
    clients.forEach((c, i) =>
      c.socket.on(SERVER_EVENTS.generalChoose, (e: GeneralChooseEvent) => chooses[i].push(e)),
    );

    // 不传 generals → 走选将；身份显式指定便于断言
    const drafted = waitFor<PublicState>(
      clients[0].socket,
      SERVER_EVENTS.stateUpdate,
      (s) => s.players.every((p) => p.generalId !== 'blank'),
      15_000,
    );
    await startGame(clients[0], clients.slice(1), {
      seed: 42,
      roles: [...ROLES],
      generals: undefined, // 覆盖 helpers 默认的空白武将
    });

    // 四份选将询问各到一次（收集器在开局前已注册）
    await until(() => chooses.every((c) => c.length === 1));
    expect(chooses[0][0].candidates).toHaveLength(4); // 主公多 1 个候选
    for (let i = 1; i < 4; i++) expect(chooses[i][0].candidates).toHaveLength(3);
    // 候选带名字/势力/体力/技能描述
    const cand = chooses[0][0].candidates[0];
    expect(cand.name).toBeTruthy();
    expect(cand.kingdom).toBeTruthy();
    expect(cand.hp).toBeGreaterThan(0);
    expect(Array.isArray(cand.skills)).toBe(true);

    // 非法候选被拒：挑一个不在候选列表里的已实现武将（池子扩到 25 后不能写死 id）
    const notCandidate = IMPLEMENTED_GENERAL_IDS.find(
      (id) => !chooses[0][0].candidates.some((c) => c.id === id),
    )!;
    const bad = await emitAck<{ ok: boolean; error?: string }>(
      clients[0].socket,
      CLIENT_EVENTS.pickGeneral,
      { generalId: notCandidate },
    );
    expect(bad.ok).toBe(false);

    // p1 点选第一个候选；p2/p3/p4 不选，等 400ms 超时由服务器随机分配
    const picked = chooses[0][0].candidates[0].id;
    const good = await emitAck<{ ok: boolean }>(clients[0].socket, CLIENT_EVENTS.pickGeneral, {
      generalId: picked,
    });
    expect(good.ok).toBe(true);

    const final = await drafted;
    expect(final.players[0].generalId).toBe(picked); // 点选生效
    expect(final.players.slice(1).every((p) => p.generalId && p.generalId !== 'blank')).toBe(true);

    await closeAll(ts.server, ...clients.map((c) => c.socket));
  }, 30_000);
});
