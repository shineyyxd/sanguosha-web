/**
 * ClientCore 单测：用假 socket / 内存存储验证协议接入层状态机。
 */

import { describe, expect, it } from 'vitest';
import { ClientCore, type SocketLike, type StorageLike } from '../src/core/client.js';
import {
  CLIENT_EVENTS,
  SERVER_EVENTS,
  type Ack,
  type AskEvent,
  type PublicState,
} from '../src/protocol.js';

type Handler = (data: never) => void;

class FakeSocket implements SocketLike {
  readonly handlers = new Map<string, Handler[]>();
  readonly sent: { event: string; payload: unknown }[] = [];
  /** 下一个 emit 的 ack 应答（按事件名）。 */
  acks = new Map<string, object>();

  on(event: string, cb: Handler): void {
    const list = this.handlers.get(event) ?? [];
    list.push(cb);
    this.handlers.set(event, list);
  }

  emit(event: string, payload: unknown, ack?: (res: never) => void): void {
    this.sent.push({ event, payload });
    if (ack) {
      const res = this.acks.get(event) ?? { ok: true };
      queueMicrotask(() => ack(res as never));
    }
  }

  fire(event: string, data: unknown): void {
    for (const cb of this.handlers.get(event) ?? []) cb(data as never);
  }
}

class MemoryStorage implements StorageLike {
  private readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

function fakeState(pendingPlayerId: string | null = null): PublicState {
  return {
    code: 'ABCD', status: 'playing', turn: 1,
    players: [],
    me: { id: 'me', seat: 0, hand: [], role: null },
    deckCount: 100, discardCount: 0, discardTop: null,
    pendingPlayerId, winnerId: null, logs: ['开局'],
  };
}

function setup() {
  const socket = new FakeSocket();
  const storage = new MemoryStorage();
  const core = new ClientCore(socket, storage);
  return { socket, storage, core };
}

describe('ClientCore 大厅', () => {
  it('createRoom 成功后保存房间与会话', async () => {
    const { socket, core } = setup();
    socket.acks.set(CLIENT_EVENTS.createRoom, {
      ok: true,
      room: { code: 'ABCD', status: 'lobby', players: [] },
      token: 'tok-1',
      playerId: 'me',
    });
    const ack = await core.createRoom('小明');
    expect(ack.ok).toBe(true);
    expect(core.room?.code).toBe('ABCD');
    expect(core.myPlayerId).toBe('me');
    expect(core.loadSession()).toEqual({ code: 'ABCD', token: 'tok-1', name: '小明' });
  });

  it('createRoom 失败不写会话', async () => {
    const { socket, core } = setup();
    socket.acks.set(CLIENT_EVENTS.createRoom, { ok: false, error: '名字不合法' });
    const ack = await core.createRoom('');
    expect(ack.ok).toBe(false);
    expect(core.loadSession()).toBeNull();
  });

  it('leave 清空状态与持久化会话', async () => {
    const { socket, core } = setup();
    socket.acks.set(CLIENT_EVENTS.createRoom, {
      ok: true,
      room: { code: 'ABCD', status: 'lobby', players: [] },
      token: 'tok-1',
      playerId: 'me',
    });
    await core.createRoom('小明');
    socket.fire(SERVER_EVENTS.stateUpdate, fakeState());
    await core.leave();
    expect(core.room).toBeNull();
    expect(core.state).toBeNull();
    expect(core.loadSession()).toBeNull();
  });
});

describe('ClientCore 对局事件', () => {
  it('state:update 同步日志并按 pendingPlayerId 清理等待提示', () => {
    const { socket, core } = setup();
    socket.fire(SERVER_EVENTS.waiting, { playerId: 'a', playerName: '甲', kind: 'play' });
    expect(core.waiting?.playerId).toBe('a');
    socket.fire(SERVER_EVENTS.stateUpdate, fakeState('a'));
    expect(core.waiting?.playerId).toBe('a'); // 仍在等同一个人
    socket.fire(SERVER_EVENTS.stateUpdate, fakeState(null));
    expect(core.waiting).toBeNull();
    expect(core.logs).toEqual(['开局']);
  });

  it('ask 按 seq 去重；respond 后清空当前询问', async () => {
    const { socket, core } = setup();
    const event: AskEvent = { seq: 1, ask: { kind: 'play', playerId: 'me' }, timeoutMs: 30000 };
    socket.fire(SERVER_EVENTS.ask, event);
    socket.fire(SERVER_EVENTS.ask, event); // 重发
    expect(core.currentAsk?.seq).toBe(1);

    const ack = (await core.respond({ pass: true })) as Ack;
    expect(ack.ok).toBe(true);
    expect(core.currentAsk).toBeNull();
    const respondCall = socket.sent.find((s) => s.event === CLIENT_EVENTS.respond);
    expect(respondCall?.payload).toEqual({ response: { pass: true } });

    // 已应答的 seq 再次重发也被忽略
    socket.fire(SERVER_EVENTS.ask, event);
    expect(core.currentAsk).toBeNull();
    // 新 seq 正常接收
    socket.fire(SERVER_EVENTS.ask, { seq: 2, ask: { kind: 'play', playerId: 'me' }, timeoutMs: 30000 });
    expect(core.currentAsk?.seq).toBe(2);
  });

  it('game:over 清空询问与等待', () => {
    const { socket, core } = setup();
    socket.fire(SERVER_EVENTS.ask, { seq: 1, ask: { kind: 'play', playerId: 'me' }, timeoutMs: 30000 });
    socket.fire(SERVER_EVENTS.gameOver, { winnerId: 'me', winnerName: '小明', winSide: null });
    expect(core.currentAsk).toBeNull();
    expect(core.gameOver?.winnerName).toBe('小明');
  });

  it('log 事件追加到日志缓冲', () => {
    const { socket, core } = setup();
    socket.fire(SERVER_EVENTS.log, { message: '甲 使用了【杀】' });
    expect(core.logs).toContain('甲 使用了【杀】');
  });
});

describe('ClientCore 身份局', () => {
  it('role:assign 私发身份入库；leave 清空', async () => {
    const { socket, core } = setup();
    socket.fire(SERVER_EVENTS.roleAssign, {
      role: 'rebel', label: '反贼', objective: '获胜条件：杀死主公。',
    });
    expect(core.myRole?.role).toBe('rebel');
    expect(core.snapshot().myRole?.label).toBe('反贼');
    await core.leave();
    expect(core.myRole).toBeNull();
  });

  it('general:choose 进入选将；pickGeneral 乐观标记；武将确定后自动清除', async () => {
    const { socket, core } = setup();
    const candidates = [
      { id: 'guanyu', name: '关羽', kingdom: 'shu', gender: 'male' as const, hp: 4, skills: [] },
      { id: 'zhaoyun', name: '赵云', kingdom: 'shu', gender: 'male' as const, hp: 4, skills: [] },
      { id: 'machao', name: '马超', kingdom: 'shu', gender: 'male' as const, hp: 4, skills: [] },
    ];
    socket.fire(SERVER_EVENTS.generalChoose, { candidates, timeoutMs: 30000 });
    expect(core.draft?.candidates).toHaveLength(3);
    expect(core.draft?.pickedId).toBeNull();

    const ack = (await core.pickGeneral('guanyu')) as Ack;
    expect(ack.ok).toBe(true);
    expect(core.draft?.pickedId).toBe('guanyu');
    const call = socket.sent.find((s) => s.event === CLIENT_EVENTS.pickGeneral);
    expect(call?.payload).toEqual({ generalId: 'guanyu' });

    // 服务器结算后下发状态：我的武将已定 → 选将界面清除
    const s = fakeState();
    s.players = [
      {
        id: 'me', name: '我', seat: 0, generalId: 'guanyu', generalName: '关羽',
        kingdom: 'shu', gender: 'male',
        hp: 4, maxHp: 4, alive: true, handCount: 4, role: 'rebel',
        equips: { weapon: null, armor: null, horsePlus: null, horseMinus: null },
        judgeArea: [], currentPhase: null, trusted: false,
      },
    ];
    socket.fire(SERVER_EVENTS.stateUpdate, s);
    expect(core.draft).toBeNull();
  });

  it('选将中武将仍是白板时不清除 draft；game:over 也会清掉 draft', () => {
    const { socket, core } = setup();
    socket.fire(SERVER_EVENTS.generalChoose, {
      candidates: [{ id: 'guanyu', name: '关羽', kingdom: 'shu', gender: 'male' as const, hp: 4, skills: [] }],
      timeoutMs: 30000,
    });
    const s = fakeState();
    s.players = [
      {
        id: 'me', name: '我', seat: 0, generalId: 'blank', generalName: '白板武将',
        kingdom: null, gender: 'male',
        hp: 4, maxHp: 4, alive: true, handCount: 0, role: null,
        equips: { weapon: null, armor: null, horsePlus: null, horseMinus: null },
        judgeArea: [], currentPhase: null, trusted: false,
      },
    ];
    socket.fire(SERVER_EVENTS.stateUpdate, s);
    expect(core.draft).not.toBeNull();
    socket.fire(SERVER_EVENTS.gameOver, { winnerId: null, winnerName: null, winSide: 'rebel' });
    expect(core.draft).toBeNull();
    expect(core.gameOver?.winSide).toBe('rebel');
  });
});

describe('ClientCore 账号', () => {
  it('login 成功：记录账号名并持久化会话 token', async () => {
    const { socket, storage, core } = setup();
    socket.acks.set(CLIENT_EVENTS.login, { ok: true, token: 'sess-1', username: '曹操' });
    const ack = await core.login('曹操', 'secret123');
    expect(ack.ok).toBe(true);
    expect(core.account).toEqual({ username: '曹操' });
    expect(storage.getItem('sgs.session')).toBe('sess-1');
    expect(core.snapshot().account?.username).toBe('曹操');
  });

  it('register 失败：不写入账号与存储', async () => {
    const { socket, storage, core } = setup();
    socket.acks.set(CLIENT_EVENTS.register, { ok: false, error: '用户名已被注册' });
    const ack = await core.register('曹操', 'secret123');
    expect(ack.ok).toBe(false);
    expect(core.account).toBeNull();
    expect(storage.getItem('sgs.session')).toBeNull();
  });

  it('logout：通知服务器并清掉本地账号与会话 token', async () => {
    const { socket, storage, core } = setup();
    socket.acks.set(CLIENT_EVENTS.login, { ok: true, token: 'sess-1', username: '刘备' });
    await core.login('刘备', 'secret123');
    const ack = await core.logout();
    expect(ack.ok).toBe(true);
    expect(core.account).toBeNull();
    expect(storage.getItem('sgs.session')).toBeNull();
    expect(socket.sent.some((m) => m.event === CLIENT_EVENTS.logout)).toBe(true);
  });

  it('restoreAccount：有 token 且会话有效则恢复登录态；失效则清除', async () => {
    const { socket, storage, core } = setup();
    storage.setItem('sgs.session', 'sess-1');
    const emptyStats = {
      total: 0, wins: 0, winRate: 0,
      byRole: {
        lord: { games: 0, wins: 0 }, loyalist: { games: 0, wins: 0 },
        rebel: { games: 0, wins: 0 }, renegade: { games: 0, wins: 0 },
      },
      recent: [],
    };
    socket.acks.set(CLIENT_EVENTS.statsMe, { ok: true, username: '孙权', stats: emptyStats });
    expect((await core.restoreAccount())?.username).toBe('孙权');

    socket.acks.set(CLIENT_EVENTS.statsMe, { ok: false, error: '需要登录后才能查看战绩' });
    expect(await core.restoreAccount()).toBeNull();
    expect(storage.getItem('sgs.session')).toBeNull();
  });

  it('restoreAccount：本地没有 token 时不发请求直接返回 null', async () => {
    const { socket, core } = setup();
    expect(await core.restoreAccount()).toBeNull();
    expect(socket.sent.some((m) => m.event === CLIENT_EVENTS.statsMe)).toBe(false);
  });
});
