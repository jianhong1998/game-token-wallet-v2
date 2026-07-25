import { describe, it, expect, beforeEach, vi } from "vitest";

function setValidEnv() {
  process.env.SESSION_SECRET = "test-session-secret-value-not-used-in-prod";
}

describe("createSessionCookie / verifySessionCookie", () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.SESSION_SECRET;
  });

  it("round-trips a valid session", async () => {
    setValidEnv();
    const { createSessionCookie, verifySessionCookie } = await import("./session");
    const cookie = await createSessionCookie("alice");
    const result = await verifySessionCookie(cookie);
    expect(result).toEqual({ username: "alice" });
  });

  it("rejects a tampered payload", async () => {
    setValidEnv();
    const { createSessionCookie, verifySessionCookie } = await import("./session");
    const cookie = await createSessionCookie("alice");
    const [payload, signature] = cookie.split(".");
    const result = await verifySessionCookie(`${payload}x.${signature}`);
    expect(result).toBeNull();
  });

  it("rejects an expired session", async () => {
    setValidEnv();
    vi.useFakeTimers();
    const { createSessionCookie, verifySessionCookie } = await import("./session");
    const cookie = await createSessionCookie("alice");
    vi.advanceTimersByTime(8 * 24 * 60 * 60 * 1000); // 8 days, past the 7-day TTL
    const result = await verifySessionCookie(cookie);
    vi.useRealTimers();
    expect(result).toBeNull();
  });

  it("rejects a malformed cookie value", async () => {
    setValidEnv();
    const { verifySessionCookie } = await import("./session");
    const result = await verifySessionCookie("not-a-valid-cookie");
    expect(result).toBeNull();
  });
});
