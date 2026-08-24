/**
 * 回合结构规则审计：起始手牌、摸牌阶段、行动顺序、弃牌阶段（玩家选择弃牌）。
 */

import { describe, expect, it } from 'vitest';
import {
  Game,
  InfiniteDeck,
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

describe('起始手牌与摸牌阶段', () => {
  it('开局每名角色发 4 张起始手牌', () => {
    const game = new Game({ playerNames: ['甲', '乙', '丙'] });
    const draws: GameEventMap['card-draw'][] = [];
    game.bus.on('card-draw', (e) => draws.push(e));

    // 起步到第一个询问为止（此时发牌与首个摸牌阶段已完成）
    const flow = game.run();
    flow.next();

    // 前 3 次摸牌事件是起始手牌，每人 4 张
    expect(draws.slice(0, 3).map((d) => d.cards.length)).toEqual([4, 4, 4]);
    expect(draws[3].cards.length).toBe(2); // 第 4 次是首个行动角色的摸牌阶段
    // 首个行动角色 6 张（4+2），其余仍是起始的 4 张
    expect(game.players[0].hand).toHaveLength(6);
    expect(game.players[1].hand).toHaveLength(4);
    expect(game.players[2].hand).toHaveLength(4);
  });

  it('摸牌阶段摸 2 张（牌堆顶）', () => {
    const top = [makeCard('sha'), makeCard('shan'), makeCard('tao')];
    const game = new Game({ playerNames: ['甲', '乙'], deck: new ScriptDeck(top) });
    const [a] = game.players;

    drive(game.runTurn(a), passAll, game);

    expect(a.hand.map((c) => c.id)).toEqual([top[0].id, top[1].id]); // 恰好摸 2 张
  });
});

describe('行动顺序', () => {
  it('1v1（无身份）由 0 号座先行动', () => {
    const game = new Game({ playerNames: ['甲', '乙'], deck: new InfiniteDeck(['sha']) });
    const starts: string[] = [];
    game.bus.on('turn-start', ({ player }) => starts.push(player.id));
    let n = 0;
    const limited: Controller = {
      onAsk: (ask, g) => {
        if (++n > 6) throw new Error('stop');
        if (ask.kind === 'discard') {
          return { cardIds: g.getPlayer(ask.playerId).hand.slice(-ask.count).map((c) => c.id) };
        }
        return { pass: true };
      },
    };
    try {
      drive(game.run(), limited, game);
    } catch {
      /* 跑一两个回合后主动中断 */
    }
    expect(starts[0]).toBe('p1');
    expect(starts[1]).toBe('p2');
  });
});

describe('弃牌阶段（官方规则：由玩家选择弃哪些）', () => {
  /** a 起手 5 张、体力 3；摸牌阶段再摸 2 张 → 弃牌时需弃 4 张。（ScriptDeck 至少 2 张，避免摸回同一牌对象） */
  function setup() {
    const game = new Game({ playerNames: ['甲', '乙'], deck: new ScriptDeck([makeCard('sha'), makeCard('shan')]) });
    const [a] = game.players;
    a.hp = 3;
    a.hand = [makeCard('sha'), makeCard('shan'), makeCard('tao'), makeCard('wuzhong'), makeCard('guohe')];
    return { game, a };
  }

  it('手牌数 > 体力时发起 discard 询问，弃至手牌数 = 体力；弃哪几张由响应决定', () => {
    const { game, a } = setup();
    const startIds = a.hand.map((c) => c.id);
    let chosen: string[] = [];

    const asks: AskRequest[] = [];
    drive(
      game.runTurn(a),
      controller((ask) => {
        asks.push(ask);
        if (ask.kind === 'discard') {
          // 弃掉：摸上来的 2 张 + 起手的头 2 张（共 4 张），留下起手的后 3 张
          const ids = a.hand.map((c) => c.id);
          chosen = [ids[5], ids[6], ids[0], ids[1]];
          return { cardIds: chosen };
        }
        return { pass: true };
      }),
      game,
    );

    const discardAsk = asks.find((a2) => a2.kind === 'discard');
    expect(discardAsk).toMatchObject({ kind: 'discard', playerId: a.id, count: 4 });
    expect(a.hand.map((c) => c.id)).toEqual(startIds.slice(2)); // 留下的是玩家选剩的
    expect(a.hand).toHaveLength(3); // 弃至手牌数 = 体力
    expect(game.discard.map((c) => c.id)).toEqual(expect.arrayContaining(chosen));
  });

  it('手牌数 ≤ 体力时不发起弃牌询问', () => {
    const game = new Game({ playerNames: ['甲', '乙'], deck: new ScriptDeck([makeCard('sha'), makeCard('shan')]) });
    const [a] = game.players;
    a.hand = [makeCard('sha')];

    const asks: AskRequest[] = [];
    drive(
      game.runTurn(a),
      controller((ask) => {
        asks.push(ask);
        return { pass: true };
      }),
      game,
    );

    expect(asks.some((a2) => a2.kind === 'discard')).toBe(false);
    expect(a.hand).toHaveLength(3); // 1 + 摸牌 2，一张都不用弃
  });

  it('不可放弃、不可少选/多选/重复选/选别人的牌：非法响应一律重问', () => {
    const { game, a } = setup();
    const illegalOf = (ids: string[]): AskResponse[] => [
      { pass: true }, // 放弃
      { cardIds: [ids[0]] }, // 少选
      { cardIds: [...ids.slice(0, 4), ids[4]] }, // 多选（5 张）
      { cardIds: [ids[0], ids[0], ids[1], ids[2]] }, // 重复
      { cardIds: [...ids.slice(0, 3), 'not-in-hand'] }, // 不在手牌中
    ];
    let legal: string[] = [];
    let i = 0;

    const asks: AskRequest[] = [];
    drive(
      game.runTurn(a),
      controller((ask) => {
        asks.push(ask);
        if (ask.kind === 'discard') {
          const ids = a.hand.map((c) => c.id);
          const illegal = illegalOf(ids);
          if (i < illegal.length) return illegal[i++];
          legal = ids.slice(0, 4);
          return { cardIds: legal };
        }
        return { pass: true };
      }),
      game,
    );

    const discardAsks = asks.filter((a2) => a2.kind === 'discard');
    expect(discardAsks).toHaveLength(6); // 5 次非法各重问一次 + 最后一次合法
    expect(a.hand).toHaveLength(3);
    expect(game.discard.map((c) => c.id)).toEqual(expect.arrayContaining(legal));
  });
});
