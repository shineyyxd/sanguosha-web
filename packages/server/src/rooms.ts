/**
 * 房间管理：纯内存状态，不依赖 socket.io（socket 接线在 server.ts）。
 *
 * 规则：
 * - 房间码 4 位（去歧义字符，无 0/O/1/I），创建者为房主；
 * - 玩家 id 按加入顺序分配 p1..pN，与开局后的引擎玩家 id / 座次一一对应；
 * - 大厅里离开 = 移除（房主离开则顺延给下一位）；对局中离开/断线 = 标记离线，
 *   座位保留，凭 token 重连找回；
 * - 开局条件：房主发起、至少 2 人、所有非房主玩家已准备；
 * - 一局结束后房间进入 over 状态，人走空即销毁。
 */

import type { RoomInfo } from './protocol.js';

export const MAX_PLAYERS = 8;
export const MIN_PLAYERS = 2;

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export type RoomStatus = 'lobby' | 'playing' | 'over';

export interface RoomPlayer {
  id: string;
  name: string;
  token: string;
  socketId: string | null;
  online: boolean;
  ready: boolean;
  isHost: boolean;
  /** 账号玩家绑定的用户 id（游客为 undefined；局末战绩只给账号玩家写）。 */
  userId?: number;
}

export type RoomError = { ok: false; error: string };

export function roomErr(error: string): RoomError {
  return { ok: false, error };
}

export class Room {
  status: RoomStatus = 'lobby';
  readonly players: RoomPlayer[] = [];

  constructor(readonly code: string) {}

  get host(): RoomPlayer | undefined {
    return this.players.find((p) => p.isHost);
  }

  toInfo(): RoomInfo {
    return {
      code: this.code,
      status: this.status,
      players: this.players.map((p) => ({
        id: p.id,
        name: p.name,
        isHost: p.isHost,
        ready: p.ready,
        online: p.online,
        account: p.userId != null,
      })),
    };
  }

  addPlayer(name: string, token: string, socketId: string, userId?: number): RoomPlayer | RoomError {
    if (this.status !== 'lobby') return roomErr('对局已开始，无法加入');
    if (this.players.length >= MAX_PLAYERS) return roomErr('房间已满');
    const player: RoomPlayer = {
      id: `p${this.players.length + 1}`,
      name,
      token,
      socketId,
      online: true,
      ready: false,
      isHost: this.players.length === 0,
      userId,
    };
    this.players.push(player);
    return player;
  }

  /** 大厅里离开：真正移除；房主离开则顺延。返回房间是否已空。 */
  removePlayer(playerId: string): boolean {
    const i = this.players.findIndex((p) => p.id === playerId);
    if (i < 0) return this.players.length === 0;
    const wasHost = this.players[i].isHost;
    this.players.splice(i, 1);
    if (wasHost && this.players.length > 0) this.players[0].isHost = true;
    return this.players.length === 0;
  }

  /** 对局中离开/断线：只标记离线，座位保留。 */
  markOffline(playerId: string): void {
    const p = this.players.find((pl) => pl.id === playerId);
    if (p) {
      p.online = false;
      p.socketId = null;
    }
  }

  findByToken(token: string): RoomPlayer | undefined {
    return this.players.find((p) => p.token === token);
  }
}

export class RoomManager {
  readonly rooms = new Map<string, Room>();

  private generateCode(): string {
    for (let attempt = 0; attempt < 100; attempt++) {
      let code = '';
      for (let i = 0; i < 4; i++) {
        code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
      }
      if (!this.rooms.has(code)) return code;
    }
    throw new Error('无法分配房间码');
  }

  createRoom(name: string, socketId: string, userId?: number): { room: Room; player: RoomPlayer } {
    const room = new Room(this.generateCode());
    const token = crypto.randomUUID();
    const player = room.addPlayer(name, token, socketId, userId);
    if ('ok' in player) throw new Error(player.error);
    this.rooms.set(room.code, room);
    return { room, player };
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code.toUpperCase());
  }

  deleteIfEmpty(room: Room): void {
    if (room.players.length === 0 || (room.status !== 'lobby' && !room.players.some((p) => p.online))) {
      this.rooms.delete(room.code);
    }
  }
}
