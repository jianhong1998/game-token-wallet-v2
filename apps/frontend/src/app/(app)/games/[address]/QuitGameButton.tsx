"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { quitGame } from "@/server/actions/game";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";

export default function QuitGameButton({ gameAddress }: { gameAddress: string }) {
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
        const result = await quitGame(gameAddress);
        if (result.ok) {
          router.push("/");
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
        Quit game
      </button>
      {isOpen && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-ink/70 p-6">
          <div className="glass-hero w-full max-w-sm p-6">
            <p className="text-sm font-extrabold text-text-primary">Quit this game?</p>
            <p className="mt-1 text-xs font-semibold text-text-secondary">
              Your balance in this game will be burned immediately and can&apos;t be recovered.
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
                Quit
              </Button>
            </div>
            {error && (
              <Alert data-testid="quit-error" variant="error" className="mt-3">
                {error}
              </Alert>
            )}
          </div>
        </div>
      )}
    </>
  );
}
