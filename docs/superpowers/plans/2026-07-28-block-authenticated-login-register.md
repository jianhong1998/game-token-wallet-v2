# 020 — Redirect Authenticated Users off /login and /register Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redirect an authenticated visitor away from `/login` or `/register` to `/`, and rename `middleware.ts` → `proxy.ts` (Next.js 16's required convention) while doing it.

**Architecture:** One function in `apps/frontend/src/proxy.ts` (renamed from `middleware.ts`) already parses the session cookie for the logged-out gate; extend it with a second branch that redirects a valid session away from the two auth-only paths. No new files, no per-page `redirect()`.

**Tech Stack:** Next.js 16 (`proxy.ts` convention, `NextRequest`/`NextResponse`), Vitest for tests, `verifySessionCookie` from `apps/frontend/src/server/session.ts` (HMAC-signed cookie, Web Crypto).

## Global Constraints

- `config.matcher` must not change: `["/((?!_next/static|_next/image|favicon.ico).*)"]`.
- The `NextRequest` → `Promise<NextResponse>` signature is unchanged — this is a pure rename plus one new branch, no signature change (per Next.js `middleware-to-proxy` codemod).
- Redirect target for an authenticated visitor on `/login` or `/register` is `/` (not `/home` — ticket 019 already relocated the dashboard there; confirmed live in `apps/frontend/src/app/(app)/page.tsx` and `apps/frontend/src/app/(auth)/login/page.tsx`'s own post-login `router.push("/")`).
- Existing logged-out-on-protected-route behavior (redirect to `/login`) and the `/admin` bypass must remain byte-for-byte unchanged.

---

## File Structure

- `apps/frontend/src/middleware.ts` → `apps/frontend/src/proxy.ts` (git-moved, exported `middleware()` → `proxy()`, new auth-redirect branch added).
- `apps/frontend/src/middleware.test.ts` → `apps/frontend/src/proxy.test.ts` (git-moved, import updated, new test cases added).
- `apps/frontend/src/server/session.ts` — one comment updated (line 33), no logic change.

---

### Task 1: Rename `middleware.ts` → `proxy.ts` (mechanical, no behavior change)

**Files:**
- Rename: `apps/frontend/src/middleware.ts` → `apps/frontend/src/proxy.ts`
- Rename: `apps/frontend/src/middleware.test.ts` → `apps/frontend/src/proxy.test.ts`
- Modify: `apps/frontend/src/server/session.ts:33`

**Interfaces:**
- Produces: `export async function proxy(request: NextRequest): Promise<NextResponse>` in `apps/frontend/src/proxy.ts` — Task 2 adds a new branch inside this same function, same signature.

- [ ] **Step 1: Confirm the current test suite passes before touching anything**

Run: `pnpm --filter frontend run test -- middleware`
Expected: PASS (7 existing test cases in `middleware.test.ts`)

- [ ] **Step 2: Git-move the source file and rename the exported function**

```bash
git mv apps/frontend/src/middleware.ts apps/frontend/src/proxy.ts
```

Edit `apps/frontend/src/proxy.ts` — rename only the exported function name, nothing else:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { verifySessionCookie } from "./server/session";

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

const PUBLIC_PATHS = new Set(["/login", "/register"]);

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  const isAdminPath = pathname === "/admin" || pathname.startsWith("/admin/");

  if (PUBLIC_PATHS.has(pathname) || isAdminPath) {
    return NextResponse.next();
  }

  const cookie = request.cookies.get("session")?.value;
  const session = cookie ? await verifySessionCookie(cookie) : null;

  if (!session) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}
```

- [ ] **Step 3: Git-move the test file and update its import**

```bash
git mv apps/frontend/src/middleware.test.ts apps/frontend/src/proxy.test.ts
```

Edit `apps/frontend/src/proxy.test.ts` — update only the import line and the `describe` name, keep all 7 existing test bodies (they'll call `proxy` instead of `middleware`):

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { mockVerifySessionCookie } = vi.hoisted(() => ({ mockVerifySessionCookie: vi.fn() }));
vi.mock("./server/session", () => ({ verifySessionCookie: mockVerifySessionCookie }));

import { proxy } from "./proxy";

describe("proxy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects to /login for an unauthenticated visitor to the root dashboard", async () => {
    const request = new NextRequest("http://localhost/");
    const response = await proxy(request);
    expect(response.headers.get("location")).toBe("http://localhost/login");
  });

  it("allows the root dashboard through with a valid session cookie", async () => {
    mockVerifySessionCookie.mockResolvedValue({ username: "alice" });
    const request = new NextRequest("http://localhost/", {
      headers: { cookie: "session=good-value" },
    });
    const response = await proxy(request);
    expect(response.headers.get("location")).toBeNull();
  });

  it("allows /login through without a session", async () => {
    const request = new NextRequest("http://localhost/login");
    const response = await proxy(request);
    expect(response.headers.get("location")).toBeNull();
  });

  it("allows /register through without a session", async () => {
    const request = new NextRequest("http://localhost/register");
    const response = await proxy(request);
    expect(response.headers.get("location")).toBeNull();
  });

  it("allows /admin/registry through without a session", async () => {
    const request = new NextRequest("http://localhost/admin/registry");
    const response = await proxy(request);
    expect(response.headers.get("location")).toBeNull();
  });

  it("redirects to /login for a path that merely shares the /admin string prefix", async () => {
    const request = new NextRequest("http://localhost/administrator");
    const response = await proxy(request);
    expect(response.headers.get("location")).toBe("http://localhost/login");
  });

  it("redirects to /login when there is no session cookie on a protected route", async () => {
    const request = new NextRequest("http://localhost/home");
    const response = await proxy(request);
    expect(response.headers.get("location")).toBe("http://localhost/login");
  });

  it("redirects to /login when the session cookie is invalid", async () => {
    mockVerifySessionCookie.mockResolvedValue(null);
    const request = new NextRequest("http://localhost/home", {
      headers: { cookie: "session=bad-value" },
    });
    const response = await proxy(request);
    expect(response.headers.get("location")).toBe("http://localhost/login");
  });

  it("allows a protected route through with a valid session cookie", async () => {
    mockVerifySessionCookie.mockResolvedValue({ username: "alice" });
    const request = new NextRequest("http://localhost/home", {
      headers: { cookie: "session=good-value" },
    });
    const response = await proxy(request);
    expect(response.headers.get("location")).toBeNull();
  });
});
```

- [ ] **Step 4: Update the stale comment in `session.ts`**

In `apps/frontend/src/server/session.ts:32-33`, change:

```typescript
// Uses Web Crypto (crypto.subtle), not node:crypto, so this module works
// identically whether middleware.ts runs on the Edge or Node.js runtime.
```

to:

```typescript
// Uses Web Crypto (crypto.subtle), not node:crypto, so this module works
// identically whether proxy.ts runs on the Edge or Node.js runtime.
```

- [ ] **Step 5: Run the renamed test suite and confirm it still passes, unchanged**

Run: `pnpm --filter frontend run test -- proxy`
Expected: PASS (same 7 test cases, now under the `proxy` name)

- [ ] **Step 6: Confirm no other file still refers to the old names**

Run: `grep -rn "middleware" apps/frontend/src --include="*.ts" --include="*.tsx"`
Expected: no matches (the only prior references were the file itself and the `session.ts` comment, both just changed)

- [ ] **Step 7: Commit**

```bash
git add apps/frontend/src/proxy.ts apps/frontend/src/proxy.test.ts apps/frontend/src/server/session.ts
git commit -m "refactor(020): rename middleware.ts to proxy.ts per Next.js 16 convention"
```

---

### Task 2: Redirect an authenticated visitor off `/login` and `/register`

**Files:**
- Modify: `apps/frontend/src/proxy.ts` (from Task 1)
- Test: `apps/frontend/src/proxy.test.ts` (from Task 1)

**Interfaces:**
- Consumes: `proxy(request: NextRequest): Promise<NextResponse>` from Task 1, `verifySessionCookie(cookie: string): Promise<{ username: string } | null>` from `apps/frontend/src/server/session.ts` (unchanged signature).
- Produces: nothing new consumed by later tasks — this is the final behavior change for ticket 020.

- [ ] **Step 1: Write the failing tests**

Append these 4 cases to the `describe("proxy", ...)` block in `apps/frontend/src/proxy.test.ts` (after the existing 9 cases from Task 1):

```typescript
  it("redirects an authenticated visitor away from /login to /", async () => {
    mockVerifySessionCookie.mockResolvedValue({ username: "alice" });
    const request = new NextRequest("http://localhost/login", {
      headers: { cookie: "session=good-value" },
    });
    const response = await proxy(request);
    expect(response.headers.get("location")).toBe("http://localhost/");
  });

  it("redirects an authenticated visitor away from /register to /", async () => {
    mockVerifySessionCookie.mockResolvedValue({ username: "alice" });
    const request = new NextRequest("http://localhost/register", {
      headers: { cookie: "session=good-value" },
    });
    const response = await proxy(request);
    expect(response.headers.get("location")).toBe("http://localhost/");
  });

  it("allows /login through when the session cookie is invalid", async () => {
    mockVerifySessionCookie.mockResolvedValue(null);
    const request = new NextRequest("http://localhost/login", {
      headers: { cookie: "session=bad-value" },
    });
    const response = await proxy(request);
    expect(response.headers.get("location")).toBeNull();
  });

  it("allows /register through when the session cookie is invalid", async () => {
    mockVerifySessionCookie.mockResolvedValue(null);
    const request = new NextRequest("http://localhost/register", {
      headers: { cookie: "session=bad-value" },
    });
    const response = await proxy(request);
    expect(response.headers.get("location")).toBeNull();
  });
```

- [ ] **Step 2: Run tests to verify the two new redirect cases fail**

Run: `pnpm --filter frontend run test -- proxy`
Expected: FAIL — the two "redirects an authenticated visitor away from ..." cases fail because `/login` and `/register` currently short-circuit to `NextResponse.next()` before the cookie is ever checked. The two "allows ... when the session cookie is invalid" cases pass already (no behavior change needed for that path), but run the full file to confirm the failure set is exactly the two redirect cases.

- [ ] **Step 3: Implement the minimal logic change**

Replace the body of `apps/frontend/src/proxy.ts` with:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { verifySessionCookie } from "./server/session";

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

const AUTH_ONLY_PATHS = new Set(["/login", "/register"]);

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  const isAdminPath = pathname === "/admin" || pathname.startsWith("/admin/");

  if (isAdminPath) {
    return NextResponse.next();
  }

  const cookie = request.cookies.get("session")?.value;
  const session = cookie ? await verifySessionCookie(cookie) : null;

  if (AUTH_ONLY_PATHS.has(pathname)) {
    if (session) {
      return NextResponse.redirect(new URL("/", request.url));
    }
    return NextResponse.next();
  }

  if (!session) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}
```

Note what changed from Task 1's version: `PUBLIC_PATHS` renamed `AUTH_ONLY_PATHS` (it's no longer an unconditional bypass — it's now a branch that still checks the session), and the cookie/session lookup moved up so it runs for `/login` and `/register` too. The `/admin` bypass and the protected-route redirect-to-`/login` behavior are untouched.

- [ ] **Step 4: Run tests to verify all cases pass**

Run: `pnpm --filter frontend run test -- proxy`
Expected: PASS — all 13 test cases (9 from Task 1 + 4 new).

- [ ] **Step 5: Run the full verification gate**

Run: `just lint`
Expected: no changes/errors. If `pnpm lint` behaves unexpectedly (see `CLAUDE.local.md` — a local `rtk` hook can rewrite it into a flat `eslint .`), verify with `rtk proxy pnpm lint` before treating any failure as real.

Run: `just test`
Expected: full suite passes, including the `test-ui` target (`pnpm --filter frontend run test`) covering the new `proxy.test.ts`.

Run: `pnpm --filter frontend run typecheck`
Expected: no errors.

- [ ] **Step 6: Manually verify on the running system**

```bash
just up   # or just up-build on first run
```

- Log in through the UI, then navigate the browser directly to `/login` — confirm it redirects to `/` (the dashboard) instead of rendering the login form.
- Do the same for `/register`.
- Log out (or open a private/incognito window), navigate to `/login` and `/register` — confirm both still render normally.
- Confirm `/admin/registry` and a protected route like `/` still behave as before (logged-out → redirect to `/login`; `/admin` paths always render).

- [ ] **Step 7: Commit**

```bash
git add apps/frontend/src/proxy.ts apps/frontend/src/proxy.test.ts
git commit -m "feat(020): redirect authenticated visitors off /login and /register"
```

---

## Self-Review

**1. Spec coverage:**
- Ticket checklist item 1 (rename `middleware.ts`→`proxy.ts`, `middleware()`→`proxy()`, `config.matcher` unchanged, test file renamed+imports updated) → Task 1.
- Ticket checklist item 2 (`session.ts` comment update) → Task 1, Step 4.
- Ticket checklist item 3 (authenticated visitor to exactly `/login` or `/register` → redirect to `/`; invalid/expired/missing cookie unaffected) → Task 2, Step 3.
- Ticket checklist item 4 (new test cases: authed redirected from `/login` and `/register`; unauthenticated/invalid-cookie on either unaffected) → Task 2, Step 1 (4 new cases) plus the 2 pre-existing "allows through without a session" cases carried over from Task 1.
- Design decisions Q1 (same function, no new file), Q2 (rename bundled in), Q3 (redirect target is `/`, confirmed live post-019) are all reflected in the Global Constraints and Task 2 implementation.

**2. Placeholder scan:** No TBD/TODO markers; every step has literal runnable code and exact commands.

**3. Type consistency:** `proxy(request: NextRequest): Promise<NextResponse>` is identical across Task 1 (defines it) and Task 2 (extends its body only, no signature change). `verifySessionCookie` signature matches `session.ts`'s actual implementation (`(cookie: string) => Promise<{ username: string } | null>`) — confirmed by reading the file, not assumed.
