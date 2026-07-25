import { redirect } from "next/navigation";
import { getCurrentUsername } from "@/server/actions/auth";
import { LogoutButton } from "./LogoutButton";

export default async function HomePage() {
  const username = await getCurrentUsername();

  if (!username) {
    redirect("/login");
  }

  return (
    <main className="py-8 flex flex-col gap-5">
      <h1 data-testid="home-welcome" className="text-xl font-extrabold text-text-primary">
        Welcome, {username}
      </h1>
      <LogoutButton />
    </main>
  );
}
