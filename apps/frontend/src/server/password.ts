import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);

// Must match the on-chain `SALT_BYTES` / `PASSWORD_HASH_BYTES` constants in
// apps/on-chain-program/programs/game_token_wallet/src/state/user.rs.
const SALT_BYTES = 16;
const PASSWORD_HASH_BYTES = 64;

// Fixed, non-secret salt used only to burn equivalent scrypt time when no
// real account exists — see runDummyHash.
const DUMMY_SALT = new Uint8Array(SALT_BYTES);

export async function hashPassword(
  password: string,
): Promise<{ salt: Uint8Array; hash: Uint8Array }> {
  const salt = randomBytes(SALT_BYTES);
  const hash = (await scryptAsync(password, salt, PASSWORD_HASH_BYTES)) as Buffer;
  return { salt: new Uint8Array(salt), hash: new Uint8Array(hash) };
}

export async function verifyPassword(
  password: string,
  salt: Uint8Array,
  expectedHash: Uint8Array,
): Promise<boolean> {
  const computed = (await scryptAsync(password, Buffer.from(salt), PASSWORD_HASH_BYTES)) as Buffer;
  const expected = Buffer.from(expectedHash);
  if (computed.length !== expected.length) return false;
  return timingSafeEqual(computed, expected);
}

// Runs the same-cost scrypt computation as a real login when no account was
// found, so response timing doesn't reveal whether a username exists.
export async function runDummyHash(password: string): Promise<void> {
  await scryptAsync(password, Buffer.from(DUMMY_SALT), PASSWORD_HASH_BYTES);
}
