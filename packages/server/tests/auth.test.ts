/**
 * 账号系统与战绩：注册/登录/登出/会话恢复、战绩入库、stats:me 聚合。
 *
 * 数据库全部用 ':memory:' 内存库，测试间互不影响；
 * 完整对局用机器人客户端打完一局（与 full-game.test.ts 同套路）。
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { io as clientIo, type Socket } from 'socket.io-client';
import {
  CLIENT_EVENTS,
  SERVER_EVENTS,
  type AuthAck,
  type GameOverEvent,
  type RoomInfo,
  type StatsMeAck,
  type UserStats,
} from '../src/protocol.js';
import { didWin } from '../src/server.js';
import { hashPassword, verifyPassword } from '../src/auth.js';
import { SqliteRepository, type NewMatchRecord } from '../src/repository.js';
import {
  attachBot,
  closeAll,
  connect,
  emitAck,
  startTestServer,
  waitFor,
  type TestServer,
} from './helpers.js';

/** 带账号系统的测试服务器（内存库）。 */
function startAuthServer(): Promise<TestServer> {
  return startTestServer({ dbPath: ':memory:' });
}

/** 连接并在握手时带账号会话 token。 */
function connectWithToken(url: string, token: string): Promise<Socket> {
  const socket = clientIo(url, { transports: ['websocket'], forceNew: true, auth: { token } });
  return new Promise((resolve, reject) => {
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', reject);
  });
}

async function register(socket: Socket, username: string, password = 'secret123'): Promise<AuthAck> {
  return emitAck<AuthAck>(socket, CLIENT_EVENTS.register, { username, password });
}

describe('账号：注册 / 登录 / 登出', () => {
  let ts: TestServer;
  beforeEach(async () => {
    ts = await startAuthServer();
  });
  afterEach(async () => {
    await ts.server.close();
  });

  it('注册成功发会话 token，握手带上即识别身份（stats:me 返回账号名）', async () => {
    const s1 = await connect(ts.url);
    const reg = await register(s1, '曹操');
    expect(reg.ok).toBe(true);
    if (!reg.ok) return;
    expect(reg.username).toBe('曹操');
    expect(reg.token.length).toBeGreaterThan(10);

    // 新连接（模拟刷新/换设备）握手带 token：无需重新登录即可查战绩
    const s2 = await connectWithToken(ts.url, reg.token);
    const stats = await emitAck<StatsMeAck>(s2, CLIENT_EVENTS.statsMe);
    expect(stats.ok).toBe(true);
    if (stats.ok) {
      expect(stats.username).toBe('曹操');
      expect(stats.stats.total).toBe(0);
    }
    await closeAll(ts.server, s1, s2);
  });

  it('重复用户名（含大小写变体）拒绝；非法用户名/短密码拒绝', async () => {
    const s = await connect(ts.url);
    expect((await register(s, 'Alice')).ok).toBe(true);
    const dup = await register(s, 'alice');
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.error).toContain('已被注册');

    expect((await register(s, 'a')).ok).toBe(false); // 太短
    expect((await register(s, '名字 带空格')).ok).toBe(false);
    expect((await register(s, 'bob', '123')).ok).toBe(false); // 密码太短
    await closeAll(ts.server, s);
  });

  it('登录：密码错误 / 用户不存在都返回同一文案；正确则发新 token', async () => {
    const s = await connect(ts.url);
    await register(s, '刘备', 'mypass66');

    const wrong = await emitAck<AuthAck>(s, CLIENT_EVENTS.login, { username: '刘备', password: 'nope123' });
    expect(wrong.ok).toBe(false);
    const ghost = await emitAck<AuthAck>(s, CLIENT_EVENTS.login, { username: '不存在', password: 'nope123' });
    expect(ghost.ok).toBe(false);
    if (!wrong.ok && !ghost.ok) expect(wrong.error).toBe(ghost.error);

    const login = await emitAck<AuthAck>(s, CLIENT_EVENTS.login, { username: '刘备', password: 'mypass66' });
    expect(login.ok).toBe(true);
    await closeAll(ts.server, s);
  });

  it('登出后会话 token 立即失效（握手不再识别、stats:me 拒绝）', async () => {
    const s1 = await connect(ts.url);
    const reg = await register(s1, '孙权');
    if (!reg.ok) throw new Error('注册失败');
    const token = reg.token;

    const out = await emitAck<{ ok: boolean }>(s1, CLIENT_EVENTS.logout);
    expect(out.ok).toBe(true);
    const after = await emitAck<StatsMeAck>(s1, CLIENT_EVENTS.statsMe);
    expect(after.ok).toBe(false);

    // 旧 token 握手新连接：不被识别
    const s2 = await connectWithToken(ts.url, token);
    const stats = await emitAck<StatsMeAck>(s2, CLIENT_EVENTS.statsMe);
    expect(stats.ok).toBe(false);
    await closeAll(ts.server, s1, s2);
  });

  it('未登录调用 stats:me 拒绝；未开启账号系统的服务器 auth 事件统一报错', async () => {
    const s = await connect(ts.url);
    const stats = await emitAck<StatsMeAck>(s, CLIENT_EVENTS.statsMe);
    expect(stats.ok).toBe(false);
    await closeAll(ts.server, s);

    // 纯游客服务器（不传 dbPath）：auth:* 明确报"未开启"，不影响其他功能
    const plain = await startTestServer();
    const g = await connect(plain.url);
    const login = await emitAck<AuthAck>(g, CLIENT_EVENTS.login, { username: 'a', password: 'b' });
    expect(login.ok).toBe(false);
    if (!login.ok) expect(login.error).toContain('未开启');
    await closeAll(plain.server, g);
  });

  it('scrypt 哈希：可校验、含盐互不相同、格式可解析', () => {
    const h1 = hashPassword('secret123');
    const h2 = hashPassword('secret123');
    expect(h1).not.toBe(h2);
    expect(h1.startsWith('scrypt$')).toBe(true);
    expect(verifyPassword('secret123', h1)).toBe(true);
    expect(verifyPassword('secret124', h1)).toBe(false);
    expect(verifyPassword('secret123', 'garbage')).toBe(false);
  });
});

describe('账号玩家与游客共存', () => {
  let ts: TestServer;
  beforeEach(async () => {
    ts = await startAuthServer();
  });
  afterEach(async () => {
    await ts.server.close();
  });

  it('登录玩家建房自动绑定账号（account 标记、缺省昵称=账号名）；游客不受影响', async () => {
    const s1 = await connect(ts.url);
    const reg = await register(s1, '赵云');
    if (!reg.ok) throw new Error('注册失败');

    // 登录后建房不带昵称：昵称默认账号名，玩家列表标记 account=true
    const created = await emitAck<{ ok: boolean; room: RoomInfo }>(s1, CLIENT_EVENTS.createRoom, {});
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.room.players[0].name).toBe('赵云');
    expect(created.room.players[0].account).toBe(true);

    // 游客加入：必须给昵称，account=false
    const g = await connect(ts.url);
    const noName = await emitAck<{ ok: boolean }>(g, CLIENT_EVENTS.joinRoom, { code: created.room.code });
    expect(noName.ok).toBe(false);
    const joined = await emitAck<{ ok: boolean; room: RoomInfo }>(g, CLIENT_EVENTS.joinRoom, {
      code: created.room.code,
      name: '路人',
    });
    expect(joined.ok).toBe(true);
    if (joined.ok) expect(joined.room.players[1].account).toBe(false);
    await closeAll(ts.server, s1, g);
  });

  it('座位 token 丢失时凭账号会话找回座位（换设备重连）', async () => {
    const s1 = await connect(ts.url);
    const reg = await register(s1, '关羽');
    if (!reg.ok) throw new Error('注册失败');
    const created = await emitAck<{ ok: boolean; room: RoomInfo; playerId: string }>(
      s1,
      CLIENT_EVENTS.createRoom,
      {},
    );
    if (!created.ok) throw new Error('建房失败');
    const code = created.room.code;

    // 原连接断开；新设备只有账号 token（握手带上），没有座位 token
    s1.disconnect();
    const s2 = await connectWithToken(ts.url, reg.token);
    const badToken = await emitAck<{ ok: boolean }>(s2, CLIENT_EVENTS.rejoin, { code, token: 'wrong-token' });
    expect(badToken.ok).toBe(true); // token 不匹配 → 按账号找回座位
    await closeAll(ts.server, s2);
  });

  it('账号会话不能抢别人的座位', async () => {
    const s1 = await connect(ts.url);
    const r1 = await register(s1, '张飞');
    if (!r1.ok) throw new Error('注册失败');
    const created = await emitAck<{ ok: boolean; room: RoomInfo }>(s1, CLIENT_EVENTS.createRoom, {});
    if (!created.ok) throw new Error('建房失败');

    const s2 = await connect(ts.url);
    const r2 = await register(s2, '黄忠');
    if (!r2.ok) throw new Error('注册失败');
    // 黄忠拿错误 token + 自己的账号去 rejoin：房里没有他的座位，应失败
    const rej = await emitAck<{ ok: boolean }>(
      await connectWithToken(ts.url, r2.token),
      CLIENT_EVENTS.rejoin,
      { code: created.room.code, token: 'nope' },
    );
    expect(rej.ok).toBe(false);
    await closeAll(ts.server, s1, s2);
  });
});

describe('战绩', () => {
  let ts: TestServer;
  beforeEach(async () => {
    ts = await startAuthServer();
  });
  afterEach(async () => {
    await ts.server.close();
  });

  it('1v1 打完一局：账号玩家有战绩（胜负正确），游客没有', async () => {
    // 房主登录后建房；加入者是游客
    const s1 = await connect(ts.url);
    const reg = await register(s1, '司马懿');
    if (!reg.ok) throw new Error('注册失败');
    const created = await emitAck<{ ok: boolean; room: RoomInfo; playerId: string; token: string }>(
      s1,
      CLIENT_EVENTS.createRoom,
      {},
    );
    if (!created.ok) throw new Error('建房失败');

    const g = await connect(ts.url);
    const joined = await emitAck<{ ok: boolean; playerId: string }>(g, CLIENT_EVENTS.joinRoom, {
      code: created.room.code,
      name: '游客乙',
    });
    if (!joined.ok) throw new Error('加入失败');
    await emitAck(g, CLIENT_EVENTS.ready, { ready: true });

    const host = { socket: s1, code: created.room.code, playerId: created.playerId, token: created.token };
    const guest = { socket: g, code: created.room.code, playerId: joined.playerId, token: '' };
    const overHost = waitFor<GameOverEvent>(s1, SERVER_EVENTS.gameOver, undefined, 60_000);
    // room 进入 over 与 game:over 同拍发出（战绩入库也在那一拍）：监听器必须在开局前挂好
    const roomOver = waitFor<RoomInfo>(s1, SERVER_EVENTS.roomUpdate, (r) => r.status === 'over', 60_000);
    attachBot(host);
    attachBot(guest);
    const start = await emitAck<{ ok: boolean }>(s1, CLIENT_EVENTS.startGame, {
      seed: 42,
      generals: ['blank', 'blank'],
    });
    expect(start.ok).toBe(true);
    const [over] = await Promise.all([overHost, roomOver]);
    let stats: UserStats | null = null;
    for (let i = 0; i < 50 && !stats?.total; i++) {
      const ack = await emitAck<StatsMeAck>(s1, CLIENT_EVENTS.statsMe);
      if (ack.ok) stats = ack.stats;
      if (!stats?.total) await new Promise((r) => setTimeout(r, 50));
    }
    expect(stats).not.toBeNull();
    expect(stats!.total).toBe(1);
    const rec = stats!.recent[0];
    expect(rec.mode).toBe('1v1');
    expect(rec.playerCount).toBe(2);
    expect(rec.role).toBeNull();
    expect(rec.won).toBe(over.winnerId === host.playerId);
    expect(rec.survivedTurns).toBeGreaterThan(0);
    await closeAll(ts.server, s1, g);
  }, 70_000);

  it('statsForUser 聚合：总场次/胜率/按身份/最近 10 条（新→旧）', () => {
    const repo = new SqliteRepository(':memory:');
    const user = repo.createUser('测试', hashPassword('secret123'), Date.now());
    const base: Omit<NewMatchRecord, 'userId' | 'playedAt' | 'role' | 'won'> = {
      mode: 'identity',
      playerCount: 4,
      generalId: 'caocao',
      generalName: '曹操',
      survivedTurns: 5,
    };
    // 12 条：主 1 胜 1 负、忠 1 胜、反 2 负、内 1 胜，外加 1v1 6 胜 0 负
    const inserts: [NewMatchRecord['role'], boolean][] = [
      ['lord', true], ['lord', false], ['loyalist', true],
      ['rebel', false], ['rebel', false], ['renegade', true],
      [null, true], [null, true], [null, true], [null, true], [null, true], [null, true],
    ];
    inserts.forEach(([role, won], i) => {
      repo.addMatchRecord({ ...base, userId: user.id, playedAt: 1000 + i, role, won });
    });

    const stats = repo.statsForUser(user.id);
    expect(stats.total).toBe(12);
    expect(stats.wins).toBe(9);
    expect(stats.winRate).toBeCloseTo(9 / 12);
    expect(stats.byRole.lord).toEqual({ games: 2, wins: 1 });
    expect(stats.byRole.loyalist).toEqual({ games: 1, wins: 1 });
    expect(stats.byRole.rebel).toEqual({ games: 2, wins: 0 });
    expect(stats.byRole.renegade).toEqual({ games: 1, wins: 1 });
    expect(stats.recent).toHaveLength(10); // 上限 10
    expect(stats.recent[0].playedAt).toBe(1000 + 11); // 新→旧
    expect(stats.recent[9].playedAt).toBe(1000 + 2);

    // 其他用户不受影响
    const other = repo.createUser('路人', hashPassword('secret123'), Date.now());
    expect(repo.statsForUser(other.id).total).toBe(0);

    // 会话过期：惰性清除并视为无效
    repo.createSession(user.id, 'tok-old', 1000, 2000);
    expect(repo.findSessionUser('tok-old', 3000)).toBeNull();
    repo.createSession(user.id, 'tok-new', 1000, 9999);
    expect(repo.findSessionUser('tok-new', 3000)?.username).toBe('测试');
    repo.close();
  });

  it('didWin：1v1 看胜者，身份局主忠同边 / 反贼同边 / 内奸独胜', () => {
    expect(didWin(null, null, 'p1', 'p1')).toBe(true);
    expect(didWin(null, null, 'p1', 'p2')).toBe(false);
    expect(didWin('lord', 'lord', null, 'p1')).toBe(true);
    expect(didWin('loyalist', 'lord', null, 'p2')).toBe(true);
    expect(didWin('rebel', 'lord', null, 'p3')).toBe(false);
    expect(didWin('rebel', 'rebel', null, 'p3')).toBe(true);
    expect(didWin('renegade', 'renegade', 'p4', 'p4')).toBe(true);
    expect(didWin('lord', 'renegade', 'p4', 'p1')).toBe(false);
  });
});
