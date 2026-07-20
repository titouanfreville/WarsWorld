"use client";
import { trpc } from "frontend/utils/trpc-client";
import type { AdminAction, DevAction } from "frontend/components/match/dev-actions";
import { LOCKABLE_UNIT_TYPES } from "frontend/components/match/dev-actions";
import type { UnitType } from "frontend/components/match/unit-types";
import type { SpritesheetDataByArmy } from "frontend/components/match/getSpritesheetData";
import { unitThumb } from "frontend/components/match/hud/unit-sprite";
import type { Army } from "frontend/utils/sprites";
import { useState } from "react";

/**
 * Staff-only game-state tools. Opened from the board CONTEXT menu (right-click an empty tile) and
 * docked at the top of the chat column.
 *
 * The context menu is the entry point rather than a unit's action menu on purpose: that one only
 * exists on your own turn with a unit staged, whereas these tools are deliberately usable at ANY
 * point in the game — off-turn included, which is why the server puts them on `matchBaseProcedure`
 * rather than the turn-gated procedure. An entry point that required your turn would have thrown that
 * away.
 *
 * This is a control surface, NOT a decision-maker. It computes no outcomes and predicts nothing: it
 * submits an action and the board repaints from the authoritative `devTool` websocket event, like any
 * other player's action. Every gate here is convenience — the server re-checks all of it.
 *
 * Teleport and delete-any-unit are here too, as MODES rather than buttons: they arm, and the next
 * board click supplies the target (the panel has no unit to act on). The board owns that state — its
 * click handler reads it synchronously — so this only toggles it, and the on-board banner is what
 * carries the prompt once a mode is live.
 */
type Props = {
  matchId: string;
  playerId: string;
  /**
   * The board-targeted tools are MODES rather than buttons: they arm, then the next board click(s)
   * supply the target. The board owns that state (its click handler reads it synchronously), so the
   * panel toggles it rather than holding it.
   */
  teleportMode: boolean;
  onToggleTeleportMode: () => void;
  devDeleteMode: boolean;
  onToggleDevDeleteMode: () => void;
  /** Atlases + the acting player's army, for the unit-picker sprites. */
  sheets: SpritesheetDataByArmy;
  army: Army | undefined;
  onClose: () => void;
};

/** A labelled row. Kept local — this panel is staff-facing and shouldn't grow shared UI vocabulary. */
const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="@flex @items-center @justify-between @gap-2 @py-1">
    <span className="@text-xs @uppercase @tracking-wide @opacity-70">{label}</span>
    <div className="@flex @items-center @gap-1">{children}</div>
  </div>
);

export function DevToolsPanel({
  matchId,
  playerId,
  teleportMode,
  onToggleTeleportMode,
  devDeleteMode,
  onToggleDevDeleteMode,
  sheets,
  army,
  onClose,
}: Props) {
  const [funds, setFunds] = useState(10_000);
  const [hp, setHp] = useState(7);
  const [fuel, setFuel] = useState(99);
  const [ammo, setAmmo] = useState(9);
  /* The locks are keyed by unit TYPE, and the panel opens from an empty tile — so the type is picked
   * here rather than taken from a selection. */
  const [unitType, setUnitType] = useState<UnitType>("infantry");
  const [error, setError] = useState<string | null>(null);

  /* Same query the context menu gates the entry on — react-query dedupes it, so this is a cache read
   * rather than a second round-trip. It's also the only source of the acting slot. */
  const devAvailability = trpc.match.devTools.availability.useQuery({ matchId, playerId });

  const send = trpc.match.devTools.send.useMutation({
    /* Surface the server's refusal verbatim rather than a generic failure: these tools are for
     * debugging, so "Dev tools are disabled in ranked matches" is the whole point of the message. */
    onError: (e) => setError(e.message),
    onSuccess: () => setError(null),
  });

  /* Admin tools are a separate endpoint behind a separate capability — a dev/tester must never be
   * able to decide a match. The BE owns that call; this query only decides whether to render them. */
  const adminAvailability = trpc.match.adminTools.availability.useQuery({ matchId, playerId });
  const sendAdmin = trpc.match.adminTools.send.useMutation({
    onError: (e) => setError(e.message),
    onSuccess: () => setError(null),
  });

  /**
   * The acting slot, stated by the SERVER — never derived here.
   *
   * This was `players.find(...)?.slot ?? 0`, and that fallback was the bug: when the lookup missed it
   * silently acted on slot 0 — someone else's army — so the tools looked inert while quietly pinning
   * the wrong player's units. Null now means "no slot", and `run` refuses instead of guessing.
   */
  const playerSlot = devAvailability.data?.myPlayerSlot ?? null;

  const run = (action: DevAction) => {
    if (playerSlot === null) {
      setError("Can't tell which slot you're playing — refusing rather than guessing.");
      return;
    }

    send.mutate({ matchId, playerId, ...action });
  };

  const runAdmin = (action: AdminAction) => sendAdmin.mutate({ matchId, playerId, ...action });

  /* Hoisted so the team survives narrowing into the click handlers below. Null until the query lands,
   * or when the caller isn't an admin — either way the admin section stays hidden. */
  const admin = adminAvailability.data;
  const myTeamIndex = admin?.enabled === true ? admin.myTeamIndex : null;
  /* Every team that isn't mine — one of them in a duel ("I lose"), several in FFA/2v2 (pick one). */
  const otherTeams = (admin?.teamIndexes ?? []).filter((index) => index !== myTeamIndex);

  return (
    <div className="@mb-2 @rounded @border @border-yellow-600/60 @bg-black/80 @p-2 @text-white">
      <div className="@flex @items-center @justify-between @pb-1">
        <span className="@text-xs @font-bold @text-yellow-400">DEV TOOLS</span>
        <button className="@text-xs @opacity-70 hover:@opacity-100" onClick={onClose}>
          ✕
        </button>
      </div>

      {/* Board-targeted tools. These ARM a mode and the next board click supplies the target — they
          can't be plain buttons, because the panel has no unit to act on. The label reflects the
          armed state so the panel and the on-board banner can't disagree about what's live. */}
      <Row label="Teleport">
        <button
          className={`@rounded @px-2 @py-0.5 @text-xs ${
            teleportMode ? "@bg-yellow-400 @text-black" : "@bg-white/10 hover:@bg-white/20"
          }`}
          onClick={onToggleTeleportMode}
        >
          {teleportMode ? "PICKING…" : "MOVE A UNIT"}
        </button>
      </Row>

      <Row label="Delete unit">
        {/* Reaches ANY unit, enemies included — unlike the board's own "Scrap units" mode, which
            submits the normal delete action and only touches your own. */}
        <button
          className={`@rounded @px-2 @py-0.5 @text-xs ${
            devDeleteMode ? "@bg-red-500 @text-black" : "@bg-white/10 hover:@bg-white/20"
          }`}
          onClick={onToggleDevDeleteMode}
        >
          {devDeleteMode ? "CLICKING…" : "DELETE ANY"}
        </button>
      </Row>

      {/* Everything below acts on YOUR slot, so it renders only once the server has told us which
          slot that is. Gated rather than defaulted: the `?? 0` this replaces meant a missed lookup
          silently pinned slot 0 — another player's army — which is why these tools looked inert.
          Narrowing on the const also gives the click handlers a plain `number`. */}
      {playerSlot === null ? (
        <p className="@py-1 @text-xs @text-yellow-300/80">
          Slot-scoped tools need a seat in this match.
        </p>
      ) : (
        <>
          {/* The locks pin a whole unit TYPE for this player — "all infantry sit at 7HP" — so the
              type is chosen here rather than taken from a board selection. A sprite grid, showing the
              real unit art (same atlas as the board, via `unitThumb`) in the player's own colours;
              the name is the title/label so a type with no atlas frame still reads. */}
          <div className="@py-1">
            <div className="@pb-1 @text-xs @uppercase @tracking-wide @opacity-70">
              Unit type · {unitType}
            </div>
            <div className="@grid @grid-cols-8 @gap-1">
              {LOCKABLE_UNIT_TYPES.map((type) => {
                const thumb = unitThumb(sheets, army, type);
                const selected = type === unitType;

                return (
                  <button
                    key={type}
                    type="button"
                    title={type}
                    aria-label={type}
                    onClick={() => setUnitType(type)}
                    className={`@flex @h-7 @items-center @justify-center @overflow-hidden @rounded @border ${
                      selected
                        ? "@border-yellow-400 @bg-yellow-400/20"
                        : "@border-white/10 @bg-white/5 hover:@bg-white/15"
                    }`}
                  >
                    {thumb === undefined ? (
                      // No atlas frame (shouldn't happen for a real unit) — fall back to 3 letters.
                      <span className="@text-[8px] @uppercase">{type.slice(0, 3)}</span>
                    ) : (
                      <span
                        className="@block"
                        style={{
                          width: thumb.width,
                          height: thumb.height,
                          backgroundImage: `url(${thumb.url})`,
                          backgroundPosition: `-${thumb.x}px -${thumb.y}px`,
                          backgroundRepeat: "no-repeat",
                          imageRendering: "pixelated",
                        }}
                      />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* The labels name the selected type rather than saying a bare "Lock HP": you can see what
          you're about to pin, and if the dropdown ever fails to take effect it's visible here
          instead of being discovered by pinning the wrong unit. */}
          <Row label={`Lock HP · ${unitType}`}>
            <input
              type="number"
              min={1}
              max={10}
              value={hp}
              onChange={(e) => setHp(Number(e.target.value))}
              className="@w-12 @rounded @bg-white/10 @px-1 @text-xs"
            />
            <button
              className="@rounded @bg-white/10 @px-2 @py-0.5 @text-xs hover:@bg-white/20"
              onClick={() => run({ type: "setHpLock", playerSlot, unitType, visualHp: hp })}
            >
              PIN
            </button>
            {/* null clears the pin — the same action, so there's no second endpoint to keep in step. */}
            <button
              className="@rounded @bg-white/10 @px-2 @py-0.5 @text-xs hover:@bg-white/20"
              onClick={() => run({ type: "setHpLock", playerSlot, unitType, visualHp: null })}
            >
              CLEAR
            </button>
          </Row>

          <Row label={`Lock fuel · ${unitType}`}>
            {/* The server clamps to the unit type's `initialFuel`, so an over-large value pins to full
            rather than being rejected — no need to know each type's ceiling to use this. */}
            <input
              type="number"
              min={0}
              value={fuel}
              onChange={(e) => setFuel(Number(e.target.value))}
              className="@w-12 @rounded @bg-white/10 @px-1 @text-xs"
            />
            <button
              className="@rounded @bg-white/10 @px-2 @py-0.5 @text-xs hover:@bg-white/20"
              onClick={() => run({ type: "setFuelLock", playerSlot, unitType, fuel })}
            >
              PIN
            </button>
            <button
              className="@rounded @bg-white/10 @px-2 @py-0.5 @text-xs hover:@bg-white/20"
              onClick={() => run({ type: "setFuelLock", playerSlot, unitType, fuel: null })}
            >
              CLEAR
            </button>
          </Row>

          <Row label={`Lock ammo · ${unitType}`}>
            {/* Clamped to the type's `initialAmmo` on the server; types without ammo (e.g. infantry)
            silently ignore it. */}
            <input
              type="number"
              min={0}
              value={ammo}
              onChange={(e) => setAmmo(Number(e.target.value))}
              className="@w-12 @rounded @bg-white/10 @px-1 @text-xs"
            />
            <button
              className="@rounded @bg-white/10 @px-2 @py-0.5 @text-xs hover:@bg-white/20"
              onClick={() => run({ type: "setAmmoLock", playerSlot, unitType, ammo })}
            >
              PIN
            </button>
            <button
              className="@rounded @bg-white/10 @px-2 @py-0.5 @text-xs hover:@bg-white/20"
              onClick={() => run({ type: "setAmmoLock", playerSlot, unitType, ammo: null })}
            >
              CLEAR
            </button>
          </Row>

          {/* Player-scoped: no unit involved. They live here rather than on the unit menu because they
          have no unit to hang off. */}
          <Row label="Funds">
            <input
              type="number"
              value={funds}
              onChange={(e) => setFunds(Number(e.target.value))}
              className="@w-20 @rounded @bg-white/10 @px-1 @text-xs"
            />
            <button
              className="@rounded @bg-white/10 @px-2 @py-0.5 @text-xs hover:@bg-white/20"
              onClick={() => run({ type: "addFunds", playerSlot, amount: funds })}
            >
              ADD
            </button>
          </Row>

          <Row label="Power">
            {/* null = fill to this CO's max; the server resolves it, since max depends on the CO. */}
            <button
              className="@rounded @bg-white/10 @px-2 @py-0.5 @text-xs hover:@bg-white/20"
              onClick={() => run({ type: "chargePower", playerSlot, amount: null })}
            >
              CHARGE MAX
            </button>
          </Row>

          {/* Toggles, not one-shots: the engine consults these on every later action. They're rendered as
          on/off pairs rather than fire-buttons so the state is legible. */}
          <Row label="Free production">
            <button
              className="@rounded @bg-white/10 @px-2 @py-0.5 @text-xs hover:@bg-white/20"
              onClick={() => run({ type: "setFreeProduction", playerSlot, enabled: true })}
            >
              ON
            </button>
            <button
              className="@rounded @bg-white/10 @px-2 @py-0.5 @text-xs hover:@bg-white/20"
              onClick={() => run({ type: "setFreeProduction", playerSlot, enabled: false })}
            >
              OFF
            </button>
          </Row>

          <Row label="Direct capture">
            <button
              className="@rounded @bg-white/10 @px-2 @py-0.5 @text-xs hover:@bg-white/20"
              onClick={() => run({ type: "setDirectCapture", playerSlot, enabled: true })}
            >
              ON
            </button>
            <button
              className="@rounded @bg-white/10 @px-2 @py-0.5 @text-xs hover:@bg-white/20"
              onClick={() => run({ type: "setDirectCapture", playerSlot, enabled: false })}
            >
              OFF
            </button>
          </Row>
        </>
      )}

      {/* Admin only, and visually separated on purpose: everything above is reversible fiddling,
          while these END the match — a misclick here isn't undoable by another click. */}
      {myTeamIndex !== null && (
        <div className="@mt-2 @border-t @border-red-500/40 @pt-1">
          <span className="@text-xs @font-bold @text-red-400">ADMIN · ENDS THE MATCH</span>
          <Row label="Force outcome">
            <button
              className="@rounded @bg-red-500/20 @px-2 @py-0.5 @text-xs hover:@bg-red-500/40"
              onClick={() => runAdmin({ type: "forceOutcome", winnerTeamIndex: myTeamIndex })}
            >
              I WIN
            </button>
            {/* Defeat is viewer-relative but the engine settles by TEAM, so "I lose" means naming
                which OTHER team won. That's only unambiguous with exactly two teams — so it's offered
                as a single button in a duel, and as an explicit per-team winner picker otherwise,
                rather than guessing. The team list comes from the server; the FE never derives it. */}
            {otherTeams.length === 1 && (
              <button
                className="@rounded @bg-red-500/20 @px-2 @py-0.5 @text-xs hover:@bg-red-500/40"
                onClick={() => runAdmin({ type: "forceOutcome", winnerTeamIndex: otherTeams[0] })}
              >
                I LOSE
              </button>
            )}
            <button
              className="@rounded @bg-red-500/20 @px-2 @py-0.5 @text-xs hover:@bg-red-500/40"
              onClick={() => runAdmin({ type: "forceOutcome", winnerTeamIndex: null })}
            >
              DRAW
            </button>
          </Row>

          {/* More than two teams: "I lose" has no single meaning, so name the winner explicitly. */}
          {otherTeams.length > 1 && (
            <Row label="Team wins">
              {otherTeams.map((index) => (
                <button
                  key={index}
                  className="@rounded @bg-red-500/20 @px-2 @py-0.5 @text-xs hover:@bg-red-500/40"
                  onClick={() => runAdmin({ type: "forceOutcome", winnerTeamIndex: index })}
                >
                  {index}
                </button>
              ))}
            </Row>
          )}
        </div>
      )}

      {error !== null && <p className="@pt-1 @text-xs @text-red-400">{error}</p>}
    </div>
  );
}
