// Password hashing — node:crypto scrypt (memory-hard, dependency-free; no native build).
// Stored format: scrypt$N$r$p$salt_b64$hash_b64. Verify is constant-time.
import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";

const N = 16384; // CPU/memory cost
const R = 8;
const P = 1;
const KEYLEN = 64;

export function hashPassword(plain: string): string {
  const salt = randomBytes(16);
  const dk = scryptSync(plain, salt, KEYLEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${dk.toString("base64")}`;
}

export function verifyPassword(plain: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const salt = Buffer.from(parts[4]!, "base64");
  const expected = Buffer.from(parts[5]!, "base64");
  const dk = scryptSync(plain, salt, expected.length, { N: n, r, p });
  return dk.length === expected.length && timingSafeEqual(dk, expected);
}
