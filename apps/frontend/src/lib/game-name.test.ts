import { describe, it, expect } from "vitest";
import { normalizeGameName, validateGameName } from "./game-name";

describe("normalizeGameName", () => {
  it("NFC-normalizes decomposed accented Latin input to its precomposed form", () => {
    const decomposed = "Café Night"; // "e" + combining acute accent
    expect(normalizeGameName(decomposed)).toBe("Café Night");
  });

  it("does not case-fold, unlike normalizeUsername", () => {
    expect(normalizeGameName("Friday Poker")).toBe("Friday Poker");
  });
});

describe("validateGameName", () => {
  it("accepts a normal ASCII name", () => {
    expect(validateGameName("Friday Poker")).toEqual({ valid: true });
  });

  it("accepts a single 3-byte CJK character at the minimum byte length", () => {
    expect(validateGameName("火")).toEqual({ valid: true });
  });

  it("accepts a name containing a space", () => {
    expect(validateGameName("Poker Night")).toEqual({ valid: true });
  });

  it("rejects a name below the 3-byte minimum", () => {
    expect(validateGameName("ab").valid).toBe(false);
  });

  it("accepts a name at exactly the 32-byte maximum", () => {
    expect(validateGameName("a".repeat(32))).toEqual({ valid: true });
  });

  it("rejects a name over the 32-byte maximum", () => {
    expect(validateGameName("a".repeat(33)).valid).toBe(false);
  });

  it("rejects a name containing a disallowed symbol", () => {
    expect(validateGameName("Friday!").valid).toBe(false);
  });
});
