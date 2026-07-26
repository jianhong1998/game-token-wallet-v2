import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUsername } from "@/server/actions/auth";
import { listMyGames } from "@/server/actions/game";
import { Button } from "@/components/ui/button";

export default async function GamesPage() {
  const username = await getCurrentUsername();
  if (!username) {
    redirect("/login");
    // Explicit early return: production `redirect()` throws and never returns, but the
    // test's mocked `redirect` is a bare `vi.fn()` that doesn't — without this, execution
    // would fall through to the unmocked `listMyGames()` call below and crash.
    return;
  }

  const games = await listMyGames();

  return (
    <main className="py-8 flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-extrabold text-text-primary">My games</h1>
        <Button asChild variant="primary">
          <Link href="/games/new">New game</Link>
        </Button>
      </div>
      {games.length === 0 ? (
        <p data-testid="games-empty" className="text-sm font-semibold text-text-secondary">
          You haven&apos;t created a game yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-3" data-testid="games-list">
          {games.map((game) => (
            <li
              key={game.address}
              className="glass-row flex items-center justify-between px-4 py-3"
            >
              <span className="text-sm font-bold text-text-primary">{game.name}</span>
              <span className="text-xs font-semibold text-cyan-accent">Admin</span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
