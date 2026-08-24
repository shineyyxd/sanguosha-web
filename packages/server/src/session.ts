/**
 * GameSession —— 一个房间的一场游戏：Game 实例 + 分布式 Controller。
 *
 * 引擎的 generator 流程由这里的异步泵驱动：
 *   flow.next() 产出 AskRequest → 挂起，把询问发给对应玩家的 socket
 *   （只发给该玩家，其他人收到 waiting 广播）→ 等 game:respond 或超时 →
 *   把 AskResponse 喂回 flow.next() 继续。
 *
 * 职责边界：
 * - 合法性以引擎为准：引擎对非法响应会重新询问（重问机制），服务器只做
 *   "是不是该你动" 的路由校验，不重复实现规则；
 * - 超时是服务器的职责：超时自动生成放弃类响应（出牌阶段超时 = 结束出牌；
 *   五谷丰登选牌不可放弃，自动拿第一张）；
 * - 公共日志由事件总线生成（不用 game.log，它含摸牌内容等私有信息）。
 */

import type { Server } from 'socket.io';
import {
  BLANK_GENERAL,
  CARD_LABEL,
  Game,
  GENERAL_TEMPLATES,
  IDENTITY_MIN_PLAYERS,
  IMPLEMENTED_GENERAL_IDS,
  PHASE_LABEL,
  ROLE_LABEL,
  ROLE_OBJECTIVE,
  STANDARD_GENERALS,
  Standard108Deck,
  cardText,
  mulberry32,
  roleConfigFor,
  type AskRequest,
  type AskResponse,
  type GameFlow,
  type GameResult,
  type GeneralTemplate,
  type Role,
} from '../../engine/src/index.js';
import { buildPublicState } from './view.js';
import { botResponse } from './bot.js';
import {
  SERVER_EVENTS,
  type AskEvent,
  type GameOverEvent,
  type GeneralCandidate,
  type GeneralChooseEvent,
  type PublicState,
  type RoleAssignEvent,
  type WaitingEvent,
} from './protocol.js';

/** 会话需要知道的座位信息（与房间里的玩家记录共享引用）。 */
export interface SessionSeat {
  id: string;
  name: string;
  socketId: string | null;
  online: boolean;
}

export interface SessionOptions {
  seed?: number;
  /** 按座次指定武将 id（IMPLEMENTED_GENERAL_IDS 或 'blank'）；不足随机补齐。指定后跳过选将环节。 */
  generals?: string[];
  /** 按座次指定身份（测试用；须恰含 1 主公）。不传则身份局按 seed 洗牌分配。 */
  roles?: Role[];
  /** 询问超时毫秒数，默认 30s；超时自动视为放弃（选将超时随机分配）。 */
  askTimeoutMs?: number;
  /** 托管机器人应答延迟毫秒数，默认 400ms（不等人但不至于刷屏）。 */
  botDelayMs?: number;
  /** 引擎完整日志输出（含私有信息，仅供服务端调试）。 */
  debugLog?: (msg: string) => void;
}

const DEFAULT_ASK_TIMEOUT = 30_000;
const DEFAULT_BOT_DELAY = 400;

/**
 * 询问超时的兜底响应（真人未操作时由服务器代答）：
 * 不可放弃的询问给出一个合理的默认选择，其余视为放弃。
 */
export function timeoutResponseFor(game: Game, ask: AskRequest): AskResponse {
  // 五谷丰登选牌不可放弃（引擎会重问导致死等），自动拿第一张
  if (ask.kind === 'choose-card') return { cardId: ask.cards[0].id };
  // 弃牌阶段不可放弃：超时兜底，自动弃末尾的牌
  if (ask.kind === 'discard') {
    const hand = game.getPlayer(ask.playerId).hand;
    return { cardIds: hand.slice(-ask.count).map((c) => c.id) };
  }
  // 互斥选项（刚烈/反间）不可放弃：默认第一项（刚烈 = 弃两张手牌）
  if (ask.kind === 'choose-option') return { choice: ask.options[0].id };
  // 鬼才改判 / 观星 / 遗计分配：默认放弃（不改判 / 全部回顶 / 自己保留）
  return { pass: true };
}

interface PendingAsk {
  seq: number;
  ask: AskRequest;
  resolve: (res: AskResponse) => void;
  timer: NodeJS.Timeout;
  /** true = 当前由托管机器人计时（短延迟）；false = 等真人（完整超时）。 */
  bot: boolean;
}

/** 等待中的选将：candidateIds 限定了合法选择；bot=true 时用短延迟自动分配。 */
interface PendingDraft {
  candidates: GeneralCandidate[];
  resolve: (generalId: string) => void;
  timer: NodeJS.Timeout;
  /** true = 托管/离线，短延迟后自动分配；false = 等真人（完整超时）。 */
  bot: boolean;
  /** 计时到点：托管自动分配 / 真人超时随机分配并转托管。 */
  onTimeout: () => void;
}

/** 按开局参数解析武将模板；未知 id 抛错（由开局入口转成 ack error）。 */
export function resolveGenerals(options: SessionOptions, count: number, seed: number): GeneralTemplate[] {
  const rand = mulberry32(seed);
  const result: (GeneralTemplate | undefined)[] = (options.generals ?? []).map((id) => {
    if (id === 'blank') return BLANK_GENERAL;
    const t = GENERAL_TEMPLATES[id];
    if (!t) throw new Error(`未知或未实现的武将：${id}（可选：${IMPLEMENTED_GENERAL_IDS.join('、')}、blank）`);
    return t;
  });
  // 剩余座位从不重复的武将池里随机补齐
  const pool = IMPLEMENTED_GENERAL_IDS.filter((id) => !result.some((t) => t?.id === id));
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  while (result.length < count) result.push(GENERAL_TEMPLATES[pool.pop()!] ?? BLANK_GENERAL);
  return result.slice(0, count) as GeneralTemplate[];
}

const generalDataById = new Map(STANDARD_GENERALS.map((g) => [g.id, g]));

/** 为一名玩家生成选将候选（座内不重复，跨座可能重复；数据来自标准版武将事实数据）。 */
function dealCandidates(count: number, rand: () => number): GeneralCandidate[] {
  const pool = [...IMPLEMENTED_GENERAL_IDS];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count).map((id) => {
    const data = generalDataById.get(id)!;
    return { id: data.id, name: data.name, kingdom: data.kingdom, gender: data.gender, hp: data.hp, skills: data.skills };
  });
}

export class GameSession {
  readonly game: Game;
  readonly seed: number;
  /** 是否身份局（>= 4 人开局）。 */
  readonly identity: boolean;
  /** 身份局且未显式指定武将时需要走选将流程。 */
  private readonly draftNeeded: boolean;
  private readonly flow: GameFlow<GameResult>;
  private readonly askTimeoutMs: number;
  private readonly botDelayMs: number;
  private readonly logs: string[] = [];
  private pending: PendingAsk | null = null;
  private readonly draftPending = new Map<string, PendingDraft>();
  /** 托管中的玩家（断线或超时一次后进入；重连/手动响应解除）。 */
  private readonly trusted = new Set<string>();
  private askSeq = 0;
  private started = false;
  /** 开局出错或引擎异常时记录，供排查。 */
  error: string | null = null;
  /** 终局结果（run() 正常完结后可用，局末战绩入库用）。 */
  result: GameResult | null = null;
  /** 各玩家阵亡时已进行的回合数（局末算"存活回合数"用；活到最后的不在表里）。 */
  readonly deathTurn = new Map<string, number>();

  constructor(
    private readonly io: Server,
    readonly code: string,
    private readonly seats: SessionSeat[],
    options: SessionOptions = {},
  ) {
    this.seed = options.seed ?? Math.floor(Math.random() * 2 ** 31);
    this.askTimeoutMs = options.askTimeoutMs ?? DEFAULT_ASK_TIMEOUT;
    this.botDelayMs = options.botDelayMs ?? DEFAULT_BOT_DELAY;
    this.identity = seats.length >= IDENTITY_MIN_PLAYERS;
    this.draftNeeded = this.identity && !options.generals;

    // 身份：显式指定（测试）或按 seed 洗牌分配（独立随机流，不与牌堆/武将互相影响）
    let roles: Role[] | undefined;
    if (this.identity) {
      roles = options.roles ?? roleConfigFor(seats.length);
      if (!options.roles) {
        const rand = mulberry32(this.seed ^ 0x9e3779b9);
        for (let i = roles.length - 1; i > 0; i--) {
          const j = Math.floor(rand() * (i + 1));
          [roles[i], roles[j]] = [roles[j], roles[i]];
        }
      }
    }

    // 武将：显式指定（或 1v1 随机补齐）；身份局未指定时先用白板占位，走选将流程
    const generals =
      options.generals || !this.identity
        ? resolveGenerals(options, seats.length, this.seed)
        : seats.map(() => BLANK_GENERAL);

    this.game = new Game({
      playerNames: seats.map((s) => s.name),
      generals,
      deck: new Standard108Deck(this.seed),
      roles,
    });
    if (options.debugLog) this.game.onLog = options.debugLog;
    this.attachPublicLogging();
    this.flow = this.game.run();
  }

  // ---------- 公共日志（事件总线 → 广播；私有信息只出数量不出内容） ----------

  private pubLog(msg: string): void {
    this.logs.push(msg);
    this.io.to(this.code).emit(SERVER_EVENTS.log, { message: msg });
  }

  private attachPublicLogging(): void {
    const bus = this.game.bus;
    bus.on('turn-start', ({ player }) => this.pubLog(`—— ${player.name} 的回合 ——`));
    bus.on('phase-change', ({ phase }) => this.pubLog(`· ${PHASE_LABEL[phase]}`));
    bus.on('card-use', ({ player, card, target }) =>
      this.pubLog(`${player.name} 使用${cardText(card)}${target ? `，目标 ${target.name}` : ''}`),
    );
    bus.on('card-response', ({ player, card }) => this.pubLog(`${player.name} 打出${cardText(card)}`));
    bus.on('card-draw', ({ player, cards }) => this.pubLog(`${player.name} 摸了 ${cards.length} 张牌`));
    bus.on('card-discard', ({ player, cards }) =>
      this.pubLog(`${player.name} 弃置 ${cards.length} 张牌：${cards.map((c) => cardText(c)).join('')}`),
    );
    bus.on('damage', ({ source, target, amount }) =>
      this.pubLog(`${target.name} 受到 ${amount} 点伤害${source ? `（来自 ${source.name}）` : ''}`),
    );
    bus.on('recover', ({ player, amount }) => this.pubLog(`${player.name} 回复 ${amount} 点体力`));
    bus.on('dying', ({ player }) => this.pubLog(`${player.name} 进入濒死状态，求${CARD_LABEL.tao}……`));
    bus.on('death', ({ player }) => {
      this.pubLog(`${player.name} 死亡！`);
      this.deathTurn.set(player.id, this.game.turn); // 局末战绩的存活回合数
    });
    bus.on('judge', ({ player, card }) => this.pubLog(`${player.name} 的判定：${cardText(card)}`));
    bus.on('equip', ({ player, card }) => this.pubLog(`${player.name} 装备${cardText(card)}`));
  }

  // ---------- 状态下发（按视角过滤，逐玩家各发一份） ----------

  stateFor(playerId: string): PublicState {
    return buildPublicState(this.game, this.game.getPlayer(playerId), {
      code: this.code,
      pendingPlayerId: this.pending?.ask.playerId ?? null,
      logs: this.logs,
      trusted: this.trusted,
    });
  }

  broadcastState(): void {
    for (const seat of this.seats) {
      if (!seat.socketId) continue;
      this.io.to(seat.socketId).emit(SERVER_EVENTS.stateUpdate, this.stateFor(seat.id));
    }
  }

  // ---------- 身份与选将（身份局开局流程，先于引擎主循环） ----------

  /** 给每个玩家私发身份（只发本人；重连时由 resendSetupTo 补发）。 */
  private sendRoleAssigns(): void {
    for (const seat of this.seats) {
      if (!seat.socketId) continue;
      const role = this.game.getPlayer(seat.id).role;
      if (!role) continue;
      const event: RoleAssignEvent = { role, label: ROLE_LABEL[role], objective: ROLE_OBJECTIVE[role] };
      this.io.to(seat.socketId).emit(SERVER_EVENTS.roleAssign, event);
    }
    this.pubLog(`身份局开始：${this.seats.length} 名玩家，身份已私发`);
    this.broadcastState(); // 主公身份公开，先刷一轮状态
  }

  /**
   * 选将：给每人发候选武将（3 个，主公多 1 个），并行等待选择；
   * 超时（与询问同一时长）或离线未响应则由服务器按种子随机分配。
   */
  private async draftGenerals(): Promise<void> {
    const rand = mulberry32(this.seed ^ 0x51ab9e37);
    const picks = await Promise.all(
      this.seats.map((seat, i) => {
        const isLord = this.game.players[i].role === 'lord';
        const candidates = dealCandidates(isLord ? 4 : 3, rand);
        return this.askGeneralPick(seat, candidates, rand);
      }),
    );
    picks.forEach((generalId, i) => {
      const template = GENERAL_TEMPLATES[generalId];
      if (!template) return; // 理论不可达：候选与超时随机都来自合法池
      this.game.setGeneral(this.game.players[i], template);
      this.pubLog(`${this.seats[i].name} 选择了武将 ${template.name}`);
    });
    this.broadcastState();
  }

  private askGeneralPick(
    seat: SessionSeat,
    candidates: GeneralCandidate[],
    rand: () => number,
  ): Promise<string> {
    return new Promise((resolve) => {
      const randomPick = () => candidates[Math.floor(rand() * candidates.length)].id;
      // 离线/托管玩家不用等满超时，短延迟后自动分配（重连窗口留几百毫秒）
      const bot = !seat.socketId || this.trusted.has(seat.id);
      const pending: PendingDraft = {
        candidates,
        bot,
        timer: null as unknown as NodeJS.Timeout,
        resolve: (id) => {
          clearTimeout(pending.timer);
          resolve(id);
        },
        onTimeout: () => {
          this.draftPending.delete(seat.id);
          if (pending.bot) {
            this.pubLog(`${seat.name} 托管中，自动分配武将`);
          } else {
            this.pubLog(`${seat.name} 选将超时，随机分配`);
            this.enterTrusteeship(seat.id); // 超时一次即视为不在，转托管
          }
          resolve(randomPick());
        },
      };
      pending.timer = setTimeout(pending.onTimeout, bot ? this.botDelayMs : this.askTimeoutMs);
      this.draftPending.set(seat.id, pending);
      if (seat.socketId) {
        const event: GeneralChooseEvent = { candidates, timeoutMs: this.askTimeoutMs };
        this.io.to(seat.socketId).emit(SERVER_EVENTS.generalChoose, event);
      }
    });
  }

  /** 处理 general:pick；不是选将等待对象或候选非法则在 ack 里报错。 */
  handleGeneralPick(playerId: string, generalId: string): { ok: true } | { ok: false; error: string } {
    const pending = this.draftPending.get(playerId);
    if (!pending) return { ok: false, error: '当前没有等待你的选将' };
    if (!pending.candidates.some((c) => c.id === generalId)) {
      return { ok: false, error: '该武将不在你的候选列表中' };
    }
    this.draftPending.delete(playerId);
    pending.resolve(generalId);
    return { ok: true };
  }

  /** 重连补发开局信息：身份（私发）+ 等待中的选将询问（计时沿用原定时器）。 */
  resendSetupTo(playerId: string): void {
    const seat = this.seats.find((s) => s.id === playerId);
    if (!seat?.socketId) return;
    const role = this.game.getPlayer(playerId).role;
    if (role) {
      const event: RoleAssignEvent = { role, label: ROLE_LABEL[role], objective: ROLE_OBJECTIVE[role] };
      this.io.to(seat.socketId).emit(SERVER_EVENTS.roleAssign, event);
    }
    const draft = this.draftPending.get(playerId);
    if (draft) {
      const event: GeneralChooseEvent = { candidates: draft.candidates, timeoutMs: this.askTimeoutMs };
      this.io.to(seat.socketId).emit(SERVER_EVENTS.generalChoose, event);
    }
  }

  // ---------- 托管（断线/超时 → AI 代打；重连/手动响应 → 恢复） ----------

  /**
   * 进入托管：轮到该玩家时由机器人策略快速应答（botDelayMs，不等满超时）。
   * 若当前正在等该玩家响应，把他的询问从"等真人"切换为机器人计时。
   */
  enterTrusteeship(playerId: string): void {
    if (this.trusted.has(playerId)) return;
    this.trusted.add(playerId);
    const name = this.seats.find((s) => s.id === playerId)?.name ?? playerId;
    this.pubLog(`${name} 进入托管，由 AI 代打`);
    // 若正在等该玩家响应，把他的询问从"等真人"切换为机器人计时
    const pending = this.pending;
    if (pending && pending.ask.playerId === playerId && !pending.bot) {
      clearTimeout(pending.timer);
      pending.bot = true;
      pending.timer = setTimeout(() => this.resolveBot(pending), this.botDelayMs);
    }
    // 选将等待同理：缩短为自动分配
    const draft = this.draftPending.get(playerId);
    if (draft && !draft.bot) {
      clearTimeout(draft.timer);
      draft.bot = true;
      draft.timer = setTimeout(draft.onTimeout, this.botDelayMs);
    }
    this.broadcastState();
  }

  /**
   * 解除托管（重连或托管中手动响应）。若正在等该玩家且是机器人计时，
   * 切回完整超时等待，给真人留出操作时间（ask 由调用方/resendPendingTo 重发）。
   */
  exitTrusteeship(playerId: string): void {
    if (!this.trusted.delete(playerId)) return;
    const name = this.seats.find((s) => s.id === playerId)?.name ?? playerId;
    this.pubLog(`${name} 恢复手动操作（此前由 AI 托管）`);
    const pending = this.pending;
    if (pending && pending.ask.playerId === playerId && pending.bot) {
      clearTimeout(pending.timer);
      pending.bot = false;
      pending.timer = setTimeout(() => this.resolveTimeout(pending), this.askTimeoutMs);
    }
    // 选将等待切回完整超时（选将询问由 resendSetupTo 补发）
    const draft = this.draftPending.get(playerId);
    if (draft && draft.bot) {
      clearTimeout(draft.timer);
      draft.bot = false;
      draft.timer = setTimeout(draft.onTimeout, this.askTimeoutMs);
    }
    this.broadcastState();
  }

  /** 托管计时到点：用机器人策略应答（合法性由 bot.ts 的强保证 + 引擎重问兜底）。 */
  private resolveBot(pending: PendingAsk): void {
    if (this.pending !== pending) return;
    this.pending = null;
    pending.resolve(botResponse(this.game, pending.ask));
  }

  /** 真人超时：按放弃类响应兜底，且该玩家转入托管（免得每轮都等满超时）。 */
  private resolveTimeout(pending: PendingAsk): void {
    if (this.pending !== pending) return;
    this.pending = null;
    const name = this.seats.find((s) => s.id === pending.ask.playerId)?.name ?? pending.ask.playerId;
    this.pubLog(`${name} 超时未响应，自动放弃`);
    this.enterTrusteeship(pending.ask.playerId);
    pending.resolve(this.timeoutResponse(pending.ask));
  }

  // ---------- 询问路由与超时 ----------

  /** 处理客户端的 game:respond；不是当前等待对象则拒绝。托管玩家的手动响应会解除托管。 */
  handleResponse(playerId: string, response: AskResponse): { ok: true } | { ok: false; error: string } {
    const pending = this.pending;
    if (!pending) return { ok: false, error: '当前没有等待中的询问' };
    if (pending.ask.playerId !== playerId) return { ok: false, error: '还没轮到你响应' };
    this.exitTrusteeship(playerId); // 人还在操作：解除托管（若未托管则无操作）
    clearTimeout(pending.timer);
    this.pending = null;
    // 牌面合法性由引擎把关：非法响应会触发引擎重问，这里无条件放行
    pending.resolve(response);
    return { ok: true };
  }

  /** 重连后若正在等该玩家响应，重发该询问（计时重新开始）。 */
  resendPendingTo(playerId: string): void {
    const pending = this.pending;
    if (!pending || pending.ask.playerId !== playerId) return;
    const seat = this.seats.find((s) => s.id === playerId);
    if (!seat?.socketId) return;
    const event: AskEvent = { seq: pending.seq, ask: pending.ask, timeoutMs: this.askTimeoutMs };
    this.io.to(seat.socketId).emit(SERVER_EVENTS.ask, event);
  }

  private timeoutResponse(ask: AskRequest): AskResponse {
    return timeoutResponseFor(this.game, ask);
  }

  private askPlayer(ask: AskRequest): Promise<AskResponse> {
    return new Promise((resolve) => {
      const seq = ++this.askSeq;
      const target = this.seats.find((s) => s.id === ask.playerId);
      // 托管或离线的玩家由机器人快速应答（断线时 detach 已进入托管；
      // 开局前就离线的玩家靠 !online 兜底），整桌不用等满超时
      const bot = this.trusted.has(ask.playerId) || !target?.online;
      const pending: PendingAsk = { seq, ask, resolve, bot, timer: null as unknown as NodeJS.Timeout };
      pending.timer = bot
        ? setTimeout(() => this.resolveBot(pending), this.botDelayMs)
        : setTimeout(() => this.resolveTimeout(pending), this.askTimeoutMs);
      this.pending = pending;

      // 五谷丰登亮出的牌是公开信息（询问本身只发给选牌的人）
      if (ask.kind === 'choose-card') {
        this.pubLog(`${CARD_LABEL.wugu}亮出：${ask.cards.map((c) => cardText(c)).join('、')}`);
      }

      // 先刷新各视角状态（含 pendingPlayerId），让客户端在收到询问前看到最新局面
      this.broadcastState();

      // 询问只发给被问的玩家；其余玩家收到 waiting 广播
      if (target?.socketId) {
        const event: AskEvent = { seq, ask, timeoutMs: this.askTimeoutMs };
        this.io.to(target.socketId).emit(SERVER_EVENTS.ask, event);
      }
      const waiting: WaitingEvent = {
        playerId: ask.playerId,
        playerName: target?.name ?? ask.playerId,
        kind: ask.kind,
      };
      for (const seat of this.seats) {
        if (seat.id !== ask.playerId && seat.socketId) {
          this.io.to(seat.socketId).emit(SERVER_EVENTS.waiting, waiting);
        }
      }
    });
  }

  // ---------- 主循环 ----------

  /** 启动异步泵；引擎异常不会拖垮进程，记录 error 并广播结束。 */
  async run(): Promise<void> {
    if (this.started) return;
    this.started = true;
    try {
      // 身份局：先私发身份 + 选将（指定了 generals 的测试局跳过选将），再进主循环
      if (this.identity) {
        this.sendRoleAssigns();
        if (this.draftNeeded) await this.draftGenerals();
      }
      let step = this.flow.next();
      while (!step.done) {
        const res = await this.askPlayer(step.value);
        step = this.flow.next(res);
        this.broadcastState();
      }
      this.result = step.value;
      this.finish(step.value);
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
      this.pubLog(`对局异常终止：${this.error}`);
      this.broadcastState();
    }
  }

  private finish(result: GameResult): void {
    const event: GameOverEvent = {
      winnerId: result.winner?.id ?? null,
      winnerName: result.winner?.name ?? null,
      winSide: result.winSide,
    };
    this.pubLog(
      result.winSide
        ? `游戏结束，${ROLE_LABEL[result.winSide]}方获胜！`
        : result.winner
          ? `游戏结束，${result.winner.name} 获胜！`
          : '游戏结束，无人生还。',
    );
    for (const seat of this.seats) {
      if (seat.socketId) this.io.to(seat.socketId).emit(SERVER_EVENTS.gameOver, event);
    }
    this.broadcastState();
  }

  get pendingPlayerId(): string | null {
    return this.pending?.ask.playerId ?? null;
  }
}
