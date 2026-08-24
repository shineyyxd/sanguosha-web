/**
 * 账号服务：注册 / 登录 / 登出 / 会话解析。
 *
 * - 密码：node:crypto 的 scrypt 加盐哈希（不引 bcrypt），存储格式
 *   "scrypt$N$saltHex$hashHex"，校验用 timingSafeEqual 防时序攻击；
 * - 会话：登录/注册成功发随机 UUID token，存 sessions 表，30 天过期；
 *   socket 握手与 auth:* 事件都凭它识别身份；
 * - 用户名规则：2~16 个字符，允许中文/英文/数字/下划线/连字符，大小写不敏感唯一。
 */

import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import type { GameRepository, UserRow, UserStats } from './repository.js';

/** 会话有效期：30 天。 */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const SCRYPT_N = 16384;
const KEY_LEN = 32;
const USERNAME_PATTERN = /^[\w一-龥-]{2,16}$/;

export const USERNAME_RULE = '用户名需 2~16 个字符，仅限中文/英文/数字/下划线/连字符';
export const PASSWORD_RULE = '密码需 6~64 个字符';

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, KEY_LEN, { N: SCRYPT_N }).toString('hex');
  return `scrypt$${SCRYPT_N}$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, nStr, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const derived = scryptSync(password, salt, KEY_LEN, { N: Number(nStr) });
  const expected = Buffer.from(hash, 'hex');
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

export type AuthResult =
  | { ok: true; token: string; user: UserRow }
  | { ok: false; error: string };

export class AuthService {
  constructor(private readonly repo: GameRepository) {}

  register(username: unknown, password: unknown): AuthResult {
    const name = typeof username === 'string' ? username.trim() : '';
    if (!USERNAME_PATTERN.test(name)) return { ok: false, error: USERNAME_RULE };
    if (typeof password !== 'string' || password.length < 6 || password.length > 64) {
      return { ok: false, error: PASSWORD_RULE };
    }
    if (this.repo.findUserByName(name)) return { ok: false, error: '用户名已被注册' };
    const user = this.repo.createUser(name, hashPassword(password), Date.now());
    return { ok: true, token: this.issueSession(user.id), user };
  }

  login(username: unknown, password: unknown): AuthResult {
    const name = typeof username === 'string' ? username.trim() : '';
    const user = name ? this.repo.findUserByName(name) : null;
    // 用户不存在与密码错误返回同一文案，避免探测用户名是否已注册
    if (!user || typeof password !== 'string' || !verifyPassword(password, user.passwordHash)) {
      return { ok: false, error: '用户名或密码错误' };
    }
    return { ok: true, token: this.issueSession(user.id), user };
  }

  logout(token: string): void {
    this.repo.deleteSession(token);
  }

  /** 凭会话 token 解析出用户；无效/过期返回 null。 */
  resolve(token: unknown): UserRow | null {
    if (typeof token !== 'string' || token.length === 0) return null;
    return this.repo.findSessionUser(token, Date.now());
  }

  statsFor(userId: number): UserStats {
    return this.repo.statsForUser(userId);
  }

  private issueSession(userId: number): string {
    const token = randomUUID();
    const now = Date.now();
    this.repo.createSession(userId, token, now, now + SESSION_TTL_MS);
    return token;
  }
}
