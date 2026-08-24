import { describe, expect, it } from 'vitest';
import {
  Game,
  InfiniteDeck,
  drive,
  type AskRequest,
  type AskResponse,
  type Controller,
  type GameEventMap,
} from '../src/index.js';

/** 简单 AI：能杀就杀、有闪就闪、有桃就桃，与 CLI demo 同款策略。 */
class SimpleAI implements Controller {
  onAsk(ask: AskRequest, game: Game): AskResponse {
    const me = game.getPlayer(ask.playerId);
    if (ask.kind === 'discard') {
      // 弃牌阶段不可放弃：弃末尾的牌
      return { cardIds: me.hand.slice(-ask.count).map((c) => c.id) };
    }
    if (ask.kind === 'response') {
      const card = me.findCard(ask.wants);
      return card ? { cardId: card.id } : { pass: true };
    }
    if (me.hp < me.maxHp) {
      const tao = me.findCard('tao');
      if (tao) return { cardId: tao.id };
    }
    const sha = me.findCard('sha');
    if (sha) {
      const target = game.alivePlayers().find(
        (p) => p !== me && game.canPlay(me, sha, p.id) === null,
      );
      if (target) return { cardId: sha.id, targetId: target.id };
    }
    return { pass: true };
  }
}

describe('整局游戏', () => {
  it('一方死亡后游戏结束并判定胜者', () => {
    // 纯杀牌堆：双方都没有闪和桃，先手 4 回合内击杀后手，结果确定。
    const game = new Game({
      playerNames: ['甲', '乙'],
      deck: new InfiniteDeck(['sha']),
    });
    const [a, b] = game.players;

    const phases: GameEventMap['phase-change'][] = [];
    game.bus.on('phase-change', (e) => phases.push(e));

    const result = drive(game.run(), new SimpleAI(), game);

    expect(result.winner).toBe(a);
    expect(game.over).toBe(true);
    expect(b.alive).toBe(false);
    expect(a.hp).toBe(1); // 乙反击了 3 个回合
    // 每个回合五个阶段事件都触发过
    const phaseKinds = new Set(phases.map((p) => p.phase));
    expect(phaseKinds).toEqual(new Set(['judge', 'draw', 'play', 'discard', 'finish']));
  });

  it('两人局距离恒为 1，双方始终可互相攻击', () => {
    const game = new Game({ playerNames: ['甲', '乙'] });
    const [a, b] = game.players;
    expect(game.canAttack(a, b)).toBe(true);
    expect(game.canAttack(b, a)).toBe(true);
    expect(game.canAttack(a, a)).toBe(false);
  });
});
