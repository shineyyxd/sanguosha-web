/**
 * e2e：手机视口用例（iPhone 13 device descriptor）。
 *
 * - 竖屏（390x844）：大厅 DOM 覆盖层可用（真实填表建房）；进入牌桌后出现「请横屏游玩」
 *   提示遮罩（不强制旋转）。
 * - 横屏（844x390）：牌桌自适应渲染、旋转提示不出现；用触屏 tap 完成
 *   选手牌【杀】→ 选对手 → 点「确定」链路，对手（桌面端）收到求闪。
 *
 * 点击坐标读 window.__sgsTable（TableScene 发布的实际可点元素坐标），不硬编码布局。
 */

import { devices, expect, test, type Page } from '@playwright/test';

interface TableProbe {
  gameW: number;
  gameH: number;
  hand: { id: string; name: string; x: number; y: number }[];
  buttons: { label: string; x: number; y: number }[];
  opponents: { id: string; x: number; y: number; w: number; h: number }[];
}

const readProbe = (page: Page): Promise<TableProbe> =>
  page.evaluate(() => (window as unknown as { __sgsTable: TableProbe }).__sgsTable);

/** 触屏 tap：游戏坐标 → 页面 CSS 像素。 */
async function tapGame(page: Page, gx: number, gy: number): Promise<void> {
  const probe = await readProbe(page);
  const box = (await page.locator('#app canvas').boundingBox())!;
  await page.touchscreen.tap(
    box.x + (gx / probe.gameW) * box.width,
    box.y + (gy / probe.gameH) * box.height,
  );
}

/** 手机端建房（大厅 UI），返回房间码。 */
async function createRoomOnPhone(page: Page): Promise<string> {
  await page.goto('/');
  await page.fill('#sgs-name', '手机甲');
  await page.tap('#sgs-create');
  await page.waitForSelector('#sgs-room-code');
  return (await page.textContent('#sgs-room-code'))!.replace('房间码：', '').trim();
}

/** 桌面端加入并准备。 */
async function joinOnDesktop(page: Page, code: string): Promise<void> {
  await page.goto('/');
  await page.fill('#sgs-name', '乙');
  await page.fill('#sgs-code', code);
  await page.click('#sgs-join');
  await page.click('#sgs-ready');
}

const startFixedGame = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { __sgs: { startGame(p: object): Promise<{ ok: boolean }> } }).__sgs.startGame({
      seed: 1,
      generals: ['blank', 'blank'],
    }),
  );

test('竖屏：大厅可用，进入牌桌显示「请横屏游玩」提示', async ({ browser }) => {
  const phone = await browser.newContext({ ...devices['iPhone 13'] }); // 竖屏 390x844 + touch
  const desktop = await browser.newContext();
  const pageA = await phone.newPage();
  const pageB = await desktop.newPage();

  // 竖屏大厅：填表建房可用
  const code = await createRoomOnPhone(pageA);
  await joinOnDesktop(pageB, code);

  await pageA.waitForFunction(() => Boolean((window as unknown as { __sgs?: unknown }).__sgs));
  expect(await startFixedGame(pageA)).toEqual({ ok: true });

  // 进入牌桌：竖屏出现旋转提示遮罩
  await pageA.waitForFunction(
    () => Boolean((window as unknown as { __sgsTable?: TableProbe }).__sgsTable?.hand.length),
  );
  await expect(pageA.locator('#sgs-rotate-hint')).toBeVisible();
  await expect(pageA.locator('#sgs-rotate-hint')).toContainText('请横屏游玩');

  await phone.close();
  await desktop.close();
});

test('横屏：触屏完成出杀链路，无旋转提示', async ({ browser }) => {
  const phone = await browser.newContext({
    ...devices['iPhone 13'],
    viewport: { width: 844, height: 390 }, // 横屏
  });
  const desktop = await browser.newContext();
  const pageA = await phone.newPage();
  const pageB = await desktop.newPage();

  const code = await createRoomOnPhone(pageA);
  await joinOnDesktop(pageB, code);

  await pageA.waitForFunction(() => Boolean((window as unknown as { __sgs?: unknown }).__sgs));
  expect(await startFixedGame(pageA)).toEqual({ ok: true });

  // 甲的出牌询问到达，且牌桌场景已完成首帧渲染（__sgsTable 就绪）
  await pageA.waitForFunction(() => {
    const w = window as unknown as {
      __sgs: { currentAsk?: { ask: { kind: string } } | null };
      __sgsTable?: { hand: unknown[] };
    };
    return w.__sgs.currentAsk?.ask.kind === 'play' && (w.__sgsTable?.hand.length ?? 0) > 0;
  });
  await expect(pageA.locator('#sgs-rotate-hint')).toBeHidden();

  // 触屏点【杀】→ 点对手面板 → 点「确定」
  let probe = await readProbe(pageA);
  const sha = probe.hand.find((c) => c.name === 'sha');
  expect(sha).toBeTruthy();
  await tapGame(pageA, sha!.x, sha!.y);

  probe = await readProbe(pageA);
  await tapGame(pageA, probe.opponents[0].x, probe.opponents[0].y);

  probe = await readProbe(pageA);
  const okBtn = probe.buttons.find((b) => b.label.startsWith('确定'));
  expect(okBtn).toBeTruthy();
  await tapGame(pageA, okBtn!.x, okBtn!.y);

  // 乙（桌面端）收到求闪询问——证明手机触屏链路完整走通协议
  await pageB.waitForFunction(
    () => (window as unknown as { __sgs: { currentAsk?: { ask: { kind: string } } | null } }).__sgs.currentAsk?.ask.kind === 'response',
  );

  await phone.close();
  await desktop.close();
});
