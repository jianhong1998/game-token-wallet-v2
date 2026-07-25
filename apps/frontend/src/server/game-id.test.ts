import { describe, it, expect } from "vitest";
import { generateGameId } from "./game-id";

describe("generateGameId", () => {
  it("returns 16 bytes", () => {
    expect(generateGameId().length).toBe(16);
  });

  it("sets the version nibble to 7 (byte 6, high nibble)", () => {
    const id = generateGameId();
    expect(id[6] >> 4).toBe(0x7);
  });

  it("sets the variant bits to 0b10 (byte 8, top 2 bits)", () => {
    const id = generateGameId();
    expect(id[8] >> 6).toBe(0b10);
  });

  it("encodes a timestamp within 1 second of Date.now()", () => {
    const before = Date.now();
    const id = generateGameId();
    const after = Date.now();

    let ts = 0n;
    for (let i = 0; i < 6; i++) {
      ts = (ts << 8n) | BigInt(id[i]);
    }
    const timestamp = Number(ts);

    expect(timestamp).toBeGreaterThanOrEqual(before - 1000);
    expect(timestamp).toBeLessThanOrEqual(after + 1000);
  });

  it("generates unique ids across many calls", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => Buffer.from(generateGameId()).toString("hex")));
    expect(ids.size).toBe(1000);
  });
});
