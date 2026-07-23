# Frontend Design Foundation — Decisions

Decision record from the `/grill-me` session that produced ticket
[017-frontend-design-foundation.md](../../tickets/017-frontend-design-foundation.md).
Triggered by a survey of [000-index.md](../../tickets/000-index.md) showing
14 of 16 tickets carry frontend/UI page work with no shared component
foundation yet in `apps/frontend`.

---

## Q1: Does ticket 002's admin registry page get retrofitted onto the new foundation, or left as-is?

**Answer:** Retrofitted, in scope of ticket 017.

**Decision:** `apps/frontend/src/app/admin/registry/page.tsx` is rebuilt on
the new `Button`/`Alert` components and tokens as part of 017's checklist.

**Reason:** It's the one page that predates the foundation and currently
hand-rolls raw Tailwind classes (`bg-blue-600`, `text-green-700`,
`text-red-700`). The page is small (one button, one status line, one error
line) so the retrofit cost is trivial, and leaving it inconsistent would
undermine the whole point of having a foundation — every later ticket would
have one page that looks different for no reason.

---

## Q2: What's in scope for "foundation" — tokens only, or also components and layout?

**Answer:** All three, with an explicit deferred list.

**Decision:** In scope: design tokens (`@theme` block in `globals.css`);
a core component set — `Button`, `Input`, `Alert` (success/error), `Loading`;
`(auth)`/`(app)` route-group scaffolding; a shared layout shell formalizing
the mobile-first/desktop-capped-width behavior. Deliberately out of scope,
deferred to whichever ticket first needs each: `Modal`/`Dialog`,
`Select`/`Combobox`/`Dropdown`, `Badge`, `Nav`/tab bar, `Card`.

**Reason:** Building components with no current consumer is speculative
scaffolding — e.g. a tab bar isn't needed until there's more than one page to
navigate between. Scoping to what tickets 002/003 actually need keeps 017
from ballooning into designing the whole app's component library up front.

---

## Q3: Hand-rolled Tailwind components, or a headless library base?

**Answer:** shadcn/ui (Radix UI primitives) + `class-variance-authority` +
`clsx`/`tailwind-merge`.

**Decision:** New dependencies, flagged per CLAUDE.md's "don't install
without flagging" rule: `class-variance-authority`, `clsx`, `tailwind-merge`,
plus per-component `@radix-ui/react-*` packages as later tickets pull in
components (e.g. `@radix-ui/react-dialog`, `@radix-ui/react-select`) via the
shadcn CLI, which copies component source into `src/components/` rather than
importing an opaque package.

**Reason:** User flagged the design as "quite complex, especially modal with
backdrop and customized dropdown or input field" — exactly where hand-rolled
accessibility (focus trap, portal, escape-to-close, ARIA/keyboard nav for
comboboxes) is hardest to get right. Confirmed current Radix/shadcn support
for React 19 and Tailwind v4, so no version friction with the existing setup.
shadcn's copy-in model fits the codebase-structure convention of colocated,
inspectable components rather than a black-box import.

---

## Q4: How are concrete design values (colors, type scale, spacing) extracted from the design artifact?

**Answer:** Deferred to implementation time, not decided in this session.

**Decision:** Ticket 017's token-extraction checklist item sources values
from [002-design-system.html](./002-design-system.html) (an HTML pull of the
design system the user is producing separately via an agent), falling back
to the live design artifact referenced in
[001-full-app-design.md](./001-full-app-design.md) if that file isn't
populated yet.

**Reason:** The linked artifact is a rendered SPA prototype, not a spec doc —
a direct fetch attempt returned an unparseable compiled JS bundle rather than
usable content. Pulling exact values is implementation work, not a scoping
decision, so it stays out of the grilling session.

---

## Q5: Where does 017 sit in the dependency graph?

**Answer:** Blocked by 001 only; blocks 003 (and everything downstream of
003 inherits the dependency transitively).

**Decision:** `000-index.md` updated with `001 --> 017 --> 003` plus the
existing `001 --> 003` edge (003's "Blocked by" is `001, 017`). No direct
edges added from 017 to 005-016, since the existing graph only encodes
direct blockers and every ticket from 004 onward already transitively
depends on 003.

**Reason:** 017 has no on-chain dependency, only needs the repo/tooling from
001. 003 is the first ticket with real user-facing pages (registration/
login), so the foundation must land before it. Ticket 002 is excluded from
the blocked-by relationship since it already shipped — 017 retrofits 002's
page as part of its own scope rather than 002 depending on 017.

---

## Q6: Renumber existing tickets to insert this earlier in sequence, or append?

**Answer:** Append as `017-frontend-design-foundation.md`.

**Decision:** No renumbering of 003-016. `000-index.md`'s table lists 017
directly after 002 (ahead of 003) for readability, but the filename number
itself stays 017.

**Reason:** Ticket numbers in this repo are already not strictly
dependency-ordered (e.g. 010 is numbered after 007-009 despite being blocked
only by 006) — the `Blocked by` column and mermaid graph are the actual
source of truth for ordering, not the filename number. Renumbering 14 files
(including 002, already `Status: Done`) to fix a cosmetic ordering issue
isn't worth the churn.
