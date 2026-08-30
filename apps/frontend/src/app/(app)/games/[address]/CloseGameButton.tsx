"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { closeGame } from "@/server/actions/game";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";

export default function CloseGameButton({ gameAddress }: { gameAddress: string }) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function closeModal() {
    setIsOpen(false);
    setError(null);
  }

  function handleConfirm() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await closeGame(gameAddress);
        if (result.ok) {
          router.push("/");
        } else if (result.playersClosed > 0) {
          setError(
            `Closed ${result.playersClosed} of ${result.playersTotal} players, then failed: ${result.error}`,
          );
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
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="w-full py-3 text-center text-xs font-bold text-danger"
      >
        Close game
      </button>
      {isOpen && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-ink/70 p-6">
          <div className="glass-hero w-full max-w-sm p-6">
            <p className="text-sm font-extrabold text-text-primary">Close this game?</p>
            <p className="mt-1 text-xs font-semibold text-text-secondary">
              This game and every player&apos;s balance will be permanently destroyed and can&apos;t
              be recovered.
            </p>
            <div className="mt-4 flex gap-2">
              <Button variant="secondary" onClick={closeModal} className="flex-1">
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleConfirm}
                isLoading={isPending}
                className="flex-1"
              >
                Close
              </Button>
            </div>
            {error && (
              <Alert data-testid="close-error" variant="error" className="mt-3">
                {error}
              </Alert>
            )}
          </div>
        </div>
      )}
    </>
  );
}
