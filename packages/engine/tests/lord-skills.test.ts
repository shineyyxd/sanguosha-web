/**
 * 主公技：护驾（曹操）/ 激将（刘备）/ 救援（孙权）。
 * 共同点：只在身份局且持有者是主公（role === 'lord'）时生效；
 * 护驾/激将走"同势力响应"（主公响应失败后按座次询问同势力角色代打），
 * 救援挂在濒死求桃流程上（吴势力角色用桃救主公额外回 1 血）。
 */

import { describe, expect, it } from 'vitest';
import {
  BLANK_GENERAL,
  CAOCAO,
  GANNING,
  GUANYU,
  LIUBEI,
  SIMAYI,
  SUNQUAN,
  Game,
  InfiniteDeck,
  ZHUGELIANG,
  drive,
  makeCard,
  type AskRequest,
  type AskResponse,
  type Controller,
  type Role,
} from '../src/index.js';

function controller(fn: (ask: AskRequest) => AskResponse): Controller {
  return { onAsk: fn };
}

describe('曹操 · 护驾', () => {
  /** 主公曹操；2 号位魏势力司马懿；3 号位蜀势力诸葛亮；1 号位白板反贼出杀。 */
  function setup() {
    const game = new Game({
      playerNames: ['曹操', '甲', '司马懿', '诸葛亮'],
      generals: [CAOCAO, BLANK_GENERAL, SIMAYI, ZHUGELIANG],
      roles: ['lord', 'rebel', 'rebel', 'rebel'],
      deck: new InfiniteDeck(['sha']),
    });
    const [lord, attacker, simayi, zhuge] = game.players;
    const sha = makeCard('sha');
    attacker.hand = [sha];
    lord.hand = [];
    return { game, lord, attacker, simayi, zhuge, sha };
  }

  it('魏势力角色响应护驾：视为主公打出闪，不受伤害', () => {
    const { game, lord, attacker, simayi, sha } = setup();
    const shan = makeCard('shan');
    simayi.hand = [shan];

    const hujiaAsks: string[] = [];
    drive(
      game.useSha(attacker, lord, sha),
      controller((ask) => {
        if (ask.kind === 'response' && ask.reason === 'hujia') {
          hujiaAsks.push(ask.playerId);
          return ask.playerId === simayi.id ? { cardId: shan.id } : { pass: true };
        }
        return { pass: true };
      }),
      game,
    );

    expect(hujiaAsks).toEqual([simayi.id]);
    expect(lord.hp).toBe(lord.maxHp); // 护驾成功，未掉血
    expect(simayi.hand).toHaveLength(0); // 司马懿替主公打出了闪
    expect(game.discard).toContain(shan);
  });

  it('无响应则主公受伤；非同势力（蜀）角色不被询问', () => {
    const { game, lord, attacker, simayi, zhuge, sha } = setup();
    simayi.hand = [makeCard('shan')]; // 有闪但拒绝护驾
    zhuge.hand = [makeCard('shan')]; // 蜀势力有闪：不应被询问

    const hujiaAsks: string[] = [];
    drive(
      game.useSha(attacker, lord, sha),
      controller((ask) => {
        if (ask.kind === 'response' && ask.reason === 'hujia') hujiaAsks.push(ask.playerId);
        return { pass: true };
      }),
      game,
    );

    expect(hujiaAsks).toEqual([simayi.id]); // 只问了魏势力，没问蜀势力
    expect(lord.hp).toBe(lord.maxHp - 1); // 无人护驾，掉血
  });

  it('非主公身份的曹操不能发动护驾', () => {
    const game = new Game({
      playerNames: ['曹操', '甲', '司马懿', '乙'],
      generals: [CAOCAO, BLANK_GENERAL, SIMAYI, BLANK_GENERAL],
      roles: ['rebel', 'lord', 'rebel', 'rebel'], // 曹操是反贼
      deck: new InfiniteDeck(['sha']),
    });
    const [caocao, , simayi] = game.players;
    const attacker = game.players[1];
    const sha = makeCard('sha');
    attacker.hand = [sha];
    caocao.hand = [];
    simayi.hand = [makeCard('shan')];

    let hujiaAsked = false;
    drive(
      game.useSha(attacker, caocao, sha),
      controller((ask) => {
        if (ask.kind === 'response' && ask.reason === 'hujia') hujiaAsked = true;
        return { pass: true };
      }),
      game,
    );

    expect(hujiaAsked).toBe(false);
    expect(caocao.hp).toBe(3); // 4 血非主公，掉 1 血
  });
});

describe('刘备 · 激将', () => {
  function setup() {
    const game = new Game({
      playerNames: ['刘备', '甲', '乙', '关羽'],
      generals: [LIUBEI, BLANK_GENERAL, BLANK_GENERAL, GUANYU],
      roles: ['lord', 'rebel', 'rebel', 'rebel'],
      deck: new InfiniteDeck(['sha']),
    });
    const [lord, p1, p2, guanyu] = game.players;
    return { game, lord, p1, p2, guanyu };
  }

  it('决斗中主公求杀放弃后，蜀势力角色可代打（视为刘备打出）', () => {
    const { game, lord, p1, guanyu } = setup();
    const sha = makeCard('sha');
    guanyu.hand = [sha];

    const jijiangAsks: string[] = [];
    drive(
      game.juedouDuel(p1, lord), // 甲决斗刘备：刘备先出杀
      controller((ask) => {
        if (ask.kind === 'response' && ask.reason === 'jijiang') {
          jijiangAsks.push(ask.playerId);
          return ask.playerId === guanyu.id ? { cardId: sha.id } : { pass: true };
        }
        return { pass: true };
      }),
      game,
    );

    expect(jijiangAsks).toEqual([guanyu.id]);
    expect(lord.hp).toBe(lord.maxHp); // 刘备视为打出了杀，未受伤
    expect(p1.hp).toBe(3); // 甲无杀可出，受到决斗伤害
    expect(guanyu.hand).toHaveLength(0);
  });

  it('无人响应激将则主公照常受伤（南蛮场景）', () => {
    const { game, lord, p1, guanyu } = setup();
    // 关羽两张杀：一张自己响应南蛮，一张留着（但拒绝激将）
    guanyu.hand = [makeCard('sha'), makeCard('sha')];
    const nanman = makeCard('nanman');
    p1.hand = [nanman];

    let jijiangAsked = false;
    drive(
      game.useTrick(p1, nanman),
      controller((ask) => {
        if (ask.kind === 'response' && ask.reason === 'jijiang') {
          jijiangAsked = true;
          return { pass: true }; // 拒绝激将
        }
        // 关羽自己响应南蛮用掉一张杀
        if (ask.kind === 'response' && ask.playerId === guanyu.id && ask.reason === 'nanman') {
          const sha = guanyu.hand.find((c) => c.name === 'sha');
          if (sha) return { cardId: sha.id };
        }
        return { pass: true };
      }),
      game,
    );

    expect(jijiangAsked).toBe(true);
    expect(lord.hp).toBe(lord.maxHp - 1); // 激将无人响应，掉血
  });

  it('非主公身份的刘备不能发动激将', () => {
    const game = new Game({
      playerNames: ['刘备', '甲', '关羽', '乙'],
      generals: [LIUBEI, BLANK_GENERAL, GUANYU, BLANK_GENERAL],
      roles: ['rebel', 'lord', 'rebel', 'rebel'], // 刘备是反贼
      deck: new InfiniteDeck(['sha']),
    });
    const [liubei, attacker, guanyu] = game.players;
    guanyu.hand = [makeCard('sha')];

    let jijiangAsked = false;
    drive(
      game.juedouDuel(attacker, liubei),
      controller((ask) => {
        if (ask.kind === 'response' && ask.reason === 'jijiang') jijiangAsked = true;
        return { pass: true };
      }),
      game,
    );

    expect(jijiangAsked).toBe(false);
    expect(liubei.hp).toBe(3); // 无激将，决斗落败掉血
  });
});

describe('孙权 · 救援', () => {
  /** lordRole='lord'：孙权主公；否则 2 号位为主公、孙权为反贼。 */
  function setup(kingdom: 'wu' | 'other', lordRole: Role = 'lord') {
    const roles: Role[] =
      lordRole === 'lord' ? ['lord', 'rebel', 'rebel', 'rebel'] : ['rebel', 'lord', 'rebel', 'rebel'];
    const game = new Game({
      playerNames: ['孙权', '救兵', '甲', '乙'],
      generals: [SUNQUAN, kingdom === 'wu' ? GANNING : ZHUGELIANG, BLANK_GENERAL, BLANK_GENERAL],
      roles,
      deck: new InfiniteDeck(['sha']),
    });
    const [sunquan, savior] = game.players;
    sunquan.hp = 1;
    const tao = makeCard('tao');
    savior.hand = [tao];
    // 只有救兵出桃（其他人放弃），避免非法响应导致的重问
    const drive_ = (flow: Parameters<typeof drive>[0]) =>
      drive(
        flow,
        controller((ask) =>
          ask.kind === 'response' && ask.wants === 'tao' && ask.playerId === savior.id
            ? { cardId: tao.id }
            : { pass: true },
        ),
        game,
      );
    return { game, sunquan, savior, tao, drive_ };
  }

  it('吴势力角色用桃救主公孙权：额外回复 1 点体力', () => {
    const { game, sunquan, drive_ } = setup('wu');
    drive_(game.dealDamage(game.players[2], sunquan, 1, 'sha')); // 孙权 1→0 濒死
    // 桃回 1 + 救援额外回 1 = 2
    expect(sunquan.hp).toBe(2);
    expect(sunquan.alive).toBe(true);
    expect(game.logs.some((l) => l.includes('救援'))).toBe(true);
  });

  it('非吴势力角色救主公不触发救援；非主公孙权被吴救也不触发', () => {
    // 蜀势力救人：不触发
    const g1 = setup('other');
    g1.drive_(g1.game.dealDamage(g1.game.players[2], g1.sunquan, 1, 'sha'));
    expect(g1.sunquan.hp).toBe(1); // 只回 1

    // 孙权不是主公：吴势力救也不触发
    const g2 = setup('wu', 'rebel');
    g2.drive_(g2.game.dealDamage(g2.game.players[2], g2.sunquan, 1, 'sha'));
    expect(g2.sunquan.hp).toBe(1); // 只回 1
  });
});
