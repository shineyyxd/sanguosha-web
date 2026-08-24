/**
 * 距离 / 攻击范围。
 * 距离 = 存活玩家座次环上的座位距离 + 防守方 +1 马 - 进攻方 -1 马（最小为 1）。
 * 攻击范围 = 武器范围（无武器为 1）。
 */

import { CARD_DEFS } from './cards.js';
import type { Game } from './game.js';
import type { Player } from './player.js';

/** 两名玩家在存活玩家座次环上的座位距离（取顺/逆时针较短者）。 */
export function seatDistance(a: Player, b: Player, alive: Player[]): number {
  const seats = alive.map((p) => p.seat).sort((x, y) => x - y);
  const n = seats.length;
  if (n <= 1) return 0;
  const ia = seats.indexOf(a.seat);
  const ib = seats.indexOf(b.seat);
  const d = Math.abs(ia - ib);
  return Math.min(d, n - d);
}

/** 攻击范围：武器范围，无武器为 1。 */
export function attackRangeOf(player: Player): number {
  const weapon = player.equips.weapon;
  return weapon ? (CARD_DEFS[weapon.name].range ?? 1) : 1;
}

/** from 到 to 的距离：座位距离 + to 的 +1 马 - from 的 -1 马，再经 distance-calc 事件修正（马术等），最小为 1。 */
export function distanceOf(game: Game, from: Player, to: Player): number {
  if (from === to) return 0;
  const base = seatDistance(from, to, game.alivePlayers());
  const plus = to.equips.horsePlus ? 1 : 0;
  const minus = from.equips.horseMinus ? 1 : 0;
  const event = { from, to, value: Math.max(1, base + plus - minus) };
  game.emit('distance-calc', event);
  return Math.max(1, event.value);
}

/** from 是否能攻击到 to：存活、非己、距离不超过攻击范围。 */
export function canAttack(game: Game, from: Player, to: Player): boolean {
  if (from === to || !from.alive || !to.alive) return false;
  return distanceOf(game, from, to) <= attackRangeOf(from);
}
