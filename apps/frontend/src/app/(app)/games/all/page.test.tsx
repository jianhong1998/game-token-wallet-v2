import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const { mockGetCurrentUsername } = vi.hoisted(() => ({ mockGetCurrentUsername: vi.fn() }));
vi.mock("@/server/actions/auth", () => ({ getCurrentUsername: mockGetCurrentUsername }));

const { mockListBrowseGames } = vi.hoisted(() => ({ mockListBrowseGames: vi.fn() }));
vi.mock("@/server/actions/game", () => ({ listBrowseGames: mockListBrowseGames }));

const { mockRedirect } = vi.hoisted(() => ({ mockRedirect: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: mockRedirect,
  // Also stubbed: GamesAllPage renders BrowseGameRow (a client component), which
  // calls useRouter() internally — without this the "lists active games" case
  // (the only one that actually renders a row) crashes on an undefined export.
  useRouter: () => ({ push: vi.fn() }),
}));

import GamesAllPage from "./page";

describe("GamesAllPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects to /login when there is no session", async () => {
    mockGetCurrentUsername.mockResolvedValue(null);
    await GamesAllPage();
    expect(mockRedirect).toHaveBeenCalledWith("/login");
  });

  it("shows an empty state when no games are active", async () => {
    mockGetCurrentUsername.mockResolvedValue("bob");
    mockListBrowseGames.mockResolvedValue([]);
    const jsx = await GamesAllPage();
    render(jsx);
    expect(screen.getByTestId("browse-games-empty")).toBeInTheDocument();
  });

  it("lists active games", async () => {
    mockGetCurrentUsername.mockResolvedValue("bob");
    mockListBrowseGames.mockResolvedValue([
      { address: "Game1", name: "Friday Poker", mode: 0, playerCount: 5, isMember: false },
    ]);
    const jsx = await GamesAllPage();
    render(jsx);
    expect(screen.getByText("Friday Poker")).toBeInTheDocument();
  });
});
