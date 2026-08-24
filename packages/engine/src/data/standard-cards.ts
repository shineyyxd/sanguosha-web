/**
 * 标准版卡牌数据（事实数据，来自 data/reference/standard-cards.json）。
 * 牌堆共 108 张（含 EX 牌寒冰剑/仁王盾）；suitsDistribution 为每张牌的花色点数构成
 * （A=1, J=11, Q=12, K=13）。
 */

export type SuitName = 'spade' | 'heart' | 'club' | 'diamond';

export interface StandardCardEntry {
  id: string;
  name: string;
  type: 'basic' | 'trick' | 'equip';
  subtype?: 'delay' | 'weapon' | 'armor' | 'horse_plus' | 'horse_minus';
  count: number;
  suitsDistribution: string[]; // 如 "黑桃7"、"方块13"
}

export const STANDARD_CARDS: StandardCardEntry[] = [
  {
    id: 'sha', name: '杀', type: 'basic', count: 30,
    suitsDistribution: [
      '黑桃7', '黑桃8', '黑桃8', '黑桃9', '黑桃9', '黑桃10', '黑桃10',
      '梅花2', '梅花3', '梅花4', '梅花5', '梅花6', '梅花7', '梅花8', '梅花8',
      '梅花9', '梅花9', '梅花10', '梅花10', '梅花11', '梅花11',
      '红桃10', '红桃10', '红桃11', '方块6', '方块7', '方块8', '方块9', '方块10', '方块13',
    ],
  },
  {
    id: 'shan', name: '闪', type: 'basic', count: 15,
    suitsDistribution: [
      '红桃2', '红桃2', '红桃13',
      '方块2', '方块2', '方块3', '方块4', '方块5', '方块6', '方块7', '方块8',
      '方块9', '方块10', '方块11', '方块11',
    ],
  },
  {
    id: 'tao', name: '桃', type: 'basic', count: 8,
    suitsDistribution: ['红桃3', '红桃4', '红桃6', '红桃7', '红桃8', '红桃9', '红桃12', '方块12'],
  },
  { id: 'juedou', name: '决斗', type: 'trick', count: 3, suitsDistribution: ['黑桃1', '梅花1', '方块1'] },
  {
    id: 'guohe', name: '过河拆桥', type: 'trick', count: 6,
    suitsDistribution: ['黑桃3', '黑桃4', '黑桃12', '梅花3', '梅花4', '红桃12'],
  },
  {
    id: 'shunshou', name: '顺手牵羊', type: 'trick', count: 5,
    suitsDistribution: ['黑桃3', '黑桃4', '黑桃11', '方块3', '方块4'],
  },
  {
    id: 'wuzhong', name: '无中生有', type: 'trick', count: 4,
    suitsDistribution: ['红桃7', '红桃8', '红桃9', '红桃11'],
  },
  {
    id: 'nanman', name: '南蛮入侵', type: 'trick', count: 3,
    suitsDistribution: ['黑桃7', '黑桃13', '梅花7'],
  },
  { id: 'wanjian', name: '万箭齐发', type: 'trick', count: 1, suitsDistribution: ['红桃1'] },
  { id: 'taoyuan', name: '桃园结义', type: 'trick', count: 1, suitsDistribution: ['红桃1'] },
  { id: 'wugu', name: '五谷丰登', type: 'trick', count: 2, suitsDistribution: ['红桃3', '红桃4'] },
  {
    id: 'jiedao', name: '借刀杀人', type: 'trick', count: 2,
    suitsDistribution: ['梅花12', '梅花13'],
  },
  {
    id: 'wuxie', name: '无懈可击', type: 'trick', count: 4,
    suitsDistribution: ['黑桃11', '梅花12', '梅花13', '方块12'],
  },
  {
    id: 'lebu', name: '乐不思蜀', type: 'trick', subtype: 'delay', count: 3,
    suitsDistribution: ['黑桃6', '梅花6', '红桃6'],
  },
  {
    id: 'shandian', name: '闪电', type: 'trick', subtype: 'delay', count: 2,
    suitsDistribution: ['黑桃1', '红桃12'],
  },
  {
    id: 'zhuge', name: '诸葛连弩', type: 'equip', subtype: 'weapon', count: 2,
    suitsDistribution: ['梅花1', '方块1'],
  },
  { id: 'cixiong', name: '雌雄双股剑', type: 'equip', subtype: 'weapon', count: 1, suitsDistribution: ['黑桃2'] },
  { id: 'qinggang', name: '青釭剑', type: 'equip', subtype: 'weapon', count: 1, suitsDistribution: ['黑桃6'] },
  { id: 'qinglong', name: '青龙偃月刀', type: 'equip', subtype: 'weapon', count: 1, suitsDistribution: ['黑桃5'] },
  { id: 'zhangba', name: '丈八蛇矛', type: 'equip', subtype: 'weapon', count: 1, suitsDistribution: ['黑桃12'] },
  { id: 'guanshi', name: '贯石斧', type: 'equip', subtype: 'weapon', count: 1, suitsDistribution: ['方块5'] },
  { id: 'fangtian', name: '方天画戟', type: 'equip', subtype: 'weapon', count: 1, suitsDistribution: ['方块12'] },
  { id: 'qilin', name: '麒麟弓', type: 'equip', subtype: 'weapon', count: 1, suitsDistribution: ['红桃5'] },
  { id: 'hanbing', name: '寒冰剑', type: 'equip', subtype: 'weapon', count: 1, suitsDistribution: ['黑桃2'] },
  {
    id: 'bagua', name: '八卦阵', type: 'equip', subtype: 'armor', count: 2,
    suitsDistribution: ['黑桃2', '梅花2'],
  },
  { id: 'renwang', name: '仁王盾', type: 'equip', subtype: 'armor', count: 1, suitsDistribution: ['梅花2'] },
  { id: 'jueying', name: '绝影', type: 'equip', subtype: 'horse_plus', count: 1, suitsDistribution: ['黑桃5'] },
  { id: 'dilu', name: '的卢', type: 'equip', subtype: 'horse_plus', count: 1, suitsDistribution: ['梅花5'] },
  {
    id: 'zhuahuang', name: '爪黄飞电', type: 'equip', subtype: 'horse_plus', count: 1,
    suitsDistribution: ['红桃13'],
  },
  { id: 'chitu', name: '赤兔', type: 'equip', subtype: 'horse_minus', count: 1, suitsDistribution: ['红桃5'] },
  { id: 'dawan', name: '大宛', type: 'equip', subtype: 'horse_minus', count: 1, suitsDistribution: ['黑桃13'] },
  { id: 'zixin', name: '紫骍', type: 'equip', subtype: 'horse_minus', count: 1, suitsDistribution: ['方块13'] },
];

const SUIT_PARSE: Record<string, SuitName> = {
  黑桃: 'spade',
  红桃: 'heart',
  梅花: 'club',
  方块: 'diamond',
};

/** 解析 "黑桃7" → { suit: 'spade', rank: 7 }。 */
export function parseSuitRank(text: string): { suit: SuitName; rank: number } {
  const suit = SUIT_PARSE[text.slice(0, 2)];
  if (!suit) throw new Error(`unknown suit in "${text}"`);
  const rank = Number(text.slice(2));
  if (!Number.isInteger(rank) || rank < 1 || rank > 13) {
    throw new Error(`bad rank in "${text}"`);
  }
  return { suit, rank };
}
