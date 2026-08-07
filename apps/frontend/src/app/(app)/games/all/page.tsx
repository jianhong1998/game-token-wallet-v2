import { redirect } from "next/navigation";
import { getCurrentUsername } from "@/server/actions/auth";
import { listBrowseGames } from "@/server/actions/game";
import BrowseGameRow from "./BrowseGameRow";

export default async function GamesAllPage() {
  const username = await getCurrentUsername();
  if (!username) {
    redirect("/login");
    return;
  }

  const games = await listBrowseGames();

  return (
    <main className="py-8 flex flex-col gap-5">
      <h1 className="text-xl font-extrabold text-text-primary">Browse games</h1>
      {games.length === 0 ? (
        <p data-testid="browse-games-empty" className="text-sm font-semibold text-text-secondary">
          No active games right now.
        </p>
      ) : (
        <ul className="flex flex-col gap-3" data-testid="browse-games-list">
          {games.map((game) => (
            <BrowseGameRow key={game.address} game={game} />
          ))}
        </ul>
      )}
    </main>
  );
}
