"use client";

import { useState, useTransition } from "react";
import { initializeRegistry } from "@/server/actions/registry";

export default function AdminRegistryPage() {
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await initializeRegistry();
        setStatus(`registry initialized, ${result.activeGameCount} active games`);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      }
    });
  }

  return (
    <main className="py-8 flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Registry admin</h1>
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
      >
        {isPending ? "Initializing…" : "Initialize registry"}
      </button>
      {status && (
        <p data-testid="registry-status" className="break-all text-sm text-green-700">
          {status}
        </p>
      )}
      {error && (
        <p data-testid="registry-error" className="break-all text-sm text-red-700">
          {error}
        </p>
      )}
    </main>
  );
}
