/**
 * 托管机器人：断线/超时玩家的服务器端代打策略。
 *
 * 与 tests/helpers.ts 里只能看 PublicState 的客户端机器人不同，这里直接读 Game，
 * 可以做合法性强保证（距离/攻击范围用引擎的 canAttack，装备槽位直接查），
 * 因此应答几乎不会触发引擎重问。策略刻意简单：
 * - 出牌阶段：残血吃桃 → 空槽位穿装备 → 结姻（自己残血且有受伤男性）→
 *   离间（有两名存活男性就弃末尾牌离间）→ 制衡（弃掉非杀闪桃的牌）→
 *   仁德（自己残血且有两张以上杂牌时给出两张回血）→ 每回合至多杀一刀（打距离内最近者）→ 结束；
 * - 响应窗口：有所求的牌就打（无懈只在自己成为目标时打），其次用转化技，否则放弃；
 * - 弃牌自动弃末尾的牌；五谷拿第一张；确认类一律发动；选目标类放弃。
 */

import {
  CARD_DEFS,
  canAttack,
  type AskRequest,
  type AskResponse,
  type Game,
  type Player,
} from '../../engine/src/index.js';

/** 生成托管响应。调用方保证 ask.playerId 对应玩家存活且为当前询问对象。 */
export function botResponse(game: Game, ask: AskRequest): AskResponse {
  switch (ask.kind) {
    // 五谷丰登不可放弃：拿第一张
    case 'choose-card':
      return { cardId: ask.cards[0].id };
    // 触发技确认：一律发动（简单化处理）
    case 'confirm':
      return { confirm: true };
    // 选目标类（突袭等）：放弃
    case 'choose-target':
      return { pass: true };
    // 互斥选项（刚烈的弃牌/受伤、反间的猜花色）：选第一项
    case 'choose-option':
      return { choice: ask.options[0].id };
    // 遗计分配：自己保留
    case 'give-card':
      return { pass: true };
    // 鬼才改判：简化策略，不改判
    case 'judge-retrial':
      return { pass: true };
    // 观星：简化策略，全部保持顺序回顶
    case 'guanxing':
      return { pass: true };
    // 弃牌不可放弃：弃末尾的牌
    case 'discard': {
      const hand = game.getPlayer(ask.playerId).hand;
      return { cardIds: hand.slice(-ask.count).map((c) => c.id) };
    }
    case 'response': {
      const me = game.getPlayer(ask.playerId);
      // 无懈只在自己成为目标时打，不替别人挡
      if (ask.wants === 'wuxie' && ask.targetId !== ask.playerId) return { pass: true };
      const card = me.hand.find((c) => c.name === ask.wants);
      if (card) return { cardId: card.id };
      // 转化技（武圣/丈八蛇矛等）：多牌转化按 count 凑齐 cardIds
      const conv = ask.converts?.find((c) => c.cardIds.length >= (c.count ?? 1));
      if (conv) {
        const need = conv.count ?? 1;
        return need > 1
          ? { useSkill: conv.skillId, cardIds: conv.cardIds.slice(0, need) }
          : { useSkill: conv.skillId, cardId: conv.cardIds[0] };
      }
      return { pass: true };
    }
    case 'play':
      return botPlay(game, game.getPlayer(ask.playerId), ask);
  }
}

/** 手里的"杂牌"（非杀/闪/桃），制衡/结姻/离间/仁德的弃牌与给牌来源。 */
function junkCards(me: Player) {
  return me.hand.filter((c) => c.name !== 'sha' && c.name !== 'shan' && c.name !== 'tao');
}

function botPlay(game: Game, me: Player, ask: AskRequest & { kind: 'play' }): AskResponse {
  const skills = ask.availableSkills ?? [];
  // 残血吃桃
  if (me.hp < me.maxHp) {
    const tao = me.findCard('tao');
    if (tao) return { cardId: tao.id };
  }
  // 空槽位穿装备（有装备的槽位不主动替换）
  for (const card of me.hand) {
    const slot = CARD_DEFS[card.name].equipSlot;
    if (slot && !me.equips[slot]) return { cardId: card.id };
  }
  // 结姻：自己残血且有受伤男性角色时，弃两张杂牌双修
  if (skills.includes('jieyin') && me.hp < me.maxHp) {
    const junk = junkCards(me);
    const target = game.alivePlayers().find((p) => p.gender === 'male' && p.hp < p.maxHp);
    if (junk.length >= 2 && target) {
      return { useSkill: 'jieyin', cardIds: junk.slice(0, 2).map((c) => c.id), targetId: target.id };
    }
  }
  // 离间：有两名存活男性角色就弃一张杂牌令其互相决斗
  if (skills.includes('lijian')) {
    const junk = junkCards(me);
    const males = game.alivePlayers().filter((p) => p.gender === 'male');
    if (junk.length > 0 && males.length >= 2) {
      return { useSkill: 'lijian', cardId: junk[0].id, targetId: males[0].id, targetId2: males[1].id };
    }
  }
  // 制衡：把杂牌换成新牌
  if (skills.includes('zhiheng')) {
    const junk = junkCards(me);
    if (junk.length > 0) return { useSkill: 'zhiheng', cardIds: junk.map((c) => c.id) };
  }
  // 仁德：残血时给出两张杂牌回血
  if (skills.includes('rende') && me.hp < me.maxHp) {
    const junk = junkCards(me);
    const target = game.alivePlayers().find((p) => p !== me);
    if (junk.length >= 2 && target) {
      return { useSkill: 'rende', cardIds: junk.slice(0, 2).map((c) => c.id), targetId: target.id };
    }
  }
  // 国色：方块牌当【乐不思蜀】，贴给判定区没有乐不思蜀的敌人
  if (skills.includes('guose')) {
    const diamond = me.hand.find((c) => c.suit === 'diamond');
    const target = diamond
      ? game.alivePlayers().find((p) => p !== me && !p.judgeArea.some((c) => c.name === 'lebu'))
      : undefined;
    if (diamond && target) return { useSkill: 'guose', cardId: diamond.id, targetId: target.id };
  }
  // 每回合至多杀一刀：打攻击范围内存活环上最近的目标
  if (me.shaUsed === 0) {
    const sha = me.findCard('sha');
    const target = sha ? nearestAttackable(game, me) : undefined;
    if (sha && target) return { cardId: sha.id, targetId: target.id };
  }
  return { pass: true };
}

/** 攻击范围内座位距离最近的存活对手（空城中的诸葛亮不能成为杀的目标，排除）。 */
function nearestAttackable(game: Game, me: Player): Player | undefined {
  return game
    .alivePlayers()
    .filter((p) => game.canAttack(me, p) && !game.isKongcheng(p))
    .sort((a, b) => game.distance(me, a) - game.distance(me, b))[0];
}
