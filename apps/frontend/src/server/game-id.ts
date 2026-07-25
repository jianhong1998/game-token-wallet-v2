const VERSION_NIBBLE = 0x70; // 0b0111 in the high nibble of byte 6
const VARIANT_BITS = 0x80; // 0b10 in the high 2 bits of byte 8

// Hand-rolled RFC 9562 UUID v7: 48-bit ms timestamp + random bits.
// Node's built-in crypto.randomUUID() only produces v4, so this repo
// hand-rolls v7 rather than adding a new dependency (matches the
// session-cookie HMAC signing precedent in ticket 003).
export function generateGameId(): Uint8Array {
  const bytes = new Uint8Array(16);
  const timestamp = BigInt(Date.now());
  bytes[0] = Number((timestamp >> 40n) & 0xffn);
  bytes[1] = Number((timestamp >> 32n) & 0xffn);
  bytes[2] = Number((timestamp >> 24n) & 0xffn);
  bytes[3] = Number((timestamp >> 16n) & 0xffn);
  bytes[4] = Number((timestamp >> 8n) & 0xffn);
  bytes[5] = Number(timestamp & 0xffn);

  const random = new Uint8Array(10);
  globalThis.crypto.getRandomValues(random);

  bytes[6] = VERSION_NIBBLE | (random[0] & 0x0f);
  bytes[7] = random[1];
  bytes[8] = VARIANT_BITS | (random[2] & 0x3f);
  bytes.set(random.subarray(3), 9);

  return bytes;
}
