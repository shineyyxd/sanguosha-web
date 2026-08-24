/**
 * Game —— 规则引擎主体。
 *
 * 可暂停状态机的实现方式：generator。
 * 所有需要玩家输入的流程（整局 run()、回合 runTurn()、出牌阶段 playPhase()、
 * 杀结算 useSha()/resolveSha()、锦囊 useTrick()、无懈链 wuxieChain()、
 * 伤害 dealDamage()、濒死 dying()）都是 generator 函数，
 * 类型为 GameFlow<T> = Generator<AskRequest, T, AskResponse>：
 *   - yield 一个 AskRequest 表示"暂停，等待某玩家输入"；
 *   - 驱动层把玩家的 AskResponse 传给 next()，流程就地继续。
 * 事件嵌套（伤害→濒死→求桃响应链、锦囊→无懈→反无懈链）就是 generator 之间的
 * yield* 委托，天然的调用栈嵌套，不需要额外的栈结构。
 *
 * 技能系统：
 * - 同步监听器直接挂在事件总线上（锁定技改数值，如马术）；
 * - 可挂起触发技在事件发出时（同步）把 flow 排进 pendingTriggers 队列，
 *   流程在挂起点（杀结算前、伤害结算后、摸牌阶段等）yield* drainTriggers()
 *   逐个执行——触发技因此可以再 yield 询问（是否发动/选目标/选牌）；
 * - 主动技与可主动使用的转化技通过 play 询问的 useSkill 响应发动；
 * - 响应窗口的转化技（红牌当杀等）通过 response 询问的 converts 选项 +
 *   useSkill 响应打出"虚拟牌"。
 */

import { EventBus, type EventType, type GameEventMap } from './events.js';
import {
  Player,
  BLANK_GENERAL,
  type ConvertSkill,
  type GeneralTemplate,
  type Skill,
  type SkillTrigger,
} from './player.js';
import {
  CARD_DEFS,
  CARD_LABEL,
  InfiniteDeck,
  cardText,
  isBlack,
  isRed,
  type Card,
  type CardName,
  type Deck,
} from './cards.js';
import { PHASE_ORDER, PHASE_LABEL } from './phases.js';
import { canAttack, distanceOf } from './distance.js';
import { IDENTITY_MIN_PLAYERS, ROLE_LABEL, roleConfigFor, type Role } from './roles.js';
import type { Kingdom } from './data/standard-generals.js';
import type { AskRequest, AskResponse, ConvertOption, ResponseReason } from './asks.js';

export type GameFlow<T = void> = Generator<AskRequest, T, AskResponse>;

/** 势力中文名（日志用）。 */
const KINGDOM_CN: Record<Kingdom, string> = { wei: '魏', shu: '蜀', wu: '吴', qun: '群' };

/**
 * 丈八蛇矛（武器特效以转化技形式提供）：两张手牌当【杀】。
 * 由 Game.convertSkillsOf 在持有者装备丈八蛇矛时注入，不走武将技能列表。
 */
export const ZHANGBA_CONVERT: ConvertSkill = {
  id: 'zhangba',
  name: '丈八蛇矛',
  as: 'sha',
  match: () => true,
  activeUse: true,
  count: 2,
};

export interface GameOptions {
  playerNames?: string[];
  generals?: GeneralTemplate[];
  /** 不传则用默认无限牌堆（杀/闪/桃循环）。 */
  deck?: Deck;
  /**
   * 身份局：按座次指定身份（长度须与人数一致，恰含 1 主公）。
   * 不传且人数 >= 4 时自动按标准配置分配（主公在 0 号座）；2~3 人不分配身份（1v1）。
   */
  roles?: Role[];
}

export interface GameResult {
  winner: Player | null;
  /** 身份局的获胜方（内奸独胜时 winner 同时为该玩家）；1v1 为 null。 */
  winSide: Role | null;
  turns: number;
}

/** 排队中的可挂起触发技。 */
interface PendingTrigger {
  trigger: SkillTrigger;
  owner: Player;
  event: unknown;
}

export class Game {
  readonly bus = new EventBus();
  readonly players: Player[] = [];
  readonly deck: Deck;
  /** 弃牌堆：使用/打出/弃置/判定后的牌都进这里；有限牌堆摸空时洗回。 */
  readonly discard: Card[] = [];
  /** 杀结算的瞬时标记（如铁骑的"不可被闪避"、流离的"转移目标"），按牌 id 记录，resolveSha 消费。 */
  readonly shaFlags = new Map<string, { unjinkable?: boolean; retarget?: Player }>();
  over = false;
  winner: Player | null = null;
  /** 身份局获胜方（见 GameResult.winSide）。 */
  winSide: Role | null = null;
  turn = 0;
  /** 过程日志；onLog 回调由驱动层接管输出。 */
  readonly logs: string[] = [];
  onLog?: (msg: string) => void;

  private readonly pendingTriggers: PendingTrigger[] = [];
  /** 每个玩家已注册到总线上的技能监听（setGeneral 换将时摘除旧技能）。 */
  private readonly skillRegistrations = new Map<Player, { type: EventType; handler: (event: any, game: Game) => void }[]>();

  constructor(options: GameOptions = {}) {
    const names = options.playerNames ?? ['玩家1', '玩家2'];
    this.deck = options.deck ?? new InfiniteDeck();
    this.deck.bindDiscard?.(this.discard);
    const roles =
      options.roles ??
      (names.length >= IDENTITY_MIN_PLAYERS ? roleConfigFor(names.length) : names.map(() => null));
    if (roles.length !== names.length) throw new Error(`身份数量（${roles.length}）与人数（${names.length}）不一致`);
    if (options.roles && roles.filter((r) => r === 'lord').length !== 1) {
      throw new Error('身份局必须恰有 1 名主公');
    }
    names.forEach((name, i) => {
      this.players.push(
        new Player(`p${i + 1}`, name, i, options.generals?.[i] ?? BLANK_GENERAL, roles[i]),
      );
    });
    for (const p of this.players) {
      for (const skill of p.skills) this.registerSkill(p, skill);
    }
  }

  // ---------- 基础设施 ----------

  log(msg: string): void {
    this.logs.push(msg);
    this.onLog?.(msg);
  }

  emit<T extends EventType>(type: T, event: GameEventMap[T]): void {
    this.bus.emit(type, event, this);
  }

  /**
   * 把技能的同步监听器（绑定所属玩家）与可挂起触发技注册到事件总线。
   * 触发技的注册 handler 只做同步条件判断，命中后把 flow 排进队列，
   * 真正的执行发生在流程挂起点（drainTriggers）。
   */
  private registerSkill(owner: Player, skill: Skill): void {
    for (const listener of skill.listeners ?? []) {
      const handler = (event: any, game: Game) => listener.handler(event, game, owner);
      this.bus.on(listener.type, handler, listener.priority);
      const regs = this.skillRegistrations.get(owner) ?? [];
      regs.push({ type: listener.type, handler });
      this.skillRegistrations.set(owner, regs);
    }
    for (const trigger of skill.triggers ?? []) {
      const handler = (event: any) => {
        if (!owner.alive) return;
        if (trigger.when && !trigger.when(event, this, owner)) return;
        this.pendingTriggers.push({ trigger, owner, event });
      };
      this.bus.on(trigger.on, handler);
      const regs = this.skillRegistrations.get(owner) ?? [];
      regs.push({ type: trigger.on, handler });
      this.skillRegistrations.set(owner, regs);
    }
  }

  /** 动态给玩家挂载技能。 */
  mountSkill(player: Player, skill: Skill): void {
    player.skills.push(skill);
    this.registerSkill(player, skill);
  }

  /**
   * 开局前更换武将（选将阶段）：摘除旧技能的监听器/触发器，换上新武将的技能。
   * 只能在流程启动前调用（已派发的触发队列不追溯清理）。
   */
  setGeneral(player: Player, general: GeneralTemplate): void {
    for (const reg of this.skillRegistrations.get(player) ?? []) {
      this.bus.off(reg.type, reg.handler);
    }
    this.skillRegistrations.delete(player);
    player.general = general;
    player.skills = [...general.skills];
    player.hp = player.maxHp; // 开局前换将：体力重置为新上限（含主公 +1）
    for (const skill of player.skills) this.registerSkill(player, skill);
  }

  /**
   * 触发队列排水点：依次执行所有排队触发技的 flow（可挂起）。
   * 返回实际发动（flow 返回 true）且带 replaces 标记的技能集合，
   * 供阶段替换（如突袭替换摸牌阶段）判断。
   */
  *drainTriggers(): GameFlow<Set<string>> {
    const fired = new Set<string>();
    while (this.pendingTriggers.length > 0) {
      if (this.over) {
        this.pendingTriggers.length = 0;
        break;
      }
      const t = this.pendingTriggers.shift()!;
      if (!t.owner.alive) continue;
      const did = yield* t.trigger.flow(this, t.owner, t.event);
      if (did && t.trigger.replaces) fired.add(t.trigger.replaces);
    }
    return fired;
  }

  getPlayer(id: string): Player {
    const p = this.players.find((pl) => pl.id === id);
    if (!p) throw new Error(`unknown player: ${id}`);
    return p;
  }

  alivePlayers(): Player[] {
    return this.players.filter((p) => p.alive);
  }

  /** 从 start 开始按座次顺序遍历存活玩家（濒死求桃/锦囊结算/无懈询问的顺序）。 */
  playersFrom(start: Player): Player[] {
    const sorted = [...this.players].sort((a, b) => a.seat - b.seat);
    const i = sorted.indexOf(start);
    return [...sorted.slice(i), ...sorted.slice(0, i)].filter((p) => p.alive);
  }

  canAttack(from: Player, to: Player): boolean {
    return canAttack(this, from, to);
  }

  /** from 到 to 的距离（含 +/-1 马与马术等修正）。 */
  distance(from: Player, to: Player): number {
    return distanceOf(this, from, to);
  }

  // ---------- 状态变更（同步部分） ----------

  drawCards(p: Player, n: number): void {
    const cards = Array.from({ length: n }, () => this.deck.draw());
    p.hand.push(...cards);
    this.emit('card-draw', { player: p, cards });
    this.log(`${p.name} 摸了 ${n} 张牌：${cards.map((c) => cardText(c)).join('')}`);
  }

  heal(p: Player, amount: number): void {
    const before = p.hp;
    p.hp = Math.min(p.maxHp, p.hp + amount);
    if (p.hp > before) this.emit('recover', { player: p, amount: p.hp - before });
  }

  removeFromHand(p: Player, card: Card): void {
    const i = p.hand.indexOf(card);
    if (i >= 0) p.hand.splice(i, 1);
    else return;
    // 连营触发点：手牌由非空变空（使用/打出/弃置/交给/装备等一切失去手牌的途径）
    if (p.hand.length === 0 && p.alive) this.emit('hand-empty', { player: p });
  }

  /** 牌进入弃牌堆。 */
  toDiscard(card: Card): void {
    this.discard.push(card);
    this.emit('card-into-discard', { card });
  }

  /** 从弃牌堆取回一张牌（奸雄等）。 */
  takeFromDiscard(card: Card): boolean {
    const i = this.discard.indexOf(card);
    if (i < 0) return false;
    this.discard.splice(i, 1);
    return true;
  }

  /**
   * 判定：翻牌堆顶为判定牌，判定后弃置（官方规则）。
   * reason 为触发判定的牌名/技能 id（lebu / shandian / bagua / tieji……）。
   *
   * 鬼才挂点：判定牌翻开后、生效前（emit 'judge' 前），按座次从判定者开始
   * 依次询问每名持有【鬼才】且有手牌的玩家是否打出一张手牌代替之（judge-retrial 询问）。
   * 被代替的原判定牌立即弃置；代替牌成为最终判定牌（天妒/洛神获得的是最终那张）。
   * 每名鬼才持有者对同一次判定至多改一次（后来的鬼才改的是新判定牌）。
   */
  *judgeCard(p: Player, reason: string): GameFlow<Card> {
    let card = this.deck.draw();
    const label = (CARD_LABEL as Record<string, string>)[reason] ?? `【${reason}】`;
    for (const q of this.playersFrom(p)) {
      if (this.over) break;
      if (!q.hasSkill('guicai') || q.hand.length === 0) continue;
      while (true) {
        const res = yield {
          kind: 'judge-retrial',
          playerId: q.id,
          card,
          reason,
          skillId: 'guicai',
        } as const;
        if (res.pass) break;
        if (!('cardId' in res)) continue;
        const sub = q.hand.find((c) => c.id === res.cardId);
        if (!sub) continue; // 非法选择，重新询问
        this.removeFromHand(q, sub);
        this.toDiscard(card); // 原判定牌弃置
        card = sub;
        this.emit('card-response', { player: q, card: sub, reason: 'guicai' });
        this.log(`${q.name} 发动【鬼才】，打出${cardText(sub)}代替${p.name}的${label}判定牌`);
        break;
      }
    }
    this.emit('judge', { player: p, card, reason });
    this.log(`${p.name} 的${label}判定：${cardText(card)}`);
    this.toDiscard(card);
    return card;
  }

  /** 装备：进入对应槽位，同槽旧装备弃置（旧装备发出 equip-lose，枭姬可触发）。 */
  equipCard(p: Player, card: Card): void {
    this.removeFromHand(p, card);
    const slot = CARD_DEFS[card.name].equipSlot;
    if (!slot) throw new Error(`${card.name} 不是装备牌`);
    const old = p.equips[slot];
    p.equips[slot] = card;
    if (old) {
      this.toDiscard(old);
      this.emit('equip-lose', { player: p, card: old });
    }
    this.emit('equip', { player: p, card, replaced: old ?? null });
    this.log(`${p.name} 装备${cardText(card)}${old ? `，替换并弃置${cardText(old)}` : ''}`);
  }

  /** 目标区域里的全部牌（手牌 + 装备区 + 判定区），过河拆桥/顺手牵羊用。 */
  regionCards(p: Player): Card[] {
    const equips = Object.values(p.equips).filter((c): c is Card => c !== null);
    return [...p.hand, ...equips, ...p.judgeArea];
  }

  /** 从目标区域里随机取一张牌（手牌随机，装备/判定区按序）。过河拆桥/顺手牵羊/反馈共用。 */
  pickRegionCard(target: Player): Card | null {
    if (target.hand.length > 0) {
      return target.hand[Math.floor(Math.random() * target.hand.length)];
    }
    const equips = Object.values(target.equips).filter((c): c is Card => c !== null);
    return equips[0] ?? target.judgeArea[0] ?? null;
  }

  /** 从目标区域里移除一张牌（手牌/装备/判定区）；失去装备发 equip-lose，手牌变空发 hand-empty。 */
  removeRegionCard(target: Player, card: Card): void {
    const i = target.hand.indexOf(card);
    if (i >= 0) {
      target.hand.splice(i, 1);
      // 连营触发点（被拆/被顺走最后一张手牌）
      if (target.hand.length === 0 && target.alive) this.emit('hand-empty', { player: target });
      return;
    }
    for (const slot of Object.keys(target.equips) as (keyof Player['equips'])[]) {
      if (target.equips[slot] === card) {
        target.equips[slot] = null;
        this.emit('equip-lose', { player: target, card }); // 枭姬触发点（被拆/被顺）
        return;
      }
    }
    const j = target.judgeArea.indexOf(card);
    if (j >= 0) target.judgeArea.splice(j, 1);
  }

  /** 该玩家使用【杀】是否无次数限制（诸葛连弩 / 咆哮；两者等价，天然去重）。 */
  hasUnlimitedSha(p: Player): boolean {
    return p.equips.weapon?.name === 'zhuge' || p.skills.some((s) => s.flags?.unlimitedSha === true);
  }

  /** 空城（锁定）：没有手牌时不能成为【杀】/【决斗】的目标。 */
  isKongcheng(p: Player): boolean {
    return p.hand.length === 0 && p.skills.some((s) => s.flags?.kongcheng === true);
  }

  /** 玩家当前可发动的技能 id 列表（主动技 + 可主动使用且手里有料的转化技）。 */
  availableSkills(p: Player): string[] {
    const ids: string[] = [];
    const unlimitedSha = this.hasUnlimitedSha(p);
    for (const s of p.skills) {
      if (s.active && (!s.active.usable || s.active.usable(this, p))) ids.push(s.id);
    }
    for (const c of this.convertSkillsOf(p)) {
      if (!c.activeUse) continue;
      if (p.hand.filter(c.match).length < (c.count ?? 1)) continue;
      if (c.condition && !c.condition(this, p)) continue;
      // 粗略合法性：转化出杀需要次数与潜在目标（空城目标不算）
      if (c.as === 'sha') {
        if (p.shaUsed >= 1 && !unlimitedSha) continue;
        if (!this.alivePlayers().some((q) => this.canAttack(p, q) && !this.isKongcheng(q))) continue;
      }
      ids.push(c.id);
    }
    return ids;
  }

  /** 玩家当前的转化技全集：武将技能 + 武器特效（丈八蛇矛）。 */
  private convertSkillsOf(p: Player): ConvertSkill[] {
    const convs: ConvertSkill[] = [];
    for (const s of p.skills) convs.push(...(s.converts ?? []));
    if (p.equips.weapon?.name === 'zhangba') convs.push(ZHANGBA_CONVERT);
    return convs;
  }

  /** 响应窗口里玩家可用的转化技选项（含可转化的手牌 id；多牌转化需凑够 count 张）。 */
  private convertOptions(p: Player, wants: CardName): ConvertOption[] {
    const options: ConvertOption[] = [];
    for (const c of this.convertSkillsOf(p)) {
      if (c.as !== wants) continue;
      if (c.condition && !c.condition(this, p)) continue; // 如急救仅回合外可用
      const cardIds = p.hand.filter(c.match).map((card) => card.id);
      if (cardIds.length >= (c.count ?? 1)) {
        options.push({ skillId: c.id, name: c.name, as: c.as, cardIds, count: c.count });
      }
    }
    return options;
  }

  private findConvert(p: Player, skillId: string, wants: CardName): ConvertSkill | undefined {
    return this.convertSkillsOf(p).find((c) => c.id === skillId && c.as === wants);
  }

  /**
   * 出牌阶段能否主动使用某张牌；返回 null 表示合法，否则为原因。
   * targetId2 仅【借刀杀人】使用（武器持有者之外的【杀】目标）。
   * extraTargetIds 为【方天画戟】的额外目标（最后一张手牌【杀】可额外指定至多两个目标）。
   */
  canPlay(p: Player, card: Card, targetId?: string, targetId2?: string, extraTargetIds: string[] = []): string | null {
    const def = CARD_DEFS[card.name];
    if (def.type === 'equip') return null;
    if (card.name === 'shan') return '【闪】不能主动使用';
    if (card.name === 'wuxie') return '【无懈可击】只能在锦囊生效前响应使用';
    if (card.name === 'tao') {
      return p.hp < p.maxHp ? null : '体力已满，不能使用【桃】';
    }
    if (card.name === 'sha') {
      if (p.shaUsed >= 1 && !this.hasUnlimitedSha(p)) {
        return '出牌阶段限使用一张【杀】';
      }
      const target = targetId ? this.getPlayer(targetId) : null;
      if (!target || !this.canAttack(p, target)) return '【杀】没有合法目标';
      if (this.isKongcheng(target)) return '空城：不能成为【杀】的目标';
      // 方天画戟：使用的【杀】是最后一张手牌时，可额外指定至多两个目标
      if (extraTargetIds.length > 0) {
        if (p.equips.weapon?.name !== 'fangtian' || p.hand.length !== 1 || p.hand[0] !== card) {
          return '只有装备【方天画戟】且【杀】为最后一张手牌时才能额外指定目标';
        }
        if (extraTargetIds.length > 2 || new Set(extraTargetIds).size !== extraTargetIds.length) {
          return '【方天画戟】至多额外指定两个不同的目标';
        }
        for (const id of extraTargetIds) {
          const t = this.getPlayer(id);
          if (t === target || !t.alive || !this.canAttack(p, t)) return '【方天画戟】的额外目标不合法';
          if (this.isKongcheng(t)) return '空城：不能成为【杀】的目标';
        }
      }
      return null;
    }

    // 锦囊
    const others = this.alivePlayers().filter((q) => q !== p);
    const target = targetId ? this.getPlayer(targetId) : null;
    const needOther = (label: string): string | null =>
      !target || target === p || !target.alive ? `${label}需要指定一名其他存活角色` : null;
    /** 谦逊：不能成为【顺手牵羊】/【乐不思蜀】的目标 */
    const immune = (t: Player, name: CardName): boolean =>
      t.skills.some((s) => s.flags?.immuneToTricks?.includes(name));

    switch (card.name) {
      case 'wuzhong':
      case 'wugu':
        return null;
      case 'nanman':
      case 'wanjian':
        return others.length > 0 ? null : '没有其他存活角色';
      case 'taoyuan':
        return this.alivePlayers().some((q) => q.hp < q.maxHp)
          ? null
          : '所有角色体力已满，【桃园结义】无效';
      case 'juedou': {
        const err = needOther('【决斗】');
        if (err) return err;
        return this.isKongcheng(target!) ? '空城：不能成为【决斗】的目标' : null;
      }
      case 'guohe': {
        const err = needOther('【过河拆桥】');
        if (err) return err;
        return this.regionCards(target!).length > 0 ? null : '目标区域里没有牌';
      }
      case 'shunshou': {
        const err = needOther('【顺手牵羊】');
        if (err) return err;
        if (immune(target!, 'shunshou')) return '谦逊：不能成为【顺手牵羊】的目标';
        // 奇才（锁定）：使用锦囊牌无距离限制
        const noDistance = p.skills.some((s) => s.flags?.trickNoDistance);
        if (!noDistance && this.distance(p, target!) > 1) return '目标距离大于 1';
        return this.regionCards(target!).length > 0 ? null : '目标区域里没有牌';
      }
      case 'jiedao': {
        const err = needOther('【借刀杀人】');
        if (err) return err;
        if (!target!.equips.weapon) return '目标装备区里没有武器';
        const victim = targetId2 ? this.getPlayer(targetId2) : null;
        if (!victim || victim === target || !this.canAttack(target!, victim)) {
          return '需要指定目标攻击范围内的一名角色作为【杀】的目标';
        }
        if (this.isKongcheng(victim)) return '空城：不能成为【杀】的目标';
        return null;
      }
      case 'lebu': {
        const err = needOther('【乐不思蜀】');
        if (err) return err;
        if (immune(target!, 'lebu')) return '谦逊：不能成为【乐不思蜀】的目标';
        return target!.judgeArea.some((c) => c.name === 'lebu')
          ? '目标判定区里已有【乐不思蜀】'
          : null;
      }
      case 'shandian':
        return p.judgeArea.some((c) => c.name === 'shandian')
          ? '你的判定区里已有【闪电】'
          : null;
      default:
        return '不能主动使用';
    }
  }

  // ---------- 流程（generator，可暂停） ----------

  /** 整局游戏：发起始手牌 → 轮流行动直到分出胜负。身份局由主公先行动。 */
  *run(): GameFlow<GameResult> {
    this.emit('game-start', { game: this });
    this.log(
      `游戏开始：${this.players.map((p) => `${p.name}(${p.general.name}，${p.hp}体力)`).join(' vs ')}`,
    );
    for (const p of this.players) this.drawCards(p, 4);

    // 行动顺序：座次环；身份局从主公开始
    const order = [...this.players].sort((a, b) => a.seat - b.seat);
    const lord = this.players.find((p) => p.role === 'lord');
    if (lord) order.push(...order.splice(0, order.indexOf(lord)));

    while (!this.over) {
      for (const p of order) {
        if (this.over) break;
        if (!p.alive) continue;
        this.turn++;
        yield* this.runTurn(p);
      }
    }

    this.emit('game-over', { winner: this.winner });
    if (this.winSide) {
      const who = this.winner ? `（${this.winner.name}）` : '';
      this.log(`游戏结束，${ROLE_LABEL[this.winSide]}方${who}获胜！`);
    } else {
      this.log(this.winner ? `游戏结束，${this.winner.name} 获胜！` : '游戏结束，无人生还。');
    }
    return { winner: this.winner, winSide: this.winSide, turns: this.turn };
  }

  /** 单个回合：判定 → 摸牌 → 出牌 → 弃牌 → 结束，每阶段发事件钩子。 */
  *runTurn(p: Player): GameFlow {
    this.emit('turn-start', { player: p, turn: this.turn });
    this.log(`—— ${p.name} 的回合（体力 ${p.hp}/${p.maxHp}）——`);
    p.skipPlay = false;
    p.turnFlags.clear();
    p.turnCounts.clear();
    // 回合开始（准备阶段）触发技：洛神等
    yield* this.drainTriggers();

    for (const phase of PHASE_ORDER) {
      if (this.over || !p.alive) return;
      p.currentPhase = phase;
      this.emit('phase-change', { player: p, phase });
      this.log(`  · ${PHASE_LABEL[phase]}`);

      switch (phase) {
        case 'judge':
          yield* this.judgePhase(p);
          break;
        case 'draw': {
          // 触发技（如突袭）可替换摸牌阶段；排水点同时清理其它挂起的触发技
          const fired = yield* this.drainTriggers();
          if (!fired.has('draw-phase')) this.drawCards(p, 2);
          break;
        }
        case 'play':
          if (p.skipPlay) {
            this.log(`${p.name} 跳过出牌阶段（${CARD_LABEL.lebu}）`);
          } else {
            yield* this.playPhase(p);
          }
          break;
        case 'discard': {
          // 触发技（如克己）可跳过弃牌阶段
          const fired = yield* this.drainTriggers();
          if (!fired.has('discard-phase')) yield* this.discardPhase(p);
          break;
        }
        case 'finish':
          p.shaUsed = 0;
          yield* this.drainTriggers(); // 兜底清理本回合遗留的触发技
          break;
      }
    }
    p.currentPhase = null;
  }

  /** 判定阶段：后进入判定区的延时锦囊先判定。 */
  *judgePhase(p: Player): GameFlow {
    for (const card of [...p.judgeArea].reverse()) {
      if (this.over || !p.alive) return;
      const idx = p.judgeArea.indexOf(card);
      if (idx < 0) continue; // 已被移走（如闪电转移）
      p.judgeArea.splice(idx, 1);

      // 延时锦囊在判定前可被【无懈可击】抵消：抵消则直接弃置、跳过判定
      if (yield* this.wuxieChain(p, card, p)) {
        this.toDiscard(card);
        this.log(`${CARD_LABEL.wuxie}抵消了 ${p.name} 的${CARD_LABEL[card.name]}，跳过判定`);
        continue;
      }

      const judge = yield* this.judgeCard(p, card.name);
      if (card.name === 'lebu') {
        this.toDiscard(card);
        if (judge.suit !== 'heart') {
          p.skipPlay = true;
          this.log(`${p.name} 的${CARD_LABEL.lebu}生效：跳过出牌阶段`);
        } else {
          this.log(`${p.name} 的${CARD_LABEL.lebu}未生效（判定为红桃）`);
        }
      } else if (card.name === 'shandian') {
        const hit =
          judge.suit === 'spade' && judge.rank !== undefined && judge.rank >= 2 && judge.rank <= 9;
        if (hit) {
          this.toDiscard(card);
          this.log(`${p.name} 的${CARD_LABEL.shandian}生效：受到 3 点雷电伤害`);
          yield* this.dealDamage(null, p, 3, 'shandian');
        } else {
          // 移给下家（跳过判定区已有闪电的角色）；没有可移动的下家则弃置
          const next = this.playersFrom(p)
            .slice(1)
            .find((q) => !q.judgeArea.some((c) => c.name === 'shandian'));
          if (next) {
            next.judgeArea.push(card);
            this.log(`${CARD_LABEL.shandian}移动到 ${next.name} 的判定区`);
          } else {
            this.toDiscard(card);
            this.log(`${CARD_LABEL.shandian}没有可移动的下家，弃置`);
          }
        }
      }
      yield* this.drainTriggers(); // 判定相关触发技（预留）
    }
  }

  /** 出牌阶段：反复询问，直到玩家放弃或无法行动。 */
  *playPhase(p: Player): GameFlow {
    while (!this.over && p.alive) {
      const ask: AskRequest = {
        kind: 'play',
        playerId: p.id,
        availableSkills: this.availableSkills(p),
      };
      const res = yield ask;
      if (res.pass) {
        this.log(`${p.name} 结束出牌`);
        return;
      }
      if ('useSkill' in res && res.useSkill) {
        const ok = yield* this.playSkill(p, res);
        if (!ok) this.log(`${p.name} 无法发动该技能`);
        continue;
      }
      if (!('cardId' in res) || !res.cardId) continue; // 非法输入，重新询问
      const card = p.hand.find((c) => c.id === res.cardId);
      if (!card) continue;
      // 方天画戟的额外目标（targetIds 里除主目标外的部分）
      const extraTargetIds =
        'targetIds' in res && Array.isArray(res.targetIds)
          ? res.targetIds.filter((id) => id !== res.targetId)
          : [];
      const err = this.canPlay(p, card, res.targetId, res.targetId2, extraTargetIds);
      if (err) {
        this.log(`${p.name} 不能使用${CARD_LABEL[card.name]}：${err}`);
        continue;
      }
      const def = CARD_DEFS[card.name];
      if (def.type === 'equip') {
        this.equipCard(p, card);
        yield* this.drainTriggers(); // 替换旧装备可能触发枭姬等
      } else if (card.name === 'tao') {
        this.removeFromHand(p, card);
        this.emit('card-use', { player: p, card, target: p });
        this.log(`${p.name} 使用${CARD_LABEL.tao}，回复 1 点体力（${p.hp + 1}/${p.maxHp}）`);
        this.heal(p, 1);
        this.toDiscard(card);
      } else if (card.name === 'sha') {
        yield* this.useSha(p, this.getPlayer(res.targetId!), card, undefined, extraTargetIds);
      } else {
        yield* this.useTrick(p, card, res.targetId, res.targetId2);
      }
    }
  }

  /**
   * 出牌阶段发动技能（useSkill 响应）：
   * - 主动技：直接执行其 flow；
   * - 转化技：校验手牌可转化 + 虚拟牌 canPlay 合法后，按虚拟牌名结算
   *   （红牌当杀 → useSha，黑牌当拆 → useTrick 的 guohe 分支）。
   */
  private *playSkill(
    p: Player,
    res: { useSkill: string; cardId?: string; cardIds?: string[]; targetId?: string; targetId2?: string },
  ): GameFlow<boolean> {
    const skill = p.skills.find(
      (s) => s.id === res.useSkill || s.converts?.some((c) => c.id === res.useSkill),
    );

    if (skill?.active && skill.id === res.useSkill) {
      if (skill.active.usable && !skill.active.usable(this, p)) return false;
      this.log(`${p.name} 发动【${skill.name}】`);
      yield* skill.active.flow(this, p, res);
      return true;
    }

    // 转化技：武将技能，或武器特效（丈八蛇矛）
    const conv =
      skill?.converts?.find((c) => c.id === res.useSkill && c.activeUse) ??
      (p.equips.weapon?.name === 'zhangba' && res.useSkill === ZHANGBA_CONVERT.id
        ? ZHANGBA_CONVERT
        : undefined);
    if (!conv) return false;
    if (conv.condition && !conv.condition(this, p)) return false;
    // 多牌转化（丈八蛇矛需恰好两张）：cardIds 优先，兼容单牌 cardId
    const need = conv.count ?? 1;
    const ids =
      'cardIds' in res && Array.isArray(res.cardIds) && res.cardIds.length > 0
        ? res.cardIds
        : res.cardId
          ? [res.cardId]
          : [];
    const cards = ids.map((id) => p.hand.find((c) => c.id === id));
    if (
      ids.length !== need ||
      new Set(ids).size !== need ||
      cards.some((c) => !c || !conv.match(c))
    ) {
      return false;
    }
    const primary = cards[0] as Card;
    // 用虚拟牌名校验合法性（如红牌当杀仍受杀次数/距离限制）
    const virtual: Card = { ...primary, name: conv.as };
    const err = this.canPlay(p, virtual, res.targetId, res.targetId2);
    if (err) {
      this.log(`${p.name} 不能将牌当作${CARD_LABEL[conv.as]}使用：${err}`);
      return false;
    }
    this.log(
      `${p.name} 发动【${conv.name}】，将${(cards as Card[]).map((c) => cardText(c)).join('')}当做${CARD_LABEL[conv.as]}`,
    );
    // 多牌转化：主牌之外的牌先行弃置，主牌由 useSha/useTrick 正常结算
    for (const extra of (cards as Card[]).slice(1)) {
      this.removeFromHand(p, extra);
      this.toDiscard(extra);
    }
    if (conv.as === 'sha') {
      yield* this.useSha(p, this.getPlayer(res.targetId!), primary, 'sha');
    } else {
      yield* this.useTrick(p, primary, res.targetId, res.targetId2, conv.as);
    }
    return true;
  }

  /**
   * 弃牌阶段：手牌数超过当前体力值时，由玩家选择恰好弃置的牌（官方规则，不可放弃），
   * 弃至手牌数 = 当前体力值。非法响应（数量不对/重复/不在手牌中/试图放弃）重新询问。
   */
  *discardPhase(p: Player): GameFlow {
    const excess = p.hand.length - p.hp;
    if (excess <= 0) return;
    while (true) {
      const ask: AskRequest = { kind: 'discard', playerId: p.id, count: excess };
      const res = yield ask;
      if (res.pass || !('cardIds' in res) || !Array.isArray(res.cardIds)) continue;
      const ids = res.cardIds;
      if (ids.length !== excess || new Set(ids).size !== ids.length) continue;
      const cards = ids.map((id) => p.hand.find((c) => c.id === id));
      if (cards.some((c) => !c)) continue;
      for (const card of cards as Card[]) {
        this.removeFromHand(p, card);
        this.toDiscard(card);
      }
      const discarded = cards as Card[];
      this.emit('card-discard', { player: p, cards: discarded });
      this.log(`${p.name} 弃置 ${discarded.length} 张牌：${discarded.map((c) => cardText(c)).join('')}`);
      return;
    }
  }

  /**
   * 【杀】的结算：指定目标 → 求【闪】→ 不出则造成 1 点伤害。as 为转化技的虚拟牌名。
   * extraTargetIds：方天画戟的额外目标（仅当杀为最后一张手牌时生效），
   * 多目标时对每个目标依次结算同一张杀（牌在全部目标结算完才进弃牌堆）。
   */
  *useSha(user: Player, target: Player, card: Card, as?: CardName, extraTargetIds: string[] = []): GameFlow {
    this.removeFromHand(user, card);
    user.shaUsed++;
    // 方天画戟：使用的【杀】是最后一张手牌时，可额外指定至多两个目标（再校验一遍，防非法响应）
    const targets = [target];
    if (user.equips.weapon?.name === 'fangtian' && user.hand.length === 0) {
      const seen = new Set([target.id]);
      for (const id of extraTargetIds) {
        if (targets.length >= 3) break;
        if (seen.has(id)) continue;
        seen.add(id);
        const t = this.getPlayer(id);
        if (t.alive && this.canAttack(user, t) && !this.isKongcheng(t)) targets.push(t);
      }
    }
    const shown: Card = as ? { ...card, name: as } : card;
    this.emit('card-use', { player: user, card: shown, target });
    if (as) this.log(`${user.name} 对 ${target.name} 使用${CARD_LABEL.sha}（转化自${cardText(card)}）`);
    else this.log(`${user.name} 对 ${target.name} 使用${CARD_LABEL.sha}`);
    if (targets.length > 1) {
      this.log(`${CARD_LABEL.fangtian}：额外指定 ${targets.slice(1).map((t) => t.name).join('、')} 为目标`);
    }
    // 多目标：deferDiscard——杀在全部目标结算完才进弃牌堆（本方法末尾）
    const deferred = targets.length > 1;
    for (const t of targets) {
      if (this.over || !t.alive) continue;
      yield* this.resolveSha(user, t, card, deferred);
    }
    if (deferred) this.discardShaCard(card);
  }

  /** 杀结算完毕入弃牌堆；已在堆中（借刀/追杀的杀在打出时已入堆）则跳过，防止重复入堆。 */
  private discardShaCard(card: Card): void {
    if (!this.discard.includes(card)) this.toDiscard(card);
  }

  /**
   * 【杀】的效果结算（借刀杀人等场景复用，不计次数、不从手牌移除）：
   * 先排干"指定目标后"的触发技（铁骑/流离——流离可在结算中途经 shaFlags.retarget 换目标）→
   * 雌雄双股剑（异性目标选择弃牌/令使用者摸牌）→ 仁王盾挡黑杀 →
   * 求闪（无双需两张闪，连续求闪窗口；可被铁骑跳过；护驾在主公放弃后询问魏势力代打）→
   * 八卦阵（玩家可选是否发动判定）→ 命中伤害（寒冰剑可在伤害结算前防止之改为弃两张牌；
   * 麒麟弓伤害后弃马；青龙刀被闪后追杀）。
   * 杀在伤害结算前进弃牌堆（奸雄可获得之）；deferDiscard（方天多目标）时推迟到
   * useSha 全部目标结算完再入堆。
   */
  *resolveSha(user: Player, target: Player, card: Card, deferDiscard = false): GameFlow {
    yield* this.drainTriggers();
    const flags = this.shaFlags.get(card.id);
    this.shaFlags.delete(card.id);

    // 流离：目标在结算中途被转移（新目标已死则落回原目标）
    if (flags?.retarget && flags.retarget.alive) {
      this.log(`${CARD_LABEL.sha}的目标转移为 ${flags.retarget.name}（流离）`);
      target = flags.retarget;
    }

    // 雌雄双股剑：指定异性目标后，对方选择弃一张手牌或令你摸一张牌
    if (user.equips.weapon?.name === 'cixiong' && target.gender !== user.gender) {
      yield* this.cixiongEffect(user, target);
    }

    // 青釭剑：目标防具技能无效
    const armor = user.equips.weapon?.name === 'qinggang' ? null : target.equips.armor;

    if (armor?.name === 'renwang' && isBlack(card)) {
      this.log(`${target.name} 的${CARD_LABEL.renwang}：黑色${CARD_LABEL.sha}无效`);
      if (!deferDiscard) this.discardShaCard(card);
      return;
    }

    // 无双：吕布使用的【杀】需两张【闪】才能抵消；只出一张仍受伤
    const need = user.skills.some((s) => s.flags?.wushuang) ? 2 : 1;
    let dodged = false;
    if (flags?.unjinkable) {
      this.log(`${target.name} 不能闪避此${CARD_LABEL.sha}（铁骑）`);
    } else {
      let offset = 0;
      while (offset < need) {
        const shan = yield* this.askCard(target, 'shan', 'sha', { sourceId: user.id, need: need - offset });
        if (shan) {
          offset++;
          this.log(`${target.name} 打出${CARD_LABEL.shan}（${offset}/${need}）`);
          continue;
        }
        if (armor?.name === 'bagua') {
          // 八卦阵：需要闪时可选择发动（官方规则为可选）；判定红色视为打出一张闪
          const bg = yield { kind: 'confirm', playerId: target.id, skillId: 'bagua' } as const;
          if (!bg.pass) {
            const judge = yield* this.judgeCard(target, 'bagua');
            if (isRed(judge)) {
              this.log(`${target.name} 的${CARD_LABEL.bagua}判定为红色，视为打出${CARD_LABEL.shan}（${offset + 1}/${need}）`);
              offset++;
              continue;
            }
          } else {
            this.log(`${target.name} 不发动${CARD_LABEL.bagua}`);
          }
        }
        break; // 打不出闪且八卦未中/未发动：剩余需求落空
      }
      dodged = offset >= need;
      if (dodged) this.log(`${target.name} 抵消了【杀】`);
    }

    if (!deferDiscard) this.discardShaCard(card);

    if (dodged) {
      // 青龙偃月刀：杀被闪抵消后，可立即对相同目标再使用一张【杀】（不计次数，可连续追杀）
      if (user.equips.weapon?.name === 'qinglong' && target.alive && !this.over) {
        const chase = yield* this.askCard(user, 'sha', 'qinglong', { targetId: target.id });
        if (chase) {
          this.log(`${user.name} 发动【青龙偃月刀】，对 ${target.name} 追出一张${CARD_LABEL.sha}`);
          yield* this.resolveSha(user, target, chase);
        }
      }
      return;
    }

    // 寒冰剑：杀造成伤害前可防止此伤害，改为依次弃置对方两张牌（没牌则无法发动）
    if (user.equips.weapon?.name === 'hanbing' && this.regionCards(target).length > 0) {
      const res = yield { kind: 'confirm', playerId: user.id, skillId: 'hanbing' } as const;
      if (!res.pass) {
        this.log(`${user.name} 发动【寒冰剑】，防止对 ${target.name} 的伤害，改为弃置其两张牌`);
        for (let i = 0; i < 2; i++) {
          const c = this.pickRegionCard(target);
          if (!c) break;
          this.removeRegionCard(target, c);
          this.toDiscard(c);
          this.log(`${user.name} 弃置了 ${target.name} 的${cardText(c)}（寒冰剑）`);
        }
        yield* this.drainTriggers(); // 失去装备的触发技（枭姬）
        return;
      }
    }

    yield* this.dealDamage(user, target, 1, 'sha', card);

    // 麒麟弓：杀造成伤害后，可弃置目标的一匹马（目标已阵亡时马已随弃牌入堆）
    if (!this.over && target.alive && user.equips.weapon?.name === 'qilin') {
      const slots = (['horsePlus', 'horseMinus'] as const).filter((s) => target.equips[s]);
      if (slots.length > 0) {
        const res = yield { kind: 'confirm', playerId: user.id, skillId: 'qilin' } as const;
        if (!res.pass) {
          let slot: 'horsePlus' | 'horseMinus' = slots[0];
          if (slots.length === 2) {
            // 两匹马都在：由使用者选择弃哪一匹
            while (true) {
              const pick = yield {
                kind: 'choose-option',
                playerId: user.id,
                skillId: 'qilin',
                options: slots.map((s) => ({ id: s, label: cardText(target.equips[s]!) })),
              } as const;
              const choice = !pick.pass && 'choice' in pick ? pick.choice : undefined;
              if (choice === 'horsePlus' || choice === 'horseMinus') {
                slot = choice;
                break;
              }
            }
          }
          const horse = target.equips[slot]!;
          target.equips[slot] = null;
          this.emit('equip-lose', { player: target, card: horse }); // 枭姬触发点
          this.toDiscard(horse);
          this.log(`${user.name} 发动【麒麟弓】，弃置 ${target.name} 的${cardText(horse)}`);
          yield* this.drainTriggers();
        }
      }
    }
  }

  /** 雌雄双股剑：对方选择弃一张手牌，或令你摸一张牌（对方没手牌则只能让你摸）。 */
  private *cixiongEffect(user: Player, target: Player): GameFlow {
    if (target.hand.length === 0) {
      this.log(`${user.name} 的${CARD_LABEL.cixiong}：${target.name} 没有手牌，${user.name} 摸一张牌`);
      this.drawCards(user, 1);
      return;
    }
    while (true) {
      const res = yield {
        kind: 'choose-option',
        playerId: target.id,
        skillId: 'cixiong',
        options: [
          { id: 'discard', label: '弃置一张手牌' },
          { id: 'draw', label: `令 ${user.name} 摸一张牌` },
        ],
      } as const;
      const choice = !res.pass && 'choice' in res ? res.choice : undefined;
      if (choice === 'draw') {
        this.log(`${target.name} 选择令 ${user.name} 摸一张牌（${CARD_LABEL.cixiong}）`);
        this.drawCards(user, 1);
        return;
      }
      if (choice !== 'discard') continue; // 非法选择，重问
      // 弃一张手牌（不可放弃）
      while (true) {
        const dres = yield { kind: 'discard', playerId: target.id, count: 1, skillId: 'cixiong' } as const;
        if (dres.pass || !('cardIds' in dres) || !Array.isArray(dres.cardIds)) continue;
        const ids = dres.cardIds;
        if (ids.length !== 1) continue;
        const card = target.hand.find((c) => c.id === ids[0]);
        if (!card) continue;
        this.removeFromHand(target, card);
        this.toDiscard(card);
        this.emit('card-discard', { player: target, cards: [card] });
        this.log(`${target.name} 弃置一张手牌（${CARD_LABEL.cixiong}）`);
        return;
      }
    }
  }

  /** 锦囊牌结算总入口。所有锦囊生效前都要过无懈链（按目标逐一）。as 为转化技的虚拟牌名。 */
  *useTrick(user: Player, card: Card, targetId?: string, targetId2?: string, as?: CardName): GameFlow {
    const name = as ?? card.name;
    this.removeFromHand(user, card);
    const target = targetId ? this.getPlayer(targetId) : undefined;
    const shown: Card = as ? { ...card, name } : card;
    this.emit('card-use', { player: user, card: shown, target });
    this.log(
      `${user.name} 使用${cardText(card)}${as ? `（当作${CARD_LABEL[name]}）` : ''}${target ? `，目标 ${target.name}` : ''}`,
    );
    // "使用锦囊牌时"触发技的排水点（集智等）
    yield* this.drainTriggers();

    switch (name) {
      case 'wuzhong': {
        if (!(yield* this.wuxieChain(user, shown, user))) this.drawCards(user, 2);
        this.toDiscard(card);
        return;
      }
      case 'nanman':
      case 'wanjian': {
        this.toDiscard(card);
        const wants: CardName = name === 'nanman' ? 'sha' : 'shan';
        for (const t of this.playersFrom(user)) {
          if (this.over) return;
          if (t === user) continue;
          if (yield* this.wuxieChain(user, shown, t)) {
            this.log(`${CARD_LABEL.wuxie}抵消了${CARD_LABEL[name]}对 ${t.name} 的效果`);
            continue;
          }
          const c = yield* this.askCard(t, wants, name, { sourceId: user.id });
          if (c) {
            this.log(`${t.name} 打出${CARD_LABEL[wants]}，抵消了${CARD_LABEL[name]}`);
          } else {
            yield* this.dealDamage(user, t, 1, name, card);
          }
        }
        return;
      }
      case 'juedou': {
        this.toDiscard(card);
        const t = target!;
        if (yield* this.wuxieChain(user, shown, t)) {
          this.log(`${CARD_LABEL.wuxie}抵消了${CARD_LABEL.juedou}`);
          return;
        }
        yield* this.juedouDuel(user, t, card);
        return;
      }
      case 'guohe':
      case 'shunshou': {
        this.toDiscard(card);
        const t = target!;
        if (yield* this.wuxieChain(user, shown, t)) {
          this.log(`${CARD_LABEL.wuxie}抵消了${CARD_LABEL[name]}`);
          return;
        }
        const taken = this.pickRegionCard(t);
        if (!taken) return;
        this.removeRegionCard(t, taken);
        if (name === 'guohe') {
          this.toDiscard(taken);
          this.log(`${user.name} 弃置了 ${t.name} 的${cardText(taken)}`);
        } else {
          user.hand.push(taken);
          this.log(`${user.name} 获得了 ${t.name} 的${cardText(taken)}`);
        }
        yield* this.drainTriggers(); // 失去装备区牌的触发技（枭姬）
        return;
      }
      case 'taoyuan': {
        this.toDiscard(card);
        for (const t of this.playersFrom(user)) {
          if (this.over) return;
          if (t.hp >= t.maxHp) continue; // 满血无效
          if (yield* this.wuxieChain(user, shown, t)) {
            this.log(`${CARD_LABEL.wuxie}抵消了${CARD_LABEL.taoyuan}对 ${t.name} 的效果`);
            continue;
          }
          this.heal(t, 1);
          this.log(`${t.name} 回复 1 点体力（${t.hp}/${t.maxHp}）`);
        }
        return;
      }
      case 'wugu': {
        this.toDiscard(card);
        const targets = this.playersFrom(user);
        const revealed = targets.map(() => this.deck.draw());
        this.log(
          `${CARD_LABEL.wugu}亮出 ${revealed.length} 张牌：${revealed.map((c) => cardText(c)).join('、')}`,
        );
        for (const t of targets) {
          if (this.over || revealed.length === 0) break;
          if (yield* this.wuxieChain(user, shown, t)) {
            this.log(`${CARD_LABEL.wuxie}抵消了${CARD_LABEL.wugu}对 ${t.name} 的效果`);
            continue;
          }
          // 从亮出的牌中选 1 张；非法选择重新询问
          while (true) {
            const ask: AskRequest = {
              kind: 'choose-card',
              playerId: t.id,
              cards: [...revealed],
              reason: 'wugu',
            };
            const res = yield ask;
            const pick = res.pass || !('cardId' in res) ? undefined : revealed.find((c) => c.id === res.cardId);
            if (pick) {
              revealed.splice(revealed.indexOf(pick), 1);
              t.hand.push(pick);
              this.emit('card-draw', { player: t, cards: [pick] });
              this.log(`${t.name} 选择了${cardText(pick)}`);
              break;
            }
          }
        }
        for (const c of revealed) this.toDiscard(c); // 剩余的牌弃置
        return;
      }
      case 'jiedao': {
        this.toDiscard(card);
        const holder = target!;
        const victim = this.getPlayer(targetId2!);
        if (yield* this.wuxieChain(user, shown, holder)) {
          this.log(`${CARD_LABEL.wuxie}抵消了${CARD_LABEL.jiedao}`);
          return;
        }
        // 求杀统一走 askCard：支持转化技（武圣等）与主公技【激将】代打；
        // 打出的杀已入弃牌堆，resolveSha 经 discardShaCard 去重
        const playedSha = yield* this.askCard(holder, 'sha', 'jiedao', {
          sourceId: user.id,
          targetId: victim.id,
        });
        if (playedSha) {
          this.emit('card-use', { player: holder, card: playedSha, target: victim });
          this.log(`${holder.name} 对 ${victim.name} 使用${CARD_LABEL.sha}（${CARD_LABEL.jiedao}）`);
          yield* this.resolveSha(holder, victim, playedSha);
        }
        if (!playedSha && !this.over) {
          const weapon = holder.equips.weapon;
          if (weapon) {
            holder.equips.weapon = null;
            this.emit('equip-lose', { player: holder, card: weapon }); // 枭姬触发点
            user.hand.push(weapon);
            this.log(
              `${holder.name} 未打出${CARD_LABEL.sha}，${user.name} 获得其${cardText(weapon)}`,
            );
            yield* this.drainTriggers();
          }
        }
        return;
      }
      case 'lebu': {
        const t = target!;
        if (yield* this.wuxieChain(user, shown, t)) {
          this.log(`${CARD_LABEL.wuxie}抵消了${CARD_LABEL.lebu}`);
          this.toDiscard(card);
          return;
        }
        // 进判定区的是虚拟牌（国色方块当乐不思蜀时牌名为 lebu，判定阶段按牌名判定）
        t.judgeArea.push(shown);
        this.log(`${CARD_LABEL.lebu}进入 ${t.name} 的判定区`);
        return;
      }
      case 'shandian': {
        if (yield* this.wuxieChain(user, shown, user)) {
          this.log(`${CARD_LABEL.wuxie}抵消了${CARD_LABEL.shandian}`);
          this.toDiscard(card);
          return;
        }
        user.judgeArea.push(shown);
        this.log(`${CARD_LABEL.shandian}进入 ${user.name} 的判定区`);
        return;
      }
    }
  }

  /**
   * 【决斗】的轮流出杀结算（useTrick 的决斗分支与离间的虚拟决斗复用）：
   * 由 target 先出杀，双方轮流，先不出的受到来自另一方的 1 点伤害。
   * 无双：吕布参与决斗时，对方每次响应需连续打出两张【杀】。
   * card 为造成伤害的实体牌（奸雄可获得）；离间的虚拟决斗没有实体牌，不传。
   */
  *juedouDuel(user: Player, target: Player, card?: Card): GameFlow {
    let current = target;
    let other = user;
    while (!this.over) {
      // 对方是无双（吕布）时，当前响应者需打出两张杀
      const need = other.skills.some((s) => s.flags?.wushuang) ? 2 : 1;
      let played = 0;
      while (played < need) {
        const sha = yield* this.askCard(current, 'sha', 'juedou', { sourceId: other.id, need: need - played });
        if (!sha) break;
        played++;
        this.log(`${current.name} 打出${CARD_LABEL.sha}（决斗，${played}/${need}）`);
      }
      if (played < need) {
        yield* this.dealDamage(other, current, 1, 'juedou', card);
        return;
      }
      [current, other] = [other, current];
    }
  }

  /**
   * 无懈可击响应链：锦囊对 target 生效前，从 source 开始按座次依次询问
   * 持有【无懈可击】的玩家。每有人打出无懈，抵消状态翻转，并从其下家
   * 重新开始一轮询问（可无懈反无懈）。返回最终是否被抵消。
   */
  *wuxieChain(source: Player, trick: Card, target: Player | null): GameFlow<boolean> {
    let negated = false;
    let order = this.playersFrom(source);
    while (true) {
      let responder: Player | null = null;
      for (const p of order) {
        if (this.over) return negated;
        if (!p.findCard('wuxie')) continue;
        const card = yield* this.askCard(p, 'wuxie', 'wuxie', {
          sourceId: source.id,
          targetId: target?.id,
        });
        if (card) {
          responder = p;
          break;
        }
      }
      if (!responder) return negated;
      negated = !negated;
      this.log(
        negated
          ? `${responder.name} 打出${CARD_LABEL.wuxie}，抵消${CARD_LABEL[trick.name]}${target ? `对 ${target.name}` : ''}的效果`
          : `${responder.name} 打出${CARD_LABEL.wuxie}反无懈，${CARD_LABEL[trick.name]}继续生效`,
      );
      order = this.playersFrom(responder).slice(1);
    }
  }

  /**
   * 伤害结算：发 damage 事件（监听器可改伤害值；card 为造成伤害的牌）→
   * 扣血 → 濒死则进入求桃链（source 作为潜在凶手一路传到死亡结算）→
   * 排干"受到伤害后"触发技（奸雄等）。
   */
  *dealDamage(
    source: Player | null,
    target: Player,
    amount: number,
    reason: string,
    card?: Card,
  ): GameFlow {
    const event = { source, target, amount, reason, card };
    this.emit('damage', event);
    if (event.amount <= 0) return;
    target.hp -= event.amount;
    this.log(`${target.name} 受到 ${event.amount} 点伤害，体力 ${target.hp}/${target.maxHp}`);
    if (target.hp <= 0) yield* this.dying(target, source);
    yield* this.drainTriggers();
  }

  /** 濒死：从濒死者开始按座次依次求【桃】，救不回来则死亡。killer 为致死伤害的来源（无来源伤害为 null）。 */
  *dying(p: Player, killer: Player | null = null): GameFlow {
    this.emit('dying', { player: p });
    this.log(`${p.name} 进入濒死状态，依次求${CARD_LABEL.tao}……`);

    for (const savior of this.playersFrom(p)) {
      while (p.hp <= 0) {
        const tao = yield* this.askCard(savior, 'tao', 'dying', { targetId: p.id });
        if (!tao) break;
        this.log(`${savior.name} 对 ${p.name} 使用${CARD_LABEL.tao}`);
        this.heal(p, 1);
        this.log(`${p.name} 回复 1 点体力（${p.hp}/${p.maxHp}）`);
        // 救援（主公技，孙权）：其他吴势力角色在你濒死时对你使用【桃】，额外回复 1 点体力
        if (p.role === 'lord' && p.hasSkill('jiuyuan') && savior !== p && savior.kingdom === 'wu') {
          this.heal(p, 1);
          this.log(`${p.name} 的【救援】生效，额外回复 1 点体力（${p.hp}/${p.maxHp}）`);
        }
      }
      if (p.hp > 0) break;
    }

    if (p.hp <= 0) {
      this.kill(p, killer);
    } else {
      this.log(`${p.name} 脱离濒死`);
    }
  }

  /**
   * 死亡结算：标记阵亡 → 身份奖惩（杀反贼摸 3 张；主公杀忠臣弃置所有手牌与装备）→
   * 阵亡者的牌全部进弃牌堆 → 胜负判定。killer 为凶手（伤害来源），无来源伤害（闪电/失去体力）为 null。
   */
  kill(p: Player, killer: Player | null = null): void {
    p.alive = false;
    this.emit('death', { player: p, killer });
    this.log(`${p.name} 死亡${killer ? `，凶手是 ${killer.name}` : ''}！`);

    if (killer && killer.alive && p.role === 'rebel') {
      this.log(`${killer.name} 杀死反贼，摸 3 张牌`);
      this.drawCards(killer, 3);
    }
    if (p.role === 'loyalist' && killer?.role === 'lord') {
      const equips = Object.values(killer.equips).filter((c): c is Card => c !== null);
      const all = [...killer.hand, ...equips];
      killer.hand = [];
      killer.equips = { weapon: null, armor: null, horsePlus: null, horseMinus: null };
      for (const c of all) this.toDiscard(c);
      for (const c of equips) this.emit('equip-lose', { player: killer, card: c }); // 枭姬触发点
      if (all.length > 0) this.emit('card-discard', { player: killer, cards: all });
      this.log(`${killer.name} 杀死忠臣，弃置所有手牌与装备（共 ${all.length} 张）`);
    }

    // 阵亡者的牌（手牌 + 装备区 + 判定区）全部进入弃牌堆——官方顺序为先奖惩后弃牌；
    // 该时点也是后续收尸类技能的挂点。奸雄类逻辑可通过 game.discard 看到这些牌。
    const deadEquips = Object.values(p.equips).filter((c): c is Card => c !== null);
    const remains = [...p.hand, ...deadEquips, ...p.judgeArea];
    p.hand = [];
    p.equips = { weapon: null, armor: null, horsePlus: null, horseMinus: null };
    p.judgeArea = [];
    for (const c of remains) this.toDiscard(c);
    if (remains.length > 0) {
      this.emit('card-discard', { player: p, cards: remains });
      this.log(`${p.name} 的 ${remains.length} 张牌（手牌/装备/判定区）进入弃牌堆`);
    }

    this.checkVictory(p);
  }

  /**
   * 胜负判定：
   * - 1v1（无身份）：只剩一人存活即结束；
   * - 主公死：场上只剩内奸存活 → 内奸胜，否则反贼胜；
   * - 反贼与内奸全灭：主公方（主 + 忠）胜。
   */
  private checkVictory(dead: Player): void {
    const alive = this.alivePlayers();
    if (!this.players.some((pl) => pl.role)) {
      if (alive.length <= 1) {
        this.over = true;
        this.winner = alive[0] ?? null;
      }
      return;
    }
    if (dead.role === 'lord') {
      this.over = true;
      if (alive.length === 1 && alive[0].role === 'renegade') {
        this.winner = alive[0];
        this.winSide = 'renegade';
      } else {
        this.winSide = 'rebel';
      }
      return;
    }
    if (alive.length > 0 && alive.every((pl) => pl.role === 'lord' || pl.role === 'loyalist')) {
      this.over = true;
      this.winSide = 'lord';
    }
  }

  /**
   * 响应窗口：向 p 求一张 wants 牌，可放弃。
   * 支持转化技响应（useSkill + cardId：把一张手牌当作 wants 打出）。
   * 非法响应（没有这张牌/牌型不符/不可转化）会重新询问，绝不破坏状态。
   * 打出的牌进入弃牌堆。
   */
  private *askCard(
    p: Player,
    wants: CardName,
    reason: ResponseReason,
    ctx: { sourceId?: string; targetId?: string; need?: number } = {},
  ): GameFlow<Card | null> {
    while (true) {
      const converts = this.convertOptions(p, wants);
      const ask: AskRequest = {
        kind: 'response',
        playerId: p.id,
        wants,
        reason,
        ...ctx,
        converts: converts.length > 0 ? converts : undefined,
      };
      const res = yield ask;
      if (res.pass) {
        // 主公技：主公（身份局限定）放弃响应后，同势力角色可代打（护驾/激将）
        const lorded = yield* this.lordSkillResponse(p, wants, reason, ctx);
        if (lorded) return lorded;
        return null;
      }

      // 转化技响应：把手牌当作 wants 打出（虚拟牌；丈八蛇矛等多牌转化需恰好 count 张）
      if ('useSkill' in res && res.useSkill) {
        const conv = this.findConvert(p, res.useSkill, wants);
        const need = conv?.count ?? 1;
        const ids =
          'cardIds' in res && Array.isArray(res.cardIds) && res.cardIds.length > 0
            ? res.cardIds
            : 'cardId' in res && res.cardId
              ? [res.cardId]
              : [];
        const cards = ids.map((id) => p.hand.find((c) => c.id === id));
        if (
          conv &&
          (!conv.condition || conv.condition(this, p)) &&
          ids.length === need &&
          new Set(ids).size === need &&
          cards.every((c): c is Card => !!c && conv.match(c))
        ) {
          for (const card of cards) {
            this.removeFromHand(p, card);
            this.toDiscard(card);
          }
          this.emit('card-response', { player: p, card: cards[0], reason });
          this.log(
            `${p.name} 发动【${conv.name}】，将${cards.map((c) => cardText(c)).join('')}当做${CARD_LABEL[wants]}打出`,
          );
          return cards[0];
        }
        continue; // 非法转化，重新询问
      }

      if (!('cardId' in res)) continue;
      const card = p.hand.find((c) => c.id === res.cardId && c.name === wants);
      if (card) {
        this.removeFromHand(p, card);
        this.toDiscard(card);
        this.emit('card-response', { player: p, card, reason });
        return card;
      }
    }
  }

  /**
   * 主公技的"同势力响应"环节（护驾/激将）：
   * 主公（身份局限定：role === 'lord' 且持有对应主公技）在响应窗口放弃后，
   * 按座次询问其他同势力且拿得出所求牌的角色是否代打；有人响应则视为主公打出。
   * - 护驾：被杀求闪（reason 'sha'）时可询问魏势力角色代打【闪】；
   * - 激将：响应场景（南蛮/决斗/借刀求杀）可询问蜀势力角色代打【杀】；
   *   出牌阶段主动激将出杀留 TODO（需额外的出牌阶段询问环节）。
   */
  private *lordSkillResponse(
    p: Player,
    wants: CardName,
    reason: ResponseReason,
    ctx: { sourceId?: string; targetId?: string; need?: number },
  ): GameFlow<Card | null> {
    if (p.role !== 'lord') return null;
    const skillId = wants === 'shan' ? 'hujia' : wants === 'sha' ? 'jijiang' : null;
    if (!skillId || !p.hasSkill(skillId)) return null;
    if (skillId === 'hujia' && reason !== 'sha') return null;
    if (skillId === 'jijiang' && reason !== 'nanman' && reason !== 'juedou' && reason !== 'jiedao') {
      return null;
    }
    // 只问拿得出这张牌的同势力角色（手牌直出或有转化技），减少无意义询问
    const mates = this.playersFrom(p)
      .slice(1)
      .filter(
        (q) => q.kingdom === p.kingdom && (q.findCard(wants) || this.convertOptions(q, wants).length > 0),
      );
    if (mates.length === 0) return null;
    const label = skillId === 'hujia' ? '护驾' : '激将';
    this.log(
      `${p.name} 发动【${label}】，询问${KINGDOM_CN[p.kingdom!]}势力角色是否代打${CARD_LABEL[wants]}`,
    );
    for (const q of mates) {
      if (this.over) return null;
      const card = yield* this.askCard(q, wants, skillId, { sourceId: ctx.sourceId ?? p.id, targetId: p.id });
      if (card) {
        this.log(`${q.name} 响应【${label}】，视为 ${p.name} 打出${CARD_LABEL[wants]}`);
        return card;
      }
    }
    return null;
  }
}
