/**
 * CLI demo：两个简单 AI 用标准版 108 张牌堆 + 随机分配的武将自动打完一局。
 *
 * AI 策略（简单但覆盖第三阶段全部技能机制）：
 *   - 响应：被杀出闪、南蛮出杀、万箭出闪、濒死吃桃、决斗/借刀出杀；
 *     没有天然牌时用转化技（武圣红牌当杀、龙胆杀闪互换）；
 *     锦囊目标是自己时打无懈可击（可反无懈）；五谷丰登优先拿桃/杀。
 *   - 触发技确认一律发动（奸雄/铁骑/突袭都是正收益）；突袭选手牌最多的至多两人。
 *   - 出牌：吃桃 → 换装（武器换范围大的）→ 无中生有/五谷丰登 →
 *     南蛮/万箭 → 顺手牵羊/过河拆桥 → 奇袭（黑牌当拆）→ 有杀则决斗 →
 *     乐不思蜀 → 桃园结义 → 杀 → 武圣/龙胆转化杀 → 手牌少且血多时苦肉。
 *   - 不用【闪电】（可能劈自己）与【借刀杀人】（两人局只能指自己为杀目标）。
 *
 * 运行：npm run demo
 */

import {
  CARD_DEFS,
  GENERAL_TEMPLATES,
  Game,
  Standard108Deck,
  isBlack,
  isRed,
  mulberry32,
  type AskRequest,
  type AskResponse,
  type CardName,
  type Controller,
  type Player,
} from '../src/index.js';

class SimpleAI implements Controller {
  onAsk(ask: AskRequest, game: Game): AskResponse {
    const me = game.getPlayer(ask.playerId);

    if (ask.kind === 'choose-card') {
      // 五谷丰登：优先拿桃，其次杀，否则第一张
      const pick =
        ask.cards.find((c) => c.name === 'tao') ??
        ask.cards.find((c) => c.name === 'sha') ??
        ask.cards[0];
      return { cardId: pick.id };
    }

    if (ask.kind === 'confirm') {
      // 奸雄/铁骑/突袭：都是正收益，一律发动
      return { confirm: true };
    }

    if (ask.kind === 'choose-target') {
      // 突袭：选手牌最多的至多 max 名候选
      const targets = [...ask.targetIds]
        .sort((x, y) => game.getPlayer(y).hand.length - game.getPlayer(x).hand.length)
        .slice(0, ask.max);
      return targets.length > 0 ? { targetIds: targets } : { pass: true };
    }

    if (ask.kind === 'choose-option') {
      // 刚烈/反间等互斥选项：兜底选第一项
      return { choice: ask.options[0].id };
    }

    if (ask.kind === 'give-card') {
      // 遗计分配：兜底自己保留
      return { pass: true };
    }

    if (ask.kind === 'judge-retrial') {
      // 鬼才改判：简化策略——只在自己（或无人）的乐不思蜀判出非红桃时改判……
      // 演示用 AI 不做阵营判断，一律不改判
      return { pass: true };
    }

    if (ask.kind === 'guanxing') {
      // 观星：简化策略——全部保持顺序回顶
      return { pass: true };
    }

    if (ask.kind === 'discard') {
      // 弃牌阶段：优先留杀/闪/桃，弃最前面的"杂牌"
      const keep = new Set(['sha', 'shan', 'tao']);
      const sorted = [...me.hand].sort((a, b) => Number(keep.has(a.name)) - Number(keep.has(b.name)));
      return { cardIds: sorted.slice(0, ask.count).map((c) => c.id) };
    }

    if (ask.kind === 'response') {
      if (ask.wants === 'wuxie') {
        // 只在自己成为锦囊目标时打无懈；自己的反无懈也跟进
        const wuxie = me.findCard('wuxie');
        return wuxie && ask.targetId === me.id ? { cardId: wuxie.id } : { pass: true };
      }
      // 被杀求闪、南蛮求杀、万箭求闪、濒死求桃、决斗/借刀求杀：有就打出
      const card = me.findCard(ask.wants);
      if (card) return { cardId: card.id };
      // 没有天然牌时用转化技（武圣/龙胆/丈八蛇矛），引擎已把可转化的手牌列在 cardIds 里；
      // 多牌转化（丈八蛇矛两张当杀）按 count 凑齐 cardIds
      const conv = ask.converts?.find((c) => c.cardIds.length >= (c.count ?? 1));
      if (conv) {
        const need = conv.count ?? 1;
        return need > 1
          ? { useSkill: conv.skillId, cardIds: conv.cardIds.slice(0, need) }
          : { useSkill: conv.skillId, cardId: conv.cardIds[0] };
      }
      return { pass: true };
    }

    // ---- 出牌阶段 ----
    const enemies = game.alivePlayers().filter((p) => p !== me);
    const tryPlay = (name: CardName, target?: Player): AskResponse | null => {
      const card = me.findCard(name);
      if (!card) return null;
      return game.canPlay(me, card, target?.id) === null
        ? { cardId: card.id, targetId: target?.id }
        : null;
    };

    // 1. 残血吃桃
    if (me.hp < me.maxHp) {
      const tao = tryPlay('tao');
      if (tao) return tao;
    }
    // 2. 装备：空槽位直接装；武器只换范围更大的
    for (const card of me.hand) {
      const def = CARD_DEFS[card.name];
      if (def.type !== 'equip' || !def.equipSlot) continue;
      const current = me.equips[def.equipSlot];
      if (!current) return { cardId: card.id };
      if (
        def.equipSlot === 'weapon' &&
        (def.range ?? 1) > (CARD_DEFS[current.name].range ?? 1)
      ) {
        return { cardId: card.id };
      }
    }
    // 3. 过牌锦囊
    for (const name of ['wuzhong', 'wugu'] as const) {
      const res = tryPlay(name);
      if (res) return res;
    }
    // 4. 群体伤害锦囊
    for (const name of ['nanman', 'wanjian'] as const) {
      const res = tryPlay(name);
      if (res) return res;
    }
    // 5. 单体锦囊：顺手牵羊 / 过河拆桥 / 决斗（手里有杀才决斗）/ 乐不思蜀
    for (const enemy of enemies) {
      for (const name of ['shunshou', 'guohe'] as const) {
        const res = tryPlay(name, enemy);
        if (res) return res;
      }
    }
    const enemy = enemies[0];
    if (enemy) {
      if (me.findCard('sha')) {
        const res = tryPlay('juedou', enemy);
        if (res) return res;
      }
      const lebu = tryPlay('lebu', enemy);
      if (lebu) return lebu;
    }
    // 6. 桃园结义（自己残血时）
    const taoyuan = tryPlay('taoyuan');
    if (taoyuan) return taoyuan;
    // 7. 出杀
    const sha = me.findCard('sha');
    if (sha) {
      const target = enemies.find((p) => game.canPlay(me, sha, p.id) === null);
      if (target) return { cardId: sha.id, targetId: target.id };
    }
    // 8. 技能（availableSkills 由引擎按当前状态给出）
    const skills = ask.availableSkills ?? [];
    // 奇袭：黑牌当拆（敌人区域里有牌才用）
    if (skills.includes('qixi') && enemy) {
      const black = me.hand.find((c) => isBlack(c) && c.name !== 'guohe');
      if (black && game.regionCards(enemy).length > 0 && game.canPlay(me, { ...black, name: 'guohe' }, enemy.id) === null) {
        return { useSkill: 'qixi', cardId: black.id, targetId: enemy.id };
      }
    }
    // 武圣/龙胆：把红牌/闪当杀补刀（正常杀已用过或没有杀时）
    for (const skillId of ['wusheng', 'longdan-sha'] as const) {
      if (!skills.includes(skillId) || !enemy) continue;
      const card = me.hand.find((c) =>
        skillId === 'wusheng' ? isRed(c) && c.name !== 'sha' : c.name === 'shan',
      );
      if (card && game.canAttack(me, enemy)) {
        return { useSkill: skillId, cardId: card.id, targetId: enemy.id };
      }
    }
    // 苦肉：血多且手牌少时换牌
    if (skills.includes('kurou') && me.hp > 2 && me.hand.length <= 2) {
      return { useSkill: 'kurou' };
    }
    return { pass: true };
  }
}

// 项目未依赖 @types/node，这里只声明用到的最小形态
declare const process: { argv: string[] };

// 随机分配两名本批武将（带种子，结果可复现）；可用 `npm run demo -- 123` 换种子
const SEED = Number(process.argv[2] ?? 42);
const rand = mulberry32(SEED);
const generalIds = Object.keys(GENERAL_TEMPLATES);
for (let i = generalIds.length - 1; i > 0; i--) {
  const j = Math.floor(rand() * (i + 1));
  [generalIds[i], generalIds[j]] = [generalIds[j], generalIds[i]];
}
const picked = generalIds.slice(0, 2);

// 标准版 108 张牌堆（带种子）；摸空时自动洗回弃牌堆。
const game = new Game({
  playerNames: ['玩家A', '玩家B'],
  generals: picked.map((id) => GENERAL_TEMPLATES[id]),
  deck: new Standard108Deck(SEED),
});
game.onLog = (msg) => console.log(msg);

// 引擎是 generator 状态机：demo 驱动层逐步消费 AskRequest，并设步数上限兜底。
const ai = new SimpleAI();
const flow = game.run();
const MAX_STEPS = 20_000;
let steps = 0;
let result: { winner: (typeof game.players)[number] | null; turns: number } | null = null;
let step = flow.next();
while (!step.done) {
  if (++steps > MAX_STEPS) {
    console.log(`超过 ${MAX_STEPS} 步仍未分胜负，判定平局`);
    break;
  }
  step = flow.next(ai.onAsk(step.value, game));
}
if (step.done) result = step.value;

console.log('');
console.log(`===== 对局结束 =====`);
console.log(`胜者：${result?.winner?.name ?? '无（平局）'}，共进行 ${result?.turns ?? game.turn} 个回合`);
for (const p of game.players) {
  console.log(
    `${p.name}（${p.general.name}）：${p.alive ? `存活，体力 ${p.hp}/${p.maxHp}` : '死亡'}，手牌 ${p.hand.length} 张`,
  );
}
