/**
 * Phaser UI 小组件：纯色按钮 / 卡牌视图。不找美术素材，全部用 Graphics + Text 画。
 */

import Phaser from 'phaser';
import { CARD_LABEL, cardColor, cardTypeOf, suitRankText, type Card } from '../core/vm.js';
import { CARD_H, CARD_W } from './card-size.js';

export { CARD_W, CARD_H };

const TYPE_BG: Record<string, number> = {
  basic: 0xf5eeda, // 基本牌：米白
  trick: 0xdfe9d2, // 锦囊：淡绿
  equip: 0xd7e3f4, // 装备：淡蓝
};

const COLOR_TEXT: Record<string, string> = {
  red: '#a31515',
  black: '#1d1d1d',
  none: '#555555',
};

export interface ButtonOptions {
  width?: number;
  height?: number;
  fontSize?: number;
  enabled?: boolean;
  color?: number;
  onClick?: () => void;
}

export interface Button {
  container: Phaser.GameObjects.Container;
  setEnabled(enabled: boolean): void;
  setLabel(label: string): void;
}

/** 纯色矩形按钮；禁用时变灰且不响应点击。 */
export function makeButton(scene: Phaser.Scene, x: number, y: number, label: string, opts: ButtonOptions = {}): Button {
  const width = opts.width ?? 110;
  const height = opts.height ?? 44; // ≥44px 触屏热区
  const baseColor = opts.color ?? 0x8a6d3b;
  let enabled = opts.enabled ?? true;

  const bg = scene.add.rectangle(0, 0, width, height, enabled ? baseColor : 0x444444).setStrokeStyle(1, 0x000000);
  const text = scene.add
    .text(0, 0, label, { fontSize: `${opts.fontSize ?? 15}px`, color: '#ffffff' })
    .setOrigin(0.5);
  const container = scene.add.container(x, y, [bg, text]);
  container.setSize(width, height);
  container.setInteractive({ useHandCursor: true });
  container.on('pointerup', () => {
    if (enabled) opts.onClick?.();
  });

  const redraw = () => {
    bg.setFillStyle(enabled ? baseColor : 0x444444);
  };

  return {
    container,
    setEnabled(next: boolean) {
      enabled = next;
      redraw();
    },
    setLabel(next: string) {
      text.setText(next);
    },
  };
}

export interface CardViewOptions {
  /** 牌背（对手手牌/牌堆）。 */
  faceDown?: boolean;
  /** 高亮边框（可出/已选）。 */
  highlight?: number;
  /** 右上角角标（如"当作【闪】"）。 */
  badge?: string;
  scale?: number;
  onClick?: () => void;
}

/** 牌面：纯色底 + 名称 + 花色点数；红黑用文字颜色区分，类型用底色区分。 */
export function makeCardView(
  scene: Phaser.Scene,
  x: number,
  y: number,
  card: Card,
  opts: CardViewOptions = {},
): Phaser.GameObjects.Container {
  const children: Phaser.GameObjects.GameObject[] = [];

  const bg = scene.add.rectangle(0, 0, CARD_W, CARD_H, TYPE_BG[cardTypeOf(card.name)]).setStrokeStyle(1, 0x333333);
  children.push(bg);

  if (opts.faceDown) {
    bg.setFillStyle(0x39415a);
    const back = scene.add.text(0, 0, '三国杀', { fontSize: '18px', color: '#8892b0' }).setOrigin(0.5);
    children.push(back);
  } else {
    const color = COLOR_TEXT[cardColor(card)];
    const label = CARD_LABEL[card.name].replace(/[【】]/g, '');
    const nameText = scene.add
      .text(0, -CARD_H / 2 + 14, label, {
        fontSize: label.length > 3 ? '14px' : '18px',
        color,
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    const suitText = scene.add
      .text(-CARD_W / 2 + 6, -CARD_H / 2 + 34, suitRankText(card), { fontSize: '16px', color })
      .setOrigin(0, 0);
    children.push(nameText, suitText);
  }

  if (opts.badge) {
    const badgeBg = scene.add.rectangle(0, CARD_H / 2 - 12, CARD_W - 8, 20, 0xc9a227);
    const badgeText = scene.add
      .text(0, CARD_H / 2 - 12, opts.badge, { fontSize: '12px', color: '#201a00' })
      .setOrigin(0.5);
    children.push(badgeBg, badgeText);
  }

  if (opts.highlight !== undefined) {
    const frame = scene.add.rectangle(0, 0, CARD_W + 6, CARD_H + 6).setStrokeStyle(3, opts.highlight);
    children.push(frame);
  }

  const container = scene.add.container(x, y, children);
  container.setSize(CARD_W, CARD_H);
  if (opts.scale) container.setScale(opts.scale);
  if (opts.onClick) {
    container.setInteractive({ useHandCursor: true });
    container.on('pointerup', opts.onClick);
  }
  return container;
}

/** 装备/判定区的小字条。 */
export function makeChip(
  scene: Phaser.Scene,
  x: number,
  y: number,
  label: string,
  opts: { width?: number; color?: number; fontSize?: number } = {},
): Phaser.GameObjects.Container {
  const width = opts.width ?? 40;
  const bg = scene.add.rectangle(0, 0, width, 22, opts.color ?? 0x2c3444).setStrokeStyle(1, 0x111111);
  const text = scene.add
    .text(0, 0, label, { fontSize: `${opts.fontSize ?? 11}px`, color: '#cfd6e4' })
    .setOrigin(0.5);
  const container = scene.add.container(x, y, [bg, text]);
  container.setSize(width, 22);
  return container;
}
