import { isIP } from "node:net";

function normalizedAddress(address: string): string {
  const zoneIndex = address.indexOf("%");
  const withoutZone = zoneIndex >= 0 ? address.slice(0, zoneIndex) : address;
  return withoutZone.toLowerCase().startsWith("::ffff:") ? withoutZone.slice(7) : withoutZone;
}

export function isPrivateOrLoopbackAddress(address: string): boolean {
  const normalized = normalizedAddress(address);
  const kind = isIP(normalized);
  if (kind === 4) {
    const octets = normalized.split(".").map(Number);
    return octets[0] === 127 || octets[0] === 10
      || (octets[0] === 172 && (octets[1] ?? 0) >= 16 && (octets[1] ?? 0) <= 31)
      || (octets[0] === 192 && octets[1] === 168)
      || (octets[0] === 169 && octets[1] === 254);
  }
  if (kind === 6) {
    const lower = normalized.toLowerCase();
    if (lower === "::1") return true;
    const first = Number.parseInt(lower.split(":")[0] || "0", 16);
    return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80;
  }
  return false;
}

export function isAllowedBrowserOrigin(originHeader: string | undefined, hostHeader: string | undefined, production: boolean): boolean {
  if (!originHeader) return true;
  if (!hostHeader) return false;
  try {
    const origin = new URL(originHeader);
    if (production && origin.protocol !== "https:") return false;
    if (!production && origin.protocol !== "https:" && origin.protocol !== "http:") return false;
    return origin.host.toLowerCase() === hostHeader.trim().toLowerCase();
  } catch {
    return false;
  }
}
