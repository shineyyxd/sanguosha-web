/**
 * 牌桌场景：对局主画面（横屏设计，响应式布局）。
 *
 * 布局：所有坐标由 computeTableLayout(scale.width, scale.height) 动态计算
 * （见 src/ui/layout.ts），窗口/屏幕旋转时随 Phaser Scale RESIZE 重排。
 * - 顶部一排：对手面板（武将/体力/手牌数/装备/判定区，可选为目标）；
 * - 中部：牌堆数 / 弃牌堆顶 / 回合信息，右侧战报日志，五谷丰登亮牌区；
 * - 中下：提示文案 + 倒计时条 + 操作按钮区（按 ask.kind 切换）；
 * - 底部：我的武将/体力/装备 + 手牌横排（过多时缩牌 + 压缩重叠）。
 * 竖屏（h > w）且不在选将阶段时显示「请横屏游玩」DOM 提示遮罩（不强制旋转）。
 *
 * 渲染策略：任何 state:update / ask / waiting 都触发全量重绘（不做增量动画，TODO: 动画）。
 * 交互：点击只累积 Selection，按「确定」才通过 buildResponse 组装 AskResponse 发给服务器；
 * 所有合法性最终由服务器把关。
 *
 * 调试/e2e：每次重绘把可点元素的实际坐标写到 window.__sgsTable，
 * e2e 直接读取坐标点击，不再硬编码布局公式。
 */

import Phaser from 'phaser';
import type { ClientCore, CoreSnapshot } from '../core/client.js';
import type { AskRequest, GameOverEvent, PublicPlayer, PublicState } from '../protocol.js';
import {
  CARD_LABEL,
  KINGDOM_LABEL,
  NEEDS_SECOND_TARGET,
  NEEDS_TARGET,
  PHASE_LABEL,
  ROLE_LABEL,
  askPrompt,
  buildResponse,
  opponentsOf,
  myPublicPlayer,
  playSkillOptions,
  responseOptions,
  roleBadge,
  skillMeta,
  suitRankText,
  type Card,
  type CardName,
  type Selection,
} from '../core/vm.js';
import { CARD_H, CARD_W, makeButton, makeCardView, makeChip } from '../ui/widgets.js';
import {
  computeButtonSpacing,
  computeHandStrip,
  computeOpponentSpacing,
  computeTableLayout,
  isPortrait,
  type TableLayout,
} from '../ui/layout.js';

const COLOR_TARGET = 0x3fa34d; // 可选目标 / 可出的牌：绿
const COLOR_SELECTED = 0xffd700; // 已选：金
const COLOR_SECOND = 0xe07a2f; // 第二目标：橙
const COLOR_PENDING = 0xf2e14c; // 正在响应：黄

/** 势力标记颜色（魏蓝/蜀红/吴绿/群灰）。 */
const KINGDOM_COLOR: Record<string, string> = {
  wei: '#7ba7d8',
  shu: '#e07a5a',
  wu: '#7bd88f',
  qun: '#b8bfca',
};

/** e2e 读取的可点元素坐标表（每次重绘刷新）。 */
interface TableProbe {
  gameW: number;
  gameH: number;
  hand: { id: string; name: string; x: number; y: number }[];
  buttons: { label: string; x: number; y: number }[];
  opponents: { id: string; x: number; y: number; w: number; h: number }[];
}

export class TableScene extends Phaser.Scene {
  private core!: ClientCore;
  private layer!: Phaser.GameObjects.Container;
  private countdownGfx!: Phaser.GameObjects.Graphics;
  private sel: Selection = {};
  private lastAskSeq = -1;
  private draftOverlay: HTMLDivElement | null = null;
  private rotateHint: HTMLDivElement | null = null;
  private layout: TableLayout = computeTableLayout(1280, 800);
  private probe: TableProbe = { gameW: 0, gameH: 0, hand: [], buttons: [], opponents: [] };
  private readonly onChange = (snap: CoreSnapshot) => this.onCoreChange(snap);
  private readonly onResize = () => {
    this.layout = computeTableLayout(this.scale.width, this.scale.height);
    this.renderAll(this.core.snapshot());
    this.updateRotateHint();
  };

  constructor() {
    super('TableScene');
  }

  create(): void {
    this.core = this.registry.get('core') as ClientCore;
    this.cameras.main.setBackgroundColor(0x274434);
    this.layer = this.add.container(0, 0);
    this.countdownGfx = this.add.graphics();
    this.layout = computeTableLayout(this.scale.width, this.scale.height);

    const hint = document.createElement('div');
    hint.id = 'sgs-rotate-hint';
    hint.innerHTML = '<div class="sgs-rotate-icon">⤵</div><div>请横屏游玩</div><div class="sgs-rotate-sub">牌桌为横屏设计，旋转手机即可获得完整视野</div>';
    document.body.appendChild(hint);
    this.rotateHint = hint;

    this.core.on('change', this.onChange);
    this.scale.on(Phaser.Scale.Events.RESIZE, this.onResize);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.core.off('change', this.onChange);
      this.scale.off(Phaser.Scale.Events.RESIZE, this.onResize);
      this.draftOverlay?.remove();
      this.draftOverlay = null;
      this.rotateHint?.remove();
      this.rotateHint = null;
    });
    this.onCoreChange(this.core.snapshot());
    this.updateRotateHint();
  }

  update(): void {
    // 倒计时条（ask 的 timeoutMs；本地只做展示，超时处理在服务器）
    const gfx = this.countdownGfx;
    gfx.clear();
    const current = this.core.currentAsk;
    if (current) {
      const { countdownY, countdownW } = this.layout.ask;
      const ratio = Phaser.Math.Clamp(1 - (Date.now() - current.receivedAt) / current.timeoutMs, 0, 1);
      const x = this.layout.w / 2 - countdownW / 2;
      gfx.fillStyle(0x11151d).fillRect(x, countdownY, countdownW, 10);
      gfx.fillStyle(ratio > 0.3 ? 0x7bd88f : 0xff7b72).fillRect(x, countdownY, countdownW * ratio, 10);
    }
    // 选将倒计时文案
    const cd = this.draftOverlay?.querySelector<HTMLElement>('#sgs-draft-countdown');
    if (cd && this.core.draft) {
      const left = Math.max(0, this.core.draft.timeoutMs - (Date.now() - this.core.draft.receivedAt));
      cd.textContent = `倒计时 ${Math.ceil(left / 1000)}s（超时随机分配）`;
    }
  }

  // ---------- 总渲染 ----------

  private onCoreChange(snap: CoreSnapshot): void {
    const seq = snap.currentAsk?.seq ?? -1;
    if (seq !== this.lastAskSeq) {
      this.sel = {}; // 新询问清空选择
      this.lastAskSeq = seq;
    }
    this.renderAll(snap);
    this.updateRotateHint();
  }

  private renderAll(snap: CoreSnapshot): void {
    if (this.scene === undefined) return; // 场景已销毁
    this.layer.removeAll(true);
    const L = this.layout;
    this.probe = { gameW: L.w, gameH: L.h, hand: [], buttons: [], opponents: [] };
    const state = snap.state;
    if (!state) {
      this.addText(L.w / 2, L.h / 2, '正在同步对局状态…', 20).setOrigin(0.5);
      this.publishProbe();
      return;
    }
    this.renderOpponents(state, snap.currentAsk?.ask ?? null);
    this.renderCenter(state);
    this.renderMe(state, snap.currentAsk?.ask ?? null);
    this.renderAskBar(snap);
    this.renderRoleBanner(snap);
    if (snap.gameOver) this.renderGameOver(snap);
    this.renderDraft(snap);
    this.publishProbe();
  }

  private publishProbe(): void {
    (window as unknown as { __sgsTable: TableProbe }).__sgsTable = this.probe;
  }

  /** 竖屏提示遮罩：仅对局画面；选将（DOM 覆盖层，竖屏可用）时不挡。 */
  private updateRotateHint(): void {
    if (!this.rotateHint) return;
    const show = isPortrait(this.scale.width, this.scale.height) && !this.core.draft;
    this.rotateHint.classList.toggle('visible', show);
  }

  // ---------- 对手面板 ----------

  private renderOpponents(state: PublicState, ask: AskRequest | null): void {
    const opponents = opponentsOf(state);
    const n = opponents.length;
    const L = this.layout;
    const spacing = computeOpponentSpacing(n, L);
    const startX = L.w / 2 - ((n - 1) * spacing) / 2;
    opponents.forEach((p, i) => {
      const x = startX + i * spacing;
      this.renderOpponentPanel(p, x, L.opponents.y, state, ask);
      this.probe.opponents.push({ id: p.id, x, y: L.opponents.y, w: L.panelW, h: L.panelH });
    });
  }

  private renderOpponentPanel(
    p: PublicPlayer,
    x: number,
    y: number,
    state: PublicState,
    ask: AskRequest | null,
  ): void {
    const { panelW: w, panelH: h, panelScale: ps } = this.layout;
    const children: Phaser.GameObjects.GameObject[] = [];

    const bg = this.add
      .rectangle(0, 0, w, h, p.alive ? 0x1f2a22 : 0x2a2a2a)
      .setStrokeStyle(1, 0x0d130f);
    children.push(bg);

    // 正在响应 / 已被选为目标的外框
    if (state.pendingPlayerId === p.id) {
      children.push(this.add.rectangle(0, 0, w + 4, h + 4).setStrokeStyle(3, COLOR_PENDING));
    }
    const selStroke = this.selectionStrokeFor(p.id);
    if (selStroke !== null) {
      children.push(this.add.rectangle(0, 0, w + 8, h + 8).setStrokeStyle(3, selStroke));
    } else if (this.isTargetable(p, ask)) {
      children.push(this.add.rectangle(0, 0, w + 4, h + 4).setStrokeStyle(2, COLOR_TARGET));
    }

    const fontSize = (base: number) => Math.max(11, Math.round(base * Math.max(ps, 0.85)));
    const nameLine = `${p.name}${p.id === state.me.id ? '' : ''}`;
    children.push(this.addText(-w / 2 + 8, -h / 2 + 6, nameLine, fontSize(14), '#f0ead8').setOrigin(0, 0));
    // 武将名 + 势力标记（白板无势力）
    const kingdomTag = p.kingdom ? `${KINGDOM_LABEL[p.kingdom] ?? p.kingdom}·` : '';
    children.push(
      this.addText(w / 2 - 8, -h / 2 + 6, `${kingdomTag}${p.generalName}`, fontSize(13), KINGDOM_COLOR[p.kingdom ?? ''] ?? '#c9b98a').setOrigin(1, 0),
    );

    // 身份标记：主公金色公开；阵亡者/终局亮出
    const badge = roleBadge(p);
    if (badge) {
      children.push(
        this.addText(w / 2 - 8, -h / 2 + 24, badge, fontSize(13), p.role === 'lord' ? '#ffd700' : '#b8bfca').setOrigin(1, 0),
      );
    }

    // 托管标记：断线/超时未操作，由服务器 AI 代打
    if (p.trusted) {
      children.push(
        this.addText(w / 2 - 8, -h / 2 + 42, '托管中', fontSize(12), '#f2a154').setOrigin(1, 0),
      );
    }

    const hearts = '♥'.repeat(Math.max(0, p.hp)) + '♡'.repeat(Math.max(0, p.maxHp - p.hp));
    children.push(this.addText(-w / 2 + 8, -h / 2 + 28, hearts, fontSize(14), '#e05a5a').setOrigin(0, 0));

    children.push(
      this.addText(-w / 2 + 8, -h / 2 + 50, `手牌 ×${p.handCount}`, fontSize(12), '#cfd6e4').setOrigin(0, 0),
    );

    if (!p.alive) {
      children.push(this.addText(0, 0, badge ? `阵亡·${badge}` : '阵亡', fontSize(22), '#888888').setOrigin(0.5));
    } else if (p.currentPhase) {
      children.push(
        this.addText(0, 6, PHASE_LABEL[p.currentPhase], fontSize(13), '#f2e14c').setOrigin(0.5),
      );
    }

    // 装备区四格
    const chipW = Math.round(44 * ps);
    const chipGap = chipW + 2;
    const slots: [string, Card | null][] = [
      ['武器', p.equips.weapon],
      ['防具', p.equips.armor],
      ['+1马', p.equips.horsePlus],
      ['-1马', p.equips.horseMinus],
    ];
    slots.forEach(([slot, card], i) => {
      const chip = makeChip(
        this,
        -w / 2 + chipW / 2 + 4 + i * chipGap,
        h / 2 - Math.round(46 * ps),
        card ? shortLabel(card) : slot,
        { width: chipW, color: card ? 0x35507a : 0x22282f },
      );
      children.push(chip);
    });

    // 判定区
    if (p.judgeArea.length > 0) {
      const jw = Math.round(56 * ps);
      p.judgeArea.forEach((card, i) => {
        children.push(
          makeChip(this, -w / 2 + jw / 2 + 4 + i * (jw + 4), h / 2 - Math.round(20 * ps), shortLabel(card), {
            width: jw,
            color: 0x6a4a7a,
          }),
        );
      });
    }

    const panel = this.add.container(x, y, children);
    panel.setSize(w, h);
    if (this.isTargetable(p, ask)) {
      panel.setInteractive({ useHandCursor: true });
      panel.on('pointerup', () => this.onPlayerClicked(p));
    }
    this.layer.add(panel);
  }

  /** 当前交互状态下该玩家是否可点为目标。 */
  private isTargetable(p: PublicPlayer, ask: AskRequest | null): boolean {
    if (!ask || !p.alive) return false;
    if (ask.kind === 'choose-target') return ask.targetIds.includes(p.id);
    if (ask.kind === 'give-card') return ask.targetIds.includes(p.id); // 遗计分配（对手面板不含自己；自己保留走按钮）
    if (ask.kind === 'play' && ask.playerId === this.core.myPlayerId) {
      // 主动技需要目标的（青囊/反间/仁德/结姻/离间）：对手面板都可点；限男性的技能只亮男性角色
      if (this.sel.skillId) {
        const meta = skillMeta(this.sel.skillId);
        if (meta && (meta.needsTarget || meta.twoTargets)) {
          if (meta.maleOnly && p.gender !== 'male') return false;
          return true;
        }
      }
      const name = this.targetingCardName();
      if (!name || !NEEDS_TARGET.has(name)) return false;
      if (p.id === this.core.myPlayerId) return false; // 这些牌都只对其他角色使用
      return true;
    }
    return false;
  }

  private selectionStrokeFor(playerId: string): number | null {
    if (this.sel.targetId === playerId) return COLOR_SELECTED;
    if (this.sel.targetId2 === playerId) return COLOR_SECOND;
    if (this.sel.targetIds?.includes(playerId)) return COLOR_SELECTED;
    return null;
  }

  private onPlayerClicked(p: PublicPlayer): void {
    const ask = this.core.currentAsk?.ask;
    if (!ask) return;

    if (ask.kind === 'choose-target') {
      const ids = this.sel.targetIds ?? [];
      this.sel.targetIds = ids.includes(p.id)
        ? ids.filter((id) => id !== p.id)
        : ids.length < ask.max
          ? [...ids, p.id]
          : ids;
      this.renderAll(this.core.snapshot());
      return;
    }

    if (ask.kind === 'give-card') {
      // 遗计：点选牌的接收者（单选）
      this.sel.targetId = this.sel.targetId === p.id ? undefined : p.id;
      this.renderAll(this.core.snapshot());
      return;
    }

    // 出牌阶段的技能目标（青囊/反间/仁德/结姻/离间）
    if (ask.kind === 'play' && this.sel.skillId) {
      const meta = skillMeta(this.sel.skillId);
      if (meta?.twoTargets) {
        // 离间：先选决斗使用者，再选被决斗者
        if (!this.sel.targetId) this.sel.targetId = p.id;
        else if (this.sel.targetId === p.id) this.sel.targetId = undefined;
        else if (!this.sel.targetId2) this.sel.targetId2 = p.id;
        else if (this.sel.targetId2 === p.id) this.sel.targetId2 = undefined;
        else this.sel.targetId2 = p.id;
        this.renderAll(this.core.snapshot());
        return;
      }
      if (meta?.needsTarget) {
        this.sel.targetId = this.sel.targetId === p.id ? undefined : p.id;
        this.renderAll(this.core.snapshot());
        return;
      }
    }

    const name = this.targetingCardName();
    if (!name) return;
    if (NEEDS_SECOND_TARGET.has(name)) {
      if (!this.sel.targetId) this.sel.targetId = p.id;
      else if (this.sel.targetId === p.id) this.sel.targetId = undefined;
      else if (!this.sel.targetId2) this.sel.targetId2 = p.id;
      else if (this.sel.targetId2 === p.id) this.sel.targetId2 = undefined;
      else this.sel.targetId2 = p.id;
    } else {
      this.sel.targetId = this.sel.targetId === p.id ? undefined : p.id;
    }
    this.renderAll(this.core.snapshot());
  }

  /** 出牌阶段当前选择所对应的"牌名"（普通牌或转化技的转化结果）。 */
  private targetingCardName(): CardName | null {
    const ask = this.core.currentAsk?.ask;
    const state = this.core.state;
    if (!ask || ask.kind !== 'play' || !state) return null;
    if (this.sel.skillId) return skillMeta(this.sel.skillId)?.as ?? null;
    return state.me.hand.find((c) => c.id === this.sel.cardId)?.name ?? null;
  }

  // ---------- 中部：牌堆 / 弃牌堆 / 日志 / 五谷亮牌 ----------

  private renderCenter(state: PublicState): void {
    const L = this.layout;
    const { pileY, pileGapX, pileLabelY, pileScale, turnY, logX, logY, logLineH, chooseCardY, chooseCardSpan } = L.center;
    const cx = L.w / 2;

    // 牌堆
    const deck = makeCardView(this, cx - pileGapX, pileY, { id: 'deck', name: 'sha' }, { faceDown: true, scale: pileScale });
    this.layer.add(deck);
    this.layer.add(
      this.addText(cx - pileGapX, pileLabelY, `牌堆 ${state.deckCount ?? '∞'}`, 13, '#cfd6e4').setOrigin(0.5),
    );

    // 弃牌堆顶
    if (state.discardTop) {
      this.layer.add(makeCardView(this, cx + pileGapX, pileY, state.discardTop, { scale: pileScale }));
    } else {
      const empty = this.add
        .rectangle(cx + pileGapX, pileY, CARD_W * pileScale, CARD_H * pileScale)
        .setStrokeStyle(1, 0x4a5a4a);
      this.layer.add(empty);
    }
    this.layer.add(
      this.addText(cx + pileGapX, pileLabelY, `弃牌 ${state.discardCount}`, 13, '#cfd6e4').setOrigin(0.5),
    );

    this.layer.add(this.addText(cx, turnY, `第 ${state.turn} 回合`, 15, '#f0ead8').setOrigin(0.5));

    // 五谷丰登亮牌区（choose-card 询问）/ 观星展示区（guanxing 询问，多选放牌堆底）
    const ask = this.core.currentAsk?.ask;
    if (ask?.kind === 'choose-card' || ask?.kind === 'guanxing') {
      const cards = ask.cards;
      const spacing = Math.min(120 * L.cardScale + 24, chooseCardSpan / Math.max(1, cards.length));
      const startX = cx - ((cards.length - 1) * spacing) / 2;
      cards.forEach((card, i) => {
        const isGuanxing = ask.kind === 'guanxing';
        const selected = isGuanxing
          ? (this.sel.cardIds?.includes(card.id) ?? false)
          : this.sel.cardId === card.id;
        const scale = Math.min(1, (spacing - 8) / CARD_W);
        this.layer.add(
          makeCardView(this, startX + i * spacing, chooseCardY, card, {
            scale: Math.max(scale, 0.45),
            highlight: selected ? COLOR_SELECTED : COLOR_TARGET,
            badge: isGuanxing && selected ? '牌堆底' : undefined,
            onClick: () => {
              if (isGuanxing) {
                const ids = this.sel.cardIds ?? [];
                this.sel.cardIds = ids.includes(card.id)
                  ? ids.filter((id) => id !== card.id)
                  : [...ids, card.id];
              } else {
                this.sel = { cardId: card.id };
              }
              this.renderAll(this.core.snapshot());
            },
          }),
        );
      });
    }

    // 战报日志
    const logs = this.core.logs.slice(-14);
    this.layer.add(this.addText(logX, logY, '战报', 13, '#9aa0aa'));
    logs.forEach((line, i) => {
      const text = line.length > 30 ? `${line.slice(0, 30)}…` : line;
      this.layer.add(this.addText(logX, logY + 20 + i * logLineH, text, 12, '#b8bfca'));
    });
  }

  // ---------- 底部：我的区域 + 手牌 ----------

  private renderMe(state: PublicState, ask: AskRequest | null): void {
    const mePub = myPublicPlayer(state);
    if (!mePub) return;
    const L = this.layout;

    const { x, y, chipGap, judgeGap } = L.me;
    const meKingdom = mePub.kingdom ? `${KINGDOM_LABEL[mePub.kingdom] ?? mePub.kingdom}·` : '';
    this.layer.add(
      this.addText(x, y, `${meKingdom}${mePub.generalName}`, 18, KINGDOM_COLOR[mePub.kingdom ?? ''] ?? '#f0ead8'),
    );
    const hearts = '♥'.repeat(Math.max(0, mePub.hp)) + '♡'.repeat(Math.max(0, mePub.maxHp - mePub.hp));
    this.layer.add(this.addText(x, y + 26, hearts, 16, '#e05a5a'));

    const chipW = Math.round(48 * Math.max(L.s, 0.7));
    const slots: [string, Card | null][] = [
      ['武器', mePub.equips.weapon],
      ['防具', mePub.equips.armor],
      ['+1马', mePub.equips.horsePlus],
      ['-1马', mePub.equips.horseMinus],
    ];
    slots.forEach(([slot, card], i) => {
      this.layer.add(
        makeChip(this, x + chipW / 2 + 6 + i * chipGap, y + 58, card ? shortLabel(card) : slot, {
          width: chipW,
          color: card ? 0x35507a : 0x22282f,
        }),
      );
    });
    const jw = Math.round(58 * Math.max(L.s, 0.7));
    mePub.judgeArea.forEach((card, i) => {
      this.layer.add(
        makeChip(this, x + jw / 2 + 6 + i * judgeGap, y + 84, shortLabel(card), { width: jw, color: 0x6a4a7a }),
      );
    });
    if (mePub.currentPhase) {
      this.layer.add(this.addText(x, y + 108, PHASE_LABEL[mePub.currentPhase], 13, '#f2e14c'));
    }

    // 手牌：布局由 computeHandStrip 给出（过多时缩牌 + 压缩重叠，间距有触屏下限）
    const hand = state.me.hand;
    const strip = computeHandStrip(hand.length, L);
    hand.forEach((card, i) => {
      const selected = this.sel.cardId === card.id;
      const opts = this.handCardOpts(card, ask, selected);
      const cx = strip.startX + i * strip.spacing;
      const cy = L.hand.y + (selected ? -L.hand.lift : 0);
      const view = makeCardView(this, cx, cy, card, { ...opts, scale: strip.scale });
      this.layer.add(view);
      this.probe.hand.push({ id: card.id, name: card.name, x: cx, y: cy });
    });
  }

  /** 手牌在当前询问下的可点性/高亮/角标。 */
  private handCardOpts(
    card: Card,
    ask: AskRequest | null,
    selected: boolean,
  ): { highlight?: number; badge?: string; onClick?: () => void } {
    if (!ask || ask.playerId !== this.core.myPlayerId) return {};

    if (ask.kind === 'play') {
      // 已选转化技：只有匹配牌可点，角标"当作【X】"
      if (this.sel.skillId) {
        const meta = skillMeta(this.sel.skillId);
        if (!meta?.match?.(card)) return {};
        // 多选牌/定数牌主动技（仁德/制衡/结姻/离间）：手牌累积多选
        if (meta.multiCards || meta.exactCards) {
          const picked = this.sel.cardIds?.includes(card.id) ?? false;
          return {
            highlight: picked ? COLOR_SELECTED : COLOR_TARGET,
            onClick: () => this.toggleDiscardCard(card),
          };
        }
        return {
          highlight: selected ? COLOR_SELECTED : COLOR_TARGET,
          badge: meta.as ? `当作${CARD_LABEL[meta.as]}` : undefined,
          onClick: () => this.toggleHandCard(card, true),
        };
      }
      return {
        highlight: selected ? COLOR_SELECTED : undefined,
        onClick: () => this.toggleHandCard(card, false),
      };
    }

    if (ask.kind === 'response') {
      const opts = responseOptions(ask, this.core.state?.me.hand ?? []);
      if (opts.direct.some((c) => c.id === card.id)) {
        return {
          highlight: selected ? COLOR_SELECTED : COLOR_TARGET,
          onClick: () => this.toggleRespondCard(card, null),
        };
      }
      const conv = opts.converts.find((c) => c.cards.some((cc) => cc.id === card.id));
      if (conv) {
        return {
          highlight: selected ? COLOR_SELECTED : COLOR_TARGET,
          badge: `当作${CARD_LABEL[conv.as]}`,
          onClick: () => this.toggleRespondCard(card, conv.skillId),
        };
      }
    }

    if (ask.kind === 'discard') {
      // 弃牌（弃牌阶段 / 流离代价）：所有手牌可点，多选恰好 count 张
      const picked = this.sel.cardIds?.includes(card.id) ?? false;
      return {
        highlight: picked ? COLOR_SELECTED : COLOR_TARGET,
        onClick: () => this.toggleDiscardCard(card),
      };
    }

    if (ask.kind === 'judge-retrial') {
      // 鬼才改判：任意手牌可点，单选
      return {
        highlight: selected ? COLOR_SELECTED : COLOR_TARGET,
        badge: '代替判定牌',
        onClick: () => this.toggleHandCard(card, false),
      };
    }
    return {};
  }

  private toggleDiscardCard(card: Card): void {
    const ids = this.sel.cardIds ?? [];
    this.sel.cardIds = ids.includes(card.id) ? ids.filter((id) => id !== card.id) : [...ids, card.id];
    this.renderAll(this.core.snapshot());
  }

  private toggleHandCard(card: Card, forSkill: boolean): void {
    if (this.sel.cardId === card.id) {
      this.sel.cardId = undefined;
    } else {
      this.sel.cardId = card.id;
      if (!forSkill) this.sel.skillId = undefined;
      // 换牌后清掉已选目标（目标需求可能变化）
      this.sel.targetId = undefined;
      this.sel.targetId2 = undefined;
    }
    this.renderAll(this.core.snapshot());
  }

  private toggleRespondCard(card: Card, skillId: string | null): void {
    if (this.sel.cardId === card.id) {
      this.sel = {};
    } else {
      this.sel = skillId ? { cardId: card.id, skillId } : { cardId: card.id };
    }
    this.renderAll(this.core.snapshot());
  }

  // ---------- 操作区（提示 + 按钮） ----------

  private renderAskBar(snap: CoreSnapshot): void {
    const ask = snap.currentAsk?.ask ?? null;
    const state = snap.state;
    const L = this.layout;

    // 提示文案
    let prompt = '';
    if (ask) {
      prompt = askPrompt(ask);
    } else if (snap.waiting) {
      prompt = `等待 ${snap.waiting.playerName} 响应…`;
    } else if (state?.pendingPlayerId) {
      const who = state.players.find((p) => p.id === state.pendingPlayerId);
      prompt = `等待 ${who?.name ?? ''} 响应…`;
    }
    if (prompt) {
      this.layer.add(this.addText(L.w / 2, L.ask.promptY, prompt, 17, '#f0ead8').setOrigin(0.5));
    }
    if (!ask || !state) return;

    const hand = state.me.hand;
    const buttons: { label: string; enabled: boolean; color?: number; onClick: () => void }[] = [];

    if (ask.kind === 'play') {
      for (const opt of playSkillOptions(ask, hand)) {
        const active = this.sel.skillId === opt.meta.id;
        buttons.push({
          label: opt.meta.as ? `${opt.meta.name}${CARD_LABEL[opt.meta.as]}` : opt.meta.name,
          enabled: opt.usable,
          color: active ? 0x3f72af : 0x5a4a7a,
          onClick: () => {
            this.sel = active ? {} : { skillId: opt.meta.id };
            this.renderAll(this.core.snapshot());
          },
        });
      }
      buttons.push(
        {
          label: '确定',
          enabled: buildResponse(ask, this.sel, hand) !== null,
          onClick: () => this.submit(hand),
        },
        {
          label: '取消',
          enabled: Object.keys(this.sel).length > 0,
          color: 0x555c66,
          onClick: () => {
            this.sel = {};
            this.renderAll(this.core.snapshot());
          },
        },
        {
          label: '结束出牌',
          enabled: true,
          color: 0x6e3b3b,
          onClick: () => void this.core.respond({ pass: true }),
        },
      );
    } else if (ask.kind === 'response') {
      buttons.push(
        { label: '确定', enabled: buildResponse(ask, this.sel, hand) !== null, onClick: () => this.submit(hand) },
        {
          label: '放弃',
          enabled: true,
          color: 0x6e3b3b,
          onClick: () => void this.core.respond({ pass: true }),
        },
      );
    } else if (ask.kind === 'confirm') {
      buttons.push(
        { label: '发动', enabled: true, onClick: () => void this.core.respond({ confirm: true }) },
        {
          label: '不发动',
          enabled: true,
          color: 0x6e3b3b,
          onClick: () => void this.core.respond({ pass: true }),
        },
      );
    } else if (ask.kind === 'choose-target') {
      buttons.push(
        {
          label: `确定（${this.sel.targetIds?.length ?? 0}/${ask.min === ask.max ? ask.max : `${ask.min}~${ask.max}`}）`,
          enabled: buildResponse(ask, this.sel, hand) !== null,
          onClick: () => this.submit(hand),
        },
        {
          label: '放弃',
          enabled: true,
          color: 0x6e3b3b,
          onClick: () => void this.core.respond({ pass: true }),
        },
      );
    } else if (ask.kind === 'choose-card') {
      buttons.push({
        label: '确定',
        enabled: buildResponse(ask, this.sel, hand) !== null,
        onClick: () => this.submit(hand),
      });
    } else if (ask.kind === 'choose-option') {
      // 刚烈二选一 / 反间猜花色：每个选项一个按钮，点击即应答
      for (const opt of ask.options) {
        buttons.push({
          label: opt.label,
          enabled: true,
          onClick: () => void this.core.respond({ choice: opt.id }),
        });
      }
    } else if (ask.kind === 'give-card') {
      // 遗计分配：点一名角色交给 TA，或自己保留
      buttons.push(
        {
          label: '交给所选角色',
          enabled: buildResponse(ask, this.sel, hand) !== null,
          onClick: () => this.submit(hand),
        },
        {
          label: '自己保留',
          enabled: true,
          color: 0x6e3b3b,
          onClick: () => void this.core.respond({ pass: true }),
        },
      );
    } else if (ask.kind === 'discard') {
      // 弃牌不可放弃，只有一个确定键
      buttons.push({
        label: `确定（${this.sel.cardIds?.length ?? 0}/${ask.count}）`,
        enabled: buildResponse(ask, this.sel, hand) !== null,
        onClick: () => this.submit(hand),
      });
    } else if (ask.kind === 'judge-retrial') {
      // 鬼才改判：选一张手牌代替判定牌，或不改判
      buttons.push(
        {
          label: '打出改判',
          enabled: buildResponse(ask, this.sel, hand) !== null,
          onClick: () => this.submit(hand),
        },
        {
          label: '不改判',
          enabled: true,
          color: 0x6e3b3b,
          onClick: () => void this.core.respond({ pass: true }),
        },
      );
    } else if (ask.kind === 'guanxing') {
      // 观星：选中的牌放牌堆底（可空选），其余保持顺序回顶
      buttons.push(
        {
          label: `放底（${this.sel.cardIds?.length ?? 0}/${ask.cards.length}）`,
          enabled: buildResponse(ask, this.sel, hand) !== null,
          onClick: () => this.submit(hand),
        },
        {
          label: '全部回顶',
          enabled: true,
          color: 0x6e3b3b,
          onClick: () => void this.core.respond({ pass: true }),
        },
      );
    }

    const buttonW = 110;
    const spacing = computeButtonSpacing(buttons.length, buttonW, L);
    const startX = L.w / 2 - ((buttons.length - 1) * spacing) / 2;
    buttons.forEach((b, i) => {
      const bx = startX + i * spacing;
      const btn = makeButton(this, bx, L.ask.buttonsY, b.label, {
        enabled: b.enabled,
        color: b.color,
        onClick: b.onClick,
      });
      this.layer.add(btn.container);
      this.probe.buttons.push({ label: b.label, x: bx, y: L.ask.buttonsY });
    });
  }

  private submit(hand: Card[]): void {
    const ask = this.core.currentAsk?.ask;
    if (!ask) return;
    const response = buildResponse(ask, this.sel, hand);
    if (!response) return;
    void this.core.respond(response);
  }

  // ---------- 身份牌与选将 ----------

  /** 我的身份牌（大字）+ 获胜条件一句话（身份局）。 */
  private renderRoleBanner(snap: CoreSnapshot): void {
    const role = snap.myRole;
    if (!role) return;
    const L = this.layout;
    const color =
      role.role === 'lord' ? '#ffd700'
      : role.role === 'loyalist' ? '#7bd88f'
      : role.role === 'rebel' ? '#ff7b72'
      : '#c9a0ff';
    this.layer.add(this.addText(L.role.x, L.role.y, `身份：${role.label}`, L.role.fontSize, color));
    this.layer.add(this.addText(L.role.x, L.role.objectiveY, role.objective, 13, '#9aa0aa'));
  }

  /** 选将覆盖层（DOM）：候选武将卡片 + 倒计时；已选则等待其他玩家。 */
  private renderDraft(snap: CoreSnapshot): void {
    const draft = snap.draft;
    if (!draft) {
      this.draftOverlay?.remove();
      this.draftOverlay = null;
      return;
    }
    if (!this.draftOverlay) {
      const overlay = document.createElement('div');
      overlay.className = 'sgs-overlay';
      overlay.style.background = 'rgba(10, 14, 18, 0.92)';
      overlay.innerHTML = `
        <h1>选择你的武将</h1>
        <div class="hint" id="sgs-draft-role"></div>
        <div class="sgs-draft-list" id="sgs-draft-list"></div>
        <div class="hint" id="sgs-draft-countdown"></div>
        <div class="hint" id="sgs-draft-status"></div>
      `;
      document.body.appendChild(overlay);
      this.draftOverlay = overlay;
    }
    const overlay = this.draftOverlay;
    const roleEl = overlay.querySelector<HTMLElement>('#sgs-draft-role')!;
    roleEl.textContent = snap.myRole ? `你的身份：${snap.myRole.label}（${snap.myRole.objective}）` : '';

    const statusEl = overlay.querySelector<HTMLElement>('#sgs-draft-status')!;
    statusEl.textContent = draft.pickedId ? '已选择，等待其他玩家…' : '';

    const list = overlay.querySelector<HTMLElement>('#sgs-draft-list')!;
    list.innerHTML = '';
    for (const cand of draft.candidates) {
      const card = document.createElement('div');
      card.className = `sgs-general-card${draft.pickedId === cand.id ? ' picked' : ''}`;
      const skills = cand.skills
        .map((s) => `<div class="skill"><b>【${escapeHtml(s.name)}】</b>${escapeHtml(s.description)}</div>`)
        .join('');
      card.innerHTML = `
        <h3>${escapeHtml(cand.name)}</h3>
        <div class="meta">${KINGDOM_LABEL[cand.kingdom] ?? cand.kingdom} · ${cand.gender === 'female' ? '女' : '男'} · ${cand.hp} 体力</div>
        ${skills}
      `;
      if (!draft.pickedId) {
        card.onclick = () => void this.core.pickGeneral(cand.id);
      }
      list.appendChild(card);
    }
  }

  // ---------- 结算覆盖层 ----------

  private renderGameOver(snap: CoreSnapshot): void {
    const over = snap.gameOver!;
    const { w, h } = this.layout;
    const shade = this.add.rectangle(w / 2, h / 2, w, h, 0x000000, 0.7);
    const titleText = over.winSide
      ? `🏆 ${ROLE_LABEL[over.winSide]}方获胜！${over.winnerName ? `（${over.winnerName}）` : ''}`
      : over.winnerName
        ? `🏆 ${over.winnerName} 获胜！`
        : '对局结束';
    const title = this.add
      .text(w / 2, h / 2 - 60, titleText, {
        fontSize: '36px',
        color: '#ffd700',
      })
      .setOrigin(0.5);
    this.layer.add([shade, title]);

    // 再来一局：房主可直接重开（座位保留，重新选将/发身份）；其他人等待房主
    const isHost = snap.room?.players.find((p) => p.id === snap.myPlayerId)?.isHost ?? false;
    const hint = this.add
      .text(
        w / 2,
        h / 2,
        isHost ? '可以再来一局（座位不变，重新发身份选将），或返回大厅' : '等待房主开始下一局，或返回大厅',
        { fontSize: '15px', color: '#cfd6e4' },
      )
      .setOrigin(0.5);
    this.layer.add(hint);
    let nextY = h / 2 + 60;
    if (isHost) {
      const again = makeButton(this, w / 2, nextY, '再来一局', {
        width: 160,
        height: 44,
        color: 0x3fa34d,
        onClick: () => void this.core.startGame(),
      });
      this.layer.add(again.container);
      nextY += 56;
    }
    const back = makeButton(this, w / 2, nextY, '返回大厅', {
      width: 160,
      height: 44,
      onClick: () => {
        void this.core.leave().then(() => this.scene.start('LobbyScene'));
      },
    });
    this.layer.add(back.container);
  }

  // ---------- 工具 ----------

  private addText(x: number, y: number, text: string, size: number, color = '#e8e4d8'): Phaser.GameObjects.Text {
    const t = this.add.text(x, y, text, { fontSize: `${size}px`, color });
    this.layer.add(t);
    return t;
  }
}

function shortLabel(card: Card): string {
  const base = CARD_LABEL[card.name].replace(/[【】]/g, '');
  const suit = suitRankText(card);
  const text = base.length > 3 ? base.slice(0, 3) : base;
  return suit ? `${text}${suit}` : text;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
