import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { mockVerifySessionCookie } = vi.hoisted(() => ({ mockVerifySessionCookie: vi.fn() }));
vi.mock("./server/session", () => ({ verifySessionCookie: mockVerifySessionCookie }));

import { middleware } from "./middleware";

describe("middleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows the root noop demo page through without a session", async () => {
    const request = new NextRequest("http://localhost/");
    const response = await middleware(request);
    expect(response.headers.get("location")).toBeNull();
  });

  it("allows /login through without a session", async () => {
    const request = new NextRequest("http://localhost/login");
    const response = await middleware(request);
    expect(response.headers.get("location")).toBeNull();
  });

  it("allows /register through without a session", async () => {
    const request = new NextRequest("http://localhost/register");
    const response = await middleware(request);
    expect(response.headers.get("location")).toBeNull();
  });

  it("allows /admin/registry through without a session", async () => {
    const request = new NextRequest("http://localhost/admin/registry");
    const response = await middleware(request);
    expect(response.headers.get("location")).toBeNull();
  });

  it("redirects to /login for a path that merely shares the /admin string prefix", async () => {
    const request = new NextRequest("http://localhost/administrator");
    const response = await middleware(request);
    expect(response.headers.get("location")).toBe("http://localhost/login");
  });

  it("redirects to /login when there is no session cookie on a protected route", async () => {
    const request = new NextRequest("http://localhost/home");
    const response = await middleware(request);
    expect(response.headers.get("location")).toBe("http://localhost/login");
  });

  it("redirects to /login when the session cookie is invalid", async () => {
    mockVerifySessionCookie.mockResolvedValue(null);
    const request = new NextRequest("http://localhost/home", {
      headers: { cookie: "session=bad-value" },
    });
    const response = await middleware(request);
    expect(response.headers.get("location")).toBe("http://localhost/login");
  });

  it("allows a protected route through with a valid session cookie", async () => {
    mockVerifySessionCookie.mockResolvedValue({ username: "alice" });
    const request = new NextRequest("http://localhost/home", {
      headers: { cookie: "session=good-value" },
    });
    const response = await middleware(request);
    expect(response.headers.get("location")).toBeNull();
  });
});
