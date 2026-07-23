"use client";

import { useState, useTransition } from "react";
import { initializeRegistry } from "@/server/actions/registry";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";

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
    <main className="flex flex-col gap-5 py-8">
      <h1 className="text-xl font-extrabold text-text-primary">Registry admin</h1>
      <Button type="button" variant="primary" onClick={handleClick} isLoading={isPending}>
        Initialize registry
      </Button>
      {status && (
        <Alert data-testid="registry-status" variant="success" className="break-all">
          {status}
        </Alert>
      )}
      {error && (
        <Alert data-testid="registry-error" variant="error" className="break-all">
          {error}
        </Alert>
      )}
    </main>
  );
}
