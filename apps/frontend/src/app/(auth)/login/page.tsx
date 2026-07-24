"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { loginUser } from "@/server/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await loginUser({ username, password });
      if (result.ok) {
        router.push("/home");
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <main className="py-8 flex flex-col gap-5">
      <h1 className="text-xl font-extrabold text-text-primary">Log in</h1>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Input
          type="text"
          placeholder="Username"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          required
        />
        <Input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
        <Button type="submit" variant="primary" isLoading={isPending}>
          Log in
        </Button>
      </form>
      {error && (
        <Alert data-testid="login-error" variant="error" className="break-all">
          {error}
        </Alert>
      )}
    </main>
  );
}
