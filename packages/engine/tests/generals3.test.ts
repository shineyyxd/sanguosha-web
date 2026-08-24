/**
 * 第三批武将测试：刘备 / 孙权 / 貂蝉 / 孙尚香 / 黄月英。
 * 前置：势力（kingdom）与性别（gender）建模——模板从事实数据回填，Player 透出。
 */

import { describe, expect, it } from 'vitest';
import {
  BLANK_GENERAL,
  DIAOCHAN,
  GENERAL_TEMPLATES,
  HUANGYUEYING,
  IMPLEMENTED_GENERAL_IDS,
  LIUBEI,
  STANDARD_GENERALS,
  SUNQUAN,
  SUNSHANGXIANG,
  XIAHOUDUN,
  ZHENJI,
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

describe('势力与性别建模', () => {
  it('选将池扩到 25 个武将（标准包齐）；模板的势力/性别与事实数据一致', () => {
    expect(IMPLEMENTED_GENERAL_IDS).toHaveLength(25);
    for (const id of IMPLEMENTED_GENERAL_IDS) {
      const template = GENERAL_TEMPLATES[id];
      const data = STANDARD_GENERALS.find((g) => g.id === id)!;
      expect(data).toBeDefined();
      expect(template.kingdom).toBe(data.kingdom);
      expect(template.gender).toBe(data.gender);
    }
  });

  it('事实数据：女性恰为 甄姬/黄月英/大乔/孙尚香/貂蝉，其余男性', () => {
    const females = STANDARD_GENERALS.filter((g) => g.gender === 'female')
      .map((g) => g.id)
      .sort();
    expect(females).toEqual(['daqiao', 'diaochan', 'huangyueying', 'sunshangxiang', 'zhenji']);
    expect(STANDARD_GENERALS.every((g) => g.gender === 'male' || g.gender === 'female')).toBe(true);
  });

  it('Player 透出势力/性别：白板无势力且默认男性，setGeneral 换将后跟随', () => {
    const game = new Game({ playerNames: ['甲', '乙'] });
    const a = game.players[0];
    expect(a.kingdom).toBeNull();
    expect(a.gender).toBe('male');

    game.setGeneral(a, DIAOCHAN);
    expect(a.kingdom).toBe('qun');
    expect(a.gender).toBe('female');

    game.setGeneral(a, LIUBEI);
    expect(a.kingdom).toBe('shu');
    expect(a.gender).toBe('male');
  });
});

describe('刘备 · 仁德', () => {
  it('分两次各给 1 张：累计到第 2 张时回复 1 点体力（每回合限一次）', () => {
    const game = new Game({ playerNames: ['甲', '乙'], generals: [LIUBEI] });
    const [a, b] = game.players;
    a.hp = 2; // 受伤才能观察回血
    const c1 = makeCard('sha');
    const c2 = makeCard('shan');
    const c3 = makeCard('tao');
    a.hand = [c1, c2, c3];
    b.hand = [];

    let playAsk = 0;
    drive(
      game.playPhase(a),
      controller((ask) => {
        if (ask.kind !== 'play') return { pass: true };
        playAsk++;
        if (playAsk === 1) expect(ask.availableSkills).toContain('rende');
        if (playAsk === 1) return { useSkill: 'rende', cardIds: [c1.id], targetId: b.id };
        if (playAsk === 2) return { useSkill: 'rende', cardIds: [c2.id], targetId: b.id }; // 累计第 2 张 → 回血
        if (playAsk === 3) return { useSkill: 'rende', cardIds: [c3.id], targetId: b.id }; // 限一次，不再回
        return { pass: true };
      }),
      game,
    );

    expect(b.hand.map((c) => c.id)).toEqual([c1.id, c2.id, c3.id]);
    expect(a.hand).toHaveLength(0);
    expect(a.hp).toBe(3); // 2 + 1，只回了一次
  });

  it('一次给两张同样触发回血；非法选择（给自己/重复牌）不生效并重问', () => {
    const game = new Game({ playerNames: ['甲', '乙'], generals: [LIUBEI] });
    const [a, b] = game.players;
    a.hp = 3;
    const c1 = makeCard('sha');
    const c2 = makeCard('shan');
    a.hand = [c1, c2];
    b.hand = [];

    let playAsk = 0;
    drive(
      game.playPhase(a),
      controller((ask) => {
        if (ask.kind !== 'play') return { pass: true };
        playAsk++;
        if (playAsk === 1) return { useSkill: 'rende', cardIds: [c1.id], targetId: a.id }; // 给自己：非法
        if (playAsk === 2) return { useSkill: 'rende', cardIds: [c1.id, c1.id], targetId: b.id }; // 重复：非法
        if (playAsk === 3) return { useSkill: 'rende', cardIds: [c1.id, c2.id], targetId: b.id };
        return { pass: true };
      }),
      game,
    );

    expect(playAsk).toBe(4); // 两次非法重问 + 一次成功 + 收尾
    expect(b.hand).toHaveLength(2);
    expect(a.hp).toBe(4); // 一次给出第 2 张即回血
  });

  it('没有手牌时仁德不可用', () => {
    const game = new Game({ playerNames: ['甲', '乙'], generals: [LIUBEI] });
    const [a] = game.players;
    a.hand = [];
    expect(game.availableSkills(a)).not.toContain('rende');
  });
});

describe('孙权 · 制衡', () => {
  it('弃两张手牌摸等量牌，限一次', () => {
    const d1 = makeCard('sha');
    const d2 = makeCard('shan');
    const game = new Game({
      playerNames: ['甲', '乙'],
      generals: [SUNQUAN],
      deck: new ScriptDeck([d1, d2]),
    });
    const [a] = game.players;
    const x = makeCard('guohe');
    const y = makeCard('nanman');
    const keep = makeCard('tao');
    a.hand = [x, y, keep];

    let playAsk = 0;
    drive(
      game.playPhase(a),
      controller((ask) => {
        if (ask.kind !== 'play') return { pass: true };
        playAsk++;
        if (playAsk === 1) {
          expect(ask.availableSkills).toContain('zhiheng');
          return { useSkill: 'zhiheng', cardIds: [x.id, y.id] };
        }
        expect(ask.availableSkills ?? []).not.toContain('zhiheng'); // 限一次
        return { pass: true };
      }),
      game,
    );

    expect(a.hand.map((c) => c.id)).toEqual([keep.id, d1.id, d2.id]); // 弃 2 摸 2，手牌数不变
    expect(game.discard).toContain(x);
    expect(game.discard).toContain(y);
  });

  it('非法选择（空选/重复/牌不在手中）不消耗次数', () => {
    const d1 = makeCard('sha');
    const game = new Game({
      playerNames: ['甲', '乙'],
      generals: [SUNQUAN],
      deck: new ScriptDeck([d1]),
    });
    const [a, b] = game.players;
    const x = makeCard('guohe');
    a.hand = [x];

    let playAsk = 0;
    drive(
      game.playPhase(a),
      controller((ask) => {
        if (ask.kind !== 'play') return { pass: true };
        playAsk++;
        if (playAsk === 1) return { useSkill: 'zhiheng', cardIds: [] }; // 空选：非法
        if (playAsk === 2) return { useSkill: 'zhiheng', cardIds: [x.id, x.id] }; // 重复：非法
        if (playAsk === 3) return { useSkill: 'zhiheng', cardIds: ['not-in-hand'] }; // 不在手中：非法
        if (playAsk === 4) return { useSkill: 'zhiheng', cardIds: [x.id] };
        return { pass: true };
      }),
      game,
    );

    expect(playAsk).toBe(5);
    expect(a.hand.map((c) => c.id)).toEqual([d1.id]); // 弃 x 摸 d1
    expect(game.discard).toContain(x);
    expect(b.hand).toHaveLength(0);
  });
});

describe('貂蝉 · 离间 + 闭月', () => {
  it('离间：弃一张牌，先选男性视为对后选男性使用决斗（不可被无懈响应），限一次', () => {
    const game = new Game({
      playerNames: ['貂蝉', '甲', '乙'],
      generals: [DIAOCHAN],
    });
    const [d, a, b] = game.players;
    const x = makeCard('sha');
    d.hand = [x];
    a.hand = [makeCard('wuxie')]; // 决斗不可被无懈响应：这张无懈没有出手的机会
    b.hand = []; // 乙无杀，先受决斗伤害

    let playAsk = 0;
    let wuxieAsked = false;
    drive(
      game.playPhase(d),
      controller((ask) => {
        if (ask.kind === 'response' && ask.wants === 'wuxie') {
          wuxieAsked = true;
          return { pass: true };
        }
        if (ask.kind === 'response') return { pass: true }; // 乙不出杀
        if (ask.kind !== 'play') return { pass: true };
        playAsk++;
        if (playAsk === 1) {
          expect(ask.availableSkills).toContain('lijian');
          return { useSkill: 'lijian', cardId: x.id, targetId: a.id, targetId2: b.id };
        }
        expect(ask.availableSkills ?? []).not.toContain('lijian'); // 限一次
        return { pass: true };
      }),
      game,
    );

    expect(wuxieAsked).toBe(false);
    expect(b.hp).toBe(3); // 乙受到来自甲的 1 点决斗伤害
    expect(a.hp).toBe(4);
    expect(d.hand).toHaveLength(0);
    expect(game.discard).toContain(x);
  });

  it('离间的决斗伤害来源是另一名男性角色：可触发刚烈；女性不能成为目标', () => {
    const judge = makeCard('sha', { suit: 'spade', rank: 5 }); // 刚烈判定非红桃
    const game = new Game({
      playerNames: ['貂蝉', '甲', '夏侯', '甄姬'],
      generals: [DIAOCHAN, BLANK_GENERAL, XIAHOUDUN, ZHENJI],
      deck: new ScriptDeck([judge]),
    });
    const [d, a, dun] = game.players;
    const x = makeCard('sha');
    d.hand = [x];
    a.hand = []; // 刚烈时手牌不足两张 → 直接受伤
    dun.hand = []; // 无杀，先受决斗伤害

    let playAsk = 0;
    drive(
      game.playPhase(d),
      controller((ask) => {
        if (ask.kind === 'confirm' && ask.skillId === 'ganglie') return { confirm: true };
        if (ask.kind === 'response') return { pass: true };
        if (ask.kind !== 'play') return { pass: true };
        playAsk++;
        if (playAsk === 1) {
          // 甄姬是女性：非法目标，不消耗次数，重问
          return { useSkill: 'lijian', cardId: x.id, targetId: a.id, targetId2: game.players[3].id };
        }
        if (playAsk === 2) return { useSkill: 'lijian', cardId: x.id, targetId: a.id, targetId2: dun.id };
        return { pass: true };
      }),
      game,
    );

    expect(playAsk).toBe(3); // 非法重问一次 + 成功一次 + 收尾放弃
    expect(dun.hp).toBe(3); // 夏侯惇受决斗伤害（来源甲）
    expect(a.hp).toBe(3); // 刚烈反伤给甲——伤害来源确实是另一名男性角色
  });

  it('闭月：结束阶段摸一张牌（放弃则不摸）', () => {
    const d1 = makeCard('sha');
    const d2 = makeCard('shan');
    const d3 = makeCard('tao');
    const game = new Game({
      playerNames: ['貂蝉', '甲'],
      generals: [DIAOCHAN],
      deck: new ScriptDeck([d1, d2, d3]),
    });
    const [d] = game.players;
    d.hand = [];

    drive(
      game.runTurn(d),
      controller((ask) =>
        ask.kind === 'confirm' && ask.skillId === 'biyue' ? { confirm: true } : { pass: true },
      ),
      game,
    );
    expect(d.hand.map((c) => c.id)).toEqual([d1.id, d2.id, d3.id]); // 摸牌阶段 2 张 + 闭月 1 张

    const game2 = new Game({
      playerNames: ['貂蝉', '甲'],
      generals: [DIAOCHAN],
      deck: new ScriptDeck([d1, d2, d3]),
    });
    const [d2p] = game2.players;
    d2p.hand = [];
    drive(game2.runTurn(d2p), passAll, game2);
    expect(d2p.hand).toHaveLength(2); // 放弃闭月
  });
});

describe('孙尚香 · 结姻 + 枭姬', () => {
  it('结姻：弃两张手牌，与一名受伤男性各回 1 血，限一次', () => {
    const game = new Game({ playerNames: ['香香', '甲'], generals: [SUNSHANGXIANG] });
    const [s, a] = game.players;
    s.hp = 2;
    a.hp = 3; // 受伤男性
    const x = makeCard('sha');
    const y = makeCard('shan');
    s.hand = [x, y];

    let playAsk = 0;
    drive(
      game.playPhase(s),
      controller((ask) => {
        if (ask.kind !== 'play') return { pass: true };
        playAsk++;
        if (playAsk === 1) {
          expect(ask.availableSkills).toContain('jieyin');
          return { useSkill: 'jieyin', cardIds: [x.id, y.id], targetId: a.id };
        }
        expect(ask.availableSkills ?? []).not.toContain('jieyin'); // 限一次
        return { pass: true };
      }),
      game,
    );

    expect(s.hp).toBe(3);
    expect(a.hp).toBe(4);
    expect(s.hand).toHaveLength(0);
    expect(game.discard).toContain(x);
    expect(game.discard).toContain(y);
  });

  it('结姻目标必须是受伤男性：满血/女性/牌数不对均非法重问', () => {
    const game = new Game({
      playerNames: ['香香', '甲', '甄姬'],
      generals: [SUNSHANGXIANG, BLANK_GENERAL, ZHENJI],
    });
    const [s, a, zhen] = game.players;
    s.hp = 2;
    a.hp = 3; // 受伤男性（合法目标）
    const x = makeCard('sha');
    const y = makeCard('shan');
    s.hand = [x, y];

    let playAsk = 0;
    drive(
      game.playPhase(s),
      controller((ask) => {
        if (ask.kind !== 'play') return { pass: true };
        playAsk++;
        if (playAsk === 1) return { useSkill: 'jieyin', cardIds: [x.id], targetId: a.id }; // 只弃一张：非法
        if (playAsk === 2) return { useSkill: 'jieyin', cardIds: [x.id, y.id], targetId: zhen.id }; // 女性：非法
        if (playAsk === 3) return { useSkill: 'jieyin', cardIds: [x.id, y.id], targetId: a.id };
        return { pass: true };
      }),
      game,
    );

    expect(playAsk).toBe(4);
    expect(s.hp).toBe(3);
    expect(a.hp).toBe(4);
  });

  it('枭姬：装备被替换时摸两张牌', () => {
    const d1 = makeCard('sha');
    const d2 = makeCard('shan');
    const game = new Game({
      playerNames: ['香香', '甲'],
      generals: [SUNSHANGXIANG],
      deck: new ScriptDeck([d1, d2]),
    });
    const [s] = game.players;
    s.equips.weapon = makeCard('zhuge');
    const qinggang = makeCard('qinggang');
    s.hand = [qinggang];

    let playAsk = 0;
    drive(
      game.playPhase(s),
      controller((ask) => {
        if (ask.kind === 'confirm' && ask.skillId === 'xiaoji') return { confirm: true };
        if (ask.kind === 'play') {
          playAsk++;
          if (playAsk === 1) return { cardId: qinggang.id }; // 装备青釭剑，替换诸葛连弩
        }
        return { pass: true };
      }),
      game,
    );

    expect(s.equips.weapon).toBe(qinggang);
    expect(s.hand.map((c) => c.id)).toEqual([d1.id, d2.id]); // 枭姬摸 2
  });

  it('枭姬：装备被过河拆桥弃置时摸两张牌（放弃则不摸）', () => {
    const d1 = makeCard('sha');
    const d2 = makeCard('shan');
    const game = new Game({
      playerNames: ['甲', '香香'],
      generals: [BLANK_GENERAL, SUNSHANGXIANG],
      deck: new ScriptDeck([d1, d2]),
    });
    const [a, s] = game.players;
    const guohe = makeCard('guohe');
    const weapon = makeCard('qilin');
    a.hand = [guohe];
    s.hand = [];
    s.equips.weapon = weapon;

    drive(
      game.useTrick(a, guohe, s.id),
      controller((ask) =>
        ask.kind === 'confirm' && ask.skillId === 'xiaoji' ? { confirm: true } : { pass: true },
      ),
      game,
    );

    expect(s.equips.weapon).toBeNull();
    expect(game.discard).toContain(weapon);
    expect(s.hand.map((c) => c.id)).toEqual([d1.id, d2.id]);

    // 放弃：不摸
    const game2 = new Game({
      playerNames: ['甲', '香香'],
      generals: [BLANK_GENERAL, SUNSHANGXIANG],
      deck: new ScriptDeck([d1, d2]),
    });
    const [a2, s2] = game2.players;
    a2.hand = [makeCard('guohe')];
    s2.hand = [];
    s2.equips.armor = makeCard('bagua');
    drive(game2.useTrick(a2, a2.hand[0], s2.id), passAll, game2);
    expect(s2.equips.armor).toBeNull();
    expect(s2.hand).toHaveLength(0);
  });
});

describe('黄月英 · 集智 + 奇才', () => {
  it('集智：使用非延时锦囊时摸一张牌；延时锦囊（乐不思蜀）不触发', () => {
    const d1 = makeCard('sha');
    const d2 = makeCard('shan');
    const d3 = makeCard('tao');
    const game = new Game({
      playerNames: ['月英', '甲'],
      generals: [HUANGYUEYING],
      deck: new ScriptDeck([d1, d2, d3]),
    });
    const [h, a] = game.players;
    const wuzhong = makeCard('wuzhong');
    h.hand = [wuzhong];
    a.hand = [];

    const confirms: string[] = [];
    drive(
      game.useTrick(h, wuzhong),
      controller((ask) => {
        if (ask.kind === 'confirm') {
          confirms.push(ask.skillId);
          return { confirm: true };
        }
        return { pass: true };
      }),
      game,
    );

    expect(confirms).toEqual(['jizhi']); // 集智问了一次
    expect(h.hand.map((c) => c.id)).toEqual([d1.id, d2.id, d3.id]); // 集智 1 + 无中生有 2

    // 延时锦囊不触发集智
    const game2 = new Game({ playerNames: ['月英', '甲'], generals: [HUANGYUEYING] });
    const [h2, a2] = game2.players;
    const lebu = makeCard('lebu');
    h2.hand = [lebu];
    let confirmAsked = false;
    drive(
      game2.useTrick(h2, lebu, a2.id),
      controller((ask) => {
        if (ask.kind === 'confirm') confirmAsked = true;
        return { pass: true };
      }),
      game2,
    );
    expect(confirmAsked).toBe(false);
    expect(a2.judgeArea).toContain(lebu);
  });

  it('奇才：顺手牵羊无距离限制（锁定），白板对照受距离限制', () => {
    // 4 人局对家距离为 2，顺手牵羊原本够不着
    const game = new Game({
      playerNames: ['月英', '甲', '乙', '丙'],
      generals: [HUANGYUEYING],
    });
    const [h, , c] = game.players;
    const shun = makeCard('shunshou');
    const tao = makeCard('tao');
    h.hand = [shun];
    c.hand = [tao];

    expect(game.distance(h, c)).toBe(2);
    expect(game.canPlay(h, shun, c.id)).toBeNull(); // 奇才：无距离限制

    drive(
      game.useTrick(h, shun, c.id),
      controller((ask) =>
        ask.kind === 'confirm' && ask.skillId === 'jizhi' ? { confirm: true } : { pass: true },
      ),
      game,
    );
    expect(c.hand).toHaveLength(0);
    expect(h.hand).toContain(tao); // 顺到了对家的牌

    // 对照：白板距离 2 不能用顺手牵羊
    const game2 = new Game({ playerNames: ['甲', '乙', '丙', '丁'] });
    const [a, , c2] = game2.players;
    c2.hand = [makeCard('tao')];
    expect(game2.canPlay(a, makeCard('shunshou'), c2.id)).toBe('目标距离大于 1');
  });
});
