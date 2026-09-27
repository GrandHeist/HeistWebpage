import { isIP } from 'node:net';

// Expands an IPv6 address to eight 16-bit groups (as numbers). Assumes it already passed net.isIP.
function groups(address) {
  let addr = address.split('%')[0].toLowerCase();
  const v4 = addr.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    const [a, b, c, d] = v4[1].split('.').map(Number);
    addr = addr.slice(0, -v4[1].length) + ((a << 8) | b).toString(16) + ':' + ((c << 8) | d).toString(16);
  }
  const [head, tail] = addr.split('::');
  const h = head ? head.split(':') : [];
  const t = tail === undefined ? [] : tail ? tail.split(':') : [];
  const fill = tail === undefined ? [] : Array(8 - h.length - t.length).fill('0');
  return [...h, ...fill, ...t].map((g) => parseInt(g, 16));
}

// The key used for rate limiting: IPv4 as is, IPv6 reduced to its /64 (one home or device
// gets a whole /64, so per-address limits would be trivial to dodge).
export function rateKey(address) {
  if (typeof address !== 'string' || !isIP(address.split('%')[0])) return 'unknown';
  if (isIP(address) === 4) return address;
  const g = groups(address);
  // ::ffff:a.b.c.d is an IPv4 client seen through a dual-stack socket.
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) {
    return `${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`;
  }
  return g.slice(0, 4).map((x) => x.toString(16)).join(':') + '::/64';
}

// The address of the client. Forwarded headers are only believed when TRUST_PROXY says how many
// proxies of ours are in front (the entry that many hops from the right is the real client).
export function clientAddress(req, trustProxy = 0) {
  const remote = req.socket?.remoteAddress || '';
  if (!trustProxy) return remote;
  const forwarded = [].concat(req.headers['x-forwarded-for'] || [])
    .join(',')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const candidate = forwarded[forwarded.length - trustProxy];
  return candidate && isIP(candidate) ? candidate : remote;
}
