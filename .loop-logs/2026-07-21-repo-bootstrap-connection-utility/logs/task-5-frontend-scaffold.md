# Task 5 Log: `apps/frontend` scaffold (Next.js + Tailwind)

## Task Context

### Plan Section

## Task 5: `apps/frontend` scaffold (Next.js + Tailwind)

**Files:**
- Create: `apps/frontend/package.json`
- Create: `apps/frontend/tsconfig.json`
- Create: `apps/frontend/next.config.ts`
- Create: `apps/frontend/postcss.config.mjs`
- Create: `apps/frontend/vitest.config.ts`
- Create: `apps/frontend/.env.template`
- Create: `apps/frontend/src/app/layout.tsx`
- Create: `apps/frontend/src/app/globals.css`
- Create: `apps/frontend/src/app/page.tsx` (placeholder, replaced in Task 7)
- Modify: `docs/technical-related/architecture/003-TECH-STACK.md`

**Interfaces:**
- Produces: `pnpm --filter frontend run dev|build|test` — Task 6, 7 add files under this app; Task 9/10 build this app inside Docker images.

- [ ] **Step 1: Create the package manifest**

`apps/frontend/package.json`:
```json
{
  "name": "frontend",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "next": "16.2.10",
    "react": "^19.1.0",
    "react-dom": "^19.1.0",
    "@solana/kit": "^5.5.1",
    "bs58": "^6.0.0",
    "on-chain-client": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.7.3",
    "@types/node": "^22.10.5",
    "@types/react": "^19.0.7",
    "@types/react-dom": "^19.0.3",
    "vitest": "^3.0.0",
    "tailwindcss": "^4.0.0",
    "@tailwindcss/postcss": "^4.0.0",
    "eslint": "^9.19.0",
    "eslint-config-next": "16.2.10"
  }
}
```

- [ ] **Step 2: Install**

Run: `pnpm install`
Expected: exits 0.

- [ ] **Step 3: Create the tsconfig**

`apps/frontend/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "preserve",
    "module": "ESNext",
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 4: Create next.config.ts**

`apps/frontend/next.config.ts`:
```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["on-chain-client"],
};

export default nextConfig;
```

- [ ] **Step 5: Create the Tailwind v4 PostCSS config**

`apps/frontend/postcss.config.mjs`:
```javascript
export default {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};
```

- [ ] **Step 6: Create globals.css with the mobile-first container theme**

`apps/frontend/src/app/globals.css`:
```css
@import "tailwindcss";

@theme {
  --breakpoint-sm: 30rem;
  --width-app-max: 28rem;
}

.app-shell {
  max-width: var(--width-app-max);
  margin-inline: auto;
}
```

- [ ] **Step 7: Create the root layout**

`apps/frontend/src/app/layout.tsx`:
```tsx
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Game Token Wallet",
  description: "Tokenize offline group games as on-chain SPL tokens.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="app-shell min-h-screen px-4">{children}</body>
    </html>
  );
}
```

- [ ] **Step 8: Create a placeholder home page**

`apps/frontend/src/app/page.tsx` (replaced with the real proof-of-plumbing UI in Task 7):
```tsx
export default function HomePage() {
  return <main className="py-8">Game Token Wallet</main>;
}
```

- [ ] **Step 9: Create the vitest config**

`apps/frontend/vitest.config.ts`:
```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
```

- [ ] **Step 10: Create the frontend env template**

`apps/frontend/.env.template`:
```
# Cluster this app talks to: localnet | devnet | mainnet-beta
SOLANA_CLUSTER=localnet

# Explicit RPC endpoint — always required, never inferred from SOLANA_CLUSTER.
SOLANA_RPC_URL=http://127.0.0.1:8899

# Base58 pubkey of the deployed game_token_wallet program.
PROGRAM_ID=

# Base58-encoded 64-byte secret key for the system admin wallet.
# NEVER commit a real value here — this signs every on-chain transaction.
SYSTEM_ADMIN_SECRET_KEY=
```

- [ ] **Step 11: Verify the app builds**

Run: `pnpm --filter frontend run build`
Expected: Next.js build succeeds (it will fail if `PROGRAM_ID`/`SYSTEM_ADMIN_SECRET_KEY` are read at *module scope* anywhere reachable from a page — Task 6/7 must only read them lazily inside the singleton accessor, never at import time, or this build step breaks).

- [ ] **Step 12: Record the Tailwind decision in the tech-stack doc**

Modify `docs/technical-related/architecture/003-TECH-STACK.md` — in the "Client — Next.js App" table, change the `Design` row's neighboring context by adding a new row:

```diff
 | Server state        | TanStack React Query                                           |
 | Client/shared state | React Context                                                  |
+| Styling             | Tailwind CSS v4                                                |
 | Design              | Mobile-first; desktop capped to mobile width with side margins |
```

- [ ] **Step 13: Commit**

```bash
git add apps/frontend docs/technical-related/architecture/003-TECH-STACK.md
git commit -m "feat: scaffold Next.js frontend with Tailwind CSS v4"
```

### Acceptance Criteria
- AC-1: `apps/frontend` package manifest, tsconfig, next.config.ts, postcss config, vitest config, env template, root layout, globals.css (mobile-first container theme), and placeholder home page all created per Steps 1–10.
- AC-2: `pnpm --filter frontend run build` succeeds (Step 11).
- AC-3: `docs/technical-related/architecture/003-TECH-STACK.md` updated with a new "Styling: Tailwind CSS v4" row (Step 12).
- AC-4: Changes committed with message `feat: scaffold Next.js frontend with Tailwind CSS v4` (Step 13).

---

## Attempt 1 — 2026-07-21T11:22:43Z

### Implementation Plan
- Create `apps/frontend/package.json` per Step 1, run `pnpm install`
- Create tsconfig, next.config.ts, postcss.config.mjs, globals.css, layout.tsx, placeholder page.tsx, vitest.config.ts, .env.template per Steps 3–10
- Verify `pnpm --filter frontend run build` (Step 11)
- Update `003-TECH-STACK.md` styling row (Step 12)
- Commit (Step 13)

### Files Changed
- created `apps/frontend/package.json` — frontend workspace package manifest
- created `apps/frontend/tsconfig.json` — extends root base tsconfig, Next.js plugin/paths
- created `apps/frontend/next.config.ts` — transpiles `on-chain-client` workspace package
- created `apps/frontend/postcss.config.mjs` — Tailwind v4 PostCSS plugin wiring
- created `apps/frontend/src/app/globals.css` — Tailwind v4 import + mobile-first `@theme`/`.app-shell` container
- created `apps/frontend/src/app/layout.tsx` — root layout, applies `.app-shell` to body
- created `apps/frontend/src/app/page.tsx` — placeholder home page (replaced in Task 7)
- created `apps/frontend/vitest.config.ts` — node environment, `src/**/*.test.ts` include
- created `apps/frontend/.env.template` — documents SOLANA_CLUSTER/SOLANA_RPC_URL/PROGRAM_ID/SYSTEM_ADMIN_SECRET_KEY
- created `apps/frontend/next-env.d.ts` — auto-generated by `next build`, committed as-is
- modified `docs/technical-related/architecture/003-TECH-STACK.md` — added "Styling: Tailwind CSS v4" row to Client table (Step 12)
- modified `pnpm-workspace.yaml` — added `sharp: true` and `unrs-resolver: true` to `allowBuilds` (pnpm 11.15.1 build-script gating fired for these two new transitive deps pulled in by Next.js/ESLint tooling; same fix pattern as the pre-existing `esbuild: true` entry from Task 3, per orchestrator instruction to extend the same map rather than work around it differently)
- modified `pnpm-lock.yaml` — lockfile update from `pnpm install` picking up the new `frontend` package's dependencies

### New Tests
(none — Task 5 is scaffold-only; connection utility tests land in Task 6)

### Key Decisions
- Included `pnpm-lock.yaml` and `pnpm-workspace.yaml` in the commit alongside `apps/frontend` and the tech-stack doc, deviating from the plan's literal `git add apps/frontend docs/technical-related/architecture/003-TECH-STACK.md` — both files are required for `pnpm install`/`pnpm --filter frontend run build` to reproduce cleanly on a fresh checkout, so omitting them would leave the repo in a broken state despite the plan text not listing them explicitly (same class of necessary deviation as Task 3's `allowBuilds` addition).
- `pnpm-workspace.yaml`'s `allowBuilds` extended (not replaced) per explicit orchestrator instruction to handle `ERR_PNPM_IGNORED_BUILDS` for any newly-encountered package the same way Task 3 handled `esbuild`.

### Lint Output
n/a — Task 5 does not run `pnpm lint`/`pnpm --filter frontend run lint` per plan Steps 1–13 (no lint step listed); build verification (Step 11) is the gate for this task.

### Test Output
n/a — Task 5 has no new tests (scaffold only); `pnpm --filter frontend run build` is the verification gate:
```
$ next build
▲ Next.js 16.2.10 (Turbopack)
  Creating an optimized production build ...
✓ Compiled successfully in 1355ms
  Running TypeScript ...
  Finished TypeScript in 743ms ...
  Collecting page data using 4 workers ...
  Generating static pages using 4 workers (0/3) ...
✓ Generating static pages using 4 workers (3/3) in 159ms
  Finalizing page optimization ...

Route (app)
┌ ○ /
└ ○ /_not-found

○  (Static)  prerendered as static content
```
PASS (build succeeded, 1 attempt)

### Commit
`fbcf668`

### Outcome: success
