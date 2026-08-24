/**
 * 武器特效：雌雄双股剑 / 寒冰剑 / 青龙偃月刀 / 丈八蛇矛 / 方天画戟 / 麒麟弓。
 * （诸葛连弩/青釭剑/仁王盾/八卦阵见 equips.test.ts。）
 */

import { describe, expect, it } from 'vitest';
import {
  BLANK_GENERAL,
  Game,
  ScriptDeck,
  ZHENJI,
  drive,
  makeCard,
  type AskRequest,
  type AskResponse,
  type Card,
  type Controller,
  type GameEventMap,
  type GameOptions,
} from '../src/index.js';

function controller(fn: (ask: AskRequest) => AskResponse): Controller {
  return { onAsk: fn };
}

const passAll = controller(() => ({ pass: true }));

/** 两人局：甲（男，白板）对乙。generals 可覆盖（如需要女性目标）。 */
function setup(deck?: GameOptions['deck'], generals?: GameOptions['generals']) {
  const game = new Game({ playerNames: ['甲', '乙'], deck, generals });
  const [a, b] = game.players;
  return { game, a, b };
}

describe('【雌雄双股剑】', () => {
  function cixiongSetup() {
    // 甲男性（白板）杀乙女性（甄姬）
    const { game, a, b } = setup(new ScriptDeck([makeCard('tao')]), [BLANK_GENERAL, ZHENJI]);
    a.equips.weapon = makeCard('cixiong');
    return { game, a, b };
  }

  it('指定异性目标后：对方选择弃一张手牌', () => {
    const { game, a, b } = cixiongSetup();
    const victim = makeCard('shan');
    b.hand = [victim];
    const sha = makeCard('sha');
    a.hand = [sha];

    drive(
      game.useSha(a, b, sha),
      controller((ask) => {
        if (ask.kind === 'choose-option' && ask.skillId === 'cixiong') return { choice: 'discard' };
        if (ask.kind === 'discard') return { cardIds: [victim.id] };
        return { pass: true };
      }),
      game,
    );

    expect(b.hand).toHaveLength(0); // 弃掉了手牌
    expect(game.discard).toContain(victim);
    expect(b.hp).toBe(2); // 甄姬 3 血，弃完无闪可出，杀命中
  });

  it('对方选择令使用者摸一张牌；同性目标不触发', () => {
    const g1 = cixiongSetup();
    g1.b.hand = [makeCard('shan')];
    const sha = makeCard('sha');
    g1.a.hand = [sha];
    const handBefore = g1.a.hand.length;
    drive(
      g1.game.useSha(g1.a, g1.b, sha),
      controller((ask) => {
        if (ask.kind === 'choose-option' && ask.skillId === 'cixiong') return { choice: 'draw' };
        return { pass: true };
      }),
      g1.game,
    );
    expect(g1.a.hand.length).toBe(handBefore); // sha 用掉(-1)，摸一张(+1)
    expect(g1.a.hand[0].name).toBe('tao'); // 摸到的是牌堆顶的桃

    // 同性（乙也是男性白板）：不触发，没有 cixiong 询问
    const { game, a, b } = setup();
    a.equips.weapon = makeCard('cixiong');
    b.hand = [makeCard('shan')];
    const sha2 = makeCard('sha');
    a.hand = [sha2];
    let asked = false;
    drive(
      game.useSha(a, b, sha2),
      controller((ask) => {
        if (ask.kind === 'choose-option' && ask.skillId === 'cixiong') asked = true;
        return { pass: true };
      }),
      game,
    );
    expect(asked).toBe(false);
  });
});

describe('【寒冰剑】', () => {
  it('杀造成伤害前可防止之，改为弃置对方两张牌（不产生 damage 事件）', () => {
    const { game, a, b } = setup();
    a.equips.weapon = makeCard('hanbing');
    const c1 = makeCard('shan');
    const c2 = makeCard('tao');
    b.hand = [c1, c2];
    const sha = makeCard('sha');
    a.hand = [sha];

    const damages: GameEventMap['damage'][] = [];
    game.bus.on('damage', (e) => damages.push(e));

    drive(
      game.useSha(a, b, sha),
      controller((ask) =>
        ask.kind === 'confirm' && ask.skillId === 'hanbing' ? { confirm: true } : { pass: true },
      ),
      game,
    );

    expect(damages).toHaveLength(0); // 伤害被防止（伤害结算前）
    expect(b.hp).toBe(4);
    expect(b.hand).toHaveLength(0);
    expect(game.discard).toEqual(expect.arrayContaining([c1, c2]));
  });

  it('不发动则照常造成伤害', () => {
    const { game, a, b } = setup();
    a.equips.weapon = makeCard('hanbing');
    b.hand = [makeCard('tao')];
    a.hand = [makeCard('sha')];
    drive(game.useSha(a, b, a.hand[0]), passAll, game);
    expect(b.hp).toBe(3);
    expect(b.hand).toHaveLength(1); // 牌没被弃
  });
});

describe('【青龙偃月刀】', () => {
  it('杀被闪抵消后可追杀：再出一张杀（不计次数限制），命中造成伤害', () => {
    const { game, a, b } = setup();
    a.equips.weapon = makeCard('qinglong');
    const sha1 = makeCard('sha');
    const chase = makeCard('sha');
    a.hand = [sha1, chase];
    const shan = makeCard('shan');
    b.hand = [shan];

    const chaseAsks: AskRequest[] = [];
    drive(
      game.useSha(a, b, sha1),
      controller((ask) => {
        if (ask.kind === 'response' && ask.reason === 'qinglong') {
          chaseAsks.push(ask);
          return { cardId: chase.id }; // 追杀
        }
        if (ask.kind === 'response' && ask.wants === 'shan' && b.hand.includes(shan)) {
          return { cardId: shan.id }; // 只有一张闪，追杀时无闪可出
        }
        return { pass: true };
      }),
      game,
    );

    expect(chaseAsks).toHaveLength(1);
    expect(b.hp).toBe(3); // 追杀的杀命中
    expect(a.shaUsed).toBe(1); // 追杀不计入出牌阶段次数
    expect(a.hand).toHaveLength(0);
  });

  it('放弃追杀则结算结束', () => {
    const { game, a, b } = setup();
    a.equips.weapon = makeCard('qinglong');
    a.hand = [makeCard('sha'), makeCard('sha')];
    const shan = makeCard('shan');
    b.hand = [shan];
    drive(
      game.useSha(a, b, a.hand[0]),
      controller((ask) => {
        if (ask.kind === 'response' && ask.playerId === b.id && ask.wants === 'shan') {
          return { cardId: shan.id }; // 乙出闪抵消
        }
        return { pass: true }; // 甲放弃追杀
      }),
      game,
    );
    expect(b.hp).toBe(4);
    expect(a.hand).toHaveLength(1);
  });
});

describe('【丈八蛇矛】', () => {
  it('响应窗口：两张手牌当杀打出（南蛮入侵）', () => {
    const { game, a, b } = setup();
    b.equips.weapon = makeCard('zhangba');
    const c1 = makeCard('tao');
    const c2 = makeCard('wuzhong');
    b.hand = [c1, c2];
    const nanman = makeCard('nanman');
    a.hand = [nanman];

    let sawZhangba = false;
    drive(
      game.useTrick(a, nanman),
      controller((ask) => {
        if (ask.kind === 'response' && ask.playerId === b.id && ask.wants === 'sha') {
          sawZhangba = (ask.converts ?? []).some((c) => c.skillId === 'zhangba');
          return { useSkill: 'zhangba', cardIds: [c1.id, c2.id] };
        }
        return { pass: true };
      }),
      game,
    );

    expect(sawZhangba).toBe(true);
    expect(b.hp).toBe(4); // 两张牌当杀打出，抵消南蛮
    expect(b.hand).toHaveLength(0);
    expect(game.discard).toEqual(expect.arrayContaining([c1, c2]));
  });

  it('出牌阶段：两张手牌当杀使用', () => {
    const { game, a, b } = setup();
    a.equips.weapon = makeCard('zhangba');
    const c1 = makeCard('tao');
    const c2 = makeCard('wuzhong');
    a.hand = [c1, c2];
    b.hand = [];

    const seen: string[][] = [];
    drive(
      game.playPhase(a),
      controller((ask) => {
        if (ask.kind === 'play') {
          seen.push(ask.availableSkills ?? []);
          if ((ask.availableSkills ?? []).includes('zhangba')) {
            return { useSkill: 'zhangba', cardIds: [c1.id, c2.id], targetId: b.id };
          }
        }
        return { pass: true };
      }),
      game,
    );

    expect(seen[0]).toContain('zhangba');
    expect(b.hp).toBe(3);
    expect(a.hand).toHaveLength(0);
    expect(a.shaUsed).toBe(1);
  });
});

describe('【方天画戟】', () => {
  it('最后一张手牌【杀】可额外指定至多两个目标，同一张杀依次结算', () => {
    const game = new Game({ playerNames: ['甲', '乙', '丙', '丁'] });
    const [a, b, c, d] = game.players;
    a.equips.weapon = makeCard('fangtian'); // 范围 4，四人局全覆盖
    const sha = makeCard('sha');
    a.hand = [sha];
    b.hand = [];
    c.hand = [];
    d.hand = [];

    drive(game.useSha(a, b, sha, undefined, [c.id, d.id]), passAll, game);

    expect(b.hp).toBe(3);
    expect(c.hp).toBe(3);
    expect(d.hp).toBe(3);
    // 同一张杀只进一次弃牌堆
    expect(game.discard.filter((x) => x === sha)).toHaveLength(1);
    expect(a.shaUsed).toBe(1);
  });

  it('杀不是最后一张手牌时不能额外指定目标', () => {
    const game = new Game({ playerNames: ['甲', '乙', '丙'] });
    const [a, b, c] = game.players;
    a.equips.weapon = makeCard('fangtian');
    const sha = makeCard('sha');
    a.hand = [sha, makeCard('tao')];
    expect(game.canPlay(a, sha, b.id, undefined, [c.id])).toContain('方天画戟');
    a.hand = [sha];
    expect(game.canPlay(a, sha, b.id, undefined, [c.id])).toBeNull();
  });
});

describe('【麒麟弓】', () => {
  it('杀造成伤害后可弃置目标的一匹马（两匹马时由使用者选择）', () => {
    const { game, a, b } = setup();
    a.equips.weapon = makeCard('qilin');
    const plus = makeCard('jueying');
    const minus = makeCard('chitu');
    b.equips.horsePlus = plus;
    b.equips.horseMinus = minus;
    b.hand = [];
    a.hand = [makeCard('sha')];

    drive(
      game.useSha(a, b, a.hand[0]),
      controller((ask) => {
        if (ask.kind === 'confirm' && ask.skillId === 'qilin') return { confirm: true };
        if (ask.kind === 'choose-option' && ask.skillId === 'qilin') return { choice: 'horseMinus' };
        return { pass: true };
      }),
      game,
    );

    expect(b.hp).toBe(3);
    expect(b.equips.horseMinus).toBeNull();
    expect(b.equips.horsePlus).toBe(plus); // 另一匹保留
    expect(game.discard).toContain(minus);
  });

  it('目标没有马则不触发（不发出麒麟弓询问）', () => {
    const { game, a, b } = setup();
    a.equips.weapon = makeCard('qilin');
    b.hand = [];
    a.hand = [makeCard('sha')];
    let asked = false;
    drive(
      game.useSha(a, b, a.hand[0]),
      controller((ask) => {
        if (ask.kind === 'confirm' && ask.skillId === 'qilin') asked = true;
        return { pass: true };
      }),
      game,
    );
    expect(asked).toBe(false);
    expect(b.hp).toBe(3);
  });
});
