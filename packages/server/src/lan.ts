/**
 * 局域网辅助：枚举本机局域网 IPv4 地址（192.168.x / 10.x / 172.16~31.x），
 * 用于启动时打印手机可访问的入局地址。
 */

import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os';

/** 本机所有局域网 IPv4 地址，按常见程度排序（192.168 优先）。 */
export function lanAddresses(): string[] {
  const addrs: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const nic of (list ?? []) as NetworkInterfaceInfo[]) {
      if (nic.internal) continue;
      const family: string = String(nic.family);
      if (family !== 'IPv4' && family !== '4') continue;
      const ip = nic.address;
      if (
        ip.startsWith('192.168.') ||
        ip.startsWith('10.') ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(ip)
      ) {
        addrs.push(ip);
      }
    }
  }
  return addrs.sort((a, b) => Number(!a.startsWith('192.168.')) - Number(!b.startsWith('192.168.')));
}
