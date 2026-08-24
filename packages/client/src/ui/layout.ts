/**
 * 牌桌响应式布局：所有坐标由实际画布宽高动态计算（Phaser Scale RESIZE）。
 *
 * 设计基准 1280x800（桌面体验与原硬编码布局一致）：
 * - s = min(w/1280, h/800) 为全局缩放基准；字号不随 s 缩小（手机上保持可读），
 *   牌面 / 对手面板按 s 缩放并设下限，避免小到点不中；
 * - 竖向位置全部按 h 的比例取，横向以 w 为中心排布；
 * - 手牌区先缩牌再压缩间距，间距有下限（保证触屏热区），
 *   超过一屏的极端手牌数由间距下限保证可点，牌面继续缩小。
 *
 * 本文件不依赖 Phaser，供场景、单测、e2e 三方共用同一份布局公式。
 */

import { CARD_H, CARD_W } from './card-size.js';

export const REF_W = 1280;
export const REF_H = 800;

/** 按钮/卡牌触屏热区下限（CSS px，≥44 的苹果 HIG 建议按下限取整）。 */
export const MIN_TOUCH = 44;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export interface TableLayout {
  w: number;
  h: number;
  /** 全局缩放基准 min(w/1280, h/800)。 */
  s: number;
  /** 手牌/牌堆牌面缩放。 */
  cardScale: number;
  /** 对手面板缩放（比牌面略大，保证文字可读）。 */
  panelScale: number;
  panelW: number;
  panelH: number;
  /** 顶部对手面板。 */
  opponents: { y: number; maxSpacing: number };
  /** 中部：牌堆/弃牌堆/回合/战报/五谷亮牌。 */
  center: {
    pileY: number;
    pileGapX: number;
    pileLabelY: number;
    pileScale: number;
    turnY: number;
    logX: number;
    logY: number;
    logLineH: number;
    chooseCardY: number;
    chooseCardSpan: number;
  };
  /** 中下操作区：提示 / 倒计时 / 按钮。 */
  ask: { promptY: number; countdownY: number; countdownW: number; buttonsY: number; buttonGap: number };
  /** 底部我的信息区与手牌。 */
  me: { x: number; y: number; chipGap: number; judgeGap: number };
  hand: { y: number; lift: number; reserveX: number };
  /** 身份牌横幅。 */
  role: { x: number; y: number; objectiveY: number; fontSize: number };
}

export function computeTableLayout(w: number, h: number): TableLayout {
  const s = Math.min(w / REF_W, h / REF_H);
  const cardScale = clamp(s, 0.45, 1);
  const panelScale = clamp(s * 1.2, 0.6, 1.1);
  const panelW = Math.round(188 * panelScale);
  const panelH = Math.round(176 * panelScale);

  return {
    w,
    h,
    s,
    cardScale,
    panelScale,
    panelW,
    panelH,
    opponents: {
      y: Math.round(h * 0.14),
      maxSpacing: Math.round(200 * Math.max(panelScale, 0.8)),
    },
    center: {
      pileY: Math.round(h * 0.3975),
      pileGapX: Math.round(90 * Math.max(s, 0.6)),
      pileLabelY: Math.round(h * 0.3975 + 68 * cardScale),
      pileScale: 0.7 * cardScale,
      turnY: Math.round(h * 0.3275),
      logX: Math.round(w - 308 * clamp(s, 0.6, 1)),
      logY: Math.round(h * 0.28),
      logLineH: 17,
      chooseCardY: Math.round(h * 0.4125),
      chooseCardSpan: Math.min(500, w * 0.5),
    },
    ask: {
      promptY: Math.round(h * 0.5975),
      countdownY: Math.round(h * 0.635),
      countdownW: Math.round(Math.min(600, w * 0.7)),
      buttonsY: Math.round(h * 0.685),
      buttonGap: 12,
    },
    me: {
      x: Math.round(Math.max(20, 30 * s)),
      y: Math.round(h * 0.7375),
      chipGap: Math.round(52 * Math.max(s, 0.7)),
      judgeGap: Math.round(62 * Math.max(s, 0.7)),
    },
    hand: {
      y: Math.round(h * 0.875),
      lift: Math.round(18 * cardScale),
      // 左侧留给「我的面板」的宽度；窄屏时压缩，让手牌区尽量宽
      reserveX: Math.round(clamp(320 * s, 90, 320)),
    },
    role: {
      x: Math.round(Math.max(20, 36 * s)),
      y: Math.round(h * 0.2825),
      objectiveY: Math.round(h * 0.2825 + 34),
      fontSize: 26,
    },
  };
}

/** 竖屏判定：牌桌为横屏设计，h > w 时显示旋转提示。 */
export function isPortrait(w: number, h: number): boolean {
  return h > w;
}

export interface HandStrip {
  spacing: number;
  startX: number;
  scale: number;
}

/**
 * 手牌横排：先按可用宽度缩牌（下限 0.45），再压缩间距（下限保证触屏热区）。
 * 牌太多时允许轻微超出 reserveX——手牌比「我的面板」更靠下，视觉重叠可接受。
 */
export function computeHandStrip(count: number, layout: TableLayout): HandStrip {
  const { w } = layout;
  const available = Math.max(160, w - layout.hand.reserveX);
  // 需要多少缩放才能让 n 张牌以完整牌宽+间隙排进可用宽度
  const needW = count * (CARD_W + 12);
  const scale = clamp(Math.min(layout.cardScale, (available * layout.cardScale) / Math.max(needW, 1)), 0.4, 1);
  const cardW = CARD_W * scale;
  let spacing = count > 1 ? Math.min(cardW + 12 * scale, (available - cardW) / (count - 1)) : 0;
  // 触屏热区下限：相邻牌中心距不要太小（可点的露出条宽度）
  spacing = Math.max(spacing, Math.min(MIN_TOUCH, cardW * 0.6));
  const startX = w / 2 - ((count - 1) * spacing) / 2;
  return { spacing, startX, scale };
}

/** 对手横排间距。 */
export function computeOpponentSpacing(count: number, layout: TableLayout): number {
  return Math.min(layout.opponents.maxSpacing, (layout.w - 60) / Math.max(count, 1));
}

/** 按钮排间距（按按钮宽度自适应，窄屏压缩）。 */
export function computeButtonSpacing(count: number, buttonW: number, layout: TableLayout): number {
  if (count <= 1) return 0;
  return Math.min(buttonW + layout.ask.buttonGap, (layout.w - 24) / count);
}

export { CARD_W, CARD_H };
