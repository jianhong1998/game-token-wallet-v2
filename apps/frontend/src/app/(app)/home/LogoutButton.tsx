"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { logoutUser } from "@/server/actions/auth";
import { Button } from "@/components/ui/button";

export function LogoutButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      await logoutUser();
      router.push("/login");
    });
  }

  return (
    <Button type="button" variant="secondary" onClick={handleClick} isLoading={isPending}>
      Log out
    </Button>
  );
}
