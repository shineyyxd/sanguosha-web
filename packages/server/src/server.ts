/**
 * Socket.IO 接线层：把协议消息路由到 RoomManager / GameSession。
 *
 * 每个 socket 通过 socket.data.binding 绑定到（房间码, 玩家 id）；
 * 所有客户端消息都是 "emit + ack 回调" 形式，非法请求只在 ack 里报错，不崩服务。
 */

import { createServer, type Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import type { AskResponse, Role } from '../../engine/src/index.js';
import { AuthService } from './auth.js';
import { SqliteRepository, type GameRepository, type NewMatchRecord } from './repository.js';
import { createStaticHandler } from './static.js';
import {
  CLIENT_EVENTS,
  SERVER_EVENTS,
  type Ack,
  type AuthAck,
  type CreateRoomAck,
  type CreateRoomPayload,
  type JoinRoomAck,
  type JoinRoomPayload,
  type LoginPayload,
  type PickGeneralPayload,
  type ReadyPayload,
  type RegisterPayload,
  type RejoinAck,
  type RejoinPayload,
  type RespondPayload,
  type StartGamePayload,
  type StatsMeAck,
} from './protocol.js';
import { MIN_PLAYERS, Room, RoomManager, type RoomPlayer } from './rooms.js';
import { GameSession, type SessionOptions } from './session.js';

interface Binding {
  code: string;
  playerId: string;
}

/** 已登录的 socket 身份（握手 token 或 auth:login 成功后挂上）。 */
interface AuthedUser {
  id: number;
  username: string;
  /** 本次会话的 token（登出时按它删 sessions 行）。 */
  token: string;
}

export interface GameServerOptions extends SessionOptions {
  /** CORS origin，默认 *（开发用）。 */
  corsOrigin?: string | string[];
  /**
   * 生产模式：静态托管目录（client 构建产物 client/dist）。
   * 设置后 http://IP:端口/ 直接返回游戏页面，与 Socket.IO 同端口。
   */
  staticDir?: string;
  /**
   * SQLite 数据库文件路径（':memory:' 为内存库，测试用）。
   * 与 repository 二选一；都不传则不开启账号系统（纯游客模式，局域网面杀默认）。
   */
  dbPath?: string;
  /** 注入自定义持久化实现（以后换 PostgreSQL 只换这里）。优先级高于 dbPath。 */
  repository?: GameRepository;
}

export interface GameServer {
  io: Server;
  httpServer: HttpServer;
  rooms: RoomManager;
  /** 账号服务（未配置 dbPath/repository 时为 null，auth:* 事件统一返回未开启）。 */
  auth: AuthService | null;
  /** 实际监听端口（listen 后可用）。 */
  port(): number;
  listen(port: number): Promise<void>;
  close(): Promise<void>;
}

type Cb<T extends Ack<object>> = (ack: T) => void;

const ok = <T extends object>(extra?: T): { ok: true } & T =>
  ({ ok: true, ...(extra ?? {}) }) as { ok: true } & T;
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

function validName(name: unknown): name is string {
  return typeof name === 'string' && name.trim().length > 0 && name.length <= 24;
}

/**
 * 局末判定一名玩家是否获胜：
 * - 1v1（无身份）：只有最后站着的人赢；
 * - 身份局：主忠同边（winSide=lord），反贼同边，内奸独胜。
 */
export function didWin(
  role: Role | null,
  winSide: Role | null,
  winnerId: string | null,
  playerId: string,
): boolean {
  if (!role) return winnerId === playerId;
  if (winSide === 'lord') return role === 'lord' || role === 'loyalist';
  if (winSide === 'rebel') return role === 'rebel';
  if (winSide === 'renegade') return role === 'renegade';
  return false;
}

export function createGameServer(options: GameServerOptions = {}): GameServer {
  // 静态 handler 必须先于 Socket.IO 挂到 httpServer 上：engine.io 的 attach 会捕获
  // 已有 request 监听器，并把非 /socket.io 路径的请求转发回它们。
  const staticHandler = options.staticDir ? createStaticHandler(options.staticDir) : undefined;
  const httpServer = createServer((req, res) => {
    if (staticHandler) return staticHandler(req, res);
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not Found');
  });
  const io = new Server(httpServer, {
    cors: { origin: options.corsOrigin ?? '*' },
  });
  const rooms = new RoomManager();
  /** roomCode → 进行中的会话（结束后保留供 state 查询，房间销毁时一并消失）。 */
  const sessions = new Map<string, GameSession>();

  // 账号系统：配置了 dbPath 或注入了 repository 才开启；否则 auth:* 统一返回"未开启"
  const repository = options.repository ?? (options.dbPath ? new SqliteRepository(options.dbPath) : null);
  const auth = repository ? new AuthService(repository) : null;

  const bindingOf = (socket: Socket): Binding | null => (socket.data.binding as Binding) ?? null;
  const authedOf = (socket: Socket): AuthedUser | null => (socket.data.user as AuthedUser) ?? null;

  const bindPlayer = (socket: Socket, room: Room, player: RoomPlayer): void => {
    socket.data.binding = { code: room.code, playerId: player.id } satisfies Binding;
    player.socketId = socket.id;
    player.online = true;
    void socket.join(room.code);
  };

  const broadcastRoom = (room: Room): void => {
    io.to(room.code).emit(SERVER_EVENTS.roomUpdate, room.toInfo());
  };

  /**
   * 局末战绩入库：只给账号玩家（RoomPlayer.userId）写 match_records，游客跳过。
   * 写入失败只记日志，不影响结算与"再来一局"。
   */
  const recordMatches = (room: Room, session: GameSession): void => {
    if (!repository || !session.result) return;
    const result = session.result;
    const mode = session.identity ? 'identity' : '1v1';
    const now = Date.now();
    for (const seat of room.players) {
      if (seat.userId == null) continue;
      const p = session.game.getPlayer(seat.id);
      const record: NewMatchRecord = {
        userId: seat.userId,
        playedAt: now,
        mode,
        playerCount: room.players.length,
        role: p.role,
        generalId: p.general.id ?? 'blank',
        generalName: p.general.name,
        won: didWin(p.role, result.winSide, result.winner?.id ?? null, seat.id),
        survivedTurns: session.deathTurn.get(seat.id) ?? result.turns,
      };
      try {
        repository.addMatchRecord(record);
      } catch (err) {
        console.error(`[sgs] 战绩入库失败（user ${seat.userId}）：`, err);
      }
    }
  };

  /** 离开=大厅里移除座位；断线（含大厅与对局中）=只标记离线，座位保留，凭 token 重连。 */
  const detach = (socket: Socket, intentionalLeave: boolean): void => {
    const binding = bindingOf(socket);
    if (!binding) return;
    const room = rooms.get(binding.code);
    if (!room) {
      socket.data.binding = null;
      return;
    }
    const player = room.players.find((p) => p.id === binding.playerId);
    if (player && player.socketId === socket.id) {
      if (room.status === 'lobby' && intentionalLeave) {
        room.removePlayer(player.id);
      } else {
        room.markOffline(player.id);
        // 对局中断线：立即进入托管，轮到 AI 代打，整桌不用等超时
        if (room.status === 'playing') sessions.get(room.code)?.enterTrusteeship(player.id);
      }
      broadcastRoom(room);
      rooms.deleteIfEmpty(room);
    }
    void socket.leave(room.code);
    socket.data.binding = null;
  };

  io.on('connection', (socket) => {
    // 握手鉴权：客户端把账号会话 token 放在 handshake.auth.token（ws 与 http 轮询都会带），
    // 有效则该连接上的建房/加入自动绑定账号；游客不带上，行为与以前完全一致。
    if (auth) {
      const user = auth.resolve(socket.handshake.auth?.token);
      if (user) {
        socket.data.user = {
          id: user.id,
          username: user.username,
          token: String(socket.handshake.auth.token),
        } satisfies AuthedUser;
      }
    }

    // 统一包一层：无 ack 回调的异常客户端直接忽略；handler 抛错转成 ack error，不崩服务
    const on = <P, A extends Ack<object>>(
      event: string,
      handler: (payload: P, cb: Cb<A>) => void,
    ): void => {
      socket.on(event, (payload: P, cb: unknown) => {
        if (typeof cb !== 'function') return;
        try {
          handler(payload, cb as Cb<A>);
        } catch (err) {
          const ack: Ack = { ok: false, error: err instanceof Error ? err.message : String(err) };
          (cb as (a: Ack) => void)(ack);
        }
      });
    };

    // ---------- 账号（emit + ack；登不登录都不影响建房/加入的游客流程） ----------

    const handleAuth = (res: ReturnType<AuthService['login']>, cb: Cb<AuthAck>): void => {
      if (!res.ok) return cb(fail(res.error));
      socket.data.user = { id: res.user.id, username: res.user.username, token: res.token } satisfies AuthedUser;
      cb(ok({ token: res.token, username: res.user.username }));
    };

    on(CLIENT_EVENTS.register, (payload: RegisterPayload, cb: Cb<AuthAck>) => {
      if (!auth) return cb(fail('服务器未开启账号系统'));
      handleAuth(auth.register(payload?.username, payload?.password), cb);
    });

    on(CLIENT_EVENTS.login, (payload: LoginPayload, cb: Cb<AuthAck>) => {
      if (!auth) return cb(fail('服务器未开启账号系统'));
      handleAuth(auth.login(payload?.username, payload?.password), cb);
    });

    on(CLIENT_EVENTS.logout, (_payload: unknown, cb: Cb<Ack>) => {
      const user = authedOf(socket);
      if (auth && user) auth.logout(user.token);
      socket.data.user = null;
      cb(ok());
    });

    on(CLIENT_EVENTS.statsMe, (_payload: unknown, cb: Cb<StatsMeAck>) => {
      if (!auth) return cb(fail('服务器未开启账号系统'));
      const user = authedOf(socket);
      if (!user) return cb(fail('需要登录后才能查看战绩'));
      cb(ok({ username: user.username, stats: auth.statsFor(user.id) }));
    });

    // ---------- 大厅 ----------

    on(CLIENT_EVENTS.createRoom, (payload: CreateRoomPayload, cb: Cb<CreateRoomAck>) => {
      try {
        const user = authedOf(socket);
        // 登录玩家的昵称缺省用账号名（客户端也可显式指定，不影响账号本身）
        const name = validName(payload?.name) ? payload.name.trim() : (user?.username ?? '');
        if (!name) return cb(fail('昵称不能为空且不超过 24 字'));
        detach(socket, true); // 一个 socket 同时只在一个房间
        const { room, player } = rooms.createRoom(name, socket.id, user?.id);
        bindPlayer(socket, room, player);
        broadcastRoom(room);
        cb(ok({ room: room.toInfo(), token: player.token, playerId: player.id }));
      } catch (err) {
        cb(fail(err instanceof Error ? err.message : String(err)));
      }
    });

    on(CLIENT_EVENTS.joinRoom, (payload: JoinRoomPayload, cb: Cb<JoinRoomAck>) => {
      const user = authedOf(socket);
      const name = validName(payload?.name) ? payload.name.trim() : (user?.username ?? '');
      if (!name) return cb(fail('昵称不能为空且不超过 24 字'));
      const room = rooms.get(String(payload?.code ?? ''));
      if (!room) return cb(fail('房间不存在'));
      detach(socket, true);
      const player = room.addPlayer(name, crypto.randomUUID(), socket.id, user?.id);
      if ('ok' in player) return cb(fail(player.error));
      bindPlayer(socket, room, player);
      broadcastRoom(room);
      cb(ok({ room: room.toInfo(), token: player.token, playerId: player.id }));
    });

    on(CLIENT_EVENTS.rejoin, (payload: RejoinPayload, cb: Cb<RejoinAck>) => {
      const room = rooms.get(String(payload?.code ?? ''));
      if (!room) return cb(fail('房间不存在'));
      let player = room.findByToken(String(payload?.token ?? ''));
      if (!player) {
        // 座位 token 失效（换了设备/清了缓存）但账号还在：凭握手里的会话找回自己的座位
        const user = authedOf(socket);
        if (user) player = room.players.find((p) => p.userId === user.id);
        if (!player) return cb(fail('token 无效，无法找回座位'));
      }
      // 座位正被另一个活跃连接占用（典型：同一浏览器开第二个标签页，共享 localStorage
      // 里的会话而自动重连）：必须拒绝而不是静默抢座——否则原窗口再也收不到
      // 定向下发的 state:update / ask（表现为"轮到自己却出不了牌"），且其
      // room:leave 还会误删座位。刷新重连时旧 socket 已断开（online=false），不受影响。
      if (player.online && player.socketId && player.socketId !== socket.id) {
        return cb(fail(`「${player.name}」已在另一个窗口在线，请先关闭原窗口再重连`));
      }
      detach(socket, true);
      bindPlayer(socket, room, player);
      broadcastRoom(room);
      cb(ok({ room: room.toInfo(), playerId: player.id }));
      // 对局中：解除托管（恢复手动）；全量下发当前视角状态；补发身份/选将；若正在等他响应则重发该询问
      const session = sessions.get(room.code);
      if (session && room.status === 'playing') session.exitTrusteeship(player.id);
      if (session && room.status !== 'lobby') {
        socket.emit(SERVER_EVENTS.stateUpdate, session.stateFor(player.id));
        session.resendSetupTo(player.id);
        session.resendPendingTo(player.id);
      }
    });

    // 所有消息都是 "载荷对象 + ack 回调"；缺回调（异常客户端）直接忽略
    on(CLIENT_EVENTS.leave, (_payload: unknown, cb: Cb<Ack>) => {
      if (typeof cb !== 'function') return;
      detach(socket, true);
      cb(ok());
    });

    on(CLIENT_EVENTS.ready, (payload: ReadyPayload, cb: Cb<Ack>) => {
      const binding = bindingOf(socket);
      const room = binding && rooms.get(binding.code);
      if (!room || !binding) return cb(fail('你不在任何房间中'));
      const player = room.players.find((p) => p.id === binding.playerId);
      if (!player) return cb(fail('找不到你的座位'));
      player.ready = Boolean(payload?.ready);
      broadcastRoom(room);
      cb(ok());
    });

    on(CLIENT_EVENTS.startGame, (payload: StartGamePayload, cb: Cb<Ack>) => {
      const binding = bindingOf(socket);
      const room = binding && rooms.get(binding.code);
      if (!room || !binding) return cb(fail('你不在任何房间中'));
      if (room.host?.id !== binding.playerId) return cb(fail('只有房主可以开局'));
      if (room.status !== 'lobby' && room.status !== 'over') return cb(fail('对局已开始'));
      if (room.players.length < MIN_PLAYERS) return cb(fail(`至少 ${MIN_PLAYERS} 人才能开局`));
      // 大厅首次开局要求全员准备；结算后再来一局保留座位直接开，不再要求重新准备
      if (room.status === 'lobby') {
        const notReady = room.players.filter((p) => !p.isHost && !p.ready);
        if (notReady.length > 0) return cb(fail(`还有玩家未准备：${notReady.map((p) => p.name).join('、')}`));
      }

      // 再来一局：旧会话已随上一局结束（run() 完结），整体丢弃重建，
      // Game 实例 / 等待中的询问 / 选将状态全部归零；座位与连接沿用房间里的玩家记录
      sessions.delete(room.code);
      let session: GameSession;
      try {
        session = new GameSession(io, room.code, room.players, {
          seed: payload?.seed,
          generals: payload?.generals,
          roles: payload?.roles,
          askTimeoutMs: options.askTimeoutMs,
          botDelayMs: options.botDelayMs,
          debugLog: options.debugLog,
        });
      } catch (err) {
        return cb(fail(err instanceof Error ? err.message : String(err)));
      }
      sessions.set(room.code, session);
      room.status = 'playing';
      broadcastRoom(room);
      cb(ok());
      // 异步泵在后台驱动整局；首轮状态与询问由 pump 内部下发
      void session.run().then(() => {
        room.status = 'over';
        recordMatches(room, session); // 局末战绩入库（账号玩家；游客跳过）
        broadcastRoom(room);
      });
    });

    on(CLIENT_EVENTS.respond, (payload: RespondPayload, cb: Cb<Ack>) => {
      const binding = bindingOf(socket);
      const session = binding && sessions.get(binding.code);
      if (!session || !binding) return cb(fail('没有进行中的对局'));
      cb(session.handleResponse(binding.playerId, payload?.response as AskResponse));
    });

    on(CLIENT_EVENTS.pickGeneral, (payload: PickGeneralPayload, cb: Cb<Ack>) => {
      const binding = bindingOf(socket);
      const session = binding && sessions.get(binding.code);
      if (!session || !binding) return cb(fail('没有进行中的对局'));
      cb(session.handleGeneralPick(binding.playerId, String(payload?.generalId ?? '')));
    });

    socket.on('disconnect', () => detach(socket, false));
  });

  return {
    io,
    httpServer,
    rooms,
    auth,
    port() {
      const addr = httpServer.address();
      return typeof addr === 'object' && addr ? addr.port : 0;
    },
    listen(port: number) {
      // 绑定 0.0.0.0：局域网内其他设备（手机）可访问
      return new Promise((resolve) => httpServer.listen(port, '0.0.0.0', resolve));
    },
    close() {
      // 幂等：重复关闭不报错（测试里 beforeEach/afterEach 可能叠加调用）
      repository?.close();
      return new Promise<void>((resolve) => {
        try {
          io.close(() => resolve());
        } catch {
          resolve();
        }
      });
    },
  };
}
