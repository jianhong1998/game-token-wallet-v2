import { redirect } from "next/navigation";
import { getCurrentUsername } from "@/server/actions/auth";
import { listMyMemberGames } from "@/server/actions/game";
import { LogoutButton } from "../LogoutButton";

function initials(username: string): string {
  return username.slice(0, 2).toUpperCase();
}

export default async function AccountPage() {
  const username = await getCurrentUsername();
  if (!username) {
    redirect("/login");
    return;
  }

  const games = await listMyMemberGames();

  return (
    <main className="py-8 flex flex-col items-center gap-5">
      <div
        data-testid="account-avatar"
        className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-primary text-lg font-extrabold text-ink"
      >
        {initials(username)}
      </div>
      <p className="text-lg font-extrabold text-text-primary">{username}</p>
      <p data-testid="account-game-count" className="text-sm font-semibold text-text-secondary">
        {games.length} {games.length === 1 ? "game" : "games"}
      </p>
      <LogoutButton />
    </main>
  );
}
