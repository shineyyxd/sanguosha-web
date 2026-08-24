/**
 * 卡牌定义与牌堆。
 * Card = id + name + 花色点数（旧测试工具牌堆产出的牌可以没有花色点数）。
 * CARD_DEFS 描述每张牌的类别：基本牌 / 锦囊（含延时）/ 装备（含槽位与武器范围）。
 */

import { STANDARD_CARDS, parseSuitRank, type SuitName } from './data/standard-cards.js';

export type CardName =
  // 基本牌
  | 'sha' | 'shan' | 'tao'
  // 普通锦囊
  | 'juedou' | 'guohe' | 'shunshou' | 'wuzhong' | 'nanman' | 'wanjian' | 'taoyuan' | 'wugu'
  | 'jiedao' | 'wuxie'
  // 延时锦囊
  | 'lebu' | 'shandian'
  // 武器
  | 'zhuge' | 'cixiong' | 'qinggang' | 'qinglong' | 'zhangba' | 'guanshi' | 'fangtian' | 'qilin'
  | 'hanbing'
  // 防具 / 马
  | 'bagua' | 'renwang'
  | 'jueying' | 'dilu' | 'zhuahuang' | 'chitu' | 'dawan' | 'zixin';

export type Suit = SuitName;

export interface Card {
  readonly id: string;
  readonly name: CardName;
  readonly suit?: Suit;
  readonly rank?: number;
}

export type CardType = 'basic' | 'trick' | 'equip';
export type EquipSlot = 'weapon' | 'armor' | 'horsePlus' | 'horseMinus';

export interface CardDef {
  type: CardType;
  /** 延时锦囊（乐不思蜀/闪电）：使用后进入判定区。 */
  delayed?: boolean;
  equipSlot?: EquipSlot;
  /** 武器攻击范围。 */
  range?: number;
}

export const CARD_DEFS: Record<CardName, CardDef> = {
  sha: { type: 'basic' },
  shan: { type: 'basic' },
  tao: { type: 'basic' },
  juedou: { type: 'trick' },
  guohe: { type: 'trick' },
  shunshou: { type: 'trick' },
  wuzhong: { type: 'trick' },
  nanman: { type: 'trick' },
  wanjian: { type: 'trick' },
  taoyuan: { type: 'trick' },
  wugu: { type: 'trick' },
  jiedao: { type: 'trick' },
  wuxie: { type: 'trick' },
  lebu: { type: 'trick', delayed: true },
  shandian: { type: 'trick', delayed: true },
  zhuge: { type: 'equip', equipSlot: 'weapon', range: 1 },
  cixiong: { type: 'equip', equipSlot: 'weapon', range: 2 },
  qinggang: { type: 'equip', equipSlot: 'weapon', range: 2 },
  qinglong: { type: 'equip', equipSlot: 'weapon', range: 3 },
  zhangba: { type: 'equip', equipSlot: 'weapon', range: 3 },
  guanshi: { type: 'equip', equipSlot: 'weapon', range: 3 },
  fangtian: { type: 'equip', equipSlot: 'weapon', range: 4 },
  qilin: { type: 'equip', equipSlot: 'weapon', range: 5 },
  hanbing: { type: 'equip', equipSlot: 'weapon', range: 2 },
  bagua: { type: 'equip', equipSlot: 'armor' },
  renwang: { type: 'equip', equipSlot: 'armor' },
  jueying: { type: 'equip', equipSlot: 'horsePlus' },
  dilu: { type: 'equip', equipSlot: 'horsePlus' },
  zhuahuang: { type: 'equip', equipSlot: 'horsePlus' },
  chitu: { type: 'equip', equipSlot: 'horseMinus' },
  dawan: { type: 'equip', equipSlot: 'horseMinus' },
  zixin: { type: 'equip', equipSlot: 'horseMinus' },
};

export const CARD_LABEL: Record<CardName, string> = {
  sha: '【杀】',
  shan: '【闪】',
  tao: '【桃】',
  juedou: '【决斗】',
  guohe: '【过河拆桥】',
  shunshou: '【顺手牵羊】',
  wuzhong: '【无中生有】',
  nanman: '【南蛮入侵】',
  wanjian: '【万箭齐发】',
  taoyuan: '【桃园结义】',
  wugu: '【五谷丰登】',
  jiedao: '【借刀杀人】',
  wuxie: '【无懈可击】',
  lebu: '【乐不思蜀】',
  shandian: '【闪电】',
  zhuge: '【诸葛连弩】',
  cixiong: '【雌雄双股剑】',
  qinggang: '【青釭剑】',
  qinglong: '【青龙偃月刀】',
  zhangba: '【丈八蛇矛】',
  guanshi: '【贯石斧】',
  fangtian: '【方天画戟】',
  qilin: '【麒麟弓】',
  hanbing: '【寒冰剑】',
  bagua: '【八卦阵】',
  renwang: '【仁王盾】',
  jueying: '【绝影】',
  dilu: '【的卢】',
  zhuahuang: '【爪黄飞电】',
  chitu: '【赤兔】',
  dawan: '【大宛】',
  zixin: '【紫骍】',
};

export const SUIT_LABEL: Record<Suit, string> = {
  spade: '黑桃',
  heart: '红桃',
  club: '梅花',
  diamond: '方块',
};

/** 带花色点数的牌的展示名，如 "【杀】黑桃7"。 */
export function cardText(card: Card): string {
  const base = CARD_LABEL[card.name];
  return card.suit && card.rank ? `${base}${SUIT_LABEL[card.suit]}${card.rank}` : base;
}

export function isRed(card: Card): boolean {
  return card.suit === 'heart' || card.suit === 'diamond';
}

export function isBlack(card: Card): boolean {
  return card.suit === 'spade' || card.suit === 'club';
}

let cardSeq = 0;

export function makeCard(
  name: CardName,
  opts: { id?: string; suit?: Suit; rank?: number } = {},
): Card {
  return { id: opts.id ?? `card-${++cardSeq}`, name, suit: opts.suit, rank: opts.rank };
}

/** mulberry32 PRNG：同种子序列可复现。 */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 牌堆抽象：只暴露 draw()，方便换成真实 108 张牌堆或测试用的脚本牌堆。
 * 有限牌堆可选实现 bindDiscard()：由 Game 注入弃牌堆引用，摸空时洗回。
 * 可选实现 putBackTop/putBackBottom（观星把牌放回牌堆顶/底）；
 * 无限/随机牌堆没有"顶/底"概念，不实现时观星自动退化为不发动。
 */
export interface Deck {
  draw(): Card;
  bindDiscard?(discard: Card[]): void;
  /** 把牌按序放回牌堆顶：cards[0] 在最上面，下次 draw 先摸到。 */
  putBackTop?(cards: Card[]): void;
  /** 把牌按序放到牌堆底（cards[0] 更靠上）。 */
  putBackBottom?(cards: Card[]): void;
}

/**
 * MVP 无限牌堆：按给定模式循环发牌，永远摸不空。
 * 默认模式 ['sha', 'shan', 'tao']。
 */
export class InfiniteDeck implements Deck {
  private index = 0;

  constructor(private readonly pattern: CardName[] = ['sha', 'shan', 'tao']) {
    if (pattern.length === 0) throw new Error('InfiniteDeck pattern must not be empty');
  }

  draw(): Card {
    const name = this.pattern[this.index % this.pattern.length];
    this.index++;
    return makeCard(name);
  }
}

/**
 * 带种子的随机无限牌堆：每张牌按权重独立随机抽取。
 * 同种子结果可复现，适合 demo 和测试。
 */
export class RandomDeck implements Deck {
  private readonly next: () => number;

  constructor(
    seed = 42,
    private readonly weights: [CardName, number][] = [
      ['sha', 0.5],
      ['shan', 0.25],
      ['tao', 0.25],
    ],
  ) {
    this.next = mulberry32(seed);
  }

  draw(): Card {
    const r = this.next();
    let acc = 0;
    for (const [name, w] of this.weights) {
      acc += w;
      if (r < acc) return makeCard(name);
    }
    return makeCard(this.weights[this.weights.length - 1][0]);
  }
}

/**
 * 脚本牌堆（测试工具）：按给定顺序发牌，发完后从头循环。
 * 用于精确控制判定牌 / 起手牌。
 */
export class ScriptDeck implements Deck {
  private index = 0;

  constructor(private readonly cards: Card[]) {
    if (cards.length === 0) throw new Error('ScriptDeck must not be empty');
  }

  draw(): Card {
    const card = this.cards[this.index % this.cards.length];
    this.index++;
    return card;
  }

  /** 观星放回牌堆顶：插入到当前摸牌位置，下一张先摸到 cards[0]。 */
  putBackTop(cards: Card[]): void {
    this.cards.splice(this.index % this.cards.length, 0, ...cards);
  }

  /** 观星放到牌堆底：脚本牌堆是循环的，"底"即追加到序列末尾。 */
  putBackBottom(cards: Card[]): void {
    this.cards.push(...cards);
  }
}

/**
 * 标准版 108 张牌堆：按 STANDARD_CARDS 构成 + 种子洗牌（Fisher-Yates）。
 * 摸空时把弃牌堆洗回牌堆（官方规则）；弃牌堆由 Game 通过 bindDiscard 注入。
 */
export class Standard108Deck implements Deck {
  private pile: Card[];
  private discard: Card[] = [];
  private readonly rand: () => number;
  /** 已发生的"摸空重洗"次数，供测试/观察。 */
  reshuffleCount = 0;

  constructor(seed = 42) {
    this.rand = mulberry32(seed);
    this.pile = buildStandard108Cards();
    this.shuffle(this.pile);
  }

  bindDiscard(discard: Card[]): void {
    this.discard = discard;
  }

  get remaining(): number {
    return this.pile.length;
  }

  /** 观星放回牌堆顶（cards[0] 在最上面）。 */
  putBackTop(cards: Card[]): void {
    this.pile.unshift(...cards);
  }

  /** 观星放到牌堆底。 */
  putBackBottom(cards: Card[]): void {
    this.pile.push(...cards);
  }

  draw(): Card {
    if (this.pile.length === 0) {
      if (this.discard.length === 0) throw new Error('牌堆与弃牌堆均为空，无法摸牌');
      this.pile = this.discard.splice(0, this.discard.length);
      this.shuffle(this.pile);
      this.reshuffleCount++;
    }
    return this.pile.shift()!;
  }

  private shuffle(cards: Card[]): void {
    for (let i = cards.length - 1; i > 0; i--) {
      const j = Math.floor(this.rand() * (i + 1));
      [cards[i], cards[j]] = [cards[j], cards[i]];
    }
  }
}

/** 按标准版构成展开成 108 张牌。 */
export function buildStandard108Cards(): Card[] {
  const cards: Card[] = [];
  for (const entry of STANDARD_CARDS) {
    for (const text of entry.suitsDistribution) {
      const { suit, rank } = parseSuitRank(text);
      cards.push(makeCard(entry.id as CardName, { suit, rank }));
    }
  }
  return cards;
}
