"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { depositToPlayer, type GamePlayer } from "@/server/actions/game";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";

export default function AdminControlsModal({
  gameAddress,
  players,
}: {
  gameAddress: string;
  players: GamePlayer[];
}) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [playerUsername, setPlayerUsername] = useState("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function closeModal() {
    setIsOpen(false);
    setPlayerUsername("");
    setAmount("");
    setError(null);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!playerUsername) {
      setError("Select a player");
      return;
    }
    const parsedAmount = Number(amount);
    if (!(parsedAmount > 0)) {
      setError("Amount must be greater than zero");
      return;
    }

    startTransition(async () => {
      try {
        const result = await depositToPlayer({ gameAddress, playerUsername, amount: parsedAmount });
        if (result.ok) {
          closeModal();
          router.refresh();
        } else {
          setError(result.error);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      }
    });
  }

  return (
    <>
      <Button variant="secondary" onClick={() => setIsOpen(true)}>
        Admin controls
      </Button>
      {isOpen && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-ink/70 p-6">
          <div className="glass-hero w-full max-w-sm p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-extrabold text-text-primary">Admin controls</h2>
              <button
                type="button"
                onClick={closeModal}
                aria-label="Close"
                className="flex h-7 w-7 items-center justify-center rounded-md bg-white/10 text-text-primary"
              >
                ×
              </button>
            </div>
            <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3">
              <p className="text-[11px] font-bold uppercase tracking-wide text-text-secondary">
                Deposit for offline cash-in
              </p>
              <div>
                <label
                  htmlFor="deposit-player"
                  className="mb-1.5 block text-[11px] font-bold text-text-primary"
                >
                  Player
                </label>
                <select
                  id="deposit-player"
                  value={playerUsername}
                  onChange={(event) => setPlayerUsername(event.target.value)}
                  className="glass-input h-11 w-full px-4 text-sm text-text-primary"
                >
                  <option value="">Select player…</option>
                  {players.map((player) => (
                    <option key={player.username} value={player.username}>
                      {player.username}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <label
                    htmlFor="deposit-amount"
                    className="mb-1.5 block text-[11px] font-bold text-text-primary"
                  >
                    Amount
                  </label>
                  <Input
                    id="deposit-amount"
                    type="number"
                    step="0.01"
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    placeholder="0.00"
                  />
                </div>
                <Button type="submit" variant="secondary" isLoading={isPending}>
                  Deposit
                </Button>
              </div>
              {error && (
                <Alert data-testid="deposit-error" variant="error">
                  {error}
                </Alert>
              )}
            </form>
          </div>
        </div>
      )}
    </>
  );
}
