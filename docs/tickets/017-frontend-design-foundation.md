# 017 — Frontend design foundation

**What to build:** A shared UI foundation — design tokens, a core component set, and the auth/app layout shell — built from the design reference in [001-full-app-design.md](../technical-related/ui-design/001-full-app-design.md) (tokens sourced from [002-design-system.html](../technical-related/ui-design/002-design-system.html) once populated). Lands before ticket 003 so every subsequent frontend ticket consumes shared, consistent components instead of each hand-rolling its own Tailwind classes.

**Blocked by:** 001

**Status:** Pending

- [ ] shadcn/ui CLI initialized against the existing Next.js App Router + Tailwind v4 setup; `class-variance-authority`, `clsx`, `tailwind-merge` added as explicit `package.json` dependencies (flagged, not silently added — plus whichever `@radix-ui/react-*` packages the CLI pulls in per component below).
- [ ] Design tokens (color palette, typography scale, spacing/radius) extracted from [002-design-system.html](../technical-related/ui-design/002-design-system.html) — or the live design artifact if that file isn't populated yet — and defined in `apps/frontend/src/app/globals.css`'s `@theme` block, replacing the current placeholder (`--breakpoint-sm`, `--width-app-max` only).
- [ ] Core component set built in `apps/frontend/src/components/` (colocated `Component.tsx` + `Component.test.tsx`, per [001-CODEBASE-STRUCTURE.md](../technical-related/codebase-structure/001-CODEBASE-STRUCTURE.md)), via shadcn/Radix primitives where applicable: `Button`, `Input`, `Alert` (success/error variants), `Loading`/spinner.
- [ ] `(auth)` and `(app)` route groups scaffolded under `apps/frontend/src/app/` per the codebase-structure doc, replacing the current flat `app/` layout.
- [ ] Shared layout shell component formalizes the mobile-first / desktop-capped-to-mobile-width-with-side-margins behavior ([003-TECH-STACK.md](../technical-related/architecture/003-TECH-STACK.md)), token-driven rather than the current hardcoded `.app-shell` class in `globals.css`.
- [ ] Ticket 002's admin registry page (`apps/frontend/src/app/admin/registry/page.tsx`) retrofitted onto the new foundation — inline Tailwind classes (`bg-blue-600`, `text-green-700`, `text-red-700`, etc.) replaced with `Button`/`Alert` components and tokens; existing e2e coverage for this page still passes unmodified in behavior.
- [ ] Explicitly out of scope (deferred to the first ticket that needs each): Modal/Dialog, Select/Combobox/Dropdown, Badge, Nav/tab bar, Card.
