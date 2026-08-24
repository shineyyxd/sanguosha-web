/**
 * 响应窗口（AskForResponse）——三国杀交互的核心抽象。
 *
 * 引擎本身不实现超时，也不直接读输入：当需要玩家做决定时，
 * 引擎的 generator 流程 yield 一个 AskRequest（"等待谁、响应什么、为什么"），
 * 由驱动层（CLI / 测试 / 服务器）收集输入后把 AskResponse 传回 next()。
 */

import type { Card, CardName } from './cards.js';

/**
 * 被动响应的原因：被杀求闪、濒死求桃、南蛮求杀、万箭求闪、决斗轮流出杀、借刀求杀、锦囊求无懈；
 * 主公技同势力响应（护驾求闪 / 激将求杀）；青龙偃月刀追杀（使用者自己再出一张杀）。
 */
export type ResponseReason =
  | 'sha' | 'dying' | 'nanman' | 'wanjian' | 'juedou' | 'jiedao' | 'wuxie'
  | 'hujia' | 'jijiang' | 'qinglong';

/** 响应窗口里可用的转化技选项（如武圣：红牌当杀）。cardIds 为当前手牌中可转化的牌。 */
export interface ConvertOption {
  skillId: string;
  name: string;
  /** 可转化成的牌名（即本窗口所求的牌）。 */
  as: CardName;
  /** 手里哪些牌可用于转化。 */
  cardIds: string[];
  /** 需要同时转化的牌数（默认 1；丈八蛇矛为 2）。 */
  count?: number;
}

export type AskRequest =
  | {
      /** 出牌阶段主动询问：选择一张牌打出、发动一个技能，或放弃结束出牌。 */
      kind: 'play';
      playerId: string;
      /** 当前可发动的技能（主动技 / 可主动使用的转化技）id 列表。 */
      availableSkills?: string[];
    }
  | {
      /** 被动响应窗口：被求一张特定的牌（被杀求闪、濒死求桃、锦囊求无懈……），可放弃。 */
      kind: 'response';
      playerId: string;
      wants: CardName;
      reason: ResponseReason;
      /** 求闪时：杀的来源；求桃时：濒死的玩家；求无懈时：锦囊的来源/目标。 */
      sourceId?: string;
      targetId?: string;
      /** 本次响应还需打出的数量（无双：杀需两张闪、决斗需两张杀）；缺省为 1。 */
      need?: number;
      /** 可用的转化技（用一张手牌当作所求的牌打出）。 */
      converts?: ConvertOption[];
    }
  | {
      /**
       * 从亮出的若干张牌中选一张（五谷丰登）。
       * 用 AskResponse.cardId 指明所选牌（必须是 cards 之一），不可放弃。
       */
      kind: 'choose-card';
      playerId: string;
      cards: Card[];
      reason: 'wugu';
    }
  | {
      /** 是否发动某个技能（触发技的"是否发动"确认）。{confirm:true} 发动，{pass:true} 放弃。 */
      kind: 'confirm';
      playerId: string;
      skillId: string;
    }
  | {
      /**
       * 弃牌：手牌数超过当前体力值时必须弃至体力值（弃牌阶段，官方规则，不可放弃），
       * 或技能代价（流离弃一张牌转移杀）。用 AskResponse.cardIds 指明所弃的牌
       * （必须恰为手牌中的 count 张）；非法响应重问。
       */
      kind: 'discard';
      playerId: string;
      count: number;
      /** 技能代价弃牌（如流离）；缺省为弃牌阶段。 */
      skillId?: string;
    }
  | {
      /** 从候选目标中选择 min~max 名角色（如张辽突袭、大乔流离选目标）。{targetIds:[...]} 或 {pass:true} 放弃。 */
      kind: 'choose-target';
      playerId: string;
      targetIds: string[];
      min: number;
      max: number;
      skillId?: string;
    }
  | {
      /**
       * 从互斥选项中选一项（刚烈的"弃牌或受伤"、反间的"猜花色"），不可放弃。
       * 用 AskResponse.choice 指明所选；非法选择重问。被问者不一定是技能持有者（刚烈问伤害来源）。
       */
      kind: 'choose-option';
      playerId: string;
      options: { id: string; label: string }[];
      skillId?: string;
    }
  | {
      /**
       * 把一张已亮出的牌交给一名角色（遗计分配），{targetId} 交给该角色，
       * {pass:true} 表示自己保留。targetIds 含自己（选择自己 = 保留）。
       */
      kind: 'give-card';
      playerId: string;
      card: Card;
      targetIds: string[];
      skillId?: string;
    }
  | {
      /**
       * 鬼才改判：判定牌生效前，询问持有鬼才的玩家是否打出一张手牌代替之。
       * {cardId}（手牌之一）改判，{pass:true} 不改；非法选择重问。
       * card 为当前（可能已被前一位鬼才改过的）判定牌。
       */
      kind: 'judge-retrial';
      playerId: string;
      card: Card;
      /** 触发判定的牌名/技能 id（lebu / shandian / bagua / tieji……）。 */
      reason: string;
      skillId: string;
    }
  | {
      /**
       * 观星：观看牌堆顶的 cards（按从顶到底的顺序），选择其中任意张置于牌堆底，
       * 其余保持原顺序回顶。{cardIds} 为放底的牌（子集即可，可空），{pass:true} 全部回顶。
       */
      kind: 'guanxing';
      playerId: string;
      cards: Card[];
      skillId?: string;
    };

export type AskResponse =
  | { pass: true }
  | {
      pass?: false;
      cardId: string;
      /** 主目标（杀/锦囊的目标；借刀杀人时为装备武器者）。 */
      targetId?: string;
      /** 第二目标（借刀杀人时指定的【杀】的目标）。 */
      targetId2?: string;
    }
  | {
      /** 确认发动（confirm 询问）。 */
      pass?: false;
      confirm: true;
    }
  | {
      /**
       * 发动技能：
       * - play 窗口：useSkill 为主动技或可主动使用的转化技 id；转化技需带 cardId（被转化的手牌）与目标；
       *   多选牌主动技（仁德/制衡/结姻等）带 cardIds（手牌 id 数组）；
       * - response 窗口：useSkill 为转化技 id，cardId 为被当作所求牌打出的手牌（"虚拟牌"响应）。
       */
      pass?: false;
      useSkill: string;
      cardId?: string;
      /** 多选牌主动技的手牌 id 数组（与 cardId 二选一，技能自行解读）。 */
      cardIds?: string[];
      targetId?: string;
      /** 第二目标（借刀杀人的杀目标；离间的第二名男性角色——被决斗者）。 */
      targetId2?: string;
    }
  | {
      /** choose-target 的选择结果。 */
      pass?: false;
      targetIds: string[];
    }
  | {
      /** choose-option 的选择结果（options 之一的 id）。 */
      pass?: false;
      choice: string;
    }
  | {
      /** give-card 的选择结果：把牌交给该角色。 */
      pass?: false;
      targetId: string;
    }
  | {
      /** discard（弃牌阶段）的选择结果：恰好 count 张手牌 id。 */
      pass?: false;
      cardIds: string[];
    };
