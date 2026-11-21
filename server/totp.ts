import crypto from "node:crypto";

/** Time-based one-time passwords (RFC 6238) compatible with Google Authenticator, Authy, 1Password, etc. */

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function generateSecret(): string {
  return base32Encode(crypto.randomBytes(20));
}

function hotp(secret: Buffer, counter: number): string {
  const msg = Buffer.alloc(8);
  msg.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  msg.writeUInt32BE(counter >>> 0, 4);
  const h = crypto.createHmac("sha1", secret).update(msg).digest();
  const off = h[h.length - 1] & 0xf;
  const code = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(code % 1_000_000).padStart(6, "0");
}

export function totpCode(secretB32: string, at = Date.now()): string {
  return hotp(base32Decode(secretB32), Math.floor(at / 30_000));
}

/** Accept the current code and one step either side (clock drift). */
export function verifyTotp(secretB32: string, code: string, at = Date.now()): boolean {
  const c = String(code).replace(/\s+/g, "");
  if (!/^\d{6}$/.test(c)) return false;
  const secret = base32Decode(secretB32);
  const step = Math.floor(at / 30_000);
  for (const d of [0, -1, 1]) {
    const expected = hotp(secret, step + d);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(c))) return true;
  }
  return false;
}

export function otpauthUrl(secretB32: string, account: string, issuer = "My money"): string {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}
