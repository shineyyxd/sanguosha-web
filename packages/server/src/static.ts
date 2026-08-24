/**
 * 生产模式静态托管：用 Node 原生 http 直接伺服 client 构建产物（client/dist），
 * 与 Socket.IO 共用同一个端口——局域网开局时手机只需访问 http://<电脑IP>:3000。
 *
 * 用法：createGameServer({ staticDir })，或 CLI 入口自动探测 dist 位置。
 * 无 staticDir 时所有非 socket.io 请求返回 404（保持开发模式行为）。
 */

import { createReadStream, existsSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.txt': 'text/plain; charset=utf-8',
};

/**
 * 返回一个 http request handler：
 * - GET/HEAD 静态文件；带扩展名但文件不存在 → 404；
 * - 无扩展名的路径回退到 index.html（SPA 兼容，当前无前端路由但留着无害）；
 * - /assets/ 下是 Vite 哈希产物，长缓存；index.html 不缓存。
 */
export function createStaticHandler(root: string): (req: IncomingMessage, res: ServerResponse) => void {
  // 去掉结尾分隔符（normalize 会保留传入路径的结尾 '/'，否则 base+sep 前缀判断失效）
  const base = normalize(root).replace(/[/\\]+$/, '') || sep;
  return (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' }).end('Method Not Allowed');
      return;
    }
    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
    } catch {
      res.writeHead(400).end('Bad Request');
      return;
    }
    let file = normalize(join(base, pathname));
    // 防路径穿越（normalize 后必须仍在 root 内）
    if (file !== base && !file.startsWith(base + sep)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    if (!existsSync(file) || !statSync(file).isFile()) {
      if (extname(pathname)) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not Found');
        return;
      }
      file = join(base, 'index.html');
      if (!existsSync(file)) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not Found');
        return;
      }
    }
    const type = MIME[extname(file).toLowerCase()] ?? 'application/octet-stream';
    const cache = file.includes(`${sep}assets${sep}`)
      ? 'public, max-age=31536000, immutable'
      : 'no-cache';
    res.writeHead(200, {
      'content-type': type,
      'content-length': statSync(file).size,
      'cache-control': cache,
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    createReadStream(file).pipe(res);
  };
}
