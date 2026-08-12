import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { mockTransferTokens } = vi.hoisted(() => ({ mockTransferTokens: vi.fn() }));
vi.mock("@/server/actions/game", () => ({ transferTokens: mockTransferTokens }));

const { mockRefresh } = vi.hoisted(() => ({ mockRefresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));

import SendTokensForm from "./SendTokensForm";

const PLAYERS = [
  { username: "alice", balance: 4, isAdmin: true },
  { username: "bob", balance: 1.5, isAdmin: false },
  { username: "carol", balance: 0, isAdmin: false },
];

describe("SendTokensForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows one recipient row by default, excluding the current user", () => {
    render(<SendTokensForm gameAddress="Game1" players={PLAYERS} currentUsername="alice" />);
    const pickers = screen.getAllByLabelText("Recipient");
    expect(pickers).toHaveLength(1);
    expect(screen.queryByRole("option", { name: "alice" })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: "bob" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "carol" })).toBeInTheDocument();
  });

  it("adds and removes recipient rows", () => {
    render(<SendTokensForm gameAddress="Game1" players={PLAYERS} currentUsername="alice" />);
    fireEvent.click(screen.getByRole("button", { name: "+ Add recipient" }));
    expect(screen.getAllByLabelText("Recipient")).toHaveLength(2);

    fireEvent.click(screen.getAllByRole("button", { name: "Remove recipient" })[0]);
    expect(screen.getAllByLabelText("Recipient")).toHaveLength(1);
  });

  it("excludes a recipient already chosen in another row from every other row's picker", () => {
    render(<SendTokensForm gameAddress="Game1" players={PLAYERS} currentUsername="alice" />);
    fireEvent.click(screen.getByRole("button", { name: "+ Add recipient" }));
    const pickers = screen.getAllByLabelText("Recipient");
    fireEvent.change(pickers[0], { target: { value: "bob" } });

    const secondRowOptions = screen.getAllByLabelText("Recipient")[1].querySelectorAll("option");
    const secondRowUsernames = Array.from(secondRowOptions).map((option) => option.textContent);
    expect(secondRowUsernames).not.toContain("bob");
    expect(secondRowUsernames).toContain("carol");
  });

  it("rejects submitting with an incomplete row", () => {
    render(<SendTokensForm gameAddress="Game1" players={PLAYERS} currentUsername="alice" />);
    fireEvent.change(screen.getAllByLabelText("Recipient")[0], { target: { value: "bob" } });
    fireEvent.click(screen.getByRole("button", { name: /Send/ }));
    expect(screen.getByTestId("transfer-error")).toBeInTheDocument();
    expect(mockTransferTokens).not.toHaveBeenCalled();
  });

  it("submits the whole batch, refreshes, and resets on success", async () => {
    mockTransferTokens.mockResolvedValue({ ok: true });
    render(<SendTokensForm gameAddress="Game1" players={PLAYERS} currentUsername="alice" />);
    fireEvent.click(screen.getByRole("button", { name: "+ Add recipient" }));
    const pickers = screen.getAllByLabelText("Recipient");
    const amounts = screen.getAllByLabelText("Tokens to send");
    fireEvent.change(pickers[0], { target: { value: "bob" } });
    fireEvent.change(amounts[0], { target: { value: "5" } });
    fireEvent.change(pickers[1], { target: { value: "carol" } });
    fireEvent.change(amounts[1], { target: { value: "2.5" } });
    fireEvent.click(screen.getByRole("button", { name: /Send/ }));

    await waitFor(() => expect(mockRefresh).toHaveBeenCalledTimes(1));
    expect(mockTransferTokens).toHaveBeenCalledWith({
      gameAddress: "Game1",
      recipients: [
        { recipientUsername: "bob", amount: 5 },
        { recipientUsername: "carol", amount: 2.5 },
      ],
    });
  });

  it("shows a count-naming partial-failure message and does not reset the form", async () => {
    mockTransferTokens.mockResolvedValue({
      ok: false,
      error: "Not enough balance for this transfer",
      transfersApplied: 1,
      transfersTotal: 2,
    });
    render(<SendTokensForm gameAddress="Game1" players={PLAYERS} currentUsername="alice" />);
    fireEvent.change(screen.getAllByLabelText("Recipient")[0], { target: { value: "bob" } });
    fireEvent.change(screen.getAllByLabelText("Tokens to send")[0], { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: /Send/ }));

    await waitFor(() =>
      expect(screen.getByTestId("transfer-error")).toHaveTextContent(
        "Sent to 1 of 2 recipients, then failed: Not enough balance for this transfer",
      ),
    );
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("shows a plain validation-style message when nothing was sent", async () => {
    mockTransferTokens.mockResolvedValue({
      ok: false,
      error: "Not enough balance for this transfer",
      transfersApplied: 0,
      transfersTotal: 1,
    });
    render(<SendTokensForm gameAddress="Game1" players={PLAYERS} currentUsername="alice" />);
    fireEvent.change(screen.getAllByLabelText("Recipient")[0], { target: { value: "bob" } });
    fireEvent.change(screen.getAllByLabelText("Tokens to send")[0], { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: /Send/ }));

    await waitFor(() =>
      expect(screen.getByTestId("transfer-error")).toHaveTextContent(
        "Not enough balance for this transfer",
      ),
    );
    expect(screen.getByTestId("transfer-error")).not.toHaveTextContent("Sent to");
  });
});
