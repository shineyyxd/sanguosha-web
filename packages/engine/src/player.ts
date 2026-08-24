/**
 * 玩家 / 武将 / 技能。
 *
 * 技能（Skill）四种形态，可组合：
 * - listeners：同步监听器，改数值/自动触发（如马术的距离 -1）；
 * - triggers：可挂起触发技——事件命中时把 flow 排进 Game 的触发队列，
 *   由流程在挂起点 yield* 执行（可再问玩家，如奸雄/铁骑/突袭）；
 * - active：主动技，出牌阶段作为一种操作发动（如苦肉）；
 * - converts：转化技，把一张牌当作另一张牌使用/打出（如武圣、龙胆、奇袭）。
 *
 * 技能对象是武将模板上的共享定义，不含玩家状态；所属玩家以 owner 参数
 * 传给监听器/触发流程。
 */

import type { EventType } from './events.js';
import type { Card, CardName, EquipSlot } from './cards.js';
import type { Gender, Kingdom } from './data/standard-generals.js';
import type { PhaseId } from './phases.js';
import type { Game, GameFlow } from './game.js';
import type { AskResponse } from './asks.js';
import type { Role } from './roles.js';

/** 技能同步监听器：事件 payload 类型由实现方按 type 自行标注（any 是有意的）。 */
export interface SkillListener {
  type: EventType;
  priority: number;
  handler: (event: any, game: Game, owner?: Player) => void;
}

/** 可挂起触发技：事件 on 发出且 when 命中时，flow 被排入触发队列。 */
export interface SkillTrigger {
  on: EventType;
  /** 触发条件（事件发出时同步判断）。payload 类型由实现方按 on 自行标注。 */
  when?: (event: any, game: Game, owner: Player) => boolean;
  /** 发动流程（可挂起）；返回 true 表示实际发动了（阶段替换判断用）。 */
  flow: (game: Game, owner: Player, event: any) => GameFlow<boolean>;
  /** 设置后，发动将替换对应阶段的默认行为（如 'draw-phase' 替换摸牌）。 */
  replaces?: string;
}

/** 主动技：出牌阶段可发动。 */
export interface ActiveSkill {
  /** 当前是否可发动（play 询问的 availableSkills 与发动前校验都用它）。 */
  usable?: (game: Game, owner: Player) => boolean;
  flow: (game: Game, owner: Player, res: AskResponse) => GameFlow;
}

/** 转化技：把一张（或 count 张）满足 match 的牌当作 as 使用（activeUse）或打出（响应窗口）。 */
export interface ConvertSkill {
  id: string;
  name: string;
  as: CardName;
  match: (card: Card) => boolean;
  /** 能否在出牌阶段主动使用（默认只能用于响应）。 */
  activeUse?: boolean;
  /** 同时转化的牌数（默认 1；丈八蛇矛为 2）。 */
  count?: number;
  /** 额外的可用条件（如急救"仅回合外"）；返回 false 时不提供转化选项。 */
  condition?: (game: Game, owner: Player) => boolean;
}

export interface Skill {
  id: string;
  name: string;
  description?: string;
  /** 同步监听器（锁定技等），handler 第三参为技能所属玩家。 */
  listeners?: SkillListener[];
  /** 可挂起触发技。 */
  triggers?: SkillTrigger[];
  /** 主动技。 */
  active?: ActiveSkill;
  /** 转化技。 */
  converts?: ConvertSkill[];
  /** 被动规则标记（锁定技）：由引擎的通用判定读取，无需监听器。 */
  flags?: {
    /** 出牌阶段使用【杀】无次数限制（咆哮，与诸葛连弩等价、天然去重）。 */
    unlimitedSha?: boolean;
    /** 使用锦囊牌无距离限制（奇才；目前只影响【顺手牵羊】的距离校验）。 */
    trickNoDistance?: boolean;
    /** 无双：使用【杀】需两张【闪】抵消；决斗中对方每次响应需打出两张【杀】。 */
    wushuang?: boolean;
    /** 空城：没有手牌时不能成为【杀】/【决斗】的目标（条件由引擎判定）。 */
    kongcheng?: boolean;
    /** 谦逊：不能成为这些锦囊牌的目标。 */
    immuneToTricks?: CardName[];
  };
}

export interface GeneralTemplate {
  id?: string;
  name: string;
  maxHp: number;
  /** 势力（白板为 undefined，公开状态里透传为 null）。 */
  kingdom?: Kingdom;
  /** 性别（缺省视为男性；白板没有设定性别）。 */
  gender?: Gender;
  skills: Skill[];
}

/** 默认武将模板：4 体力，无技能。 */
export const BLANK_GENERAL: GeneralTemplate = {
  id: 'blank',
  name: '白板武将',
  maxHp: 4,
  skills: [],
};

export class Player {
  hp: number;
  hand: Card[] = [];
  /** 装备区：四个槽位，同槽新装备替换旧装备（旧装备弃置）。 */
  equips: Record<EquipSlot, Card | null> = {
    weapon: null,
    armor: null,
    horsePlus: null,
    horseMinus: null,
  };
  /** 判定区：延时锦囊（乐不思蜀/闪电）在此等待判定阶段的判定。 */
  judgeArea: Card[] = [];
  /** 本回合是否跳过出牌阶段（乐不思蜀判定非红桃）。 */
  skipPlay = false;
  /** 本回合已使用的【杀】数量（出牌阶段限一次，诸葛连弩/咆哮除外）。 */
  shaUsed = 0;
  /** 本回合的技能标记（裸衣加伤、青囊/反间限一次、克己出杀记录等），回合开始时清空。 */
  readonly turnFlags = new Set<string>();
  /** 本回合的技能计数（仁德累计给出牌数等），回合开始时清空。 */
  readonly turnCounts = new Map<string, number>();
  alive = true;
  currentPhase: PhaseId | null = null;
  /** 技能挂载点：初始来自武将模板，也可由 Game.mountSkill 动态挂载。 */
  skills: Skill[];

  constructor(
    public readonly id: string,
    public name: string,
    /** 座次，从 0 开始，按座位顺序行动。 */
    public seat: number,
    public general: GeneralTemplate = BLANK_GENERAL,
    /** 身份局身份（1v1 对决为 null）。主公体力上限 +1。 */
    public role: Role | null = null,
  ) {
    this.hp = this.maxHp;
    this.skills = [...general.skills];
  }

  get maxHp(): number {
    return this.general.maxHp + (this.role === 'lord' ? 1 : 0);
  }

  /** 势力（来自武将模板；白板为 null）。换将后自动跟随。 */
  get kingdom(): Kingdom | null {
    return this.general.kingdom ?? null;
  }

  /** 性别（来自武将模板；未设定的白板视为男性）。 */
  get gender(): Gender {
    return this.general.gender ?? 'male';
  }

  findCard(name: CardName): Card | undefined {
    return this.hand.find((c) => c.name === name);
  }

  hasSkill(skillId: string): boolean {
    return this.skills.some((s) => s.id === skillId);
  }
}
