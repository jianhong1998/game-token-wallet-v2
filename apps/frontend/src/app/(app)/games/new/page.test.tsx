import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { mockCreateGame } = vi.hoisted(() => ({ mockCreateGame: vi.fn() }));
vi.mock("@/server/actions/game", () => ({ createGame: mockCreateGame }));

const { mockPush } = vi.hoisted(() => ({ mockPush: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mockPush }) }));

import NewGamePage from "./page";

describe("NewGamePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows a live hint for an invalid name without submitting", async () => {
    const user = userEvent.setup();
    render(<NewGamePage />);
    await user.type(screen.getByLabelText("Game name"), "ab");
    expect(await screen.findByTestId("game-name-hint")).toBeInTheDocument();
    expect(mockCreateGame).not.toHaveBeenCalled();
  });

  it("submits and redirects to / on success", async () => {
    mockCreateGame.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<NewGamePage />);
    await user.type(screen.getByLabelText("Game name"), "Friday Poker");
    await user.click(screen.getByRole("button", { name: "Create game" }));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/"));
    expect(mockCreateGame).toHaveBeenCalledWith({ name: "Friday Poker" });
  });

  it("shows the error alert when creation fails", async () => {
    mockCreateGame.mockResolvedValue({ ok: false, error: "Registry is full" });
    const user = userEvent.setup();
    render(<NewGamePage />);
    await user.type(screen.getByLabelText("Game name"), "Friday Poker");
    await user.click(screen.getByRole("button", { name: "Create game" }));

    expect(await screen.findByTestId("create-game-error")).toHaveTextContent("Registry is full");
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("shows a fallback error alert when createGame throws an unexpected error", async () => {
    mockCreateGame.mockRejectedValue(new Error("Network error"));
    const user = userEvent.setup();
    render(<NewGamePage />);
    await user.type(screen.getByLabelText("Game name"), "Friday Poker");
    await user.click(screen.getByRole("button", { name: "Create game" }));

    expect(await screen.findByTestId("create-game-error")).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
  });
});
