/**
 * 房间场景：玩家列表 + 准备/开局/离开。DOM 覆盖层实现。
 * 房间状态变为 playing 时自动进入牌桌场景。
 */

import Phaser from 'phaser';
import type { ClientCore, CoreSnapshot } from '../core/client.js';

export class RoomScene extends Phaser.Scene {
  private overlay: HTMLDivElement | null = null;
  private core!: ClientCore;
  private readonly onChange = (snap: CoreSnapshot) => this.render(snap);

  constructor() {
    super('RoomScene');
  }

  create(): void {
    this.core = this.registry.get('core') as ClientCore;

    const overlay = document.createElement('div');
    overlay.className = 'sgs-overlay';
    overlay.innerHTML = `
      <h1 id="sgs-room-code"></h1>
      <div class="sgs-room-list" id="sgs-players"></div>
      <div class="row">
        <button id="sgs-ready"></button>
        <button id="sgs-start">开始游戏</button>
        <button id="sgs-leave">离开房间</button>
      </div>
      <div class="error" id="sgs-error"></div>
      <div class="hint" id="sgs-mode-hint"></div>
      <div class="hint">房主点击「开始游戏」后所有人进入对局；刷新页面会自动重连。</div>
    `;
    document.body.appendChild(overlay);
    this.overlay = overlay;

    const $ = <T extends HTMLElement>(id: string) => overlay.querySelector<T>(id)!;
    const errorEl = $('#sgs-error');

    $<HTMLButtonElement>('#sgs-ready').onclick = async () => {
      const me = this.core.room?.players.find((p) => p.id === this.core.myPlayerId);
      const ack = await this.core.setReady(!me?.ready);
      if (!ack.ok) errorEl.textContent = ack.error;
    };
    $<HTMLButtonElement>('#sgs-start').onclick = async () => {
      const ack = await this.core.startGame();
      if (!ack.ok) errorEl.textContent = ack.error;
    };
    $<HTMLButtonElement>('#sgs-leave').onclick = async () => {
      await this.core.leave();
      this.scene.start('LobbyScene');
    };

    this.core.on('change', this.onChange);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.core.off('change', this.onChange);
      this.overlay?.remove();
      this.overlay = null;
    });

    this.render(this.core.snapshot());
  }

  private render(snap: CoreSnapshot): void {
    if (!this.overlay) return;
    const room = snap.room;
    if (!room) {
      this.scene.start('LobbyScene');
      return;
    }
    if (room.status === 'playing') {
      this.scene.start('TableScene');
      return;
    }
    const $ = <T extends HTMLElement>(id: string) => this.overlay!.querySelector<T>(id)!;
    $('#sgs-room-code').textContent = `房间码：${room.code}`;

    const list = $('#sgs-players');
    list.innerHTML = room.players
      .map((p) => {
        const badges = [
          p.isHost ? '房主' : '',
          p.account ? '<span style="color:#c9b98a">账号</span>' : '',
          p.ready ? '<span style="color:#7bd88f">已准备</span>' : '<span style="color:#9aa0aa">未准备</span>',
          p.online ? '' : '<span style="color:#ff7b72">离线</span>',
        ]
          .filter(Boolean)
          .join(' ');
        return `<div class="player-row"><span>${escapeHtml(p.name)}</span><span>${badges}</span></div>`;
      })
      .join('');

    const me = room.players.find((p) => p.id === snap.myPlayerId);
    const readyBtn = $<HTMLButtonElement>('#sgs-ready');
    readyBtn.textContent = me?.ready ? '取消准备' : '准备';
    readyBtn.style.display = me && !me.isHost ? '' : 'none';

    const startBtn = $<HTMLButtonElement>('#sgs-start');
    startBtn.style.display = me?.isHost ? '' : 'none';
    const othersReady = room.players.filter((p) => !p.isHost).every((p) => p.ready);
    startBtn.disabled = !(room.players.length >= 2 && othersReady);

    // 模式提示：2~3 人 1v1 对决；4 人及以上身份局（主公/忠臣/反贼/内奸）
    const n = room.players.length;
    $('#sgs-mode-hint').textContent =
      n >= 4
        ? `当前 ${n} 人：开局为身份局（4 人 = 1主1忠2反；5 人起加内奸）。`
        : `当前 ${n} 人：2~3 人开局为 1v1 对决；达到 4 人后开局为身份局（主公/忠臣/反贼/内奸）。`;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
