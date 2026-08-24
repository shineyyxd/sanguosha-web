/**
 * 身份局：身份配置、主公上限、杀反摸 3、主杀忠弃光、凶手追溯、胜负判定、主公先行。
 */

import { describe, expect, it } from 'vitest';
import {
  Game,
  InfiniteDeck,
  drive,
  makeCard,
  roleConfigFor,
  type AskRequest,
  type AskResponse,
  type Controller,
  type GameEventMap,
  type Role,
} from '../src/index.js';

/** 所有询问都放弃（濒死求桃不救）。 */
const passAll: Controller = { onAsk: () => ({ pass: true }) };

function identityGame(roles: Role[], names?: string[]): Game {
  return new Game({
    playerNames: names ?? roles.map((_, i) => `玩家${i + 1}`),
    roles,
    deck: new InfiniteDeck(['sha']),
  });
}

describe('身份配置', () => {
  it('4/5/6/7/8 人的标准配置', () => {
    expect(roleConfigFor(4)).toEqual(['lord', 'loyalist', 'rebel', 'rebel']);
    expect(roleConfigFor(5)).toEqual(['lord', 'loyalist', 'rebel', 'rebel', 'renegade']);
    expect(roleConfigFor(6).filter((r) => r === 'rebel')).toHaveLength(3);
    expect(roleConfigFor(7).filter((r) => r === 'loyalist')).toHaveLength(2);
    expect(roleConfigFor(8)).toEqual([
      'lord', 'loyalist', 'loyalist', 'rebel', 'rebel', 'rebel', 'rebel', 'renegade',
    ]);
    expect(() => roleConfigFor(3)).toThrow();
  });

  it('>=4 人未指定身份时自动按标准配置分配（主公 0 号座）；2~3 人不分配', () => {
    const g4 = new Game({ playerNames: ['a', 'b', 'c', 'd'] });
    expect(g4.players.map((p) => p.role)).toEqual(['lord', 'loyalist', 'rebel', 'rebel']);
    const g2 = new Game({ playerNames: ['a', 'b'] });
    expect(g2.players.every((p) => p.role === null)).toBe(true);
  });

  it('显式身份必须恰含 1 名主公且与人数一致', () => {
    expect(
      () => new Game({ playerNames: ['a', 'b', 'c', 'd'], roles: ['lord', 'lord', 'rebel', 'rebel'] }),
    ).toThrow();
    expect(
      () => new Game({ playerNames: ['a', 'b', 'c', 'd'], roles: ['lord', 'loyalist', 'rebel'] }),
    ).toThrow();
  });
});

describe('主公加成', () => {
  it('主公体力上限 +1（4 血武将作主公变 5 血），初始体力同步', () => {
    const game = identityGame(['lord', 'loyalist', 'rebel', 'rebel']);
    const [lord, loyalist] = game.players;
    expect(lord.maxHp).toBe(5);
    expect(lord.hp).toBe(5);
    expect(loyalist.maxHp).toBe(4);
  });
});

describe('身份奖惩', () => {
  it('杀死反贼的玩家摸 3 张牌', () => {
    const game = identityGame(['lord', 'loyalist', 'rebel', 'rebel']);
    const [lord, , rebel] = game.players;
    const before = lord.hand.length;
    game.kill(rebel, lord);
    expect(rebel.alive).toBe(false);
    expect(lord.hand.length).toBe(before + 3);
  });

  it('无来源致死（闪电/失去体力）不触发摸牌奖励', () => {
    const game = identityGame(['lord', 'loyalist', 'rebel', 'rebel']);
    const [lord, , rebel] = game.players;
    const before = lord.hand.length;
    game.kill(rebel, null);
    expect(lord.hand.length).toBe(before);
  });

  it('主公杀死忠臣：弃置所有手牌和装备', () => {
    const game = identityGame(['lord', 'loyalist', 'rebel', 'rebel']);
    const [lord, loyalist] = game.players;
    lord.hand.push(makeCard('sha'), makeCard('shan'));
    game.equipCard(lord, makeCard('zhuge'));
    game.equipCard(lord, makeCard('chitu'));
    const discardBefore = game.discard.length;
    game.kill(loyalist, lord);
    expect(lord.hand).toHaveLength(0);
    expect(Object.values(lord.equips).every((c) => c === null)).toBe(true);
    // 装备替换不发生在本流程：弃牌堆净增 4 张（2 手牌 + 2 装备）
    expect(game.discard.length).toBe(discardBefore + 4);
  });

  it('非主公杀死忠臣不受罚；主公杀死反贼正常摸牌', () => {
    const game = identityGame(['lord', 'loyalist', 'rebel', 'rebel']);
    const [lord, loyalist, rebel] = game.players;
    rebel.hand.push(makeCard('sha'));
    game.kill(loyalist, rebel);
    expect(rebel.hand).toHaveLength(1); // 忠臣无摸牌奖励
    const before = lord.hand.length;
    game.kill(rebel, lord);
    expect(lord.hand.length).toBe(before + 3);
  });

  it('凶手沿伤害链追溯：dealDamage 的 source 传到死亡结算（death 事件带 killer）', () => {
    const game = identityGame(['lord', 'loyalist', 'rebel', 'rebel']);
    const [lord, , rebel] = game.players;
    rebel.hp = 1;
    const deaths: GameEventMap['death'][] = [];
    game.bus.on('death', (e) => deaths.push(e));
    const before = lord.hand.length;
    drive(game.dealDamage(lord, rebel, 1, 'sha'), passAll, game);
    expect(deaths).toHaveLength(1);
    expect(deaths[0].killer).toBe(lord);
    expect(lord.hand.length).toBe(before + 3); // 经完整伤害链同样触发奖励
  });

  it('阵亡者的牌（手牌/装备区/判定区）全部进弃牌堆，先奖惩后弃牌', () => {
    const game = identityGame(['lord', 'loyalist', 'rebel', 'rebel']);
    const [lord, , rebel] = game.players;
    const c1 = makeCard('sha');
    const horse = makeCard('chitu');
    const lebu = makeCard('lebu');
    rebel.hand.push(c1);
    rebel.equips.horseMinus = horse;
    rebel.judgeArea.push(lebu);

    const before = lord.hand.length;
    game.kill(rebel, lord);

    expect(lord.hand.length).toBe(before + 3); // 杀反贼摸牌奖惩照常（先于弃牌）
    expect(rebel.hand).toHaveLength(0);
    expect(Object.values(rebel.equips).every((c) => c === null)).toBe(true);
    expect(rebel.judgeArea).toHaveLength(0);
    // 全部进入弃牌堆（奸雄类/收尸类逻辑可读 game.discard 看到）
    expect(game.discard).toEqual(expect.arrayContaining([c1, horse, lebu]));
  });
});

describe('身份局胜负判定', () => {
  it('主公死且场上仍有其他人存活 → 反贼胜', () => {
    const game = identityGame(['lord', 'loyalist', 'rebel', 'rebel']);
    const [lord, , rebel] = game.players;
    game.kill(lord, rebel);
    expect(game.over).toBe(true);
    expect(game.winSide).toBe('rebel');
    expect(game.winner).toBeNull();
  });

  it('主公死时只剩内奸存活 → 内奸独胜', () => {
    const game = identityGame(['lord', 'loyalist', 'rebel', 'rebel', 'renegade']);
    const [lord, loyalist, rebel1, rebel2, renegade] = game.players;
    game.kill(rebel1, renegade);
    game.kill(rebel2, renegade);
    game.kill(loyalist, renegade);
    expect(game.over).toBe(false); // 主公还活着
    game.kill(lord, renegade);
    expect(game.over).toBe(true);
    expect(game.winSide).toBe('renegade');
    expect(game.winner).toBe(renegade);
  });

  it('主公死时内奸与反贼都在 → 反贼胜（内奸未独活）', () => {
    const game = identityGame(['lord', 'loyalist', 'rebel', 'rebel', 'renegade']);
    const [lord, , rebel] = game.players;
    game.kill(lord, rebel);
    expect(game.winSide).toBe('rebel');
    expect(game.winner).toBeNull();
  });

  it('反贼和内奸全灭 → 主公方胜（含忠臣阵亡的情况）', () => {
    const game = identityGame(['lord', 'loyalist', 'rebel', 'rebel', 'renegade']);
    const [lord, loyalist, rebel1, rebel2, renegade] = game.players;
    game.kill(loyalist, rebel1); // 忠臣先阵亡
    expect(game.over).toBe(false);
    game.kill(rebel1, lord);
    game.kill(renegade, lord);
    expect(game.over).toBe(false); // 还剩一个反贼
    game.kill(rebel2, lord);
    expect(game.over).toBe(true);
    expect(game.winSide).toBe('lord');
  });

  it('1v1（无身份）维持原规则：只剩一人即结束', () => {
    const game = new Game({ playerNames: ['甲', '乙'], deck: new InfiniteDeck(['sha']) });
    const [a, b] = game.players;
    game.kill(b, a);
    expect(game.over).toBe(true);
    expect(game.winner).toBe(a);
    expect(game.winSide).toBeNull();
  });
});

describe('主公先行', () => {
  it('身份局从主公开始行动（主公不在 0 号座时同样生效）', () => {
    const game = identityGame(['rebel', 'rebel', 'lord', 'loyalist']);
    const starts: string[] = [];
    game.bus.on('turn-start', ({ player }) => starts.push(player.id));
    // 纯杀牌堆 + 全放弃 AI：没人出杀，跑两轮看行动顺序（弃牌阶段不可放弃，自动弃末尾）
    let n = 0;
    const limited: Controller = {
      onAsk: (ask: AskRequest, g: Game): AskResponse => {
        if (++n > 50) throw new Error('stop');
        if (ask.kind === 'discard') {
          return { cardIds: g.getPlayer(ask.playerId).hand.slice(-ask.count).map((c) => c.id) };
        }
        return { pass: true };
      },
    };
    try {
      drive(game.run(), limited, game);
    } catch {
      /* 跑若干回合后主动中断 */
    }
    expect(starts[0]).toBe(game.players[2].id); // 主公先动
    expect(starts.slice(0, 4)).toEqual(['p3', 'p4', 'p1', 'p2']); // 之后按座次环
  });
});
