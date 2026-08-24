/**
 * 持久化数据层：repository 接口 + node:sqlite 实现。
 *
 * 设计要点：
 * - 所有读写都走 GameRepository 接口；以后要换 PostgreSQL 只需另写一个实现，
 *   业务层（auth.ts / server.ts）不感知 SQL 方言之外的任何细节；
 * - 默认实现用 node:sqlite（node 26 内置，零外部服务、零原生编译依赖）；
 * - 路径 ':memory:' 为内存库（测试用）；文件路径会自动创建父目录；
 * - 表结构用 CREATE TABLE IF NOT EXISTS 幂等建表，无迁移框架（三表起步）。
 */

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Role } from '../../engine/src/index.js';

// ---------- 行类型 ----------

export interface UserRow {
  id: number;
  username: string;
  passwordHash: string;
  createdAt: number;
}

export interface SessionRow {
  token: string;
  userId: number;
  createdAt: number;
  expiresAt: number;
}

/** 对局模式：1v1 对决 / 身份局（人数在 playerCount）。 */
export type MatchMode = '1v1' | 'identity';

/** 一条待写入的战绩（局末由服务器为每个账号玩家生成；游客不写）。 */
export interface NewMatchRecord {
  userId: number;
  /** 结束时间（epoch ms）。 */
  playedAt: number;
  mode: MatchMode;
  playerCount: number;
  /** 身份（1v1 为 null）。 */
  role: Role | null;
  generalId: string;
  generalName: string;
  won: boolean;
  /** 存活回合数（阵亡者 = 阵亡时已进行的回合数；活到最后 = 全局回合数）。 */
  survivedTurns: number;
}

export interface MatchRecord extends NewMatchRecord {
  id: number;
}

export interface RoleStat {
  games: number;
  wins: number;
}

/** stats:me 的聚合结果：总场次/胜率 + 按身份统计 + 最近 10 场。 */
export interface UserStats {
  total: number;
  wins: number;
  /** 0~1，无场次时为 0。 */
  winRate: number;
  byRole: Record<Role, RoleStat>;
  /** 最近对局，新→旧，至多 10 条。 */
  recent: MatchRecord[];
}

// ---------- 接口 ----------

export interface GameRepository {
  /** 创建用户；用户名（大小写不敏感）已存在时抛错。 */
  createUser(username: string, passwordHash: string, now: number): UserRow;
  /** 按用户名查用户（大小写不敏感）。 */
  findUserByName(username: string): UserRow | null;
  createSession(userId: number, token: string, now: number, expiresAt: number): void;
  /** 凭 token 查会话对应的用户；过期会话顺带清除并视为无效。 */
  findSessionUser(token: string, now: number): UserRow | null;
  deleteSession(token: string): void;
  addMatchRecord(record: NewMatchRecord): void;
  statsForUser(userId: number, recentLimit?: number): UserStats;
  close(): void;
}

// ---------- node:sqlite 实现 ----------

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS match_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  played_at INTEGER NOT NULL,
  mode TEXT NOT NULL,
  player_count INTEGER NOT NULL,
  role TEXT,
  general_id TEXT NOT NULL,
  general_name TEXT NOT NULL,
  won INTEGER NOT NULL,
  survived_turns INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_match_records_user ON match_records(user_id, played_at DESC);
`;

const ROLES: Role[] = ['lord', 'loyalist', 'rebel', 'renegade'];

export class SqliteRepository implements GameRepository {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec(SCHEMA);
  }

  createUser(username: string, passwordHash: string, now: number): UserRow {
    const info = this.db
      .prepare('INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)')
      .run(username, passwordHash, now);
    return { id: Number(info.lastInsertRowid), username, passwordHash, createdAt: now };
  }

  findUserByName(username: string): UserRow | null {
    const row = this.db
      .prepare('SELECT id, username, password_hash, created_at FROM users WHERE username = ? COLLATE NOCASE')
      .get(username) as { id: number; username: string; password_hash: string; created_at: number } | undefined;
    return row ? { id: row.id, username: row.username, passwordHash: row.password_hash, createdAt: row.created_at } : null;
  }

  createSession(userId: number, token: string, now: number, expiresAt: number): void {
    this.db
      .prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .run(token, userId, now, expiresAt);
  }

  findSessionUser(token: string, now: number): UserRow | null {
    const row = this.db
      .prepare(
        `SELECT u.id, u.username, u.password_hash, u.created_at, s.expires_at
         FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`,
      )
      .get(token) as
      | { id: number; username: string; password_hash: string; created_at: number; expires_at: number }
      | undefined;
    if (!row) return null;
    if (row.expires_at <= now) {
      // 过期会话惰性清理（避免再跑定时任务）
      this.deleteSession(token);
      return null;
    }
    return { id: row.id, username: row.username, passwordHash: row.password_hash, createdAt: row.created_at };
  }

  deleteSession(token: string): void {
    this.db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  }

  addMatchRecord(record: NewMatchRecord): void {
    this.db
      .prepare(
        `INSERT INTO match_records
           (user_id, played_at, mode, player_count, role, general_id, general_name, won, survived_turns)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.userId,
        record.playedAt,
        record.mode,
        record.playerCount,
        record.role,
        record.generalId,
        record.generalName,
        record.won ? 1 : 0,
        record.survivedTurns,
      );
  }

  statsForUser(userId: number, recentLimit = 10): UserStats {
    const total = this.db
      .prepare('SELECT COUNT(*) AS games, COALESCE(SUM(won), 0) AS wins FROM match_records WHERE user_id = ?')
      .get(userId) as { games: number; wins: number };

    const byRole = Object.fromEntries(ROLES.map((r) => [r, { games: 0, wins: 0 }])) as Record<Role, RoleStat>;
    const rows = this.db
      .prepare(
        `SELECT role, COUNT(*) AS games, SUM(won) AS wins
         FROM match_records WHERE user_id = ? AND role IS NOT NULL GROUP BY role`,
      )
      .all(userId) as { role: Role; games: number; wins: number }[];
    for (const row of rows) {
      if (row.role in byRole) byRole[row.role] = { games: row.games, wins: row.wins };
    }

    const recent = (
      this.db
        .prepare(
          `SELECT id, played_at, mode, player_count, role, general_id, general_name, won, survived_turns
           FROM match_records WHERE user_id = ? ORDER BY played_at DESC, id DESC LIMIT ?`,
        )
        .all(userId, recentLimit) as {
        id: number;
        played_at: number;
        mode: MatchMode;
        player_count: number;
        role: Role | null;
        general_id: string;
        general_name: string;
        won: number;
        survived_turns: number;
      }[]
    ).map((r) => ({
      id: r.id,
      userId,
      playedAt: r.played_at,
      mode: r.mode,
      playerCount: r.player_count,
      role: r.role,
      generalId: r.general_id,
      generalName: r.general_name,
      won: r.won === 1,
      survivedTurns: r.survived_turns,
    }));

    return {
      total: total.games,
      wins: total.wins,
      winRate: total.games > 0 ? total.wins / total.games : 0,
      byRole,
      recent,
    };
  }

  close(): void {
    try {
      this.db.close();
    } catch {
      // 已关闭（server.close 幂等叠加调用时）
    }
  }
}
