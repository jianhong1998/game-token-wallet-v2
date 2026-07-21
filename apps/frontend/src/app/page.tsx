"use client";

import { useState, useTransition } from "react";
import { sendNoopTransaction } from "@/server/actions/noop";

export default function HomePage() {
  const [signature, setSignature] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await sendNoopTransaction();
        setSignature(result.signature);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      }
    });
  }

  return (
    <main className="py-8 flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Game Token Wallet</h1>
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
      >
        {isPending ? "Sending…" : "Send noop transaction"}
      </button>
      {signature && (
        <p data-testid="noop-signature" className="break-all text-sm text-green-700">
          {signature}
        </p>
      )}
      {error && (
        <p data-testid="noop-error" className="break-all text-sm text-red-700">
          {error}
        </p>
      )}
    </main>
  );
}
