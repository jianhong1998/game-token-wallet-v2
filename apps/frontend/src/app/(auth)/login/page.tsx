"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
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
      try {
        const result = await loginUser({ username, password });
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
      <h1 className="bg-gradient-primary bg-clip-text text-3xl font-extrabold text-transparent">
        Kitty
      </h1>
      <p className="mt-2 text-sm font-semibold text-text-secondary">
        Tokenize your table — no wallet, no seed phrase, just a username and password.
      </p>
      <form onSubmit={handleSubmit} className="mt-10 flex flex-col gap-3.5">
        <div>
          <label htmlFor="login-username" className="mb-1.5 block text-[11px] font-bold text-text-primary">
            Username
          </label>
          <Input
            id="login-username"
            type="text"
            placeholder="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            required
          />
        </div>
        <div>
          <label htmlFor="login-password" className="mb-1.5 block text-[11px] font-bold text-text-primary">
            Password
          </label>
          <Input
            id="login-password"
            type="password"
            placeholder="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </div>
        {error && (
          <Alert data-testid="login-error" variant="error" className="break-all">
            {error}
          </Alert>
        )}
        <Button type="submit" variant="primary" isLoading={isPending} className="mt-1.5">
          Log in
        </Button>
      </form>
      <div className="flex-1" />
      <p className="text-center text-sm font-semibold text-text-secondary">
        New here?{" "}
        <Link href="/register" className="font-bold text-sky-cyan hover:text-lavender">
          Create an account
        </Link>
      </p>
    </>
  );
}
