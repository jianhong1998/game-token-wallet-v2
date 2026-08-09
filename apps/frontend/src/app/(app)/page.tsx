import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUsername } from "@/server/actions/auth";
import { listMyMemberGames } from "@/server/actions/game";
import { gameModeLabel } from "@/lib/game-mode";
import { Button } from "@/components/ui/button";

export default async function HomePage() {
  const username = await getCurrentUsername();
  if (!username) {
    redirect("/login");
    return;
  }

  const games = await listMyMemberGames();

  return (
    <main className="py-8 flex flex-col gap-5">
      <h1 className="text-xl font-extrabold text-text-primary">Your games</h1>
      {games.length === 0 ? (
        <div data-testid="home-empty" className="flex flex-col gap-4">
          <p className="text-sm font-semibold text-text-secondary">
            You haven&apos;t joined or created any games yet.
          </p>
          <div className="flex gap-3">
            <Button asChild variant="primary">
              <Link href="/games/new">Create</Link>
            </Button>
            <Button asChild variant="secondary">
              <Link href="/games/all">Browse</Link>
            </Button>
          </div>
        </div>
      ) : (
        <>
          <ul className="flex flex-col gap-3" data-testid="home-games-list">
            {games.map((game) => (
              <li key={game.address}>
                <Link
                  href={`/games/${game.address}`}
                  data-testid={`home-game-${game.address}`}
                  className="glass-row flex items-center justify-between px-4 py-3"
                >
                  <div>
                    <div className="text-sm font-bold text-text-primary">{game.name}</div>
                    <div className="text-xs font-semibold text-text-secondary">
                      {gameModeLabel(game.mode)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {game.isAdmin && (
                      <span className="text-xs font-semibold text-cyan-accent">Admin</span>
                    )}
                    <span className="text-sm font-bold text-text-primary">
                      {game.balance.toFixed(2)}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          <Button asChild variant="primary" className="self-start">
            <Link href="/games/new">Create</Link>
          </Button>
        </>
      )}
    </main>
  );
}
