/**
 * 客户端 ↔ 服务器协议定义。
 *
 * 通信模型：
 * - 客户端 → 服务器的消息全部走"事件 + ack 回调"（socket.io 的 emit with ack），
 *   应答统一为 Ack<T>：{ ok: true, ... } 或 { ok: false, error }；
 * - 服务器 → 客户端为单向推送：大厅变化 room:update，游戏内状态 state:update（按视角过滤）、
 *   询问 ask（只发给被问的玩家）、等待广播 waiting（发给其他玩家）、公共日志 log。
 *
 * 断线重连：创建/加入房间时服务器下发 token，客户端持久化；
 * 重连后发 room:rejoin（code + token）找回座位，服务器随后全量下发
 * state:update，若正在等该玩家响应则重发 ask。
 */

import type { AskRequest, AskResponse } from '../../engine/src/asks.js';
import type { Card } from '../../engine/src/cards.js';
import type { Gender, Kingdom } from '../../engine/src/data/standard-generals.js';
import type { PhaseId } from '../../engine/src/phases.js';
import type { Role } from '../../engine/src/roles.js';

export type { AskRequest, AskResponse, Card, Role };

// ---------- 通用应答 ----------

export type Ack<T extends object = object> =
  | ({ ok: true } & T)
  | { ok: false; error: string };

// ---------- 大厅 ----------

export interface RoomPlayerInfo {
  id: string;
  name: string;
  isHost: boolean;
  ready: boolean;
  online: boolean;
  /** true = 账号玩家（已登录，战绩会入库）；false = 游客。 */
  account: boolean;
}

export interface RoomInfo {
  code: string;
  status: 'lobby' | 'playing' | 'over';
  players: RoomPlayerInfo[];
}

// ---------- 视角过滤后的游戏状态 ----------

/** 一名玩家的公开信息（任何视角都可见）。手牌内容不在其中，只有数量。 */
export interface PublicPlayer {
  id: string;
  name: string;
  seat: number;
  generalId?: string;
  generalName: string;
  /** 势力（公开信息，客户端显示势力标记；白板武将为 null）。 */
  kingdom: Kingdom | null;
  /** 性别（公开信息；离间/结姻等技能的合法性提示用）。 */
  gender: Gender;
  hp: number;
  maxHp: number;
  alive: boolean;
  handCount: number;
  /**
   * 身份按视角过滤后下发：主公与阵亡者全员可见，其他人只有本人可见
   * （对局结束时全员亮身份）。1v1 对决为 null。
   */
  role: Role | null;
  /** 装备区（武器/防具/+1马/-1马），所有人可见。 */
  equips: { weapon: Card | null; armor: Card | null; horsePlus: Card | null; horseMinus: Card | null };
  /** 判定区（延时锦囊），所有人可见。 */
  judgeArea: Card[];
  currentPhase: PhaseId | null;
  /** 托管中（断线或超时未操作，由服务器 AI 代打；重连后恢复）。 */
  trusted: boolean;
}

/**
 * 按视角生成的游戏状态：players 里只有公开信息；
 * 自己的手牌内容在 me.hand。state:update 对每个玩家各生成一份。
 */
export interface PublicState {
  code: string;
  status: 'playing' | 'over';
  turn: number;
  players: PublicPlayer[];
  /** 观察者本人：id / 座次 / 手牌内容（私有）/ 身份（私有）。 */
  me: { id: string; seat: number; hand: Card[]; role: Role | null };
  /** 牌堆剩余张数（无限牌堆为 null）。 */
  deckCount: number | null;
  discardCount: number;
  /** 弃牌堆顶（弃牌堆是公开信息）。 */
  discardTop: Card | null;
  /** 服务器正在等待响应的玩家（无等待时为 null）。 */
  pendingPlayerId: string | null;
  winnerId: string | null;
  /** 最近的公共日志（新条目在末尾）。 */
  logs: string[];
}

// ---------- 客户端 → 服务器（事件名 / 载荷 / ack） ----------

export interface CreateRoomPayload {
  name: string;
}
export type CreateRoomAck = Ack<{ room: RoomInfo; token: string; playerId: string }>;

export interface JoinRoomPayload {
  code: string;
  name: string;
}
export type JoinRoomAck = Ack<{ room: RoomInfo; token: string; playerId: string }>;

export interface RejoinPayload {
  code: string;
  token: string;
}
export type RejoinAck = Ack<{ room: RoomInfo; playerId: string }>;

export interface ReadyPayload {
  ready: boolean;
}

/** 房主开局参数（全部可选）：seed 控制牌堆洗牌与身份/选将随机；generals 按座次指定测试武将（指定后跳过选将环节）。 */
export interface StartGamePayload {
  seed?: number;
  /** 按座次指定武将 id（IMPLEMENTED_GENERAL_IDS 或 'blank'）；不足的人数随机补齐。 */
  generals?: string[];
  /** 按座次指定身份（测试用，须恰含 1 主公）；不传则由服务器按 seed 洗牌分配。 */
  roles?: Role[];
}

export interface RespondPayload {
  response: AskResponse;
}

/** 选将：客户端选定候选武将之一。 */
export interface PickGeneralPayload {
  generalId: string;
}

// ---------- 账号与战绩 ----------

export interface RegisterPayload {
  username: string;
  password: string;
}

export type LoginPayload = RegisterPayload;

/** auth:register / auth:login 成功：发会话 token（30 天），客户端持久化并在握手时带上。 */
export type AuthAck = Ack<{ token: string; username: string }>;

export type MatchMode = '1v1' | 'identity';

/** 一条战绩（只有账号玩家有；游客不记）。 */
export interface MatchRecord {
  id: number;
  /** 结束时间（epoch ms）。 */
  playedAt: number;
  mode: MatchMode;
  playerCount: number;
  /** 身份（1v1 为 null）。 */
  role: Role | null;
  generalId: string;
  generalName: string;
  won: boolean;
  /** 存活回合数（阵亡者 = 阵亡时已进行的回合数）。 */
  survivedTurns: number;
}

export interface RoleStat {
  games: number;
  wins: number;
}

/** stats:me 的聚合：总场次/胜率、按身份胜负、最近 10 场。 */
export interface UserStats {
  total: number;
  wins: number;
  /** 0~1，无场次时为 0。 */
  winRate: number;
  byRole: Record<Role, RoleStat>;
  recent: MatchRecord[];
}

/** stats:me 成功时顺带回用户名（客户端刷新后据此恢复登录态显示）。 */
export type StatsMeAck = Ack<{ username: string; stats: UserStats }>;

export const CLIENT_EVENTS = {
  createRoom: 'room:create',
  joinRoom: 'room:join',
  rejoin: 'room:rejoin',
  leave: 'room:leave',
  ready: 'room:ready',
  startGame: 'game:start',
  respond: 'game:respond',
  pickGeneral: 'general:pick',
  register: 'auth:register',
  login: 'auth:login',
  logout: 'auth:logout',
  statsMe: 'stats:me',
} as const;

// ---------- 服务器 → 客户端（事件名 / 载荷） ----------

export interface AskEvent {
  /** 单调递增的询问序号（客户端可据此识别重发/重问）。 */
  seq: number;
  ask: AskRequest;
  timeoutMs: number;
}

export interface WaitingEvent {
  playerId: string;
  playerName: string;
  kind: AskRequest['kind'];
}

export interface GameOverEvent {
  winnerId: string | null;
  winnerName: string | null;
  /** 身份局获胜方（内奸独胜时 winnerId 同时为该玩家）；1v1 为 null。 */
  winSide: Role | null;
}

/** 身份私发：开局时只发给本人（重连补发）。 */
export interface RoleAssignEvent {
  role: Role;
  label: string;
  /** 该身份的获胜条件一句话提示。 */
  objective: string;
}

/** 选将候选武将（事实数据：名字/势力/性别/体力/技能描述）。 */
export interface GeneralCandidate {
  id: string;
  name: string;
  kingdom: string;
  gender: Gender;
  hp: number;
  skills: { id: string; name: string; description: string }[];
}

/** 选将询问：只发给本人；超时由服务器随机分配。 */
export interface GeneralChooseEvent {
  candidates: GeneralCandidate[];
  timeoutMs: number;
}

export const SERVER_EVENTS = {
  roomUpdate: 'room:update',
  stateUpdate: 'state:update',
  ask: 'ask',
  waiting: 'waiting',
  log: 'log',
  gameOver: 'game:over',
  roleAssign: 'role:assign',
  generalChoose: 'general:choose',
} as const;
