/**
 * 第二批武将测试：张飞 / 许褚 / 夏侯惇 / 郭嘉 / 甄姬 / 华佗 / 吕蒙 / 周瑜。
 * 判定相关用 ScriptDeck 精确控制判定牌。
 */

import { describe, expect, it } from 'vitest';
import {
  BLANK_GENERAL,
  GUOJIA,
  HUATUO,
  LVMENG,
  XIAHOUDUN,
  XUZHU,
  ZHANGFEI,
  ZHENJI,
  ZHOUYU,
  Game,
  ScriptDeck,
  drive,
  makeCard,
  type AskRequest,
  type AskResponse,
  type Controller,
} from '../src/index.js';

function controller(fn: (ask: AskRequest) => AskResponse): Controller {
  return { onAsk: fn };
}

const passAll = controller(() => ({ pass: true }));

describe('张飞 · 咆哮', () => {
  it('出牌阶段可连续使用多张【杀】', () => {
    const game = new Game({ playerNames: ['甲', '乙'], generals: [ZHANGFEI] });
    const [a, b] = game.players;
    const sha1 = makeCard('sha');
    const sha2 = makeCard('sha');
    a.hand = [sha1, sha2];
    b.hand = [];

    let playAsk = 0;
    drive(
      game.playPhase(a),
      controller((ask) => {
        if (ask.kind !== 'play') return { pass: true };
        playAsk++;
        if (playAsk === 1) return { cardId: sha1.id, targetId: b.id };
        if (playAsk === 2) return { cardId: sha2.id, targetId: b.id }; // 第二张杀：咆哮放行
        return { pass: true };
      }),
      game,
    );

    expect(b.hp).toBe(2); // 两刀都命中
    expect(a.shaUsed).toBe(2);
    expect(a.hand).toHaveLength(0);
  });

  it('对照：白板第二张杀被拦截并重问', () => {
    const game = new Game({ playerNames: ['甲', '乙'], generals: [BLANK_GENERAL] });
    const [a, b] = game.players;
    const sha1 = makeCard('sha');
    const sha2 = makeCard('sha');
    a.hand = [sha1, sha2];
    b.hand = [];

    let playAsk = 0;
    drive(
      game.playPhase(a),
      controller((ask) => {
        if (ask.kind !== 'play') return { pass: true };
        playAsk++;
        if (playAsk === 1) return { cardId: sha1.id, targetId: b.id };
        if (playAsk === 2) return { cardId: sha2.id, targetId: b.id }; // 非法，引擎重问
        return { pass: true };
      }),
      game,
    );

    expect(playAsk).toBe(3);
    expect(b.hp).toBe(3); // 只命中一刀
    expect(a.hand).toContain(sha2);
  });
});

describe('许褚 · 裸衣', () => {
  it('发动：摸牌阶段只摸 1 张，本回合【杀】伤害+1', () => {
    const sha = makeCard('sha');
    const game = new Game({
      playerNames: ['甲', '乙'],
      generals: [XUZHU],
      deck: new ScriptDeck([sha]),
    });
    const [a, b] = game.players;
    a.hand = [];
    b.hand = [];

    let playAsk = 0;
    drive(
      game.runTurn(a),
      controller((ask) => {
        if (ask.kind === 'confirm' && ask.skillId === 'luoyi') return { confirm: true };
        if (ask.kind === 'play') {
          playAsk++;
          if (playAsk === 1) return { cardId: sha.id, targetId: b.id };
        }
        return { pass: true };
      }),
      game,
    );

    expect(b.hp).toBe(2); // 1 + 裸衣 1
    expect(a.hand).toHaveLength(0); // 只摸了 1 张（杀）并用掉
  });

  it('不发动：正常摸 2 张，伤害不加成；决斗同样吃裸衣加成', () => {
    const sha = makeCard('sha');
    const tao = makeCard('tao');
    const game = new Game({
      playerNames: ['甲', '乙'],
      generals: [XUZHU],
      deck: new ScriptDeck([sha, tao]),
    });
    const [a, b] = game.players;
    a.hand = [];
    b.hand = [];

    let playAsk = 0;
    drive(
      game.runTurn(a),
      controller((ask) => {
        if (ask.kind === 'play') {
          playAsk++;
          if (playAsk === 1) return { cardId: sha.id, targetId: b.id };
        }
        return { pass: true };
      }),
      game,
    );

    expect(b.hp).toBe(3); // 无加成
    expect(a.hand).toHaveLength(1); // 正常摸了 2 张

    // 决斗伤害也+1（直接打标记模拟裸衣已发动的本回合）
    const game2 = new Game({ playerNames: ['甲', '乙'], generals: [XUZHU] });
    const [x, y] = game2.players;
    x.turnFlags.add('luoyi');
    const juedou = makeCard('juedou');
    x.hand = [juedou];
    y.hand = [];
    drive(game2.useTrick(x, juedou, y.id), passAll, game2);
    expect(y.hp).toBe(2); // 决斗 1 + 裸衣 1
  });
});

describe('夏侯惇 · 刚烈', () => {
  it('判定非红桃且来源手牌不足两张：来源直接受 1 点伤害', () => {
    const judge = makeCard('sha', { suit: 'spade', rank: 5 });
    const game = new Game({
      playerNames: ['甲', '乙'],
      generals: [BLANK_GENERAL, XIAHOUDUN],
      deck: new ScriptDeck([judge]),
    });
    const [a, b] = game.players;
    const sha = makeCard('sha');
    a.hand = [sha]; // 出完杀就没牌了
    b.hand = [];

    let optionAsked = false;
    drive(
      game.useSha(a, b, sha),
      controller((ask) => {
        if (ask.kind === 'confirm' && ask.skillId === 'ganglie') return { confirm: true };
        if (ask.kind === 'choose-option') optionAsked = true;
        return { pass: true };
      }),
      game,
    );

    expect(b.hp).toBe(3); // 杀命中
    expect(optionAsked).toBe(false); // 手牌不足两张，不问直接受伤
    expect(a.hp).toBe(3); // 刚烈反伤
  });

  it('判定非红桃：询问伤害来源（不是夏侯惇自己），可选择弃两张手牌', () => {
    const judge = makeCard('sha', { suit: 'club', rank: 3 });
    const game = new Game({
      playerNames: ['甲', '乙'],
      generals: [BLANK_GENERAL, XIAHOUDUN],
      deck: new ScriptDeck([judge]),
    });
    const [a, b] = game.players;
    const sha = makeCard('sha');
    const x = makeCard('shan');
    const y = makeCard('tao');
    a.hand = [sha, x, y];
    b.hand = [];

    const optionAsks: AskRequest[] = [];
    drive(
      game.useSha(a, b, sha),
      controller((ask) => {
        if (ask.kind === 'confirm' && ask.skillId === 'ganglie') return { confirm: true };
        if (ask.kind === 'choose-option' && ask.skillId === 'ganglie') {
          optionAsks.push(ask);
          return { choice: 'discard' };
        }
        if (ask.kind === 'discard') return { cardIds: [x.id, y.id] };
        return { pass: true };
      }),
      game,
    );

    expect(optionAsks).toHaveLength(1);
    expect(optionAsks[0].playerId).toBe(a.id); // 问的是伤害来源
    expect(a.hp).toBe(4); // 弃牌免伤
    expect(a.hand).toHaveLength(0);
    expect(game.discard).toContain(x);
    expect(game.discard).toContain(y);
  });

  it('判定红桃：无事发生；放弃发动：不判定', () => {
    const judge = makeCard('tao', { suit: 'heart', rank: 9 });
    const game = new Game({
      playerNames: ['甲', '乙'],
      generals: [BLANK_GENERAL, XIAHOUDUN],
      deck: new ScriptDeck([judge]),
    });
    const [a, b] = game.players;
    const sha = makeCard('sha');
    a.hand = [sha];
    b.hand = [];

    let optionAsked = false;
    drive(
      game.useSha(a, b, sha),
      controller((ask) => {
        if (ask.kind === 'confirm' && ask.skillId === 'ganglie') return { confirm: true };
        if (ask.kind === 'choose-option') optionAsked = true;
        return { pass: true };
      }),
      game,
    );
    expect(optionAsked).toBe(false);
    expect(a.hp).toBe(4);

    // 放弃发动：不判定不反伤
    const game2 = new Game({ playerNames: ['甲', '乙'], generals: [BLANK_GENERAL, XIAHOUDUN] });
    const [a2, b2] = game2.players;
    const sha2 = makeCard('sha');
    a2.hand = [sha2];
    b2.hand = [];
    drive(game2.useSha(a2, b2, sha2), passAll, game2);
    expect(a2.hp).toBe(4);
    expect(game2.discard).not.toContain(judge);
  });
});

describe('郭嘉 · 天妒 + 遗计', () => {
  it('天妒：自己的判定牌生效后可收入手牌（放弃则进弃牌堆）', () => {
    const lebu = makeCard('lebu');
    const judge = makeCard('sha', { suit: 'heart', rank: 2 }); // 红桃：乐不思蜀未生效
    const game = new Game({
      playerNames: ['甲', '乙'],
      generals: [BLANK_GENERAL, GUOJIA],
      deck: new ScriptDeck([judge]),
    });
    const [, b] = game.players;
    b.judgeArea = [lebu];
    b.hand = [];

    drive(
      game.judgePhase(b),
      controller((ask) =>
        ask.kind === 'confirm' && ask.skillId === 'tiandu' ? { confirm: true } : { pass: true },
      ),
      game,
    );

    expect(b.hand).toContain(judge); // 判定牌入手
    expect(game.discard).not.toContain(judge);

    // 放弃：判定牌留在弃牌堆
    const game2 = new Game({
      playerNames: ['甲', '乙'],
      generals: [BLANK_GENERAL, GUOJIA],
      deck: new ScriptDeck([judge]),
    });
    const [, b2] = game2.players;
    b2.judgeArea = [makeCard('lebu')];
    b2.hand = [];
    drive(game2.judgePhase(b2), passAll, game2);
    expect(b2.hand).toHaveLength(0);
    expect(game2.discard).toContain(judge);
  });

  it('遗计：受 2 点伤害观看 4 张并逐张分配（给队友 / 自己保留）', () => {
    const c1 = makeCard('sha', { suit: 'spade', rank: 1 });
    const c2 = makeCard('shan', { suit: 'heart', rank: 2 });
    const c3 = makeCard('tao', { suit: 'diamond', rank: 3 });
    const c4 = makeCard('sha', { suit: 'club', rank: 4 });
    const game = new Game({
      playerNames: ['甲', '乙'],
      generals: [BLANK_GENERAL, GUOJIA],
      deck: new ScriptDeck([c1, c2, c3, c4]),
    });
    const [a, b] = game.players;
    a.hand = [];
    b.hand = [];

    const giveAsks: AskRequest[] = [];
    drive(
      game.dealDamage(a, b, 2, 'sha', makeCard('sha')),
      controller((ask) => {
        if (ask.kind === 'confirm' && ask.skillId === 'yiji') return { confirm: true };
        if (ask.kind === 'give-card') {
          giveAsks.push(ask);
          // c1 给甲，c2 自留，c3 给甲，c4 自留
          return ask.card.id === c1.id || ask.card.id === c3.id
            ? { targetId: a.id }
            : { pass: true };
        }
        return { pass: true };
      }),
      game,
    );

    expect(b.hp).toBe(1); // 3 - 2
    expect(giveAsks).toHaveLength(4);
    expect(giveAsks.every((ask) => ask.kind === 'give-card' && ask.playerId === b.id)).toBe(true);
    expect(a.hand.map((c) => c.id)).toEqual([c1.id, c3.id]);
    expect(b.hand.map((c) => c.id)).toEqual([c2.id, c4.id]);
  });

  it('遗计放弃：不看不分配', () => {
    const game = new Game({ playerNames: ['甲', '乙'], generals: [BLANK_GENERAL, GUOJIA] });
    const [a, b] = game.players;
    a.hand = [];
    b.hand = [];

    let giveAsked = false;
    drive(
      game.dealDamage(a, b, 1, 'sha', makeCard('sha')),
      controller((ask) => {
        if (ask.kind === 'give-card') giveAsked = true;
        return { pass: true };
      }),
      game,
    );

    expect(giveAsked).toBe(false);
    expect(b.hp).toBe(2);
    expect(b.hand).toHaveLength(0);
  });
});

describe('甄姬 · 洛神 + 倾国', () => {
  it('洛神：黑色判定牌入手并继续，直到红色为止', () => {
    const black1 = makeCard('sha', { suit: 'spade', rank: 5 });
    const black2 = makeCard('shan', { suit: 'club', rank: 6 });
    const red = makeCard('tao', { suit: 'heart', rank: 7 });
    const d1 = makeCard('sha', { suit: 'diamond', rank: 8 });
    const d2 = makeCard('tao', { suit: 'heart', rank: 9 });
    const game = new Game({
      playerNames: ['甲', '乙'],
      generals: [ZHENJI],
      deck: new ScriptDeck([black1, black2, red, d1, d2]),
    });
    const [a] = game.players;
    a.hand = [];

    let confirms = 0;
    drive(
      game.runTurn(a),
      controller((ask) => {
        if (ask.kind === 'confirm' && ask.skillId === 'luoshen') {
          confirms++;
          return { confirm: true };
        }
        if (ask.kind === 'discard') return { cardIds: [d1.id] }; // 4 牌 3 血弃 1
        return { pass: true };
      }),
      game,
    );

    expect(confirms).toBe(3); // 黑、黑、红（停止）
    expect(a.hand).toContain(black1);
    expect(a.hand).toContain(black2);
    expect(a.hand).not.toContain(red); // 红色判定牌不入手
    expect(game.discard).toContain(red);
  });

  it('洛神放弃：不判定，正常摸牌', () => {
    const d1 = makeCard('sha');
    const d2 = makeCard('shan');
    const game = new Game({
      playerNames: ['甲', '乙'],
      generals: [ZHENJI],
      deck: new ScriptDeck([d1, d2]),
    });
    const [a] = game.players;
    a.hand = [];

    drive(game.runTurn(a), passAll, game);

    expect(a.hand.map((c) => c.id)).toEqual([d1.id, d2.id]);
  });

  it('倾国：黑色手牌当闪响应杀；红色不可用', () => {
    const game = new Game({ playerNames: ['甲', '乙'], generals: [BLANK_GENERAL, ZHENJI] });
    const [a, b] = game.players;
    const sha = makeCard('sha');
    const black = makeCard('tao', { suit: 'club', rank: 4 });
    a.hand = [sha];
    b.hand = [black];

    drive(
      game.useSha(a, b, sha),
      controller((ask) => {
        if (ask.kind === 'response' && ask.wants === 'shan') {
          expect(ask.converts).toEqual([
            { skillId: 'qingguo', name: '倾国', as: 'shan', cardIds: [black.id] },
          ]);
          return { useSkill: 'qingguo', cardId: black.id };
        }
        return { pass: true };
      }),
      game,
    );

    expect(b.hp).toBe(3); // 闪掉了（甄姬满血 3）
    expect(b.hand).toHaveLength(0);

    // 红色牌无倾国选项
    const game2 = new Game({ playerNames: ['甲', '乙'], generals: [BLANK_GENERAL, ZHENJI] });
    const [a2, b2] = game2.players;
    const sha2 = makeCard('sha');
    const red = makeCard('tao', { suit: 'heart', rank: 1 });
    a2.hand = [sha2];
    b2.hand = [red];
    drive(
      game2.useSha(a2, b2, sha2),
      controller((ask) => {
        if (ask.kind === 'response' && ask.wants === 'shan') {
          expect(ask.converts ?? []).toEqual([]);
        }
        return { pass: true };
      }),
      game2,
    );
    expect(b2.hp).toBe(2); // 无闪可出，掉 1 血
  });
});

describe('华佗 · 急救 + 青囊', () => {
  it('急救：回合外把红色牌当桃救人', () => {
    const game = new Game({
      playerNames: ['甲', '乙', '丙'],
      generals: [BLANK_GENERAL, BLANK_GENERAL, HUATUO],
    });
    const [a, b, c] = game.players;
    const sha = makeCard('sha');
    const red = makeCard('sha', { suit: 'heart', rank: 10 });
    a.hand = [sha];
    b.hand = [];
    b.hp = 1; // 一刀进濒死
    c.hand = [red];

    drive(
      game.useSha(a, b, sha),
      controller((ask) => {
        if (ask.kind === 'response' && ask.wants === 'tao' && ask.playerId === c.id) {
          expect(ask.converts).toEqual([
            { skillId: 'jijiu', name: '急救', as: 'tao', cardIds: [red.id] },
          ]);
          return { useSkill: 'jijiu', cardId: red.id };
        }
        return { pass: true };
      }),
      game,
    );

    expect(b.alive).toBe(true);
    expect(b.hp).toBe(1);
    expect(c.hand).toHaveLength(0);
    expect(game.discard).toContain(red);
  });

  it('急救：自己回合内不可用（不提供转化选项）', () => {
    const game = new Game({
      playerNames: ['甲', '乙', '丙'],
      generals: [BLANK_GENERAL, BLANK_GENERAL, HUATUO],
    });
    const [a, b, c] = game.players;
    const sha = makeCard('sha');
    const red = makeCard('sha', { suit: 'heart', rank: 10 });
    a.hand = [sha];
    b.hand = [];
    b.hp = 1;
    c.hand = [red];
    c.currentPhase = 'play'; // 模拟华佗自己的回合内

    drive(
      game.useSha(a, b, sha),
      controller((ask) => {
        if (ask.kind === 'response' && ask.wants === 'tao' && ask.playerId === c.id) {
          expect(ask.converts ?? []).toEqual([]); // 回合外才可用
        }
        return { pass: true };
      }),
      game,
    );

    expect(b.alive).toBe(false); // 没人救得了
  });

  it('青囊：弃一张手牌令受伤角色回 1 血，限一次；全场满血不可用', () => {
    const game = new Game({ playerNames: ['甲', '乙'], generals: [HUATUO] });
    const [a, b] = game.players;
    const x = makeCard('sha');
    const y = makeCard('shan');
    a.hand = [x, y];
    b.hp = 3;

    let playAsk = 0;
    drive(
      game.playPhase(a),
      controller((ask) => {
        if (ask.kind !== 'play') return { pass: true };
        playAsk++;
        if (playAsk === 1) {
          expect(ask.availableSkills).toContain('qingnang');
          return { useSkill: 'qingnang', cardId: x.id, targetId: b.id };
        }
        // 第二次：已用过，不再可用
        expect(ask.availableSkills ?? []).not.toContain('qingnang');
        return { pass: true };
      }),
      game,
    );

    expect(b.hp).toBe(4);
    expect(a.hand).toHaveLength(1);
    expect(game.discard).toContain(x);

    // 全场满血：availableSkills 不含青囊
    const game2 = new Game({ playerNames: ['甲', '乙'], generals: [HUATUO] });
    const [a2] = game2.players;
    a2.hand = [makeCard('sha')];
    expect(game2.availableSkills(a2)).not.toContain('qingnang');
  });
});

describe('吕蒙 · 克己', () => {
  it('本回合没出过杀：跳过弃牌阶段（不问不弃）', () => {
    const game = new Game({
      playerNames: ['甲', '乙'],
      generals: [LVMENG],
      deck: new ScriptDeck([makeCard('shan'), makeCard('shan')]),
    });
    const [a] = game.players;
    a.hand = Array.from({ length: 6 }, () => makeCard('tao')); // 6 > 4 血

    const asks: AskRequest[] = [];
    drive(
      game.runTurn(a),
      controller((ask) => {
        asks.push(ask);
        return { pass: true };
      }),
      game,
    );

    expect(asks.some((ask) => ask.kind === 'discard')).toBe(false); // 弃牌阶段被跳过
    expect(a.hand).toHaveLength(8); // 6 + 摸 2，一张不用弃
  });

  it('出牌阶段出过杀：克己不发动，正常弃牌', () => {
    const game = new Game({
      playerNames: ['甲', '乙'],
      generals: [LVMENG],
      deck: new ScriptDeck([makeCard('shan'), makeCard('shan')]),
    });
    const [a, b] = game.players;
    const sha = makeCard('sha');
    a.hand = [sha, ...Array.from({ length: 5 }, () => makeCard('tao'))];
    b.hand = [];

    let discardAsk: AskRequest | null = null;
    let played = false;
    drive(
      game.runTurn(a),
      controller((ask) => {
        if (ask.kind === 'play' && !played) {
          played = true;
          return { cardId: sha.id, targetId: b.id };
        }
        if (ask.kind === 'discard') {
          discardAsk = ask;
          return { cardIds: a.hand.slice(0, ask.count).map((c) => c.id) };
        }
        return { pass: true };
      }),
      game,
    );

    expect(discardAsk).not.toBeNull();
    expect((discardAsk as unknown as { count: number }).count).toBe(3); // 7 牌 4 血
    expect(a.hand).toHaveLength(4);
    expect(b.hp).toBe(3);
  });
});

describe('周瑜 · 英姿 + 反间', () => {
  it('英姿：摸牌阶段多摸一张（放弃则正常摸 2 张）', () => {
    const d1 = makeCard('sha');
    const d2 = makeCard('shan');
    const d3 = makeCard('tao');
    const game = new Game({
      playerNames: ['甲', '乙'],
      generals: [ZHOUYU],
      deck: new ScriptDeck([d1, d2, d3]),
    });
    const [a] = game.players;
    a.hand = [];

    drive(
      game.runTurn(a),
      controller((ask) =>
        ask.kind === 'confirm' && ask.skillId === 'yingzi' ? { confirm: true } : { pass: true },
      ),
      game,
    );

    expect(a.hand.map((c) => c.id)).toEqual([d1.id, d2.id, d3.id]); // 英姿 1 + 正常 2

    const game2 = new Game({
      playerNames: ['甲', '乙'],
      generals: [ZHOUYU],
      deck: new ScriptDeck([d1, d2]),
    });
    const [a2] = game2.players;
    a2.hand = [];
    drive(game2.runTurn(a2), passAll, game2);
    expect(a2.hand).toHaveLength(2);
  });

  it('反间：目标猜错花色则受 1 点伤害并获得该牌，限一次', () => {
    const game = new Game({ playerNames: ['甲', '乙'], generals: [ZHOUYU] });
    const [a, b] = game.players;
    const spadeSha = makeCard('sha', { suit: 'spade', rank: 7 });
    a.hand = [spadeSha];
    b.hand = [];

    const optionAsks: AskRequest[] = [];
    let playAsk = 0;
    drive(
      game.playPhase(a),
      controller((ask) => {
        if (ask.kind === 'play') {
          playAsk++;
          if (playAsk === 1) {
            expect(ask.availableSkills).toContain('fanjian');
            return { useSkill: 'fanjian', targetId: b.id };
          }
          expect(ask.availableSkills ?? []).not.toContain('fanjian'); // 限一次
          return { pass: true };
        }
        if (ask.kind === 'choose-option' && ask.skillId === 'fanjian') {
          optionAsks.push(ask);
          return { choice: 'heart' }; // 猜错（实际是黑桃）
        }
        return { pass: true };
      }),
      game,
    );

    expect(optionAsks).toHaveLength(1);
    expect(optionAsks[0].playerId).toBe(b.id); // 问的是目标角色
    expect(b.hp).toBe(3);
    expect(b.hand).toContain(spadeSha); // 猜错也拿牌
    expect(a.hand).toHaveLength(0);
  });

  it('反间：目标猜对花色则不受伤害', () => {
    const game = new Game({ playerNames: ['甲', '乙'], generals: [ZHOUYU] });
    const [a, b] = game.players;
    const spadeSha = makeCard('sha', { suit: 'spade', rank: 7 });
    a.hand = [spadeSha];
    b.hand = [];

    let playAsk = 0;
    drive(
      game.playPhase(a),
      controller((ask) => {
        if (ask.kind === 'play') {
          playAsk++;
          if (playAsk === 1) return { useSkill: 'fanjian', targetId: b.id };
          return { pass: true };
        }
        if (ask.kind === 'choose-option') return { choice: 'spade' };
        return { pass: true };
      }),
      game,
    );

    expect(b.hp).toBe(4);
    expect(b.hand).toContain(spadeSha);
  });
});
