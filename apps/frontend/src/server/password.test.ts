import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword, runDummyHash } from "./password";

describe("hashPassword / verifyPassword", () => {
  it("produces a 16-byte salt and 64-byte hash", async () => {
    const { salt, hash } = await hashPassword("correct horse battery staple");
    expect(salt).toHaveLength(16);
    expect(hash).toHaveLength(64);
  });

  it("verifies the correct password against its own salt and hash", async () => {
    const { salt, hash } = await hashPassword("correct horse battery staple");
    await expect(verifyPassword("correct horse battery staple", salt, hash)).resolves.toBe(true);
  });

  it("rejects an incorrect password against an existing salt and hash", async () => {
    const { salt, hash } = await hashPassword("correct horse battery staple");
    await expect(verifyPassword("wrong password", salt, hash)).resolves.toBe(false);
  });

  it("produces different hashes for the same password with different (random) salts", async () => {
    const first = await hashPassword("same password");
    const second = await hashPassword("same password");
    expect(Buffer.from(first.hash).equals(Buffer.from(second.hash))).toBe(false);
  });
});

describe("runDummyHash", () => {
  it("resolves without throwing regardless of input", async () => {
    await expect(runDummyHash("anything")).resolves.toBeUndefined();
  });
});
