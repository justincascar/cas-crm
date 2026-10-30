import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Authenticator-app codes (RFC 6238): six digits, a new one every 30 seconds, from a shared secret. Works with
 * Microsoft Authenticator, Google Authenticator and similar apps. Built on Node's own crypto; no package needed.
 */

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    value = (value << 5) | ALPHABET.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new random secret, shown once to be typed or scanned into the app. */
export function newTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function totpCode(secret: string, atMs = Date.now()): string {
  const counter = Math.floor(atMs / 1000 / 30);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", base32Decode(secret)).update(message).digest();
  const offset = hmac[hmac.length - 1] & 15;
  const number = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(number).padStart(6, "0");
}

/** Accepts the current code and the one either side, to allow for a phone clock a little out. */
export function verifyTotp(secret: string, code: string, atMs = Date.now()): boolean {
  const typed = String(code || "").replace(/\s+/g, "");
  if (!/^\d{6}$/.test(typed)) return false;
  for (const step of [-1, 0, 1]) {
    const expected = totpCode(secret, atMs + step * 30_000);
    if (timingSafeEqual(Buffer.from(expected), Buffer.from(typed))) return true;
  }
  return false;
}

/** The address an authenticator app reads from a QR code, or that can be opened on the phone. */
export function totpUri(secret: string, account: string): string {
  return `otpauth://totp/${encodeURIComponent(`CAS CRM:${account}`)}?secret=${secret}&issuer=${encodeURIComponent("CAS CRM")}&digits=6&period=30`;
}
