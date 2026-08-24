import { describe, expect, it } from 'vitest';
import {
  Game,
  drive,
  makeCard,
  type AskRequest,
  type AskResponse,
  type Controller,
  type GameEventMap,
} from '../src/index.js';

function setup() {
  const game = new Game({ playerNames: ['甲', '乙'] });
  const [a, b] = game.players;
  return { game, a, b };
}

function controller(fn: (ask: AskRequest) => AskResponse): Controller {
  return { onAsk: fn };
}

describe('【杀】', () => {
  it('被【闪】抵消：目标不掉血，闪被消耗', () => {
    const { game, a, b } = setup();
    const sha = makeCard('sha');
    const shan = makeCard('shan');
    a.hand = [sha];
    b.hand = [shan];

    const asks: AskRequest[] = [];
    drive(
      game.useSha(a, b, sha),
      controller((ask) => {
        asks.push(ask);
        return { cardId: shan.id };
      }),
      game,
    );

    expect(asks).toHaveLength(1);
    expect(asks[0]).toMatchObject({ kind: 'response', playerId: b.id, wants: 'shan', reason: 'sha' });
    expect(b.hp).toBe(4);
    expect(b.hand).toHaveLength(0); // 闪已打出
    expect(a.hand).toHaveLength(0); // 杀已使用
    expect(a.shaUsed).toBe(1);
  });

  it('不出【闪】则命中扣 1 血，并触发 damage 事件', () => {
    const { game, a, b } = setup();
    const sha = makeCard('sha');
    a.hand = [sha];
    b.hand = [];

    const damages: GameEventMap['damage'][] = [];
    game.bus.on('damage', (e) => damages.push(e));

    drive(game.useSha(a, b, sha), controller(() => ({ pass: true })), game);

    expect(b.hp).toBe(3);
    expect(damages).toHaveLength(1);
    expect(damages[0]).toMatchObject({ source: a, target: b, amount: 1, reason: 'sha' });
  });

  it('出牌阶段限一次：第二张【杀】被规则拒绝', () => {
    const { game, a, b } = setup();
    const sha1 = makeCard('sha');
    const sha2 = makeCard('sha');
    a.hand = [sha1, sha2];
    b.hand = [];

    let playAskCount = 0;
    drive(
      game.playPhase(a),
      controller((ask) => {
        if (ask.kind === 'response') return { pass: true }; // 乙无闪
        playAskCount++;
        if (playAskCount === 1) return { cardId: sha1.id, targetId: b.id }; // 第一张杀：合法
        if (playAskCount === 2) return { cardId: sha2.id, targetId: b.id }; // 第二张杀：应被拒绝并重新询问
        return { pass: true };
      }),
      game,
    );

    expect(b.hp).toBe(3); // 只命中一张杀
    expect(a.shaUsed).toBe(1);
    expect(a.hand).toContain(sha2); // 第二张杀还在手里
    expect(playAskCount).toBe(3); // 被拒绝后引擎重新询问了
  });
});

describe('【桃】', () => {
  it('出牌阶段使用回复 1 血', () => {
    const { game, a } = setup();
    const tao = makeCard('tao');
    a.hp = 3;
    a.hand = [tao];

    let playAskCount = 0;
    drive(
      game.playPhase(a),
      controller(() => {
        playAskCount++;
        return playAskCount === 1 ? { cardId: tao.id } : { pass: true };
      }),
      game,
    );

    expect(a.hp).toBe(4);
    expect(a.hand).toHaveLength(0);
  });

  it('满血不能使用【桃】', () => {
    const { game, a } = setup();
    const tao = makeCard('tao');
    a.hand = [tao]; // hp 满值 4

    let playAskCount = 0;
    drive(
      game.playPhase(a),
      controller(() => {
        playAskCount++;
        return playAskCount === 1 ? { cardId: tao.id } : { pass: true }; // 第一次尝试被规则拒绝
      }),
      game,
    );

    expect(a.hp).toBe(4);
    expect(a.hand).toContain(tao);
    expect(playAskCount).toBe(2);
  });

  it('【闪】不能主动使用', () => {
    const { game, a } = setup();
    expect(game.canPlay(a, makeCard('shan'))).not.toBeNull();
  });
});
