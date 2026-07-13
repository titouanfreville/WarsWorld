import { usePlayers } from "frontend/context/players";
import { trpc } from "frontend/utils/trpc-client";
import {
  ARMY_HEX,
  ARMY_LABEL,
  nationFlagUrl,
  unitSpriteUrl,
  type Army,
  type UnitType,
} from "frontend/utils/sprites";
import { useRouter } from "next/router";
import { useState } from "react";

/** FE-local mirror of the server lobby geometry, for laying out team columns. */
const LAYOUT: Record<string, { teams: number; slots: number }> = {
  "1v1": { teams: 2, slots: 1 },
  "2v2": { teams: 2, slots: 2 },
  ffa4: { teams: 4, slots: 1 },
};

/** A representative deployment shown as ambient sprites in the map dossier. */
const FORCES: UnitType[] = [
  "Infantry",
  "Recon",
  "Tank",
  "Artillery",
  "Anti-Air",
  "B-Copter",
  "Battleship",
];

const PROPERTY_META: { key: string; label: string; color: string }[] = [
  { key: "hq", label: "HQ", color: "#e6b422" },
  { key: "city", label: "City", color: "#8aa0b6" },
  { key: "base", label: "Factory", color: "#c07a3e" },
  { key: "airport", label: "Airport", color: "#6fb1c9" },
  { key: "port", label: "Port", color: "#4f79b0" },
  { key: "commtower", label: "Comm Tower", color: "#8f6fc0" },
  { key: "lab", label: "Lab", color: "#5fb08a" },
];

type LobbyMember = {
  playerId: string;
  name: string;
  membership: "invited" | "active";
  team: number | null;
  slot: number | null;
  isSpectator: boolean;
};

type Props = { lobbyId: string };

export default function LobbyRoom({ lobbyId }: Props) {
  const router = useRouter();
  const { currentPlayer } = usePlayers();
  const playerId = currentPlayer?.id ?? "";
  const utils = trpc.useUtils();

  const [inviteName, setInviteName] = useState("");

  const { data: lobby, error } = trpc.lobby.get.useQuery(
    { lobbyId, playerId },
    { enabled: playerId !== "", refetchInterval: 15000 },
  );
  const { data: maps } = trpc.map.getAll.useQuery();

  const refresh = () => void utils.lobby.get.invalidate({ lobbyId });

  trpc.lobby.onUpdate.useSubscription(
    { lobbyId, playerId },
    { enabled: playerId !== "", onData: refresh },
  );

  const assignTeam = trpc.lobby.assignTeam.useMutation({ onSuccess: refresh });
  const invite = trpc.lobby.invite.useMutation({ onSuccess: refresh });
  const kick = trpc.lobby.kick.useMutation({ onSuccess: refresh });
  const leave = trpc.lobby.leave.useMutation({
    onSuccess: () => void router.push("/your-matches"),
  });
  const start = trpc.lobby.start.useMutation({
    onSuccess: ({ matchId }) => void router.push(`/pick/${matchId}`),
  });

  if (error) {
    return <p className="@p-8 @text-red-400">Lobby error: {error.message}</p>;
  }

  if (lobby === undefined) {
    return <p className="@p-8 @text-slate-400">Loading lobby…</p>;
  }

  // The host already started — follow everyone into the pick phase.
  if (lobby.matchId !== null && lobby.status === "started") {
    void router.push(`/pick/${lobby.matchId}`);
  }

  const layout = LAYOUT[lobby.mode] ?? { teams: 2, slots: 1 };
  const isHost = lobby.hostPlayerId === playerId;
  const map = maps?.find((m) => m.id === lobby.mapId);
  const bench = lobby.members.filter((m) => m.membership === "active" && m.team === null);
  const invited = lobby.members.filter((m) => m.membership === "invited");
  const seated = lobby.members.filter((m) => m.membership === "active" && m.team !== null);
  const seatAt = (team: number, slot: number) =>
    seated.find((m) => m.team === team && m.slot === slot);
  const factionOf = (team: number): Army | undefined =>
    lobby.teamFactions?.[team] as Army | undefined;
  const canStart = seated.length === layout.teams * layout.slots;

  const mutationError =
    assignTeam.error?.message ??
    invite.error?.message ??
    kick.error?.message ??
    start.error?.message;

  const seat = (team: number, slot: number) => {
    const occupant = seatAt(team, slot);

    if (occupant === undefined) {
      return (
        <button
          key={slot}
          className="@group @flex @h-[52px] @items-center @justify-center @rounded-md @border @border-dashed @border-white/15 @bg-black/20 @text-xs @font-semibold @uppercase @tracking-wider @text-slate-500 @transition hover:@border-primary hover:@text-primary disabled:@opacity-40 disabled:@cursor-not-allowed"
          disabled={assignTeam.isLoading}
          onClick={() => assignTeam.mutate({ lobbyId, playerId, team, slotWithinTeam: slot })}
        >
          ＋ Take seat
        </button>
      );
    }

    const isYou = occupant.playerId === playerId;
    const isHostSeat = occupant.playerId === lobby.hostPlayerId;

    return (
      <div
        key={slot}
        className={`@flex @h-[52px] @items-center @gap-2.5 @rounded-md @px-2.5 @transition ${
          isYou ? "@bg-white/12" : "@bg-black/25"
        }`}
      >
        <span
          className="@flex @h-8 @w-8 @flex-none @items-center @justify-center @rounded @font-russoOne @text-sm @text-black"
          style={{ backgroundColor: ARMY_HEX[factionOf(team) ?? "orange-star"] }}
        >
          {occupant.name
            .replace(/^\[dev\]\s*/, "")
            .charAt(0)
            .toUpperCase()}
        </span>
        <span className="@min-w-0 @flex-1">
          <span className="@block @truncate @text-sm @font-semibold @leading-tight">
            {occupant.name.replace(/^\[dev\]\s*/, "")}
          </span>
          <span className="@block @text-[10px] @uppercase @tracking-wider @text-slate-400">
            {isHostSeat ? "Host" : "Ready to deploy"}
            {isYou && " · You"}
          </span>
        </span>
        {isHost && !isYou && (
          <button
            className="@flex-none @text-[10px] @font-semibold @uppercase @text-red-400/70 hover:@text-red-400 disabled:@opacity-40 disabled:@cursor-not-allowed"
            disabled={kick.isLoading}
            onClick={() => kick.mutate({ lobbyId, playerId, targetPlayerId: occupant.playerId })}
          >
            Kick
          </button>
        )}
        {isYou && (
          <button
            className="@flex-none @text-[10px] @font-semibold @uppercase @text-slate-500 hover:@text-white disabled:@opacity-40 disabled:@cursor-not-allowed"
            disabled={assignTeam.isLoading}
            onClick={() => assignTeam.mutate({ lobbyId, playerId, team: null })}
          >
            Stand
          </button>
        )}
      </div>
    );
  };

  const teamPanel = (team: number) => {
    const army = factionOf(team);
    const accent = ARMY_HEX[army ?? "orange-star"];

    return (
      <div
        key={team}
        className="@relative @overflow-hidden @rounded-xl @bg-bg-secondary/70 @p-4 @shadow-lg @shadow-black/30"
        style={{ borderTop: `3px solid ${accent}` }}
      >
        <div
          className="@pointer-events-none @absolute @inset-0 @opacity-40"
          style={{
            background: `radial-gradient(120% 60% at 50% 0%, ${accent}22, transparent 70%)`,
          }}
        />
        <div className="@relative @mb-3 @flex @items-center @gap-2">
          {army !== undefined && (
            <img
              src={nationFlagUrl(army)}
              alt=""
              className="@h-5 @w-7 @flex-none @rounded-sm @object-cover [image-rendering:pixelated]"
            />
          )}
          <h2
            className="@py-0 @font-russoOne @text-sm @uppercase @tracking-wide"
            style={{ color: accent }}
          >
            {army !== undefined ? ARMY_LABEL[army] : `Team ${team + 1}`}
          </h2>
        </div>
        <div className="@relative @flex @flex-col @gap-2">
          {Array.from({ length: layout.slots }, (_, slot) => seat(team, slot))}
        </div>
      </div>
    );
  };

  const mapDossier = (
    <div className="@relative @overflow-hidden @rounded-xl @bg-bg-secondary/60 @p-5 @shadow-lg @shadow-black/30 @outline @outline-1 @outline-white/5">
      <div className="@mb-4 @flex @items-end @justify-between @gap-3">
        <div className="@min-w-0">
          <p className="@py-0 @text-[11px] @uppercase @tracking-[0.2em] @text-primary">Theatre</p>
          <h1 className="@truncate @py-0 @font-russoOne @text-2xl @uppercase @tracking-wide">
            {map?.name ?? "Loading map…"}
          </h1>
        </div>
        {map !== undefined && (
          <p className="@flex-none @py-0 @font-mono @text-xs @text-slate-400">
            {map.size.width}×{map.size.height} · {map.numberOfPlayers}P
          </p>
        )}
      </div>

      {/* Rules chips */}
      <div className="@mb-4 @flex @flex-wrap @gap-1.5">
        {[
          lobby.rules.fogOfWar ? "Fog of War" : "Clear skies",
          `$${lobby.rules.fundsPerProperty}/prop`,
          `${lobby.rules.dayLimit}-day limit`,
          lobby.isRanked ? "Ranked" : "Casual",
        ].map((chip) => (
          <span
            key={chip}
            className="@rounded @bg-black/30 @px-2 @py-1 @text-[11px] @font-semibold @uppercase @tracking-wide @text-slate-300"
          >
            {chip}
          </span>
        ))}
      </div>

      {/* Property legend */}
      {map !== undefined && (
        <div className="@mb-4 @grid @grid-cols-2 @gap-x-4 @gap-y-1.5 tablet:@grid-cols-3">
          {PROPERTY_META.map(({ key, label, color }) => {
            const count =
              key === "hq"
                ? map.numberOfPlayers
                : ((map.propertyStats as Record<string, number>)[key] ?? 0);

            if (count === 0) {
              return null;
            }

            return (
              <div key={key} className="@flex @items-center @gap-2 @text-xs">
                <span
                  className="@h-3 @w-3 @flex-none @rounded-sm"
                  style={{ backgroundColor: color }}
                />
                <span className="@text-slate-300">{label}</span>
                <span className="@ml-auto @font-mono @text-slate-500">×{count}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Forces strip */}
      <div className="@border-t @border-white/5 @pt-3">
        <p className="@mb-2 @py-0 @text-[10px] @uppercase @tracking-[0.2em] @text-slate-500">
          Deployable forces
        </p>
        <div className="@flex @flex-wrap @gap-2">
          {FORCES.map((unit) => (
            <img
              key={unit}
              src={unitSpriteUrl(unit)}
              alt={unit}
              title={unit}
              className="@h-8 @w-8 @rounded @bg-black/20 @p-0.5 [image-rendering:pixelated]"
            />
          ))}
        </div>
      </div>
    </div>
  );

  const benchChip = (member: LobbyMember, pending: boolean) => (
    <span
      key={member.playerId}
      className={`@rounded-full @px-3 @py-1 @text-xs @font-semibold ${
        pending
          ? "@border @border-dashed @border-white/20 @text-slate-400"
          : "@bg-black/30 @text-slate-200"
      }`}
    >
      {member.name.replace(/^\[dev\]\s*/, "")}
      {pending && " · invited"}
      {member.playerId === playerId && !pending && " · you"}
    </span>
  );

  return (
    <div
      className="@min-h-screen @text-white"
      style={{
        background: "radial-gradient(90% 60% at 50% -10%, #1e2b4680, transparent 60%), #12151a",
      }}
    >
      <div className="@mx-auto @flex @max-w-[1400px] @flex-col @gap-5 @px-4 @py-6">
        {/* Command bar */}
        <header className="@flex @flex-wrap @items-center @justify-between @gap-3 @border-b @border-white/10 @pb-3">
          <div className="@flex @items-baseline @gap-3">
            <span className="@font-russoOne @text-lg @uppercase @tracking-widest @text-primary">
              War Room
            </span>
            <span className="@text-xs @uppercase @tracking-wider @text-slate-400">
              {lobby.mode} · {seated.length}/{lobby.capacity} deployed
            </span>
          </div>
          <button
            className="@rounded @border @border-white/15 @px-3 @py-1.5 @text-xs @font-semibold @uppercase @tracking-wide @text-slate-300 @transition hover:@border-red-500/60 hover:@text-red-300 disabled:@opacity-40 disabled:@cursor-not-allowed"
            disabled={leave.isLoading}
            onClick={() => leave.mutate({ lobbyId, playerId })}
          >
            Leave
          </button>
        </header>

        {/* Battlefield — teams flank the map dossier for 2-team modes, grid otherwise */}
        {layout.teams === 2 ? (
          <div className="@grid @gap-4 laptop:@grid-cols-[1fr_minmax(300px,1.3fr)_1fr]">
            {teamPanel(0)}
            {mapDossier}
            {teamPanel(1)}
          </div>
        ) : (
          <div className="@flex @flex-col @gap-4">
            {mapDossier}
            <div className="@grid @gap-4 tablet:@grid-cols-2 laptop:@grid-cols-4">
              {Array.from({ length: layout.teams }, (_, team) => teamPanel(team))}
            </div>
          </div>
        )}

        {/* Bench + invite + start */}
        <div className="@flex @flex-col @gap-3 @rounded-xl @bg-bg-secondary/50 @p-4">
          <div className="@flex @flex-wrap @items-center @gap-2">
            <span className="@text-[11px] @uppercase @tracking-[0.2em] @text-slate-500">
              Unassigned
            </span>
            {bench.length === 0 && invited.length === 0 ? (
              <span className="@text-xs @text-slate-600">— everyone&rsquo;s seated —</span>
            ) : (
              <>
                {bench.map((m) => benchChip(m, false))}
                {invited.map((m) => benchChip(m, true))}
              </>
            )}
          </div>

          {isHost && (
            <div className="@flex @flex-wrap @items-center @gap-2 @border-t @border-white/5 @pt-3">
              <input
                className="@w-48 @rounded @bg-black/30 @px-3 @py-2 @text-sm @outline @outline-1 @outline-white/10 @placeholder:text-slate-600"
                value={inviteName}
                onChange={(e) => setInviteName(e.target.value)}
                placeholder="Invite by username"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && inviteName.trim() !== "") {
                    invite.mutate({ lobbyId, playerId, usernames: [inviteName.trim()] });
                    setInviteName("");
                  }
                }}
              />
              <button
                className="@rounded @border @border-white/15 @px-3 @py-2 @text-sm @font-semibold hover:@bg-white/5 disabled:@opacity-40 disabled:@cursor-not-allowed"
                disabled={invite.isLoading}
                onClick={() => {
                  if (inviteName.trim() !== "") {
                    invite.mutate({ lobbyId, playerId, usernames: [inviteName.trim()] });
                    setInviteName("");
                  }
                }}
              >
                Invite
              </button>
              <button
                className="@ml-auto @rounded-lg @px-6 @py-2.5 @font-russoOne @text-sm @uppercase @tracking-wider @transition disabled:@cursor-not-allowed disabled:@opacity-40"
                style={{
                  backgroundColor: canStart ? "#E47220" : "#3a3f46",
                  color: canStart ? "#000" : "#8b94a0",
                }}
                disabled={!canStart || start.isLoading}
                onClick={() => start.mutate({ lobbyId, playerId })}
              >
                {start.isLoading ? "Deploying…" : "Start pick"}
              </button>
            </div>
          )}

          {mutationError !== undefined && (
            <p className="@py-0 @text-sm @text-red-400">{mutationError}</p>
          )}
        </div>
      </div>
    </div>
  );
}
