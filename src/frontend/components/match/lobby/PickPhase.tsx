import { usePlayers } from "frontend/context/players";
import { trpc } from "frontend/utils/trpc-client";
import {
  AIR_UNITS,
  ARMY_HEX,
  CO_VERSION,
  coArtUrl,
  coPortraitUrl,
  engineUnitKey,
  LAND_UNITS,
  SEA_UNITS,
  unitLabel,
  unitSpriteUrl,
  type Army,
  type UnitType,
} from "frontend/utils/sprites";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";

type Props = { matchId: string };
type DossierTab = "overview" | "powers" | "forces";

const cleanName = (name: string) => name.replace(/^\[dev\]\s*/, "");
const stars = (n: number) => "★".repeat(n);

export default function PickPhase({ matchId }: Props) {
  const router = useRouter();
  const { currentPlayer } = usePlayers();
  const playerId = currentPlayer?.id ?? "";
  const utils = trpc.useUtils();

  const [picked, setPicked] = useState<string | null>(null);
  const [tab, setTab] = useState<DossierTab>("overview");
  const [now, setNow] = useState(() => Date.now());

  const { data: view, error } = trpc.matches.pickView.useQuery(
    { matchId, playerId },
    { enabled: playerId !== "", refetchInterval: 15000 },
  );
  const { data: codex } = trpc.matches.coCodex.useQuery();

  const invalidateView = () => void utils.matches.pickView.invalidate({ matchId });
  const lockCo = trpc.matches.lockCo.useMutation({ onSuccess: invalidateView });

  trpc.action.onEvent.useSubscription(
    { matchId, playerId },
    { enabled: playerId !== "", onData: invalidateView },
  );

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (view?.status === "playing") {
      void router.push(`/match2/${matchId}`);
    }
  }, [view?.status, matchId, router]);

  if (error) {
    return <p className="@p-8 @text-red-400">Pick error: {error.message}</p>;
  }

  if (view === undefined || codex === undefined) {
    return <p className="@p-8 @text-slate-400">Entering the war council…</p>;
  }

  const me = view.players.find((p) => p.playerId === playerId);
  const myTeam = me?.team ?? view.players[0]?.team ?? 0;
  const allies = view.players.filter((p) => p.team === myTeam);
  const enemies = view.players.filter((p) => p.team !== myTeam);
  const readyCount = view.players.filter((p) => p.ready).length;

  const selected = picked ?? me?.coId?.name ?? codex[0]?.name;
  const selectedEntry = codex.find((c) => c.name === selected);
  const factionHex = (team: number): string =>
    ARMY_HEX[(view.teamFactions?.[team] as Army | undefined) ?? "orange-star"];

  const secondsLeft =
    view.pickEndsAt !== null
      ? Math.max(0, Math.round((new Date(view.pickEndsAt).getTime() - now) / 1000))
      : null;
  const urgent = secondsLeft !== null && secondsLeft <= 30;

  const rosterTile = (p: (typeof view.players)[number], hideUnrevealed: boolean) => {
    const co = p.coId;
    const showFace = co !== null && (!hideUnrevealed || view.revealed);

    return (
      <div
        key={p.playerId}
        className={`@flex @items-center @gap-2 @rounded-md @p-1.5 @transition ${
          p.ready ? "@bg-white/10" : "@bg-black/25"
        }`}
        style={{ borderLeft: `3px solid ${factionHex(p.team)}` }}
      >
        <div className="@relative @h-11 @w-11 @flex-none @overflow-hidden @rounded @bg-black/40">
          {showFace ? (
            <img
              src={coPortraitUrl(co.name, "small")}
              alt={co.name}
              className="@h-full @w-full @object-cover [image-rendering:pixelated]"
            />
          ) : (
            <div className="@flex @h-full @w-full @items-center @justify-center @text-lg @text-slate-600">
              ?
            </div>
          )}
        </div>
        <div className="@min-w-0 @flex-1">
          <p className="@truncate @py-0 @text-xs @font-semibold @leading-tight">
            {cleanName(p.name)}
          </p>
          <p className="@py-0 @text-[10px] @uppercase @tracking-wide @text-slate-400">
            {showFace ? co.name : p.ready ? "locked" : "choosing…"}
          </p>
        </div>
        {p.ready && <span className="@flex-none @text-emerald-400">✓</span>}
      </div>
    );
  };

  const forces = selectedEntry?.forces ?? {};

  const statBadge = (label: string, value: number, suffix: string) => (
    <span
      key={label}
      className={`@font-mono @text-[9px] @leading-none ${
        value > 0 ? "@text-emerald-400" : "@text-red-400"
      }`}
    >
      {value > 0 ? "▲" : "▼"}
      {label} {value > 0 ? "+" : ""}
      {value}
      {suffix}
    </span>
  );

  const unitCell = (u: UnitType) => {
    const mod = forces[engineUnitKey(u)];
    const badges =
      mod !== undefined
        ? [
            mod.attackPct !== 0 && statBadge("ATK", mod.attackPct, "%"),
            mod.defensePct !== 0 && statBadge("DEF", mod.defensePct, "%"),
            mod.rangeDelta !== 0 && statBadge("RNG", mod.rangeDelta, ""),
            mod.movementDelta !== 0 && statBadge("MOV", mod.movementDelta, ""),
          ].filter(Boolean)
        : [];

    return (
      <div
        key={u}
        className={`@flex @w-14 @flex-col @items-center @gap-0.5 @rounded @p-1 @transition ${
          mod !== undefined ? "@bg-white/5 @ring-1 @ring-primary/40" : "@opacity-50"
        }`}
        title={unitLabel(u)}
      >
        <img
          src={unitSpriteUrl(u, (me?.army as Army) ?? "orange-star")}
          alt={u}
          className="@h-8 @w-8 [image-rendering:pixelated]"
        />
        <div className="@flex @min-h-[10px] @flex-col @items-center @gap-px">{badges}</div>
      </div>
    );
  };

  const unitRow = (label: string, units: readonly UnitType[]) => (
    <div className="@mb-3">
      <p className="@mb-1 @py-0 @text-[10px] @uppercase @tracking-[0.2em] @text-slate-500">
        {label}
      </p>
      <div className="@flex @flex-wrap @gap-1">{units.map(unitCell)}</div>
    </div>
  );

  return (
    <div
      className="@min-h-screen @text-white"
      style={{
        background: "radial-gradient(90% 55% at 50% -10%, #1e2b4688, transparent 60%), #0f1216",
      }}
    >
      {/* Command bar */}
      <header className="@flex @items-center @justify-between @gap-4 @border-b @border-white/10 @px-5 @py-3">
        <span className="@font-russoOne @text-sm @uppercase @tracking-widest @text-slate-400">
          Champion Select
        </span>
        <div className="@text-center">
          <p className="@py-0 @font-russoOne @text-xs @uppercase @tracking-[0.3em] @text-primary">
            {view.revealed ? "Commanders revealed" : "Select your general"}
          </p>
          {secondsLeft !== null && (
            <p
              className={`@py-0 @font-mono @text-2xl @leading-tight ${urgent ? "@text-red-400" : "@text-white"}`}
            >
              {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, "0")}
            </p>
          )}
        </div>
        <span className="@font-mono @text-xs @text-slate-400">
          {readyCount}/{view.players.length} ready
        </span>
      </header>

      <div className="@mx-auto @grid @max-w-[1500px] @gap-4 @px-4 @py-5 laptop:@grid-cols-[210px_1fr_210px]">
        {/* Allies */}
        <aside className="@flex @flex-col @gap-2">
          <p
            className="@py-0 @text-[11px] @uppercase @tracking-[0.2em]"
            style={{ color: factionHex(myTeam) }}
          >
            Your team
          </p>
          {allies.map((p) => rosterTile(p, false))}
        </aside>

        {/* Center: hero + grid + dossier */}
        <main className="@flex @flex-col @gap-4">
          <div className="@grid @gap-4 desktop:@grid-cols-[260px_1fr]">
            {/* Hero portrait */}
            <div
              className="@relative @flex @h-[320px] @items-end @overflow-hidden @rounded-xl @bg-black/40"
              style={{ outline: `1px solid ${ARMY_HEX[(me?.army as Army) ?? "orange-star"]}55` }}
            >
              {selected !== undefined && (
                <img
                  src={coArtUrl(selected)}
                  alt={selected}
                  className="@absolute @inset-0 @h-full @w-full @object-cover @object-top"
                />
              )}
              <div className="@relative @w-full @bg-gradient-to-t @from-black/90 @to-transparent @px-4 @pb-3 @pt-10">
                <p className="@py-0 @font-russoOne @text-2xl @uppercase @tracking-wide">
                  {selectedEntry?.displayName ?? selected}
                </p>
              </div>
            </div>

            {/* Dossier */}
            <section className="@flex @flex-col @rounded-xl @bg-bg-secondary/50 @p-4">
              <div className="@mb-3 @flex @gap-1">
                {(["overview", "powers", "forces"] as DossierTab[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    className={`@rounded @px-3 @py-1.5 @text-xs @font-semibold @uppercase @tracking-wide @transition ${
                      tab === t
                        ? "@bg-primary @text-black"
                        : "@bg-black/25 @text-slate-400 hover:@text-white"
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>

              <div className="@min-h-[190px] @flex-1 @text-sm @leading-relaxed @text-slate-300">
                {tab === "overview" && (
                  <div className="@flex @flex-col @gap-3">
                    {selectedEntry?.bio !== undefined && selectedEntry.bio !== "" && (
                      <p className="@py-0 @border-l-2 @border-primary/50 @pl-3 @italic @text-slate-400">
                        {selectedEntry.bio}
                      </p>
                    )}
                    {selectedEntry?.description !== undefined &&
                    selectedEntry.description !== "" ? (
                      <p className="@py-0">{selectedEntry.description}</p>
                    ) : (
                      <p className="@py-0 @text-slate-500">
                        No day-to-day specialty — a balanced commander.
                      </p>
                    )}
                  </div>
                )}

                {tab === "powers" && (
                  <div className="@flex @flex-col @gap-3">
                    {[selectedEntry?.coPower, selectedEntry?.superCoPower].map((power, i) =>
                      power ? (
                        <div key={i} className="@rounded-lg @bg-black/25 @p-3">
                          <div className="@mb-1 @flex @items-center @justify-between @gap-2">
                            <span className="@font-russoOne @text-sm @uppercase @tracking-wide @text-primary-light">
                              {power.name}
                            </span>
                            <span
                              className="@font-mono @text-xs @text-yellow-400"
                              title={`${power.stars} stars`}
                            >
                              {stars(power.stars)}
                            </span>
                          </div>
                          <p className="@py-0 @text-xs @text-slate-300">{power.description}</p>
                          <p className="@py-0 @text-[10px] @uppercase @tracking-wider @text-slate-500">
                            {i === 0 ? "CO Power" : "Super CO Power"}
                          </p>
                        </div>
                      ) : null,
                    )}
                  </div>
                )}

                {tab === "forces" && (
                  <div>
                    <p className="@mb-2 @py-0 @text-[10px] @text-slate-500">
                      Day-to-day modifiers per unit. Highlighted units are affected; conditional
                      bonuses (terrain, weather, properties) are described in Overview.
                    </p>
                    {Object.keys(forces).length === 0 && (
                      <p className="@mb-3 @py-0 @text-xs @text-slate-500">
                        No unconditional per-unit modifiers — see Overview.
                      </p>
                    )}
                    {unitRow("Land", LAND_UNITS)}
                    {unitRow("Air", AIR_UNITS)}
                    {unitRow("Sea", SEA_UNITS)}
                  </div>
                )}
              </div>
            </section>
          </div>

          {/* CO grid */}
          <div className="@grid @grid-cols-6 @gap-2 tablet:@grid-cols-8 desktop:@grid-cols-10">
            {codex.map((co) => {
              const isSel = co.name === selected;

              return (
                <button
                  key={co.name}
                  disabled={me?.ready === true}
                  onClick={() => setPicked(co.name)}
                  title={co.displayName}
                  className={`@relative @aspect-square @overflow-hidden @rounded @bg-black/40 @transition disabled:@cursor-not-allowed ${
                    isSel ? "@ring-2 @ring-primary" : "@opacity-70 hover:@opacity-100"
                  }`}
                >
                  <img
                    src={coPortraitUrl(co.name, "small")}
                    alt={co.name}
                    className="@h-full @w-full @object-cover [image-rendering:pixelated]"
                  />
                </button>
              );
            })}
          </div>

          {/* Lock bar */}
          <div className="@flex @items-center @justify-between @gap-3 @rounded-xl @bg-bg-secondary/50 @px-4 @py-3">
            {me === undefined ? (
              <p className="@py-0 @text-slate-400">You are spectating this match.</p>
            ) : me.ready ? (
              <p className="@py-0 @text-emerald-400">
                Locked in as <span className="@font-bold">{me.coId?.name ?? selected}</span>.
                Awaiting deployment…
              </p>
            ) : (
              <>
                <p className="@py-0 @text-sm @text-slate-400">
                  Selected:{" "}
                  <span className="@font-semibold @text-white">
                    {selectedEntry?.displayName ?? selected}
                  </span>
                </p>
                <button
                  className="@rounded-lg @bg-primary @px-8 @py-2.5 @font-russoOne @text-sm @uppercase @tracking-wider @text-black @transition hover:@bg-primary-light disabled:@opacity-50"
                  disabled={selectedEntry === undefined || lockCo.isLoading}
                  onClick={() =>
                    selectedEntry !== undefined &&
                    lockCo.mutate({
                      matchId,
                      playerId,
                      coId: { name: selectedEntry.name, version: CO_VERSION },
                    })
                  }
                >
                  {lockCo.isLoading ? "Locking…" : "Lock in"}
                </button>
              </>
            )}
          </div>
          {lockCo.error && <p className="@py-0 @text-sm @text-red-400">{lockCo.error.message}</p>}
        </main>

        {/* Enemies */}
        <aside className="@flex @flex-col @gap-2">
          <p className="@py-0 @text-right @text-[11px] @uppercase @tracking-[0.2em] @text-slate-400">
            Opposition
          </p>
          {enemies.map((p) => rosterTile(p, true))}
        </aside>
      </div>
    </div>
  );
}
