import { formatTimeControl } from "frontend/utils/format-time";
import { usePlayers } from "frontend/context/players";
import { useQueue } from "frontend/context/matchmaking";
import { trpc } from "frontend/utils/trpc-client";
import { unitSpriteUrl, type UnitType } from "frontend/utils/sprites";
import { useEffect, useMemo, useState } from "react";
import MapThumbnail from "./MapThumbnail";

const useNow = (): number => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);
  return now;
};

const mmss = (ms: number): string => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

// Map-specific property breakdown shown in the dossier (same palette as the board's minimap).
const PROPERTY_META: { key: string; label: string; color: string }[] = [
  { key: "city", label: "Cities", color: "#8aa0b6" },
  { key: "base", label: "Factories", color: "#c07a3e" },
  { key: "airport", label: "Airports", color: "#6fb1c9" },
  { key: "port", label: "Ports", color: "#4f79b0" },
  { key: "commtower", label: "Comm Towers", color: "#8f6fc0" },
  { key: "lab", label: "Labs", color: "#5fb08a" },
];

const FORCES: UnitType[] = ["Infantry", "Tank", "Artillery", "Anti-Air", "B-Copter", "Battleship"];

/**
 * FE-local mirror of the server's `BANS_PER_PLAYER` (matchmaking/constants.ts) — the FE never imports
 * backend code. Only ever used to render progress ("1/2"); the server owns whether a ban is allowed.
 */
const BANS_PER_PLAYER = 2;

/**
 * Map pick & ban — a command-console fusion of the CO picker (timed roster + focused dossier) and the
 * custom-lobby war room (map details, rules, property legend). Focus a map to study it, then confirm
 * a ban or a vote. Once both players vote, the winning map is locked and this screen flips to a
 * `MAP LOCKED` reveal for a shared study window before the CO pick.
 *
 * BOTH DECISIONS ARE BLIND, like the CO pick that follows. You ban without seeing your opponent's
 * bans (they reveal once you've both spent them, which is what opens the vote), and you vote without
 * seeing theirs (revealed with the rolled map). The opponent card is the whole tell: it shows
 * *progress*, never content. The masking is the server's — `mapBanView` simply doesn't send what you
 * may not see — so this file has nothing to hide and no way to leak.
 *
 * Drives off `matchmaking.mapBanView` (enriched with terrain + details), refetched on `lobby.onUpdate`.
 */
export default function MapBanScreen() {
  const { state } = useQueue();
  const { currentPlayer } = usePlayers();
  const playerId = currentPlayer?.id ?? "";
  const utils = trpc.useUtils();
  const now = useNow();

  const lobbyId = state.phase === "map" ? state.lobbyId : "";
  const [focusedId, setFocusedId] = useState<string | null>(null);

  const { data } = trpc.matchmaking.mapBanView.useQuery(
    { lobbyId, playerId },
    { enabled: lobbyId !== "" && playerId !== "" },
  );

  const refresh = () => void utils.matchmaking.mapBanView.invalidate({ lobbyId });
  trpc.lobby.onUpdate.useSubscription(
    { lobbyId, playerId },
    { enabled: lobbyId !== "" && playerId !== "", onData: refresh },
  );

  const banMap = trpc.matchmaking.banMap.useMutation({ onSuccess: refresh });
  const voteMap = trpc.matchmaking.voteMap.useMutation({ onSuccess: refresh });

  const me = data?.players.find((p) => p.playerId === playerId);
  const opponent = data?.players.find((p) => p.playerId !== playerId);
  const myBans = me?.bannedMapIds ?? [];
  const allBans = useMemo(
    () => new Set((data?.players ?? []).flatMap((p) => p.bannedMapIds)),
    [data],
  );

  // Keep a valid focus: the chosen map while revealing, else the current focus, else the first map.
  const revealing = data?.status === "map_reveal";
  const activeId =
    (revealing ? data?.chosenMapId : null) ??
    focusedId ??
    data?.pool.find((m) => !allBans.has(m.id))?.id ??
    data?.pool[0]?.id ??
    null;
  const focused = data?.pool.find((m) => m.id === activeId);

  if (state.phase !== "map" || data === undefined) {
    return null;
  }

  // The stage is the SERVER's, not `myBans.length`: it flips only when both players have banned, so
  // finishing first means waiting rather than voting into a half-revealed board.
  const phase = data.stage;
  const waitingOnBans = phase === "ban" && myBans.length >= BANS_PER_PLAYER;
  const remaining =
    data.mapPhaseEndsAt !== null ? new Date(data.mapPhaseEndsAt).getTime() - now : 0;
  const rules = data.rules;

  /**
   * The opponent tell: a portrait-sized card reporting only how far along they are — never what they
   * banned or voted for. Mirrors the CO picker's `choosing… / locked` roster tile.
   */
  const opponentCard = () => {
    if (opponent === undefined) {
      return null;
    }

    const status = revealing
      ? "Ready"
      : phase === "ban"
        ? opponent.banCount >= BANS_PER_PLAYER
          ? "Bans locked ✓"
          : `Banning… ${opponent.banCount}/${BANS_PER_PLAYER}`
        : opponent.hasVoted
          ? "Vote locked ✓"
          : "Choosing map…";
    const done =
      revealing || (phase === "ban" ? opponent.banCount >= BANS_PER_PLAYER : opponent.hasVoted);

    return (
      <div
        className={`@flex @items-center @gap-2 @rounded-lg @px-2.5 @py-1.5 @transition ${
          done ? "@bg-white/10" : "@bg-black/30"
        }`}
      >
        <div className="@flex @h-9 @w-9 @flex-none @items-center @justify-center @rounded @bg-black/40 @font-russoOne @text-sm @text-slate-500">
          {done ? <span className="@text-emerald-400">✓</span> : "?"}
        </div>
        <div className="@min-w-0">
          <p className="@truncate @py-0 @text-xs @font-semibold @leading-tight">{opponent.name}</p>
          <p className="@py-0 @text-[10px] @uppercase @tracking-wide @text-slate-400">{status}</p>
        </div>
      </div>
    );
  };

  /** A vote's map name for the reveal line ("—" when they never cast one before the deadline). */
  const mapName = (mapId: string | null | undefined): string =>
    data.pool.find((m) => m.id === mapId)?.name ?? "—";

  const dossier = (map: NonNullable<typeof focused>) => {
    const banned = allBans.has(map.id);
    const bannedByMe = myBans.includes(map.id);
    const canBanThis = phase === "ban" && !bannedByMe && !waitingOnBans && !revealing;
    const canVoteThis = phase === "vote" && !banned && me?.votedMapId == null && !revealing;

    return (
      <div className="@flex @flex-col @gap-3">
        <div className="@overflow-hidden @rounded-lg @outline @outline-1 @outline-white/10">
          <MapThumbnail terrain={map.terrain} className="@w-full @bg-black/40" />
        </div>

        <div className="@flex @items-end @justify-between @gap-2">
          <h3 className="@min-w-0 @truncate @py-0 @font-russoOne @text-xl @uppercase @tracking-wide">
            {map.name}
          </h3>
          <span className="@flex-none @py-0 @font-mono @text-xs @text-slate-400">
            {map.width}×{map.height} · {map.numberOfPlayers}P
          </span>
        </div>

        <div className="@flex @flex-wrap @gap-1.5">
          {[
            rules.fogOfWar ? "Fog of War" : "Clear skies",
            `$${rules.fundsPerProperty}/prop`,
            `${rules.dayLimit}-day limit`,
            formatTimeControl(rules.turnBankSeconds, rules.turnIncrementSeconds),
            "Ranked",
          ]
            .filter((chip): chip is string => chip !== null)
            .map((chip) => (
              <span
                key={chip}
                className="@rounded @bg-black/30 @px-2 @py-1 @text-[11px] @font-semibold @uppercase @tracking-wide @text-slate-300"
              >
                {chip}
              </span>
            ))}
        </div>

        <div className="@grid @grid-cols-2 @gap-x-4 @gap-y-1 @text-xs">
          {PROPERTY_META.map(({ key, label, color }) => {
            const count = (map.propertyStats as Record<string, number>)[key] ?? 0;

            if (count === 0) {
              return null;
            }

            return (
              <div key={key} className="@flex @items-center @gap-2">
                <span
                  className="@h-2.5 @w-2.5 @flex-none @rounded-sm"
                  style={{ background: color }}
                />
                <span className="@text-slate-300">{label}</span>
                <span className="@ml-auto @font-mono @text-slate-500">×{count}</span>
              </div>
            );
          })}
        </div>

        <div className="@flex @gap-2 @border-t @border-white/5 @pt-3">
          {FORCES.map((unit) => (
            <img
              key={unit}
              src={unitSpriteUrl(unit)}
              alt={unit}
              title={unit}
              className="@h-7 @w-7 @rounded @bg-black/20 @p-0.5 [image-rendering:pixelated]"
            />
          ))}
        </div>

        {!revealing && (
          <button
            disabled={(!canBanThis && !canVoteThis) || banMap.isLoading || voteMap.isLoading}
            onClick={() =>
              canBanThis
                ? banMap.mutate({ lobbyId, playerId, mapId: map.id })
                : voteMap.mutate({ lobbyId, playerId, mapId: map.id })
            }
            className={`@mt-1 @w-full @rounded-lg @py-3 @font-russoOne @text-sm @uppercase @tracking-wider @transition disabled:@cursor-not-allowed disabled:@opacity-40 ${
              canVoteThis
                ? "@bg-primary @text-black hover:@brightness-110"
                : "@border @border-red-500/50 @text-red-300 hover:@border-red-500 hover:@text-white"
            }`}
          >
            {bannedByMe
              ? "You banned this"
              : waitingOnBans
                ? "Waiting for opponent's bans…"
                : banned
                  ? "Banned by opponent"
                  : phase === "ban"
                    ? `⛔ Ban ${map.name}`
                    : me?.votedMapId != null
                      ? "Vote locked in"
                      : `✓ Vote ${map.name}`}
          </button>
        )}
      </div>
    );
  };

  return (
    <div
      className="@fixed @inset-0 @z-50 @flex @items-center @justify-center @overflow-y-auto @p-4 @text-white"
      style={{ background: "radial-gradient(85% 65% at 50% 0%, #1e2b46e6, #0a0c11f7)" }}
    >
      <div className="@w-full @max-w-[1100px] @rounded-2xl @border @border-bg-tertiary @bg-[#12151c]/95 @p-5 @shadow-2xl @shadow-black/60">
        {/* Command bar */}
        <header className="@mb-4 @flex @flex-wrap @items-center @gap-3 @border-b @border-white/10 @pb-3">
          <span className="@font-russoOne @text-lg @uppercase @tracking-widest @text-primary">
            {revealing ? "Map Locked" : "Map Pick & Ban"}
          </span>
          {!revealing && (
            <div className="@flex @items-center @gap-1.5 @text-[11px] @font-semibold @uppercase @tracking-wide">
              <span
                className={`@rounded @px-2 @py-1 ${phase === "ban" ? "@bg-primary @text-black" : "@bg-black/30 @text-slate-500"}`}
              >
                1 · Ban {Math.max(0, BANS_PER_PLAYER - myBans.length)}
              </span>
              <span className="@text-slate-600">→</span>
              <span
                className={`@rounded @px-2 @py-1 ${phase === "vote" ? "@bg-primary @text-black" : "@bg-black/30 @text-slate-500"}`}
              >
                2 · Vote
              </span>
            </div>
          )}
          <div className="@ml-auto @flex @items-center @gap-3">
            {opponentCard()}
            <span className="@text-xs @uppercase @tracking-wide @text-slate-400">
              {revealing ? "Generals deploy in" : "Phase ends in"}
            </span>
            <span
              className="@rounded-lg @border @border-bg-tertiary @bg-black/30 @px-3 @py-1.5 @font-mono @text-lg @font-bold @tabular-nums"
              style={{ color: remaining < 10_000 ? "#e0a53b" : "#fff" }}
            >
              {mmss(remaining)}
            </span>
          </div>
        </header>

        {revealing ? (
          // ── MAP LOCKED reveal ──────────────────────────────────────────────
          <div className="@mx-auto @max-w-[560px] @py-2">
            {focused !== undefined && (
              <>
                <p className="@mb-3 @py-0 @text-center @text-xs @uppercase @tracking-[0.3em] @text-primary-light">
                  Battlefield selected
                </p>
                {dossier(focused)}
                {/* Now that it's rolled, show how it was rolled — both votes, finally unmasked. */}
                <p className="@mt-3 @py-0 @text-center @text-xs @text-slate-500">
                  You voted <span className="@text-slate-300">{mapName(me?.votedMapId)}</span> · Foe
                  voted <span className="@text-slate-300">{mapName(opponent?.votedMapId)}</span>
                </p>
                <p className="@mt-2 @py-0 @text-center @text-sm @text-slate-400">
                  Study the terrain — the general pick begins when the timer ends.
                </p>
              </>
            )}
          </div>
        ) : (
          // ── Ban / vote console ─────────────────────────────────────────────
          <div className="@grid @gap-5 laptop:@grid-cols-[1fr_360px]">
            {/* Roster of candidate maps */}
            <div className="@grid @grid-cols-2 @gap-3 tablet:@grid-cols-3 @content-start">
              {data.pool.map((map) => {
                const banned = allBans.has(map.id);
                const bannedByMe = myBans.includes(map.id);
                // Only ever true after the reveal — until then the server sends no opponent bans.
                const bannedByOpp = opponent?.bannedMapIds.includes(map.id) === true;
                const votedByMe = me?.votedMapId === map.id;
                // Likewise: the opponent's vote arrives only with the rolled map.
                const votedByOpp = opponent?.votedMapId === map.id;
                const isFocused = map.id === activeId;

                return (
                  <button
                    key={map.id}
                    onClick={() => setFocusedId(map.id)}
                    className={`@group @relative @flex @flex-col @gap-2 @overflow-hidden @rounded-xl @border @p-2 @text-left @transition ${
                      isFocused
                        ? "@border-primary @bg-primary/10"
                        : "@border-bg-tertiary @bg-black/20 hover:@border-primary-light"
                    } ${banned ? "@opacity-50" : ""}`}
                  >
                    <div className="@relative @overflow-hidden @rounded-md">
                      <MapThumbnail terrain={map.terrain} className="@w-full" />
                      {banned && (
                        <span className="@absolute @inset-0 @flex @items-center @justify-center @bg-black/55 @text-[10px] @font-bold @uppercase @tracking-[0.2em] @text-red-300">
                          Banned
                        </span>
                      )}
                    </div>
                    <div className="@flex @items-center @justify-between @gap-1">
                      <span className="@min-w-0 @truncate @text-xs @font-semibold">{map.name}</span>
                      <span className="@flex-none @font-mono @text-[10px] @text-slate-500">
                        {map.numberOfPlayers}P
                      </span>
                    </div>
                    {/* Status badges */}
                    <div className="@absolute @left-2 @top-2 @flex @gap-1">
                      {bannedByMe && (
                        <span className="@rounded @bg-[#4a7bd6] @px-1.5 @py-0.5 @text-[9px] @font-bold @uppercase @text-white">
                          You
                        </span>
                      )}
                      {bannedByOpp && (
                        <span className="@rounded @bg-primary @px-1.5 @py-0.5 @text-[9px] @font-bold @uppercase @text-black">
                          Foe
                        </span>
                      )}
                      {votedByMe && !banned && (
                        <span className="@rounded @bg-[#4a7bd6] @px-1.5 @py-0.5 @text-[9px] @font-bold @uppercase @text-white">
                          Your vote
                        </span>
                      )}
                      {votedByOpp && !banned && (
                        <span className="@rounded @bg-primary @px-1.5 @py-0.5 @text-[9px] @font-bold @uppercase @text-black">
                          Foe vote
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Focused-map dossier + confirm */}
            <div className="@rounded-xl @border @border-white/10 @bg-bg-secondary/50 @p-4">
              {focused !== undefined ? (
                dossier(focused)
              ) : (
                <p className="@py-8 @text-center @text-sm @text-slate-500">
                  Select a map to inspect.
                </p>
              )}
            </div>
          </div>
        )}

        {(banMap.error ?? voteMap.error) && (
          <p className="@mt-3 @py-0 @text-center @text-sm @text-red-400">
            {banMap.error?.message ?? voteMap.error?.message}
          </p>
        )}
      </div>
    </div>
  );
}
