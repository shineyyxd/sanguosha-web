import { describe, expect, it } from 'vitest';
import {
  Game,
  ScriptDeck,
  drive,
  makeCard,
  type AskRequest,
  type AskResponse,
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

describe('【南蛮入侵】/【万箭齐发】', () => {
  it('南蛮入侵：按座次逐人求杀，不出杀受 1 点伤害', () => {
    const { game, players } = setup(['甲', '乙', '丙']);
    const [a, b, c] = players;
    const nanman = makeCard('nanman');
    const sha = makeCard('sha');
    a.hand = [nanman];
    b.hand = [sha];
    c.hand = [];

    const shaAsks: string[] = [];
    drive(
      game.useTrick(a, nanman),
      controller((ask) => {
        if (ask.kind === 'response' && ask.wants === 'sha' && ask.reason === 'nanman') {
          shaAsks.push(ask.playerId);
          return ask.playerId === b.id ? { cardId: sha.id } : { pass: true };
        }
        return { pass: true };
      }),
      game,
    );

    expect(shaAsks).toEqual([b.id, c.id]); // 按座次
    expect(b.hp).toBe(4); // 出杀抵消
    expect(b.hand).toHaveLength(0);
    expect(c.hp).toBe(3); // 没杀受 1 点伤害
    expect(game.discard).toContain(nanman);
  });

  it('万箭齐发：求闪，不出闪受 1 点伤害', () => {
    const { game, players } = setup();
    const [a, b] = players;
    const wanjian = makeCard('wanjian');
    a.hand = [wanjian];
    b.hand = [makeCard('tao')]; // 有桃没闪

    drive(game.useTrick(a, wanjian), passAll, game);

    expect(b.hp).toBe(3);
    expect(b.hand).toHaveLength(1); // 桃没被消耗
  });
});

describe('【决斗】', () => {
  it('目标先出杀：双方轮流出杀，目标先不出的受 1 点伤害', () => {
    const { game, players } = setup();
    const [a, b] = players;
    const juedou = makeCard('juedou');
    a.hand = [juedou, makeCard('sha')];
    b.hand = [];

    drive(game.useTrick(a, juedou, b.id), passAll, game);

    expect(b.hp).toBe(3); // 乙第一张就出不出杀，受甲造成的伤害
    expect(a.hp).toBe(4);
  });

  it('使用者断杀则使用者受伤', () => {
    const { game, players } = setup();
    const [a, b] = players;
    const juedou = makeCard('juedou');
    a.hand = [juedou]; // 甲自己没杀
    b.hand = [makeCard('sha')];

    drive(
      game.useTrick(a, juedou, b.id),
      controller((ask) => {
        const me = game.getPlayer(ask.playerId);
        const sha = me.findCard('sha');
        return ask.kind === 'response' && sha ? { cardId: sha.id } : { pass: true };
      }),
      game,
    );

    expect(b.hp).toBe(4);
    expect(a.hp).toBe(3); // 乙出杀后甲断杀，受乙造成的伤害
  });
});

describe('【无中生有】', () => {
  it('摸两张牌', () => {
    const { game, players } = setup();
    const [a] = players;
    const wuzhong = makeCard('wuzhong');
    a.hand = [wuzhong];

    drive(game.useTrick(a, wuzhong), passAll, game);

    expect(a.hand).toHaveLength(2);
    expect(game.discard).toContain(wuzhong);
  });
});

describe('【过河拆桥】/【顺手牵羊】', () => {
  it('过河拆桥：弃置目标装备区里的武器', () => {
    const { game, players } = setup();
    const [a, b] = players;
    const guohe = makeCard('guohe');
    const weapon = makeCard('qilin');
    a.hand = [guohe];
    b.hand = [];
    b.equips.weapon = weapon;

    drive(game.useTrick(a, guohe, b.id), passAll, game);

    expect(b.equips.weapon).toBeNull();
    expect(game.discard).toContain(weapon);
    expect(game.discard).toContain(guohe);
  });

  it('顺手牵羊：获得目标的一张牌；目标区域无牌/距离大于 1 不能使用', () => {
    const { game, players } = setup();
    const [a, b] = players;
    const shunshou = makeCard('shunshou');
    const tao = makeCard('tao');
    a.hand = [shunshou];
    b.hand = [tao];

    expect(game.canPlay(a, shunshou, b.id)).toBeNull();
    drive(game.useTrick(a, shunshou, b.id), passAll, game);

    expect(b.hand).toHaveLength(0);
    expect(a.hand).toContain(tao); // 甲获得乙的桃

    // 目标区域无牌时不能使用
    expect(game.canPlay(a, makeCard('shunshou'), b.id)).toBe('目标区域里没有牌');
  });
});

describe('【桃园结义】', () => {
  it('全体存活受伤角色回 1 血，满血角色不受影响', () => {
    const { game, players } = setup(['甲', '乙', '丙']);
    const [a, b, c] = players;
    const taoyuan = makeCard('taoyuan');
    a.hp = 2;
    b.hp = 4; // 满血
    c.hp = 1;
    a.hand = [taoyuan];

    drive(game.useTrick(a, taoyuan), passAll, game);

    expect(a.hp).toBe(3);
    expect(b.hp).toBe(4);
    expect(c.hp).toBe(2);
  });

  it('所有角色满血时不能使用', () => {
    const { game, players } = setup();
    expect(game.canPlay(players[0], makeCard('taoyuan'))).not.toBeNull();
  });
});

describe('【五谷丰登】', () => {
  it('亮出存活数张牌，从使用者开始逐人 choose-card 选 1 张，剩余弃置', () => {
    const c1 = makeCard('sha', { suit: 'spade', rank: 7 });
    const c2 = makeCard('tao', { suit: 'heart', rank: 3 });
    const c3 = makeCard('shan', { suit: 'diamond', rank: 2 });
    const { game, players } = setup(['甲', '乙', '丙'], new ScriptDeck([c1, c2, c3]));
    const [a, b, c] = players;
    const wugu = makeCard('wugu');
    a.hand = [wugu];

    const chooseAsks: { playerId: string; cardIds: string[] }[] = [];
    drive(
      game.useTrick(a, wugu),
      controller((ask) => {
        if (ask.kind === 'choose-card') {
          chooseAsks.push({ playerId: ask.playerId, cardIds: ask.cards.map((x) => x.id) });
          return { cardId: ask.cards[0].id }; // 总选第一张
        }
        return { pass: true };
      }),
      game,
    );

    // 甲先选（c1），乙从剩余两张选（c2），丙拿最后一张（c3）
    expect(chooseAsks.map((x) => x.playerId)).toEqual([a.id, b.id, c.id]);
    expect(chooseAsks[1].cardIds).toEqual([c2.id, c3.id]);
    expect(chooseAsks[2].cardIds).toEqual([c3.id]);
    expect(a.hand).toContain(c1);
    expect(b.hand).toContain(c2);
    expect(c.hand).toContain(c3);
  });
});

describe('【借刀杀人】', () => {
  it('持有者出杀：视为对指定目标使用杀', () => {
    const { game, players } = setup(['甲', '乙', '丙']);
    const [a, b, c] = players;
    const jiedao = makeCard('jiedao');
    const sha = makeCard('sha');
    a.hand = [jiedao];
    b.hand = [sha];
    b.equips.weapon = makeCard('qinglong');
    c.hand = [];

    drive(
      game.useTrick(a, jiedao, b.id, c.id),
      controller((ask) =>
        ask.kind === 'response' && ask.reason === 'jiedao' ? { cardId: sha.id } : { pass: true },
      ),
      game,
    );

    expect(c.hp).toBe(3); // 乙对丙出杀命中
    expect(b.hand).toHaveLength(0);
    expect(b.equips.weapon).not.toBeNull(); // 武器保留
  });

  it('持有者不出杀：使用者获得其武器', () => {
    const { game, players } = setup(['甲', '乙', '丙']);
    const [a, b, c] = players;
    const jiedao = makeCard('jiedao');
    const weapon = makeCard('qinglong');
    a.hand = [jiedao];
    b.hand = [];
    b.equips.weapon = weapon;

    drive(game.useTrick(a, jiedao, b.id, c.id), passAll, game);

    expect(b.equips.weapon).toBeNull();
    expect(a.hand).toContain(weapon);
    expect(c.hp).toBe(4);
  });

  it('目标没有武器或杀目标不合法时不能使用', () => {
    const { game, players } = setup(['甲', '乙', '丙']);
    const [a, b, c] = players;
    const jiedao = makeCard('jiedao');
    expect(game.canPlay(a, jiedao, b.id, c.id)).toBe('目标装备区里没有武器');
    b.equips.weapon = makeCard('zhuge');
    expect(game.canPlay(a, jiedao, b.id)).not.toBeNull(); // 缺 targetId2
    expect(game.canPlay(a, jiedao, b.id, b.id)).not.toBeNull(); // 杀目标不能是自己
    expect(game.canPlay(a, jiedao, b.id, c.id)).toBeNull();
  });
});
