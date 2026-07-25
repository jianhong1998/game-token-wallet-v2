import { loadSessionEnv } from "./env";

const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const SESSION_COOKIE_NAME = "session";
export const SESSION_COOKIE_MAX_AGE_SECONDS = SESSION_TTL_MS / 1000;

interface SessionPayload {
  username: string;
  exp: number;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padLength = (4 - (normalized.length % 4)) % 4;
  const padded = normalized.padEnd(normalized.length + padLength, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// Uses Web Crypto (crypto.subtle), not node:crypto, so this module works
// identically whether middleware.ts runs on the Edge or Node.js runtime.
async function getHmacKey(secret: string): Promise<CryptoKey> {
  return globalThis.crypto.subtle.importKey(
    "raw",
    ENCODER.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function createSessionCookie(username: string): Promise<string> {
  const { sessionSecret } = loadSessionEnv();
  const payload: SessionPayload = { username, exp: Date.now() + SESSION_TTL_MS };
  const payloadB64 = base64UrlEncode(ENCODER.encode(JSON.stringify(payload)));
  const key = await getHmacKey(sessionSecret);
  const signature = await globalThis.crypto.subtle.sign("HMAC", key, ENCODER.encode(payloadB64));
  const signatureB64 = base64UrlEncode(new Uint8Array(signature));
  return `${payloadB64}.${signatureB64}`;
}

export async function verifySessionCookie(cookie: string): Promise<{ username: string } | null> {
  const parts = cookie.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, signatureB64] = parts;

  try {
    const { sessionSecret } = loadSessionEnv();
    const key = await getHmacKey(sessionSecret);
    const isValid = await globalThis.crypto.subtle.verify(
      "HMAC",
      key,
      base64UrlDecode(signatureB64),
      ENCODER.encode(payloadB64),
    );
    if (!isValid) return null;

    const payload = JSON.parse(DECODER.decode(base64UrlDecode(payloadB64))) as SessionPayload;
    if (typeof payload.username !== "string" || typeof payload.exp !== "number") return null;
    if (Date.now() > payload.exp) return null;

    return { username: payload.username };
  } catch {
    return null;
  }
}
