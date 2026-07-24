import { describe, it, expect } from "vitest";
import { validatePassword } from "./password-rules";

describe("validatePassword", () => {
  it("accepts a password within bounds using only allowed characters", () => {
    expect(validatePassword("Abcdef12")).toEqual({ valid: true });
  });

  it("accepts a password containing allowed symbols", () => {
    expect(validatePassword("Abcdef1@#!")).toEqual({ valid: true });
  });

  it("rejects a password shorter than 8 characters", () => {
    const result = validatePassword("Ab1");
    expect(result.valid).toBe(false);
  });

  it("rejects a password longer than 20 characters", () => {
    const result = validatePassword("A".repeat(21));
    expect(result.valid).toBe(false);
  });

  it("rejects a password containing a disallowed character (whitespace)", () => {
    const result = validatePassword("Abcdef 12");
    expect(result.valid).toBe(false);
  });
});
