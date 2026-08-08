# Home Dashboard, Bottom Nav, and Account Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Ticket:** [018-home-dashboard-nav-account.md](../../tickets/018-home-dashboard-nav-account.md)

**Spec:** [openspec/changes/home-dashboard-nav-account/](../../../openspec/changes/home-dashboard-nav-account/) (`proposal.md`, `design.md`, `specs/home-dashboard/spec.md`, `tasks.md` — revised 2026-08-08 to match actual post-ticket-006 codebase state; see `design.md`'s Decisions section for the full rationale this plan implements). Original grill-session writeup: [docs/superpowers/specs/2026-07-26-home-dashboard-nav-account-design.md](../specs/2026-07-26-home-dashboard-nav-account-design.md).

**Goal:** Replace the placeholder `/` dashboard and the admin-only `/games` list with a unified Home dashboard (every game the user belongs to, as player or admin), a persistent Home/Browse/You bottom nav on every `(app)` page, and a minimal Account ("You") screen.

**Architecture:** All new data flows through one new server action, `listMyMemberGames()`, added to the existing `apps/frontend/src/server/actions/game.ts`. It determines membership by checking whether the current user's Associated Token Account (ATA) for each active game's mint exists — `Game` has no `players` array — reusing the batched-`getMultipleAccounts` pattern `listBrowseGames`'s `isMember` already uses, extended to also decode the held balance. Both the rewritten Home page and the new Account page consume this one action. The bottom nav lives in `(app)/layout.tsx` (not the root `AppShell`, which also wraps the `(auth)` login/register pages) and renders unconditionally. Home's rows link to the per-game detail page ticket 006 already shipped at `/games/[address]`.

**Tech Stack:** Next.js App Router (Server Components + one `"use client"` nav component), TypeScript, `@solana/kit`, `@solana-program/token`, Vitest + Testing Library, Tailwind (project's existing `glass-row`/`cyan-accent`/`text-primary`/`text-secondary` design tokens).

## Global Constraints

- Source of record: `openspec/changes/home-dashboard-nav-account/` (`proposal.md`, `design.md`, `specs/home-dashboard/spec.md`, `tasks.md`) — revised today to match actual post-ticket-006 codebase state. This plan implements that change.
- `Game` (on-chain) has fields `bump, mintBump, gameId, name, mode, admin, mint, playerCount` — **no `players` array.** Membership must be derived via ATA-existence check, never by reading a nonexistent field.
- Player/admin membership rule: a game appears on Home/counts toward the Account game-count if the current user is the game's `admin` **or** holds an ATA for its mint (existence, regardless of balance).
- No aggregate/total balance figure anywhere in this feature.
- Balance display: decode the token account's `amount` and divide by 100 (matches the existing convention in `fetchGameDetail`, `apps/frontend/src/server/actions/game.ts:282`). An admin with no ATA yet shows balance `0`.
- Home rows are interactive — each links to `/games/[address]` (ticket 006's existing detail page).
- Account screen: initials-only avatar (first two characters of username, uppercased), username, game count (`listMyMemberGames().length`), logout button. **No** delete-account/danger-zone UI (ticket 012 adds that later).
- Bottom nav (Home `/`, Browse `/games/all`, You `/account`) renders unconditionally on every `(app)` route — added to `apps/frontend/src/app/(app)/layout.tsx`, not to the root `AppShell` (which also wraps `(auth)`).
- Existing `/games` (admin-only list) page is deleted; `/games/new` is untouched and still linked from Home.
- Per-task test command: `pnpm --filter frontend run test -- <pattern>` (fast, scoped). Full gate before considering the plan done: `just lint && just typecheck && just test` (per `CLAUDE.md`).
- Conventional Commits enforced by `.hooks/commit-msg`; branch name must follow `.claude/rules/branch-name-rule.md` (e.g. `feat/018-home-dashboard-nav-account`); never commit directly to `main`.
- Follow existing test-mocking conventions exactly — see `apps/frontend/src/server/actions/game.test.ts` (`vi.hoisted` + `vi.mock` per external module, `gameData()` helper) and page-test conventions in `apps/frontend/src/app/(app)/games/[address]/page.test.tsx` / `apps/frontend/src/app/(app)/page.test.tsx`.

---

### Task 1: Extract shared `gameModeLabel` util

**Files:**
- Create: `apps/frontend/src/lib/game-mode.ts`
- Create: `apps/frontend/src/lib/game-mode.test.ts`
- Modify: `apps/frontend/src/app/(app)/games/all/BrowseGameRow.tsx`
- Modify: `apps/frontend/src/app/(app)/games/[address]/page.tsx`

**Interfaces:**
- Produces: `gameModeLabel(mode: GameMode): string` — `GameMode` imported from `on-chain-client` (values: `0` = General, `1` = Poker, `2` = Pool).

- [ ] **Step 1: Write the failing test**

```typescript
// apps/frontend/src/lib/game-mode.test.ts
import { describe, it, expect } from "vitest";
import { gameModeLabel } from "./game-mode";

describe("gameModeLabel", () => {
  it("labels General mode", () => {
    expect(gameModeLabel(0)).toBe("General Mode");
  });

  it("labels Poker mode", () => {
    expect(gameModeLabel(1)).toBe("Poker Mode");
  });

  it("labels Pool mode", () => {
    expect(gameModeLabel(2)).toBe("Pool Mode");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter frontend run test -- game-mode.test.ts`
Expected: FAIL — `Cannot find module './game-mode'`

- [ ] **Step 3: Write minimal implementation**

```typescript
// apps/frontend/src/lib/game-mode.ts
import type { GameMode } from "on-chain-client";

export function gameModeLabel(mode: GameMode): string {
  return mode === 0 ? "General Mode" : mode === 1 ? "Poker Mode" : "Pool Mode";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter frontend run test -- game-mode.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Update the two existing call sites to use the shared util**

In `apps/frontend/src/app/(app)/games/all/BrowseGameRow.tsx`, remove the inline function:

```typescript
function gameModeLabel(mode: BrowseGame["mode"]): string {
  return mode === 0 ? "General Mode" : mode === 1 ? "Poker Mode" : "Pool Mode";
}
```

and add the import:

```typescript
import { gameModeLabel } from "@/lib/game-mode";
```

In `apps/frontend/src/app/(app)/games/[address]/page.tsx`, remove the same inline function and add the same import. Both files' remaining usages (`gameModeLabel(game.mode)`) are unchanged — only the definition moves.

- [ ] **Step 6: Run the existing tests for both touched files to confirm no behavior changed**

Run: `pnpm --filter frontend run test -- BrowseGameRow.test.tsx page.test.tsx`
Expected: PASS — all pre-existing tests in `BrowseGameRow.test.tsx` and `apps/frontend/src/app/(app)/games/[address]/page.test.tsx` still pass unchanged.

- [ ] **Step 7: Commit**

```bash
git add apps/frontend/src/lib/game-mode.ts apps/frontend/src/lib/game-mode.test.ts apps/frontend/src/app/\(app\)/games/all/BrowseGameRow.tsx "apps/frontend/src/app/(app)/games/[address]/page.tsx"
git commit -m "refactor(frontend): extract shared gameModeLabel util"
```

---

### Task 2: `listMyMemberGames()` server action

**Files:**
- Modify: `apps/frontend/src/server/actions/game.ts`
- Modify: `apps/frontend/src/server/actions/game.test.ts`

**Interfaces:**
- Consumes: existing `getSolanaContext()`, `getCurrentUsername()`, `findRegistryPda`, `fetchMaybeRegistry`, `fetchGame`, `findUserPda`, `findAssociatedTokenPda`, `getTokenDecoder`, `TOKEN_PROGRAM_ADDRESS` (all already imported in `game.ts`).
- Produces: `export interface MemberGame { address: string; name: string; mode: GameMode; balance: number; isAdmin: boolean }` and `export async function listMyMemberGames(): Promise<MemberGame[]>`.

- [ ] **Step 1: Write the failing tests**

Add to `apps/frontend/src/server/actions/game.test.ts`, after the `describe("listBrowseGames", ...)` block (before `describe("fetchGameDetail", ...)`). Reuses this file's existing `gameData()` helper, `ADMIN_ADDRESS`, `USER_ADDRESS`, `REGISTRY_ADDRESS`, `PROGRAM_ADDRESS` constants, and the already-imported mocks (`mockGetCurrentUsername`, `mockGetSolanaContext`, `mockFindRegistryPda`, `mockFetchMaybeRegistry`, `mockFetchGame`, `mockFindUserPda`, `mockFindAssociatedTokenPda`, `mockGetTokenDecoder`):

```typescript
describe("listMyMemberGames", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCurrentUsername.mockResolvedValue("bob");
    mockFindRegistryPda.mockResolvedValue([REGISTRY_ADDRESS, 255]);
    mockFindUserPda.mockResolvedValue([USER_ADDRESS, 255]);
  });

  it("returns an empty list when not signed in", async () => {
    mockGetCurrentUsername.mockResolvedValue(null);
    await expect(listMyMemberGames()).resolves.toEqual([]);
    expect(mockGetSolanaContext).not.toHaveBeenCalled();
  });

  it("returns an empty list when the registry doesn't exist yet", async () => {
    mockGetSolanaContext.mockResolvedValue({
      rpc: {},
      adminSigner: { address: ADMIN_ADDRESS },
      programAddress: PROGRAM_ADDRESS,
    });
    mockFetchMaybeRegistry.mockResolvedValue({ exists: false });
    await expect(listMyMemberGames()).resolves.toEqual([]);
  });

  it("excludes games where the user is neither a player nor the admin", async () => {
    mockFetchMaybeRegistry.mockResolvedValue({
      exists: true,
      address: REGISTRY_ADDRESS,
      data: { discriminator: new Uint8Array(8), bump: 255, activeGames: ["Game1"] },
    });
    mockFetchGame.mockResolvedValueOnce({
      address: "Game1",
      data: gameData({
        admin: "SomeoneElse11111111111111111111111111111" as Address,
        mint: MINT_ADDRESS,
      }),
    });
    mockFindAssociatedTokenPda.mockResolvedValueOnce(["Ata1", 254]);
    const mockGetMultipleAccounts = vi.fn(() => ({ send: async () => ({ value: [null] }) }));
    mockGetSolanaContext.mockResolvedValue({
      rpc: { getMultipleAccounts: mockGetMultipleAccounts },
      adminSigner: { address: ADMIN_ADDRESS },
      programAddress: PROGRAM_ADDRESS,
    });

    await expect(listMyMemberGames()).resolves.toEqual([]);
  });

  it("includes a player-only game with its decoded balance", async () => {
    mockFetchMaybeRegistry.mockResolvedValue({
      exists: true,
      address: REGISTRY_ADDRESS,
      data: { discriminator: new Uint8Array(8), bump: 255, activeGames: ["Game1"] },
    });
    mockFetchGame.mockResolvedValueOnce({
      address: "Game1",
      data: gameData({
        name: "Friday Poker",
        admin: "SomeoneElse11111111111111111111111111111" as Address,
        mint: MINT_ADDRESS,
      }),
    });
    mockFindAssociatedTokenPda.mockResolvedValueOnce(["Ata1", 254]);
    const mockGetMultipleAccounts = vi.fn(() => ({
      send: async () => ({ value: [{ data: ["ZmFrZQ==", "base64"] }] }),
    }));
    mockGetSolanaContext.mockResolvedValue({
      rpc: { getMultipleAccounts: mockGetMultipleAccounts },
      adminSigner: { address: ADMIN_ADDRESS },
      programAddress: PROGRAM_ADDRESS,
    });
    mockGetTokenDecoder.mockReturnValue({
      decode: vi.fn().mockReturnValue({ amount: 250n }),
    });

    await expect(listMyMemberGames()).resolves.toEqual([
      { address: "Game1", name: "Friday Poker", mode: 0, balance: 2.5, isAdmin: false },
    ]);
    expect(mockGetMultipleAccounts).toHaveBeenCalledWith(["Ata1"]);
  });

  it("includes an admin-only game with balance 0 when the admin has no ATA yet", async () => {
    mockFetchMaybeRegistry.mockResolvedValue({
      exists: true,
      address: REGISTRY_ADDRESS,
      data: { discriminator: new Uint8Array(8), bump: 255, activeGames: ["Game1"] },
    });
    mockFetchGame.mockResolvedValueOnce({
      address: "Game1",
      data: gameData({ name: "New Game", admin: USER_ADDRESS as Address, mint: MINT_ADDRESS }),
    });
    mockFindAssociatedTokenPda.mockResolvedValueOnce(["Ata1", 254]);
    const mockGetMultipleAccounts = vi.fn(() => ({ send: async () => ({ value: [null] }) }));
    mockGetSolanaContext.mockResolvedValue({
      rpc: { getMultipleAccounts: mockGetMultipleAccounts },
      adminSigner: { address: ADMIN_ADDRESS },
      programAddress: PROGRAM_ADDRESS,
    });

    await expect(listMyMemberGames()).resolves.toEqual([
      { address: "Game1", name: "New Game", mode: 0, balance: 0, isAdmin: true },
    ]);
  });

  it("marks isAdmin true and uses the real balance for an admin who has also joined as a player", async () => {
    mockFetchMaybeRegistry.mockResolvedValue({
      exists: true,
      address: REGISTRY_ADDRESS,
      data: { discriminator: new Uint8Array(8), bump: 255, activeGames: ["Game1"] },
    });
    mockFetchGame.mockResolvedValueOnce({
      address: "Game1",
      data: gameData({ name: "Mixed", admin: USER_ADDRESS as Address, mint: MINT_ADDRESS }),
    });
    mockFindAssociatedTokenPda.mockResolvedValueOnce(["Ata1", 254]);
    const mockGetMultipleAccounts = vi.fn(() => ({
      send: async () => ({ value: [{ data: ["ZmFrZQ==", "base64"] }] }),
    }));
    mockGetSolanaContext.mockResolvedValue({
      rpc: { getMultipleAccounts: mockGetMultipleAccounts },
      adminSigner: { address: ADMIN_ADDRESS },
      programAddress: PROGRAM_ADDRESS,
    });
    mockGetTokenDecoder.mockReturnValue({
      decode: vi.fn().mockReturnValue({ amount: 400n }),
    });

    await expect(listMyMemberGames()).resolves.toEqual([
      { address: "Game1", name: "Mixed", mode: 0, balance: 4, isAdmin: true },
    ]);
  });

  it("returns multiple games mixing player, admin, and excluded games", async () => {
    mockFetchMaybeRegistry.mockResolvedValue({
      exists: true,
      address: REGISTRY_ADDRESS,
      data: { discriminator: new Uint8Array(8), bump: 255, activeGames: ["Game1", "Game2", "Game3"] },
    });
    mockFetchGame
      .mockResolvedValueOnce({
        address: "Game1",
        data: gameData({
          name: "Player game",
          admin: "SomeoneElse11111111111111111111111111111" as Address,
          mint: "Mint1111111111111111111111111111111111111" as Address,
        }),
      })
      .mockResolvedValueOnce({
        address: "Game2",
        data: gameData({
          name: "Admin game",
          admin: USER_ADDRESS as Address,
          mint: "Mint2222222222222222222222222222222222222" as Address,
        }),
      })
      .mockResolvedValueOnce({
        address: "Game3",
        data: gameData({
          name: "Not mine",
          admin: "SomeoneElse11111111111111111111111111111" as Address,
          mint: "Mint3333333333333333333333333333333333333" as Address,
        }),
      });
    mockFindAssociatedTokenPda
      .mockResolvedValueOnce(["Ata1", 254])
      .mockResolvedValueOnce(["Ata2", 254])
      .mockResolvedValueOnce(["Ata3", 254]);
    const mockGetMultipleAccounts = vi.fn(() => ({
      send: async () => ({ value: [{ data: ["ZmFrZQ==", "base64"] }, null, null] }),
    }));
    mockGetSolanaContext.mockResolvedValue({
      rpc: { getMultipleAccounts: mockGetMultipleAccounts },
      adminSigner: { address: ADMIN_ADDRESS },
      programAddress: PROGRAM_ADDRESS,
    });
    mockGetTokenDecoder.mockReturnValue({
      decode: vi.fn().mockReturnValue({ amount: 100n }),
    });

    await expect(listMyMemberGames()).resolves.toEqual([
      { address: "Game1", name: "Player game", mode: 0, balance: 1, isAdmin: false },
      { address: "Game2", name: "Admin game", mode: 0, balance: 0, isAdmin: true },
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter frontend run test -- game.test.ts`
Expected: FAIL — `listMyMemberGames is not a function` / `SyntaxError: The requested module './game' does not provide an export named 'listMyMemberGames'`

- [ ] **Step 3: Write minimal implementation**

Add to `apps/frontend/src/server/actions/game.ts`, after the `listBrowseGames` function (imports `getTokenDecoder`, `findAssociatedTokenPda`, `TOKEN_PROGRAM_ADDRESS`, `findRegistryPda`, `fetchMaybeRegistry`, `fetchGame`, `findUserPda` are already present in the file from `createGame`/`listMyGames`/`listBrowseGames`):

```typescript
export interface MemberGame {
  address: string;
  name: string;
  mode: GameMode;
  balance: number;
  isAdmin: boolean;
}

export async function listMyMemberGames(): Promise<MemberGame[]> {
  const username = await getCurrentUsername();
  if (!username) return [];

  const { rpc, adminSigner, programAddress } = await getSolanaContext();
  const [registryAddress] = await findRegistryPda({ programAddress });
  const registry = await fetchMaybeRegistry(rpc, registryAddress);
  if (!registry.exists) return [];

  const games = await Promise.all(
    registry.data.activeGames.map((gameAddress) => fetchGame(rpc, gameAddress)),
  );

  const [userAddress] = await findUserPda(
    { username, admin: adminSigner.address },
    { programAddress },
  );

  const atas = await Promise.all(
    games.map(({ data }) =>
      findAssociatedTokenPda({
        owner: userAddress,
        mint: data.mint,
        tokenProgram: TOKEN_PROGRAM_ADDRESS,
      }),
    ),
  );
  const ataAddresses = atas.map(([address]) => address);
  const { value: ataAccounts } = ataAddresses.length
    ? await rpc.getMultipleAccounts(ataAddresses).send()
    : { value: [] as ({ data: [string, string] } | null)[] };

  const tokenDecoder = getTokenDecoder();

  const memberGames: MemberGame[] = [];
  games.forEach((game, index) => {
    const isAdmin = game.data.admin === userAddress;
    const ataAccount = ataAccounts[index];
    const isPlayer = ataAccount !== null;
    if (!isAdmin && !isPlayer) return;

    const balance = ataAccount
      ? Number(tokenDecoder.decode(Buffer.from(ataAccount.data[0], "base64")).amount) / 100
      : 0;

    memberGames.push({
      address: game.address,
      name: game.data.name,
      mode: game.data.mode,
      balance,
      isAdmin,
    });
  });

  return memberGames;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter frontend run test -- game.test.ts`
Expected: PASS — all `listMyMemberGames` tests plus every pre-existing test in the file.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/server/actions/game.ts apps/frontend/src/server/actions/game.test.ts
git commit -m "feat(frontend): add listMyMemberGames server action"
```

---

### Task 3: Rewrite Home dashboard page

**Files:**
- Modify: `apps/frontend/src/app/(app)/page.tsx`
- Modify: `apps/frontend/src/app/(app)/page.test.tsx`

**Interfaces:**
- Consumes: `listMyMemberGames(): Promise<MemberGame[]>` and `MemberGame` (Task 2), `gameModeLabel(mode: GameMode): string` (Task 1), existing `getCurrentUsername()`, existing `Button` (`@/components/ui/button`).
- Produces: rewritten default export `HomePage`.

- [ ] **Step 1: Write the failing tests**

Replace the full contents of `apps/frontend/src/app/(app)/page.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const { mockGetCurrentUsername } = vi.hoisted(() => ({ mockGetCurrentUsername: vi.fn() }));
vi.mock("@/server/actions/auth", () => ({ getCurrentUsername: mockGetCurrentUsername }));

const { mockListMyMemberGames } = vi.hoisted(() => ({ mockListMyMemberGames: vi.fn() }));
vi.mock("@/server/actions/game", () => ({ listMyMemberGames: mockListMyMemberGames }));

const { mockRedirect } = vi.hoisted(() => ({ mockRedirect: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: mockRedirect }));

import HomePage from "./page";

describe("HomePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects to /login when there is no session", async () => {
    mockGetCurrentUsername.mockResolvedValue(null);
    await HomePage();
    expect(mockRedirect).toHaveBeenCalledWith("/login");
  });

  it("shows an empty state with Create and Browse actions when the user belongs to no games", async () => {
    mockGetCurrentUsername.mockResolvedValue("alice");
    mockListMyMemberGames.mockResolvedValue([]);
    const jsx = await HomePage();
    render(jsx);
    expect(screen.getByTestId("home-empty")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Create" })).toHaveAttribute("href", "/games/new");
    expect(screen.getByRole("link", { name: "Browse" })).toHaveAttribute("href", "/games/all");
  });

  it("renders a row per game with name, mode, and balance", async () => {
    mockGetCurrentUsername.mockResolvedValue("alice");
    mockListMyMemberGames.mockResolvedValue([
      { address: "Game1", name: "Friday Poker", mode: 0, balance: 2.5, isAdmin: false },
    ]);
    const jsx = await HomePage();
    render(jsx);
    expect(screen.getByText("Friday Poker")).toBeInTheDocument();
    expect(screen.getByText("General Mode")).toBeInTheDocument();
    expect(screen.getByText("2.50")).toBeInTheDocument();
  });

  it("shows an Admin badge only on rows where the user is the admin", async () => {
    mockGetCurrentUsername.mockResolvedValue("alice");
    mockListMyMemberGames.mockResolvedValue([
      { address: "Game1", name: "Admin game", mode: 0, balance: 0, isAdmin: true },
      { address: "Game2", name: "Player game", mode: 0, balance: 1, isAdmin: false },
    ]);
    const jsx = await HomePage();
    render(jsx);
    const rows = screen.getAllByTestId(/^home-game-/);
    expect(rows).toHaveLength(2);
    expect(screen.getByTestId("home-game-Game1")).toHaveTextContent("Admin");
    expect(screen.getByTestId("home-game-Game2")).not.toHaveTextContent("Admin");
  });

  it("does not render any aggregate/total balance figure", async () => {
    mockGetCurrentUsername.mockResolvedValue("alice");
    mockListMyMemberGames.mockResolvedValue([
      { address: "Game1", name: "Friday Poker", mode: 0, balance: 2.5, isAdmin: false },
      { address: "Game2", name: "Saturday Mahjong", mode: 1, balance: 4, isAdmin: true },
    ]);
    const jsx = await HomePage();
    render(jsx);
    expect(screen.queryByText(/total/i)).not.toBeInTheDocument();
    expect(screen.queryByText("6.50")).not.toBeInTheDocument();
  });

  it("links each row to its game detail page", async () => {
    mockGetCurrentUsername.mockResolvedValue("alice");
    mockListMyMemberGames.mockResolvedValue([
      { address: "Game1", name: "Friday Poker", mode: 0, balance: 2.5, isAdmin: false },
    ]);
    const jsx = await HomePage();
    render(jsx);
    expect(screen.getByTestId("home-game-Game1")).toHaveAttribute("href", "/games/Game1");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter frontend run test -- "apps/frontend/src/app/(app)/page.test.tsx"`
Expected: FAIL — old page still renders `home-welcome`/logout button, none of the new testids/text exist; `listMyMemberGames` mock unused error or assertion failures.

- [ ] **Step 3: Write minimal implementation**

Replace the full contents of `apps/frontend/src/app/(app)/page.tsx`:

```tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUsername } from "@/server/actions/auth";
import { listMyMemberGames } from "@/server/actions/game";
import { gameModeLabel } from "@/lib/game-mode";
import { Button } from "@/components/ui/button";

export default async function HomePage() {
  const username = await getCurrentUsername();
  if (!username) {
    redirect("/login");
    return;
  }

  const games = await listMyMemberGames();

  return (
    <main className="py-8 flex flex-col gap-5">
      <h1 className="text-xl font-extrabold text-text-primary">Your games</h1>
      {games.length === 0 ? (
        <div data-testid="home-empty" className="flex flex-col gap-4">
          <p className="text-sm font-semibold text-text-secondary">
            You haven&apos;t joined or created any games yet.
          </p>
          <div className="flex gap-3">
            <Button asChild variant="primary">
              <Link href="/games/new">Create</Link>
            </Button>
            <Button asChild variant="secondary">
              <Link href="/games/all">Browse</Link>
            </Button>
          </div>
        </div>
      ) : (
        <>
          <ul className="flex flex-col gap-3" data-testid="home-games-list">
            {games.map((game) => (
              <li key={game.address}>
                <Link
                  href={`/games/${game.address}`}
                  data-testid={`home-game-${game.address}`}
                  className="glass-row flex items-center justify-between px-4 py-3"
                >
                  <div>
                    <div className="text-sm font-bold text-text-primary">{game.name}</div>
                    <div className="text-xs font-semibold text-text-secondary">
                      {gameModeLabel(game.mode)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {game.isAdmin && (
                      <span className="text-xs font-semibold text-cyan-accent">Admin</span>
                    )}
                    <span className="text-sm font-bold text-text-primary">
                      {game.balance.toFixed(2)}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          <Button asChild variant="primary" className="self-start">
            <Link href="/games/new">Create</Link>
          </Button>
        </>
      )}
    </main>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter frontend run test -- "apps/frontend/src/app/(app)/page.test.tsx"`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add "apps/frontend/src/app/(app)/page.tsx" "apps/frontend/src/app/(app)/page.test.tsx"
git commit -m "feat(frontend): rewrite Home as the member-games dashboard"
```

---

### Task 4: Delete the admin-only `/games` list page

**Files:**
- Delete: `apps/frontend/src/app/(app)/games/page.tsx`
- Delete: `apps/frontend/src/app/(app)/games/page.test.tsx`

**Interfaces:**
- Consumes: nothing (pure deletion).
- Produces: nothing (route `/games` no longer exists; `/games/new`, `/games/all`, `/games/[address]` are untouched and still present).

- [ ] **Step 1: Confirm nothing else references the deleted page**

Run: `grep -rn "app/(app)/games/page\|from \"\\./page\"" apps/frontend/src/app/\(app\)/games/page.test.tsx`

Confirm the only import of `apps/frontend/src/app/(app)/games/page.tsx` is its own colocated test (already being deleted) — no other file imports it (Next.js route files are never imported directly by other app code, only resolved by the router).

- [ ] **Step 2: Delete both files**

```bash
git rm "apps/frontend/src/app/(app)/games/page.tsx" "apps/frontend/src/app/(app)/games/page.test.tsx"
```

- [ ] **Step 3: Run the full frontend test suite to confirm nothing else broke**

Run: `pnpm --filter frontend run test`
Expected: PASS — no test references the deleted files (`listMyGames` remains exported and unit-tested in `game.test.ts` even though no page uses it anymore; leaving it in place is fine since it's still exported API, not dead code the plan owns removing).

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(frontend): delete admin-only /games list, superseded by Home"
```

---

### Task 5: `BottomNav` component

**Files:**
- Create: `apps/frontend/src/components/BottomNav/BottomNav.tsx`
- Create: `apps/frontend/src/components/BottomNav/BottomNav.test.tsx`

**Interfaces:**
- Produces: `export function BottomNav(): JSX.Element` — a client component rendering three links: Home (`/`), Browse (`/games/all`), You (`/account`), each with `data-testid="bottom-nav-home" | "bottom-nav-browse" | "bottom-nav-you"` and `aria-current="page"` on the tab matching the current route.

- [ ] **Step 1: Write the failing tests**

```tsx
// apps/frontend/src/components/BottomNav/BottomNav.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const { mockUsePathname } = vi.hoisted(() => ({ mockUsePathname: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: mockUsePathname }));

import { BottomNav } from "./BottomNav";

describe("BottomNav", () => {
  it("renders Home, Browse, and You tabs with the correct links", () => {
    mockUsePathname.mockReturnValue("/");
    render(<BottomNav />);
    expect(screen.getByTestId("bottom-nav-home")).toHaveAttribute("href", "/");
    expect(screen.getByTestId("bottom-nav-browse")).toHaveAttribute("href", "/games/all");
    expect(screen.getByTestId("bottom-nav-you")).toHaveAttribute("href", "/account");
  });

  it("marks the tab matching the current route as active", () => {
    mockUsePathname.mockReturnValue("/account");
    render(<BottomNav />);
    expect(screen.getByTestId("bottom-nav-you")).toHaveAttribute("aria-current", "page");
    expect(screen.getByTestId("bottom-nav-home")).not.toHaveAttribute("aria-current");
    expect(screen.getByTestId("bottom-nav-browse")).not.toHaveAttribute("aria-current");
  });

  it("marks Home active on the root route, not just an exact string match on other tabs", () => {
    mockUsePathname.mockReturnValue("/");
    render(<BottomNav />);
    expect(screen.getByTestId("bottom-nav-home")).toHaveAttribute("aria-current", "page");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter frontend run test -- BottomNav.test.tsx`
Expected: FAIL — `Cannot find module './BottomNav'`

- [ ] **Step 3: Write minimal implementation**

```tsx
// apps/frontend/src/components/BottomNav/BottomNav.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/", label: "Home", testId: "bottom-nav-home" },
  { href: "/games/all", label: "Browse", testId: "bottom-nav-browse" },
  { href: "/account", label: "You", testId: "bottom-nav-you" },
] as const;

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-0 bottom-0 flex justify-around border-t border-white/10 bg-app-shell/90 py-3 backdrop-blur-lg">
      {TABS.map((tab) => {
        const isActive = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            data-testid={tab.testId}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "text-xs font-bold",
              isActive ? "text-cyan-accent" : "text-text-secondary",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter frontend run test -- BottomNav.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/components/BottomNav/BottomNav.tsx apps/frontend/src/components/BottomNav/BottomNav.test.tsx
git commit -m "feat(frontend): add BottomNav component"
```

---

### Task 6: Wire `BottomNav` into the `(app)` layout

**Files:**
- Modify: `apps/frontend/src/app/(app)/layout.tsx`
- Create: `apps/frontend/src/app/(app)/layout.test.tsx`

**Interfaces:**
- Consumes: `BottomNav` (Task 5).
- Produces: updated default export `AppGroupLayout`.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/frontend/src/app/(app)/layout.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const { mockUsePathname } = vi.hoisted(() => ({ mockUsePathname: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: mockUsePathname }));

import AppGroupLayout from "./layout";

describe("AppGroupLayout", () => {
  it("renders children and the bottom nav", () => {
    mockUsePathname.mockReturnValue("/");
    render(
      <AppGroupLayout>
        <p>page content</p>
      </AppGroupLayout>,
    );
    expect(screen.getByText("page content")).toBeInTheDocument();
    expect(screen.getByTestId("bottom-nav-home")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter frontend run test -- "apps/frontend/src/app/(app)/layout.test.tsx"`
Expected: FAIL — `bottom-nav-home` testid not found (current layout only renders `children`).

- [ ] **Step 3: Write minimal implementation**

Replace the full contents of `apps/frontend/src/app/(app)/layout.tsx`:

```tsx
import { BottomNav } from "@/components/BottomNav/BottomNav";

export default function AppGroupLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div className="pb-20">{children}</div>
      <BottomNav />
    </>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter frontend run test -- "apps/frontend/src/app/(app)/layout.test.tsx"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add "apps/frontend/src/app/(app)/layout.tsx" "apps/frontend/src/app/(app)/layout.test.tsx"
git commit -m "feat(frontend): render BottomNav on every (app) page"
```

---

### Task 7: Account ("You") page

**Files:**
- Create: `apps/frontend/src/app/(app)/account/page.tsx`
- Create: `apps/frontend/src/app/(app)/account/page.test.tsx`

**Interfaces:**
- Consumes: `getCurrentUsername()` (existing), `listMyMemberGames()` (Task 2), `LogoutButton` (existing, `apps/frontend/src/app/(app)/LogoutButton.tsx`).
- Produces: default export `AccountPage`.

- [ ] **Step 1: Write the failing tests**

```tsx
// apps/frontend/src/app/(app)/account/page.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const { mockGetCurrentUsername } = vi.hoisted(() => ({ mockGetCurrentUsername: vi.fn() }));
vi.mock("@/server/actions/auth", () => ({
  getCurrentUsername: mockGetCurrentUsername,
  logoutUser: vi.fn(),
}));

const { mockListMyMemberGames } = vi.hoisted(() => ({ mockListMyMemberGames: vi.fn() }));
vi.mock("@/server/actions/game", () => ({ listMyMemberGames: mockListMyMemberGames }));

const { mockRedirect } = vi.hoisted(() => ({ mockRedirect: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: mockRedirect,
  useRouter: () => ({ push: vi.fn() }),
}));

import AccountPage from "./page";

describe("AccountPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects to /login when there is no session", async () => {
    mockGetCurrentUsername.mockResolvedValue(null);
    await AccountPage();
    expect(mockRedirect).toHaveBeenCalledWith("/login");
  });

  it("shows the initials avatar, username, and game count", async () => {
    mockGetCurrentUsername.mockResolvedValue("alice");
    mockListMyMemberGames.mockResolvedValue([
      { address: "Game1", name: "Friday Poker", mode: 0, balance: 4, isAdmin: true },
      { address: "Game2", name: "Saturday Mahjong", mode: 0, balance: 0, isAdmin: false },
    ]);
    const jsx = await AccountPage();
    render(jsx);
    expect(screen.getByTestId("account-avatar")).toHaveTextContent("AL");
    expect(screen.getByText("alice")).toBeInTheDocument();
    expect(screen.getByTestId("account-game-count")).toHaveTextContent("2 games");
  });

  it("shows singular 'game' when the user belongs to exactly one game", async () => {
    mockGetCurrentUsername.mockResolvedValue("bob");
    mockListMyMemberGames.mockResolvedValue([
      { address: "Game1", name: "Friday Poker", mode: 0, balance: 4, isAdmin: true },
    ]);
    const jsx = await AccountPage();
    render(jsx);
    expect(screen.getByTestId("account-game-count")).toHaveTextContent("1 game");
  });

  it("shows 0 games for a user in no games", async () => {
    mockGetCurrentUsername.mockResolvedValue("carol");
    mockListMyMemberGames.mockResolvedValue([]);
    const jsx = await AccountPage();
    render(jsx);
    expect(screen.getByTestId("account-game-count")).toHaveTextContent("0 games");
  });

  it("shows the logout button and no delete-account section", async () => {
    mockGetCurrentUsername.mockResolvedValue("alice");
    mockListMyMemberGames.mockResolvedValue([]);
    const jsx = await AccountPage();
    render(jsx);
    expect(screen.getByRole("button", { name: "Log out" })).toBeInTheDocument();
    expect(screen.queryByText(/delete account/i)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter frontend run test -- "apps/frontend/src/app/(app)/account/page.test.tsx"`
Expected: FAIL — `Cannot find module './page'`

- [ ] **Step 3: Write minimal implementation**

```tsx
// apps/frontend/src/app/(app)/account/page.tsx
import { redirect } from "next/navigation";
import { getCurrentUsername } from "@/server/actions/auth";
import { listMyMemberGames } from "@/server/actions/game";
import { LogoutButton } from "../LogoutButton";

function initials(username: string): string {
  return username.slice(0, 2).toUpperCase();
}

export default async function AccountPage() {
  const username = await getCurrentUsername();
  if (!username) {
    redirect("/login");
    return;
  }

  const games = await listMyMemberGames();

  return (
    <main className="py-8 flex flex-col items-center gap-5">
      <div
        data-testid="account-avatar"
        className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-primary text-lg font-extrabold text-ink"
      >
        {initials(username)}
      </div>
      <p className="text-lg font-extrabold text-text-primary">{username}</p>
      <p data-testid="account-game-count" className="text-sm font-semibold text-text-secondary">
        {games.length} {games.length === 1 ? "game" : "games"}
      </p>
      <LogoutButton />
    </main>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter frontend run test -- "apps/frontend/src/app/(app)/account/page.test.tsx"`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add "apps/frontend/src/app/(app)/account/page.tsx" "apps/frontend/src/app/(app)/account/page.test.tsx"
git commit -m "feat(frontend): add Account (You) page"
```

---

### Task 8: Full-suite verification and manual runtime check

**Files:** none (verification only, per `CLAUDE.md`'s Done Means — passing tests are necessary but not sufficient).

- [ ] **Step 1: Run the full lint/typecheck/test gate**

```bash
just lint
just typecheck
just test
```

Expected: all pass with no changes needed. If `pnpm lint` behaves unexpectedly, verify with `rtk proxy pnpm lint` first per `CLAUDE.local.md`'s known rtk-hook rewrite gotcha before treating it as a real regression.

- [ ] **Step 2: Boot the local stack**

```bash
just up
```

(first run: `just up-build`)

- [ ] **Step 3: Manually exercise the golden path and edge cases in a browser**

- Register/log in as a fresh user with 0 games → `/` shows the empty state (`home-empty`) with working Create and Browse actions.
- Create a game as this user → back on `/`, the new game appears with the Admin badge and balance `0.00` (admin hasn't joined as a player — ticket 021 not shipped yet).
- Log in as a second user and join that game via Browse (`/games/all`) → on that user's `/`, the game appears with no Admin badge and a real balance.
- Click a Home row → navigates to `/games/[address]` and shows the same game's detail.
- Bottom nav (Home/Browse/You) is visible and functional from all three tab screens and from `/games/new` and a game detail page.
- Visit `/account` (via the You tab) → shows initials avatar, username, correct game count, and a working Log out button; confirm no delete-account/danger-zone UI is present.
- Visit `/games` directly → confirm it 404s (page deleted in Task 4).

- [ ] **Step 4: Record verification evidence**

Note the exact commands run and their pass/fail output, plus a one-line confirmation of each manual check in Step 3, before considering this plan complete — per `CLAUDE.md`'s Done Means, do not claim "done" without this evidence in hand.

---

## Self-Review

**Spec coverage** (`openspec/changes/home-dashboard-nav-account/specs/home-dashboard/spec.md`):
- "Home lists every game the user belongs to" (incl. admin-no-ATA-balance-0 scenario) → Task 2 (`listMyMemberGames`) + Task 3 (Home rendering).
- "No aggregate balance shown" → Task 3 test ("does not render any aggregate/total balance figure").
- "Home empty state" → Task 3 (`home-empty` + Create/Browse actions).
- "Home rows link to the game detail page" → Task 3 (`Link href={`/games/${game.address}`}`) + test.
- "Persistent bottom navigation" → Task 5 (`BottomNav`) + Task 6 (wired into `(app)/layout.tsx`, unconditional).
- "Account screen shows identity and game count" / "No delete-account UI" → Task 7.
- Ticket's "existing `/games` deleted, `/games/new` unchanged" → Task 4.

**Placeholder scan:** no TBD/TODO markers; every step has concrete, runnable code or an exact shell command.

**Type consistency:** `MemberGame` (Task 2: `{ address, name, mode, balance, isAdmin }`) is the type consumed identically in Task 3's Home rows and Task 7's `.length` count — field names match across both consumers. `gameModeLabel(mode: GameMode)` (Task 1) is called identically (`gameModeLabel(game.mode)`) in Task 3 and in the two refactored existing call sites. `BottomNav`'s testids (`bottom-nav-home/browse/you`) are asserted identically in Task 5's own tests and Task 6's layout test.
