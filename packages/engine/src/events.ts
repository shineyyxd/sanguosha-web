/**
 * 事件总线：一切动作都是事件，技能以监听器形式挂在事件上。
 * 监听器带优先级（数值大的先触发）。事件可以嵌套——
 * 例如 damage 事件的处理流程内部会再触发 dying / recover / death，
 * 嵌套由 game.ts 里的 generator 流程函数完成，总线本身只做同步分发。
 *
 * 同步监听器可拿到第三个参数 owner：技能挂载时所属的玩家
 * （白板测试里直接用 bus.on 的监听器没有 owner，为 undefined）。
 */

import type { Game } from './game.js';
import type { Player } from './player.js';
import type { Card } from './cards.js';
import type { PhaseId } from './phases.js';

export interface GameEventMap {
  'game-start': { game: Game };
  'game-over': { winner: Player | null };
  'turn-start': { player: Player; turn: number };
  'phase-change': { player: Player; phase: PhaseId };
  'card-use': { player: Player; card: Card; target?: Player };
  'card-response': { player: Player; card: Card; reason: string };
  'card-draw': { player: Player; cards: Card[] };
  'card-discard': { player: Player; cards: Card[] };
  /**
   * 伤害事件。监听器可以就地修改 amount（如加伤/减伤技能）。
   * card 为造成伤害的牌（杀/南蛮/万箭/决斗），闪电等无来源伤害没有 card。
   */
  damage: { source: Player | null; target: Player; amount: number; reason: string; card?: Card };
  recover: { player: Player; amount: number };
  dying: { player: Player };
  /** 死亡事件。killer 为伤害来源（凶手），闪电/失去体力等无来源为 null。 */
  death: { player: Player; killer: Player | null };
  /** 判定：翻开牌堆顶作为判定牌（判定后弃置）。reason 为触发判定的牌/技能 id。 */
  judge: { player: Player; card: Card; reason: string };
  /** 装备：card 进入装备区，replaced 为被替换弃置的旧装备。 */
  equip: { player: Player; card: Card; replaced: Card | null };
  /** 失去装备区里的一张牌（被拆/被顺/被替换/被借刀抽走武器等），枭姬的触发点。 */
  'equip-lose': { player: Player; card: Card };
  /** 牌进入弃牌堆（使用/打出/弃置/判定后的牌）。 */
  'card-into-discard': { card: Card };
  /** 玩家失去最后一张手牌（手牌由非空变空）——连营的触发点。 */
  'hand-empty': { player: Player };
  /** 距离计算：监听器可就地修改 value（如马术 -1）。引擎在分发后把结果钳到 >= 1。 */
  'distance-calc': { from: Player; to: Player; value: number };
}

export type EventType = keyof GameEventMap;

export type EventHandler<T extends EventType> = (
  event: GameEventMap[T],
  game: Game,
  owner?: Player,
) => void;

export interface EventListener<T extends EventType = EventType> {
  type: T;
  /** 优先级，数值大的先触发，默认 0。 */
  priority: number;
  handler: EventHandler<T>;
}

export class EventBus {
  private readonly listeners = new Map<EventType, EventListener[]>();

  on<T extends EventType>(type: T, handler: EventHandler<T>, priority = 0): void {
    const list = this.listeners.get(type) ?? [];
    list.push({ type, priority, handler } as EventListener);
    this.listeners.set(type, list);
  }

  /** 注销监听器（按 handler 引用匹配，选将换将时摘除旧技能用）。 */
  off<T extends EventType>(type: T, handler: EventHandler<T>): void {
    const list = this.listeners.get(type);
    if (!list) return;
    const i = list.findIndex((l) => l.handler === handler);
    if (i >= 0) list.splice(i, 1);
  }

  emit<T extends EventType>(type: T, event: GameEventMap[T], game: Game): void {
    const list = this.listeners.get(type);
    if (!list) return;
    // 拷贝后按优先级降序触发，避免监听器在触发中注册/注销导致错乱
    for (const listener of [...list].sort((a, b) => b.priority - a.priority)) {
      (listener.handler as EventHandler<T>)(event, game);
    }
  }
}
