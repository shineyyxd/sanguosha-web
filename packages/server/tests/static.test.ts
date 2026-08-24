/**
 * 静态托管 + 局域网绑定测试：生产模式下 http://IP:端口 直接返回游戏页面，
 * 与 Socket.IO 共用同一端口。
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGameServer, type GameServer } from '../src/index.js';

let dir: string;
let server: GameServer;
let base: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'sgs-static-'));
  mkdirSync(join(dir, 'assets'), { recursive: true });
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>三国杀</title>');
  writeFileSync(join(dir, 'assets', 'app-abc123.js'), 'console.log(1)');
  server = createGameServer({ staticDir: dir });
  await server.listen(0);
  base = `http://127.0.0.1:${server.port()}`;
});

afterAll(async () => {
  await server.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('静态托管（staticDir）', () => {
  it('GET / 返回 index.html', async () => {
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toContain('三国杀');
  });

  it('GET /assets/* 返回构建产物且带长缓存', async () => {
    const res = await fetch(`${base}/assets/app-abc123.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('javascript');
    expect(res.headers.get('cache-control')).toContain('immutable');
  });

  it('无扩展名路径回退 index.html；带扩展名的缺失文件 404', async () => {
    expect((await fetch(`${base}/some/route`)).status).toBe(200);
    expect((await fetch(`${base}/missing.js`)).status).toBe(404);
  });

  it('路径穿越被拒绝', async () => {
    const res = await fetch(`${base}/${encodeURIComponent('..')}/${encodeURIComponent('..')}/package.json`);
    expect([400, 403, 404]).toContain(res.status);
  });

  it('root 带结尾斜杠（fileURLToPath 产物）也能正常伺服', async () => {
    const s2 = createGameServer({ staticDir: `${dir}/` });
    await s2.listen(0);
    const res = await fetch(`http://127.0.0.1:${s2.port()}/assets/app-abc123.js`);
    expect(res.status).toBe(200);
    await s2.close();
  });

  it('Socket.IO 握手与静态托管同端口共存', async () => {
    const res = await fetch(`${base}/socket.io/?EIO=4&transport=polling`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('"sid"');
  });
});
