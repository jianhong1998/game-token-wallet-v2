"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { joinGame, type BrowseGame } from "@/server/actions/game";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";

function gameModeLabel(mode: BrowseGame["mode"]): string {
  return mode === 0 ? "General Mode" : mode === 1 ? "Poker Mode" : "Pool Mode";
}

export default function BrowseGameRow({ game }: { game: BrowseGame }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    if (game.isMember) {
      router.push(`/games/${game.address}`);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await joinGame(game.address);
      if (result.ok) {
        router.push(`/games/${game.address}`);
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <li
      data-testid={`browse-game-${game.address}`}
      className="glass-row flex flex-col gap-2 px-4 py-3"
    >
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-bold text-text-primary">{game.name}</div>
          <div className="text-xs font-semibold text-text-secondary">
            <span>{gameModeLabel(game.mode)}</span> · <span>{game.playerCount}/20</span>
          </div>
        </div>
        <Button variant="primary" isLoading={isPending} onClick={handleClick}>
          {game.isMember ? "Open" : "Join"}
        </Button>
      </div>
      {error && (
        <Alert data-testid="join-game-error" variant="error" className="break-all">
          {error}
        </Alert>
      )}
    </li>
  );
}
