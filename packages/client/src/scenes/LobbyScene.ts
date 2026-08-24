/**
 * 大厅场景：输入昵称建房 / 输入房间码加入；有持久化会话时自动 room:rejoin。
 * UI 用 DOM 覆盖层（表单输入比 Phaser 自绘方便），Phaser 只提供背景。
 *
 * 账号区（顶部）：未登录可填用户名/密码登录或注册，也可跳过直接以游客身份玩；
 * 登录后显示账号名、「我的战绩」面板与登出按钮。登录态凭 localStorage 里的
 * 会话 token 自动恢复（socket 握手带上，stats:me 校验并取回用户名）。
 */

import Phaser from 'phaser';
import type { ClientCore } from '../core/client.js';
import { ROLE_LABEL, matchModeLabel, matchRoleLabel, winRateText } from '../core/vm.js';
import type { Role, RoomInfo, UserStats } from '../protocol.js';

export class LobbyScene extends Phaser.Scene {
  private overlay: HTMLDivElement | null = null;

  constructor() {
    super('LobbyScene');
  }

  create(): void {
    const core = this.registry.get('core') as ClientCore;

    const overlay = document.createElement('div');
    overlay.className = 'sgs-overlay';
    overlay.innerHTML = `
      <h1>三国杀</h1>
      <div class="sgs-auth" id="sgs-auth"></div>
      <div class="sgs-stats" id="sgs-stats" style="display:none"></div>
      <div class="row"><input id="sgs-name" maxlength="24" placeholder="昵称" /></div>
      <div class="row">
        <button id="sgs-create">创建房间</button>
      </div>
      <div class="row">
        <input id="sgs-code" maxlength="8" placeholder="房间码" />
        <button id="sgs-join">加入房间</button>
      </div>
      <div class="error" id="sgs-error"></div>
      <div class="hint" id="sgs-hint"></div>
    `;
    document.body.appendChild(overlay);
    this.overlay = overlay;

    const $ = <T extends HTMLElement>(id: string) => overlay.querySelector<T>(id)!;
    const nameInput = $<HTMLInputElement>('#sgs-name');
    const codeInput = $<HTMLInputElement>('#sgs-code');
    const errorEl = $('#sgs-error');
    const hintEl = $('#sgs-hint');

    const fail = (msg: string) => {
      errorEl.textContent = msg;
    };

    // ---------- 账号区 ----------

    const renderAuth = () => {
      const box = $('#sgs-auth');
      if (core.account) {
        box.innerHTML = `
          <div class="row">
            <span class="sgs-account-name">账号：${escapeHtml(core.account.username)}</span>
            <button id="sgs-stats-toggle">我的战绩</button>
            <button id="sgs-logout">登出</button>
          </div>
        `;
        box.querySelector<HTMLButtonElement>('#sgs-logout')!.onclick = async () => {
          await core.logout();
          $('#sgs-stats').style.display = 'none';
          renderAuth();
        };
        box.querySelector<HTMLButtonElement>('#sgs-stats-toggle')!.onclick = async () => {
          const panel = $('#sgs-stats');
          if (panel.style.display !== 'none') {
            panel.style.display = 'none';
            return;
          }
          const ack = await core.fetchStats();
          if (!ack.ok) return fail(ack.error);
          renderStats(ack.stats);
          panel.style.display = '';
        };
      } else {
        box.innerHTML = `
          <div class="row">
            <input id="sgs-username" maxlength="16" placeholder="用户名（可跳过）" autocomplete="username" />
            <input id="sgs-password" type="password" maxlength="64" placeholder="密码" autocomplete="current-password" />
          </div>
          <div class="row">
            <button id="sgs-login">登录</button>
            <button id="sgs-register">注册</button>
          </div>
          <div class="hint">不登录也能玩（游客）；登录后战绩会记录到账号</div>
        `;
        const doAuth = async (kind: 'login' | 'register') => {
          const username = box.querySelector<HTMLInputElement>('#sgs-username')!.value.trim();
          const password = box.querySelector<HTMLInputElement>('#sgs-password')!.value;
          if (!username || !password) return fail('请输入用户名和密码');
          const ack = kind === 'login' ? await core.login(username, password) : await core.register(username, password);
          if (!ack.ok) return fail(ack.error);
          if (!nameInput.value.trim()) nameInput.value = ack.username; // 昵称默认账号名
          renderAuth();
        };
        box.querySelector<HTMLButtonElement>('#sgs-login')!.onclick = () => doAuth('login');
        box.querySelector<HTMLButtonElement>('#sgs-register')!.onclick = () => doAuth('register');
      }
    };

    const renderStats = (stats: UserStats) => {
      const roles: Role[] = ['lord', 'loyalist', 'rebel', 'renegade'];
      const roleRows = roles
        .map((r) => {
          const s = stats.byRole[r];
          return `<div class="player-row"><span>${ROLE_LABEL[r]}</span><span>${s.games} 场 / 胜 ${s.wins}</span></div>`;
        })
        .join('');
      const recent = stats.recent
        .map((rec) => {
          const time = new Date(rec.playedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
          const result = rec.won ? '<span style="color:#7bd88f">胜</span>' : '<span style="color:#ff7b72">负</span>';
          return `<div class="player-row"><span>${time} ${matchModeLabel(rec)} ${matchRoleLabel(rec)} ${escapeHtml(rec.generalName)}</span><span>${result} · ${rec.survivedTurns} 回合</span></div>`;
        })
        .join('');
      $('#sgs-stats').innerHTML = `
        <div class="player-row"><span>总场次 ${stats.total}</span><span>胜率 ${winRateText(stats)}</span></div>
        ${roleRows}
        ${recent ? `<div class="hint" style="text-align:left;margin-top:8px">最近对局</div>${recent}` : '<div class="hint">还没有对局记录</div>'}
      `;
    };

    // ---------- 建房 / 加入 ----------

    $<HTMLButtonElement>('#sgs-create').onclick = async () => {
      const name = nameInput.value.trim();
      if (!name && !core.account) return fail('请输入昵称');
      const ack = await core.createRoom(name);
      if (!ack.ok) return fail(ack.error);
      this.gotoRoom(ack.room);
    };

    $<HTMLButtonElement>('#sgs-join').onclick = async () => {
      const name = nameInput.value.trim();
      const code = codeInput.value.trim().toUpperCase();
      if (!name && !core.account) return fail('请输入昵称');
      if (!code) return fail('请输入房间码');
      const ack = await core.joinRoom(code, name);
      if (!ack.ok) return fail(ack.error);
      this.gotoRoom(ack.room);
    };

    // 恢复登录态（刷新/换设备）：本地会话 token 有效则显示账号名并预填昵称
    void core.restoreAccount().then((account) => {
      if (account && !nameInput.value.trim()) nameInput.value = account.username;
      renderAuth();
    });
    renderAuth();

    // 刷新后的自动重连：凭 localStorage 里的 code + token 找回座位
    const saved = core.loadSession();
    if (saved) {
      nameInput.value = saved.name;
      codeInput.value = saved.code;
      hintEl.textContent = `正在重连房间 ${saved.code} …`;
      void core.rejoin(saved.code, saved.token).then((ack) => {
        hintEl.textContent = '';
        if (!ack.ok) {
          core.clearSession();
          return fail(`重连失败：${ack.error}`);
        }
        this.gotoRoom(ack.room);
      });
    }

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroyOverlay());
  }

  private gotoRoom(room: RoomInfo): void {
    this.scene.start(room.status === 'lobby' ? 'RoomScene' : 'TableScene');
  }

  private destroyOverlay(): void {
    this.overlay?.remove();
    this.overlay = null;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
