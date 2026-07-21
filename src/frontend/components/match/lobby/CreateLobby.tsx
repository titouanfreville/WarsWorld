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

/**
 * FE-local mirror of the backend time-control presets (`server/core/schemas/rule-presets.ts`).
 * Redeclared rather than imported — the FE owns its half of every contract — and the numbers here are
 * only for LABELS and for pre-filling the custom fields: the server resolves the preset itself, so a
 * stale copy shows the wrong caption, never spawns the wrong match.
 */
const PRESETS = [
  { value: "quick", label: "Quick", dayLimit: 30, bankMinutes: 10, incrementMinutes: 1 },
  { value: "normal", label: "Normal", dayLimit: 50, bankMinutes: 15, incrementMinutes: 2 },
  { value: "long", label: "Long", dayLimit: 100, bankMinutes: 30, incrementMinutes: 4 },
  { value: "custom", label: "Custom", dayLimit: 50, bankMinutes: 15, incrementMinutes: 2 },
] as const;

type Preset = (typeof PRESETS)[number]["value"];

const presetByValue = (value: Preset) => PRESETS.find((p) => p.value === value) ?? PRESETS[1];

/** Create a lobby (the pre-room) and jump into it. Replaces the old direct-to-match create flow. */
export default function CreateLobby({ currentPlayer, onCreated }: Props) {
  const router = useRouter();

  const [mode, setMode] = useState<Mode>("duel");
  const [fogOfWar, setFogOfWar] = useState(false);
  const [weatherSetting, setWeatherSetting] = useState<WeatherSetting>("clear");
  const [preset, setPreset] = useState<Preset>("normal");
  // Only read when the preset is "custom" — otherwise the server stamps the preset's own numbers.
  // Seeded from Normal and re-seeded whenever a named preset is chosen, so switching to Custom starts
  // from what you were just looking at rather than from an empty form.
  // Annotated as `number`: the preset table is `as const`, so an inferred initial value would pin
  // each field to the literal it started at and reject every other preset (and every typed edit).
  const [dayLimit, setDayLimit] = useState<number>(PRESETS[1].dayLimit);
  const [bankMinutes, setBankMinutes] = useState<number>(PRESETS[1].bankMinutes);
  const [incrementMinutes, setIncrementMinutes] = useState<number>(PRESETS[1].incrementMinutes);

  const choosePreset = (value: Preset) => {
    setPreset(value);

    if (value !== "custom") {
      const chosen = presetByValue(value);

      setDayLimit(chosen.dayLimit);
      setBankMinutes(chosen.bankMinutes);
      setIncrementMinutes(chosen.incrementMinutes);
    }
  };

  const createLobby = trpc.lobby.create.useMutation({
    onSuccess: (lobby) => {
      onCreated?.();
      void router.push(`/lobby/${lobby.id}`);
    },
  });

  const submit = () => {
    if (currentPlayer === undefined) {
      return;
    }

    createLobby.mutate({
      playerId: currentPlayer.id,
      mode,
      // Custom lobbies are unranked, so `ruleset` is only a label here — derive it from the rules the
      // host actually picked rather than asking them the same question twice. (A custom game can mix
      // axes the queue rulesets keep separate; fog is the one worth surfacing.)
      ruleset: fogOfWar ? "fog" : "standard",
      // No map here — the host picks it in the lobby room (see setMap), never at invite time.
      isRanked: false,
      // The server resolves this: a named preset overwrites the three numbers below, and only
      // "custom" keeps them. Sent for every preset so the intent is explicit on the wire.
      preset,
      rules: {
        bannedUnitTypes: [],
        captureLimit: 50,
        dayLimit,
        turnBankSeconds: bankMinutes * 60,
        turnIncrementSeconds: incrementMinutes * 60,
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
        Create a lobby, pick your map and assemble your teams there, then start the general pick.
      </p>

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

      <label className="@flex @flex-col @gap-1">
        <span className="@text-sm @font-semibold @text-slate-300">Time control</span>
        <select
          className="@rounded @bg-bg-primary @px-3 @py-2 @text-white @outline @outline-1 @outline-bg-tertiary"
          value={preset}
          onChange={(e) => choosePreset(e.target.value as Preset)}
        >
          {PRESETS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.value === "custom"
                ? "Custom…"
                : `${p.label} — ${p.dayLimit} days, ${p.bankMinutes}m +${p.incrementMinutes}m/turn`}
            </option>
          ))}
        </select>
        <span className="@text-xs @text-slate-500">
          Each turn adds to your bank. Run out and your turn is ended for you — you keep playing on
          the per-turn gain.
        </span>
      </label>

      {preset === "custom" && (
        <div className="@grid @grid-cols-3 @gap-2">
          <label className="@flex @flex-col @gap-1">
            <span className="@text-xs @font-semibold @text-slate-400">Days</span>
            <input
              type="number"
              min={1}
              max={999}
              className="@rounded @bg-bg-primary @px-2 @py-1.5 @text-white @outline @outline-1 @outline-bg-tertiary"
              value={dayLimit}
              onChange={(e) => setDayLimit(Number(e.target.value))}
            />
          </label>
          <label className="@flex @flex-col @gap-1">
            <span className="@text-xs @font-semibold @text-slate-400">Bank (min)</span>
            <input
              type="number"
              min={1}
              max={120}
              className="@rounded @bg-bg-primary @px-2 @py-1.5 @text-white @outline @outline-1 @outline-bg-tertiary"
              value={bankMinutes}
              onChange={(e) => setBankMinutes(Number(e.target.value))}
            />
          </label>
          <label className="@flex @flex-col @gap-1">
            <span className="@text-xs @font-semibold @text-slate-400">Gain/turn (min)</span>
            <input
              type="number"
              min={0}
              max={15}
              className="@rounded @bg-bg-primary @px-2 @py-1.5 @text-white @outline @outline-1 @outline-bg-tertiary"
              value={incrementMinutes}
              onChange={(e) => setIncrementMinutes(Number(e.target.value))}
            />
          </label>
        </div>
      )}

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
