import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { mockCloseGame } = vi.hoisted(() => ({ mockCloseGame: vi.fn() }));
vi.mock("@/server/actions/game", () => ({ closeGame: mockCloseGame }));

const { mockPush } = vi.hoisted(() => ({ mockPush: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mockPush }) }));

import CloseGameButton from "./CloseGameButton";

describe("CloseGameButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the Close game button and no confirmation content until clicked", () => {
    render(<CloseGameButton gameAddress="Game1" />);
    expect(screen.getByRole("button", { name: "Close game" })).toBeInTheDocument();
    expect(screen.queryByText("Close this game?")).not.toBeInTheDocument();
  });

  it("opens a confirmation modal explaining the game will be permanently destroyed", () => {
    render(<CloseGameButton gameAddress="Game1" />);
    fireEvent.click(screen.getByRole("button", { name: "Close game" }));
    expect(screen.getByText("Close this game?")).toBeInTheDocument();
    expect(
      screen.getByText(
        "This game and every player's balance will be permanently destroyed and can't be recovered.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
    expect(mockCloseGame).not.toHaveBeenCalled();
  });

  it("closes the modal without submitting when Cancel is clicked", () => {
    render(<CloseGameButton gameAddress="Game1" />);
    fireEvent.click(screen.getByRole("button", { name: "Close game" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText("Close this game?")).not.toBeInTheDocument();
    expect(mockCloseGame).not.toHaveBeenCalled();
  });

  it("closes and redirects home on full success", async () => {
    mockCloseGame.mockResolvedValue({ ok: true });
    render(<CloseGameButton gameAddress="Game1" />);
    fireEvent.click(screen.getByRole("button", { name: "Close game" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/"));
    expect(mockCloseGame).toHaveBeenCalledWith("Game1");
  });

  it("shows partial progress and keeps the modal open on a partial failure", async () => {
    mockCloseGame.mockResolvedValue({
      ok: false,
      error: "network blip",
      playersClosed: 3,
      playersTotal: 5,
    });
    render(<CloseGameButton gameAddress="Game1" />);
    fireEvent.click(screen.getByRole("button", { name: "Close game" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    await waitFor(() =>
      expect(screen.getByTestId("close-error")).toHaveTextContent(
        "Closed 3 of 5 players, then failed: network blip",
      ),
    );
    expect(mockPush).not.toHaveBeenCalled();
    expect(screen.getByText("Close this game?")).toBeInTheDocument();
  });

  it("shows a plain error when nothing was closed yet", async () => {
    mockCloseGame.mockResolvedValue({
      ok: false,
      error: "A player joined or was paid while closing — please try again",
      playersClosed: 0,
      playersTotal: 0,
    });
    render(<CloseGameButton gameAddress="Game1" />);
    fireEvent.click(screen.getByRole("button", { name: "Close game" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    await waitFor(() =>
      expect(screen.getByTestId("close-error")).toHaveTextContent(
        "A player joined or was paid while closing — please try again",
      ),
    );
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("shows a fallback error when closeGame throws unexpectedly", async () => {
    mockCloseGame.mockRejectedValue(new Error("Network error"));
    render(<CloseGameButton gameAddress="Game1" />);
    fireEvent.click(screen.getByRole("button", { name: "Close game" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    await waitFor(() => expect(screen.getByTestId("close-error")).toBeInTheDocument());
    expect(mockPush).not.toHaveBeenCalled();
  });
});
