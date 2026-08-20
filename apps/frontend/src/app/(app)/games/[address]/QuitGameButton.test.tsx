import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { mockQuitGame } = vi.hoisted(() => ({ mockQuitGame: vi.fn() }));
vi.mock("@/server/actions/game", () => ({ quitGame: mockQuitGame }));

const { mockPush } = vi.hoisted(() => ({ mockPush: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mockPush }) }));

import QuitGameButton from "./QuitGameButton";

describe("QuitGameButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the Quit game button and no confirmation content until clicked", () => {
    render(<QuitGameButton gameAddress="Game1" />);
    expect(screen.getByRole("button", { name: "Quit game" })).toBeInTheDocument();
    expect(screen.queryByText("Quit this game?")).not.toBeInTheDocument();
  });

  it("opens a confirmation modal explaining the balance will be burned", () => {
    render(<QuitGameButton gameAddress="Game1" />);
    fireEvent.click(screen.getByRole("button", { name: "Quit game" }));
    expect(screen.getByText("Quit this game?")).toBeInTheDocument();
    expect(
      screen.getByText("Your balance in this game will be burned immediately and can't be recovered."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Quit" })).toBeInTheDocument();
    expect(mockQuitGame).not.toHaveBeenCalled();
  });

  it("closes the modal without submitting when Cancel is clicked", () => {
    render(<QuitGameButton gameAddress="Game1" />);
    fireEvent.click(screen.getByRole("button", { name: "Quit game" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText("Quit this game?")).not.toBeInTheDocument();
    expect(mockQuitGame).not.toHaveBeenCalled();
  });

  it("quits and redirects home on success", async () => {
    mockQuitGame.mockResolvedValue({ ok: true });
    render(<QuitGameButton gameAddress="Game1" />);
    fireEvent.click(screen.getByRole("button", { name: "Quit game" }));
    fireEvent.click(screen.getByRole("button", { name: "Quit" }));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/"));
    expect(mockQuitGame).toHaveBeenCalledWith("Game1");
  });

  it("shows a friendly error and keeps the modal open when the quit is rejected", async () => {
    mockQuitGame.mockResolvedValue({
      ok: false,
      error: "Transfer admin role to another player before quitting",
    });
    render(<QuitGameButton gameAddress="Game1" />);
    fireEvent.click(screen.getByRole("button", { name: "Quit game" }));
    fireEvent.click(screen.getByRole("button", { name: "Quit" }));

    await waitFor(() =>
      expect(screen.getByTestId("quit-error")).toHaveTextContent(
        "Transfer admin role to another player before quitting",
      ),
    );
    expect(mockPush).not.toHaveBeenCalled();
    expect(screen.getByText("Quit this game?")).toBeInTheDocument();
  });

  it("shows a fallback error when quitGame throws unexpectedly", async () => {
    mockQuitGame.mockRejectedValue(new Error("Network error"));
    render(<QuitGameButton gameAddress="Game1" />);
    fireEvent.click(screen.getByRole("button", { name: "Quit game" }));
    fireEvent.click(screen.getByRole("button", { name: "Quit" }));

    await waitFor(() => expect(screen.getByTestId("quit-error")).toBeInTheDocument());
    expect(mockPush).not.toHaveBeenCalled();
  });
});
