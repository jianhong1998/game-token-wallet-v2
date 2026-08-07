import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { mockJoinGame } = vi.hoisted(() => ({ mockJoinGame: vi.fn() }));
vi.mock("@/server/actions/game", () => ({ joinGame: mockJoinGame }));

const { mockPush } = vi.hoisted(() => ({ mockPush: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mockPush }) }));

import BrowseGameRow from "./BrowseGameRow";

describe("BrowseGameRow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows a Join button and player count when not a member", () => {
    render(
      <BrowseGameRow
        game={{ address: "Game1", name: "Friday Poker", mode: 0, playerCount: 5, isMember: false }}
      />,
    );
    expect(screen.getByText("Friday Poker")).toBeInTheDocument();
    expect(screen.getByText("5/20")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Join" })).toBeInTheDocument();
  });

  it("shows an Open button when already a member", () => {
    render(
      <BrowseGameRow
        game={{ address: "Game1", name: "Friday Poker", mode: 0, playerCount: 5, isMember: true }}
      />,
    );
    expect(screen.getByRole("button", { name: "Open" })).toBeInTheDocument();
  });

  it("navigates to the game detail page when Open is clicked", () => {
    render(
      <BrowseGameRow
        game={{ address: "Game1", name: "Friday Poker", mode: 0, playerCount: 5, isMember: true }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(mockPush).toHaveBeenCalledWith("/games/Game1");
  });

  it("joins then navigates to the game detail page on success", async () => {
    mockJoinGame.mockResolvedValue({ ok: true });
    render(
      <BrowseGameRow
        game={{ address: "Game1", name: "Friday Poker", mode: 0, playerCount: 5, isMember: false }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Join" }));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/games/Game1"));
    expect(mockJoinGame).toHaveBeenCalledWith("Game1");
  });

  it("shows an error and does not navigate when joining fails", async () => {
    mockJoinGame.mockResolvedValue({ ok: false, error: "This game already has the maximum of 20 players" });
    render(
      <BrowseGameRow
        game={{ address: "Game1", name: "Friday Poker", mode: 0, playerCount: 20, isMember: false }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Join" }));
    await waitFor(() =>
      expect(screen.getByText("This game already has the maximum of 20 players")).toBeInTheDocument(),
    );
    expect(mockPush).not.toHaveBeenCalled();
  });
});
