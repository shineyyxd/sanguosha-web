import { describe, expect, it } from 'vitest';
import {
  CAOCAO,
  GANNING,
  GUANYU,
  HUANGGAI,
  MACHAO,
  ZHANGLIAO,
  ZHAOYUN,
  BLANK_GENERAL,
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

describe('关羽 · 武圣', () => {
  it('响应窗口可用红牌当杀，黑牌不可转化', () => {
    const game = new Game({ playerNames: ['甲', '乙'], generals: [BLANK_GENERAL, GUANYU] });
    const [a, b] = game.players;
    const nanman = makeCard('nanman');
    const redCard = makeCard('tao', { suit: 'heart', rank: 3 });
    b.hand = [redCard];
    a.hand = [nanman];

    const asks: AskRequest[] = [];
    drive(
      game.useTrick(a, nanman),
      controller((ask) => {
        asks.push(ask);
        if (ask.kind === 'response' && ask.wants === 'sha') {
          // 乙没杀，但有红牌 + 武圣转化选项
          expect(ask.converts).toEqual([
            { skillId: 'wusheng', name: '武圣', as: 'sha', cardIds: [redCard.id] },
          ]);
          return { useSkill: 'wusheng', cardId: redCard.id };
        }
        return { pass: true };
      }),
      game,
    );

    expect(b.hp).toBe(4); // 红牌当杀打出，抵消南蛮
    expect(b.hand).toHaveLength(0);
    expect(game.discard).toContain(redCard);
  });

  it('黑牌不能当杀：非法转化被重新询问', () => {
    const game = new Game({ playerNames: ['甲', '乙'], generals: [GUANYU] });
    const [a, b] = game.players;
    const nanman = makeCard('nanman');
    const blackClub = makeCard('tao', { suit: 'club', rank: 7 }); // 黑色牌不匹配武圣
    b.hand = [blackClub];
    a.hand = [nanman];

    let askCount = 0;
    drive(
      game.useTrick(a, nanman),
      controller((ask) => {
        if (ask.kind === 'response' && ask.wants === 'sha') {
          askCount++;
          // 黑牌没有武圣转化选项
          expect(ask.converts ?? []).toEqual([]);
          if (askCount === 1) return { useSkill: 'wusheng', cardId: blackClub.id }; // 非法，应重问
          return { pass: true };
        }
        return { pass: true };
      }),
      game,
    );

    expect(askCount).toBe(2); // 第一次非法被重问
    expect(b.hp).toBe(3); // 放弃后受伤
    expect(b.hand).toContain(blackClub); // 牌没被消耗
  });

  it('出牌阶段主动用红牌当杀', () => {
    const game = new Game({ playerNames: ['甲', '乙'], generals: [GUANYU] });
    const [a, b] = game.players;
    const redCard = makeCard('wuzhong', { suit: 'heart', rank: 7 });
    a.hand = [redCard];
    b.hand = [];

    let playAskCount = 0;
    drive(
      game.playPhase(a),
      controller((ask) => {
        if (ask.kind !== 'play') return { pass: true }; // 乙的求闪窗口
        playAskCount++;
        if (playAskCount === 1) {
          expect(ask.availableSkills).toContain('wusheng');
          return { useSkill: 'wusheng', cardId: redCard.id, targetId: b.id };
        }
        return { pass: true };
      }),
      game,
    );

    expect(b.hp).toBe(3);
    expect(a.shaUsed).toBe(1);
    expect(a.hand).toHaveLength(0);
  });
});

describe('赵云 · 龙胆', () => {
  it('杀当闪：被杀时用手里的杀响应闪', () => {
    const game = new Game({ playerNames: ['甲', '乙'], generals: [BLANK_GENERAL, ZHAOYUN] });
    const [a, b] = game.players;
    const sha = makeCard('sha');
    const shaAsShan = makeCard('sha');
    a.hand = [sha];
    b.hand = [shaAsShan];

    drive(
      game.useSha(a, b, sha),
      controller((ask) =>
        ask.kind === 'response' && ask.wants === 'shan'
          ? { useSkill: 'longdan-shan', cardId: shaAsShan.id }
          : { pass: true },
      ),
      game,
    );

    expect(b.hp).toBe(4); // 杀当闪抵消
    expect(b.hand).toHaveLength(0);
  });

  it('闪当杀：出牌阶段把闪当杀用', () => {
    const game = new Game({ playerNames: ['甲', '乙'], generals: [ZHAOYUN] });
    const [a, b] = game.players;
    const shan = makeCard('shan');
    a.hand = [shan];
    b.hand = [];

    let playAskCount = 0;
    drive(
      game.playPhase(a),
      controller(() => {
        playAskCount++;
        if (playAskCount === 1) return { useSkill: 'longdan-sha', cardId: shan.id, targetId: b.id };
        return { pass: true };
      }),
      game,
    );

    expect(b.hp).toBe(3);
    expect(a.shaUsed).toBe(1);
    expect(a.hand).toHaveLength(0);
  });

  it('桃不能当闪：非法转化被拒绝', () => {
    const game = new Game({ playerNames: ['甲', '乙'], generals: [BLANK_GENERAL, ZHAOYUN] });
    const [a, b] = game.players;
    const sha = makeCard('sha');
    const tao = makeCard('tao');
    a.hand = [sha];
    b.hand = [tao];

    let askCount = 0;
    drive(
      game.useSha(a, b, sha),
      controller((ask) => {
        if (ask.kind === 'response' && ask.wants === 'shan') {
          askCount++;
          expect(ask.converts ?? []).toEqual([]); // 桃不匹配龙胆
          if (askCount === 1) return { useSkill: 'longdan-shan', cardId: tao.id }; // 非法
          return { pass: true };
        }
        return { pass: true };
      }),
      game,
    );

    expect(askCount).toBe(2);
    expect(b.hp).toBe(3);
    expect(b.hand).toContain(tao);
  });
});

describe('甘宁 · 奇袭', () => {
  it('黑牌当过河拆桥：弃掉目标武器', () => {
    const game = new Game({ playerNames: ['甲', '乙'], generals: [GANNING] });
    const [a, b] = game.players;
    const blackCard = makeCard('sha', { suit: 'club', rank: 5 });
    const weapon = makeCard('qilin');
    a.hand = [blackCard];
    b.hand = [];
    b.equips.weapon = weapon;

    let playAskCount = 0;
    drive(
      game.playPhase(a),
      controller((ask) => {
        playAskCount++;
        if (playAskCount === 1) {
          expect(ask.kind === 'play' && ask.availableSkills).toContain('qixi');
          return { useSkill: 'qixi', cardId: blackCard.id, targetId: b.id };
        }
        return { pass: true };
      }),
      game,
    );

    expect(b.equips.weapon).toBeNull();
    expect(game.discard).toContain(weapon);
    expect(game.discard).toContain(blackCard);
    expect(a.hand).toHaveLength(0);
  });

  it('红牌不能当拆：被拒绝并重问', () => {
    const game = new Game({ playerNames: ['甲', '乙'], generals: [GANNING] });
    const [a, b] = game.players;
    const redCard = makeCard('sha', { suit: 'heart', rank: 10 });
    a.hand = [redCard];
    b.hand = [makeCard('tao')];

    let playAskCount = 0;
    drive(
      game.playPhase(a),
      controller(() => {
        playAskCount++;
        // 红牌不匹配奇袭，availableSkills 不应包含 qixi
        if (playAskCount === 1) return { useSkill: 'qixi', cardId: redCard.id, targetId: b.id };
        return { pass: true };
      }),
      game,
    );

    expect(playAskCount).toBe(2);
    expect(a.hand).toContain(redCard);
    expect(b.hand).toHaveLength(1);
  });
});

describe('张辽 · 突袭', () => {
  it('摸牌阶段改为偷两名角色各一张手牌（不再摸牌）', () => {
    const top = [makeCard('sha'), makeCard('shan')];
    const game = new Game({
      playerNames: ['甲', '乙', '丙'],
      generals: [ZHANGLIAO],
      deck: new ScriptDeck(top),
    });
    const [a, b, c] = game.players;
    const bCard = makeCard('tao');
    const cCard = makeCard('sha');
    b.hand = [bCard];
    c.hand = [cCard];

    const asks: AskRequest[] = [];
    drive(
      game.runTurn(a),
      controller((ask) => {
        asks.push(ask);
        if (ask.kind === 'confirm' && ask.skillId === 'tuxi') return { confirm: true };
        if (ask.kind === 'choose-target' && ask.skillId === 'tuxi') {
          return { targetIds: [b.id, c.id] };
        }
        return { pass: true };
      }),
      game,
    );

    expect(a.hand).toContain(bCard);
    expect(a.hand).toContain(cCard);
    expect(a.hand).toHaveLength(2); // 只偷不摸
    expect(b.hand).toHaveLength(0);
    expect(c.hand).toHaveLength(0);
  });

  it('人数上限：选 3 个目标非法被重问；放弃则正常摸 2 张', () => {
    const top = [makeCard('sha'), makeCard('shan')];
    const game = new Game({
      playerNames: ['甲', '乙', '丙'],
      generals: [ZHANGLIAO],
      deck: new ScriptDeck(top),
    });
    const [a, b, c] = game.players;
    b.hand = [makeCard('tao')];
    c.hand = [makeCard('sha')];

    let chooseCount = 0;
    drive(
      game.runTurn(a),
      controller((ask) => {
        if (ask.kind === 'confirm') return { confirm: true };
        if (ask.kind === 'choose-target') {
          chooseCount++;
          if (chooseCount === 1) return { targetIds: [b.id, c.id, a.id] }; // 3 个且含自己：非法
          return { pass: true }; // 放弃 → 不发动 → 正常摸牌
        }
        return { pass: true };
      }),
      game,
    );

    expect(chooseCount).toBe(2);
    expect(a.hand.map((c) => c.id)).toEqual(top.map((c) => c.id)); // 正常摸了牌堆顶 2 张
    expect(b.hand).toHaveLength(1); // 没偷
  });

  it('确认时放弃：正常摸牌', () => {
    const top = [makeCard('sha'), makeCard('shan')];
    const game = new Game({
      playerNames: ['甲', '乙'],
      generals: [ZHANGLIAO],
      deck: new ScriptDeck(top),
    });
    const [a, b] = game.players;
    b.hand = [makeCard('tao')];

    drive(game.runTurn(a), passAll, game);

    expect(a.hand.map((c) => c.id)).toEqual(top.map((c) => c.id));
    expect(b.hand).toHaveLength(1);
  });
});

describe('黄盖 · 苦肉', () => {
  it('出牌阶段发动：失去 1 血摸 2 张', () => {
    const game = new Game({ playerNames: ['甲', '乙'], generals: [HUANGGAI] });
    const [a] = game.players;
    a.hand = [];

    let playAskCount = 0;
    drive(
      game.playPhase(a),
      controller((ask) => {
        playAskCount++;
        expect(ask.kind === 'play' && ask.availableSkills).toContain('kurou');
        if (playAskCount === 1) return { useSkill: 'kurou' };
        return { pass: true };
      }),
      game,
    );

    expect(a.hp).toBe(3);
    expect(a.hand).toHaveLength(2); // 摸了 2 张
  });

  it('1 血苦肉把自己打进濒死：没人救则死亡（失去体力不触发奸雄类伤害技能）', () => {
    const game = new Game({ playerNames: ['甲', '乙'], generals: [HUANGGAI] });
    const [a, b] = game.players;
    a.hp = 1;
    a.hand = [];
    b.hand = []; // 没人有桃

    let playAskCount = 0;
    const dyingAsks: string[] = [];
    drive(
      game.playPhase(a),
      controller((ask) => {
        if (ask.kind === 'response' && ask.reason === 'dying') {
          dyingAsks.push(ask.playerId);
          return { pass: true };
        }
        playAskCount++;
        if (playAskCount === 1) return { useSkill: 'kurou' };
        return { pass: true };
      }),
      game,
    );

    expect(dyingAsks).toEqual([a.id, b.id]); // 进了濒死求桃
    expect(a.alive).toBe(false);
    expect(game.over).toBe(true);
    expect(game.winner).toBe(b);
  });
});

describe('曹操 · 奸雄', () => {
  it('被杀命中后确认发动：获得那张杀', () => {
    const game = new Game({ playerNames: ['甲', '乙'], generals: [BLANK_GENERAL, CAOCAO] });
    const [a, b] = game.players;
    const sha = makeCard('sha', { suit: 'spade', rank: 7 });
    a.hand = [sha];
    b.hand = [];

    drive(
      game.useSha(a, b, sha),
      controller((ask) =>
        ask.kind === 'confirm' && ask.skillId === 'jianxiong' ? { confirm: true } : { pass: true },
      ),
      game,
    );

    expect(b.hp).toBe(3);
    expect(b.hand).toContain(sha); // 从弃牌堆拿回杀
    expect(game.discard).not.toContain(sha);
  });

  it('放弃发动：牌留在弃牌堆；无牌伤害（闪电）不触发', () => {
    const game = new Game({ playerNames: ['甲', '乙'], generals: [BLANK_GENERAL, CAOCAO] });
    const [a, b] = game.players;
    const sha = makeCard('sha');
    a.hand = [sha];
    b.hand = [];

    drive(game.useSha(a, b, sha), passAll, game);
    expect(b.hand).toHaveLength(0);
    expect(game.discard).toContain(sha);

    // 无来源无牌伤害（闪电）：连确认都不会问
    let confirmAsked = false;
    drive(
      game.dealDamage(null, b, 3, 'shandian'),
      controller((ask) => {
        if (ask.kind === 'confirm') confirmAsked = true;
        return { pass: true };
      }),
      game,
    );
    expect(confirmAsked).toBe(false);
    expect(b.alive).toBe(false); // 3 + 3 = 6 点伤害致死（之前已 3 血→现在是 0-3）
  });
});

describe('马超 · 马术 + 铁骑', () => {
  it('马术：对面 +1 马时距离仍算 1（可杀、可顺手牵羊）', () => {
    const game = new Game({ playerNames: ['甲', '乙'], generals: [MACHAO] });
    const [a, b] = game.players;
    b.equips.horsePlus = makeCard('jueying');
    b.hand = [makeCard('tao')];

    expect(game.distance(a, b)).toBe(1); // 白板视角是 2，马术 -1
    expect(game.canAttack(a, b)).toBe(true);
    expect(game.canPlay(a, makeCard('shunshou'), b.id)).toBeNull();
    // 反向：乙算甲的距离不受马术影响
    expect(game.distance(b, a)).toBe(1); // 两人局基础距离 1
  });

  it('铁骑判定红色：杀不可被闪避（不求闪直接命中）', () => {
    const judgeRed = makeCard('tao', { suit: 'heart', rank: 6 });
    const game = new Game({
      playerNames: ['甲', '乙'],
      generals: [MACHAO],
      deck: new ScriptDeck([judgeRed]),
    });
    const [a, b] = game.players;
    const sha = makeCard('sha');
    a.hand = [sha];
    b.hand = [makeCard('shan')]; // 有闪也没机会用

    let shanAsked = false;
    drive(
      game.useSha(a, b, sha),
      controller((ask) => {
        if (ask.kind === 'confirm' && ask.skillId === 'tieji') return { confirm: true };
        if (ask.kind === 'response' && ask.wants === 'shan') shanAsked = true;
        return { pass: true };
      }),
      game,
    );

    expect(shanAsked).toBe(false);
    expect(b.hp).toBe(3);
    expect(game.discard).toContain(judgeRed); // 判定牌弃置
  });

  it('铁骑判定黑色：照常求闪', () => {
    const judgeBlack = makeCard('sha', { suit: 'club', rank: 5 });
    const game = new Game({
      playerNames: ['甲', '乙'],
      generals: [MACHAO],
      deck: new ScriptDeck([judgeBlack]),
    });
    const [a, b] = game.players;
    const sha = makeCard('sha');
    const shan = makeCard('shan');
    a.hand = [sha];
    b.hand = [shan];

    drive(
      game.useSha(a, b, sha),
      controller((ask) => {
        if (ask.kind === 'confirm' && ask.skillId === 'tieji') return { confirm: true };
        if (ask.kind === 'response' && ask.wants === 'shan') return { cardId: shan.id };
        return { pass: true };
      }),
      game,
    );

    expect(b.hp).toBe(4); // 正常闪掉
    expect(b.hand).toHaveLength(0);
  });
});
