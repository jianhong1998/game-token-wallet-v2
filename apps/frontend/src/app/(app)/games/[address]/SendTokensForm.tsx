"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { transferTokens, type GamePlayer } from "@/server/actions/game";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";

interface RecipientRow {
  id: number;
  username: string;
  amount: string;
}

let nextRowId = 0;
function newRow(): RecipientRow {
  return { id: nextRowId++, username: "", amount: "" };
}

export default function SendTokensForm({
  gameAddress,
  players,
  currentUsername,
}: {
  gameAddress: string;
  players: GamePlayer[];
  currentUsername: string;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<RecipientRow[]>([newRow()]);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const otherPlayers = players.filter((player) => player.username !== currentUsername);

  function optionsForRow(rowId: number) {
    const chosenElsewhere = new Set(
      rows.filter((row) => row.id !== rowId && row.username).map((row) => row.username),
    );
    return otherPlayers.filter((player) => !chosenElsewhere.has(player.username));
  }

  function addRow() {
    setRows((prev) => [...prev, newRow()]);
  }

  function removeRow(id: number) {
    setRows((prev) => (prev.length > 1 ? prev.filter((row) => row.id !== id) : prev));
  }

  function updateRow(id: number, field: "username" | "amount", value: string) {
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, [field]: value } : row)));
  }

  const total = rows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const filled = rows.filter((row) => row.username || row.amount);
    if (filled.length === 0 || filled.some((row) => !row.username || !(Number(row.amount) > 0))) {
      setError("Every recipient needs a player and an amount greater than zero");
      return;
    }

    startTransition(async () => {
      try {
        const result = await transferTokens({
          gameAddress,
          recipients: filled.map((row) => ({
            recipientUsername: row.username,
            amount: Number(row.amount),
          })),
        });
        if (result.ok) {
          setRows([newRow()]);
          router.refresh();
        } else {
          setError(
            result.transfersApplied > 0
              ? `Sent to ${result.transfersApplied} of ${result.transfersTotal} recipients, then failed: ${result.error}`
              : result.error,
          );
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      }
    });
  }

  return (
    <div>
      <h2 className="mb-2 text-sm font-extrabold text-text-primary">Send tokens</h2>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        {rows.map((row) => (
          <div key={row.id} className="flex items-center gap-2">
            <select
              aria-label="Recipient"
              value={row.username}
              onChange={(event) => updateRow(row.id, "username", event.target.value)}
              className="glass-input h-11 flex-1 px-4 text-sm text-text-primary"
            >
              <option value="">Select player…</option>
              {optionsForRow(row.id).map((player) => (
                <option key={player.username} value={player.username}>
                  {player.username}
                </option>
              ))}
            </select>
            <Input
              aria-label="Amount"
              type="number"
              step="0.01"
              value={row.amount}
              onChange={(event) => updateRow(row.id, "amount", event.target.value)}
              placeholder="0.00"
              className="w-24"
            />
            {rows.length > 1 && (
              <button
                type="button"
                onClick={() => removeRow(row.id)}
                aria-label="Remove recipient"
                className="flex h-9 w-9 flex-none items-center justify-center rounded-md bg-danger/20 text-danger"
              >
                ×
              </button>
            )}
          </div>
        ))}
        <button
          type="button"
          onClick={addRow}
          className="self-start rounded-md border border-dashed border-white/30 px-3 py-2 text-xs font-bold text-text-primary"
        >
          + Add recipient
        </button>
        {error && (
          <Alert data-testid="transfer-error" variant="error">
            {error}
          </Alert>
        )}
        <Button type="submit" variant="secondary" isLoading={isPending}>
          Send {total.toFixed(2)}
        </Button>
      </form>
    </div>
  );
}
