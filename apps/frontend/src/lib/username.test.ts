import { describe, it, expect } from "vitest";
import { normalizeUsername, validateUsername } from "./username";

describe("normalizeUsername", () => {
  it("lowercases ASCII letters", () => {
    expect(normalizeUsername("Alice")).toBe("alice");
  });

  it("leaves CJK characters unchanged (no case concept)", () => {
    expect(normalizeUsername("火锅")).toBe("火锅");
  });

  it("NFC-normalizes decomposed accented Latin input to its precomposed form", () => {
    const decomposed = "é"; // "e" + combining acute accent
    expect(normalizeUsername(decomposed)).toBe("é");
  });
});

describe("validateUsername", () => {
  it("accepts a normal ASCII username", () => {
    expect(validateUsername("alice")).toEqual({ valid: true });
  });

  it("accepts a single 3-byte CJK character at the minimum byte length", () => {
    expect(validateUsername("火")).toEqual({ valid: true });
  });

  it("accepts a username containing a space", () => {
    expect(validateUsername("poker night")).toEqual({ valid: true });
  });

  it("rejects a username below the 3-byte minimum", () => {
    const result = validateUsername("ab");
    expect(result.valid).toBe(false);
  });

  it("accepts a username at exactly the 32-byte maximum", () => {
    expect(validateUsername("a".repeat(32))).toEqual({ valid: true });
  });

  it("rejects a username over the 32-byte maximum", () => {
    const result = validateUsername("a".repeat(33));
    expect(result.valid).toBe(false);
  });

  it("rejects a username containing a disallowed symbol", () => {
    const result = validateUsername("alice!");
    expect(result.valid).toBe(false);
  });
});
