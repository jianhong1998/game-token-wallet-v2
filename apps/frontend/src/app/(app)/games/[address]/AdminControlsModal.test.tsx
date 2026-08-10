import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { mockDepositToPlayer } = vi.hoisted(() => ({ mockDepositToPlayer: vi.fn() }));
vi.mock("@/server/actions/game", () => ({ depositToPlayer: mockDepositToPlayer }));

const { mockRefresh } = vi.hoisted(() => ({ mockRefresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));

import AdminControlsModal from "./AdminControlsModal";

const PLAYERS = [
  { username: "alice", balance: 4, isAdmin: true },
  { username: "bob", balance: 1.5, isAdmin: false },
];

describe("AdminControlsModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the Admin controls button and no modal content until clicked", () => {
    render(<AdminControlsModal gameAddress="Game1" players={PLAYERS} />);
    expect(screen.getByRole("button", { name: "Admin controls" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Player")).not.toBeInTheDocument();
  });

  it("opens the modal with a player picker listing current players and an amount field", () => {
    render(<AdminControlsModal gameAddress="Game1" players={PLAYERS} />);
    fireEvent.click(screen.getByRole("button", { name: "Admin controls" }));
    expect(screen.getByLabelText("Player")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "alice" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "bob" })).toBeInTheDocument();
    expect(screen.getByLabelText("Amount")).toBeInTheDocument();
  });

  it("rejects submitting without a selected player", () => {
    render(<AdminControlsModal gameAddress="Game1" players={PLAYERS} />);
    fireEvent.click(screen.getByRole("button", { name: "Admin controls" }));
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Deposit" }));
    expect(screen.getByTestId("deposit-error")).toHaveTextContent("Select a player");
    expect(mockDepositToPlayer).not.toHaveBeenCalled();
  });

  it("rejects submitting a zero amount", () => {
    render(<AdminControlsModal gameAddress="Game1" players={PLAYERS} />);
    fireEvent.click(screen.getByRole("button", { name: "Admin controls" }));
    fireEvent.change(screen.getByLabelText("Player"), { target: { value: "bob" } });
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Deposit" }));
    expect(screen.getByTestId("deposit-error")).toHaveTextContent(
      "Amount must be greater than zero",
    );
    expect(mockDepositToPlayer).not.toHaveBeenCalled();
  });

  it("deposits, closes the modal, and refreshes on success", async () => {
    mockDepositToPlayer.mockResolvedValue({ ok: true });
    render(<AdminControlsModal gameAddress="Game1" players={PLAYERS} />);
    fireEvent.click(screen.getByRole("button", { name: "Admin controls" }));
    fireEvent.change(screen.getByLabelText("Player"), { target: { value: "bob" } });
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "5.00" } });
    fireEvent.click(screen.getByRole("button", { name: "Deposit" }));

    await waitFor(() => expect(mockRefresh).toHaveBeenCalledTimes(1));
    expect(mockDepositToPlayer).toHaveBeenCalledWith({
      gameAddress: "Game1",
      playerUsername: "bob",
      amount: 5,
    });
    expect(screen.queryByLabelText("Player")).not.toBeInTheDocument();
  });

  it("shows a friendly error and keeps the modal open when the deposit is rejected", async () => {
    mockDepositToPlayer.mockResolvedValue({
      ok: false,
      error: "Only the game's admin can deposit tokens",
    });
    render(<AdminControlsModal gameAddress="Game1" players={PLAYERS} />);
    fireEvent.click(screen.getByRole("button", { name: "Admin controls" }));
    fireEvent.change(screen.getByLabelText("Player"), { target: { value: "bob" } });
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Deposit" }));

    await waitFor(() =>
      expect(screen.getByTestId("deposit-error")).toHaveTextContent(
        "Only the game's admin can deposit tokens",
      ),
    );
    expect(mockRefresh).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Player")).toBeInTheDocument();
  });

  it("shows a fallback error when depositToPlayer throws unexpectedly", async () => {
    mockDepositToPlayer.mockRejectedValue(new Error("Network error"));
    render(<AdminControlsModal gameAddress="Game1" players={PLAYERS} />);
    fireEvent.click(screen.getByRole("button", { name: "Admin controls" }));
    fireEvent.change(screen.getByLabelText("Player"), { target: { value: "bob" } });
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Deposit" }));

    await waitFor(() => expect(screen.getByTestId("deposit-error")).toBeInTheDocument());
    expect(mockRefresh).not.toHaveBeenCalled();
  });
});
