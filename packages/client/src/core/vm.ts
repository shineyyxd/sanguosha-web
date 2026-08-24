/**
 * 视图模型层（纯逻辑，不依赖 Phaser / DOM，可单测）。
 *
 * 把 PublicState / AskRequest 映射成渲染与交互所需的派生数据：
 * - 对手座次排序、卡牌展示属性（颜色/类型/花色文本）；
 * - 各 ask.kind 的提示文案；
 * - 响应窗口可出的牌（直出 + 转化技）与出牌阶段可用技能的候选手牌；
 * - UI 选择（牌/技能/目标）→ AskResponse 的组装与最小合法性校验。
 *
 * 注意：这里的"合法性"只是 UI 层的预判（决定高亮和按钮可用性），
 * 最终合法性永远由服务器/引擎把关（零信任）。
 */

import {
  CARD_DEFS,
  CARD_LABEL,
  PHASE_LABEL,
  ROLE_LABEL,
  ROLE_OBJECTIVE,
  SUIT_LABEL,
  cardText,
  isBlack,
  isRed,
  type Card,
  type CardName,
  type CardType,
  type PhaseId,
  type Role,
} from '@sanguosha/engine';
import type { AskRequest, AskResponse, MatchRecord, PublicPlayer, PublicState, UserStats } from '../protocol.js';

export { CARD_LABEL, PHASE_LABEL, ROLE_LABEL, ROLE_OBJECTIVE, SUIT_LABEL, cardText, isBlack, isRed };
export type { Card, CardName, CardType, PhaseId, Role };

/** 势力展示名。 */
export const KINGDOM_LABEL: Record<string, string> = {
  wei: '魏',
  shu: '蜀',
  wu: '吴',
  qun: '群',
};

/** 身份牌上的大字（服务器已按视角过滤，null 表示不可见）。 */
export function roleBadge(p: PublicPlayer): string | null {
  return p.role ? ROLE_LABEL[p.role] : null;
}

// ---------- 战绩展示 ----------

/** 战绩条目的模式展示名：1v1 / N 人身份局。 */
export function matchModeLabel(rec: Pick<MatchRecord, 'mode' | 'playerCount'>): string {
  return rec.mode === '1v1' ? '1v1 对决' : `${rec.playerCount} 人身份局`;
}

/** 胜率文本：无场次显示 "—"，否则百分比（保留整数）。 */
export function winRateText(stats: Pick<UserStats, 'total' | 'winRate'>): string {
  return stats.total > 0 ? `${Math.round(stats.winRate * 100)}%` : '—';
}

/** 战绩条目的身份展示名（1v1 无身份）。 */
export function matchRoleLabel(rec: Pick<MatchRecord, 'role'>): string {
  return rec.role ? ROLE_LABEL[rec.role] : '—';
}

export const SUIT_SYMBOL: Record<string, string> = {
  spade: '♠',
  heart: '♥',
  club: '♣',
  diamond: '♦',
};

// ---------- 卡牌展示 ----------

export function cardColor(card: Card): 'red' | 'black' | 'none' {
  if (!card.suit) return 'none';
  return isRed(card) ? 'red' : 'black';
}

export function cardTypeOf(name: CardName): CardType {
  return CARD_DEFS[name].type;
}

export function suitRankText(card: Card): string {
  return card.suit && card.rank ? `${SUIT_SYMBOL[card.suit]}${card.rank}` : '';
}

// ---------- 对手座次 ----------

/** 除我以外的玩家，按"我的下家开始"的逆时针座次排列（用于牌桌上方布局）。 */
export function opponentsOf(state: PublicState): PublicPlayer[] {
  const n = state.players.length;
  const others = state.players.filter((p) => p.id !== state.me.id);
  return others.sort((a, b) => (a.seat - state.me.seat + n) % n - ((b.seat - state.me.seat + n) % n));
}

export function myPublicPlayer(state: PublicState): PublicPlayer | undefined {
  return state.players.find((p) => p.id === state.me.id);
}

// ---------- 技能元数据（UI 展示与高亮预判；机制实现见 engine/skills.ts） ----------

export interface SkillMeta {
  id: string;
  name: string;
  description: string;
  kind: 'active' | 'convert' | 'trigger';
  /** convert：转化成的牌名。 */
  as?: CardName;
  /** convert / 单牌主动技：哪些手牌可用于发动（仅 UI 高亮预判，服务器把关）。 */
  match?: (card: Card) => boolean;
  /** 发动时是否需要选一张手牌。 */
  needsCard: boolean;
  /** 发动时是否需要选一名目标（主动技如青囊/反间；转化技由 as 牌名推断）。 */
  needsTarget?: boolean;
  /** 多选牌主动技（仁德/制衡）：至少选 1 张手牌，多选。 */
  multiCards?: boolean;
  /** 定数牌主动技：恰好选 N 张手牌（结姻 2 张、离间 1 张）。 */
  exactCards?: number;
  /** 需要按序选两名目标（离间：先选者视为决斗使用者，后选者被决斗）。 */
  twoTargets?: boolean;
  /** 目标限男性角色（离间/结姻；依据 PublicPlayer.gender 过滤可点目标）。 */
  maleOnly?: boolean;
}

const SKILLS: SkillMeta[] = [
  {
    id: 'wusheng', name: '武圣', kind: 'convert', as: 'sha', needsCard: true,
    description: '你可以将一张红色牌当做【杀】使用或打出。',
    match: (c) => isRed(c),
  },
  {
    id: 'longdan-sha', name: '龙胆', kind: 'convert', as: 'sha', needsCard: true,
    description: '你可以将【闪】当做【杀】使用或打出。',
    match: (c) => c.name === 'shan',
  },
  {
    id: 'longdan-shan', name: '龙胆', kind: 'convert', as: 'shan', needsCard: true,
    description: '你可以将【杀】当做【闪】使用或打出。',
    match: (c) => c.name === 'sha',
  },
  {
    id: 'qixi', name: '奇袭', kind: 'convert', as: 'guohe', needsCard: true,
    description: '你可以将一张黑色牌当做【过河拆桥】使用。',
    match: (c) => isBlack(c),
  },
  {
    id: 'kurou', name: '苦肉', kind: 'active', needsCard: false,
    description: '出牌阶段，你可以失去1点体力，然后摸两张牌。',
  },
  { id: 'jianxiong', name: '奸雄', kind: 'trigger', needsCard: false, description: '当你受到伤害后，你可以获得对你造成伤害的牌。' },
  { id: 'tuxi', name: '突袭', kind: 'trigger', needsCard: false, description: '摸牌阶段，你可以改为获得至多两名其他角色的各一张手牌。' },
  { id: 'tieji', name: '铁骑', kind: 'trigger', needsCard: false, description: '当你使用【杀】指定目标后，你可以判定，若为红色则此【杀】不可被闪避。' },
  { id: 'mashu', name: '马术', kind: 'trigger', needsCard: false, description: '锁定技，你计算与其他角色的距离时-1。' },
  // ---------- 第二批 ----------
  { id: 'paoxiao', name: '咆哮', kind: 'trigger', needsCard: false, description: '锁定技，出牌阶段，你使用【杀】没有数量限制。' },
  { id: 'luoyi', name: '裸衣', kind: 'trigger', needsCard: false, description: '摸牌阶段，你可以少摸一张牌。若如此做，本回合你的【杀】和【决斗】造成的伤害+1。' },
  { id: 'ganglie', name: '刚烈', kind: 'trigger', needsCard: false, description: '当你受到伤害后，你可以判定。若结果不为红桃，则伤害来源须弃置两张手牌，否则其受到1点伤害。' },
  { id: 'tiandu', name: '天妒', kind: 'trigger', needsCard: false, description: '当你的判定牌生效后，你可以获得之。' },
  { id: 'yiji', name: '遗计', kind: 'trigger', needsCard: false, description: '当你受到1点伤害后，你可以观看牌堆顶的两张牌，然后将其分配给任意角色。' },
  { id: 'luoshen', name: '洛神', kind: 'trigger', needsCard: false, description: '准备阶段，你可以判定。若结果为黑色，你获得判定牌并可继续判定，直到出现红色。' },
  {
    id: 'qingguo', name: '倾国', kind: 'convert', as: 'shan', needsCard: true,
    description: '你可以将一张黑色手牌当做【闪】使用或打出。',
    match: (c) => isBlack(c),
  },
  {
    id: 'jijiu', name: '急救', kind: 'convert', as: 'tao', needsCard: true,
    description: '你的回合外，你可以将一张红色牌当做【桃】使用。',
    match: (c) => isRed(c),
  },
  {
    id: 'qingnang', name: '青囊', kind: 'active', needsCard: true, needsTarget: true,
    description: '出牌阶段限一次，你可以弃置一张手牌并令一名角色回复1点体力。',
    match: () => true, // 任意手牌可弃
  },
  { id: 'keji', name: '克己', kind: 'trigger', needsCard: false, description: '弃牌阶段开始时，若你本回合出牌阶段内没有使用或打出过【杀】，则你可以跳过此阶段。' },
  { id: 'yingzi', name: '英姿', kind: 'trigger', needsCard: false, description: '摸牌阶段，你可以多摸一张牌。' },
  {
    id: 'fanjian', name: '反间', kind: 'active', needsCard: false, needsTarget: true,
    description: '出牌阶段限一次。令一名角色猜一种花色，然后其获得你的一张手牌；若猜错，你对其造成1点伤害。',
  },
  // ---------- 第三批 ----------
  {
    id: 'rende', name: '仁德', kind: 'active', needsCard: false, multiCards: true, needsTarget: true,
    description: '出牌阶段，你可以将任意张手牌交给其他角色。当你以此法于一回合内给出第二张牌时，你回复1点体力。',
    match: () => true, // 任意手牌可给
  },
  {
    id: 'zhiheng', name: '制衡', kind: 'active', needsCard: false, multiCards: true,
    description: '出牌阶段限一次，你可以弃置任意张牌，然后摸等量的牌。',
    match: () => true,
  },
  {
    id: 'lijian', name: '离间', kind: 'active', needsCard: false, exactCards: 1, twoTargets: true, maleOnly: true,
    description: '出牌阶段限一次，你可以弃置一张牌，视为一名男性角色对另一名男性角色使用一张【决斗】（不可被【无懈可击】响应）。',
    match: () => true,
  },
  { id: 'biyue', name: '闭月', kind: 'trigger', needsCard: false, description: '结束阶段，你可以摸一张牌。' },
  {
    id: 'jieyin', name: '结姻', kind: 'active', needsCard: false, exactCards: 2, needsTarget: true, maleOnly: true,
    description: '出牌阶段限一次，你可以弃置两张手牌并选择一名已经受伤的男性角色。你与其各回复1点体力。',
    match: () => true,
  },
  { id: 'xiaoji', name: '枭姬', kind: 'trigger', needsCard: false, description: '当你失去一张装备区内的牌后，你可以摸两张牌。' },
  { id: 'jizhi', name: '集智', kind: 'trigger', needsCard: false, description: '当你使用普通锦囊牌时，你可以摸一张牌。' },
  { id: 'qicai', name: '奇才', kind: 'trigger', needsCard: false, description: '锁定技，你使用锦囊牌无距离限制。' },
  // ---------- 第四批 ----------
  { id: 'fankui', name: '反馈', kind: 'trigger', needsCard: false, description: '当你受到伤害后，你可以获得伤害来源的一张牌。' },
  { id: 'guicai', name: '鬼才', kind: 'trigger', needsCard: false, description: '一名角色的判定牌生效前，你可以打出一张手牌代替之。' },
  { id: 'wushuang', name: '无双', kind: 'trigger', needsCard: false, description: '锁定技，你使用【杀】需两张【闪】才能抵消；决斗中对方每次响应需打出两张【杀】。' },
  { id: 'guanxing', name: '观星', kind: 'trigger', needsCard: false, description: '准备阶段，你可以观看牌堆顶的X张牌，并将其以任意顺序置于牌堆顶或牌堆底。（X为存活角色数且至多为5）' },
  { id: 'kongcheng', name: '空城', kind: 'trigger', needsCard: false, description: '锁定技，当你没有手牌时，你不能成为【杀】或【决斗】的目标。' },
  {
    id: 'guose', name: '国色', kind: 'convert', as: 'lebu', needsCard: true,
    description: '你可以将一张方片牌当做【乐不思蜀】使用。',
    match: (c) => c.suit === 'diamond',
  },
  { id: 'liuli', name: '流离', kind: 'trigger', needsCard: false, description: '当你成为【杀】的目标时，你可以弃置一张牌并将此【杀】转移给攻击范围内的一名其他角色（不能是此【杀】的使用者）。' },
  { id: 'qianxun', name: '谦逊', kind: 'trigger', needsCard: false, description: '锁定技，你不能成为【顺手牵羊】和【乐不思蜀】的目标。' },
  { id: 'lianying', name: '连营', kind: 'trigger', needsCard: false, description: '当你失去最后的手牌时，你可以摸一张牌。' },
  // ---------- 主公技 ----------
  { id: 'hujia', name: '护驾', kind: 'trigger', needsCard: false, description: '主公技，当你需要打出【闪】时，你可以令其他魏势力角色选择是否打出一张【闪】（视为你打出）。' },
  { id: 'jijiang', name: '激将', kind: 'trigger', needsCard: false, description: '主公技，当你需要打出【杀】时，你可以令其他蜀势力角色选择是否打出一张【杀】（视为你打出）。' },
  { id: 'jiuyuan', name: '救援', kind: 'trigger', needsCard: false, description: '主公技，锁定技，其他吴势力角色在你濒死时对你使用【桃】，你额外回复1点体力。' },
  // ---------- 武器特效（确认/选择询问的展示名；范围数值见卡牌定义） ----------
  { id: 'bagua', name: '八卦阵', kind: 'trigger', needsCard: false, description: '当你需要打出【闪】时，你可以判定：若结果为红色，视为你打出一张【闪】。' },
  { id: 'cixiong', name: '雌雄双股剑', kind: 'trigger', needsCard: false, description: '当你使用【杀】指定异性目标后，令对方选择：弃一张手牌，或你摸一张牌。' },
  { id: 'hanbing', name: '寒冰剑', kind: 'trigger', needsCard: false, description: '当你的【杀】造成伤害前，若对方有牌，你可以防止此伤害，改为弃置其两张牌。' },
  { id: 'qinglong', name: '青龙偃月刀', kind: 'trigger', needsCard: false, description: '当你的【杀】被【闪】抵消后，你可以对相同目标再使用一张【杀】。' },
  { id: 'qilin', name: '麒麟弓', kind: 'trigger', needsCard: false, description: '当你的【杀】造成伤害后，你可以弃置目标的一匹马。' },
  { id: 'fangtian', name: '方天画戟', kind: 'trigger', needsCard: false, description: '当你使用的【杀】是最后一张手牌时，此【杀】可额外指定至多两个目标。' },
  {
    id: 'zhangba', name: '丈八蛇矛', kind: 'convert', as: 'sha', needsCard: false,
    exactCards: 2, needsTarget: true,
    description: '你可以将两张手牌当做【杀】使用或打出。',
    match: () => true, // 任意两张手牌
  },
];

export function skillMeta(id: string): SkillMeta | undefined {
  return SKILLS.find((s) => s.id === id);
}

export function skillName(id: string): string {
  return skillMeta(id)?.name ?? id;
}

// ---------- 目标需求（UI 预判；服务器把关） ----------

/** 需要指定一名目标的牌。 */
export const NEEDS_TARGET: ReadonlySet<CardName> = new Set([
  'sha', 'juedou', 'guohe', 'shunshou', 'jiedao', 'lebu',
]);

/** 需要第二目标的牌（借刀杀人：先选持刀者 targetId，再选杀的目标 targetId2）。 */
export const NEEDS_SECOND_TARGET: Readonly<Set<CardName>> = new Set(['jiedao']);

export function cardNeedsTarget(name: CardName): boolean {
  return NEEDS_TARGET.has(name);
}

// ---------- ask 提示文案 ----------

const REASON_TEXT: Record<string, string> = {
  sha: '你成为【杀】的目标',
  dying: '有角色濒死',
  nanman: '响应【南蛮入侵】',
  wanjian: '响应【万箭齐发】',
  juedou: '决斗中',
  jiedao: '响应【借刀杀人】',
  wuxie: '有锦囊正在结算',
  hujia: '【护驾】主公需要一张【闪】',
  jijiang: '【激将】主公需要一张【杀】',
  qinglong: '【青龙偃月刀】追杀，可对该目标再出一张【杀】',
};

export function askPrompt(ask: AskRequest): string {
  switch (ask.kind) {
    case 'play':
      return '出牌阶段：选择一张牌或一个技能，或结束出牌';
    case 'response': {
      const reason = REASON_TEXT[ask.reason] ?? '';
      const need = ask.need && ask.need > 1 ? `（还需 ${ask.need} 张）` : '';
      return `${reason}，请打出 ${CARD_LABEL[ask.wants]}${need}`;
    }
    case 'confirm':
      return `是否发动【${skillName(ask.skillId)}】？`;
    case 'choose-target': {
      const skill = ask.skillId ? `【${skillName(ask.skillId)}】` : '';
      const range = ask.min === ask.max ? `${ask.min}` : `${ask.min}~${ask.max}`;
      return `${skill}请选择 ${range} 名目标`;
    }
    case 'choose-card':
      return '五谷丰登：请选择一张牌';
    case 'choose-option': {
      const skill = ask.skillId ? `【${skillName(ask.skillId)}】` : '';
      return `${skill}请选择一项`;
    }
    case 'give-card': {
      const skill = ask.skillId ? `【${skillName(ask.skillId)}】` : '';
      return `${skill}把${cardText(ask.card)}交给一名角色，或自己保留`;
    }
    case 'judge-retrial': {
      const what = (CARD_LABEL as Record<string, string>)[ask.reason] ?? '';
      return `【鬼才】${what}判定牌 ${cardText(ask.card)} 即将生效，是否打出一张手牌代替之？`;
    }
    case 'guanxing':
      return `【观星】观看牌堆顶 ${ask.cards.length} 张牌：选择要置于牌堆底的牌，其余保持顺序回顶`;
    case 'discard': {
      if (ask.skillId) return `【${skillName(ask.skillId)}】请选择 ${ask.count} 张牌弃置`;
      return `弃牌阶段：手牌数超过体力值，请选择 ${ask.count} 张牌弃置`;
    }
  }
}

// ---------- 响应窗口可出的牌 ----------

export interface ResponseConvertOption {
  skillId: string;
  name: string;
  as: CardName;
  /** 可用于转化的手牌（ask.converts.cardIds 与手牌求交后的完整牌面）。 */
  cards: Card[];
  /** 需要同时转化的牌数（默认 1；丈八蛇矛为 2）。 */
  count: number;
}

export interface ResponseOptions {
  /** 可直接打出的手牌（牌名即所求）。 */
  direct: Card[];
  /** 转化技选项。 */
  converts: ResponseConvertOption[];
}

export function responseOptions(ask: AskRequest, hand: Card[]): ResponseOptions {
  if (ask.kind !== 'response') return { direct: [], converts: [] };
  const direct = hand.filter((c) => c.name === ask.wants);
  const converts: ResponseConvertOption[] = (ask.converts ?? []).map((conv) => {
    const ids = new Set(conv.cardIds);
    return {
      skillId: conv.skillId,
      name: conv.name,
      as: conv.as,
      cards: hand.filter((c) => ids.has(c.id)),
      count: conv.count ?? 1,
    };
  });
  return { direct, converts };
}

// ---------- 出牌阶段可用技能 ----------

export interface PlaySkillOption {
  meta: SkillMeta;
  /** 可用于发动的手牌（needsCard=false 时为空数组，表示无需选牌）。 */
  cards: Card[];
  /** 当前是否可点（有可用牌或无需选牌）。 */
  usable: boolean;
}

export function playSkillOptions(ask: AskRequest, hand: Card[]): PlaySkillOption[] {
  if (ask.kind !== 'play') return [];
  return (ask.availableSkills ?? []).flatMap((id) => {
    const meta = skillMeta(id);
    if (!meta) return [];
    const cards = meta.match ? hand.filter(meta.match) : [];
    // 所需手牌数：多选至少 1 张、定数恰好 N 张（ usable 预判为"至少 N 张"）、单牌 1 张
    const need = meta.multiCards ? 1 : (meta.exactCards ?? (meta.needsCard ? 1 : 0));
    const usable = need === 0 || cards.length >= need;
    return [{ meta, cards, usable }];
  });
}

// ---------- UI 选择 → AskResponse ----------

/** 牌桌交互的当前选择（点选的手牌 / 技能 / 目标）。 */
export interface Selection {
  /** 选中的手牌 id。 */
  cardId?: string;
  /** 选中的技能 id（转化技 / 主动技）。 */
  skillId?: string;
  /** 主目标。 */
  targetId?: string;
  /** 第二目标（借刀杀人）。 */
  targetId2?: string;
  /** choose-target 的多选结果。 */
  targetIds?: string[];
  /** discard（弃牌阶段）的多选手牌。 */
  cardIds?: string[];
}

/**
 * 把 UI 选择组装成 AskResponse；选择不完整/不合法时返回 null（UI 禁用确定键）。
 * 这里只做最小形状校验，最终合法性由服务器把关。
 */
export function buildResponse(ask: AskRequest, sel: Selection, hand: Card[]): AskResponse | null {
  switch (ask.kind) {
    case 'play':
      return buildPlayResponse(ask, sel, hand);
    case 'response':
      return buildResponseWindowResponse(ask, sel, hand);
    case 'confirm':
      return null; // confirm 只有 是/否 两个按钮，不走 buildResponse
    case 'choose-target': {
      const ids = sel.targetIds ?? [];
      const valid =
        ids.length >= ask.min &&
        ids.length <= ask.max &&
        new Set(ids).size === ids.length &&
        ids.every((id) => ask.targetIds.includes(id));
      return valid ? { targetIds: ids } : null;
    }
    case 'choose-card': {
      if (!sel.cardId || !ask.cards.some((c) => c.id === sel.cardId)) return null;
      return { cardId: sel.cardId };
    }
    case 'choose-option':
      return null; // 每个选项一个按钮，不走 buildResponse（类似 confirm）
    case 'give-card': {
      // {targetId} 交给该角色；UI 另有"自己保留"按钮直接 respond pass
      if (!sel.targetId || !ask.targetIds.includes(sel.targetId)) return null;
      return { targetId: sel.targetId };
    }
    case 'discard': {
      const ids = sel.cardIds ?? [];
      const valid =
        ids.length === ask.count &&
        new Set(ids).size === ids.length &&
        ids.every((id) => hand.some((c) => c.id === id));
      return valid ? { cardIds: ids } : null;
    }
    case 'judge-retrial': {
      // 鬼才：从手牌选一张代替判定牌
      const card = hand.find((c) => c.id === sel.cardId);
      return card ? { cardId: card.id } : null;
    }
    case 'guanxing': {
      // 观星：选中的放牌堆底（可空 = 全部回顶），必须在展示牌中且不重复
      const ids = sel.cardIds ?? [];
      const valid =
        new Set(ids).size === ids.length && ids.every((id) => ask.cards.some((c) => c.id === id));
      return valid ? { cardIds: ids } : null;
    }
  }
}

function buildPlayResponse(ask: AskRequest, sel: Selection, hand: Card[]): AskResponse | null {
  if (ask.kind !== 'play') return null;
  // 技能路线：转化技需选一张匹配手牌 + 按转化后的牌名决定目标；主动技按 needsCard/needsTarget
  if (sel.skillId) {
    if (!(ask.availableSkills ?? []).includes(sel.skillId)) return null;
    const meta = skillMeta(sel.skillId);
    if (!meta) return { useSkill: sel.skillId }; // 未知技能：放行给服务器校验
    // 多选牌主动技（仁德/制衡）：至少 1 张、不重复、都在手中
    if (meta.multiCards) {
      const ids = sel.cardIds ?? [];
      const valid =
        ids.length >= 1 &&
        new Set(ids).size === ids.length &&
        ids.every((id) => hand.some((c) => c.id === id));
      if (!valid) return null;
      if (meta.needsTarget && !sel.targetId) return null;
      return { useSkill: meta.id, cardIds: ids, targetId: sel.targetId };
    }
    // 定数牌主动技：恰好 N 张手牌（结姻 2 张；离间 1 张 + 两个不同目标）
    if (meta.exactCards) {
      const ids = sel.cardIds ?? [];
      const valid =
        ids.length === meta.exactCards &&
        new Set(ids).size === ids.length &&
        ids.every((id) => hand.some((c) => c.id === id));
      if (!valid) return null;
      if (meta.twoTargets) {
        if (!sel.targetId || !sel.targetId2 || sel.targetId === sel.targetId2) return null;
        return { useSkill: meta.id, cardIds: ids, targetId: sel.targetId, targetId2: sel.targetId2 };
      }
      if (meta.needsTarget && !sel.targetId) return null;
      return { useSkill: meta.id, cardIds: ids, targetId: sel.targetId };
    }
    if (meta.needsCard) {
      const card = hand.find((c) => c.id === sel.cardId);
      if (!card || (meta.match && !meta.match(card))) return null;
      // 转化技的目标需求看转化后的牌名；主动技看 needsTarget（如青囊）
      const needsTarget = meta.as ? cardNeedsTarget(meta.as) : meta.needsTarget === true;
      if (needsTarget && !sel.targetId) return null;
      return { useSkill: meta.id, cardId: card.id, targetId: sel.targetId };
    }
    if (meta.needsTarget && !sel.targetId) return null; // 如反间
    return { useSkill: meta.id, targetId: sel.targetId };
  }
  // 普通出牌路线
  const card = hand.find((c) => c.id === sel.cardId);
  if (!card) return null;
  if (cardNeedsTarget(card.name) && !sel.targetId) return null;
  if (NEEDS_SECOND_TARGET.has(card.name) && !sel.targetId2) return null;
  return { cardId: card.id, targetId: sel.targetId, targetId2: sel.targetId2 };
}

function buildResponseWindowResponse(
  ask: AskRequest,
  sel: Selection,
  hand: Card[],
): AskResponse | null {
  if (ask.kind !== 'response') return null;
  if (sel.skillId) {
    const conv = (ask.converts ?? []).find((c) => c.skillId === sel.skillId);
    if (!conv) return null;
    const need = conv.count ?? 1;
    // 多牌转化（丈八蛇矛两张当杀）：恰好 need 张、不重复、都在可转化列表里
    if (need > 1) {
      const ids = sel.cardIds ?? [];
      const valid =
        ids.length === need &&
        new Set(ids).size === need &&
        ids.every((id) => conv.cardIds.includes(id));
      return valid ? { useSkill: conv.skillId, cardIds: ids } : null;
    }
    const card = hand.find((c) => c.id === sel.cardId);
    if (!card || !conv.cardIds.includes(card.id)) return null;
    return { useSkill: conv.skillId, cardId: card.id };
  }
  const card = hand.find((c) => c.id === sel.cardId);
  if (!card || card.name !== ask.wants) return null;
  return { cardId: card.id };
}
