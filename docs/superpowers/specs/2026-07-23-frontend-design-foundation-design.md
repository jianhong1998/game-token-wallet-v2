# 017 — Frontend design foundation — Design

Spec for [docs/tickets/017-frontend-design-foundation.md](../../tickets/017-frontend-design-foundation.md).
Blocked by ticket 001 (done); blocks ticket 003. Builds on the decisions
already recorded in
[003-frontend-foundation-decisions.md](../../technical-related/ui-design/003-frontend-foundation-decisions.md)
(scope, shadcn choice, retrofit-in-scope) — this doc resolves what that
session left open (concrete token values, route-group placement, testing
infra, component API shape) and lays out the implementation.

Design tokens are sourced from
[002-design-system.html](../../technical-related/ui-design/002-design-system.html),
which is now populated (the "Kitty — Glass Vault" dark glass theme — purple/cyan
gradients on near-black, Manrope + Space Mono type, heavy glassmorphism). The
linked live design artifact was not needed as a fallback.

---

## Grill session — decisions

### Q10: Does shadcn's Button pull in a Radix dependency after all?

**Answer:** Yes, one small one — `@radix-ui/react-slot`, kept.

**Decision:** shadcn's default `button.tsx` uses Radix's `Slot` to support the
`asChild` prop (render Button's styles onto another element, e.g. a `Link`).
This contradicts the earlier "no radix needed" framing in this doc and the
`003-frontend-foundation-decisions.md` session — corrected here.
`asChild`/`@radix-ui/react-slot` is kept as generated: no current consumer
needs it, but ticket 003's login↔register flow plausibly wants a link styled
as a button, and it's a ~1KB composition primitive, not a heavyweight
component. `Input` and `Alert` genuinely pull in no Radix packages.

**Reason:** Matches shadcn's own default output with zero extra customization
there; stripping `asChild` now to save one small dependency, only to add it
back the moment ticket 003 needs it, isn't worth the churn.

### Q1: Where do `admin/registry` and the home `page.tsx` (noop demo) sit relative to the new `(auth)`/`(app)` route groups?

**Answer:** Both stay top-level, unmoved.

**Decision:** `(auth)` and `(app)` are scaffolded as new, currently-empty route
groups under `apps/frontend/src/app/`, ready for ticket 003 (register/login →
`(auth)`) and later game-flow tickets (→ `(app)`) to populate. `admin/registry`
(operator tooling, precedent already set by ticket 002's own design doc Q4:
"sibling to the `(auth)`/`(app)` route groups") and `/` (temporary connection-
plumbing demo, not a real product page) are not moved into either group — they
still get the component/token retrofit, just no route-tree change.

**Reason:** Neither page is a real auth-flow or in-app-user page. Moving them
would be structural churn with no behavioral payoff, and would contradict the
precedent ticket 002 already set for admin tooling.

### Q2: Does the shared layout shell apply at root `layout.tsx` (global) or per-route-group?

**Answer:** Root, global.

**Decision:** `AppShell` (mobile-first, desktop-capped-to-28rem-with-margins)
replaces the current hardcoded `.app-shell` CSS class and wraps `{children}`
once in `app/layout.tsx`. The `(auth)` and `(app)` group layouts are thin
pass-throughs for now (no group-specific chrome yet — nav/tab bar is
explicitly out of scope per the ticket's deferred list).

**Reason:** Every current and near-future route (admin, home, auth, app) wants
the same shell; group-specific chrome can be layered on top later without
touching the shell itself.

### Q3: Testing infra — how does colocated `Component.test.tsx` work today?

**Answer:** It doesn't yet; both deps and config are missing.

**Decision:** Add `@testing-library/react`, `@testing-library/jest-dom`,
`@testing-library/user-event`, and `jsdom` as devDependencies (flagged, on top
of the shadcn-related deps the ticket already calls out). Change
`vitest.config.ts`: `environment: "node"` → `"jsdom"`, `include:
["src/**/*.test.ts"]` → `["src/**/*.test.{ts,tsx}"]`. One shared config, not
split node/jsdom projects — jsdom is a superset for the existing server-side
`.test.ts` files (they don't touch the DOM), so nothing regresses.

**Reason:** The ticket requires colocated component tests per the
codebase-structure doc; the current config can't run them at all.

### Q4: How many `Button` variants, and what's the component's shape?

**Answer:** 3 variants (`primary`, `secondary`, `destructive`) on a single
component, extending shadcn's generated `button.tsx` directly.

**Decision:** The design system defines 5 variants; only 3 have a concrete
near-term consumer (admin registry's primary action; ticket 003's submit +
login/register toggle). `tinted-outline` and `ghost-destructive` are deferred
— adding a `cva` variant later is a one-line addition, not a redesign.
Architecturally: a single `Button` component (shadcn's copied-in
`components/ui/button.tsx`, `cva`-driven), not a `BaseButton` +
`PrimaryButton`/`SecondaryButton`/`DangerButton` split. Shadcn's copy-in model
means the generated file is already fully-owned app code, not
managed/protected output — customizing its `buttonVariants` `cva` config
directly (adding `primary`/`secondary`/`destructive`) and adding the
`isLoading` behavior in that same component is the idiomatic shadcn workflow,
and keeps Button consistent with every other shadcn component this app will
pull in later (Select, Dialog, etc. — all single-component-plus-`variant`).

**Reason:** A behavior/style split is the right instinct, but expressing it as
4 components (3 of which are pure single-prop presets with no independent
logic) costs more (4 files + 4 colocated test files, an odd-one-out pattern
next to every future shadcn component, conditional-component-swapping at call
sites when a variant needs to be dynamic) than a `variant` prop, for the same
capability.

### Q5: Fonts — `next/font/google` or raw `<link>` tags?

**Answer:** `next/font/google`.

**Decision:** Self-hosted at build time via `next/font/google`, loading
Manrope (weights 500/600/700/800) and Space Mono (weights 400/700) as CSS
variables wired into the `@theme` block's `--font-*` tokens.

**Reason:** No runtime request to Google Fonts — matters for this app's
self-hosted, config-at-runtime deployment model (no baked-in external network
dependency). Idiomatic for Next.js App Router; avoids CLS/flash the raw
`<link>` approach (fine for a static prototype, not for the product) would
have.

### Q6: What color represents "success" — the palette has no green?

**Answer:** Cyan accent (`#22d3ee`).

**Decision:** `Alert`'s success variant and any other positive/confirmation
UI use `--color-cyan-accent`. Error stays `--color-danger` (`#fb7185`,
already defined as "danger / burn" in the palette).

**Reason:** Cyan is already used as a positive/affirmative color in the
palette (second stop of the primary gradient, the "balance text" gradient) —
reads as affirmative against the dark background without introducing a color
outside the established system.

### Q7: What does `Loading` look like — no visual spec exists in the design system?

**Answer:** Two pieces: an inline `Spinner` for button-pending states, a
full-page `PageLoader` using the chip icon.

**Decision:**
- **`Spinner`** — small (~18px) CSS ring (`animate-spin`, `--color-violet-accent`
  stroke), no icon library. Used internally by `Button`'s `isLoading` prop and
  exported standalone.
- **`PageLoader`** — full-page, centered `chip-icon.svg` (copied from
  `docs/technical-related/ui-design/004-ui-sample/chip-icon.svg` into
  `apps/frontend/public/`), animated as a continuous 3D flip on the Y-axis
  (`perspective` wrapper + `rotateY` keyframe loop), CSS-filter-tinted
  violet/cyan per the design system's iconography note (`saturate(1.6)
  hue-rotate(220deg) brightness(1.3)` — the same filter the design system
  applies to the same glyph).

**Reason:** Matches the design system's explicit "no custom icons besides the
chip glyph" rule (iconography section) — reusing that exact asset for the
full-page state, plain CSS for the inline spinner, no new icon library
dependency.

### Q8 (folded into Q4): `Button`'s `isLoading` behavior

**Decision:** When `isLoading` is true: the button's children stay in the DOM
(sized normally) but are visually hidden (`invisible`), a `Spinner` is
absolutely centered over them, and the button is forced `disabled` +
`aria-busy="true"`. Button width/height don't shift, and a double-click during
a pending action is structurally prevented (not just discouraged).

### Q9: Does the "shadcn/Radix primitives where applicable" pattern extend to `Input` and `Alert`, or just `Button`?

**Answer:** Extends to both.

**Decision:** `Input` and `Alert` are generated via the shadcn CLI
(`components/ui/input.tsx`, `components/ui/alert.tsx`) and customized in
place, identically to `Button` (Q4) — not hand-rolled at `components/Input/`
/ `components/Alert/` as an earlier draft of this doc had them. `Loading`
(`Spinner`/`PageLoader`) stays hand-rolled — shadcn's registry has no
spinner/loader equivalent, which is the actual "where applicable" carve-out.

**Reason:** shadcn ships `input` and `alert` primitives with no Radix
dependency, same as `button` — there's no reason to treat them differently
once the "edit the copied-in file directly" pattern was settled for `Button`.
Keeps all three consistent and matches the ticket's literal wording.

---

## Design

### Dependencies (flagged, `pnpm add`, not silently added)

- `class-variance-authority`, `clsx`, `tailwind-merge` (ticket-specified, shadcn utils)
- `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event`, `jsdom` (devDependencies, test infra)
- shadcn CLI itself is a one-time `npx shadcn@latest init` / `add` — not a persisted dependency
- `@radix-ui/react-slot` (pulled in by `npx shadcn add button`): shadcn's default `button.tsx` uses Radix's `Slot` to support the `asChild` prop (render the button's styling onto another element, e.g. a `Link`). Kept — likely needed by ticket 003's login/register link-as-button pattern, and it's a small composition primitive, not a full component. `Input`/`Alert` pull in no Radix packages.
- No new dependency for fonts (`next/font/google` ships with Next.js)

### Design tokens (`apps/frontend/src/app/globals.css`, `@theme` block)

Replaces the current placeholder (`--breakpoint-sm`, `--width-app-max` only) —
both are kept as-is, everything else is new:

```css
@theme {
  /* existing, unchanged */
  --breakpoint-sm: 30rem;
  --width-app-max: 28rem;

  /* colors */
  --color-ink: #0b0620;              /* base background */
  --color-violet-deep: #140a30;
  --color-violet-accent: #8b5cf6;
  --color-cyan-accent: #22d3ee;      /* also: success */
  --color-lavender: #a78bfa;
  --color-sky-cyan: #67e8f9;
  --color-lilac: #c4b5fd;
  --color-danger: #fb7185;           /* error */
  --color-text-primary: #f4f1fb;
  --color-text-secondary: rgb(244 241 251 / 0.55);
  --color-text-muted: rgb(244 241 251 / 0.45);

  /* fonts (CSS vars populated by next/font/google in layout.tsx) */
  --font-sans: var(--font-manrope);
  --font-mono: var(--font-space-mono);

  /* radii */
  --radius-sm: 10px;
  --radius-md: 14px;
  --radius-lg: 18px;
  --radius-xl: 24px;
  --radius-shell: 32px;

  /* blur */
  --blur-input: 10px;
  --blur-list: 12px;
  --blur-hero: 18px;
}
```

Spacing (page padding 24px, card gap 10px, section gap 20px) is deliberately
**not** a set of custom `@theme` tokens — all three values land exactly on
Tailwind's built-in spacing scale (`px-6` = 1.5rem/24px, `gap-2.5` =
0.625rem/10px, `gap-5` = 1.25rem/20px), so components use those utilities
directly rather than defining redundant custom vars that would just duplicate
the built-in scale under new names.

Type scale (size only — weight applied per-component via Tailwind's
`font-{weight}` utilities against the loaded Manrope weights, since `@theme
--text-*` doesn't carry weight): title 30px/800, section 18px/800, label
14px/700, body 13px/600, eyebrow 11px/700 uppercase tracked, balance 26px/700
mono, numeric 12.5px/600 mono.

Compound glass-surface and gradient styles (background+border+blur combos,
which don't express cleanly as single `@theme` vars) are utility classes layered
on the tokens above, in `globals.css` below the `@theme` block:
`.glass-hero`, `.glass-row`, `.glass-input`, `.bg-gradient-primary`,
`.text-gradient-balance`, `.bg-app-shell`.

### Fonts (`apps/frontend/src/app/layout.tsx`)

```ts
import { Manrope, Space_Mono } from "next/font/google";

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
```
Applied as `className` on `<html>` (or `<body>`), exposing the CSS vars the
`@theme` block references above.

### Route groups & shell

- `apps/frontend/src/app/(auth)/layout.tsx` and `apps/frontend/src/app/(app)/layout.tsx`: new, both thin pass-throughs (`return children`) — no chrome yet, just scaffolding for ticket 003+.
- `apps/frontend/src/components/AppShell/AppShell.tsx` (+ colocated test): wraps and internally reuses the existing `.app-shell` CSS class (max-width `var(--width-app-max)`, centered) rather than eliminating it — `.app-shell`'s max-width already reads from a token today, and Tailwind v4's `--width-*` theme namespace doesn't auto-generate a `max-w-*` utility (only `--max-width-*` does), so re-deriving the same rule as inline utility classes would need a token rename for no behavioral gain. `AppShell` is the sole intended consumer of `.app-shell` going forward; adds `px-6` page padding and the `.bg-app-shell` gradient background token.
- `app/layout.tsx`: wraps `{children}` in `<AppShell>` once, globally — every route (admin, home, auth, app) gets it.

### Component set (`apps/frontend/src/components/`)

**`Button`** (`components/ui/button.tsx`, shadcn-generated then customized in place):
- `cva` variants: `primary` (gradient `bg-gradient-primary`, ink text, extrabold), `secondary` (glass — `.glass-input`-style surface, primary text), `destructive` (`--color-danger` background, ink text).
- New `isLoading?: boolean` prop: renders `<Spinner>` absolutely centered, hides (not removes) children via `invisible`, forces `disabled` + `aria-busy="true"`.
- Test coverage: each variant renders its class; `isLoading` disables the button, shows the spinner, and preserves rendered width (snapshot/computed-style check) — plus one interaction test (click fires `onClick` when not loading, does not fire while loading).

**`Input`** (`components/ui/input.tsx`, shadcn-generated then customized in place — same pattern as `Button`): single glass-styled variant (`--radius-md`, `--blur-input`), forwards all native `<input>` props + `ref`. No visual error state in this ticket (errors surface via `Alert`); `aria-invalid` passthrough is free but unstyled.

**`Alert`** (`components/ui/alert.tsx`, shadcn-generated then customized in place): `variant: "success" | "error"` (`--color-cyan-accent` / `--color-danger`), glass surface, text-only (no icons).

**`Loading`** — two sibling components (not nested under a shared `Loading/`
folder — every other hand-rolled component in this ticket gets its own
eponymous folder, e.g. `AppShell/AppShell.tsx`, and these follow the same
convention):
- `components/Spinner/Spinner.tsx`: ~18px CSS ring, `animate-spin`, `--color-violet-accent` stroke.
- `components/PageLoader/PageLoader.tsx`: full-page, `public/chip-icon.svg` centered, `perspective` wrapper + `rotateY` keyframe animation (continuous), CSS `filter: saturate(1.6) hue-rotate(220deg) brightness(1.3)`.

Each component gets a colocated `Component.test.tsx` per the codebase-structure convention, using the new `@testing-library/react` + `jsdom` setup: render + accessible-role/text assertions, variant-class assertions, and (for `Button`) the loading-state behavior above.

### Admin registry retrofit (`apps/frontend/src/app/admin/registry/page.tsx`)

- Raw `<button className="bg-blue-600 ...">` → `<Button variant="primary" isLoading={isPending}>Initialize registry</Button>`.
- Raw `<p className="text-green-700">` / `<p className="text-red-700">` → `<Alert variant="success">` / `<Alert variant="error">`, keeping `data-testid="registry-status"` / `data-testid="registry-error"` and the exact success text (`"registry initialized, {N} active games"`) unchanged.
- Behavioral note: the button's label no longer changes to "Initializing…" text during the pending state — the spinner replaces it instead (per `isLoading`), while the accessible name stays "Initialize registry". This doesn't affect `apps/e2e/tests/admin-registry.spec.ts`, which clicks once and only asserts on `registry-status`/text, never re-reads button text mid-pending.

### Out of scope (unchanged from the ticket)

`Modal`/`Dialog`, `Select`/`Combobox`/`Dropdown`, `Badge`, `Nav`/tab bar, `Card` — deferred to whichever ticket first needs each. Home page (`app/page.tsx`) content/behavior is untouched beyond the Button/Alert retrofit if it shares the same raw-Tailwind pattern (it does — same `bg-blue-600`/`text-green-700`/`text-red-700` shape as the pre-retrofit admin page); no new route-tree placement for it.

### Testing

- `vitest.config.ts`: `environment: "jsdom"`, `include: ["src/**/*.test.{ts,tsx}"]`.
- Colocated component tests as described above for `Button`, `Input`, `Alert`, `Spinner`, `PageLoader`, `AppShell`.
- `apps/e2e/tests/admin-registry.spec.ts`: unmodified, must still pass — proves the retrofit preserved behavior.
- Manual verification: boot the dev server, visually confirm tokens/typography/glass surfaces render per the design system, exercise the admin registry page's click → pending-spinner → success/error path, confirm `pnpm lint`/`pnpm typecheck`/`pnpm test` all pass, per this repo's Done-Means rule.

---

## Self-review

- No placeholders/TBDs remain — token values, component variants, route
  placement, and testing config are all concrete.
- Internally consistent: Q1 (admin/home stay top-level) and Q2 (shell applies
  at root) reinforce each other — both pages need the shell without needing a
  route group.
- Scope: matches the ticket's explicit in/out-of-scope split exactly (tokens +
  Button/Input/Alert/Loading + route groups + shell + registry retrofit;
  Modal/Select/Badge/Nav/Card deferred). Does not reach into ticket 003's
  actual auth pages/logic.
- No requirement reads two ways: "Loading/spinner" from the ticket text is
  explicitly split into its two concrete forms (inline `Spinner`, full-page
  `PageLoader`) per the user's stated behavior, removing the ambiguity an
  unspecified single "Loading" component would have left.
