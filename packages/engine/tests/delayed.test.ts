import { describe, expect, it } from 'vitest';
import {
  Game,
  ScriptDeck,
  drive,
  makeCard,
  type AskRequest,
  type AskResponse,
  type Controller,
  type GameEventMap,
} from '../src/index.js';

function controller(fn: (ask: AskRequest) => AskResponse): Controller {
  return { onAsk: fn };
}

const passAll = controller(() => ({ pass: true }));

/** 全放弃，但弃牌阶段（不可放弃）自动弃末尾的牌。 */
const passOrDiscard: Controller = {
  onAsk: (ask, game) =>
    ask.kind === 'discard'
      ? { cardIds: game.getPlayer(ask.playerId).hand.slice(-ask.count).map((c) => c.id) }
      : { pass: true },
};

describe('延时锦囊与判定阶段', () => {
  it('乐不思蜀：判定非红桃跳过出牌阶段，判定牌与乐不思蜀均弃置', () => {
    const judgeClub = makeCard('sha', { suit: 'club', rank: 2 });
    const game = new Game({ playerNames: ['甲', '乙'], deck: new ScriptDeck([judgeClub]) });
    const [, b] = game.players;
    const lebu = makeCard('lebu');
    b.judgeArea = [lebu];

    const asks: AskRequest[] = [];
    const judges: GameEventMap['judge'][] = [];
    game.bus.on('judge', (e) => judges.push(e));

    drive(
      game.runTurn(b),
      controller((ask) => {
        asks.push(ask);
        return { pass: true };
      }),
      game,
    );

    expect(judges).toHaveLength(1);
    expect(judges[0]).toMatchObject({ player: b, card: judgeClub, reason: 'lebu' });
    expect(b.judgeArea).toHaveLength(0);
    expect(game.discard).toContain(lebu);
    expect(game.discard).toContain(judgeClub); // 判定后弃置
    expect(asks.some((a) => a.kind === 'play')).toBe(false); // 出牌阶段被跳过
    expect(b.skipPlay).toBe(true);
  });

  it('乐不思蜀：判定红桃则不跳过出牌阶段', () => {
    const judgeHeart = makeCard('shan', { suit: 'heart', rank: 2 });
    const game = new Game({ playerNames: ['甲', '乙'], deck: new ScriptDeck([judgeHeart]) });
    const [, b] = game.players;
    b.judgeArea = [makeCard('lebu')];

    const asks: AskRequest[] = [];
    drive(
      game.runTurn(b),
      controller((ask) => {
        asks.push(ask);
        return { pass: true };
      }),
      game,
    );

    expect(b.skipPlay).toBe(false);
    expect(asks.some((a) => a.kind === 'play')).toBe(true); // 正常进入出牌阶段
  });

  it('闪电：判定黑桃 2-9 受 3 点雷电伤害并弃置', () => {
    const judgeSpade5 = makeCard('sha', { suit: 'spade', rank: 5 });
    const game = new Game({ playerNames: ['甲', '乙'], deck: new ScriptDeck([judgeSpade5]) });
    const [a] = game.players;
    const shandian = makeCard('shandian');
    a.judgeArea = [shandian];

    const damages: GameEventMap['damage'][] = [];
    game.bus.on('damage', (e) => damages.push(e));

    drive(game.runTurn(a), passOrDiscard, game); // 命中后体力 1 < 手牌 2，需应答弃牌询问

    expect(a.hp).toBe(1); // 4 - 3
    expect(damages[0]).toMatchObject({ source: null, target: a, amount: 3, reason: 'shandian' });
    expect(a.judgeArea).toHaveLength(0);
    expect(game.discard).toContain(shandian);
  });

  it('闪电：判定不为黑桃 2-9 则移给下家判定区', () => {
    const judgeHeart = makeCard('tao', { suit: 'heart', rank: 8 });
    const game = new Game({ playerNames: ['甲', '乙'], deck: new ScriptDeck([judgeHeart]) });
    const [a, b] = game.players;
    const shandian = makeCard('shandian');
    a.judgeArea = [shandian];

    drive(game.runTurn(a), passAll, game);

    expect(a.hp).toBe(4);
    expect(a.judgeArea).toHaveLength(0);
    expect(b.judgeArea).toContain(shandian); // 移给下家
    expect(game.discard).not.toContain(shandian);
  });

  it('延时锦囊判定前可被无懈可击抵消：直接弃置，跳过判定', () => {
    const judgeSpade5 = makeCard('sha', { suit: 'spade', rank: 5 }); // 若判定会命中
    const game = new Game({ playerNames: ['甲', '乙'], deck: new ScriptDeck([judgeSpade5]) });
    const [a, b] = game.players;
    const shandian = makeCard('shandian');
    a.judgeArea = [shandian];
    const wuxie = makeCard('wuxie');
    b.hand = [wuxie];

    const judges: GameEventMap['judge'][] = [];
    game.bus.on('judge', (e) => judges.push(e));

    drive(
      game.judgePhase(a),
      controller((ask) =>
        ask.kind === 'response' && ask.wants === 'wuxie' && ask.playerId === b.id
          ? { cardId: wuxie.id }
          : { pass: true },
      ),
      game,
    );

    expect(judges).toHaveLength(0); // 没有发生判定
    expect(a.hp).toBe(4); // 闪电被抵消，不掉血
    expect(a.judgeArea).toHaveLength(0);
    expect(game.discard).toContain(shandian); // 延时锦囊直接弃置
    expect(game.discard).toContain(wuxie);
  });

  it('乐不思蜀使用时可被无懈可击抵消', () => {
    const game = new Game({ playerNames: ['甲', '乙'] });
    const [a, b] = game.players;
    const lebu = makeCard('lebu');
    const wuxie = makeCard('wuxie');
    a.hand = [lebu];
    b.hand = [wuxie];

    drive(
      game.useTrick(a, lebu, b.id),
      controller((ask) =>
        ask.kind === 'response' && ask.wants === 'wuxie' ? { cardId: wuxie.id } : { pass: true },
      ),
      game,
    );

    expect(b.judgeArea).toHaveLength(0);
    expect(game.discard).toContain(lebu);
  });

  it('判定顺序：判定区有多张延时锦囊时后放置的先判定（栈序），一张判完才判下一张', () => {
    // 闪电先贴、乐不思蜀后贴 → 乐不思蜀先判定；闪电的判定牌在乐不思蜀之后翻
    const lebuJudge = makeCard('sha', { suit: 'heart', rank: 5 }); // 乐不思蜀判红桃：不跳过
    const shandianJudge = makeCard('sha', { suit: 'spade', rank: 5 }); // 闪电判黑桃 5：命中
    const game = new Game({ playerNames: ['甲', '乙'], deck: new ScriptDeck([lebuJudge, shandianJudge]) });
    const [a] = game.players;
    const shandian = makeCard('shandian');
    const lebu = makeCard('lebu');
    a.judgeArea = [shandian, lebu]; // 入区顺序：闪电 → 乐不思蜀

    const judges: GameEventMap['judge'][] = [];
    game.bus.on('judge', (e) => judges.push(e));

    // 闪电命中后体力 1，弃牌阶段需弃牌：自动弃末尾
    drive(game.runTurn(a), passOrDiscard, game);

    expect(judges.map((j) => j.reason)).toEqual(['lebu', 'shandian']); // 后贴的先判
    expect(judges[0].card.id).toBe(lebuJudge.id);
    expect(judges[1].card.id).toBe(shandianJudge.id); // 一张判完再判下一张
    expect(a.skipPlay).toBe(false); // 乐不思蜀判红桃未生效
    expect(a.hp).toBe(1); // 闪电命中：4 - 3
    expect(a.judgeArea).toHaveLength(0); // 两张都已离区
    expect(game.discard).toEqual(expect.arrayContaining([lebu, shandian]));
  });

  it('乐不思蜀进入判定区；同一目标不能叠加两张乐不思蜀', () => {
    const game = new Game({ playerNames: ['甲', '乙'] });
    const [a, b] = game.players;
    const lebu = makeCard('lebu');
    a.hand = [lebu];

    expect(game.canPlay(a, lebu, b.id)).toBeNull();
    drive(game.useTrick(a, lebu, b.id), passAll, game);
    expect(b.judgeArea).toContain(lebu);
    expect(game.canPlay(a, makeCard('lebu'), b.id)).toBe('目标判定区里已有【乐不思蜀】');
  });
});
