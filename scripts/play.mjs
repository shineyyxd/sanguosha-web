#!/usr/bin/env node
/**
 * 局域网面杀一键启动（npm run play）：
 * 1. 枚举本机局域网 IP，打印手机浏览器入局地址；
 * 2. 终端绘制二维码（qrcode-terminal，装不上时自动降级为只打印地址）；
 * 3. 以前台进程方式启动游戏服务器（静态托管 client/dist + Socket.IO 同端口）。
 *
 * 前置：根 package.json 的 play 脚本会先构建 client 和 server，dist 产物已就绪。
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { lanAddresses } from '../packages/server/dist/server/src/lan.js';

const PORT = Number(process.env.PORT ?? 3000);
const root = fileURLToPath(new URL('..', import.meta.url));

const ips = lanAddresses();
const primary = ips[0];

console.log('');
console.log('三国杀 · 局域网面杀');
console.log('====================');
if (primary) {
  console.log(`手机连同一 Wi-Fi，浏览器打开： http://${primary}:${PORT}`);
  for (const ip of ips.slice(1)) {
    console.log(`备用地址：                 http://${ip}:${PORT}`);
  }
} else {
  console.log(`未检测到局域网地址，本机访问： http://localhost:${PORT}`);
}
console.log('（macOS 若弹防火墙提示，请允许 node 接受传入连接）');
console.log('');

if (primary) {
  try {
    const qrcode = await import('qrcode-terminal');
    await new Promise((resolve) =>
      qrcode.default.generate(`http://${primary}:${PORT}`, { small: true }, (qr) => {
        console.log(qr);
        resolve();
      }),
    );
  } catch {
    console.log('（未安装 qrcode-terminal，跳过二维码，手动输入上面的地址即可）');
  }
}

const child = spawn(process.execPath, ['packages/server/dist/server/src/index.js'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, PORT: String(PORT) },
});
child.on('exit', (code) => process.exit(code ?? 0));
process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
