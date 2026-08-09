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
