import { defineConfig } from 'vite';

// 开发服务器：/socket.io 代理到本机 :3000 的游戏服务器（可用 VITE_SERVER_URL 直连远端代替）。
export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      '/socket.io': {
        target: process.env.VITE_PROXY_TARGET ?? 'http://localhost:3000',
        ws: true,
      },
    },
  },
  optimizeDeps: {
    // workspace 链接的 TS 源码包，交给 Vite 直接编译，不做预打包。
    exclude: ['@sanguosha/engine'],
  },
});
