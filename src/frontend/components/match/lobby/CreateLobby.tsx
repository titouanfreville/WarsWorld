import type { Player } from "@prisma/client";
import SquareButton from "frontend/components/layout/SquareButton";
import { trpc } from "frontend/utils/trpc-client";
import { useRouter } from "next/router";
import { useState } from "react";

type Props = {
  currentPlayer: Player | undefined;
  onCreated?: () => void;
};

// FE-local mirror of the server `GameMode`. The values are the enum's identifiers (Prisma enum
// members can't start with a digit, so "1v1" is unspellable); the labels are what players read.
const MODES = [
  { value: "duel", label: "1v1 (2 players)" },
  { value: "teams", label: "2v2 (4 players)" },
  { value: "ffa", label: "Free-for-all (4 players)" },
] as const;

type Mode = (typeof MODES)[number]["value"];

// FE-local mirror of the backend `weatherSettingSchema` (clear/rain/snow/sandstorm + random). The
// BE re-validates, so drift surfaces as a tsc error at the `createLobby.mutate` call below.
const WEATHER_OPTIONS = [
  { value: "clear", label: "Clear" },
  { value: "random", label: "Random" },
  { value: "rain", label: "Rain" },
  { value: "snow", label: "Snow" },
  { value: "sandstorm", label: "Sandstorm" },
] as const;

type WeatherSetting = (typeof WEATHER_OPTIONS)[number]["value"];

/** Create a lobby (the pre-room) and jump into it. Replaces the old direct-to-match create flow. */
export default function CreateLobby({ currentPlayer, onCreated }: Props) {
  const router = useRouter();
  const { data: maps, isLoading } = trpc.map.getAll.useQuery();

  const [mapId, setMapId] = useState("");
  const [mode, setMode] = useState<Mode>("duel");
  const [fogOfWar, setFogOfWar] = useState(false);
  const [weatherSetting, setWeatherSetting] = useState<WeatherSetting>("clear");

  const createLobby = trpc.lobby.create.useMutation({
    onSuccess: (lobby) => {
      onCreated?.();
      void router.push(`/lobby/${lobby.id}`);
    },
  });

  const selectedMapId = mapId !== "" ? mapId : (maps?.[0]?.id ?? "");

  const submit = () => {
    if (currentPlayer === undefined || selectedMapId === "") {
      return;
    }

    createLobby.mutate({
      playerId: currentPlayer.id,
      mode,
      // Custom lobbies are unranked, so `ruleset` is only a label here — derive it from the rules the
      // host actually picked rather than asking them the same question twice. (A custom game can mix
      // axes the queue rulesets keep separate; fog is the one worth surfacing.)
      ruleset: fogOfWar ? "fog" : "standard",
      mapId: selectedMapId,
      isRanked: false,
      rules: {
        bannedUnitTypes: [],
        captureLimit: 50,
        dayLimit: 50,
        fogOfWar,
        fundsPerProperty: 1000,
        unitCapPerPlayer: 50,
        weatherSetting,
        labUnitTypes: [],
        // Placeholder — the real teamMapping is derived from seat assignments when the lobby starts.
        teamMapping: [],
        pickSeconds: 180,
      },
    });
  };

  return (
    <div className="@flex @w-full @flex-col @gap-4">
      <p className="@py-0 @text-slate-400">
        Create a lobby, assemble your teams, then start the general pick.
      </p>

      <label className="@flex @flex-col @gap-1">
        <span className="@text-sm @font-semibold @text-slate-300">Map</span>
        {isLoading ? (
          <p className="@py-0">Loading maps…</p>
        ) : (
          <select
            className="@rounded @bg-bg-primary @px-3 @py-2 @text-white @outline @outline-1 @outline-bg-tertiary"
            value={selectedMapId}
            onChange={(e) => setMapId(e.target.value)}
          >
            {maps?.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} ({m.numberOfPlayers}p)
              </option>
            ))}
          </select>
        )}
      </label>

      <label className="@flex @flex-col @gap-1">
        <span className="@text-sm @font-semibold @text-slate-300">Mode</span>
        <select
          className="@rounded @bg-bg-primary @px-3 @py-2 @text-white @outline @outline-1 @outline-bg-tertiary"
          value={mode}
          onChange={(e) => setMode(e.target.value as Mode)}
        >
          {MODES.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </label>

      <label className="@flex @flex-col @gap-1">
        <span className="@text-sm @font-semibold @text-slate-300">Weather</span>
        <select
          className="@rounded @bg-bg-primary @px-3 @py-2 @text-white @outline @outline-1 @outline-bg-tertiary"
          value={weatherSetting}
          onChange={(e) => setWeatherSetting(e.target.value as WeatherSetting)}
        >
          {WEATHER_OPTIONS.map((w) => (
            <option key={w.value} value={w.value}>
              {w.label}
            </option>
          ))}
        </select>
      </label>

      <label className="@flex @items-center @gap-2 @select-none">
        <input type="checkbox" checked={fogOfWar} onChange={(e) => setFogOfWar(e.target.checked)} />
        Fog of War
      </label>

      {createLobby.error && (
        <p className="@py-0 @text-sm @text-red-400">{createLobby.error.message}</p>
      )}

      <div className="@h-12">
        <SquareButton onClick={submit} disabled={createLobby.isLoading}>
          {createLobby.isLoading ? "Creating…" : "Create lobby"}
        </SquareButton>
      </div>
    </div>
  );
}
