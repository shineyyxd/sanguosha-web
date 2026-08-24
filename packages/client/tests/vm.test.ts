/**
 * 视图模型层单测：座次排序、提示文案、响应/出牌选项、AskResponse 组装。
 */

import { describe, expect, it } from 'vitest';
import { makeCard } from '@sanguosha/engine';
import type { AskRequest, PublicState } from '../src/protocol.js';
import {
  KINGDOM_LABEL,
  ROLE_LABEL,
  ROLE_OBJECTIVE,
  askPrompt,
  buildResponse,
  cardColor,
  opponentsOf,
  playSkillOptions,
  responseOptions,
  roleBadge,
  skillMeta,
} from '../src/core/vm.js';

function pub(seat: number, id: string, role: 'lord' | 'loyalist' | 'rebel' | 'renegade' | null = null) {
  return {
    id, name: id, seat, generalName: '白板', kingdom: null, gender: 'male' as const, hp: 4, maxHp: 4, alive: true,
    handCount: 0, role,
    equips: { weapon: null, armor: null, horsePlus: null, horseMinus: null },
    judgeArea: [], currentPhase: null, trusted: false,
  };
}

function state(meSeat: number, seats: number[]): PublicState {
  return {
    code: 'TEST', status: 'playing', turn: 1,
    players: seats.map((s) => pub(s, `p${s}`)),
    me: { id: `p${meSeat}`, seat: meSeat, hand: [], role: null },
    deckCount: 100, discardCount: 0, discardTop: null,
    pendingPlayerId: null, winnerId: null, logs: [],
  };
}

describe('opponentsOf', () => {
  it('按我的下家开始排序，排除自己', () => {
    const s = state(1, [0, 1, 2, 3]);
    expect(opponentsOf(s).map((p) => p.id)).toEqual(['p2', 'p3', 'p0']);
  });
});

describe('cardColor', () => {
  it('红桃方块为红，黑桃梅花为黑，无花色为 none', () => {
    expect(cardColor(makeCard('sha', { suit: 'heart', rank: 7 }))).toBe('red');
    expect(cardColor(makeCard('sha', { suit: 'spade', rank: 7 }))).toBe('black');
    expect(cardColor(makeCard('sha'))).toBe('none');
  });
});

describe('askPrompt', () => {
  it('response 提示所求牌与原因', () => {
    const ask: AskRequest = { kind: 'response', playerId: 'p', wants: 'shan', reason: 'sha' };
    expect(askPrompt(ask)).toContain('【闪】');
    expect(askPrompt(ask)).toContain('【杀】');
  });
  it('confirm 提示技能名', () => {
    const ask: AskRequest = { kind: 'confirm', playerId: 'p', skillId: 'jianxiong' };
    expect(askPrompt(ask)).toBe('是否发动【奸雄】？');
  });
  it('choose-target 提示数量范围', () => {
    const ask: AskRequest = { kind: 'choose-target', playerId: 'p', targetIds: ['a', 'b'], min: 1, max: 2, skillId: 'tuxi' };
    expect(askPrompt(ask)).toContain('1~2');
    expect(askPrompt(ask)).toContain('突袭');
  });
  it('choose-option / give-card 提示技能名', () => {
    const opt: AskRequest = {
      kind: 'choose-option', playerId: 'p', skillId: 'ganglie',
      options: [{ id: 'discard', label: '弃置两张手牌' }, { id: 'damage', label: '受到 1 点伤害' }],
    };
    expect(askPrompt(opt)).toContain('刚烈');
    const give: AskRequest = {
      kind: 'give-card', playerId: 'p', card: makeCard('sha'), targetIds: ['p', 'q'], skillId: 'yiji',
    };
    expect(askPrompt(give)).toContain('遗计');
    expect(askPrompt(give)).toContain('【杀】');
  });
});

describe('responseOptions', () => {
  const hand = [
    makeCard('shan', { id: 'c1' }),
    makeCard('sha', { id: 'c2', suit: 'heart', rank: 5 }),
    makeCard('tao', { id: 'c3' }),
  ];
  it('直出牌 + 转化技候选', () => {
    const ask: AskRequest = {
      kind: 'response', playerId: 'p', wants: 'shan', reason: 'sha',
      converts: [{ skillId: 'longdan-shan', name: '龙胆', as: 'shan', cardIds: ['c2'] }],
    };
    const opts = responseOptions(ask, hand);
    expect(opts.direct.map((c) => c.id)).toEqual(['c1']);
    expect(opts.converts).toHaveLength(1);
    expect(opts.converts[0].cards.map((c) => c.id)).toEqual(['c2']);
  });
  it('非 response 询问返回空', () => {
    const ask: AskRequest = { kind: 'play', playerId: 'p' };
    expect(responseOptions(ask, hand).direct).toEqual([]);
  });
});

describe('playSkillOptions', () => {
  it('转化技按 match 过滤候选手牌；无匹配则不可用', () => {
    const ask: AskRequest = { kind: 'play', playerId: 'p', availableSkills: ['wusheng', 'kurou'] };
    const redCard = makeCard('tao', { id: 'r', suit: 'heart', rank: 3 });
    const blackCard = makeCard('sha', { id: 'b', suit: 'spade', rank: 8 });
    const opts = playSkillOptions(ask, [redCard, blackCard]);
    const wusheng = opts.find((o) => o.meta.id === 'wusheng')!;
    expect(wusheng.cards.map((c) => c.id)).toEqual(['r']);
    expect(wusheng.usable).toBe(true);
    const kurou = opts.find((o) => o.meta.id === 'kurou')!;
    expect(kurou.usable).toBe(true); // 无需选牌
    // 手里没红牌时武圣不可用
    const opts2 = playSkillOptions(ask, [blackCard]);
    expect(opts2.find((o) => o.meta.id === 'wusheng')!.usable).toBe(false);
  });

  it('定数牌主动技（结姻）手牌不足时不可用；多选牌（制衡）一张即可', () => {
    const ask: AskRequest = { kind: 'play', playerId: 'p', availableSkills: ['jieyin', 'zhiheng'] };
    const one = [makeCard('sha', { id: 'a1' })];
    const opts = playSkillOptions(ask, one);
    expect(opts.find((o) => o.meta.id === 'jieyin')!.usable).toBe(false); // 需恰好两张手牌
    expect(opts.find((o) => o.meta.id === 'zhiheng')!.usable).toBe(true); // 至少一张
  });
});

describe('buildResponse', () => {
  const sha = makeCard('sha', { id: 's1' });
  const redTao = makeCard('tao', { id: 't1', suit: 'diamond', rank: 2 });
  const hand = [sha, redTao];

  it('play：杀需要目标', () => {
    const ask: AskRequest = { kind: 'play', playerId: 'p' };
    expect(buildResponse(ask, { cardId: 's1' }, hand)).toBeNull();
    expect(buildResponse(ask, { cardId: 's1', targetId: 'q' }, hand)).toEqual({
      cardId: 's1', targetId: 'q', targetId2: undefined,
    });
  });

  it('play：借刀杀人需要两个目标', () => {
    const jiedao = makeCard('jiedao', { id: 'j1' });
    const ask: AskRequest = { kind: 'play', playerId: 'p' };
    const h = [jiedao];
    expect(buildResponse(ask, { cardId: 'j1', targetId: 'a' }, h)).toBeNull();
    expect(buildResponse(ask, { cardId: 'j1', targetId: 'a', targetId2: 'b' }, h)).toEqual({
      cardId: 'j1', targetId: 'a', targetId2: 'b',
    });
  });

  it('play：武圣转化需红牌 + 杀的目标', () => {
    const ask: AskRequest = { kind: 'play', playerId: 'p', availableSkills: ['wusheng'] };
    // 未在 availableSkills 里的技能不放行
    expect(buildResponse(ask, { skillId: 'qixi', cardId: 't1', targetId: 'q' }, hand)).toBeNull();
    // 黑牌不能用于武圣
    expect(buildResponse(ask, { skillId: 'wusheng', cardId: 's1', targetId: 'q' }, [makeCard('sha', { id: 's1', suit: 'spade', rank: 1 })])).toBeNull();
    expect(buildResponse(ask, { skillId: 'wusheng', cardId: 't1' }, hand)).toBeNull(); // 缺目标
    expect(buildResponse(ask, { skillId: 'wusheng', cardId: 't1', targetId: 'q' }, hand)).toEqual({
      useSkill: 'wusheng', cardId: 't1', targetId: 'q',
    });
  });

  it('play：苦肉无需选牌直接发动', () => {
    const ask: AskRequest = { kind: 'play', playerId: 'p', availableSkills: ['kurou'] };
    expect(buildResponse(ask, { skillId: 'kurou' }, hand)).toEqual({ useSkill: 'kurou' });
  });

  it('response：直出或转化', () => {
    const ask: AskRequest = {
      kind: 'response', playerId: 'p', wants: 'sha', reason: 'nanman',
      converts: [{ skillId: 'wusheng', name: '武圣', as: 'sha', cardIds: ['t1'] }],
    };
    expect(buildResponse(ask, { cardId: 's1' }, hand)).toEqual({ cardId: 's1' });
    expect(buildResponse(ask, { skillId: 'wusheng', cardId: 't1' }, hand)).toEqual({
      useSkill: 'wusheng', cardId: 't1',
    });
    // 牌名不符 / 不在转化候选里都不行
    expect(buildResponse(ask, { cardId: 't1' }, hand)).toBeNull();
    expect(buildResponse(ask, { skillId: 'wusheng', cardId: 's1' }, hand)).toBeNull();
  });

  it('choose-target：数量与候选校验', () => {
    const ask: AskRequest = { kind: 'choose-target', playerId: 'p', targetIds: ['a', 'b', 'c'], min: 1, max: 2 };
    expect(buildResponse(ask, {}, [])).toBeNull();
    expect(buildResponse(ask, { targetIds: ['a', 'b', 'c'] }, [])).toBeNull();
    expect(buildResponse(ask, { targetIds: ['a', 'x'] }, [])).toBeNull();
    expect(buildResponse(ask, { targetIds: ['a', 'a'] }, [])).toBeNull();
    expect(buildResponse(ask, { targetIds: ['a', 'b'] }, [])).toEqual({ targetIds: ['a', 'b'] });
  });

  it('choose-card：必须选亮出的牌之一', () => {
    const c1 = makeCard('sha', { id: 'w1' });
    const c2 = makeCard('tao', { id: 'w2' });
    const ask: AskRequest = { kind: 'choose-card', playerId: 'p', cards: [c1, c2], reason: 'wugu' };
    expect(buildResponse(ask, {}, [])).toBeNull();
    expect(buildResponse(ask, { cardId: 'nope' }, [])).toBeNull();
    expect(buildResponse(ask, { cardId: 'w2' }, [])).toEqual({ cardId: 'w2' });
  });

  it('choose-option：由按钮直接应答，不走 buildResponse', () => {
    const ask: AskRequest = {
      kind: 'choose-option', playerId: 'p', skillId: 'ganglie',
      options: [{ id: 'discard', label: '弃置两张手牌' }, { id: 'damage', label: '受到 1 点伤害' }],
    };
    expect(buildResponse(ask, {}, hand)).toBeNull();
  });

  it('give-card：目标必须在候选中', () => {
    const card = makeCard('sha', { id: 'g1' });
    const ask: AskRequest = { kind: 'give-card', playerId: 'p', card, targetIds: ['p', 'q'], skillId: 'yiji' };
    expect(buildResponse(ask, {}, hand)).toBeNull();
    expect(buildResponse(ask, { targetId: 'x' }, hand)).toBeNull();
    expect(buildResponse(ask, { targetId: 'q' }, hand)).toEqual({ targetId: 'q' });
  });

  it('play：青囊需选一张手牌 + 一名目标；反间只需目标', () => {
    const ask: AskRequest = { kind: 'play', playerId: 'p', availableSkills: ['qingnang', 'fanjian'] };
    // 青囊：缺牌/缺目标都不行
    expect(buildResponse(ask, { skillId: 'qingnang', targetId: 'q' }, hand)).toBeNull();
    expect(buildResponse(ask, { skillId: 'qingnang', cardId: 's1' }, hand)).toBeNull();
    expect(buildResponse(ask, { skillId: 'qingnang', cardId: 's1', targetId: 'q' }, hand)).toEqual({
      useSkill: 'qingnang', cardId: 's1', targetId: 'q',
    });
    // 反间：只需目标
    expect(buildResponse(ask, { skillId: 'fanjian' }, hand)).toBeNull();
    expect(buildResponse(ask, { skillId: 'fanjian', targetId: 'q' }, hand)).toEqual({
      useSkill: 'fanjian', targetId: 'q',
    });
  });

  it('discard：必须恰好选 count 张手牌', () => {
    const ask: AskRequest = { kind: 'discard', playerId: 'p', count: 2 };
    expect(buildResponse(ask, {}, hand)).toBeNull(); // 没选
    expect(buildResponse(ask, { cardIds: ['s1'] }, hand)).toBeNull(); // 少选
    expect(buildResponse(ask, { cardIds: ['s1', 't1', 's2'] }, hand)).toBeNull(); // 多选
    expect(buildResponse(ask, { cardIds: ['s1', 's1'] }, hand)).toBeNull(); // 重复
    expect(buildResponse(ask, { cardIds: ['s1', 'nope'] }, hand)).toBeNull(); // 不在手牌
    expect(buildResponse(ask, { cardIds: ['s1', 't1'] }, hand)).toEqual({ cardIds: ['s1', 't1'] });
  });

  it('play：仁德需多选手牌 + 目标；制衡只需多选手牌', () => {
    const ask: AskRequest = { kind: 'play', playerId: 'p', availableSkills: ['rende', 'zhiheng'] };
    // 仁德：缺牌/缺目标/重复牌都不行
    expect(buildResponse(ask, { skillId: 'rende', targetId: 'q' }, hand)).toBeNull();
    expect(buildResponse(ask, { skillId: 'rende', cardIds: ['s1'] }, hand)).toBeNull();
    expect(buildResponse(ask, { skillId: 'rende', cardIds: ['s1', 's1'], targetId: 'q' }, hand)).toBeNull();
    expect(buildResponse(ask, { skillId: 'rende', cardIds: ['s1', 't1'], targetId: 'q' }, hand)).toEqual({
      useSkill: 'rende', cardIds: ['s1', 't1'], targetId: 'q',
    });
    // 制衡：多选即可，无需目标
    expect(buildResponse(ask, { skillId: 'zhiheng' }, hand)).toBeNull();
    expect(buildResponse(ask, { skillId: 'zhiheng', cardIds: ['s1'] }, hand)).toEqual({
      useSkill: 'zhiheng', cardIds: ['s1'], targetId: undefined,
    });
  });

  it('play：结姻需恰好两张手牌 + 目标；离间需一张牌 + 两个不同目标', () => {
    const ask: AskRequest = { kind: 'play', playerId: 'p', availableSkills: ['jieyin', 'lijian'] };
    // 结姻：牌数不对/缺目标都不行
    expect(buildResponse(ask, { skillId: 'jieyin', cardIds: ['s1'], targetId: 'q' }, hand)).toBeNull();
    expect(buildResponse(ask, { skillId: 'jieyin', cardIds: ['s1', 't1'] }, hand)).toBeNull();
    expect(buildResponse(ask, { skillId: 'jieyin', cardIds: ['s1', 't1'], targetId: 'q' }, hand)).toEqual({
      useSkill: 'jieyin', cardIds: ['s1', 't1'], targetId: 'q',
    });
    // 离间：缺第二目标/两目标相同都不行
    expect(buildResponse(ask, { skillId: 'lijian', cardIds: ['s1'], targetId: 'a' }, hand)).toBeNull();
    expect(buildResponse(ask, { skillId: 'lijian', cardIds: ['s1'], targetId: 'a', targetId2: 'a' }, hand)).toBeNull();
    expect(buildResponse(ask, { skillId: 'lijian', cardIds: ['s1'], targetId: 'a', targetId2: 'b' }, hand)).toEqual({
      useSkill: 'lijian', cardIds: ['s1'], targetId: 'a', targetId2: 'b',
    });
  });
});

describe('skillMeta', () => {
  it('已实现的技能都有元数据', () => {
    for (const id of [
      'wusheng', 'longdan-sha', 'longdan-shan', 'qixi', 'kurou', 'jianxiong', 'tuxi', 'tieji',
      // 第二批
      'paoxiao', 'luoyi', 'ganglie', 'tiandu', 'yiji', 'luoshen', 'qingguo',
      'jijiu', 'qingnang', 'keji', 'yingzi', 'fanjian',
      // 第三批
      'rende', 'zhiheng', 'lijian', 'biyue', 'jieyin', 'xiaoji', 'jizhi', 'qicai',
      // 第四批
      'fankui', 'guicai', 'wushuang', 'guanxing', 'kongcheng', 'guose', 'liuli', 'qianxun', 'lianying',
    ]) {
      expect(skillMeta(id)?.name).toBeTruthy();
    }
  });
});

describe('第四批新交互', () => {
  it('judge-retrial：提示判定牌与技能；从手牌选一张改判', () => {
    const judge = makeCard('sha', { id: 'j1', suit: 'spade', rank: 5 });
    const ask: AskRequest = { kind: 'judge-retrial', playerId: 'p', card: judge, reason: 'lebu', skillId: 'guicai' };
    const prompt = askPrompt(ask);
    expect(prompt).toContain('鬼才');
    expect(prompt).toContain('黑桃5');
    expect(prompt).toContain('乐不思蜀');

    const hand = [makeCard('tao', { id: 't1' })];
    expect(buildResponse(ask, {}, hand)).toBeNull(); // 没选牌
    expect(buildResponse(ask, { cardId: 'nope' }, hand)).toBeNull(); // 不在手牌
    expect(buildResponse(ask, { cardId: 't1' }, hand)).toEqual({ cardId: 't1' });
  });

  it('guanxing：提示观星张数；放底选择必须来自展示牌（可空）', () => {
    const cards = [makeCard('sha', { id: 'g1' }), makeCard('shan', { id: 'g2' })];
    const ask: AskRequest = { kind: 'guanxing', playerId: 'p', cards, skillId: 'guanxing' };
    expect(askPrompt(ask)).toContain('观星');
    expect(askPrompt(ask)).toContain('2');

    expect(buildResponse(ask, {}, [])).toEqual({ cardIds: [] }); // 空选 = 全部回顶
    expect(buildResponse(ask, { cardIds: ['g1', 'g1'] }, [])).toBeNull(); // 重复
    expect(buildResponse(ask, { cardIds: ['nope'] }, [])).toBeNull(); // 不在展示牌中
    expect(buildResponse(ask, { cardIds: ['g2'] }, [])).toEqual({ cardIds: ['g2'] });
  });

  it('response：无双的需求张数写进提示（还需 N 张）', () => {
    const ask: AskRequest = { kind: 'response', playerId: 'p', wants: 'shan', reason: 'sha', need: 2 };
    expect(askPrompt(ask)).toContain('【闪】');
    expect(askPrompt(ask)).toContain('还需 2 张');
  });

  it('discard 带 skillId（流离代价）时提示技能名', () => {
    const ask: AskRequest = { kind: 'discard', playerId: 'p', count: 1, skillId: 'liuli' };
    expect(askPrompt(ask)).toContain('流离');
    expect(askPrompt(ask)).toContain('1');
  });

  it('国色是方块牌当乐不思蜀的转化技元数据', () => {
    const meta = skillMeta('guose')!;
    expect(meta.kind).toBe('convert');
    expect(meta.as).toBe('lebu');
    expect(meta.match!(makeCard('sha', { suit: 'diamond', rank: 4 }))).toBe(true);
    expect(meta.match!(makeCard('sha', { suit: 'spade', rank: 4 }))).toBe(false);
  });
});

describe('身份展示', () => {
  it('roleBadge：有身份出标签，null（不可见/1v1）不出', () => {
    expect(roleBadge(pub(0, 'p0', 'lord'))).toBe('主公');
    expect(roleBadge(pub(1, 'p1', 'rebel'))).toBe('反贼');
    expect(roleBadge(pub(2, 'p2'))).toBeNull();
  });

  it('四种身份都有标签与获胜条件一句话', () => {
    for (const role of ['lord', 'loyalist', 'rebel', 'renegade'] as const) {
      expect(ROLE_LABEL[role]).toBeTruthy();
      expect(ROLE_OBJECTIVE[role]).toContain('获胜条件');
    }
    expect(ROLE_LABEL.lord).toBe('主公');
    expect(ROLE_LABEL.renegade).toBe('内奸');
  });

  it('势力标签覆盖四势力', () => {
    expect(KINGDOM_LABEL).toMatchObject({ wei: '魏', shu: '蜀', wu: '吴', qun: '群' });
  });
});

describe('战绩展示', () => {
  it('matchModeLabel：1v1 与身份局人数', async () => {
    const { matchModeLabel } = await import('../src/core/vm.js');
    expect(matchModeLabel({ mode: '1v1', playerCount: 2 })).toBe('1v1 对决');
    expect(matchModeLabel({ mode: 'identity', playerCount: 5 })).toBe('5 人身份局');
  });

  it('winRateText：无场次显示 —，否则百分比取整', async () => {
    const { winRateText } = await import('../src/core/vm.js');
    expect(winRateText({ total: 0, winRate: 0 })).toBe('—');
    expect(winRateText({ total: 3, winRate: 2 / 3 })).toBe('67%');
    expect(winRateText({ total: 1, winRate: 1 })).toBe('100%');
  });

  it('matchRoleLabel：身份中文名，1v1 为 —', async () => {
    const { matchRoleLabel } = await import('../src/core/vm.js');
    expect(matchRoleLabel({ role: 'lord' })).toBe('主公');
    expect(matchRoleLabel({ role: 'renegade' })).toBe('内奸');
    expect(matchRoleLabel({ role: null })).toBe('—');
  });
});
