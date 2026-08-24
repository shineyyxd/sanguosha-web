import { describe, expect, it } from 'vitest';
import {
  Game,
  drive,
  makeCard,
  type AskRequest,
  type AskResponse,
  type Controller,
} from '../src/index.js';

function setup() {
  const game = new Game({ playerNames: ['甲', '乙'] });
  const [a, b] = game.players;
  return { game, a, b };
}

function controller(fn: (ask: AskRequest) => AskResponse): Controller {
  return { onAsk: fn };
}

describe('濒死', () => {
  it('求桃成功：按座次从濒死者开始询问，其他玩家可出【桃】救回', () => {
    const { game, a, b } = setup();
    const tao = makeCard('tao');
    b.hp = 1;
    b.hand = [];
    a.hand = [tao];

    const askOrder: string[] = [];
    drive(
      game.dealDamage(a, b, 1, 'sha'),
      controller((ask) => {
        expect(ask).toMatchObject({ kind: 'response', wants: 'tao', reason: 'dying' });
        askOrder.push(ask.playerId);
        // 乙（濒死者）无桃放弃；甲出桃救乙
        return ask.playerId === a.id ? { cardId: tao.id } : { pass: true };
      }),
      game,
    );

    expect(askOrder).toEqual([b.id, a.id]); // 从濒死者开始按座次
    expect(b.alive).toBe(true);
    expect(b.hp).toBe(1);
    expect(a.hand).toHaveLength(0);
    expect(game.over).toBe(false);
  });

  it('无人救则死亡：触发 death 事件并结束游戏', () => {
    const { game, a, b } = setup();
    b.hp = 1;
    b.hand = [];
    a.hand = [makeCard('sha')]; // 甲也没有桃

    const deaths: string[] = [];
    game.bus.on('death', (e) => deaths.push(e.player.id));

    drive(game.dealDamage(a, b, 1, 'sha'), controller(() => ({ pass: true })), game);

    expect(b.alive).toBe(false);
    expect(deaths).toEqual([b.id]);
    expect(game.over).toBe(true);
    expect(game.winner).toBe(a);
  });

  it('多段伤害需要多张桃才能救回', () => {
    const { game, a, b } = setup();
    b.hp = 1;
    b.hand = [makeCard('tao')];
    a.hand = [makeCard('tao')];

    drive(
      game.dealDamage(a, b, 3, 'sha'), // hp: 1 - 3 = -2，需要 3 张桃
      controller((ask) => {
        const me = game.getPlayer(ask.playerId);
        const tao = me.findCard('tao');
        return tao ? { cardId: tao.id } : { pass: true };
      }),
      game,
    );

    expect(b.alive).toBe(false); // 只有 2 张桃，救不回
    expect(game.winner).toBe(a);
  });
});
