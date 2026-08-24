import { describe, expect, it } from 'vitest';
import {
  CARD_DEFS,
  Game,
  ScriptDeck,
  attackRangeOf,
  drive,
  makeCard,
  type AskRequest,
  type AskResponse,
  type CardName,
  type Controller,
  type GameOptions,
} from '../src/index.js';

function setup(names = ['甲', '乙'], deck?: GameOptions['deck']) {
  const game = new Game({ playerNames: names, deck });
  return { game, players: game.players };
}

function controller(fn: (ask: AskRequest) => AskResponse): Controller {
  return { onAsk: fn };
}

const passAll = controller(() => ({ pass: true }));

describe('装备区', () => {
  it('装备进入对应槽位，同槽替换弃置旧装备', () => {
    const { game, players } = setup();
    const [a] = players;
    const zhuge = makeCard('zhuge');
    const qinggang = makeCard('qinggang');
    const bagua = makeCard('bagua');
    a.hand = [zhuge, qinggang, bagua];

    game.equipCard(a, zhuge);
    expect(a.equips.weapon).toBe(zhuge);
    game.equipCard(a, qinggang); // 同槽替换
    expect(a.equips.weapon).toBe(qinggang);
    expect(game.discard).toContain(zhuge);
    game.equipCard(a, bagua); // 不同槽位互不影响
    expect(a.equips.armor).toBe(bagua);
    expect(a.equips.weapon).toBe(qinggang);
    expect(a.hand).toHaveLength(0);
  });

  it('所有武器的攻击范围正确', () => {
    const expected: [CardName, number][] = [
      ['zhuge', 1],
      ['cixiong', 2],
      ['qinggang', 2],
      ['qinglong', 3],
      ['zhangba', 3],
      ['guanshi', 3],
      ['fangtian', 4],
      ['qilin', 5],
      ['hanbing', 2],
    ];
    const { players } = setup();
    const [a] = players;
    expect(attackRangeOf(a)).toBe(1); // 无武器
    for (const [name, range] of expected) {
      expect(CARD_DEFS[name].range).toBe(range);
      a.equips.weapon = makeCard(name);
      expect(attackRangeOf(a)).toBe(range);
    }
  });

  it('武器范围接入攻击判定：距离 2 的目标装青釭剑后可杀', () => {
    const { game, players } = setup(['甲', '乙', '丙', '丁']);
    const [a, , c] = players; // 四人局甲到丙座位距离为 2
    expect(game.distance(a, c)).toBe(2);
    expect(game.canAttack(a, c)).toBe(false);
    a.equips.weapon = makeCard('qinggang'); // 范围 2
    expect(game.canAttack(a, c)).toBe(true);
  });
});

describe('【诸葛连弩】', () => {
  it('出牌阶段杀无次数限制', () => {
    const { game, players } = setup();
    const [a, b] = players;
    const sha1 = makeCard('sha');
    const sha2 = makeCard('sha');
    a.hand = [sha1, sha2];
    a.equips.weapon = makeCard('zhuge');
    b.hand = [];

    let playAskCount = 0;
    drive(
      game.playPhase(a),
      controller((ask) => {
        if (ask.kind === 'response') return { pass: true };
        playAskCount++;
        if (playAskCount === 1) return { cardId: sha1.id, targetId: b.id };
        if (playAskCount === 2) return { cardId: sha2.id, targetId: b.id }; // 第二张杀合法
        return { pass: true };
      }),
      game,
    );

    expect(b.hp).toBe(2); // 两张杀都命中
    expect(a.shaUsed).toBe(2);
    expect(playAskCount).toBe(3);
  });
});

describe('【仁王盾】/【青釭剑】', () => {
  it('仁王盾：黑色杀无效（不进入求闪），红色杀正常', () => {
    const { game, players } = setup();
    const [a, b] = players;
    b.equips.armor = makeCard('renwang');
    b.hand = [makeCard('shan')];

    const blackSha = makeCard('sha', { suit: 'spade', rank: 7 });
    a.hand = [blackSha];
    let shanAsked = false;
    drive(
      game.useSha(a, b, blackSha),
      controller(() => {
        shanAsked = true;
        return { pass: true };
      }),
      game,
    );
    expect(shanAsked).toBe(false); // 直接无效，没求闪
    expect(b.hp).toBe(4);
    expect(game.discard).toContain(blackSha);

    const redSha = makeCard('sha', { suit: 'heart', rank: 10 });
    a.hand = [redSha];
    drive(game.useSha(a, b, redSha), passAll, game);
    expect(b.hp).toBe(3); // 红色杀正常命中
  });

  it('青釭剑：无视仁王盾，黑色杀照常结算', () => {
    const { game, players } = setup();
    const [a, b] = players;
    a.equips.weapon = makeCard('qinggang');
    b.equips.armor = makeCard('renwang');
    b.hand = [];

    const blackSha = makeCard('sha', { suit: 'club', rank: 4 });
    a.hand = [blackSha];
    drive(game.useSha(a, b, blackSha), passAll, game);
    expect(b.hp).toBe(3);
  });
});

describe('【八卦阵】', () => {
  /** 八卦阵现在是可选发动：confirm 询问选"发动"才判定。 */
  const confirmBagua = controller((ask) =>
    ask.kind === 'confirm' && ask.skillId === 'bagua' ? { confirm: true } : { pass: true },
  );

  it('需要闪时询问是否发动：判定红色视为打出闪', () => {
    const judgeRed = makeCard('tao', { suit: 'heart', rank: 6 });
    const { game, players } = setup(['甲', '乙'], new ScriptDeck([judgeRed]));
    const [a, b] = players;
    b.equips.armor = makeCard('bagua');
    b.hand = [];

    const sha = makeCard('sha', { suit: 'spade', rank: 8 });
    a.hand = [sha];
    drive(game.useSha(a, b, sha), confirmBagua, game);

    expect(b.hp).toBe(4); // 判定红色，视为出闪
    expect(game.discard).toContain(judgeRed); // 判定牌弃置
  });

  it('拒绝发动则不判定，照常受到伤害', () => {
    const { game, players } = setup(['甲', '乙'], new ScriptDeck([makeCard('tao', { suit: 'heart', rank: 6 })]));
    const [a, b] = players;
    b.equips.armor = makeCard('bagua');
    b.hand = [];

    let baguaAsked = false;
    const sha = makeCard('sha', { suit: 'spade', rank: 8 });
    a.hand = [sha];
    drive(
      game.useSha(a, b, sha),
      controller((ask) => {
        if (ask.kind === 'confirm' && ask.skillId === 'bagua') {
          baguaAsked = true;
          return { pass: true }; // 不发动
        }
        return { pass: true };
      }),
      game,
    );

    expect(baguaAsked).toBe(true);
    expect(b.hp).toBe(3); // 未判定，照常掉血
    expect(game.discard).toContain(sha);
  });

  it('判定黑色则照常受伤；青釭剑无视八卦阵', () => {
    const judgeBlack = makeCard('sha', { suit: 'club', rank: 5 });
    const { game, players } = setup(['甲', '乙'], new ScriptDeck([judgeBlack]));
    const [a, b] = players;
    b.equips.armor = makeCard('bagua');
    b.hand = [];

    const sha1 = makeCard('sha');
    a.hand = [sha1];
    drive(game.useSha(a, b, sha1), confirmBagua, game);
    expect(b.hp).toBe(3); // 判定黑色，受伤

    a.equips.weapon = makeCard('qinggang');
    const sha2 = makeCard('sha');
    a.hand = [sha2];
    drive(game.useSha(a, b, sha2), passAll, game);
    expect(b.hp).toBe(2); // 青釭剑下八卦阵不发动
  });
});

describe('+1/-1 马', () => {
  it('两人局：+1 马使距离变 2，杀和顺手牵羊够不着；-1 马可抵消', () => {
    const { game, players } = setup();
    const [a, b] = players;
    b.hand = [makeCard('tao')];

    expect(game.distance(a, b)).toBe(1);
    b.equips.horsePlus = makeCard('jueying');
    expect(game.distance(a, b)).toBe(2);
    expect(game.canAttack(a, b)).toBe(false);
    expect(game.canPlay(a, makeCard('sha'), b.id)).toBe('【杀】没有合法目标');
    expect(game.canPlay(a, makeCard('shunshou'), b.id)).toBe('目标距离大于 1');

    a.equips.horseMinus = makeCard('chitu');
    expect(game.distance(a, b)).toBe(1);
    expect(game.canAttack(a, b)).toBe(true);
    expect(game.canPlay(a, makeCard('shunshou'), b.id)).toBeNull();
  });
});
