/**
 * ClientCore：客户端协议接入层（不依赖 Phaser / DOM，可单测、可无头跑）。
 *
 * 职责：
 * - 封装 socket 的 emit+ack 为 Promise 方法（createRoom/joinRoom/rejoin/leave/ready/startGame/respond）；
 * - 订阅服务器推送，维护会话状态（房间、游戏状态、当前询问、等待提示、日志、结算）；
 * - 断线重连会话（code + token）的持久化（存储可注入，浏览器用 localStorage）。
 *
 * 零信任原则：本层只搬运服务器下发的数据和玩家的操作意图，不做任何结算。
 */

import {
  CLIENT_EVENTS,
  SERVER_EVENTS,
  type Ack,
  type AskEvent,
  type AskResponse,
  type AuthAck,
  type CreateRoomAck,
  type GameOverEvent,
  type GeneralChooseEvent,
  type JoinRoomAck,
  type LoginPayload,
  type PublicState,
  type ReadyPayload,
  type RegisterPayload,
  type RejoinAck,
  type RoleAssignEvent,
  type RoomInfo,
  type StartGamePayload,
  type StatsMeAck,
  type UserStats,
  type WaitingEvent,
} from '../protocol.js';

/** socket.io-client Socket 的最小结构子集，方便测试用假 socket。 */
export interface SocketLike {
  emit(event: string, payload: unknown, ack?: (res: never) => void): void;
  on(event: string, cb: (data: never) => void): void;
}

/** 键值存储的最小结构子集（浏览器 localStorage / 测试内存实现）。 */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface SavedSession {
  code: string;
  token: string;
  name: string;
}

/** 已登录的账号身份（用户名；token 存在 storage 里）。 */
export interface AccountInfo {
  username: string;
}

/** 当前等待我响应的询问（含收到时的本地时间戳，用于倒计时条）。 */
export interface CurrentAsk {
  seq: number;
  ask: AskEvent['ask'];
  timeoutMs: number;
  receivedAt: number;
}

/** 进行中的选将（含收到时的本地时间戳，用于倒计时）。 */
export interface DraftState {
  candidates: GeneralChooseEvent['candidates'];
  timeoutMs: number;
  receivedAt: number;
  /** 已提交选择，等待服务器确认/其他玩家完成。 */
  pickedId: string | null;
}

export interface CoreSnapshot {
  room: RoomInfo | null;
  state: PublicState | null;
  currentAsk: CurrentAsk | null;
  waiting: WaitingEvent | null;
  gameOver: GameOverEvent | null;
  logs: string[];
  myPlayerId: string | null;
  /** 我的身份（身份局开局私发；1v1 为 null）。 */
  myRole: RoleAssignEvent | null;
  /** 进行中的选将（无则 null）。 */
  draft: DraftState | null;
  /** 当前登录的账号（游客为 null）。 */
  account: AccountInfo | null;
}

export type CoreEventMap = {
  /** 任何快照字段变化都会触发（场景据此全量重绘）。 */
  change: (snap: CoreSnapshot) => void;
  /** 单条日志追加（快照里的 logs 也会同步更新）。 */
  log: (message: string) => void;
};

type CoreEventName = keyof CoreEventMap;

const STORAGE_KEYS = { code: 'sgs.code', token: 'sgs.token', name: 'sgs.name', session: 'sgs.session' } as const;
const LOG_LIMIT = 50;

export class ClientCore {
  room: RoomInfo | null = null;
  state: PublicState | null = null;
  currentAsk: CurrentAsk | null = null;
  waiting: WaitingEvent | null = null;
  gameOver: GameOverEvent | null = null;
  logs: string[] = [];
  myPlayerId: string | null = null;
  myRole: RoleAssignEvent | null = null;
  draft: DraftState | null = null;
  /** 当前登录的账号（游客为 null）。 */
  account: AccountInfo | null = null;

  /** 已收到过的 ask seq（识别重发）；已应答的 seq 也在这里。 */
  private readonly seenAskSeqs = new Set<number>();
  private readonly listeners = new Map<CoreEventName, Set<(data: never) => void>>();

  constructor(
    private readonly socket: SocketLike,
    private readonly storage: StorageLike | null = null,
  ) {
    socket.on(SERVER_EVENTS.roomUpdate, (room: RoomInfo) => {
      this.room = room;
      this.emitChange();
    });
    socket.on(SERVER_EVENTS.stateUpdate, (state: PublicState) => {
      // 再来一局：新一局的首个状态到达（上一局已结算），清掉上一局的
      // 结算/身份/选将/询问/等待与 ask 去重记录，从头接收新一局的开局推送
      if (this.gameOver && state.status === 'playing') {
        this.gameOver = null;
        this.myRole = null;
        this.draft = null;
        this.currentAsk = null;
        this.waiting = null;
        this.seenAskSeqs.clear();
      }
      this.state = state;
      this.logs = state.logs.slice(-LOG_LIMIT);
      // pendingPlayerId 已指向别人或为空时，清掉过期的等待提示
      if (this.waiting && state.pendingPlayerId !== this.waiting.playerId) this.waiting = null;
      // 我的武将已确定（选将结算完成）时清掉选将界面
      if (this.draft) {
        const mePub = state.players.find((p) => p.id === state.me.id);
        if (mePub && mePub.generalId && mePub.generalId !== 'blank') this.draft = null;
      }
      this.emitChange();
    });
    socket.on(SERVER_EVENTS.ask, (event: AskEvent) => {
      if (this.seenAskSeqs.has(event.seq)) return; // 重发/重问去重
      this.seenAskSeqs.add(event.seq);
      this.currentAsk = {
        seq: event.seq,
        ask: event.ask,
        timeoutMs: event.timeoutMs,
        receivedAt: Date.now(),
      };
      this.waiting = null;
      this.emitChange();
    });
    socket.on(SERVER_EVENTS.waiting, (event: WaitingEvent) => {
      this.waiting = event;
      this.emitChange();
    });
    socket.on(SERVER_EVENTS.log, (event: { message: string }) => {
      this.logs.push(event.message);
      if (this.logs.length > LOG_LIMIT) this.logs.splice(0, this.logs.length - LOG_LIMIT);
      this.notify('log', event.message);
    });
    socket.on(SERVER_EVENTS.gameOver, (event: GameOverEvent) => {
      this.gameOver = event;
      this.currentAsk = null;
      this.waiting = null;
      this.draft = null;
      this.emitChange();
    });
    socket.on(SERVER_EVENTS.roleAssign, (event: RoleAssignEvent) => {
      this.myRole = event;
      this.emitChange();
    });
    socket.on(SERVER_EVENTS.generalChoose, (event: GeneralChooseEvent) => {
      this.draft = {
        candidates: event.candidates,
        timeoutMs: event.timeoutMs,
        receivedAt: Date.now(),
        pickedId: null,
      };
      this.emitChange();
    });
  }

  // ---------- 订阅 ----------

  on<E extends CoreEventName>(event: E, cb: CoreEventMap[E]): void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(cb as (data: never) => void);
  }

  off<E extends CoreEventName>(event: E, cb: CoreEventMap[E]): void {
    this.listeners.get(event)?.delete(cb as (data: never) => void);
  }

  snapshot(): CoreSnapshot {
    return {
      room: this.room,
      state: this.state,
      currentAsk: this.currentAsk,
      waiting: this.waiting,
      gameOver: this.gameOver,
      logs: [...this.logs],
      myPlayerId: this.myPlayerId,
      myRole: this.myRole,
      draft: this.draft,
      account: this.account,
    };
  }

  // ---------- 账号（登录与否都不影响游客流程） ----------

  async register(username: string, password: string): Promise<AuthAck> {
    const payload: RegisterPayload = { username, password };
    return this.handleAuthAck(await this.ack<AuthAck>(CLIENT_EVENTS.register, payload));
  }

  async login(username: string, password: string): Promise<AuthAck> {
    const payload: LoginPayload = { username, password };
    return this.handleAuthAck(await this.ack<AuthAck>(CLIENT_EVENTS.login, payload));
  }

  private handleAuthAck(ack: AuthAck): AuthAck {
    if (ack.ok) {
      this.account = { username: ack.username };
      this.storage?.setItem(STORAGE_KEYS.session, ack.token);
      this.emitChange();
    }
    return ack;
  }

  async logout(): Promise<Ack> {
    const ack = await this.ack<Ack>(CLIENT_EVENTS.logout, {});
    this.account = null;
    this.storage?.removeItem(STORAGE_KEYS.session);
    this.emitChange();
    return ack;
  }

  /** 我的战绩（需登录；同时可用于刷新后校验会话并取回用户名）。 */
  fetchStats(): Promise<StatsMeAck> {
    return this.ack<StatsMeAck>(CLIENT_EVENTS.statsMe, {});
  }

  /**
   * 页面加载时恢复登录态：本地有会话 token 就用它问一次 stats:me
   * （握手时已带上 token，服务器据此识别身份）；失效则清除。
   */
  async restoreAccount(): Promise<AccountInfo | null> {
    if (!this.storage?.getItem(STORAGE_KEYS.session)) return null;
    const ack = await this.fetchStats();
    if (ack.ok) {
      this.account = { username: ack.username };
      this.emitChange();
      return this.account;
    }
    this.storage.removeItem(STORAGE_KEYS.session);
    return null;
  }

  /** 当前账号会话 token（socket 握手 auth 用；main.ts 建连时读取）。 */
  static sessionTokenKey(): string {
    return STORAGE_KEYS.session;
  }

  // ---------- 大厅操作 ----------

  async createRoom(name: string): Promise<CreateRoomAck> {
    const ack = await this.ack<CreateRoomAck>(CLIENT_EVENTS.createRoom, { name });
    if (ack.ok) {
      this.room = ack.room;
      this.myPlayerId = ack.playerId;
      this.saveSession(ack.room.code, ack.token, name);
    }
    return ack;
  }

  async joinRoom(code: string, name: string): Promise<JoinRoomAck> {
    const ack = await this.ack<JoinRoomAck>(CLIENT_EVENTS.joinRoom, { code, name });
    if (ack.ok) {
      this.room = ack.room;
      this.myPlayerId = ack.playerId;
      this.saveSession(ack.room.code, ack.token, name);
    }
    return ack;
  }

  /** 凭持久化的 code + token 找回座位；成功后会由服务器全量补发 room/state/ask。 */
  async rejoin(code: string, token: string): Promise<RejoinAck> {
    const ack = await this.ack<RejoinAck>(CLIENT_EVENTS.rejoin, { code, token });
    if (ack.ok) {
      this.room = ack.room;
      this.myPlayerId = ack.playerId;
    }
    return ack;
  }

  async leave(): Promise<Ack> {
    const ack = await this.ack<Ack>(CLIENT_EVENTS.leave, {});
    this.clearSession();
    this.room = null;
    this.state = null;
    this.currentAsk = null;
    this.waiting = null;
    this.gameOver = null;
    this.logs = [];
    this.myPlayerId = null;
    this.myRole = null;
    this.draft = null;
    this.seenAskSeqs.clear();
    this.emitChange();
    return ack;
  }

  setReady(ready: boolean): Promise<Ack> {
    const payload: ReadyPayload = { ready };
    return this.ack<Ack>(CLIENT_EVENTS.ready, payload);
  }

  startGame(payload: StartGamePayload = {}): Promise<Ack> {
    return this.ack<Ack>(CLIENT_EVENTS.startGame, payload);
  }

  // ---------- 游戏内操作 ----------

  /**
   * 回应当前询问。发出后立刻清空本地 currentAsk（乐观更新）：
   * 若响应非法，引擎会重问，服务器会发一条新 seq 的 ask 补回来。
   */
  async respond(response: AskResponse): Promise<Ack> {
    const ack = await this.ack<Ack>(CLIENT_EVENTS.respond, { response });
    this.currentAsk = null;
    this.emitChange();
    return ack;
  }

  /** 选将：选定一个候选武将。成功后标记 pickedId（等服务器结算后下发状态）。 */
  async pickGeneral(generalId: string): Promise<Ack> {
    const ack = await this.ack<Ack>(CLIENT_EVENTS.pickGeneral, { generalId });
    if (ack.ok && this.draft) {
      this.draft = { ...this.draft, pickedId: generalId };
      this.emitChange();
    }
    return ack;
  }

  // ---------- 会话持久化 ----------

  private saveSession(code: string, token: string, name: string): void {
    if (!this.storage) return;
    this.storage.setItem(STORAGE_KEYS.code, code);
    this.storage.setItem(STORAGE_KEYS.token, token);
    this.storage.setItem(STORAGE_KEYS.name, name);
  }

  loadSession(): SavedSession | null {
    if (!this.storage) return null;
    const code = this.storage.getItem(STORAGE_KEYS.code);
    const token = this.storage.getItem(STORAGE_KEYS.token);
    const name = this.storage.getItem(STORAGE_KEYS.name) ?? '';
    return code && token ? { code, token, name } : null;
  }

  clearSession(): void {
    if (!this.storage) return;
    this.storage.removeItem(STORAGE_KEYS.code);
    this.storage.removeItem(STORAGE_KEYS.token);
  }

  // ---------- 内部 ----------

  private ack<T extends Ack<object>>(event: string, payload: unknown): Promise<T> {
    return new Promise((resolve) => {
      this.socket.emit(event, payload, (res: T) => resolve(res));
    });
  }

  private emitChange(): void {
    this.notify('change', this.snapshot());
  }

  private notify<E extends CoreEventName>(event: E, data: Parameters<CoreEventMap[E]>[0]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const cb of set) (cb as CoreEventMap[E])(data as never);
  }
}
