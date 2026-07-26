import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const { mockGetCurrentUsername } = vi.hoisted(() => ({ mockGetCurrentUsername: vi.fn() }));
vi.mock("@/server/actions/auth", () => ({ getCurrentUsername: mockGetCurrentUsername }));

const { mockListMyGames } = vi.hoisted(() => ({ mockListMyGames: vi.fn() }));
vi.mock("@/server/actions/game", () => ({ listMyGames: mockListMyGames }));

const { mockRedirect } = vi.hoisted(() => ({ mockRedirect: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: mockRedirect }));

import GamesPage from "./page";

describe("GamesPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects to /login when there is no session", async () => {
    mockGetCurrentUsername.mockResolvedValue(null);
    await GamesPage();
    expect(mockRedirect).toHaveBeenCalledWith("/login");
  });

  it("shows an empty state when the user has no games", async () => {
    mockGetCurrentUsername.mockResolvedValue("alice");
    mockListMyGames.mockResolvedValue([]);
    const jsx = await GamesPage();
    render(jsx);
    expect(screen.getByTestId("games-empty")).toBeInTheDocument();
  });

  it("lists the user's games with an admin badge", async () => {
    mockGetCurrentUsername.mockResolvedValue("alice");
    mockListMyGames.mockResolvedValue([{ address: "Game1", name: "Friday Poker" }]);
    const jsx = await GamesPage();
    render(jsx);
    expect(screen.getByTestId("games-list")).toHaveTextContent("Friday Poker");
    expect(screen.getByTestId("games-list")).toHaveTextContent("Admin");
  });

  it("links to the creation form", async () => {
    mockGetCurrentUsername.mockResolvedValue("alice");
    mockListMyGames.mockResolvedValue([]);
    const jsx = await GamesPage();
    render(jsx);
    expect(screen.getByRole("link", { name: "New game" })).toHaveAttribute("href", "/games/new");
  });
});
