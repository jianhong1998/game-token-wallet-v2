"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
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
        const result = await registerUser({ username, password, confirmPassword });
        if (result.ok) {
          router.push("/home");
        } else {
          setError(result.error);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      }
    });
  }

  return (
    <main className="flex min-h-screen flex-col py-16">
      <h1 className="text-3xl font-extrabold text-text-primary">Create account</h1>
      <p className="mt-2 text-sm font-semibold text-text-secondary">
        8–20 characters, letters/numbers/basic symbols only.
      </p>
      <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-3.5">
        <div>
          <label htmlFor="register-username" className="mb-1.5 block text-[11px] font-bold text-text-primary">
            Username
          </label>
          <Input
            id="register-username"
            type="text"
            placeholder="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            required
          />
          {usernameCheck && !usernameCheck.valid && (
            <p data-testid="username-hint" className="mt-1 text-xs text-danger">
              {usernameCheck.reason}
            </p>
          )}
        </div>
        <div>
          <label htmlFor="register-password" className="mb-1.5 block text-[11px] font-bold text-text-primary">
            Password
          </label>
          <Input
            id="register-password"
            type="password"
            placeholder="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
          {passwordCheck && !passwordCheck.valid && (
            <p data-testid="password-hint" className="mt-1 text-xs text-danger">
              {passwordCheck.reason}
            </p>
          )}
        </div>
        <div>
          <label htmlFor="register-confirm-password" className="mb-1.5 block text-[11px] font-bold text-text-primary">
            Confirm password
          </label>
          <Input
            id="register-confirm-password"
            type="password"
            placeholder="confirm password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            required
          />
          {confirmMismatch && (
            <p data-testid="confirm-password-hint" className="mt-1 text-xs text-danger">
              Passwords do not match
            </p>
          )}
        </div>
        {error && (
          <Alert data-testid="register-error" variant="error" className="break-all">
            {error}
          </Alert>
        )}
        <Button type="submit" variant="primary" isLoading={isPending} className="mt-1.5">
          Create account
        </Button>
      </form>
      <div className="flex-1" />
      <p className="text-center text-sm font-semibold text-text-secondary">
        Already have an account?{" "}
        <Link href="/login" className="font-bold text-sky-cyan hover:text-lavender">
          Log in
        </Link>
      </p>
    </main>
  );
}
