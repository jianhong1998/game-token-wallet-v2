import { redirect, notFound } from "next/navigation";
import { getCurrentUsername } from "@/server/actions/auth";
import { fetchGameDetail } from "@/server/actions/game";
import { gameModeLabel } from "@/lib/game-mode";
import AdminControlsModal from "./AdminControlsModal";

export default async function GameDetailPage({
  params,
}: {
  params: Promise<{ address: string }>;
}) {
  const username = await getCurrentUsername();
  if (!username) {
    redirect("/login");
    // Explicit early return: production `redirect()` throws and never returns, but the
    // test's mocked `redirect` is a bare `vi.fn()` that doesn't — without this, execution
    // would fall through to the unmocked `params`/`fetchGameDetail()` calls below and crash.
    return;
  }

  const { address } = await params;
  const game = await fetchGameDetail(address);
  if (!game) {
    notFound();
    return;
  }

  return (
    <main className="py-8 flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-extrabold text-text-primary">{game.name}</h1>
          <p className="text-xs font-semibold text-cyan-accent">{gameModeLabel(game.mode)}</p>
        </div>
        {game.isAdmin && (
          <span
            data-testid="game-admin-badge"
            className="rounded-full bg-cyan-accent/20 px-3 py-1 text-xs font-bold text-cyan-accent"
          >
            Admin
          </span>
        )}
      </div>

      <div className="glass-row px-4 py-4">
        <p className="text-[11px] font-bold uppercase tracking-wide text-text-secondary">
          Your balance
        </p>
        <p data-testid="my-balance" className="text-2xl font-bold text-text-primary">
          {game.myBalance.toFixed(2)}
        </p>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-extrabold text-text-primary">Players</h2>
        <ul className="flex flex-col gap-2" data-testid="players-list">
          {game.players.map((player) => (
            <li
              key={player.username}
              className="glass-row flex items-center justify-between px-4 py-3"
            >
              <span className="text-sm font-bold text-text-primary">{player.username}</span>
              <span className="flex items-center gap-2">
                {player.isAdmin && (
                  <span className="text-xs font-semibold text-cyan-accent">Admin</span>
                )}
                <span className="text-sm font-bold text-text-primary">
                  {player.balance.toFixed(2)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </div>

      {game.isAdmin && <AdminControlsModal gameAddress={game.address} players={game.players} />}
    </main>
  );
}
