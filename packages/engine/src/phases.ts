/**
 * 阶段机：回合 = 判定 → 摸牌 → 出牌 → 弃牌 → 结束。
 * 判定阶段处理判定区里的延时锦囊（乐不思蜀/闪电，见 game.ts judgePhase）。
 */

export const PHASE_ORDER = ['judge', 'draw', 'play', 'discard', 'finish'] as const;

export type PhaseId = (typeof PHASE_ORDER)[number];

export const PHASE_LABEL: Record<PhaseId, string> = {
  judge: '判定阶段',
  draw: '摸牌阶段',
  play: '出牌阶段',
  discard: '弃牌阶段',
  finish: '结束阶段',
};
