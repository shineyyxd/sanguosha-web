/**
 * e2e：浏览器里"出一张杀"的完整点击链路。
 *
 * 路径：大厅建房（UI）→ 加入 + 准备（UI）→ 开局（注入固定 seed/白板武将保证确定性，
 * 走真实 socket 协议）→ 牌桌场景真实鼠标点击：点手牌【杀】→ 点对手面板 → 点「确定」→
 * 对手页点「放弃」（求闪窗口）→ 断言对手体力 -1。
 *
 * 布局参数化后，点击坐标不再硬编码：TableScene 每次重绘把可点元素（手牌/按钮/对手面板）
 * 的实际游戏坐标发布到 window.__sgsTable，测试直接读取并点击元素内部偏左上的位置——
 * 仍然模拟真实用户的偏心落点，抓住"只有右下半个区域可点"这类 hit area 回归。
 */

import { expect, test, type Page } from '@playwright/test';

interface TableProbe {
  gameW: number;
  gameH: number;
  hand: { id: string; name: string; x: number; y: number }[];
  buttons: { label: string; x: number; y: number }[];
  opponents: { id: string; x: number; y: number; w: number; h: number }[];
}

function readProbe(page: Page): Promise<TableProbe> {
  return page.evaluate(() => (window as unknown as { __sgsTable: TableProbe }).__sgsTable);
}

/** 把牌桌游戏坐标换算成页面 CSS 像素后点击（RESIZE 模式下画布铺满视口，仍按比例换算保险）。 */
async function clickGame(page: Page, gx: number, gy: number): Promise<void> {
  const probe = await readProbe(page);
  const box = (await page.locator('#app canvas').boundingBox())!;
  await page.mouse.click(
    box.x + (gx / probe.gameW) * box.width,
    box.y + (gy / probe.gameH) * box.height,
  );
}

/** 点手牌：牌面内部偏左上的位置。 */
async function clickHandCard(page: Page, name: string): Promise<void> {
  const probe = await readProbe(page);
  const card = probe.hand.find((c) => c.name === name);
  expect(card, `手牌里应有【${name}】`).toBeTruthy();
  await clickGame(page, card!.x - 24, card!.y - 20);
}

/** 点按钮（label 前缀匹配，兼容「确定（1/2）」这类计数后缀），取按钮内部偏左上落点。 */
async function clickButton(page: Page, label: string): Promise<void> {
  const probe = await readProbe(page);
  const btn = probe.buttons.find((b) => b.label.startsWith(label));
  expect(btn, `应有按钮「${label}」`).toBeTruthy();
  await clickGame(page, btn!.x - 20, btn!.y - 8);
}

interface CoreState {
  me: { id: string; hand: { id: string; name: string }[] };
  players: { id: string; hp: number; maxHp: number }[];
}

function readState(page: Page): Promise<CoreState> {
  return page.evaluate(() => {
    const core = (window as unknown as { __sgs: { state: CoreState } }).__sgs;
    return JSON.parse(JSON.stringify(core.state)) as CoreState;
  });
}

test('浏览器里完成一次出杀：点手牌 → 点对手 → 点确定，对手掉血', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  // 甲建房
  await pageA.goto('/');
  await pageA.fill('#sgs-name', '甲');
  await pageA.click('#sgs-create');
  await pageA.waitForSelector('#sgs-room-code');
  const code = (await pageA.textContent('#sgs-room-code'))!.replace('房间码：', '').trim();

  // 乙加入并准备
  await pageB.goto('/');
  await pageB.fill('#sgs-name', '乙');
  await pageB.fill('#sgs-code', code);
  await pageB.click('#sgs-join');
  await pageB.click('#sgs-ready');

  // 固定 seed + 白板武将开局（1v1 无选将；seed=1 时甲起手含【杀】，乙无【闪】）
  await pageA.waitForFunction(() => Boolean((window as unknown as { __sgs?: unknown }).__sgs));
  const startAck = await pageA.evaluate(() =>
    (window as unknown as { __sgs: { startGame(p: object): Promise<{ ok: boolean }> } }).__sgs.startGame({
      seed: 1,
      generals: ['blank', 'blank'],
    }),
  );
  expect(startAck.ok).toBe(true);

  // 等到甲的出牌阶段询问到达，且牌桌场景完成首帧渲染（__sgsTable 就绪）
  await pageA.waitForFunction(() => {
    const w = window as unknown as {
      __sgs: { currentAsk?: { ask: { kind: string } } | null };
      __sgsTable?: { hand: unknown[] };
    };
    return w.__sgs.currentAsk?.ask.kind === 'play' && (w.__sgsTable?.hand.length ?? 0) > 0;
  });

  // 点手牌【杀】
  await clickHandCard(pageA, 'sha');

  // 点对手面板（1v1 唯一对手；面板内部偏左上）
  const probeA = await readProbe(pageA);
  expect(probeA.opponents.length).toBe(1);
  const opp = probeA.opponents[0];
  await clickGame(pageA, opp.x - 40, opp.y - 30);

  // 点「确定」
  await clickButton(pageA, '确定');

  // 乙收到求闪窗口，点「放弃」
  await pageB.waitForFunction(
    () => (window as unknown as { __sgs: { currentAsk?: { ask: { kind: string } } | null } }).__sgs.currentAsk?.ask.kind === 'response',
  );
  await clickButton(pageB, '放弃');

  // 断言：乙体力 -1
  await pageA.waitForFunction(() => {
    const s = (window as unknown as { __sgs: { state: CoreState } }).__sgs.state;
    const opp = s.players.find((p) => p.id !== s.me.id)!;
    return opp.hp === opp.maxHp - 1;
  });

  // —— 弃牌阶段：甲出完杀后手牌 5 > 体力 4，结束出牌后须自选 1 张弃置 ——
  await pageA.waitForFunction(
    () => (window as unknown as { __sgs: { currentAsk?: { ask: { kind: string } } | null } }).__sgs.currentAsk?.ask.kind === 'play',
  );
  await clickButton(pageA, '结束出牌');

  await pageA.waitForFunction(
    () => (window as unknown as { __sgs: { currentAsk?: { ask: { kind: string } } | null } }).__sgs.currentAsk?.ask.kind === 'discard',
  );
  const hand5 = await pageA.evaluate(() =>
    (window as unknown as { __sgs: { state: CoreState } }).__sgs.state.me.hand.length,
  );
  expect(hand5).toBe(5);
  // 点第一张手牌（多选 UI），再点弃牌询问的「确定」（唯一按钮，居中）
  const probeDiscard = await readProbe(pageA);
  await clickGame(pageA, probeDiscard.hand[0].x - 24, probeDiscard.hand[0].y - 20);
  await clickButton(pageA, '确定');

  // 断言：甲手牌弃至体力值 4，轮到乙行动
  await pageA.waitForFunction(() => {
    const core = (window as unknown as { __sgs: { state: CoreState; currentAsk: unknown } }).__sgs;
    return core.state.me.hand.length === 4;
  });

  await ctxA.close();
  await ctxB.close();
});
