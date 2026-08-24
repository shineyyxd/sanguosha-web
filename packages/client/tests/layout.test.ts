/**
 * 响应式布局公式单测：桌面基准一致性 + 手机窄屏可行性 + 竖屏判定。
 */

import { describe, expect, it } from 'vitest';
import {
  CARD_W,
  MIN_TOUCH,
  computeButtonSpacing,
  computeHandStrip,
  computeOpponentSpacing,
  computeTableLayout,
  isPortrait,
} from '../src/ui/layout.js';

describe('computeTableLayout', () => {
  it('桌面基准 1280x800 与原硬编码布局一致', () => {
    const L = computeTableLayout(1280, 800);
    expect(L.s).toBe(1);
    expect(L.opponents.y).toBe(112);
    expect(L.center.pileY).toBe(318);
    expect(L.ask.promptY).toBe(478);
    expect(L.ask.buttonsY).toBe(548);
    expect(L.me.y).toBe(590);
    expect(L.hand.y).toBe(700);
    expect(L.hand.reserveX).toBe(320);
    expect(L.center.logX).toBe(972);
  });

  it('手机横屏（844x390）：各区域都在画布内且不重叠出界', () => {
    const L = computeTableLayout(844, 390);
    expect(L.opponents.y - L.panelH / 2).toBeGreaterThanOrEqual(0);
    expect(L.hand.y + (132 * L.cardScale) / 2).toBeLessThanOrEqual(390);
    expect(L.ask.buttonsY).toBeLessThan(L.me.y);
    expect(L.ask.countdownW).toBeLessThanOrEqual(844 * 0.7 + 1);
    expect(L.center.logX).toBeLessThan(844);
  });

  it('竖屏判定', () => {
    expect(isPortrait(390, 844)).toBe(true);
    expect(isPortrait(844, 390)).toBe(false);
  });
});

describe('computeHandStrip', () => {
  it('少量手牌：完整牌宽间距、居中', () => {
    const L = computeTableLayout(1280, 800);
    const strip = computeHandStrip(4, L);
    expect(strip.scale).toBe(1);
    expect(strip.spacing).toBe(CARD_W + 12);
    expect(strip.startX + 3 * strip.spacing).toBe(1280 - strip.startX); // 居中
  });

  it('手牌超多时压缩间距但有触屏下限', () => {
    const L = computeTableLayout(1280, 800);
    const strip = computeHandStrip(20, L);
    expect(strip.spacing).toBeGreaterThanOrEqual(Math.min(MIN_TOUCH, CARD_W * strip.scale * 0.6) - 1e-9);
  });

  it('手机窄屏：缩小牌面，所有牌中心都在屏内', () => {
    const L = computeTableLayout(844, 390);
    const strip = computeHandStrip(10, L);
    expect(strip.scale).toBeLessThan(1);
    const lastX = strip.startX + 9 * strip.spacing;
    expect(strip.startX).toBeGreaterThan(0);
    expect(lastX).toBeLessThan(844);
  });
});

describe('computeOpponentSpacing / computeButtonSpacing', () => {
  it('对手间距随人数收窄，窄屏不出界', () => {
    const L = computeTableLayout(844, 390);
    const spacing = computeOpponentSpacing(6, L);
    expect(spacing * 5 + L.panelW).toBeLessThanOrEqual(844);
  });

  it('按钮间距：桌面宽松，手机收窄但排得下 5 个按钮', () => {
    expect(computeButtonSpacing(3, 110, computeTableLayout(1280, 800))).toBe(122);
    const L = computeTableLayout(844, 390);
    const spacing = computeButtonSpacing(5, 110, L);
    expect(spacing * 4 + 110).toBeLessThanOrEqual(844);
  });
});
