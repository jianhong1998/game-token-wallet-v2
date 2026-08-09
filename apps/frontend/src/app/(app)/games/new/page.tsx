"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createGame } from "@/server/actions/game";
import { normalizeGameName, validateGameName } from "@/lib/game-name";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";

export default function NewGamePage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const nameCheck = name ? validateGameName(normalizeGameName(name)) : null;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        const result = await createGame({ name });
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
    <main className="py-8 flex flex-col gap-5">
      <h1 className="text-3xl font-extrabold text-text-primary">Create game</h1>
      <p className="text-sm font-semibold text-text-secondary">General Mode</p>
      <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3.5">
        <div>
          <label
            htmlFor="game-name"
            className="mb-1.5 block text-[11px] font-bold text-text-primary"
          >
            Game name
          </label>
          <Input
            id="game-name"
            type="text"
            placeholder="Friday Poker"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
          />
          {nameCheck && !nameCheck.valid && (
            <p data-testid="game-name-hint" className="mt-1 text-xs text-danger">
              {nameCheck.reason}
            </p>
          )}
        </div>
        {error && (
          <Alert data-testid="create-game-error" variant="error" className="break-all">
            {error}
          </Alert>
        )}
        <Button type="submit" variant="primary" isLoading={isPending} className="mt-1.5">
          Create game
        </Button>
      </form>
    </main>
  );
}
