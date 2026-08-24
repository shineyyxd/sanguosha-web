/**
 * 身份局：主公 / 忠臣 / 反贼 / 内奸。
 *
 * 人数配置（官方标准）：
 * - 4 人 = 1 主 1 忠 2 反；
 * - 5 人 = 1 主 1 忠 2 反 1 内；
 * - 6 人 = 1 主 1 忠 3 反 1 内；
 * - 7 人 = 1 主 2 忠 3 反 1 内；
 * - 8 人 = 1 主 2 忠 4 反 1 内。
 *
 * 胜负（Game.checkVictory 实现）：
 * - 主公死：场上只剩内奸存活 → 内奸胜，否则反贼胜；
 * - 反贼与内奸全灭：主公方（主 + 忠）胜。
 */

export type Role = 'lord' | 'loyalist' | 'rebel' | 'renegade';

export const ROLE_LABEL: Record<Role, string> = {
  lord: '主公',
  loyalist: '忠臣',
  rebel: '反贼',
  renegade: '内奸',
};

/** 各身份的获胜条件一句话（客户端提示 / role:assign 下发用）。 */
export const ROLE_OBJECTIVE: Record<Role, string> = {
  lord: '获胜条件：消灭所有反贼和内奸。',
  loyalist: '获胜条件：保护主公，消灭所有反贼和内奸。',
  rebel: '获胜条件：杀死主公。',
  renegade: '获胜条件：先消灭其他人，最后杀死主公，成为唯一的幸存者。',
};

/** 身份局最少人数（少于 4 人走 1v1 对决，不分配身份）。 */
export const IDENTITY_MIN_PLAYERS = 4;

/**
 * 返回 count 人身份局的标准身份配置（顺序未定，调用方负责洗牌/指定座位）。
 * count < 4 抛错（不支持身份局）。
 */
export function roleConfigFor(count: number): Role[] {
  switch (count) {
    case 4:
      return ['lord', 'loyalist', 'rebel', 'rebel'];
    case 5:
      return ['lord', 'loyalist', 'rebel', 'rebel', 'renegade'];
    case 6:
      return ['lord', 'loyalist', 'rebel', 'rebel', 'rebel', 'renegade'];
    case 7:
      return ['lord', 'loyalist', 'loyalist', 'rebel', 'rebel', 'rebel', 'renegade'];
    case 8:
      return ['lord', 'loyalist', 'loyalist', 'rebel', 'rebel', 'rebel', 'rebel', 'renegade'];
    default:
      throw new Error(`身份局需要 4~8 人，当前 ${count} 人`);
  }
}
