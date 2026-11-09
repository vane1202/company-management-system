import { isIP } from "node:net";
import type { Request, Response, NextFunction } from "express";

function ipv4(value: string): number {
  if (isIP(value) !== 4) throw new Error("LAN 地址须为 IPv4");
  return value.split(".").reduce((total, part) => total * 256 + Number(part), 0) >>> 0;
}

function subnet(cidr: string) {
  const parts = cidr.split("/");
  const prefix = Number(parts[1]);
  if (parts.length !== 2 || !/^\d{1,2}$/.test(parts[1]) || prefix < 1 || prefix > 32) throw new Error("LAN_ALLOWED_CIDR 须为明确的 IPv4 网段");
  const network = ipv4(parts[0]);
  const mask = (0xffffffff << (32 - prefix)) >>> 0;
  if (((network & mask) >>> 0) !== network) throw new Error("LAN_ALLOWED_CIDR 须填写网段地址");
  return { network, mask, last: (network | ~mask) >>> 0 };
}

function privateBlock(address: number): string | undefined {
  if (address >= ipv4("10.0.0.0") && address <= ipv4("10.255.255.255")) return "10";
  if (address >= ipv4("172.16.0.0") && address <= ipv4("172.31.255.255")) return "172";
  if (address >= ipv4("192.168.0.0") && address <= ipv4("192.168.255.255")) return "192";
  return undefined;
}

export function isInLan(address: string, cidr: string): boolean {
  try {
    const value = ipv4(address.replace(/^::ffff:/, ""));
    const range = subnet(cidr);
    return ((value & range.mask) >>> 0) === range.network;
  } catch { return false; }
}

export function parseLanConfig(host?: string, cidr?: string): { lanHost?: string; lanAllowedCidr?: string } {
  const lanHost = host?.trim();
  const lanAllowedCidr = cidr?.trim();
  if (!lanHost && !lanAllowedCidr) return {};
  if (!lanHost || !lanAllowedCidr) throw new Error("LAN_HOST 和 LAN_ALLOWED_CIDR 必须同时配置");
  const address = ipv4(lanHost);
  const range = subnet(lanAllowedCidr);
  const block = privateBlock(range.network);
  if (!block || privateBlock(range.last) !== block || !isInLan(lanHost, lanAllowedCidr) || !privateBlock(address)) throw new Error("LAN 配置须限制在同一个私有 IPv4 网段内");
  return { lanHost, lanAllowedCidr };
}

// Check socket addresses, never X-Forwarded-For. Only the extra LAN listener is restricted.
export function restrictLanClients(config: { lanHost?: string; lanAllowedCidr?: string }) {
  return (req: Request, res: Response, next: NextFunction) => {
    const localAddress = req.socket.localAddress?.replace(/^::ffff:/, "");
    if (config.lanHost && localAddress === config.lanHost && (!config.lanAllowedCidr || !isInLan(req.socket.remoteAddress ?? "", config.lanAllowedCidr))) {
      res.status(403).json({ error: "此入口仅允许配置的局域网访问" });
      return;
    }
    next();
  };
}
