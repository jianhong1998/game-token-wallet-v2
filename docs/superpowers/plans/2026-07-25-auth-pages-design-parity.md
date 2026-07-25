# Auth pages design parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring `/login` and `/register` up to parity with the design spec (`docs/technical-related/ui-design/004-ui-sample/Kitty - Glass Vault.dc.html`, lines 27-63) — branded heading, subtitle copy, labeled inputs, and cross-page navigation links — which were never implemented in ticket 003.

**Architecture:** Both pages are self-contained client components already using the shared `Button`/`Input`/`Alert` primitives from ticket 017. This is a markup/copy change only — no new components, no new dependencies, no server-action/business-logic changes. Each input gets an associated `<label>` (new) above the existing `Input`; a `next/link` cross-link is added at the bottom of each form, pushed down via a flex spacer matching the design's `flex:1` spacer div.

**Tech Stack:** Next.js App Router, React, Tailwind v4 (existing `@theme` tokens in `globals.css`), `next/link`, Vitest + Testing Library, Playwright.

## Global Constraints

- Demo credential prefill and the "Demo account prefilled — just hit Log in." caption from the mockup are explicitly **excluded** (user decision) — do not implement them.
- Placeholder text becomes lowercase example text (`username`, `password`, `confirm password`) per the mockup; the visible `<label>` stays capitalized (`Username`, `Password`, `Confirm password`). Tests must query by label, not placeholder, since placeholder text is no longer a reliable/unique selector target and label-based queries are the accessible, resilient default.
- Register page title changes from "Register" to "Create account"; the submit button text changes to match (`Create account`). This changes the accessible name used in existing unit and e2e tests — every reference must be updated in the same commit that changes the button, never left inconsistent.
- Login's "Kitty" heading uses the gradient treatment (`bg-gradient-primary` + `bg-clip-text text-transparent`); Register's "Create account" heading is plain `text-text-primary` — this asymmetry is intentional, per the mockup (compare line 29 `background:linear-gradient(...)` vs line 53 `color:#f4f1fb`).
- Link color per the mockup's global anchor rule (line 15-16): default `text-sky-cyan`, hover `text-lavender`, `font-bold`.
- No change to `loginUser`/`registerUser` server actions, validation logic (`validateUsername`, `validatePassword`), or routing behavior (`/home` on success). Only markup, copy, and navigation links change.

---

## File Structure

- Modify: `apps/frontend/src/app/(auth)/login/page.tsx` — add heading/subtitle, labels, bottom register link.
- Modify: `apps/frontend/src/app/(auth)/login/page.test.tsx` — switch placeholder queries to label queries; add link test.
- Modify: `apps/frontend/src/app/(auth)/register/page.tsx` — add subtitle, labels, retitle heading/button, bottom login link.
- Modify: `apps/frontend/src/app/(auth)/register/page.test.tsx` — switch placeholder queries to label queries; update button name; add link test.
- Modify: `apps/e2e/tests/auth.spec.ts` — switch placeholder queries to label queries; update register button name.

---

### Task 1: Login page — heading, subtitle, labeled inputs, register link

**Files:**
- Modify: `apps/frontend/src/app/(auth)/login/page.tsx`
- Test: `apps/frontend/src/app/(auth)/login/page.test.tsx`

**Interfaces:**
- Consumes: `Button`, `Input`, `Alert` from `@/components/ui/*` (unchanged signatures); `loginUser` from `@/server/actions/auth` (unchanged).
- Produces: no new exports; page still default-exports `LoginPage`.

- [ ] **Step 1: Write the failing tests**

Replace `apps/frontend/src/app/(auth)/login/page.test.tsx` with:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { mockLoginUser } = vi.hoisted(() => ({ mockLoginUser: vi.fn() }));
vi.mock("@/server/actions/auth", () => ({ loginUser: mockLoginUser }));

const { mockPush } = vi.hoisted(() => ({ mockPush: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mockPush }) }));

import LoginPage from "./page";

describe("LoginPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("submits and redirects to /home on success", async () => {
    mockLoginUser.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<LoginPage />);
    await user.type(screen.getByLabelText("Username"), "alice");
    await user.type(screen.getByLabelText("Password"), "Abcdef12");
    await user.click(screen.getByRole("button", { name: "Log in" }));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/home"));
    expect(mockLoginUser).toHaveBeenCalledWith({ username: "alice", password: "Abcdef12" });
  });

  it("shows the generic error alert when login fails", async () => {
    mockLoginUser.mockResolvedValue({ ok: false, error: "Invalid username or password" });
    const user = userEvent.setup();
    render(<LoginPage />);
    await user.type(screen.getByLabelText("Username"), "alice");
    await user.type(screen.getByLabelText("Password"), "wrong");
    await user.click(screen.getByRole("button", { name: "Log in" }));

    expect(await screen.findByTestId("login-error")).toHaveTextContent("Invalid username or password");
  });

  it("shows a fallback error alert when loginUser throws an unexpected error", async () => {
    mockLoginUser.mockRejectedValue(new Error("Network error"));
    const user = userEvent.setup();
    render(<LoginPage />);
    await user.type(screen.getByLabelText("Username"), "alice");
    await user.type(screen.getByLabelText("Password"), "Abcdef12");
    await user.click(screen.getByRole("button", { name: "Log in" }));

    expect(await screen.findByTestId("login-error")).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("links to the register page", () => {
    render(<LoginPage />);
    expect(screen.getByRole("link", { name: "Create an account" })).toHaveAttribute(
      "href",
      "/register",
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter frontend test -- login/page.test.tsx`
Expected: FAIL — `getByLabelText("Username")` finds no label (current inputs have no associated label), and the new "links to the register page" test fails with no matching role.

- [ ] **Step 3: Implement**

Replace `apps/frontend/src/app/(auth)/login/page.tsx` with:

```tsx
"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { loginUser } from "@/server/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        const result = await loginUser({ username, password });
        if (result.ok) {
          router.push("/home");
        } else {
          setError(result.error);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      }
    });
  }

  return (
    <main className="flex min-h-screen flex-col py-16">
      <h1 className="bg-gradient-primary bg-clip-text text-3xl font-extrabold text-transparent">
        Kitty
      </h1>
      <p className="mt-2 text-sm font-semibold text-text-secondary">
        Tokenize your table — no wallet, no seed phrase, just a username and password.
      </p>
      <form onSubmit={handleSubmit} className="mt-10 flex flex-col gap-3.5">
        <div>
          <label htmlFor="login-username" className="mb-1.5 block text-[11px] font-bold text-text-primary">
            Username
          </label>
          <Input
            id="login-username"
            type="text"
            placeholder="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            required
          />
        </div>
        <div>
          <label htmlFor="login-password" className="mb-1.5 block text-[11px] font-bold text-text-primary">
            Password
          </label>
          <Input
            id="login-password"
            type="password"
            placeholder="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </div>
        {error && (
          <Alert data-testid="login-error" variant="error" className="break-all">
            {error}
          </Alert>
        )}
        <Button type="submit" variant="primary" isLoading={isPending} className="mt-1.5">
          Log in
        </Button>
      </form>
      <div className="flex-1" />
      <p className="text-center text-sm font-semibold text-text-secondary">
        New here?{" "}
        <Link href="/register" className="font-bold text-sky-cyan hover:text-lavender">
          Create an account
        </Link>
      </p>
    </main>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter frontend test -- login/page.test.tsx`
Expected: PASS (all 4 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/app/\(auth\)/login/page.tsx apps/frontend/src/app/\(auth\)/login/page.test.tsx
git commit -m "feat(frontend): match login page to Kitty design spec"
```

---

### Task 2: Register page — retitle, subtitle, labeled inputs, login link

**Files:**
- Modify: `apps/frontend/src/app/(auth)/register/page.tsx`
- Test: `apps/frontend/src/app/(auth)/register/page.test.tsx`

**Interfaces:**
- Consumes: `Button`, `Input`, `Alert` from `@/components/ui/*`; `normalizeUsername`, `validateUsername` from `@/lib/username`; `validatePassword` from `@/lib/password-rules`; `registerUser` from `@/server/actions/auth` — all unchanged.
- Produces: no new exports; page still default-exports `RegisterPage`.

- [ ] **Step 1: Write the failing tests**

Replace `apps/frontend/src/app/(auth)/register/page.test.tsx` with:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { mockRegisterUser } = vi.hoisted(() => ({ mockRegisterUser: vi.fn() }));
vi.mock("@/server/actions/auth", () => ({ registerUser: mockRegisterUser }));

const { mockPush } = vi.hoisted(() => ({ mockPush: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mockPush }) }));

import RegisterPage from "./page";

describe("RegisterPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows a live hint for an invalid username without submitting", async () => {
    const user = userEvent.setup();
    render(<RegisterPage />);
    await user.type(screen.getByLabelText("Username"), "a!");
    expect(await screen.findByTestId("username-hint")).toBeInTheDocument();
    expect(mockRegisterUser).not.toHaveBeenCalled();
  });

  it("shows a live hint when confirm password doesn't match", async () => {
    const user = userEvent.setup();
    render(<RegisterPage />);
    await user.type(screen.getByLabelText("Password"), "Abcdef12");
    await user.type(screen.getByLabelText("Confirm password"), "Abcdef13");
    expect(await screen.findByTestId("confirm-password-hint")).toBeInTheDocument();
  });

  it("submits and redirects to /home on success", async () => {
    mockRegisterUser.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<RegisterPage />);
    await user.type(screen.getByLabelText("Username"), "alice");
    await user.type(screen.getByLabelText("Password"), "Abcdef12");
    await user.type(screen.getByLabelText("Confirm password"), "Abcdef12");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/home"));
    expect(mockRegisterUser).toHaveBeenCalledWith({
      username: "alice",
      password: "Abcdef12",
      confirmPassword: "Abcdef12",
    });
  });

  it("shows the error alert when registration fails", async () => {
    mockRegisterUser.mockResolvedValue({ ok: false, error: "Username already taken" });
    const user = userEvent.setup();
    render(<RegisterPage />);
    await user.type(screen.getByLabelText("Username"), "alice");
    await user.type(screen.getByLabelText("Password"), "Abcdef12");
    await user.type(screen.getByLabelText("Confirm password"), "Abcdef12");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByTestId("register-error")).toHaveTextContent("Username already taken");
  });

  it("shows a fallback error alert when registerUser throws an unexpected error", async () => {
    mockRegisterUser.mockRejectedValue(new Error("Network error"));
    const user = userEvent.setup();
    render(<RegisterPage />);
    await user.type(screen.getByLabelText("Username"), "alice");
    await user.type(screen.getByLabelText("Password"), "Abcdef12");
    await user.type(screen.getByLabelText("Confirm password"), "Abcdef12");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByTestId("register-error")).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("links to the login page", () => {
    render(<RegisterPage />);
    expect(screen.getByRole("link", { name: "Log in" })).toHaveAttribute("href", "/login");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter frontend test -- register/page.test.tsx`
Expected: FAIL — `getByLabelText` finds no associated label, button name "Create account" doesn't exist yet, no "Log in" link exists.

- [ ] **Step 3: Implement**

Replace `apps/frontend/src/app/(auth)/register/page.tsx` with:

```tsx
"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { registerUser } from "@/server/actions/auth";
import { normalizeUsername, validateUsername } from "@/lib/username";
import { validatePassword } from "@/lib/password-rules";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";

export default function RegisterPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const usernameCheck = username ? validateUsername(normalizeUsername(username)) : null;
  const passwordCheck = password ? validatePassword(password) : null;
  const confirmMismatch = confirmPassword.length > 0 && confirmPassword !== password;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        const result = await registerUser({ username, password, confirmPassword });
        if (result.ok) {
          router.push("/home");
        } else {
          setError(result.error);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      }
    });
  }

  return (
    <main className="flex min-h-screen flex-col py-16">
      <h1 className="text-3xl font-extrabold text-text-primary">Create account</h1>
      <p className="mt-2 text-sm font-semibold text-text-secondary">
        8–20 characters, letters/numbers/basic symbols only.
      </p>
      <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-3.5">
        <div>
          <label htmlFor="register-username" className="mb-1.5 block text-[11px] font-bold text-text-primary">
            Username
          </label>
          <Input
            id="register-username"
            type="text"
            placeholder="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            required
          />
          {usernameCheck && !usernameCheck.valid && (
            <p data-testid="username-hint" className="mt-1 text-xs text-danger">
              {usernameCheck.reason}
            </p>
          )}
        </div>
        <div>
          <label htmlFor="register-password" className="mb-1.5 block text-[11px] font-bold text-text-primary">
            Password
          </label>
          <Input
            id="register-password"
            type="password"
            placeholder="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
          {passwordCheck && !passwordCheck.valid && (
            <p data-testid="password-hint" className="mt-1 text-xs text-danger">
              {passwordCheck.reason}
            </p>
          )}
        </div>
        <div>
          <label htmlFor="register-confirm-password" className="mb-1.5 block text-[11px] font-bold text-text-primary">
            Confirm password
          </label>
          <Input
            id="register-confirm-password"
            type="password"
            placeholder="confirm password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            required
          />
          {confirmMismatch && (
            <p data-testid="confirm-password-hint" className="mt-1 text-xs text-danger">
              Passwords do not match
            </p>
          )}
        </div>
        {error && (
          <Alert data-testid="register-error" variant="error" className="break-all">
            {error}
          </Alert>
        )}
        <Button type="submit" variant="primary" isLoading={isPending} className="mt-1.5">
          Create account
        </Button>
      </form>
      <div className="flex-1" />
      <p className="text-center text-sm font-semibold text-text-secondary">
        Already have an account?{" "}
        <Link href="/login" className="font-bold text-sky-cyan hover:text-lavender">
          Log in
        </Link>
      </p>
    </main>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter frontend test -- register/page.test.tsx`
Expected: PASS (all 6 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/app/\(auth\)/register/page.tsx apps/frontend/src/app/\(auth\)/register/page.test.tsx
git commit -m "feat(frontend): match register page to Kitty design spec"
```

---

### Task 3: Update e2e auth spec for label-based queries and new button/link copy

**Files:**
- Modify: `apps/e2e/tests/auth.spec.ts`

**Interfaces:**
- Consumes: running dev server routes `/register`, `/login`, `/home` (unchanged); DOM produced by Tasks 1-2 (labels "Username"/"Password"/"Confirm password", register button name "Create account", login button name "Log in" unchanged).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Update the spec**

Replace `apps/e2e/tests/auth.spec.ts` with:

```ts
import { test, expect } from "@playwright/test";

function uniqueUsername(): string {
  return `e2euser${Date.now()}`;
}

test.describe("registration and login", () => {
  test("a new user can register, land on /home, log out, and log back in", async ({ page }) => {
    const username = uniqueUsername();
    const password = "Abcdef123!";

    await page.goto("/register");
    await page.getByLabel("Username").fill(username);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByLabel("Confirm password").fill(password);
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page).toHaveURL(/\/home$/, { timeout: 30_000 });
    await expect(page.getByTestId("home-welcome")).toContainText(username);

    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page).toHaveURL(/\/login$/);

    await page.goto("/home");
    await expect(page).toHaveURL(/\/login$/);

    await page.getByLabel("Username").fill(username);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Log in" }).click();

    await expect(page).toHaveURL(/\/home$/, { timeout: 30_000 });
    await expect(page.getByTestId("home-welcome")).toContainText(username);
  });

  test("login with the wrong password shows a generic error", async ({ page }) => {
    const username = uniqueUsername();
    const password = "Abcdef123!";

    await page.goto("/register");
    await page.getByLabel("Username").fill(username);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByLabel("Confirm password").fill(password);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(/\/home$/, { timeout: 30_000 });

    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page).toHaveURL(/\/login$/);

    await page.getByLabel("Username").fill(username);
    await page.getByLabel("Password").fill("wrong-password");
    await page.getByRole("button", { name: "Log in" }).click();

    await expect(page.getByTestId("login-error")).toHaveText("Invalid username or password");
  });

  test("navigates between login and register via the footer links", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("link", { name: "Create an account" }).click();
    await expect(page).toHaveURL(/\/register$/);

    await page.getByRole("link", { name: "Log in" }).click();
    await expect(page).toHaveURL(/\/login$/);
  });
});
```

- [ ] **Step 2: Commit**

```bash
git add apps/e2e/tests/auth.spec.ts
git commit -m "test(e2e): update auth spec for design-parity labels and copy"
```

---

### Task 4: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Lint**

Run: `pnpm lint` (if it fails unexpectedly, per `CLAUDE.local.md`, re-verify with `rtk proxy pnpm lint` before treating it as a real regression)
Expected: no errors

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: no errors

- [ ] **Step 3: Unit tests**

Run: `pnpm --filter frontend test`
Expected: all pass, including the 2 new link tests

- [ ] **Step 4: Boot the app and visually confirm**

Run: `pnpm --filter frontend dev`, open `/login` and `/register` in a browser.
Expected: `/login` shows gradient "Kitty" heading, subtitle, labeled Username/Password fields, "Log in" button, "New here? Create an account" link at the bottom that navigates to `/register`. `/register` shows plain "Create account" heading, subtitle, labeled Username/Password/Confirm password fields, "Create account" button, "Already have an account? Log in" link that navigates to `/login`. No demo-prefilled values in either field.

- [ ] **Step 5: E2E**

Run: `pnpm --filter e2e test` (or the repo's configured e2e command against the dev server)
Expected: all 3 tests in `auth.spec.ts` pass.

---

## Self-review

- **Spec coverage:** heading (gradient login / plain register) ✅ Tasks 1-2; subtitle copy on both pages ✅ Tasks 1-2; labeled inputs (label above, lowercase placeholder) ✅ Tasks 1-2; bottom-anchored cross-links both directions ✅ Tasks 1-2; link color per mockup's global anchor style ✅ Global Constraints + Tasks 1-2. Demo prefill/caption explicitly excluded per user decision — no task implements it (intentional).
- **Placeholder scan:** none found — every step has literal, complete code.
- **Type consistency:** both pages keep the same exported default signature (`() => JSX.Element`, no props), same state shape, same server-action call signatures (`loginUser({ username, password })`, `registerUser({ username, password, confirmPassword })`) as before — no downstream consumer (tests, e2e) references anything renamed except the explicitly-tracked button-name and label changes, which are updated in the same task.
