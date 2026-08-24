/**
 * 视角过滤：从 Game 生成某个玩家视角的 PublicState。
 *
 * 信息隐藏规则：
 * - 手牌内容只有自己可见（me.hand）；他人只有 handCount；
 * - 装备区、判定区、弃牌堆（含堆顶）、判定结果（经公共日志）所有人可见；
 * - 牌堆只剩数量（deckCount），没有内容；
 * - 身份：主公与阵亡者全员可见，其他人只有本人可见；对局结束全部亮出。
 */

import type { Game } from '../../engine/src/game.js';
import type { Player } from '../../engine/src/player.js';
import { Standard108Deck } from '../../engine/src/cards.js';
import type { Role } from '../../engine/src/roles.js';
import type { PublicPlayer, PublicState } from './protocol.js';

/** 该视角下可见的身份：主公 / 阵亡者 / 本人 / 对局结束后全员；否则 null。 */
function visibleRole(p: Player, viewer: Player, gameOver: boolean): Role | null {
  if (!p.role) return null;
  if (p.role === 'lord' || !p.alive || p === viewer || gameOver) return p.role;
  return null;
}

function toPublicPlayer(p: Player, viewer: Player, gameOver: boolean, trusted: boolean): PublicPlayer {
  return {
    id: p.id,
    name: p.name,
    seat: p.seat,
    generalId: p.general.id,
    generalName: p.general.name,
    kingdom: p.kingdom,
    gender: p.gender,
    hp: p.hp,
    maxHp: p.maxHp,
    alive: p.alive,
    handCount: p.hand.length,
    role: visibleRole(p, viewer, gameOver),
    equips: { ...p.equips },
    judgeArea: [...p.judgeArea],
    currentPhase: p.currentPhase,
    trusted,
  };
}

export interface ViewOptions {
  code: string;
  /** 当前正在等待响应的玩家 id（无则 null）。 */
  pendingPlayerId: string | null;
  /** 公共日志缓冲（取末尾若干条）。 */
  logs: string[];
  /** 托管中的玩家 id 集合（缺省视为无人托管）。 */
  trusted?: ReadonlySet<string>;
  logLimit?: number;
}

export function buildPublicState(game: Game, viewer: Player, opts: ViewOptions): PublicState {
  const deck = game.deck;
  return {
    code: opts.code,
    status: game.over ? 'over' : 'playing',
    turn: game.turn,
    players: game.players.map((p) => toPublicPlayer(p, viewer, game.over, opts.trusted?.has(p.id) ?? false)),
    me: { id: viewer.id, seat: viewer.seat, hand: [...viewer.hand], role: viewer.role },
    deckCount: deck instanceof Standard108Deck ? deck.remaining : null,
    discardCount: game.discard.length,
    discardTop: game.discard[game.discard.length - 1] ?? null,
    pendingPlayerId: opts.pendingPlayerId,
    winnerId: game.winner?.id ?? null,
    logs: opts.logs.slice(-(opts.logLimit ?? 50)),
  };
}
