import { Dialog } from "@headlessui/react";
import DefaultDialogDesign from "frontend/components/layout/modal/DefaultDialogDesign";
import MapThumbnail from "frontend/components/matchmaking/MapThumbnail";
import { formatTimeControl } from "frontend/utils/format-time";
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

// The mode union and its labels are shared with the map browser — see `frontend/utils/game-mode`.
import { MODE_LABEL, type GameMode } from "frontend/utils/game-mode";

/**
 * FE-local mirror of the server lobby geometry (`server/matches/layout`), for laying out team
 * columns. Keyed on the `GameMode` enum ids — NOT the display labels — so the lookup actually hits.
 */
const LAYOUT: Record<GameMode, { teams: number; slots: number }> = {
  duel: { teams: 2, slots: 1 },
  teams: { teams: 2, slots: 2 },
  ffa: { teams: 4, slots: 1 },
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

/**
 * Where a member goes when the match starts: seated players enter the CO pick; anyone else (e.g. an
 * admin who force-created the match and hosts it without a seat) follows the game as a spectator on
 * the board.
 */
const matchPathFor = (
  members: { playerId: string; membership: string; team: number | null }[],
  playerId: string,
  matchId: string,
): string => {
  const amSeated = members.some(
    (m) => m.playerId === playerId && m.membership === "active" && m.team !== null,
  );

  return amSeated ? `/pick/${matchId}` : `/match2/${matchId}`;
};

export default function LobbyRoom({ lobbyId }: Props) {
  const router = useRouter();
  const { currentPlayer } = usePlayers();
  const playerId = currentPlayer?.id ?? "";
  const utils = trpc.useUtils();

  const [inviteName, setInviteName] = useState("");
  // The visual map-picker modal (host only) + its name filter.
  const [mapPickerOpen, setMapPickerOpen] = useState(false);
  const [mapSearch, setMapSearch] = useState("");

  const { data: lobby, error } = trpc.lobby.get.useQuery(
    { lobbyId, playerId },
    { enabled: playerId !== "", refetchInterval: 15000 },
  );
  // Narrow the library to the lobby's mode — seat count alone can't decide it (a 4-player map may be
  // laid out for 2v2 but not FFA), so `supportedModes` is the authority and the filter runs
  // server-side. Gated until the lobby (hence its mode) has loaded.
  const { data: maps } = trpc.map.getAll.useQuery(
    { mode: lobby?.mode },
    { enabled: lobby !== undefined },
  );

  const refresh = () => void utils.lobby.get.invalidate({ lobbyId });

  trpc.lobby.onUpdate.useSubscription(
    { lobbyId, playerId },
    { enabled: playerId !== "", onData: refresh },
  );

  const assignTeam = trpc.lobby.assignTeam.useMutation({ onSuccess: refresh });
  const setMap = trpc.lobby.setMap.useMutation({ onSuccess: refresh });
  const invite = trpc.lobby.invite.useMutation({ onSuccess: refresh });
  const kick = trpc.lobby.kick.useMutation({ onSuccess: refresh });
  const leave = trpc.lobby.leave.useMutation({
    onSuccess: () => void router.push("/your-games"),
  });
  const start = trpc.lobby.start.useMutation({
    onSuccess: ({ matchId }) =>
      void router.push(matchPathFor(lobby?.members ?? [], playerId, matchId)),
  });

  if (error) {
    return <p className="@p-8 @text-red-400">Lobby error: {error.message}</p>;
  }

  if (lobby === undefined) {
    return <p className="@p-8 @text-slate-400">Loading lobby…</p>;
  }

  // The host already started — seated players follow into the pick phase, a benched host/organizer
  // into the game as a spectator.
  if (lobby.matchId !== null && lobby.status === "started") {
    void router.push(matchPathFor(lobby.members, playerId, lobby.matchId));
  }

  const mode = lobby.mode;
  const layout = LAYOUT[mode] ?? { teams: 2, slots: 1 };
  const isHost = lobby.hostPlayerId === playerId;
  const map = maps?.find((m) => m.id === lobby.mapId);
  const bench = lobby.members.filter((m) => m.membership === "active" && m.team === null);
  const invited = lobby.members.filter((m) => m.membership === "invited");
  const seated = lobby.members.filter((m) => m.membership === "active" && m.team !== null);
  const seatAt = (team: number, slot: number) =>
    seated.find((m) => m.team === team && m.slot === slot);
  const factionOf = (team: number): Army | undefined =>
    lobby.teamFactions?.[team] as Army | undefined;
  const capacity = layout.teams * layout.slots;
  const canStart = seated.length === capacity && lobby.mapId !== null;
  // The query already narrows by mode; this guards the brief window where `maps` is still the
  // previous mode's list, and makes the mode→map coupling explicit at the render site.
  const eligibleMaps = (maps ?? []).filter((m) => m.supportedModes.includes(mode));
  const pickerMaps = eligibleMaps.filter((m) =>
    m.name.toLowerCase().includes(mapSearch.trim().toLowerCase()),
  );

  const mutationError =
    assignTeam.error?.message ??
    setMap.error?.message ??
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
        <div className="@min-w-0 @flex-1">
          <p className="@py-0 @text-[11px] @uppercase @tracking-[0.2em] @text-primary">Theatre</p>
          {/* The map picker lives here in the War Room — prominent, host-only. Non-hosts just read
              the choice. An empty pool (no maps for the mode) is called out rather than shown blank. */}
          {isHost ? (
            <button
              type="button"
              onClick={() => setMapPickerOpen(true)}
              disabled={setMap.isLoading || eligibleMaps.length === 0}
              className={`@flex @w-full @items-center @gap-2 @rounded @bg-black/40 @px-3 @py-2 @text-left @font-russoOne @text-xl @uppercase @tracking-wide @text-white @outline @outline-2 @transition disabled:@cursor-not-allowed disabled:@opacity-40 ${
                lobby.mapId === null
                  ? "@outline-primary hover:@bg-primary/10"
                  : "@outline-white/10 hover:@outline-white/25"
              }`}
            >
              <span className="@min-w-0 @flex-1 @truncate">
                {eligibleMaps.length === 0
                  ? `No maps for ${MODE_LABEL[mode]}`
                  : (map?.name ?? "Choose a map…")}
              </span>
              {eligibleMaps.length > 0 && (
                <span className="@flex-none @text-sm @text-primary">
                  {map !== undefined ? "Change ▾" : "Browse ▾"}
                </span>
              )}
            </button>
          ) : (
            <h1 className="@truncate @py-0 @font-russoOne @text-2xl @uppercase @tracking-wide">
              {map?.name ?? "Awaiting map…"}
            </h1>
          )}
        </div>
        {map !== undefined && (
          <p className="@flex-none @py-0 @font-mono @text-xs @text-slate-400">
            {map.size.width}×{map.size.height} · {map.numberOfPlayers}P
          </p>
        )}
      </div>
      {isHost && lobby.mapId === null && (
        <p className="@-mt-2 @mb-4 @py-0 @text-xs @text-primary/80">
          Pick a map to enable the general pick.
        </p>
      )}

      {/* Terrain preview of the CHOSEN map. Same component and palette as the picker grid and the
          in-match minimap, so the map a player clicked is the one they keep looking at while the
          lobby fills. The empty frame holds the slot before a map is picked, so choosing one
          doesn't shove the rest of the dossier down the page. */}
      <div className="@mb-4 @overflow-hidden @rounded-lg @outline @outline-1 @outline-white/10">
        {map === undefined ? (
          <div className="@flex @h-32 @items-center @justify-center @bg-black/40 @text-xs @uppercase @tracking-[0.2em] @text-slate-600">
            Awaiting map…
          </div>
        ) : (
          <MapThumbnail terrain={map.terrain} className="@w-full @bg-black/40" />
        )}
      </div>

      {/* Rules chips */}
      <div className="@mb-4 @flex @flex-wrap @gap-1.5">
        {[
          lobby.rules.fogOfWar ? "Fog of War" : "Clear skies",
          `$${lobby.rules.fundsPerProperty}/prop`,
          `${lobby.rules.dayLimit}-day limit`,
          formatTimeControl(lobby.rules.turnBankSeconds, lobby.rules.turnIncrementSeconds),
          lobby.isRanked ? "Ranked" : "Casual",
        ]
          // An untimed match contributes no chip rather than an empty one.
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
              {MODE_LABEL[mode]} · {seated.length}/{lobby.capacity} deployed
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

      {/* Visual map picker — thumbnail grid + name filter, mirroring the ranked map ban/pick screen.
          Host-only; picking a card sets the map and closes. */}
      {isHost && (
        <Dialog
          open={mapPickerOpen}
          onClose={() => setMapPickerOpen(false)}
          className="@relative @z-40"
        >
          <DefaultDialogDesign title="Choose a map" width="min(920px, 94vw)">
            <div className="@flex @flex-col @gap-4 @px-6 @py-6">
              <input
                autoFocus
                value={mapSearch}
                onChange={(e) => setMapSearch(e.target.value)}
                placeholder="Filter maps by name…"
                className="@w-full @rounded @bg-bg-primary @px-3 @py-2 @text-sm @text-white @outline @outline-1 @outline-bg-tertiary @placeholder:text-slate-600"
              />
              <div className="@grid @max-h-[60vh] @grid-cols-2 @gap-3 @overflow-y-auto tablet:@grid-cols-3 laptop:@grid-cols-4">
                {pickerMaps.map((m) => {
                  const selected = m.id === lobby.mapId;

                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => {
                        setMap.mutate({ lobbyId, playerId, mapId: m.id });
                        setMapPickerOpen(false);
                      }}
                      className={`@flex @flex-col @gap-2 @overflow-hidden @rounded-xl @border @p-2 @text-left @transition ${
                        selected
                          ? "@border-primary @bg-primary/10"
                          : "@border-bg-tertiary @bg-black/20 hover:@border-primary-light"
                      }`}
                    >
                      <div className="@overflow-hidden @rounded-md @outline @outline-1 @outline-white/10">
                        <MapThumbnail terrain={m.terrain} className="@w-full @bg-black/40" />
                      </div>
                      <div className="@flex @items-center @justify-between @gap-1">
                        <span className="@min-w-0 @truncate @text-xs @font-semibold @text-slate-100">
                          {m.name}
                        </span>
                        <span className="@flex-none @font-mono @text-[10px] @text-slate-500">
                          {m.size.width}×{m.size.height} · {m.numberOfPlayers}P
                        </span>
                      </div>
                    </button>
                  );
                })}
                {pickerMaps.length === 0 && (
                  <p className="@col-span-full @py-8 @text-center @text-sm @text-slate-500">
                    No maps match “{mapSearch}”.
                  </p>
                )}
              </div>
            </div>
          </DefaultDialogDesign>
        </Dialog>
      )}
    </div>
  );
}
