# Frontend Design Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the shared UI foundation (design tokens, core component set, route-group scaffolding, layout shell) for `apps/frontend`, per [ticket 017](../../tickets/017-frontend-design-foundation.md) and its [design spec](../specs/2026-07-23-frontend-design-foundation-design.md), so every later frontend ticket (starting with 003) consumes shared components instead of hand-rolling Tailwind classes.

**Architecture:** shadcn/ui CLI generates `Button`, `Input`, `Alert` into `src/components/ui/`, customized in place with this app's cva variants and dark-glass tokens. `Spinner` and `PageLoader` are hand-rolled (no shadcn/Radix equivalent). Design tokens live in `globals.css`'s `@theme` block; `AppShell` (mobile-first, desktop-capped) wraps every route from the root layout. `(auth)`/`(app)` route groups are scaffolded empty for ticket 003+. The admin registry page is retrofitted onto the new components without changing its external behavior.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript (strict), Tailwind CSS v4, shadcn/ui + `class-variance-authority` + `clsx`/`tailwind-merge`, Vitest + `@testing-library/react` (jsdom), `next/font/google`.

## Global Constraints

- New dependencies are added via `pnpm --filter frontend add [-D]`, never hand-edited into `package.json` or the lockfile (repo `CLAUDE.md`).
- `apps/e2e/tests/admin-registry.spec.ts` and `apps/e2e/tests/noop.spec.ts` are not modified and must keep passing unchanged — exact `data-testid` values (`registry-status`, `registry-error`, `noop-signature`, `noop-error`), exact success text (`"registry initialized, {N} active games"`), and the `"Initialize registry"` / `"Send noop transaction"` accessible button names are load-bearing.
- Every new component under `apps/frontend/src/components/` is colocated as `Component.tsx` + `Component.test.tsx` per [001-CODEBASE-STRUCTURE.md](../../technical-related/codebase-structure/001-CODEBASE-STRUCTURE.md); shadcn-generated primitives under `src/components/ui/` keep shadcn's own lowercase filenames (`button.tsx`, `button.test.tsx`, etc.).
- Prettier: double quotes, semicolons, trailing commas, 100-char print width (`.prettierrc`) — match existing files.
- Format: TDD — write the test, watch it fail for the right reason, implement, watch it pass, commit. Pure CSS/token/config tasks with no branching logic (Task 2) are the documented exception — see that task's note.
- This plan's branch is **not** `docs/017-frontend-design-foundation-spec` (docs-only, already has the spec commits) — per [branch-name-rule.md](../../../.claude/rules/branch-name-rule.md), implementation is `feat`-type work and belongs on its own `feat/017-frontend-design-foundation` branch, created at execution time.

---

### Task 1: Testing infrastructure + `Spinner`

**Files:**
- Modify: `apps/frontend/package.json` (devDependencies)
- Modify: `apps/frontend/vitest.config.ts`
- Create: `apps/frontend/vitest.setup.ts`
- Create: `apps/frontend/src/components/Spinner/Spinner.tsx`
- Test: `apps/frontend/src/components/Spinner/Spinner.test.tsx`

**Interfaces:**
- Produces: `Spinner({ className }: { className?: string }): JSX.Element` — exported from `@/components/Spinner/Spinner`, rendered with `role="status"` and accessible name `"Loading"`. Consumed by Task 3's `Button`.

- [ ] **Step 1: Add testing dependencies**

```bash
pnpm --filter frontend add -D @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom
```

- [ ] **Step 2: Reconfigure Vitest for jsdom + TSX**

Replace `apps/frontend/vitest.config.ts` entirely:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: {
    jsx: "automatic",
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
```

`esbuild.jsx: "automatic"` makes Vitest's esbuild transform emit the React 19 automatic JSX runtime (`react/jsx-runtime`) for `.tsx` files — matching how these components are already written (no `import React` in existing `.tsx` files) — without adding a `@vitejs/plugin-react` dependency.

- [ ] **Step 3: Add the RTL setup file**

Create `apps/frontend/vitest.setup.ts`:

```ts
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});
```

`test.globals` is not enabled in this repo's Vitest config (tests import `describe`/`it`/`expect` explicitly, e.g. `registry.test.ts`), so React Testing Library's built-in auto-cleanup (which relies on a global `afterEach`) won't register on its own — this file wires it up explicitly so DOM state doesn't leak between tests in the same file.

- [ ] **Step 4: Confirm existing tests still pass under jsdom**

Run: `pnpm --filter frontend test`
Expected: PASS — all existing `server/**/*.test.ts` files (node-only logic, no DOM) are unaffected by the `node` → `jsdom` environment change.

- [ ] **Step 5: Write the failing test for `Spinner`**

Create `apps/frontend/src/components/Spinner/Spinner.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Spinner } from "./Spinner";

describe("Spinner", () => {
  it("renders an accessible loading status", () => {
    render(<Spinner />);
    expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();
  });

  it("applies the spin animation class", () => {
    render(<Spinner />);
    expect(screen.getByRole("status")).toHaveClass("animate-spin");
  });

  it("merges an additional className", () => {
    render(<Spinner className="my-extra-class" />);
    expect(screen.getByRole("status")).toHaveClass("my-extra-class");
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `pnpm --filter frontend test -- Spinner`
Expected: FAIL with "Cannot find module './Spinner'" (or similar) — `Spinner.tsx` doesn't exist yet.

- [ ] **Step 7: Implement `Spinner`**

Create `apps/frontend/src/components/Spinner/Spinner.tsx`:

```tsx
export function Spinner({ className }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={[
        "inline-block size-[18px] animate-spin rounded-full border-2 border-violet-accent/30 border-t-violet-accent",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    />
  );
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `pnpm --filter frontend test -- Spinner`
Expected: PASS (3 tests)

- [ ] **Step 9: Commit**

```bash
git add apps/frontend/package.json apps/frontend/pnpm-lock.yaml apps/frontend/vitest.config.ts apps/frontend/vitest.setup.ts apps/frontend/src/components/Spinner
git commit -m "test: add jsdom/RTL test infra and Spinner component"
```

---

### Task 2: Design tokens + fonts

**Files:**
- Modify: `apps/frontend/src/app/globals.css`
- Modify: `apps/frontend/src/app/layout.tsx`

**Interfaces:**
- Produces: `--color-*`, `--radius-*`, `--blur-*`, `--font-sans`, `--font-mono` theme tokens usable by every later Tailwind class in this plan; `.bg-app-shell`, `.bg-gradient-primary`, `.text-gradient-balance`, `.glass-hero`, `.glass-row`, `.glass-input` utility classes.

This task is CSS/config only — no branching logic to unit-test. Verification is `typecheck` (catches `next/font` type errors) plus a manual visual check via the dev server. No test file is added here; per this plan's Global Constraints, this is the documented TDD exception.

Spacing note: the spec's page-padding (24px) / card-gap (10px) / section-gap (20px) values are exact matches for Tailwind's built-in `6` (1.5rem), `2.5` (0.625rem), and `5` (1.25rem) spacing steps — so no custom `--spacing-*` tokens are defined; later tasks use `px-6`, `gap-2.5`, `gap-5` directly. Radii (10/14/18/24/32px) don't match Tailwind's default radius scale, so those are real custom `--radius-*` tokens below.

- [ ] **Step 1: Replace the `@theme` block and add utility classes**

Replace `apps/frontend/src/app/globals.css` entirely:

```css
@import "tailwindcss";

@theme {
  --breakpoint-sm: 30rem;
  --width-app-max: 28rem;

  --color-ink: #0b0620;
  --color-violet-deep: #140a30;
  --color-violet-accent: #8b5cf6;
  --color-cyan-accent: #22d3ee;
  --color-lavender: #a78bfa;
  --color-sky-cyan: #67e8f9;
  --color-lilac: #c4b5fd;
  --color-danger: #fb7185;
  --color-text-primary: #f4f1fb;
  --color-text-secondary: rgb(244 241 251 / 0.55);
  --color-text-muted: rgb(244 241 251 / 0.45);

  --font-sans: var(--font-manrope);
  --font-mono: var(--font-space-mono);

  --radius-sm: 10px;
  --radius-md: 14px;
  --radius-lg: 18px;
  --radius-xl: 24px;
  --radius-shell: 32px;
}

.app-shell {
  max-width: var(--width-app-max);
  margin-inline: auto;
}

.bg-app-shell {
  background-image:
    radial-gradient(circle at 12% 8%, rgb(139 92 246 / 0.35), transparent 40%),
    radial-gradient(circle at 90% 85%, rgb(34 211 238 / 0.3), transparent 46%),
    linear-gradient(160deg, var(--color-ink), var(--color-violet-deep));
}

.bg-gradient-primary {
  background-image: linear-gradient(90deg, var(--color-violet-accent), var(--color-cyan-accent));
}

.text-gradient-balance {
  background-image: linear-gradient(90deg, var(--color-lavender), var(--color-sky-cyan));
  background-clip: text;
  color: transparent;
}

.glass-hero {
  background-color: rgb(255 255 255 / 0.07);
  border: 1px solid rgb(255 255 255 / 0.16);
  backdrop-filter: blur(18px);
  border-radius: var(--radius-xl);
}

.glass-row {
  background-color: rgb(255 255 255 / 0.06);
  border: 1px solid rgb(255 255 255 / 0.14);
  backdrop-filter: blur(12px);
  border-radius: var(--radius-lg);
}

.glass-input {
  background-color: rgb(255 255 255 / 0.06);
  border: 1px solid rgb(255 255 255 / 0.16);
  backdrop-filter: blur(10px);
  border-radius: var(--radius-md);
}
```

Note: `.app-shell` (max-width + centering) is unchanged from today — Task 7 moves its usage into the new `AppShell` component but keeps the class definition here.

- [ ] **Step 2: Load fonts in the root layout**

Modify `apps/frontend/src/app/layout.tsx` — add font loading, keep the existing `.app-shell` body usage as-is (Task 7 replaces it):

```tsx
import type { Metadata } from "next";
import { Manrope, Space_Mono } from "next/font/google";
import "./globals.css";

const manrope = Manrope({
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
  variable: "--font-manrope",
});

const spaceMono = Space_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-space-mono",
});

export const metadata: Metadata = {
  title: "Game Token Wallet",
  description: "Tokenize offline group games as on-chain SPL tokens.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${manrope.variable} ${spaceMono.variable}`}>
      <body className="app-shell min-h-screen px-4 font-sans text-text-primary">{children}</body>
    </html>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter frontend typecheck`
Expected: PASS (no errors) — confirms the `next/font/google` imports and new `@theme` tokens don't break the build.

- [ ] **Step 4: Manual visual check**

Run: `pnpm --filter frontend dev`, open `http://localhost:3000/`. Confirm: near-black background, body text renders in Manrope (not the system sans fallback), no Tailwind/PostCSS errors in the terminal.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/app/globals.css apps/frontend/src/app/layout.tsx
git commit -m "feat: add design tokens and Manrope/Space Mono fonts"
```

---

### Task 3: shadcn CLI init + `Button`

**Files:**
- Modify: `apps/frontend/package.json` (dependencies)
- Create: `apps/frontend/components.json`
- Create: `apps/frontend/src/lib/utils.ts`
- Create: `apps/frontend/src/components/ui/button.tsx`
- Test: `apps/frontend/src/components/ui/button.test.tsx`

**Interfaces:**
- Consumes: `Spinner` from `@/components/Spinner/Spinner` (Task 1).
- Produces: `Button` and `buttonVariants` exported from `@/components/ui/button`. `Button` props: `variant?: "primary" | "secondary" | "destructive"` (default `"primary"`), `asChild?: boolean`, `isLoading?: boolean`, plus all native `<button>` props. Consumed by Task 8.
- Produces: `cn(...inputs: ClassValue[]): string` exported from `@/lib/utils` — consumed by Tasks 4 and 5.

- [ ] **Step 1: Add shadcn's utility dependencies**

```bash
pnpm --filter frontend add class-variance-authority clsx tailwind-merge
```

- [ ] **Step 2: Initialize shadcn/ui**

From `apps/frontend/`, run:

```bash
npx shadcn@latest init
```

Answer the prompts: TypeScript — Yes (auto-detected); Style — New York; Base color — Neutral; CSS variables — Yes; confirm the detected Tailwind entry point is `src/app/globals.css` and the import alias is `@/*` (already set in `tsconfig.json`).

Verify afterward: `apps/frontend/components.json` exists, and `apps/frontend/src/lib/utils.ts` exports a `cn` helper (typically `clsx` + `twMerge`). If the CLI appended its own default color tokens (`--background`, `--foreground`, etc.) to `globals.css`, leave them — they're unused since every component in this plan references the app's own tokens from Task 2, and removing them isn't worth the diff noise.

- [ ] **Step 3: Generate the Button primitive**

```bash
npx shadcn@latest add button
```

Verify `apps/frontend/src/components/ui/button.tsx` was created, and check `apps/frontend/package.json` — if `@radix-ui/react-slot` wasn't added automatically, add it explicitly:

```bash
pnpm --filter frontend add @radix-ui/react-slot
```

- [ ] **Step 4: Write the failing test for the customized `Button`**

Create `apps/frontend/src/components/ui/button.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button } from "./button";

describe("Button", () => {
  it("defaults to the primary variant", () => {
    render(<Button>Go</Button>);
    expect(screen.getByRole("button", { name: "Go" })).toHaveClass("bg-gradient-primary");
  });

  it("applies the secondary variant class", () => {
    render(<Button variant="secondary">Go</Button>);
    expect(screen.getByRole("button", { name: "Go" })).toHaveClass("glass-input");
  });

  it("applies the destructive variant class", () => {
    render(<Button variant="destructive">Go</Button>);
    expect(screen.getByRole("button", { name: "Go" })).toHaveClass("bg-danger");
  });

  it("fires onClick when not loading", async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(<Button onClick={onClick}>Go</Button>);
    await user.click(screen.getByRole("button", { name: "Go" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("shows a spinner, disables the button, and blocks clicks while isLoading", async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(
      <Button onClick={onClick} isLoading>
        Go
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Go" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();

    await user.click(button, { skipPointerEventsCheck: true });
    expect(onClick).not.toHaveBeenCalled();
  });

  it("keeps the same rendered width while isLoading as while idle", () => {
    const { rerender, container } = render(<Button>Initialize registry</Button>);
    const idleWidth = container.querySelector("button")!.getBoundingClientRect().width;
    rerender(<Button isLoading>Initialize registry</Button>);
    const loadingWidth = container.querySelector("button")!.getBoundingClientRect().width;
    expect(loadingWidth).toBe(idleWidth);
  });
});
```

- [ ] **Step 5: Run it to verify it fails**

Run: `pnpm --filter frontend test -- button`
Expected: FAIL — shadcn's generated `button.tsx` has no `primary`/`secondary`/`destructive` variants and no `isLoading` prop yet.

- [ ] **Step 6: Customize `button.tsx`**

Replace the full contents of `apps/frontend/src/components/ui/button.tsx` (overwrite whatever the CLI scaffolded — this ticket's Button API is deliberately narrower than shadcn's stock output: no `size` variant, three custom color variants):

```tsx
import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";
import { Spinner } from "@/components/Spinner/Spinner";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md px-7 py-[15px] font-sans text-sm font-extrabold transition-colors outline-none disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        primary: "bg-gradient-primary text-ink hover:brightness-105",
        secondary: "glass-input text-text-primary hover:bg-white/10",
        destructive: "bg-danger text-ink hover:brightness-105",
      },
    },
    defaultVariants: {
      variant: "primary",
    },
  },
);

type ButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
    isLoading?: boolean;
  };

function Button({
  className,
  variant,
  asChild = false,
  isLoading = false,
  disabled,
  children,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot : "button";

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, className }), "relative")}
      disabled={disabled || isLoading}
      aria-busy={isLoading || undefined}
      {...props}
    >
      <span className={isLoading ? "invisible" : undefined}>{children}</span>
      {isLoading && (
        <span className="absolute inset-0 flex items-center justify-center">
          <Spinner />
        </span>
      )}
    </Comp>
  );
}

export { Button, buttonVariants };
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `pnpm --filter frontend test -- button`
Expected: PASS (6 tests)

- [ ] **Step 8: Lint and typecheck**

Run: `pnpm --filter frontend lint && pnpm --filter frontend typecheck`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add apps/frontend/package.json apps/frontend/pnpm-lock.yaml apps/frontend/components.json apps/frontend/src/lib apps/frontend/src/components/ui/button.tsx apps/frontend/src/components/ui/button.test.tsx
git commit -m "feat: init shadcn/ui and build the Button component"
```

---

### Task 4: `Input`

**Files:**
- Create: `apps/frontend/src/components/ui/input.tsx`
- Test: `apps/frontend/src/components/ui/input.test.tsx`

**Interfaces:**
- Consumes: `cn` from `@/lib/utils` (Task 3).
- Produces: `Input` exported from `@/components/ui/input`, forwarding all native `<input>` props (including `ref`).

- [ ] **Step 1: Generate the Input primitive**

```bash
npx shadcn@latest add input
```

Verify `apps/frontend/src/components/ui/input.tsx` was created and no new `@radix-ui/*` package was added to `package.json` (Input needs none).

- [ ] **Step 2: Write the failing test**

Create `apps/frontend/src/components/ui/input.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Input } from "./input";

describe("Input", () => {
  it("renders as a text input and accepts typed input", async () => {
    const user = userEvent.setup();
    render(<Input placeholder="Username" />);
    const input = screen.getByPlaceholderText("Username");
    await user.type(input, "alice");
    expect(input).toHaveValue("alice");
  });

  it("applies the glass surface styling", () => {
    render(<Input placeholder="Username" />);
    expect(screen.getByPlaceholderText("Username")).toHaveClass("glass-input");
  });

  it("forwards a ref to the underlying input element", () => {
    const ref = { current: null as HTMLInputElement | null };
    render(<Input ref={ref} placeholder="Username" />);
    expect(ref.current).toBeInstanceOf(HTMLInputElement);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm --filter frontend test -- input`
Expected: FAIL — shadcn's default input styling has no `glass-input` class.

- [ ] **Step 4: Customize `input.tsx`**

Replace the full contents of `apps/frontend/src/components/ui/input.tsx`:

```tsx
import * as React from "react";

import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "glass-input flex h-11 w-full min-w-0 px-4 py-2 text-sm text-text-primary outline-none transition-colors placeholder:text-text-muted disabled:cursor-not-allowed disabled:opacity-50",
        "focus-visible:border-lavender",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter frontend test -- input`
Expected: PASS (3 tests). If the `ref`-forwarding test fails to typecheck (`React.ComponentProps<"input">` not including `ref` in this TS/React version), add `ref` explicitly to the prop type: `React.ComponentProps<"input"> & { ref?: React.Ref<HTMLInputElement> }`.

- [ ] **Step 6: Lint and typecheck**

Run: `pnpm --filter frontend lint && pnpm --filter frontend typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/frontend/src/components/ui/input.tsx apps/frontend/src/components/ui/input.test.tsx
git commit -m "feat: build the Input component"
```

---

### Task 5: `Alert`

**Files:**
- Create: `apps/frontend/src/components/ui/alert.tsx`
- Test: `apps/frontend/src/components/ui/alert.test.tsx`

**Interfaces:**
- Consumes: `cn` from `@/lib/utils` (Task 3).
- Produces: `Alert` exported from `@/components/ui/alert`, props: `variant: "success" | "error"` (default `"success"`) plus native `<div>` props (including `data-testid`, `className`, `children`). Consumed by Task 8.

- [ ] **Step 1: Generate the Alert primitive**

```bash
npx shadcn@latest add alert
```

Verify `apps/frontend/src/components/ui/alert.tsx` was created.

- [ ] **Step 2: Write the failing test**

Create `apps/frontend/src/components/ui/alert.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Alert } from "./alert";

describe("Alert", () => {
  it("renders success content with the cyan success color", () => {
    render(<Alert variant="success">registry initialized, 0 active games</Alert>);
    const alert = screen.getByRole("status");
    expect(alert).toHaveTextContent("registry initialized, 0 active games");
    expect(alert).toHaveClass("text-cyan-accent");
  });

  it("renders error content with the danger color", () => {
    render(<Alert variant="error">Unknown error</Alert>);
    const alert = screen.getByRole("status");
    expect(alert).toHaveTextContent("Unknown error");
    expect(alert).toHaveClass("text-danger");
  });

  it("forwards data-testid", () => {
    render(
      <Alert variant="success" data-testid="registry-status">
        ok
      </Alert>,
    );
    expect(screen.getByTestId("registry-status")).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm --filter frontend test -- alert`
Expected: FAIL — shadcn's default `alert.tsx` has `default`/`destructive` variants, not `success`/`error`, and no `role="status"`.

- [ ] **Step 4: Customize `alert.tsx`**

Replace the full contents of `apps/frontend/src/components/ui/alert.tsx`:

```tsx
import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const alertVariants = cva("glass-row w-full px-4 py-3 text-sm font-semibold", {
  variants: {
    variant: {
      success: "text-cyan-accent",
      error: "text-danger",
    },
  },
  defaultVariants: {
    variant: "success",
  },
});

function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      role="status"
      className={cn(alertVariants({ variant, className }))}
      {...props}
    />
  );
}

export { Alert, alertVariants };
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter frontend test -- alert`
Expected: PASS (3 tests)

- [ ] **Step 6: Lint and typecheck**

Run: `pnpm --filter frontend lint && pnpm --filter frontend typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/frontend/src/components/ui/alert.tsx apps/frontend/src/components/ui/alert.test.tsx
git commit -m "feat: build the Alert component"
```

---

### Task 6: `PageLoader`

**Files:**
- Create: `apps/frontend/public/chip-icon.svg` (copied asset)
- Modify: `apps/frontend/src/app/globals.css`
- Create: `apps/frontend/src/components/PageLoader/PageLoader.tsx`
- Test: `apps/frontend/src/components/PageLoader/PageLoader.test.tsx`

**Interfaces:**
- Produces: `PageLoader(): JSX.Element` exported from `@/components/PageLoader/PageLoader` — full-page, no props. Not consumed elsewhere in this ticket; available for later tickets' full-page loading states.

- [ ] **Step 1: Copy the chip icon asset**

```bash
cp "docs/technical-related/ui-design/004-ui-sample/chip-icon.svg" apps/frontend/public/chip-icon.svg
```

- [ ] **Step 2: Add the flip-animation keyframes**

Append to `apps/frontend/src/app/globals.css` (after the existing `.glass-input` rule):

```css
@keyframes chip-flip {
  from {
    transform: rotateY(0deg);
  }
  to {
    transform: rotateY(360deg);
  }
}

.animate-chip-flip {
  animation: chip-flip 1.2s linear infinite;
  transform-style: preserve-3d;
}
```

- [ ] **Step 3: Write the failing test**

Create `apps/frontend/src/components/PageLoader/PageLoader.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PageLoader } from "./PageLoader";

describe("PageLoader", () => {
  it("renders an accessible loading status", () => {
    render(<PageLoader />);
    expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();
  });

  it("renders the chip icon with the flip animation class", () => {
    render(<PageLoader />);
    const icon = screen.getByRole("status").querySelector("img");
    expect(icon).toHaveAttribute("src", "/chip-icon.svg");
    expect(icon).toHaveClass("animate-chip-flip");
  });
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `pnpm --filter frontend test -- PageLoader`
Expected: FAIL — `PageLoader.tsx` doesn't exist yet.

- [ ] **Step 5: Implement `PageLoader`**

Create `apps/frontend/src/components/PageLoader/PageLoader.tsx`:

```tsx
export function PageLoader() {
  return (
    <div
      role="status"
      aria-label="Loading"
      className="bg-app-shell fixed inset-0 z-50 flex items-center justify-center"
      style={{ perspective: "600px" }}
    >
      <img
        src="/chip-icon.svg"
        alt=""
        width={64}
        height={64}
        className="animate-chip-flip"
        style={{ filter: "saturate(1.6) hue-rotate(220deg) brightness(1.3)" }}
      />
    </div>
  );
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter frontend test -- PageLoader`
Expected: PASS (2 tests)

- [ ] **Step 7: Lint and typecheck**

Run: `pnpm --filter frontend lint && pnpm --filter frontend typecheck`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add apps/frontend/public/chip-icon.svg apps/frontend/src/app/globals.css apps/frontend/src/components/PageLoader
git commit -m "feat: build the PageLoader component"
```

---

### Task 7: `AppShell` + route groups

**Files:**
- Create: `apps/frontend/src/components/AppShell/AppShell.tsx`
- Test: `apps/frontend/src/components/AppShell/AppShell.test.tsx`
- Create: `apps/frontend/src/app/(auth)/layout.tsx`
- Create: `apps/frontend/src/app/(app)/layout.tsx`
- Modify: `apps/frontend/src/app/layout.tsx`

**Interfaces:**
- Produces: `AppShell({ children }: { children: React.ReactNode }): JSX.Element` exported from `@/components/AppShell/AppShell`. Consumed by root `layout.tsx` only.

- [ ] **Step 1: Write the failing test for `AppShell`**

Create `apps/frontend/src/components/AppShell/AppShell.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AppShell } from "./AppShell";

describe("AppShell", () => {
  it("renders its children", () => {
    render(
      <AppShell>
        <p>content</p>
      </AppShell>,
    );
    expect(screen.getByText("content")).toBeInTheDocument();
  });

  it("applies the gradient background and mobile-first shell classes", () => {
    const { container } = render(<AppShell>child</AppShell>);
    expect(container.querySelector(".bg-app-shell")).not.toBeNull();
    expect(container.querySelector(".app-shell")).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter frontend test -- AppShell`
Expected: FAIL — `AppShell.tsx` doesn't exist yet.

- [ ] **Step 3: Implement `AppShell`**

Create `apps/frontend/src/components/AppShell/AppShell.tsx`:

```tsx
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-app-shell min-h-screen">
      <div className="app-shell min-h-screen px-6">{children}</div>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter frontend test -- AppShell`
Expected: PASS (2 tests)

- [ ] **Step 5: Scaffold the `(auth)` and `(app)` route groups**

Create `apps/frontend/src/app/(auth)/layout.tsx`:

```tsx
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return children;
}
```

Create `apps/frontend/src/app/(app)/layout.tsx`:

```tsx
export default function AppGroupLayout({ children }: { children: React.ReactNode }) {
  return children;
}
```

Both are deliberate pass-throughs — no chrome yet (nav/tab bar is out of scope per the ticket); ticket 003 populates `(auth)` with pages, later tickets populate `(app)`.

- [ ] **Step 6: Wire `AppShell` into the root layout**

Modify `apps/frontend/src/app/layout.tsx`:

```tsx
import type { Metadata } from "next";
import { Manrope, Space_Mono } from "next/font/google";
import { AppShell } from "@/components/AppShell/AppShell";
import "./globals.css";

const manrope = Manrope({
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
  variable: "--font-manrope",
});

const spaceMono = Space_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-space-mono",
});

export const metadata: Metadata = {
  title: "Game Token Wallet",
  description: "Tokenize offline group games as on-chain SPL tokens.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${manrope.variable} ${spaceMono.variable}`}>
      <body className="min-h-screen font-sans text-text-primary">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
```

Note `.app-shell`'s `px-4` is gone from `<body>` — it now lives inside `AppShell` as `px-6` (Task 2's spacing-token equivalence).

- [ ] **Step 7: Run the full frontend test suite**

Run: `pnpm --filter frontend test`
Expected: PASS — no regressions from the layout change.

- [ ] **Step 8: Lint and typecheck**

Run: `pnpm --filter frontend lint && pnpm --filter frontend typecheck`
Expected: PASS

- [ ] **Step 9: Manual visual check**

Run: `pnpm --filter frontend dev`, open `http://localhost:3000/` and `http://localhost:3000/admin/registry`. Confirm both are still centered at mobile width with the gradient background, and confirm the empty route groups didn't break the Next.js dev server (no route-group-related build error in the terminal).

- [ ] **Step 10: Commit**

```bash
git add apps/frontend/src/components/AppShell "apps/frontend/src/app/(auth)" "apps/frontend/src/app/(app)" apps/frontend/src/app/layout.tsx
git commit -m "feat: add AppShell and scaffold (auth)/(app) route groups"
```

---

### Task 8: Admin registry retrofit

**Files:**
- Modify: `apps/frontend/src/app/admin/registry/page.tsx`
- Create: `apps/frontend/src/app/admin/registry/page.test.tsx`

**Interfaces:**
- Consumes: `Button` from `@/components/ui/button` (Task 3), `Alert` from `@/components/ui/alert` (Task 5), `initializeRegistry` from `@/server/actions/registry` (existing).

- [ ] **Step 1: Write a characterization test against the current page**

Create `apps/frontend/src/app/admin/registry/page.test.tsx`. This test asserts the page's *external contract* (button name, `data-testid`s, exact success/error text) — it should pass against both the pre-retrofit and post-retrofit implementation, proving the retrofit doesn't change behavior:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { mockInitializeRegistry } = vi.hoisted(() => ({
  mockInitializeRegistry: vi.fn(),
}));
vi.mock("@/server/actions/registry", () => ({
  initializeRegistry: mockInitializeRegistry,
}));

import AdminRegistryPage from "./page";

describe("AdminRegistryPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the success alert with the exact registry status text", async () => {
    mockInitializeRegistry.mockResolvedValue({ activeGameCount: 0 });
    const user = userEvent.setup();
    render(<AdminRegistryPage />);

    await user.click(screen.getByRole("button", { name: "Initialize registry" }));

    const status = await screen.findByTestId("registry-status");
    expect(status).toHaveTextContent("registry initialized, 0 active games");
  });

  it("shows the error alert when the action rejects", async () => {
    mockInitializeRegistry.mockRejectedValue(new Error("boom"));
    const user = userEvent.setup();
    render(<AdminRegistryPage />);

    await user.click(screen.getByRole("button", { name: "Initialize registry" }));

    const error = await screen.findByTestId("registry-error");
    expect(error).toHaveTextContent("boom");
  });
});
```

- [ ] **Step 2: Run it to verify it passes against the current implementation**

Run: `pnpm --filter frontend test -- admin/registry/page`
Expected: PASS (2 tests) — the pre-retrofit raw-Tailwind page already satisfies this contract. This confirms the test is a valid safety net before changing the markup underneath it.

- [ ] **Step 3: Retrofit the page**

Replace the full contents of `apps/frontend/src/app/admin/registry/page.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { initializeRegistry } from "@/server/actions/registry";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";

export default function AdminRegistryPage() {
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await initializeRegistry();
        setStatus(`registry initialized, ${result.activeGameCount} active games`);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      }
    });
  }

  return (
    <main className="flex flex-col gap-5 py-8">
      <h1 className="text-xl font-extrabold text-text-primary">Registry admin</h1>
      <Button type="button" variant="primary" onClick={handleClick} isLoading={isPending}>
        Initialize registry
      </Button>
      {status && (
        <Alert data-testid="registry-status" variant="success" className="break-all">
          {status}
        </Alert>
      )}
      {error && (
        <Alert data-testid="registry-error" variant="error" className="break-all">
          {error}
        </Alert>
      )}
    </main>
  );
}
```

- [ ] **Step 4: Run the test again to verify it still passes**

Run: `pnpm --filter frontend test -- admin/registry/page`
Expected: PASS (2 tests) — same contract, new implementation.

- [ ] **Step 5: Run the full frontend test suite**

Run: `pnpm --filter frontend test`
Expected: PASS

- [ ] **Step 6: Lint and typecheck**

Run: `pnpm --filter frontend lint && pnpm --filter frontend typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/frontend/src/app/admin/registry
git commit -m "refactor: retrofit admin registry page onto Button/Alert components"
```

---

### Task 9: Full verification (Done Means)

No new files — this task boots the real system and checks the acceptance criteria per this repo's Done-Means rule, including the one part of the ticket no unit test can verify: the existing Playwright e2e spec against the live app.

- [ ] **Step 1: Full frontend check**

```bash
pnpm --filter frontend lint
pnpm --filter frontend typecheck
pnpm --filter frontend test
```

Expected: all PASS. If `pnpm --filter frontend lint` (or root `pnpm lint`) fails with unrelated flat-repo errors (e.g. flagging `apps/on-chain-client/scripts/generate-client.mjs`), that's the known local `rtk` hook rewrite gotcha (see `CLAUDE.local.md`) — rerun with `rtk proxy pnpm lint` to get the real result before treating it as a regression.

- [ ] **Step 2: Visual check against the design system**

Run: `pnpm --filter frontend dev`, open `http://localhost:3000/admin/registry` in a browser. Confirm, side-by-side with [002-design-system.html](../../technical-related/ui-design/002-design-system.html):
- Dark ink (`#0b0620`) background with the two-orb radial gradient
- Manrope renders for headings/buttons, extrabold weight on the primary button label
- Primary button shows the violet→cyan gradient
- Clicking the button: button stays the same size, label is hidden, a spinning ring appears centered on it, button is unclickable
- On success: a glass-surfaced status line in cyan appears with `registry initialized, 0 active games`

- [ ] **Step 3: Full stack + e2e verification**

```bash
just test
```

Expected: PASS, including `apps/e2e/tests/admin-registry.spec.ts` and `apps/e2e/tests/noop.spec.ts` running unmodified against the `docker-compose.e2e.yml` stack — this is the concrete proof that the retrofit preserved behavior end-to-end, not just under mocks.

- [ ] **Step 4: Confirm ticket checklist**

Re-read [017-frontend-design-foundation.md](../../tickets/017-frontend-design-foundation.md) top to bottom; confirm every checkbox item is satisfied by a task above (shadcn init, tokens, Button/Input/Alert/Loading, route groups, shell, admin retrofit, deferred-scope list unchanged). Mark the ticket's `Status` as `Done` and check off its items.

- [ ] **Step 5: Commit the ticket status update**

```bash
git add docs/tickets/017-frontend-design-foundation.md
git commit -m "docs: mark ticket 017 done"
```

---

## Self-review

**1. Spec coverage:**
- shadcn CLI init + flagged deps (`class-variance-authority`, `clsx`, `tailwind-merge`, `@radix-ui/react-slot`, testing-library set) → Tasks 1, 3.
- Design tokens in `globals.css` `@theme`, replacing the placeholder → Task 2.
- `Button`/`Input`/`Alert`/`Loading` component set, colocated tests → Tasks 1, 3, 4, 5, 6.
- `(auth)`/`(app)` route groups → Task 7.
- Shared layout shell, token-driven, formalizing the mobile-first/desktop-capped-width behavior into a component (wraps and internally reuses `.app-shell` rather than eliminating it — see Task 2's step 1 note and the spec's "Route groups & shell" section) → Task 7.
- Admin registry retrofit, e2e coverage unmodified → Task 8, verified in Task 9.
- Out-of-scope list (Modal/Select/Badge/Nav/Card) → untouched, no task builds them.
- Every grill-session decision (Q1–Q10 in the spec) maps to a concrete task above — route placement (Q1) and shell placement (Q2) → Task 7; test infra (Q3) → Task 1; Button shape (Q4, Q10) → Task 3; fonts (Q5) → Task 2; success color (Q6) → Tasks 2/5; Loading split (Q7) → Tasks 1/6; Input/Alert via shadcn (Q9) → Tasks 4/5.

**2. Placeholder scan:** No TBD/TODO markers; every code step has complete, runnable file contents; every test has real assertions, not "add tests for the above."

**3. Type consistency:** `Button`'s `variant` union (`"primary" | "secondary" | "destructive"`) is identical in Task 3's implementation and every consumer (Task 8's `variant="primary"`). `Alert`'s `variant` union (`"success" | "error"`) is identical in Task 5 and Task 8. `Spinner`'s single prop (`className?: string`) matches its one call site inside `Button` (Task 3, no className passed — uses the default). `cn` is defined once (Task 3) and imported with the same signature in Tasks 4 and 5.

**4. Path fidelity (spec vs. plan file paths):** Every `Create`/`Modify` path in this plan's tasks was diffed against the spec's stated paths after an `/enhanced-review` pass caught three mismatches (custom `--spacing-*` tokens vs. Tailwind built-ins, `.app-shell` "replaces" vs. "wraps and reuses" wording, `components/Loading/` vs. sibling `components/Spinner/`+`components/PageLoader/` folders) — all three were reconciled by amending the spec to match this plan's actual implementation (2026-07-23). No remaining path disagreements between the two documents.

---

**Plan complete and saved to `docs/superpowers/plans/2026-07-23-frontend-design-foundation.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
