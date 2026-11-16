"use client";
import { usePlayers } from "frontend/context/players";
import { trpc } from "frontend/utils/trpc-client";
import { useSession } from "next-auth/react";
import { useRouter } from "next/router";
import { useState } from "react";

/**
 * Global, page-independent admin launcher — a floating button (bottom-left) that opens the
 * out-of-match admin tools on ANY page, mounted in `_app.tsx` beside the matchmaking surfaces.
 *
 * Rendered only for admins (session role), but that's convenience: every `admin.*` procedure
 * re-checks the `adminTools` capability server-side, so hiding the button grants nothing.
 *
 * Two tools: force a match between two players, and set a player's visible rank. Each acts through
 * `trpc.admin.*` and carries the acting admin's own `playerId` (the base procedure requires it).
 */

type PickedPlayer = { id: string; name: string };

/** Search-and-pick a player by name. Self-contained so the two tools reuse it. */
function PlayerPicker({
  playerId,
  label,
  picked,
  onPick,
}: {
  playerId: string;
  label: string;
  picked: PickedPlayer | null;
  onPick: (player: PickedPlayer | null) => void;
}) {
  const [query, setQuery] = useState("");
  const results = trpc.admin.searchPlayers.useQuery(
    { playerId, query },
    { enabled: query.trim().length >= 1 && picked === null },
  );

  if (picked !== null) {
    return (
      <div className="@flex @items-center @justify-between @gap-2">
        <span className="@text-xs @opacity-70">{label}</span>
        <button
          className="@rounded @bg-white/15 @px-2 @py-0.5 @text-xs hover:@bg-white/25"
          onClick={() => onPick(null)}
        >
          {picked.name} ✕
        </button>
      </div>
    );
  }

  return (
    <div className="@py-0.5">
      <div className="@pb-0.5 @text-xs @opacity-70">{label}</div>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="search name…"
        className="@w-full @rounded @border @border-white/20 @bg-slate-800 @px-1.5 @py-0.5 @text-xs @text-white"
      />
      {query.trim().length >= 1 && (
        <div className="@mt-1 @max-h-28 @overflow-y-auto @rounded @bg-black/40">
          {(results.data ?? []).map((player) => (
            <button
              key={player.id}
              className="@block @w-full @px-1.5 @py-0.5 @text-left @text-xs hover:@bg-white/15"
              onClick={() => onPick({ id: player.id, name: player.name })}
            >
              {player.name}
            </button>
          ))}
          {results.data?.length === 0 && (
            <p className="@px-1.5 @py-0.5 @text-xs @opacity-50">no matches</p>
          )}
        </div>
      )}
    </div>
  );
}

const MODES = [
  { value: "duel", label: "1v1" },
  { value: "teams", label: "2v2" },
  { value: "ffa", label: "FFA" },
] as const;

const RANKS = ["private", "lieutenant", "captain", "marechal"] as const;

export function AdminFlyout() {
  const { data: session } = useSession();
  const { currentPlayer } = usePlayers();
  const router = useRouter();

  const [open, setOpen] = useState(false);
  // Typed so the banner can be loud and unmissable — the earlier tiny grey line read as "nothing
  // happened", since a rank change isn't visible anywhere else on screen.
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // Force-match state. No map here — a custom (non-queue) forced match picks its map in the setup
  // panel the admin lands in; two queued players get the queue's own map pick&ban.
  const [playerA, setPlayerA] = useState<PickedPlayer | null>(null);
  const [playerB, setPlayerB] = useState<PickedPlayer | null>(null);

  // Play-as (impersonate) state. The picker works today; the action does not — there is no backend
  // impersonation endpoint yet, so the button is deliberately inert (see the disabled control below).
  const [impersonatePlayer, setImpersonatePlayer] = useState<PickedPlayer | null>(null);

  // Modify-rank state.
  const [rankPlayer, setRankPlayer] = useState<PickedPlayer | null>(null);
  const [mode, setMode] = useState<(typeof MODES)[number]["value"]>("duel");
  const [rank, setRank] = useState<(typeof RANKS)[number]>("captain");
  const [division, setDivision] = useState(3);

  const utils = trpc.useContext();
  const forceMatch = trpc.admin.forceMatch.useMutation({
    onError: (e) => setNotice({ kind: "err", text: e.message }),
    onSuccess: (result) => {
      if (result.kind === "lobby") {
        // Non-queue path: you host the custom match — land in its setup panel to start it.
        setNotice({ kind: "ok", text: "Custom match created — opening the setup panel…" });
        void router.push(`/lobby/${result.lobbyId}`);
        return;
      }

      // Both were queued: they were paired there and get the ready-check on their own screens.
      setNotice({
        kind: "ok",
        text: `Paired ${result.playerAName} and ${result.playerBName} from the queue — ready-check sent.`,
      });
    },
  });
  const modifyRank = trpc.admin.modifyRank.useMutation({
    onError: (e) => setNotice({ kind: "err", text: e.message }),
    // Echo exactly what was set — the write is otherwise invisible, so a bare "done" reads as a no-op.
    onSuccess: (_data, vars) => {
      setNotice({
        kind: "ok",
        text: `Set rank to ${vars.rank}${vars.rank === "marechal" ? "" : ` ${vars.division}`} (${vars.mode}).`,
      });
      // Refresh the acting admin's own ladder so a self-set rank updates without a manual reload.
      // (Another player's live session can't be pushed to from here — it refetches on next load.)
      void utils.ranking.myRank.invalidate();
    },
  });

  // Admins only. The server enforces the real gate; this just hides the button from everyone else.
  // Also needs a selected player — the admin acts through their own player (the base procedure).
  if (currentPlayer === undefined || session?.user?.roles?.includes("admin") !== true) {
    return null;
  }

  // Not on the immersive match/pick views: this floating button sits bottom-left, right over the
  // chat entry there. In-game admin tools (force outcome, dev tools) live in the board's dev-tools
  // panel instead; this flyout is for the out-of-game tools (force match, modify rank).
  if (router.pathname.startsWith("/match2") || router.pathname.startsWith("/pick")) {
    return null;
  }

  const currentPlayerId = currentPlayer.id;

  const canForce = playerA !== null && playerB !== null;

  return (
    <div className="@fixed @bottom-3 @left-3 @z-[60]">
      {open && (
        <div className="@mb-2 @w-72 @rounded-lg @border @border-purple-500/50 @bg-black/90 @p-2 @text-white @shadow-xl @shadow-black/60">
          <div className="@flex @items-center @justify-between @pb-1">
            <span className="@text-xs @font-bold @text-purple-300">ADMIN TOOLS</span>
            <button
              className="@text-xs @opacity-70 hover:@opacity-100"
              onClick={() => setOpen(false)}
            >
              ✕
            </button>
          </div>

          {/* Loud, top-of-panel result banner — the write is invisible elsewhere, so this is the
              only signal the admin gets that a click did (or didn't) do something. */}
          {notice !== null && (
            <div
              className={`@mb-2 @rounded @px-2 @py-1 @text-xs ${
                notice.kind === "ok"
                  ? "@bg-emerald-600/30 @text-emerald-200"
                  : "@bg-red-600/30 @text-red-200"
              }`}
            >
              {notice.text}
            </div>
          )}

          {/* Force match ------------------------------------------------------------------ */}
          <div className="@rounded @bg-white/5 @p-1.5">
            <div className="@pb-1 @text-xs @font-semibold @opacity-80">Force match</div>
            <PlayerPicker
              playerId={currentPlayerId}
              label="Player A"
              picked={playerA}
              onPick={setPlayerA}
            />
            <PlayerPicker
              playerId={currentPlayerId}
              label="Player B"
              picked={playerB}
              onPick={setPlayerB}
            />
            <p className="@py-0.5 @text-[10px] @leading-tight @opacity-50">
              If both are queued they’re paired there; otherwise a custom match opens in the setup
              panel where you pick the map.
            </p>
            <button
              disabled={!canForce || forceMatch.isLoading}
              className="@mt-1 @w-full @rounded @bg-purple-500/30 @py-1 @text-xs hover:@bg-purple-500/50 disabled:@opacity-40"
              onClick={() => {
                if (playerA !== null && playerB !== null) {
                  forceMatch.mutate({
                    playerId: currentPlayerId,
                    playerAId: playerA.id,
                    playerBId: playerB.id,
                  });
                }
              }}
            >
              Force match
            </button>
          </div>

          {/* Modify rank ------------------------------------------------------------------ */}
          <div className="@mt-2 @rounded @bg-white/5 @p-1.5">
            <div className="@pb-1 @text-xs @font-semibold @opacity-80">Modify rank</div>
            <PlayerPicker
              playerId={currentPlayerId}
              label="Player"
              picked={rankPlayer}
              onPick={setRankPlayer}
            />
            <div className="@flex @items-center @gap-1 @py-0.5">
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value as (typeof MODES)[number]["value"])}
                className="@rounded @border @border-white/20 @bg-slate-800 @px-1 @text-xs @text-white"
              >
                {MODES.map((m) => (
                  <option key={m.value} value={m.value} className="@bg-slate-800">
                    {m.label}
                  </option>
                ))}
              </select>
              <select
                value={rank}
                onChange={(e) => setRank(e.target.value as (typeof RANKS)[number])}
                className="@rounded @border @border-white/20 @bg-slate-800 @px-1 @text-xs @text-white @capitalize"
              >
                {RANKS.map((r) => (
                  <option key={r} value={r} className="@bg-slate-800">
                    {r}
                  </option>
                ))}
              </select>
              {/* Division is ignored for marechal (no divisions) — disable it there to say so. */}
              <select
                value={division}
                disabled={rank === "marechal"}
                onChange={(e) => setDivision(Number(e.target.value))}
                className="@rounded @border @border-white/20 @bg-slate-800 @px-1 @text-xs @text-white disabled:@opacity-40"
              >
                {[1, 2, 3, 4, 5].map((d) => (
                  <option key={d} value={d} className="@bg-slate-800">
                    {d}
                  </option>
                ))}
              </select>
            </div>
            <button
              disabled={rankPlayer === null || modifyRank.isLoading}
              className="@mt-1 @w-full @rounded @bg-purple-500/30 @py-1 @text-xs hover:@bg-purple-500/50 disabled:@opacity-40"
              onClick={() => {
                if (rankPlayer !== null) {
                  modifyRank.mutate({
                    playerId: currentPlayerId,
                    targetPlayerId: rankPlayer.id,
                    mode,
                    rank,
                    division,
                  });
                }
              }}
            >
              Apply rank
            </button>
          </div>

          {/* Play as (impersonate) -------------------------------------------------------- */}
          <div className="@mt-2 @rounded @bg-white/5 @p-1.5">
            <div className="@flex @items-center @justify-between @pb-1">
              <span className="@text-xs @font-semibold @opacity-80">Play as</span>
              <span className="@rounded @border @border-purple-400/40 @px-1.5 @py-0.5 @text-[9px] @font-bold @uppercase @tracking-widest @text-purple-300">
                Soon
              </span>
            </div>
            <PlayerPicker
              playerId={currentPlayerId}
              label="Impersonate"
              picked={impersonatePlayer}
              onPick={setImpersonatePlayer}
            />
            <button
              disabled
              title="Impersonation isn't wired on the backend yet"
              className="@mt-1 @w-full @cursor-not-allowed @rounded @bg-purple-500/30 @py-1 @text-xs @opacity-40"
            >
              Coming soon
            </button>
          </div>
        </div>
      )}

      <button
        onClick={() => setOpen((o) => !o)}
        className="@rounded-full @border @border-purple-500/60 @bg-black/80 @px-3 @py-1.5 @text-xs @font-bold @text-purple-200 @shadow-lg hover:@bg-black"
      >
        ADMIN
      </button>
    </div>
  );
}
