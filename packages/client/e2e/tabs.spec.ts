/**
 * e2e 回归：同一浏览器开两个标签页测试（共享 localStorage）。
 *
 * 历史 bug：第二个标签页打开时，大厅会自动凭共享的 localStorage 会话 rejoin，
 * 服务器静默把座位改绑到新标签页——第一个标签页从此收不到定向下发的
 * state:update / ask（轮到自己时界面上毫无反应，"出不了牌"），其 room:leave
 * 还会把座位误删。修复后：座位在线时 rejoin 被拒，第二个标签页回到大厅，
 * 可正常以另一名玩家加入。
 *
 * 布局参数化后，牌桌点击坐标从 window.__sgsTable（TableScene 发布的可点元素
 * 实际坐标）读取，不再硬编码布局公式。
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

async function clickGame(page: Page, gx: number, gy: number): Promise<void> {
  const probe = await readProbe(page);
  const box = (await page.locator('#app canvas').boundingBox())!;
  await page.mouse.click(
    box.x + (gx / probe.gameW) * box.width,
    box.y + (gy / probe.gameH) * box.height,
  );
}

test('同一浏览器第二个标签页不抢座：可正常双人开局出牌', async ({ browser }) => {
  const ctx = await browser.newContext(); // 单 context：两个标签页共享 localStorage
  const tab1 = await ctx.newPage();
  const tab2 = await ctx.newPage();

  await tab1.goto('/');
  await tab1.fill('#sgs-name', '甲');
  await tab1.click('#sgs-create');
  await tab1.waitForSelector('#sgs-room-code');
  const code = (await tab1.textContent('#sgs-room-code'))!.replace('房间码：', '').trim();

  // 第二个标签页：自动重连被拒（甲仍在线），留在大厅并提示原因
  await tab2.goto('/');
  await expect(tab2.locator('#sgs-error')).toContainText('已在另一个窗口在线');
  await expect(tab2.locator('#sgs-name')).toBeVisible();

  // 第二个标签页以乙加入并准备
  await tab2.fill('#sgs-name', '乙');
  await tab2.fill('#sgs-code', code);
  await tab2.click('#sgs-join');
  await tab2.click('#sgs-ready');

  // 固定 seed + 白板武将开局（seed=1 时甲起手有【杀】）
  await tab1.waitForFunction(() => Boolean((window as unknown as { __sgs?: unknown }).__sgs));
  const ack = await tab1.evaluate(() =>
    (window as unknown as { __sgs: { startGame(p: object): Promise<{ ok: boolean }> } }).__sgs.startGame({
      seed: 1,
      generals: ['blank', 'blank'],
    }),
  );
  expect(ack.ok).toBe(true);

  // 甲收到出牌询问并出杀（点击链路：牌 → 目标 → 确定）
  // 等询问到达且牌桌场景已完成首帧渲染（__sgsTable 就绪）
  await tab1.waitForFunction(() => {
    const w = window as unknown as {
      __sgs: { currentAsk?: { ask: { kind: string } } | null };
      __sgsTable?: { hand: unknown[] };
    };
    return w.__sgs.currentAsk?.ask.kind === 'play' && (w.__sgsTable?.hand.length ?? 0) > 0;
  });
  let probe = await readProbe(tab1);
  const sha = probe.hand.find((c) => c.name === 'sha');
  expect(sha).toBeTruthy();
  await clickGame(tab1, sha!.x, sha!.y);
  probe = await readProbe(tab1);
  await clickGame(tab1, probe.opponents[0].x, probe.opponents[0].y);
  probe = await readProbe(tab1);
  const okBtn = probe.buttons.find((b) => b.label.startsWith('确定'));
  expect(okBtn).toBeTruthy();
  await clickGame(tab1, okBtn!.x, okBtn!.y);

  // 乙在自己的标签页收到求闪询问（证明定向下发到了正确的连接）
  await tab2.waitForFunction(
    () => (window as unknown as { __sgs: { currentAsk?: { ask: { kind: string } } | null } }).__sgs.currentAsk?.ask.kind === 'response',
  );

  await ctx.close();
});
