"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { registerUser } from "@/server/actions/auth";
import { normalizeUsername, validateUsername } from "@/lib/username";
import { validatePassword } from "@/lib/password-rules";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";

export default function RegisterPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const usernameCheck = username ? validateUsername(normalizeUsername(username)) : null;
  const passwordCheck = password ? validatePassword(password) : null;
  const confirmMismatch = confirmPassword.length > 0 && confirmPassword !== password;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        await registerUser({ username, password, confirmPassword });
        router.push("/home");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      }
    });
  }

  return (
    <main className="py-8 flex flex-col gap-5">
      <h1 className="text-xl font-extrabold text-text-primary">Register</h1>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <Input
            type="text"
            placeholder="Username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            required
          />
          {usernameCheck && !usernameCheck.valid && (
            <p data-testid="username-hint" className="text-xs text-danger">
              {usernameCheck.reason}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <Input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
          {passwordCheck && !passwordCheck.valid && (
            <p data-testid="password-hint" className="text-xs text-danger">
              {passwordCheck.reason}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <Input
            type="password"
            placeholder="Confirm password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            required
          />
          {confirmMismatch && (
            <p data-testid="confirm-password-hint" className="text-xs text-danger">
              Passwords do not match
            </p>
          )}
        </div>
        <Button type="submit" variant="primary" isLoading={isPending}>
          Register
        </Button>
      </form>
      {error && (
        <Alert data-testid="register-error" variant="error" className="break-all">
          {error}
        </Alert>
      )}
    </main>
  );
}
