"use client";
import type { BoardPosition } from "frontend/components/match/match-view";
import type { inferTRPCOutput } from "frontend/utils/trpc-client";
import { spriteNameForUnit, unitSpriteUrl, type Army } from "frontend/utils/sprites";
import { tileSizeCss, tileTopLeftCss } from "./board-overlay-geometry";

/** BE-computed stat readout for one unit (see the `unitDetails` preview). Typed by tRPC inference. */
export type UnitDetails = NonNullable<inferTRPCOutput<"matchPreview", "unitDetails">>;

/**
 * Unit-detail card opened by right-clicking a visible unit — its ammo, fuel, movement, HP, vision and
 * attack range. Current fuel/ammo are only present for the viewer's OWN units (the BE withholds them
 * for enemies, matching AW); those show as `?`. Purely presentational — all numbers come from the BE.
 *
 * Anchored next to the inspected unit's tile, so it reads together with the unit's on-board range
 * highlights.
 */
type Props = {
  /** The inspected unit's tile — used to anchor the card beside it. */
  position: BoardPosition;
  /** Army of the unit's owner, for the sprite; `undefined` falls back to a neutral sprite. */
  army: Army | undefined;
  /** BE stats; `undefined` while the query is in flight. */
  details: UnitDetails | undefined;
  onClose: () => void;
};

type Weapon = UnitDetails["weapons"][number];

const rangeLabel = (range: UnitDetails["attackRange"]): string => {
  if (range === null) {
    return "—";
  }

  return range.minRange === range.maxRange
    ? `${range.maxRange}`
    : `${range.minRange}-${range.maxRange}`;
};

// Short labels for the weapon and the unit classes it can hit.
const WEAPON_LABEL: Record<Weapon["kind"], string> = { main: "Main", mg: "MG" };
const TARGET_LABEL: Record<Weapon["targets"][number], string> = {
  infantry: "Inf",
  ground: "Vehicle",
  air: "Air",
  sea: "Ship",
};

const weaponTargetsLabel = (targets: Weapon["targets"]): string =>
  targets.length === 0 ? "—" : targets.map((cls) => TARGET_LABEL[cls]).join(", ");

/** One weapon row: its name (with an ammo dot when it draws on ammo) and the classes it reaches. */
function WeaponRow({ weapon }: { weapon: Weapon }) {
  return (
    <div className="@flex @items-baseline @justify-between @gap-3 @text-xs">
      <span className="@flex @items-center @gap-1 @text-slate-300">
        {WEAPON_LABEL[weapon.kind]}
        {weapon.usesAmmo && (
          <span className="@text-[9px] @text-amber-400" title="uses ammo">
            ●
          </span>
        )}
      </span>
      <span className="@truncate @font-mono @text-slate-100">
        {weaponTargetsLabel(weapon.targets)}
      </span>
    </div>
  );
}

/** `current/max`, or `?/max` when the current value is withheld (an enemy unit), or `—` when N/A. */
const consumableLabel = (current: number | null, max: number | null): string => {
  if (max === null) {
    return "—";
  }

  return `${current ?? "?"}/${max}`;
};

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="@flex @items-baseline @justify-between @gap-3 @text-xs">
      <span className="@uppercase @tracking-wide @text-slate-500">{label}</span>
      <span className="@font-mono @text-slate-100">{value}</span>
    </div>
  );
}

export function UnitDetailCard({ position, army, details, onClose }: Props) {
  const anchor = tileTopLeftCss(position);
  const sprite = details === undefined ? undefined : spriteNameForUnit(details.type);

  return (
    <div
      className="@absolute @z-30 @w-44 @rounded-md @border @border-white/15 @bg-bg-secondary/95 @p-2 @shadow-xl @shadow-black/50 @backdrop-blur"
      style={{ left: anchor.left + tileSizeCss + 6, top: anchor.top - tileSizeCss / 2 }}
    >
      {details === undefined ? (
        <div className="@py-3 @text-center @font-mono @text-xs @text-slate-500">…</div>
      ) : (
        <>
          <div className="@mb-1.5 @flex @items-center @gap-2 @border-b @border-white/10 @pb-1.5">
            {sprite !== undefined && (
              <img
                src={unitSpriteUrl(sprite, army)}
                alt={details.type}
                className="@h-7 @w-7 @flex-none [image-rendering:pixelated]"
              />
            )}
            <span className="@flex-1 @truncate @font-russoOne @text-xs @uppercase @tracking-wide @text-slate-100">
              {details.displayName}
            </span>
            <button
              type="button"
              onClick={onClose}
              className="@flex-none @rounded @px-1 @text-slate-500 hover:@text-slate-200"
              aria-label="Close unit details"
            >
              ✕
            </button>
          </div>

          <div className="@flex @flex-col @gap-0.5">
            {/* visualHp is null when the BE masks it (an enemy Sonja unit hides its HP). */}
            <StatRow
              label="HP"
              value={details.visualHp === null ? "?/10" : `${details.visualHp}/10`}
            />
            <StatRow label="Fuel" value={consumableLabel(details.fuel, details.maxFuel)} />
            <StatRow label="Ammo" value={consumableLabel(details.ammo, details.maxAmmo)} />
            <StatRow label="Move" value={`${details.movementPoints} (${details.movementType})`} />
            <StatRow label="Vision" value={`${details.vision}`} />
            <StatRow label="Range" value={rangeLabel(details.attackRange)} />
          </div>

          {/* Arms: the unit's weapon(s) and which classes each can reach. Absent when unarmed. */}
          <div className="@mt-1.5 @border-t @border-white/10 @pt-1.5">
            <div className="@mb-0.5 @text-[10px] @uppercase @tracking-wider @text-slate-500">
              Arms
            </div>
            {details.weapons.length === 0 ? (
              <div className="@text-xs @italic @text-slate-500">Unarmed</div>
            ) : (
              <div className="@flex @flex-col @gap-0.5">
                {details.weapons.map((weapon) => (
                  <WeaponRow key={weapon.kind} weapon={weapon} />
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
