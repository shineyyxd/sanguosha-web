/** 多人局的环形座位距离与 ±1 马（4/5/8 人）。 */

import { describe, expect, it } from 'vitest';
import { Game, InfiniteDeck, makeCard, seatDistance } from '../src/index.js';

function ring(n: number): Game {
  return new Game({
    playerNames: Array.from({ length: n }, (_, i) => `P${i}`),
    deck: new InfiniteDeck(['sha']),
  });
}

describe('多人座位距离（环形，取顺/逆时针较短者）', () => {
  it('4 人局：相邻 1，对面 2', () => {
    const [a, b, c, d] = ring(4).players;
    const alive = [a, b, c, d];
    expect(seatDistance(a, b, alive)).toBe(1);
    expect(seatDistance(a, c, alive)).toBe(2);
    expect(seatDistance(a, d, alive)).toBe(1); // 环回
  });

  it('5 人局：距离分布 1/2/2/1', () => {
    const g = ring(5);
    const [a, b, c, d, e] = g.players;
    const alive = g.players;
    expect([b, c, d, e].map((p) => seatDistance(a, p, alive))).toEqual([1, 2, 2, 1]);
  });

  it('8 人局：正对面距离 4', () => {
    const g = ring(8);
    const ps = g.players;
    const alive = ps;
    expect([1, 2, 3, 4, 5, 6, 7].map((i) => seatDistance(ps[0], ps[i], alive))).toEqual([
      1, 2, 3, 4, 3, 2, 1,
    ]);
  });

  it('阵亡者从距离环上移除：8 人局隔位死亡后距离收缩', () => {
    const g = ring(8);
    const ps = g.players;
    ps[1].alive = false;
    ps[2].alive = false;
    expect(seatDistance(ps[0], ps[3], g.alivePlayers())).toBe(1); // 中间两人阵亡
    expect(seatDistance(ps[0], ps[4], g.alivePlayers())).toBe(2);
  });
});

describe('多人局的 ±1 马', () => {
  it('5 人局：防守方 +1 马拉开距离，进攻方 -1 马缩短距离，可叠加', () => {
    const g = ring(5);
    const [a, , c] = g.players; // a 与 c 座位距离 2
    expect(g.distance(a, c)).toBe(2);
    g.equipCard(c, makeCard('jueying')); // c 的 +1 马
    expect(g.distance(a, c)).toBe(3);
    expect(g.distance(c, a)).toBe(2); // +1 马只影响别人打自己
    g.equipCard(a, makeCard('chitu')); // a 的 -1 马
    expect(g.distance(a, c)).toBe(2);
    expect(g.distance(c, a)).toBe(2); // c 没有 -1 马，不变
  });

  it('距离最小为 1：相邻 + -1 马不会变成 0', () => {
    const g = ring(5);
    const [a, b] = g.players;
    g.equipCard(a, makeCard('chitu'));
    expect(g.distance(a, b)).toBe(1);
  });

  it('8 人局攻击范围：无武器只能打相邻；对面需要范围 4 的武器', () => {
    const g = ring(8);
    const ps = g.players;
    expect(g.canAttack(ps[0], ps[1])).toBe(true);
    expect(g.canAttack(ps[0], ps[2])).toBe(false); // 距离 2 > 范围 1
    expect(g.canAttack(ps[0], ps[4])).toBe(false); // 对面距离 4
    g.equipCard(ps[0], makeCard('fangtian')); // 方天画戟范围 4
    expect(g.canAttack(ps[0], ps[2])).toBe(true);
    expect(g.canAttack(ps[0], ps[4])).toBe(true);
  });
});
