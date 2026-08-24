/**
 * 标准版武将数据（事实数据，来自 data/reference/standard-generals.json）。
 * 技能描述为官方原文；技能实现见 src/skills.ts（已实现 20 个武将）。
 */

export type Kingdom = 'wei' | 'shu' | 'wu' | 'qun';

export type Gender = 'male' | 'female';

export interface GeneralSkillData {
  id: string;
  name: string;
  description: string;
}

export interface GeneralData {
  id: string;
  name: string;
  kingdom: Kingdom;
  /** 性别（雌雄双股剑/离间/结姻等技能的判定依据）。 */
  gender: Gender;
  hp: number;
  skills: GeneralSkillData[];
}

export const STANDARD_GENERALS: GeneralData[] = [
  {
    id: 'caocao', name: '曹操', kingdom: 'wei', gender: 'male', hp: 4,
    skills: [
      { id: 'jianxiong', name: '奸雄', description: '当你受到伤害后，你可以获得对你造成伤害的牌。' },
      { id: 'hujia', name: '护驾', description: '主公技，当你需要使用或打出一张【闪】时，你可以令其他魏势力角色选择是否打出一张【闪】。若有角色响应，则你视为使用或打出了一张【闪】。' },
    ],
  },
  {
    id: 'simayi', name: '司马懿', kingdom: 'wei', gender: 'male', hp: 3,
    skills: [
      { id: 'fankui', name: '反馈', description: '当你受到伤害后，你可以获得伤害来源的一张牌。' },
      { id: 'guicai', name: '鬼才', description: '一名角色的判定牌生效前，你可以打出一张手牌代替之。' },
    ],
  },
  {
    id: 'xiahoudun', name: '夏侯惇', kingdom: 'wei', gender: 'male', hp: 4,
    skills: [
      { id: 'ganglie', name: '刚烈', description: '当你受到伤害后，你可以判定。若结果不为红桃，则伤害来源须弃置两张手牌，否则其受到来自你的1点伤害。' },
    ],
  },
  {
    id: 'zhangliao', name: '张辽', kingdom: 'wei', gender: 'male', hp: 4,
    skills: [
      { id: 'tuxi', name: '突袭', description: '摸牌阶段，你可以改为获得至多两名其他角色的各一张手牌。' },
    ],
  },
  {
    id: 'xuzhu', name: '许褚', kingdom: 'wei', gender: 'male', hp: 4,
    skills: [
      { id: 'luoyi', name: '裸衣', description: '摸牌阶段，你可以少摸一张牌。若如此做，当你本回合内使用【杀】或【决斗】造成伤害时，此伤害+1。' },
    ],
  },
  {
    id: 'guojia', name: '郭嘉', kingdom: 'wei', gender: 'male', hp: 3,
    skills: [
      { id: 'tiandu', name: '天妒', description: '当你的判定牌生效后，你可以获得之。' },
      { id: 'yiji', name: '遗计', description: '当你受到1点伤害后，你可以观看牌堆顶的两张牌，然后将其分配给任意角色。' },
    ],
  },
  {
    id: 'zhenji', name: '甄姬', kingdom: 'wei', gender: 'female', hp: 3,
    skills: [
      { id: 'luoshen', name: '洛神', description: '准备阶段，你可以判定。若结果为黑色，你获得判定牌。你可重复此流程，直到出现红色的判定结果。' },
      { id: 'qingguo', name: '倾国', description: '你可以将一张黑色手牌当做【闪】使用或打出。' },
    ],
  },
  {
    id: 'liubei', name: '刘备', kingdom: 'shu', gender: 'male', hp: 4,
    skills: [
      { id: 'rende', name: '仁德', description: '出牌阶段，你可以将任意张手牌交给其他角色。当你以此法于一回合内给出第二张牌时，你回复1点体力。' },
      { id: 'jijiang', name: '激将', description: '主公技，当你需要使用或打出【杀】时，你可以令其他蜀势力角色依次选择是否打出一张【杀】。若有角色响应，则你视为使用或打出了此【杀】。' },
    ],
  },
  {
    id: 'guanyu', name: '关羽', kingdom: 'shu', gender: 'male', hp: 4,
    skills: [
      { id: 'wusheng', name: '武圣', description: '你可以将一张红色牌当做【杀】使用或打出。' },
    ],
  },
  {
    id: 'zhangfei', name: '张飞', kingdom: 'shu', gender: 'male', hp: 4,
    skills: [
      { id: 'paoxiao', name: '咆哮', description: '锁定技，出牌阶段，你使用【杀】没有数量限制。' },
    ],
  },
  {
    id: 'zhugeliang', name: '诸葛亮', kingdom: 'shu', gender: 'male', hp: 3,
    skills: [
      { id: 'guanxing', name: '观星', description: '准备阶段，你可以观看牌堆顶的X张牌，并将其以任意顺序置于牌堆顶或牌堆底。（X为存活角色数且至多为5）' },
      { id: 'kongcheng', name: '空城', description: '锁定技，当你没有手牌时，你不能成为【杀】或【决斗】的目标。' },
    ],
  },
  {
    id: 'zhaoyun', name: '赵云', kingdom: 'shu', gender: 'male', hp: 4,
    skills: [
      { id: 'longdan', name: '龙胆', description: '你可以将【杀】当做【闪】，或将【闪】当做【杀】使用或打出。' },
    ],
  },
  {
    id: 'machao', name: '马超', kingdom: 'shu', gender: 'male', hp: 4,
    skills: [
      { id: 'mashu', name: '马术', description: '锁定技，你计算与其他角色的距离时-1。' },
      { id: 'tieji', name: '铁骑', description: '当你使用【杀】指定目标后，你可以进行判定。若结果为红色，则此【杀】不可被闪避。' },
    ],
  },
  {
    id: 'huangyueying', name: '黄月英', kingdom: 'shu', gender: 'female', hp: 3,
    skills: [
      { id: 'jizhi', name: '集智', description: '当你使用普通锦囊牌时，你可以摸一张牌。' },
      { id: 'qicai', name: '奇才', description: '锁定技，你使用锦囊牌无距离限制。' },
    ],
  },
  {
    id: 'sunquan', name: '孙权', kingdom: 'wu', gender: 'male', hp: 4,
    skills: [
      { id: 'zhiheng', name: '制衡', description: '出牌阶段限一次，你可以弃置任意张牌，然后摸等量的牌。' },
      { id: 'jiuyuan', name: '救援', description: '主公技，锁定技，其他吴势力角色对你使用的【桃】的回复值+1。' },
    ],
  },
  {
    id: 'ganning', name: '甘宁', kingdom: 'wu', gender: 'male', hp: 4,
    skills: [
      { id: 'qixi', name: '奇袭', description: '你可以将一张黑色牌当做【过河拆桥】使用。' },
    ],
  },
  {
    id: 'lvmeng', name: '吕蒙', kingdom: 'wu', gender: 'male', hp: 4,
    skills: [
      { id: 'keji', name: '克己', description: '弃牌阶段开始时，若你于本回合的出牌阶段内没有使用或打出过【杀】，则你可以跳过此阶段。' },
    ],
  },
  {
    id: 'huanggai', name: '黄盖', kingdom: 'wu', gender: 'male', hp: 4,
    skills: [
      { id: 'kurou', name: '苦肉', description: '出牌阶段，你可以失去1点体力，然后摸两张牌。' },
    ],
  },
  {
    id: 'zhouyu', name: '周瑜', kingdom: 'wu', gender: 'male', hp: 3,
    skills: [
      { id: 'yingzi', name: '英姿', description: '摸牌阶段，你可以多摸一张牌。' },
      { id: 'fanjian', name: '反间', description: '出牌阶段限一次。你可以令一名角色选择一种花色，然后其获得你的一张手牌。若其以此法选择的花色与其得到的牌花色不同，则你对其造成1点伤害。' },
    ],
  },
  {
    id: 'daqiao', name: '大乔', kingdom: 'wu', gender: 'female', hp: 3,
    skills: [
      { id: 'guose', name: '国色', description: '你可以将一张方片牌当做【乐不思蜀】使用。' },
      { id: 'liuli', name: '流离', description: '当你成为【杀】的目标时，你可以弃置一张牌并将此【杀】转移给攻击范围内的一名其他角色（不能是此【杀】的使用者）。' },
    ],
  },
  {
    id: 'luxun', name: '陆逊', kingdom: 'wu', gender: 'male', hp: 3,
    skills: [
      { id: 'qianxun', name: '谦逊', description: '锁定技，你不能成为【顺手牵羊】和【乐不思蜀】的目标。' },
      { id: 'lianying', name: '连营', description: '当你失去最后的手牌时，你可以摸一张牌。' },
    ],
  },
  {
    id: 'sunshangxiang', name: '孙尚香', kingdom: 'wu', gender: 'female', hp: 3,
    skills: [
      { id: 'xiaoji', name: '枭姬', description: '当你失去一张装备区内的牌后，你可以摸两张牌。' },
      { id: 'jieyin', name: '结姻', description: '出牌阶段限一次，你可以弃置两张手牌并选择一名已经受伤的男性角色。你与其各回复1点体力。' },
    ],
  },
  {
    id: 'huatuo', name: '华佗', kingdom: 'qun', gender: 'male', hp: 3,
    skills: [
      { id: 'qingnang', name: '青囊', description: '出牌阶段限一次，你可以弃置一张手牌并令一名角色回复1点体力。' },
      { id: 'jijiu', name: '急救', description: '你的回合外，你可以将一张红色牌当做【桃】使用。' },
    ],
  },
  {
    id: 'lvbu', name: '吕布', kingdom: 'qun', gender: 'male', hp: 4,
    skills: [
      { id: 'wushuang', name: '无双', description: '锁定技，①当你使用【杀】指定一名角色为目标后，其需使用两张【闪】才能抵消；②当你使用【决斗】指定其他角色为目标后，或成为其他角色使用【决斗】的目标后，其每次响应需打出两张【杀】。' },
    ],
  },
  {
    id: 'diaochan', name: '貂蝉', kingdom: 'qun', gender: 'female', hp: 3,
    skills: [
      { id: 'lijian', name: '离间', description: '出牌阶段限一次，你可以弃置一张牌，视为一名男性角色对另一名男性角色使用一张【决斗】（不可被【无懈可击】响应）。' },
      { id: 'biyue', name: '闭月', description: '结束阶段，你可以摸一张牌。' },
    ],
  },
];
