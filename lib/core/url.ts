import { InputError } from './errors';

/**
 * True for a host that points inside the machine or its network (see the ponytail note at `assertPublicHttpUrl`).
 * Takes a URL hostname (IPv6 in brackets is fine); returns a boolean and throws nothing.
 */
export const isPrivateHost = (hostname: string): boolean => {
  const h = hostname
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
    .toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  const v4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(h);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254)
    );
  }
  if (!h.includes(':')) return false;
  if (h === '::' || h === '::1') return true;
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(h); // URL writes ::ffff:127.0.0.1 this way
  if (mapped) {
    const [hi, lo] = [Number.parseInt(mapped[1] ?? '', 16), Number.parseInt(mapped[2] ?? '', 16)];
    return isPrivateHost(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  const first = Number.parseInt(h.split(':')[0] || '0', 16);
  return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80; // fc00::/7, fe80::/10
};

/**
 * True for a link-local host (169.254.0.0/16, fe80::/10), where cloud metadata services live; no setting allows these.
 * Takes a URL hostname (IPv6 in brackets is fine); returns a boolean and throws nothing.
 */
export const isLinkLocalHost = (hostname: string): boolean => {
  const h = hostname
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
    .toLowerCase();
  if (/^169\.254\.\d+\.\d+$/.test(h)) return true;
  if (!h.includes(':')) return false;
  const mapped = /^::ffff:([0-9a-f]{1,4}):[0-9a-f]{1,4}$/.exec(h); // URL writes ::ffff:169.254.1.1 this way
  if (mapped) return Number.parseInt(mapped[1] ?? '', 16) === 0xa9fe;
  return (Number.parseInt(h.split(':')[0] || '0', 16) & 0xffc0) === 0xfe80;
};

/**
 * Parse a URL and refuse what the machine must not visit; `what` ("page capture", "download") opens the message.
 * Returns the parsed URL. Throws InputError for a non-http(s) URL, credentials, or a local, private or link-local host;
 * never echoes a password.
 */
export const assertPublicHttpUrl = (url: string, what: string): URL => {
  if (!URL.canParse(url)) throw new InputError(`${what} needs an http(s) URL: ${url}`);
  const u = new URL(url);
  if (u.username || u.password) throw new InputError(`${what} refuses a URL with a username or password`);
  if (!/^https?:$/.test(u.protocol)) throw new InputError(`${what} needs an http(s) URL, not ${u.protocol}`);
  // ponytail: literal-host check only; a public name resolving to a private IP is not caught (DNS rebinding) — resolve and recheck if this ever runs unattended
  if (isPrivateHost(u.hostname)) throw new InputError(`${what} refuses a local or private address: ${u.host}`);
  return u;
};
