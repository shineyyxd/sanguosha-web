/**
 * 武将技能实现。
 * 技能描述原文见 data/standard-generals.ts；这里只放机制实现。
 * 模板的势力/性别不在此重复维护：文件末尾按武将 id 从 STANDARD_GENERALS 回填。
 *
 * 第一批：关羽 / 赵云 / 甘宁 / 张辽 / 黄盖 / 曹操 / 马超。
 * 第二批：张飞 / 许褚 / 夏侯惇 / 郭嘉 / 甄姬 / 华佗 / 吕蒙 / 周瑜。
 * 第三批：刘备 / 孙权 / 貂蝉 / 孙尚香 / 黄月英。
 * 第四批：司马懿 / 吕布 / 诸葛亮 / 大乔 / 陆逊（标准包 25 将齐）。
 *
 * 覆盖的技能形态：
 * - 转化技（converts）：武圣 / 龙胆 / 奇袭 / 倾国 / 急救（带"仅回合外"条件）/
 *   国色（方块当乐不思蜀）；
 * - 可挂起触发技（triggers）：突袭 / 奸雄 / 铁骑 / 裸衣（改摸牌数）/ 刚烈 /
 *   天妒 / 遗计 / 洛神（回合开始）/ 英姿 / 克己（跳过弃牌阶段）/ 闭月（结束阶段）/
 *   枭姬（equip-lose：被拆/被顺/被替换/借刀抽武器）/ 集智（使用非延时锦囊）/
 *   反馈（damage：获得伤害来源一张牌）/ 观星（turn-start：牌堆顶/底重排）/
 *   流离（card-use：杀结算中途经 shaFlags.retarget 换目标）/ 连营（hand-empty：摸一）；
 * - 主动技（active）：苦肉 / 青囊 / 反间 / 仁德（多选牌+目标，回合累计计数回血）/
 *   制衡（多选牌）/ 结姻（恰两张牌+受伤男性目标）/ 离间（一牌+两个男性目标，虚拟决斗）；
 * - 同步监听器（listeners）：马术（distance-calc）/ 裸衣（damage 改数值）/ 克己（出杀记录）；
 * - 被动标记（flags）：咆哮（杀无次数限制）/ 奇才（锦囊无距离限制）/ 无双（双闪双杀）/
 *   空城（无手牌不可被杀/决斗）/ 谦逊（不可被顺/乐）；
 * - 引擎直读的技能 id：鬼才（judgeCard 改判挂点，judge-retrial 询问）。
 */

import { CARD_DEFS, CARD_LABEL, SUIT_LABEL, cardText, isBlack, isRed, makeCard, type Card, type Suit } from './cards.js';
import { STANDARD_GENERALS } from './data/standard-generals.js';
import type { GameEventMap } from './events.js';
import type { GeneralTemplate, Player, Skill } from './player.js';

// ---------- 关羽：武圣 ----------

const wusheng: Skill = {
  id: 'wusheng',
  name: '武圣',
  description: '你可以将一张红色牌当做【杀】使用或打出。',
  converts: [
    { id: 'wusheng', name: '武圣', as: 'sha', match: isRed, activeUse: true },
  ],
};

export const GUANYU: GeneralTemplate = { id: 'guanyu', name: '关羽', maxHp: 4, skills: [wusheng] };

// ---------- 赵云：龙胆 ----------

const longdan: Skill = {
  id: 'longdan',
  name: '龙胆',
  description: '你可以将【杀】当做【闪】，或将【闪】当做【杀】使用或打出。',
  converts: [
    // 杀当闪：仅响应窗口（被求闪时）
    { id: 'longdan-shan', name: '龙胆', as: 'shan', match: (c) => c.name === 'sha' },
    // 闪当杀：响应窗口（南蛮/决斗/借刀求杀）+ 出牌阶段主动使用
    { id: 'longdan-sha', name: '龙胆', as: 'sha', match: (c) => c.name === 'shan', activeUse: true },
  ],
};

export const ZHAOYUN: GeneralTemplate = { id: 'zhaoyun', name: '赵云', maxHp: 4, skills: [longdan] };

// ---------- 甘宁：奇袭 ----------

const qixi: Skill = {
  id: 'qixi',
  name: '奇袭',
  description: '你可以将一张黑色牌当做【过河拆桥】使用。',
  converts: [
    { id: 'qixi', name: '奇袭', as: 'guohe', match: isBlack, activeUse: true },
  ],
};

export const GANNING: GeneralTemplate = { id: 'ganning', name: '甘宁', maxHp: 4, skills: [qixi] };

// ---------- 张辽：突袭 ----------

const tuxi: Skill = {
  id: 'tuxi',
  name: '突袭',
  description: '摸牌阶段，你可以改为获得至多两名其他角色的各一张手牌。',
  triggers: [
    {
      on: 'phase-change',
      when: (e: GameEventMap['phase-change'], _g, me) => e.phase === 'draw' && e.player === me,
      replaces: 'draw-phase',
      *flow(game, me) {
        const candidates = game.alivePlayers().filter((q) => q !== me && q.hand.length > 0);
        if (candidates.length === 0) return false; // 没人可偷：正常摸牌
        const confirm = yield { kind: 'confirm', playerId: me.id, skillId: 'tuxi' };
        if (confirm.pass) return false;
        while (true) {
          const res = yield {
            kind: 'choose-target',
            playerId: me.id,
            targetIds: candidates.map((c) => c.id),
            min: 1,
            max: 2,
            skillId: 'tuxi',
          } as const;
          if (res.pass) return false; // 放弃选择 = 不发动，正常摸牌
          if (!('targetIds' in res)) continue;
          const ids = res.targetIds;
          const valid =
            ids.length >= 1 &&
            ids.length <= 2 &&
            new Set(ids).size === ids.length &&
            ids.every((id) => candidates.some((c) => c.id === id));
          if (!valid) continue; // 非法选择，重新询问
          for (const id of ids) {
            const t = game.getPlayer(id);
            if (t.hand.length === 0) continue;
            const [card] = t.hand.splice(Math.floor(Math.random() * t.hand.length), 1);
            me.hand.push(card);
            game.log(`${me.name} 发动【突袭】，获得 ${t.name} 的一张手牌`);
          }
          return true;
        }
      },
    },
  ],
};

export const ZHANGLIAO: GeneralTemplate = {
  id: 'zhangliao',
  name: '张辽',
  maxHp: 4,
  skills: [tuxi],
};

// ---------- 黄盖：苦肉 ----------

const kurou: Skill = {
  id: 'kurou',
  name: '苦肉',
  description: '出牌阶段，你可以失去1点体力，然后摸两张牌。',
  active: {
    usable: (_g, me) => me.hp > 0,
    *flow(game, me) {
      // 失去体力（非伤害，不触发奸雄/刚烈等"受到伤害"技能）
      me.hp -= 1;
      game.log(`${me.name} 失去 1 点体力（${me.hp}/${me.maxHp}）`);
      if (me.hp <= 0) yield* game.dying(me);
      if (me.alive && me.hp > 0) game.drawCards(me, 2);
    },
  },
};

export const HUANGGAI: GeneralTemplate = {
  id: 'huanggai',
  name: '黄盖',
  maxHp: 4,
  skills: [kurou],
};

// ---------- 曹操：奸雄 ----------

const jianxiong: Skill = {
  id: 'jianxiong',
  name: '奸雄',
  description: '当你受到伤害后，你可以获得对你造成伤害的牌。',
  triggers: [
    {
      on: 'damage',
      when: (e: GameEventMap['damage'], _g, me) => e.target === me && !!e.card,
      *flow(game, me, e: GameEventMap['damage']) {
        const card = e.card!;
        if (!game.discard.includes(card)) return false; // 牌已不在弃牌堆（被捡走等）
        const res = yield { kind: 'confirm', playerId: me.id, skillId: 'jianxiong' } as const;
        if (res.pass) return false;
        game.takeFromDiscard(card);
        me.hand.push(card);
        game.log(`${me.name} 发动【奸雄】，获得${cardText(card)}`);
        return true;
      },
    },
  ],
};

// 护驾的同势力响应挂点在引擎的 askCard 流程里（主公被杀求闪放弃后，按座次询问
// 其他魏势力角色代打【闪】）；这里只是占位标记：引擎通过 hasSkill('hujia') + 主公身份判定。
const hujia: Skill = {
  id: 'hujia',
  name: '护驾',
  description: '主公技，当你需要使用或打出一张【闪】时，你可以令其他魏势力角色选择是否打出一张【闪】。若有角色响应，则你视为使用或打出了一张【闪】。',
};

export const CAOCAO: GeneralTemplate = { id: 'caocao', name: '曹操', maxHp: 4, skills: [jianxiong, hujia] };

// ---------- 马超：马术 + 铁骑 ----------

const mashu: Skill = {
  id: 'mashu',
  name: '马术',
  description: '锁定技，你计算与其他角色的距离时-1。',
  listeners: [
    {
      type: 'distance-calc',
      priority: 0,
      handler: (e: GameEventMap['distance-calc'], _g, me) => {
        if (me && e.from === me) e.value -= 1; // 引擎在分发后钳到 >= 1
      },
    },
  ],
};

const tieji: Skill = {
  id: 'tieji',
  name: '铁骑',
  description: '当你使用【杀】指定目标后，你可以进行判定。若结果为红色，则此【杀】不可被闪避。',
  triggers: [
    {
      on: 'card-use',
      when: (e: GameEventMap['card-use'], _g, me) => e.player === me && e.card.name === 'sha',
      *flow(game, me, e: GameEventMap['card-use']) {
        const res = yield { kind: 'confirm', playerId: me.id, skillId: 'tieji' } as const;
        if (res.pass) return false;
        game.log(`${me.name} 发动【铁骑】`);
        const judge = yield* game.judgeCard(me, 'tieji');
        if (isRed(judge)) {
          game.shaFlags.set(e.card.id, { unjinkable: true });
          game.log(`${me.name} 的【铁骑】判定为红色，此${CARD_LABEL.sha}不可被闪避`);
        }
        return true;
      },
    },
  ],
};

export const MACHAO: GeneralTemplate = {
  id: 'machao',
  name: '马超',
  maxHp: 4,
  skills: [mashu, tieji],
};

// ---------- 张飞：咆哮 ----------

const paoxiao: Skill = {
  id: 'paoxiao',
  name: '咆哮',
  description: '锁定技，出牌阶段，你使用【杀】没有数量限制。',
  flags: { unlimitedSha: true }, // 引擎在 canPlay / availableSkills 里统一读取
};

export const ZHANGFEI: GeneralTemplate = {
  id: 'zhangfei',
  name: '张飞',
  maxHp: 4,
  skills: [paoxiao],
};

// ---------- 许褚：裸衣 ----------

const luoyi: Skill = {
  id: 'luoyi',
  name: '裸衣',
  description: '摸牌阶段，你可以少摸一张牌。若如此做，当你本回合内使用【杀】或【决斗】造成伤害时，此伤害+1。',
  listeners: [
    {
      // 本回合"裸衣"标记生效期间，自己造成的【杀】/【决斗】伤害 +1（监听器就地改 amount）
      type: 'damage',
      priority: 0,
      handler: (e: GameEventMap['damage'], _g, me) => {
        if (me?.turnFlags.has('luoyi') && e.source === me && (e.reason === 'sha' || e.reason === 'juedou')) {
          e.amount += 1;
        }
      },
    },
  ],
  triggers: [
    {
      on: 'phase-change',
      when: (e: GameEventMap['phase-change'], _g, me) => e.phase === 'draw' && e.player === me,
      replaces: 'draw-phase', // 发动后替换摸牌阶段：只摸 1 张
      *flow(game, me) {
        const res = yield { kind: 'confirm', playerId: me.id, skillId: 'luoyi' } as const;
        if (res.pass) return false;
        me.turnFlags.add('luoyi');
        game.log(`${me.name} 发动【裸衣】，少摸一张牌，本回合${CARD_LABEL.sha}与${CARD_LABEL.juedou}伤害+1`);
        game.drawCards(me, 1);
        return true;
      },
    },
  ],
};

export const XUZHU: GeneralTemplate = { id: 'xuzhu', name: '许褚', maxHp: 4, skills: [luoyi] };

// ---------- 夏侯惇：刚烈 ----------

const ganglie: Skill = {
  id: 'ganglie',
  name: '刚烈',
  description: '当你受到伤害后，你可以判定。若结果不为红桃，则伤害来源须弃置两张手牌，否则其受到来自你的1点伤害。',
  triggers: [
    {
      on: 'damage',
      // 来源须存活且不是自己（自己造成的伤害反伤自己会无限循环）
      when: (e: GameEventMap['damage'], _g, me) =>
        e.target === me && !!e.source && e.source !== me && e.source.alive,
      *flow(game, me, e: GameEventMap['damage']) {
        const source = e.source!;
        const res = yield { kind: 'confirm', playerId: me.id, skillId: 'ganglie' } as const;
        if (res.pass) return false;
        const judge = yield* game.judgeCard(me, 'ganglie');
        if (judge.suit === 'heart') {
          game.log(`${me.name} 的【刚烈】判定为红桃，无事发生`);
          return true;
        }
        if (!source.alive) return true; // 判定后来源已死亡
        // 手牌不足两张：无法选择弃牌，直接受到伤害
        if (source.hand.length < 2) {
          game.log(`${source.name} 手牌不足两张，受到【刚烈】的 1 点伤害`);
          yield* game.dealDamage(me, source, 1, 'ganglie');
          return true;
        }
        // 由伤害来源选择：弃两张手牌 或 受到 1 点伤害（非法选择重问）
        while (true) {
          const pick = yield {
            kind: 'choose-option',
            playerId: source.id,
            skillId: 'ganglie',
            options: [
              { id: 'discard', label: '弃置两张手牌' },
              { id: 'damage', label: '受到 1 点伤害' },
            ],
          } as const;
          const choice = !pick.pass && 'choice' in pick ? pick.choice : undefined;
          if (choice === 'damage') {
            yield* game.dealDamage(me, source, 1, 'ganglie');
            return true;
          }
          if (choice !== 'discard') continue;
          // 复用 discard 询问：来源选择恰好两张手牌弃置
          while (true) {
            const dres = yield { kind: 'discard', playerId: source.id, count: 2 } as const;
            if (dres.pass || !('cardIds' in dres) || !Array.isArray(dres.cardIds)) continue;
            const ids = dres.cardIds;
            if (ids.length !== 2 || new Set(ids).size !== 2) continue;
            const cards = ids.map((id) => source.hand.find((c) => c.id === id));
            if (cards.some((c) => !c)) continue;
            for (const card of cards as Card[]) {
              game.removeFromHand(source, card);
              game.toDiscard(card);
            }
            game.emit('card-discard', { player: source, cards: cards as Card[] });
            game.log(`${source.name} 弃置两张手牌（刚烈）`);
            return true;
          }
        }
      },
    },
  ],
};

export const XIAHOUDUN: GeneralTemplate = {
  id: 'xiahoudun',
  name: '夏侯惇',
  maxHp: 4,
  skills: [ganglie],
};

// ---------- 郭嘉：天妒 + 遗计 ----------

const tiandu: Skill = {
  id: 'tiandu',
  name: '天妒',
  description: '当你的判定牌生效后，你可以获得之。',
  triggers: [
    {
      on: 'judge',
      when: (e: GameEventMap['judge'], _g, me) => e.player === me,
      *flow(game, me, e: GameEventMap['judge']) {
        const card = e.card;
        if (!game.discard.includes(card)) return false; // 牌已被收走（如洛神直接获得）
        const res = yield { kind: 'confirm', playerId: me.id, skillId: 'tiandu' } as const;
        if (res.pass) return false;
        game.takeFromDiscard(card);
        me.hand.push(card);
        game.log(`${me.name} 发动【天妒】，获得判定牌${cardText(card)}`);
        return true;
      },
    },
  ],
};

const yiji: Skill = {
  id: 'yiji',
  name: '遗计',
  description: '当你受到1点伤害后，你可以观看牌堆顶的两张牌，然后将其分配给任意角色。',
  triggers: [
    {
      on: 'damage',
      when: (e: GameEventMap['damage'], _g, me) => e.target === me,
      *flow(game, me, e: GameEventMap['damage']) {
        const res = yield { kind: 'confirm', playerId: me.id, skillId: 'yiji' } as const;
        if (res.pass) return false;
        // 每 1 点伤害分配牌堆顶两张牌（可交给任意存活角色，含自己；放弃 = 自己保留）
        for (let i = 0; i < e.amount; i++) {
          if (game.over) return true;
          const cards = [game.deck.draw(), game.deck.draw()];
          game.log(`${me.name} 发动【遗计】，观看牌堆顶的${cards.map((c) => cardText(c)).join('、')}`);
          for (const card of cards) {
            while (true) {
              const gres = yield {
                kind: 'give-card',
                playerId: me.id,
                card,
                targetIds: game.alivePlayers().map((p) => p.id),
                skillId: 'yiji',
              } as const;
              if (gres.pass) {
                me.hand.push(card);
                game.log(`${me.name} 自己保留了${cardText(card)}`);
                break;
              }
              if (!('targetId' in gres)) continue;
              const target = game.alivePlayers().find((p) => p.id === gres.targetId);
              if (!target) continue; // 非法目标，重问
              target.hand.push(card);
              game.log(`${me.name} 将${cardText(card)}交给 ${target.name}`);
              break;
            }
          }
        }
        return true;
      },
    },
  ],
};

export const GUOJIA: GeneralTemplate = { id: 'guojia', name: '郭嘉', maxHp: 3, skills: [tiandu, yiji] };

// ---------- 甄姬：洛神 + 倾国 ----------

const luoshen: Skill = {
  id: 'luoshen',
  name: '洛神',
  description: '准备阶段，你可以判定。若结果为黑色，你获得判定牌。你可重复此流程，直到出现红色的判定结果。',
  triggers: [
    {
      on: 'turn-start', // 准备阶段：回合开始时的排水点（runTurn 开头）
      when: (e: GameEventMap['turn-start'], _g, me) => e.player === me,
      *flow(game, me) {
        let judged = false;
        while (true) {
          const res = yield { kind: 'confirm', playerId: me.id, skillId: 'luoshen' } as const;
          if (res.pass) return judged;
          judged = true;
          const judge = yield* game.judgeCard(me, 'luoshen');
          if (!isBlack(judge)) {
            game.log(`${me.name} 的【洛神】判定为红色，结束判定`);
            return true;
          }
          game.takeFromDiscard(judge);
          me.hand.push(judge);
          game.log(`${me.name} 的【洛神】判定为黑色，获得${cardText(judge)}，可继续判定`);
        }
      },
    },
  ],
};

const qingguo: Skill = {
  id: 'qingguo',
  name: '倾国',
  description: '你可以将一张黑色手牌当做【闪】使用或打出。',
  converts: [{ id: 'qingguo', name: '倾国', as: 'shan', match: isBlack }],
};

export const ZHENJI: GeneralTemplate = {
  id: 'zhenji',
  name: '甄姬',
  maxHp: 3,
  skills: [luoshen, qingguo],
};

// ---------- 华佗：急救 + 青囊 ----------

const jijiu: Skill = {
  id: 'jijiu',
  name: '急救',
  description: '你的回合外，你可以将一张红色牌当做【桃】使用。',
  converts: [
    // 仅回合外：自己的回合内（currentPhase 非空）不提供转化
    { id: 'jijiu', name: '急救', as: 'tao', match: isRed, condition: (_g, me) => me.currentPhase === null },
  ],
};

const qingnang: Skill = {
  id: 'qingnang',
  name: '青囊',
  description: '出牌阶段限一次，你可以弃置一张手牌并令一名角色回复1点体力。',
  active: {
    usable: (game, me) =>
      me.hand.length > 0 &&
      !me.turnFlags.has('qingnang') &&
      game.alivePlayers().some((q) => q.hp < q.maxHp),
    *flow(game, me, res) {
      const cardId = 'cardId' in res ? res.cardId : undefined;
      const targetId = 'targetId' in res ? res.targetId : undefined;
      const card = cardId ? me.hand.find((c) => c.id === cardId) : undefined;
      const target = targetId ? game.alivePlayers().find((p) => p.id === targetId) : undefined;
      if (!card || !target || target.hp >= target.maxHp) return; // 非法：不消耗次数，由出牌阶段重问
      game.removeFromHand(me, card);
      game.toDiscard(card);
      game.emit('card-discard', { player: me, cards: [card] });
      me.turnFlags.add('qingnang');
      game.heal(target, 1);
      game.log(`${me.name} 发动【青囊】，弃置${cardText(card)}，${target.name} 回复 1 点体力（${target.hp}/${target.maxHp}）`);
    },
  },
};

export const HUATUO: GeneralTemplate = { id: 'huatuo', name: '华佗', maxHp: 3, skills: [jijiu, qingnang] };

// ---------- 吕蒙：克己 ----------

const keji: Skill = {
  id: 'keji',
  name: '克己',
  description: '弃牌阶段开始时，若你于本回合的出牌阶段内没有使用或打出过【杀】，则你可以跳过此阶段。',
  listeners: [
    // 记录本回合出牌阶段内是否使用/打出过【杀】（含决斗/南蛮响应的打出）
    ...(['card-use', 'card-response'] as const).map((type) => ({
      type,
      priority: 0,
      handler: (e: GameEventMap['card-use'], _g: unknown, me: Player | undefined) => {
        if (me && e.player === me && e.card.name === 'sha' && me.currentPhase === 'play') {
          me.turnFlags.add('keji-sha');
        }
      },
    })),
  ],
  triggers: [
    {
      on: 'phase-change',
      when: (e: GameEventMap['phase-change'], _g, me) =>
        e.phase === 'discard' && e.player === me && !me.turnFlags.has('keji-sha'),
      replaces: 'discard-phase',
      *flow(game, me) {
        game.log(`${me.name} 发动【克己】，跳过弃牌阶段`);
        return true;
      },
    },
  ],
};

export const LVMENG: GeneralTemplate = { id: 'lvmeng', name: '吕蒙', maxHp: 4, skills: [keji] };

// ---------- 周瑜：英姿 + 反间 ----------

const yingzi: Skill = {
  id: 'yingzi',
  name: '英姿',
  description: '摸牌阶段，你可以多摸一张牌。',
  triggers: [
    {
      on: 'phase-change',
      when: (e: GameEventMap['phase-change'], _g, me) => e.phase === 'draw' && e.player === me,
      *flow(game, me) {
        const res = yield { kind: 'confirm', playerId: me.id, skillId: 'yingzi' } as const;
        if (res.pass) return false;
        game.log(`${me.name} 发动【英姿】，多摸一张牌`);
        game.drawCards(me, 1);
        return true; // 不带 replaces：正常摸牌照常进行
      },
    },
  ],
};

const FANJIAN_SUITS: readonly Suit[] = ['spade', 'heart', 'club', 'diamond'];

const fanjian: Skill = {
  id: 'fanjian',
  name: '反间',
  description: '出牌阶段限一次。你可以令一名角色选择一种花色，然后其获得你的一张手牌。若其以此法选择的花色与其得到的牌花色不同，则你对其造成1点伤害。',
  active: {
    usable: (game, me) =>
      me.hand.length > 0 &&
      !me.turnFlags.has('fanjian') &&
      game.alivePlayers().some((q) => q !== me),
    *flow(game, me, res) {
      const targetId = 'targetId' in res ? res.targetId : undefined;
      const target = targetId ? game.alivePlayers().find((p) => p.id === targetId && p !== me) : undefined;
      if (!target || me.hand.length === 0) return; // 非法目标：不消耗次数
      me.turnFlags.add('fanjian');
      // 由目标角色猜花色（非法选择重问）
      let guess: Suit | undefined;
      while (!guess) {
        const gres = yield {
          kind: 'choose-option',
          playerId: target.id,
          skillId: 'fanjian',
          options: FANJIAN_SUITS.map((s) => ({ id: s, label: SUIT_LABEL[s] })),
        } as const;
        const choice = !gres.pass && 'choice' in gres ? gres.choice : undefined;
        if (FANJIAN_SUITS.includes(choice as Suit)) guess = choice as Suit;
      }
      // 目标随机获得你的一张手牌并展示（简化：随机抽取，与突袭取牌一致）
      const card = me.hand[Math.floor(Math.random() * me.hand.length)];
      game.removeFromHand(me, card);
      target.hand.push(card);
      game.log(`${target.name} 猜测${SUIT_LABEL[guess]}，获得 ${me.name} 的${cardText(card)}（反间）`);
      if (card.suit !== guess) {
        game.log(`花色不同，${me.name} 对 ${target.name} 造成 1 点伤害`);
        yield* game.dealDamage(me, target, 1, 'fanjian');
      }
    },
  },
};

export const ZHOUYU: GeneralTemplate = { id: 'zhouyu', name: '周瑜', maxHp: 3, skills: [yingzi, fanjian] };

// ---------- 刘备：仁德 ----------

const rende: Skill = {
  id: 'rende',
  name: '仁德',
  description: '出牌阶段，你可以将任意张手牌交给其他角色。当你以此法于一回合内给出第二张牌时，你回复1点体力。',
  active: {
    usable: (game, me) => me.hand.length > 0 && game.alivePlayers().some((q) => q !== me),
    *flow(game, me, res) {
      // 多选牌（cardIds）+ 一名目标（targetId）；兼容单张的 cardId 形式
      const ids =
        'cardIds' in res && Array.isArray(res.cardIds)
          ? res.cardIds
          : 'cardId' in res && res.cardId
            ? [res.cardId]
            : [];
      const targetId = 'targetId' in res ? res.targetId : undefined;
      const target = targetId
        ? game.alivePlayers().find((p) => p.id === targetId && p !== me)
        : undefined;
      const cards = ids.map((id) => me.hand.find((c) => c.id === id));
      // 非法（无目标/无牌/重复/牌不在手中）：不生效，由出牌阶段重问
      if (!target || ids.length === 0 || new Set(ids).size !== ids.length || cards.some((c) => !c)) return;
      for (const card of cards as Card[]) game.removeFromHand(me, card);
      target.hand.push(...(cards as Card[]));
      const given = (me.turnCounts.get('rende') ?? 0) + cards.length;
      me.turnCounts.set('rende', given);
      game.log(`${me.name} 发动【仁德】，将 ${cards.length} 张手牌交给 ${target.name}（本回合累计给出 ${given} 张）`);
      // 官方：一回合内首次累计给出第二张牌时回复 1 点体力（满血不回复，但这次机会仍消耗）
      if (given >= 2 && !me.turnFlags.has('rende-healed')) {
        me.turnFlags.add('rende-healed');
        if (me.hp < me.maxHp) {
          game.heal(me, 1);
          game.log(`${me.name} 的【仁德】：回复 1 点体力（${me.hp}/${me.maxHp}）`);
        }
      }
    },
  },
};

// 激将的同势力响应挂点在引擎的 askCard 流程里（主公在南蛮/决斗/借刀求杀放弃后，
// 按座次询问其他蜀势力角色代打【杀】）；出牌阶段主动激将出杀留 TODO（引擎注释处）。
const jijiang: Skill = {
  id: 'jijiang',
  name: '激将',
  description: '主公技，当你需要使用或打出【杀】时，你可以令其他蜀势力角色依次选择是否打出一张【杀】。若有角色响应，则你视为使用或打出了此【杀】。',
};

export const LIUBEI: GeneralTemplate = { id: 'liubei', name: '刘备', maxHp: 4, skills: [rende, jijiang] };

// ---------- 孙权：制衡 ----------

const zhiheng: Skill = {
  id: 'zhiheng',
  name: '制衡',
  description: '出牌阶段限一次，你可以弃置任意张牌，然后摸等量的牌。',
  active: {
    usable: (_g, me) => me.hand.length > 0 && !me.turnFlags.has('zhiheng'),
    *flow(game, me, res) {
      const ids = 'cardIds' in res && Array.isArray(res.cardIds) ? res.cardIds : [];
      const cards = ids.map((id) => me.hand.find((c) => c.id === id));
      // 简化：制衡只弃手牌（不含装备区）；非法选择（空/重复/不在手中）不消耗次数，重问
      if (ids.length === 0 || new Set(ids).size !== ids.length || cards.some((c) => !c)) return;
      me.turnFlags.add('zhiheng');
      for (const card of cards as Card[]) {
        game.removeFromHand(me, card);
        game.toDiscard(card);
      }
      game.emit('card-discard', { player: me, cards: cards as Card[] });
      game.log(`${me.name} 发动【制衡】，弃置 ${cards.length} 张牌：${(cards as Card[]).map((c) => cardText(c)).join('')}`);
      game.drawCards(me, cards.length);
    },
  },
};

// 救援的挂点在引擎的濒死求桃流程里（其他吴势力角色对濒死主公使用【桃】时额外回复 1 点）；
// 这里只是占位标记：引擎通过 hasSkill('jiuyuan') + 主公身份判定。
const jiuyuan: Skill = {
  id: 'jiuyuan',
  name: '救援',
  description: '主公技，锁定技，其他吴势力角色在你濒死状态下对你使用【桃】时，你额外回复1点体力。',
};

export const SUNQUAN: GeneralTemplate = { id: 'sunquan', name: '孙权', maxHp: 4, skills: [zhiheng, jiuyuan] };

// ---------- 貂蝉：离间 + 闭月 ----------

const lijian: Skill = {
  id: 'lijian',
  name: '离间',
  description: '出牌阶段限一次，你可以弃置一张牌，视为一名男性角色对另一名男性角色使用一张【决斗】（不可被【无懈可击】响应）。',
  active: {
    usable: (game, me) =>
      me.hand.length > 0 &&
      !me.turnFlags.has('lijian') &&
      game.alivePlayers().filter((q) => q.gender === 'male').length >= 2,
    *flow(game, me, res) {
      const cardId =
        'cardId' in res && res.cardId
          ? res.cardId
          : 'cardIds' in res && Array.isArray(res.cardIds)
            ? res.cardIds[0]
            : undefined;
      const card = cardId ? me.hand.find((c) => c.id === cardId) : undefined;
      const t1Id = 'targetId' in res ? res.targetId : undefined;
      const t2Id = 'targetId2' in res ? res.targetId2 : undefined;
      const t1 = t1Id ? game.alivePlayers().find((p) => p.id === t1Id) : undefined;
      const t2 = t2Id ? game.alivePlayers().find((p) => p.id === t2Id) : undefined;
      // 需要：一张手牌 + 两名不同的存活男性角色（先选者视为决斗的使用者）；非法不消耗次数
      if (!card || !t1 || !t2 || t1 === t2 || t1.gender !== 'male' || t2.gender !== 'male') return;
      me.turnFlags.add('lijian');
      game.removeFromHand(me, card);
      game.toDiscard(card);
      game.emit('card-discard', { player: me, cards: [card] });
      game.log(
        `${me.name} 发动【离间】，弃置${cardText(card)}，视为 ${t1.name} 对 ${t2.name} 使用${CARD_LABEL.juedou}（不可被${CARD_LABEL.wuxie}响应）`,
      );
      // 虚拟决斗：公共日志可见"使用【决斗】"；没有实体牌（奸雄无从获得），跳过无懈链
      const virtual = makeCard('juedou');
      game.emit('card-use', { player: t1, card: virtual, target: t2 });
      yield* game.juedouDuel(t1, t2);
    },
  },
};

const biyue: Skill = {
  id: 'biyue',
  name: '闭月',
  description: '结束阶段，你可以摸一张牌。',
  triggers: [
    {
      on: 'phase-change',
      when: (e: GameEventMap['phase-change'], _g, me) => e.phase === 'finish' && e.player === me,
      *flow(game, me) {
        const res = yield { kind: 'confirm', playerId: me.id, skillId: 'biyue' } as const;
        if (res.pass) return false;
        game.log(`${me.name} 发动【闭月】，摸一张牌`);
        game.drawCards(me, 1);
        return true;
      },
    },
  ],
};

export const DIAOCHAN: GeneralTemplate = {
  id: 'diaochan',
  name: '貂蝉',
  maxHp: 3,
  skills: [lijian, biyue],
};

// ---------- 孙尚香：结姻 + 枭姬 ----------

const jieyin: Skill = {
  id: 'jieyin',
  name: '结姻',
  description: '出牌阶段限一次，你可以弃置两张手牌并选择一名已经受伤的男性角色。你与其各回复1点体力。',
  active: {
    usable: (game, me) =>
      me.hand.length >= 2 &&
      !me.turnFlags.has('jieyin') &&
      game.alivePlayers().some((q) => q.gender === 'male' && q.hp < q.maxHp),
    *flow(game, me, res) {
      const ids = 'cardIds' in res && Array.isArray(res.cardIds) ? res.cardIds : [];
      const targetId = 'targetId' in res ? res.targetId : undefined;
      const target = targetId
        ? game.alivePlayers().find((p) => p.id === targetId && p.gender === 'male' && p.hp < p.maxHp)
        : undefined;
      const cards = ids.map((id) => me.hand.find((c) => c.id === id));
      // 需要：恰好两张手牌 + 一名已受伤的存活男性角色；非法不消耗次数
      if (!target || ids.length !== 2 || new Set(ids).size !== 2 || cards.some((c) => !c)) return;
      me.turnFlags.add('jieyin');
      for (const card of cards as Card[]) {
        game.removeFromHand(me, card);
        game.toDiscard(card);
      }
      game.emit('card-discard', { player: me, cards: cards as Card[] });
      game.heal(me, 1);
      game.heal(target, 1);
      game.log(
        `${me.name} 发动【结姻】，弃置两张手牌，与 ${target.name} 各回复 1 点体力（${me.hp}/${me.maxHp}，${target.hp}/${target.maxHp}）`,
      );
    },
  },
};

const xiaoji: Skill = {
  id: 'xiaoji',
  name: '枭姬',
  description: '当你失去一张装备区内的牌后，你可以摸两张牌。',
  triggers: [
    {
      // 装备区失牌（被拆/被顺/被替换/借刀抽武器）由引擎发 equip-lose，每张牌触发一次
      on: 'equip-lose',
      when: (e: GameEventMap['equip-lose'], _g, me) => e.player === me,
      *flow(game, me) {
        const res = yield { kind: 'confirm', playerId: me.id, skillId: 'xiaoji' } as const;
        if (res.pass) return false;
        game.log(`${me.name} 发动【枭姬】，摸两张牌`);
        game.drawCards(me, 2);
        return true;
      },
    },
  ],
};

export const SUNSHANGXIANG: GeneralTemplate = {
  id: 'sunshangxiang',
  name: '孙尚香',
  maxHp: 3,
  skills: [jieyin, xiaoji],
};

// ---------- 黄月英：集智 + 奇才 ----------

const jizhi: Skill = {
  id: 'jizhi',
  name: '集智',
  description: '当你使用普通锦囊牌时，你可以摸一张牌。',
  triggers: [
    {
      on: 'card-use',
      when: (e: GameEventMap['card-use'], _g, me) =>
        e.player === me && CARD_DEFS[e.card.name].type === 'trick' && !CARD_DEFS[e.card.name].delayed,
      *flow(game, me) {
        const res = yield { kind: 'confirm', playerId: me.id, skillId: 'jizhi' } as const;
        if (res.pass) return false;
        game.log(`${me.name} 发动【集智】，摸一张牌`);
        game.drawCards(me, 1);
        return true;
      },
    },
  ],
};

const qicai: Skill = {
  id: 'qicai',
  name: '奇才',
  description: '锁定技，你使用锦囊牌无距离限制。',
  flags: { trickNoDistance: true }, // 引擎在 canPlay 的顺手牵羊距离校验里读取
};

export const HUANGYUEYING: GeneralTemplate = {
  id: 'huangyueying',
  name: '黄月英',
  maxHp: 3,
  skills: [jizhi, qicai],
};

// ---------- 司马懿：反馈 + 鬼才 ----------

const fankui: Skill = {
  id: 'fankui',
  name: '反馈',
  description: '当你受到伤害后，你可以获得伤害来源的一张牌。',
  triggers: [
    {
      on: 'damage',
      // 来源须不是自己；来源区域里没牌时不问
      when: (e: GameEventMap['damage'], game, me) =>
        e.target === me && !!e.source && e.source !== me && game.regionCards(e.source).length > 0,
      *flow(game, me, e: GameEventMap['damage']) {
        const source = e.source!;
        const res = yield { kind: 'confirm', playerId: me.id, skillId: 'fankui' } as const;
        if (res.pass) return false;
        if (game.regionCards(source).length === 0) return true; // 确认后来源区域已无牌
        // 复用区域取牌逻辑（手牌随机，装备/判定区按序）
        const taken = game.pickRegionCard(source)!;
        game.removeRegionCard(source, taken);
        me.hand.push(taken);
        game.log(`${me.name} 发动【反馈】，获得 ${source.name} 的${cardText(taken)}`);
        return true;
      },
    },
  ],
};

// 鬼才的改判挂点在引擎的 judgeCard 流程里（judge-retrial 询问按座次发出），
// 这里只是占位标记：引擎通过 hasSkill('guicai') 判定谁会鬼才。
const guicai: Skill = {
  id: 'guicai',
  name: '鬼才',
  description: '一名角色的判定牌生效前，你可以打出一张手牌代替之。',
};

export const SIMAYI: GeneralTemplate = { id: 'simayi', name: '司马懿', maxHp: 3, skills: [fankui, guicai] };

// ---------- 吕布：无双 ----------

const wushuang: Skill = {
  id: 'wushuang',
  name: '无双',
  description: '锁定技，你使用【杀】需两张【闪】才能抵消；决斗中对方每次响应需打出两张【杀】。',
  flags: { wushuang: true }, // 引擎在 resolveSha（求闪次数）与 juedouDuel（求杀次数）里读取
};

export const LVBU: GeneralTemplate = { id: 'lvbu', name: '吕布', maxHp: 4, skills: [wushuang] };

// ---------- 诸葛亮：观星 + 空城 ----------

const guanxing: Skill = {
  id: 'guanxing',
  name: '观星',
  description: '准备阶段，你可以观看牌堆顶的X张牌，并将其以任意顺序置于牌堆顶或牌堆底。（X为存活角色数且至多为5）',
  triggers: [
    {
      on: 'turn-start', // 准备阶段：回合开始时的排水点（与洛神同挂点）
      when: (e: GameEventMap['turn-start'], _g, me) => e.player === me,
      *flow(game, me) {
        // 无限/随机牌堆没有"顶/底"概念，观星退化为不发动
        if (!game.deck.putBackTop || !game.deck.putBackBottom) return false;
        const res = yield { kind: 'confirm', playerId: me.id, skillId: 'guanxing' } as const;
        if (res.pass) return false;
        const x = Math.min(game.alivePlayers().length, 5);
        const cards = Array.from({ length: x }, () => game.deck.draw());
        game.log(`${me.name} 发动【观星】，观看牌堆顶 ${x} 张牌`);
        // 简化交互：展示 X 张，选择其中任意张放牌堆底（保持相对顺序），其余保持原顺序回顶
        while (true) {
          const pick = yield {
            kind: 'guanxing',
            playerId: me.id,
            cards: [...cards],
            skillId: 'guanxing',
          } as const;
          const ids = pick.pass ? [] : 'cardIds' in pick && Array.isArray(pick.cardIds) ? pick.cardIds : null;
          if (!ids) continue;
          if (new Set(ids).size !== ids.length) continue; // 重复：非法
          if (!ids.every((id) => cards.some((c) => c.id === id))) continue; // 不在展示牌中：非法
          const bottom = cards.filter((c) => ids.includes(c.id));
          const top = cards.filter((c) => !ids.includes(c.id));
          game.deck.putBackBottom!(bottom);
          game.deck.putBackTop!(top);
          game.log(
            bottom.length > 0
              ? `${me.name} 将 ${bottom.length} 张牌置于牌堆底，其余 ${top.length} 张回顶`
              : `${me.name} 将 ${top.length} 张牌全部放回牌堆顶`,
          );
          return true;
        }
      },
    },
  ],
};

const kongcheng: Skill = {
  id: 'kongcheng',
  name: '空城',
  description: '锁定技，当你没有手牌时，你不能成为【杀】或【决斗】的目标。',
  flags: { kongcheng: true }, // 引擎在 canPlay（杀/决斗/借刀）与流离候选里读取
};

export const ZHUGELIANG: GeneralTemplate = {
  id: 'zhugeliang',
  name: '诸葛亮',
  maxHp: 3,
  skills: [guanxing, kongcheng],
};

// ---------- 大乔：国色 + 流离 ----------

const guose: Skill = {
  id: 'guose',
  name: '国色',
  description: '你可以将一张方片牌当做【乐不思蜀】使用。',
  converts: [
    { id: 'guose', name: '国色', as: 'lebu', match: (c) => c.suit === 'diamond', activeUse: true },
  ],
};

const liuli: Skill = {
  id: 'liuli',
  name: '流离',
  description: '当你成为【杀】的目标时，你可以弃置一张牌并将此【杀】转移给攻击范围内的一名其他角色（不能是此【杀】的使用者）。',
  triggers: [
    {
      // 成为【杀】的目标时（card-use 的目标是自己）；手里有牌才有弃牌代价
      on: 'card-use',
      when: (e: GameEventMap['card-use'], _g, me) =>
        e.target === me && e.card.name === 'sha' && me.hand.length > 0,
      *flow(game, me, e: GameEventMap['card-use']) {
        const user = e.player;
        // 候选：自己攻击范围内的其他角色，不能是杀的使用者，也不能是空城中的诸葛亮
        const candidates = game
          .alivePlayers()
          .filter((q) => q !== me && q !== user && game.canAttack(me, q) && !game.isKongcheng(q));
        if (candidates.length === 0) return false;
        while (true) {
          const res = yield {
            kind: 'choose-target',
            playerId: me.id,
            targetIds: candidates.map((c) => c.id),
            min: 1,
            max: 1,
            skillId: 'liuli',
          } as const;
          if (res.pass) return false;
          if (!('targetIds' in res)) continue;
          const ids = res.targetIds;
          if (ids.length !== 1) continue;
          const t = candidates.find((c) => c.id === ids[0]);
          if (!t) continue; // 非法目标（含杀的使用者），重问
          // 弃置一张手牌作为代价（不可放弃）
          while (true) {
            const dres = yield { kind: 'discard', playerId: me.id, count: 1, skillId: 'liuli' } as const;
            if (dres.pass || !('cardIds' in dres) || !Array.isArray(dres.cardIds)) continue;
            const dids = dres.cardIds;
            if (dids.length !== 1) continue;
            const cost = me.hand.find((c) => c.id === dids[0]);
            if (!cost) continue;
            game.removeFromHand(me, cost);
            game.toDiscard(cost);
            game.emit('card-discard', { player: me, cards: [cost] });
            break;
          }
          // 杀结算中途换目标：经 shaFlags.retarget 传给 resolveSha
          const flags = game.shaFlags.get(e.card.id) ?? {};
          game.shaFlags.set(e.card.id, { ...flags, retarget: t });
          game.log(`${me.name} 发动【流离】，将${CARD_LABEL.sha}转移给 ${t.name}`);
          return true;
        }
      },
    },
  ],
};

export const DAQIAO: GeneralTemplate = { id: 'daqiao', name: '大乔', maxHp: 3, skills: [guose, liuli] };

// ---------- 陆逊：谦逊 + 连营 ----------

const qianxun: Skill = {
  id: 'qianxun',
  name: '谦逊',
  description: '锁定技，你不能成为【顺手牵羊】和【乐不思蜀】的目标。',
  flags: { immuneToTricks: ['shunshou', 'lebu'] }, // 引擎在 canPlay 的目标校验里读取
};

const lianying: Skill = {
  id: 'lianying',
  name: '连营',
  description: '当你失去最后的手牌时，你可以摸一张牌。',
  triggers: [
    {
      // hand-empty 由引擎在一切"失去手牌"的途径上发出；触发走 pendingTriggers 队列，
      // 摸牌是同步操作，嵌套（连营摸的牌马上又失去）只会在队列里再排一次，不会递归死循环
      on: 'hand-empty',
      when: (e: GameEventMap['hand-empty'], _g, me) => e.player === me,
      *flow(game, me) {
        const res = yield { kind: 'confirm', playerId: me.id, skillId: 'lianying' } as const;
        if (res.pass) return false;
        game.log(`${me.name} 发动【连营】，摸一张牌`);
        game.drawCards(me, 1);
        return true;
      },
    },
  ],
};

export const LUXUN: GeneralTemplate = { id: 'luxun', name: '陆逊', maxHp: 3, skills: [qianxun, lianying] };

/** 本批已实现的武将模板，按武将 id 索引。 */
export const GENERAL_TEMPLATES: Record<string, GeneralTemplate> = {
  guanyu: GUANYU,
  zhaoyun: ZHAOYUN,
  ganning: GANNING,
  zhangliao: ZHANGLIAO,
  huanggai: HUANGGAI,
  caocao: CAOCAO,
  machao: MACHAO,
  zhangfei: ZHANGFEI,
  xuzhu: XUZHU,
  xiahoudun: XIAHOUDUN,
  guojia: GUOJIA,
  zhenji: ZHENJI,
  huatuo: HUATUO,
  lvmeng: LVMENG,
  zhouyu: ZHOUYU,
  liubei: LIUBEI,
  sunquan: SUNQUAN,
  diaochan: DIAOCHAN,
  sunshangxiang: SUNSHANGXIANG,
  huangyueying: HUANGYUEYING,
  simayi: SIMAYI,
  lvbu: LVBU,
  zhugeliang: ZHUGELIANG,
  daqiao: DAQIAO,
  luxun: LUXUN,
};

// 势力/性别的事实数据只在 standard-generals.ts 维护一份，这里按武将 id 回填到模板
for (const [id, template] of Object.entries(GENERAL_TEMPLATES)) {
  const data = STANDARD_GENERALS.find((g) => g.id === id);
  if (!data) throw new Error(`武将模板缺少事实数据：${id}`);
  template.kingdom = data.kingdom;
  template.gender = data.gender;
}

export const IMPLEMENTED_GENERAL_IDS = Object.keys(GENERAL_TEMPLATES);
