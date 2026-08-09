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
