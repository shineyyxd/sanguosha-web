/**
 * 第四批武将测试：司马懿 / 吕布 / 诸葛亮 / 大乔 / 陆逊（标准包 25 将齐）。
 * 新机制：判定改判挂点（judge-retrial）、需求闪数/杀数（无双）、牌堆顶/底操作（观星）、
 * 杀结算中途换目标（流离）、目标锁定拦截（空城/谦逊）、失去最后手牌（连营）。
 */

import { describe, expect, it } from 'vitest';
import {
  BLANK_GENERAL,
  DAQIAO,
  GENERAL_TEMPLATES,
  GUOJIA,
  IMPLEMENTED_GENERAL_IDS,
  LUXUN,
  LVBU,
  SIMAYI,
  ZHUGELIANG,
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

describe('选将池', () => {
  it('已实现武将扩到 25 个（标准包齐），新武将模板就位', () => {
    expect(IMPLEMENTED_GENERAL_IDS).toHaveLength(25);
    for (const id of ['simayi', 'lvbu', 'zhugeliang', 'daqiao', 'luxun']) {
      expect(IMPLEMENTED_GENERAL_IDS).toContain(id);
      expect(GENERAL_TEMPLATES[id].kingdom).toBeTruthy();
    }
  });
});

describe('司马懿 · 鬼才（改判）', () => {
  it('乐不思蜀判出非红桃时，司马懿打出红桃手牌改判：判定不生效，花色变化生效', () => {
    const judgeCard = makeCard('sha', { suit: 'spade', rank: 5 }); // 原判定：非红桃（乐不思蜀本应生效）
    const game = new Game({
      playerNames: ['甲', '司马懿'],
      generals: [BLANK_GENERAL, SIMAYI],
      deck: new ScriptDeck([judgeCard]),
    });
    const [a, sima] = game.players;
    const sub = makeCard('tao', { suit: 'heart', rank: 3 }); // 改判用红桃手牌
    sima.hand = [sub];
    a.judgeArea.push(makeCard('lebu'));

    let asked: AskRequest | null = null;
    drive(
      game.judgePhase(a),
      controller((ask) => {
        if (ask.kind === 'judge-retrial') {
          asked = ask;
          return { cardId: sub.id };
        }
        return { pass: true };
      }),
      game,
    );

    expect(asked).not.toBeNull();
    expect((asked as unknown as { card: unknown }).card).toBeDefined();
    expect(a.skipPlay).toBe(false); // 改判为红桃：乐不思蜀不生效
    expect(sima.hand).toHaveLength(0); // 打出改判牌
    expect(game.discard).toContain(judgeCard); // 原判定牌弃置
    expect(game.discard).toContain(sub); // 改判牌结算后弃置
  });

  it('不改判（放弃）时按原判定牌生效；非法改判牌重问', () => {
    const judgeCard = makeCard('sha', { suit: 'club', rank: 7 }); // 非红桃
    const game = new Game({
      playerNames: ['甲', '司马懿'],
      generals: [BLANK_GENERAL, SIMAYI],
      deck: new ScriptDeck([judgeCard]),
    });
    const [a, sima] = game.players;
    const sub = makeCard('shan', { suit: 'heart', rank: 2 });
    sima.hand = [sub];
    a.judgeArea.push(makeCard('lebu'));

    let askCount = 0;
    drive(
      game.judgePhase(a),
      controller((ask) => {
        if (ask.kind === 'judge-retrial') {
          askCount++;
          if (askCount === 1) return { cardId: 'not-in-hand' }; // 非法：重问
          return { pass: true }; // 放弃改判
        }
        return { pass: true };
      }),
      game,
    );

    expect(askCount).toBe(2);
    expect(a.skipPlay).toBe(true); // 原判定非红桃：跳过出牌阶段
    expect(sima.hand).toContain(sub);
  });

  it('天妒获得的是改判后的判定牌', () => {
    const judgeCard = makeCard('sha', { suit: 'spade', rank: 5 });
    const game = new Game({
      playerNames: ['郭嘉', '司马懿'],
      generals: [GUOJIA, SIMAYI],
      deck: new ScriptDeck([judgeCard]),
    });
    const [guo, sima] = game.players;
    const sub = makeCard('tao', { suit: 'diamond', rank: 6 });
    sima.hand = [sub];
    guo.judgeArea.push(makeCard('lebu'));

    drive(
      game.judgePhase(guo),
      controller((ask) => {
        if (ask.kind === 'judge-retrial') return { cardId: sub.id };
        if (ask.kind === 'confirm' && ask.skillId === 'tiandu') return { confirm: true };
        return { pass: true };
      }),
      game,
    );

    expect(guo.hand).toContain(sub); // 天妒拿走的是司马懿打出的红桃
    expect(guo.hand).not.toContain(judgeCard);
    expect(guo.skipPlay).toBe(true); // 方块非红桃：乐不思蜀仍生效
  });
});

describe('司马懿 · 反馈', () => {
  it('受到伤害后获得伤害来源的一张牌；放弃则不获得', () => {
    const game = new Game({ playerNames: ['司马懿', '甲'], generals: [SIMAYI] });
    const [sima, a] = game.players;
    const c1 = makeCard('sha');
    a.hand = [c1];

    drive(
      game.dealDamage(a, sima, 1, 'sha', makeCard('sha')),
      controller((ask) => (ask.kind === 'confirm' ? { confirm: true } : { pass: true })),
      game,
    );
    expect(sima.hp).toBe(2);
    expect(sima.hand).toContain(c1);
    expect(a.hand).toHaveLength(0);

    // 放弃：不获得
    const game2 = new Game({ playerNames: ['司马懿', '甲'], generals: [SIMAYI] });
    const [sima2, a2] = game2.players;
    a2.hand = [makeCard('sha')];
    drive(game2.dealDamage(a2, sima2, 1, 'sha', makeCard('sha')), passAll, game2);
    expect(sima2.hand).toHaveLength(0);
    expect(a2.hand).toHaveLength(1);
  });

  it('来源没有手牌时获得其装备区的牌', () => {
    const game = new Game({ playerNames: ['司马懿', '甲'], generals: [SIMAYI] });
    const [sima, a] = game.players;
    const weapon = makeCard('qilin');
    a.hand = [];
    a.equips.weapon = weapon;

    drive(
      game.dealDamage(a, sima, 1, 'sha', makeCard('sha')),
      controller((ask) => (ask.kind === 'confirm' ? { confirm: true } : { pass: true })),
      game,
    );
    expect(sima.hand).toContain(weapon);
    expect(a.equips.weapon).toBeNull();
  });
});

describe('吕布 · 无双', () => {
  it('杀需两张闪：目标只出一张闪仍受伤（连续两次求闪，need 递减）', () => {
    const game = new Game({ playerNames: ['吕布', '甲'], generals: [LVBU] });
    const [bu, a] = game.players;
    const sha = makeCard('sha');
    const shan = makeCard('shan');
    bu.hand = [sha];
    a.hand = [shan];

    const needs: number[] = [];
    drive(
      game.useSha(bu, a, sha),
      controller((ask) => {
        if (ask.kind === 'response' && ask.wants === 'shan') {
          needs.push(ask.need ?? 1);
          if (needs.length === 1) return { cardId: shan.id }; // 只出第一张
          return { pass: true }; // 第二张不出
        }
        return { pass: true };
      }),
      game,
    );

    expect(needs).toEqual([2, 1]); // 第一次需 2 张，出一张后还需 1 张
    expect(a.hp).toBe(3); // 只出一张仍受伤
    expect(a.hand).toHaveLength(0);
  });

  it('杀需两张闪：两张全出则抵消；普通武将的杀仍只需一张', () => {
    const game = new Game({ playerNames: ['吕布', '甲'], generals: [LVBU] });
    const [bu, a] = game.players;
    const sha = makeCard('sha');
    const s1 = makeCard('shan');
    const s2 = makeCard('shan');
    bu.hand = [sha];
    a.hand = [s1, s2];

    drive(
      game.useSha(bu, a, sha),
      controller((ask) => {
        if (ask.kind === 'response' && ask.wants === 'shan') {
          const c = a.hand.find((x) => x.name === 'shan');
          return c ? { cardId: c.id } : { pass: true };
        }
        return { pass: true };
      }),
      game,
    );
    expect(a.hp).toBe(4); // 两闪抵消
    expect(a.hand).toHaveLength(0);

    // 对照：白板杀只需一张闪
    const game2 = new Game({ playerNames: ['甲', '乙'] });
    const [x, y] = game2.players;
    const sha2 = makeCard('sha');
    const shan2 = makeCard('shan');
    y.hand = [shan2];
    let askCount = 0;
    drive(
      game2.useSha(x, y, sha2),
      controller((ask) => {
        if (ask.kind === 'response' && ask.wants === 'shan') {
          askCount++;
          return { cardId: shan2.id };
        }
        return { pass: true };
      }),
      game2,
    );
    expect(askCount).toBe(1);
    expect(y.hp).toBe(4);
  });

  it('决斗中对方每次响应需打出两张杀；只出一张则其受伤', () => {
    const game = new Game({ playerNames: ['吕布', '甲'], generals: [LVBU] });
    const [bu, a] = game.players;
    const juedou = makeCard('juedou');
    const sha = makeCard('sha');
    bu.hand = [juedou];
    a.hand = [sha];

    const needs: number[] = [];
    drive(
      game.useTrick(bu, juedou, a.id),
      controller((ask) => {
        if (ask.kind === 'response' && ask.wants === 'sha' && ask.reason === 'juedou') {
          needs.push(ask.need ?? 1);
          if (needs.length === 1) return { cardId: sha.id }; // 只出第一张杀
          return { pass: true };
        }
        return { pass: true };
      }),
      game,
    );

    expect(needs).toEqual([2, 1]);
    expect(a.hp).toBe(3); // 甲只出一张杀，受决斗伤害
    expect(bu.hp).toBe(4);
  });

  it('吕布成为决斗目标时，对方每次响应同样需两张杀', () => {
    const game = new Game({ playerNames: ['甲', '吕布'], generals: [BLANK_GENERAL, LVBU] });
    const [a, bu] = game.players;
    const juedou = makeCard('juedou');
    const buSha = makeCard('sha');
    const aSha = makeCard('sha');
    a.hand = [juedou, aSha];
    bu.hand = [buSha];

    // 流程：吕布（目标）先出 1 张杀（对方非无双）→ 甲需出 2 张杀，只有 1 张 → 甲受伤
    drive(
      game.useTrick(a, juedou, bu.id),
      controller((ask) => {
        if (ask.kind === 'response' && ask.wants === 'sha') {
          const who = game.getPlayer(ask.playerId);
          const c = who.hand.find((x) => x.name === 'sha');
          return c ? { cardId: c.id } : { pass: true };
        }
        return { pass: true };
      }),
      game,
    );

    expect(bu.hp).toBe(4);
    expect(a.hp).toBe(3); // 甲第二张杀打不出，受伤
  });
});

describe('诸葛亮 · 观星', () => {
  it('准备阶段观看牌堆顶 X 张（X=存活数，至多 5），选中的放底，其余保持顺序回顶', () => {
    const c1 = makeCard('sha', { suit: 'spade', rank: 1 });
    const c2 = makeCard('shan', { suit: 'heart', rank: 2 });
    const c3 = makeCard('tao', { suit: 'diamond', rank: 3 });
    const c4 = makeCard('sha', { suit: 'club', rank: 4 });
    const c5 = makeCard('shan', { suit: 'spade', rank: 5 });
    const c6 = makeCard('tao', { suit: 'heart', rank: 6 });
    const game = new Game({
      playerNames: ['诸葛亮', '甲', '乙'],
      generals: [ZHUGELIANG],
      deck: new ScriptDeck([c1, c2, c3, c4, c5, c6]),
    });
    const [zhuge] = game.players;
    zhuge.hand = [];

    let seen: string[] = [];
    drive(
      game.runTurn(zhuge),
      controller((ask) => {
        if (ask.kind === 'confirm' && ask.skillId === 'guanxing') return { confirm: true };
        if (ask.kind === 'guanxing') {
          seen = ask.cards.map((c) => c.id);
          return { cardIds: [c2.id] }; // c2 放牌堆底，c1/c3 保持顺序回顶
        }
        return { pass: true };
      }),
      game,
    );

    expect(seen).toEqual([c1.id, c2.id, c3.id]); // 观看牌堆顶 3 张（3 人存活）
    expect(zhuge.hand.map((c) => c.id)).toEqual([c1.id, c3.id]); // 摸牌阶段按新顺序摸 2 张
    // 牌堆底验证：继续摸 c4、c5、c6 之后才轮到 c2
    game.drawCards(zhuge, 4);
    expect(zhuge.hand.map((c) => c.id)).toEqual([c1.id, c3.id, c4.id, c5.id, c6.id, c2.id]);
  });

  it('观星放弃或全部回顶：牌序不变；X 至多为 5', () => {
    const cards = Array.from({ length: 8 }, (_, i) => makeCard('sha', { suit: 'spade', rank: i + 1 }));
    const game = new Game({
      playerNames: ['诸葛亮', '甲', '乙', '丙', '丁', '戊'],
      generals: [ZHUGELIANG],
      deck: new ScriptDeck(cards),
    });
    const [zhuge] = game.players;
    zhuge.hand = [];

    let seen: string[] = [];
    drive(
      game.runTurn(zhuge),
      controller((ask) => {
        if (ask.kind === 'confirm' && ask.skillId === 'guanxing') return { confirm: true };
        if (ask.kind === 'guanxing') {
          seen = ask.cards.map((c) => c.id);
          return { pass: true }; // 全部回顶
        }
        return { pass: true };
      }),
      game,
    );

    expect(seen).toHaveLength(5); // 6 人存活 → 至多 5 张
    expect(zhuge.hand.map((c) => c.id)).toEqual([cards[0].id, cards[1].id]); // 顺序未变
  });
});

describe('诸葛亮 · 空城', () => {
  it('没有手牌时不能成为【杀】/【决斗】的目标；有手牌时可以', () => {
    const game = new Game({ playerNames: ['甲', '诸葛亮'], generals: [BLANK_GENERAL, ZHUGELIANG] });
    const [a, zhuge] = game.players;
    zhuge.hand = [];

    expect(game.canPlay(a, makeCard('sha'), zhuge.id)).toBe('空城：不能成为【杀】的目标');
    expect(game.canPlay(a, makeCard('juedou'), zhuge.id)).toBe('空城：不能成为【决斗】的目标');

    zhuge.hand = [makeCard('shan')];
    expect(game.canPlay(a, makeCard('sha'), zhuge.id)).toBeNull();
    expect(game.canPlay(a, makeCard('juedou'), zhuge.id)).toBeNull();
  });
});

describe('大乔 · 国色', () => {
  it('方块牌当【乐不思蜀】使用：进目标判定区，判定按乐不思蜀结算', () => {
    const game = new Game({ playerNames: ['大乔', '甲'], generals: [DAQIAO] });
    const [qiao, a] = game.players;
    const diamondSha = makeCard('sha', { suit: 'diamond', rank: 4 });
    qiao.hand = [diamondSha];

    let playAsk = 0;
    drive(
      game.playPhase(qiao),
      controller((ask) => {
        if (ask.kind !== 'play') return { pass: true };
        playAsk++;
        if (playAsk === 1) {
          expect(ask.availableSkills).toContain('guose');
          return { useSkill: 'guose', cardId: diamondSha.id, targetId: a.id };
        }
        return { pass: true };
      }),
      game,
    );

    expect(qiao.hand).toHaveLength(0);
    expect(a.judgeArea).toHaveLength(1);
    expect(a.judgeArea[0].name).toBe('lebu'); // 判定区里的是虚拟乐不思蜀
    expect(a.judgeArea[0].suit).toBe('diamond');
  });

  it('非方块牌不能发动国色', () => {
    const game = new Game({ playerNames: ['大乔', '甲'], generals: [DAQIAO] });
    const [qiao, a] = game.players;
    const spadeSha = makeCard('sha', { suit: 'spade', rank: 4 });
    qiao.hand = [spadeSha];

    let playAsk = 0;
    drive(
      game.playPhase(qiao),
      controller((ask) => {
        if (ask.kind !== 'play') return { pass: true };
        playAsk++;
        if (playAsk === 1) {
          expect(ask.availableSkills ?? []).not.toContain('guose'); // 手里没方块
          return { useSkill: 'guose', cardId: spadeSha.id, targetId: a.id }; // 强发：非法
        }
        return { pass: true };
      }),
      game,
    );
    expect(a.judgeArea).toHaveLength(0);
    expect(qiao.hand).toContain(spadeSha);
  });
});

describe('大乔 · 流离', () => {
  it('成为杀的目标时弃一张牌转移给攻击范围内的另一名角色', () => {
    const game = new Game({
      playerNames: ['甲', '大乔', '丙'],
      generals: [BLANK_GENERAL, DAQIAO],
    });
    const [a, qiao, c] = game.players;
    const sha = makeCard('sha');
    const cost = makeCard('shan');
    a.hand = [sha];
    qiao.hand = [cost];
    c.hand = []; // 无闪，挨刀

    drive(
      game.useSha(a, qiao, sha),
      controller((ask) => {
        if (ask.kind === 'choose-target' && ask.skillId === 'liuli') {
          expect(ask.targetIds).toContain(c.id);
          expect(ask.targetIds).not.toContain(a.id); // 不能转给杀的使用者
          expect(ask.targetIds).not.toContain(qiao.id);
          return { targetIds: [c.id] };
        }
        if (ask.kind === 'discard') return { cardIds: [cost.id] };
        return { pass: true }; // 丙不出闪
      }),
      game,
    );

    expect(qiao.hp).toBe(3); // 大乔未受伤
    expect(c.hp).toBe(3); // 杀转移给丙，丙受伤
    expect(qiao.hand).toHaveLength(0); // 弃了一张牌
    expect(game.discard).toContain(cost);
  });

  it('流离不能转给杀的使用者：非法选择重问；放弃则正常结算', () => {
    const game = new Game({
      playerNames: ['甲', '大乔', '丙'],
      generals: [BLANK_GENERAL, DAQIAO],
    });
    const [a, qiao, c] = game.players;
    const cost = makeCard('shan');
    qiao.hand = [cost];

    let liuliAsk = 0;
    drive(
      game.useSha(a, qiao, makeCard('sha')),
      controller((ask) => {
        if (ask.kind === 'choose-target' && ask.skillId === 'liuli') {
          liuliAsk++;
          if (liuliAsk === 1) return { targetIds: [a.id] }; // 杀的使用者：非法，重问
          return { targetIds: [c.id] };
        }
        if (ask.kind === 'discard') return { cardIds: [cost.id] };
        return { pass: true };
      }),
      game,
    );
    expect(liuliAsk).toBe(2);
    expect(c.hp).toBe(3);

    // 放弃流离：大乔自己成为目标（无闪受伤）
    const game2 = new Game({
      playerNames: ['甲', '大乔', '丙'],
      generals: [BLANK_GENERAL, DAQIAO],
    });
    const [a2, qiao2] = game2.players;
    qiao2.hand = [makeCard('sha')];
    drive(game2.useSha(a2, qiao2, makeCard('sha')), passAll, game2);
    expect(qiao2.hp).toBe(2);
    expect(qiao2.hand).toHaveLength(1);
  });
});

describe('陆逊 · 谦逊', () => {
  it('不能成为【顺手牵羊】/【乐不思蜀】的目标；过河拆桥不受影响', () => {
    const game = new Game({ playerNames: ['甲', '陆逊'], generals: [BLANK_GENERAL, LUXUN] });
    const [a, lu] = game.players;
    lu.hand = [makeCard('sha')];

    expect(game.canPlay(a, makeCard('shunshou'), lu.id)).toBe('谦逊：不能成为【顺手牵羊】的目标');
    expect(game.canPlay(a, makeCard('lebu'), lu.id)).toBe('谦逊：不能成为【乐不思蜀】的目标');
    expect(game.canPlay(a, makeCard('guohe'), lu.id)).toBeNull();
  });
});

describe('陆逊 · 连营', () => {
  it('失去最后一张手牌后摸一张；连营摸的牌马上打掉还能再连营（连续触发）', () => {
    const d1 = makeCard('sha');
    const d2 = makeCard('tao');
    const d3 = makeCard('shan');
    const game = new Game({
      playerNames: ['陆逊', '甲'],
      generals: [LUXUN],
      deck: new ScriptDeck([d1, d2, d3]),
    });
    const [lu, a] = game.players;
    const sha = makeCard('sha');
    lu.hand = [sha];
    lu.equips.weapon = makeCard('zhuge'); // 连弩：杀无次数限制
    a.hand = []; // 无闪

    let lianyingCount = 0;
    let playAsk = 0;
    drive(
      game.playPhase(lu),
      controller((ask) => {
        if (ask.kind === 'confirm' && ask.skillId === 'lianying') {
          lianyingCount++;
          return { confirm: true };
        }
        if (ask.kind === 'response') return { pass: true };
        if (ask.kind !== 'play') return { pass: true };
        playAsk++;
        if (playAsk === 1) return { cardId: sha.id, targetId: a.id }; // 打出最后一张 → 连营摸 d1
        if (playAsk === 2) return { cardId: d1.id, targetId: a.id }; // 连营摸的杀马上打掉 → 再连营摸 d2
        return { pass: true };
      }),
      game,
    );

    expect(lianyingCount).toBe(2); // 连营连续触发两次（嵌套安全，无死循环）
    expect(lu.hand.map((c) => c.id)).toEqual([d2.id]);
    expect(a.hp).toBe(2); // 两刀都中
  });

  it('被过河拆桥失去最后一张手牌时也触发连营', () => {
    const d1 = makeCard('tao');
    const game = new Game({
      playerNames: ['甲', '陆逊'],
      generals: [BLANK_GENERAL, LUXUN],
      deck: new ScriptDeck([d1]),
    });
    const [a, lu] = game.players;
    const last = makeCard('sha');
    lu.hand = [last];
    const guohe = makeCard('guohe');
    a.hand = [guohe];

    drive(
      game.useTrick(a, guohe, lu.id),
      controller((ask) => (ask.kind === 'confirm' ? { confirm: true } : { pass: true })),
      game,
    );

    expect(lu.hand.map((c) => c.id)).toEqual([d1.id]); // 失去最后手牌 → 连营摸 d1
    expect(game.discard).toContain(last);
  });

  it('放弃连营则不摸牌', () => {
    const game = new Game({ playerNames: ['陆逊', '甲'], generals: [LUXUN] });
    const [lu, a] = game.players;
    const sha = makeCard('sha');
    lu.hand = [sha];

    drive(game.useSha(lu, a, sha), passAll, game);
    expect(lu.hand).toHaveLength(0);
  });
});
