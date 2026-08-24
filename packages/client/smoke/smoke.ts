/**
 * 冒烟脚本：真实服务器 + 两个无头机器人（驱动客户端自己的 ClientCore），
 * 验证客户端协议处理层能完整跑通 建房 → 准备 → 开局 → 应答 → 结算 全链路。
 *
 * 运行：npm run smoke -w @sanguosha/client
 * （机器人策略只使用客户端可见的 PublicState / AskRequest，与浏览器客户端同源。）
 */

import { io } from 'socket.io-client';
import { createGameServer } from '@sanguosha/server';
import { ClientCore } from '../src/core/client.js';
import { responseOptions } from '../src/core/vm.js';
import type { AskResponse } from '../src/protocol.js';

const stats = {
  asksAnswered: 0,
  respondErrors: [] as string[],
  statesReceived: 0,
  logsReceived: 0,
};

function attachBot(core: ClientCore, label: string): void {
  let lastShaTurn = -1;
  const answered = new Set<number>();

  core.on('change', (snap) => {
    if (snap.state) stats.statesReceived++;
    const current = snap.currentAsk;
    if (!current || answered.has(current.seq)) return;
    answered.add(current.seq);

    const ask = current.ask;
    const hand = snap.state?.me.hand ?? [];
    const state = snap.state;
    const respond = (response: AskResponse) => {
      stats.asksAnswered++;
      void core.respond(response).then((ack) => {
        if (!ack.ok) stats.respondErrors.push(`${label} seq=${current.seq}: ${ack.error}`);
      });
    };

    if (ask.kind === 'choose-card') return respond({ cardId: ask.cards[0].id });
    if (ask.kind === 'confirm') return respond({ confirm: true });
    if (ask.kind === 'choose-target') return respond({ pass: true });
    // 刚烈/反间等互斥选项：兜底选第一项；遗计分配：自己保留；鬼才改判：不改；观星：全部回顶
    if (ask.kind === 'choose-option') return respond({ choice: ask.options[0].id });
    if (ask.kind === 'give-card') return respond({ pass: true });
    if (ask.kind === 'judge-retrial') return respond({ pass: true });
    if (ask.kind === 'guanxing') return respond({ pass: true });
    // 弃牌阶段（不可放弃）：自动弃末尾的牌
    if (ask.kind === 'discard') return respond({ cardIds: hand.slice(-ask.count).map((c) => c.id) });

    if (ask.kind === 'response') {
      if (ask.wants === 'wuxie' && ask.targetId !== ask.playerId) return respond({ pass: true });
      const opts = responseOptions(ask, hand);
      if (opts.direct[0]) return respond({ cardId: opts.direct[0].id });
      const conv = opts.converts.find((c) => c.cards.length > 0);
      if (conv) return respond({ useSkill: conv.skillId, cardId: conv.cards[0].id });
      return respond({ pass: true });
    }

    // 出牌阶段：残血吃桃、每回合至多杀一刀，其余放弃
    const turn = state?.turn ?? -1;
    const mePub = state?.players.find((p) => p.id === ask.playerId);
    if (mePub && mePub.hp < mePub.maxHp) {
      const tao = hand.find((c) => c.name === 'tao');
      if (tao) return respond({ cardId: tao.id });
    }
    if (turn !== lastShaTurn) {
      const sha = hand.find((c) => c.name === 'sha');
      const target = state?.players.find((p) => p.id !== ask.playerId && p.alive);
      if (sha && target) {
        lastShaTurn = turn;
        return respond({ cardId: sha.id, targetId: target.id });
      }
    }
    return respond({ pass: true });
  });

  core.on('log', () => stats.logsReceived++);
}

function waitUntil(pred: () => boolean, timeoutMs: number, what: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const timer = setInterval(() => {
      if (pred()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - t0 > timeoutMs) {
        clearInterval(timer);
        reject(new Error(`等待超时：${what}`));
      }
    }, 20);
  });
}

const server = createGameServer({ askTimeoutMs: 10_000 });
await server.listen(0);
const url = `http://127.0.0.1:${server.port()}`;

const socketA = io(url, { transports: ['websocket'] });
const socketB = io(url, { transports: ['websocket'] });
const coreA = new ClientCore(socketA);
const coreB = new ClientCore(socketB);
attachBot(coreA, '甲');
attachBot(coreB, '乙');

try {
  const created = await coreA.createRoom('甲');
  if (!created.ok) throw new Error(`建房失败：${created.error}`);
  const joined = await coreB.joinRoom(created.room.code, '乙');
  if (!joined.ok) throw new Error(`加入失败：${joined.error}`);
  const ready = await coreB.setReady(true);
  if (!ready.ok) throw new Error(`准备失败：${ready.error}`);
  console.log(`✓ 建房/加入/准备成功，房间码 ${created.room.code}`);

  const start = await coreA.startGame({ seed: 7, generals: ['guanyu', 'zhaoyun'] });
  if (!start.ok) throw new Error(`开局失败：${start.error}`);
  await waitUntil(() => coreA.state !== null && coreB.state !== null, 5000, '首份 state:update');
  console.log('✓ 双方收到首份对局状态');

  await waitUntil(
    () => coreA.gameOver !== null && coreB.gameOver !== null,
    90_000,
    '对局结束（game:over）',
  );

  if (stats.respondErrors.length > 0) {
    throw new Error(`存在失败的 respond ack：\n${stats.respondErrors.join('\n')}`);
  }
  if (stats.asksAnswered < 5) throw new Error(`应答次数异常：${stats.asksAnswered}`);

  const winner = coreA.gameOver?.winnerName ?? '（无）';
  console.log(`✓ 对局结束，胜者：${winner}`);
  console.log(
    `✓ 冒烟通过：应答 ${stats.asksAnswered} 次（0 失败），状态推送 ${stats.statesReceived} 次，日志 ${stats.logsReceived} 条，回合数 ${coreA.state?.turn}`,
  );
} finally {
  socketA.disconnect();
  socketB.disconnect();
  await server.close();
}
