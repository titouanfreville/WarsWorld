"use client";
import type { SpritesheetDataByArmy } from "frontend/components/match/getSpritesheetData";
import type { BoardPosition } from "frontend/components/match/match-view";
import type { RouterOutput } from "frontend/utils/trpc-client";
import { spriteNameForUnit, unitSpriteUrl, type Army } from "frontend/utils/sprites";
import { useEffect, useRef, useState } from "react";
import { tileSizeCss, tileTopLeftCss } from "./board-overlay-geometry";
import { terrainThumb } from "./terrain-sprite";

/**
 * BE-computed stat readout for one inspected thing (see the `unitDetails` preview). Typed by tRPC
 * inference. It's a union: a unit, or the one piece of terrain that has HP and can be shot — a pipe
 * seam (`kind: "terrain"`), which carries health and cover but none of a unit's stats.
 */
export type UnitDetails = NonNullable<RouterOutput["match"]["previews"]["unitDetails"]>;

/** The unit member of that union, for the fields only a unit has (weapons, range, movement). */
type UnitOnlyDetails = Extract<UnitDetails, { kind: "unit" }>;

/**
 * Unit-detail card opened by right-clicking a visible unit — its ammo, fuel, movement, HP, vision and
 * attack range, plus the terrain it's standing on. Current fuel/ammo are only present for the viewer's
 * OWN units (the BE withholds them for enemies, matching AW); those show as `?`. Purely
 * presentational — every number comes from the BE.
 *
 * Stats are labelled with ICONS rather than words: the card sits on top of the board mid-decision, so
 * it has to be readable at a glance and small enough not to bury the map. Each icon keeps a `title`
 * (and the terrain keeps its name in text), so nothing is icon-only to a screen reader.
 *
 * It anchors beside the inspected unit and DODGES the cursor — see `useDodgeSide`.
 */
type Props = {
  /** The inspected unit's tile — used to anchor the card beside it. */
  position: BoardPosition;
  /** Army of the unit's owner, for the sprite; `undefined` falls back to a neutral sprite. */
  army: Army | undefined;
  /** BE stats; `undefined` while the query is in flight. */
  details: UnitDetails | undefined;
  /** Raw atlases, for slicing the terrain tile's art out of the spritesheet. */
  spritesheetDataByArmy: SpritesheetDataByArmy;
  /** Army owning the terrain underfoot (may differ from the unit's); `undefined` when unowned. */
  terrainArmy: Army | undefined;
  onClose: () => void;
};

type Weapon = UnitOnlyDetails["weapons"][number];

const CARD_WIDTH = 184;
/** How far past the tile's centre the cursor must travel before the card jumps sides. */
const DODGE_DEADBAND = 10;

/**
 * Which side of the anchor tile the card should sit on: always the side the cursor ISN'T, so the
 * pointer never covers what you opened the card to read. The deadband stops it flip-flopping while
 * the cursor hovers near the tile's centre line.
 *
 * Tracked as a side rather than raw coordinates so a pointer move only re-renders when the card
 * actually needs to move.
 */
const useDodgeSide = (position: BoardPosition, cardRef: { current: HTMLElement | null }) => {
  const [side, setSide] = useState<"left" | "right">("right");

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      // The card is absolutely positioned inside the board's relative wrapper, so the tile's viewport
      // x is that wrapper's left edge plus the tile's offset within it.
      const parent = cardRef.current?.offsetParent;

      if (!(parent instanceof HTMLElement)) {
        return;
      }

      const anchorX =
        parent.getBoundingClientRect().left + tileTopLeftCss(position).left + tileSizeCss / 2;
      const dx = event.clientX - anchorX;

      setSide((previous) => {
        if (dx > DODGE_DEADBAND) {
          return "left"; // cursor is right of the tile — get out from under it
        }

        if (dx < -DODGE_DEADBAND) {
          return "right";
        }

        return previous;
      });
    };

    window.addEventListener("pointermove", onMove);

    return () => window.removeEventListener("pointermove", onMove);
  }, [position, cardRef]);

  return side;
};

const rangeLabel = (range: UnitOnlyDetails["attackRange"]): string => {
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

/** Terrain keys are engine-side camelCase (`unusedSilo`, `pipeSeam`); show them as words. */
const terrainLabel = (type: string): string =>
  type.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (char) => char.toUpperCase());

const ICON_PROPS = {
  width: 12,
  height: 12,
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const HpIcon = () => (
  <svg {...ICON_PROPS} fill="currentColor" stroke="none">
    <path d="M8 14S1.5 10 1.5 5.8A3.3 3.3 0 0 1 8 4.3a3.3 3.3 0 0 1 6.5 1.5C14.5 10 8 14 8 14z" />
  </svg>
);

/** Fuel drop. */
const FuelIcon = () => (
  <svg {...ICON_PROPS}>
    <path d="M8 1.8s4.5 4.6 4.5 7.7a4.5 4.5 0 0 1-9 0C3.5 6.4 8 1.8 8 1.8z" />
  </svg>
);

/** A shell — ammo. */
const AmmoIcon = () => (
  <svg {...ICON_PROPS}>
    <path d="M8 1.5c1.6 1.6 2.4 3.3 2.4 5.2v3.1H5.6V6.7c0-1.9.8-3.6 2.4-5.2zM5.6 10.3h4.8v2.6H5.6zM7 12.9v1.6M9 12.9v1.6" />
  </svg>
);

/** A boot — movement. */
const MoveIcon = () => (
  <svg {...ICON_PROPS}>
    <path d="M5 2.5v6.2c0 1 .4 1.6 1.4 2l4.6 1.8c1.4.5 2.5-.2 2.5-1.6 0-.9-.5-1.5-1.4-1.9L8.4 7.1C7.5 6.7 7 6.1 7 5.2V2.5z" />
  </svg>
);

/** An eye — vision. */
const VisionIcon = () => (
  <svg {...ICON_PROPS}>
    <path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" />
    <circle cx="8" cy="8" r="2" />
  </svg>
);

/** A crosshair — attack range. */
const RangeIcon = () => (
  <svg {...ICON_PROPS}>
    <circle cx="8" cy="8" r="5" />
    <path d="M8 1v2.5M8 12.5V15M1 8h2.5M12.5 8H15" />
  </svg>
);

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

/** An icon-labelled stat. The `title` carries the word the icon stands in for. */
function StatCell({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="@flex @items-center @gap-1.5" title={label}>
      <span className="@flex-none @text-slate-500" aria-hidden>
        {icon}
      </span>
      <span className="@sr-only">{label}</span>
      <span className="@font-mono @text-xs @text-slate-100">{value}</span>
    </div>
  );
}

export function UnitDetailCard({
  position,
  army,
  details,
  spritesheetDataByArmy,
  terrainArmy,
  onClose,
}: Props) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const side = useDodgeSide(position, cardRef);
  const anchor = tileTopLeftCss(position);
  // Terrain (a pipe seam) has no unit sprite — its art is the tile thumbnail below, same as the
  // terrain strip on a unit's card.
  const sprite =
    details === undefined || details.kind === "terrain"
      ? undefined
      : spriteNameForUnit(details.type);

  // Dodge to the cursor's opposite side, but never off the left edge of the board.
  const leftCandidate = anchor.left - CARD_WIDTH - 6;
  const left =
    side === "left" && leftCandidate >= 0 ? leftCandidate : anchor.left + tileSizeCss + 6;

  const thumb =
    details === undefined
      ? undefined
      : terrainThumb(spritesheetDataByArmy, details.terrain, terrainArmy);

  return (
    <div
      ref={cardRef}
      className="@absolute @z-30 @rounded-md @border @border-white/15 @bg-bg-secondary/95 @p-2 @shadow-xl @shadow-black/50 @backdrop-blur"
      style={{ left, top: anchor.top - tileSizeCss / 2, width: CARD_WIDTH }}
    >
      {details === undefined ? (
        <div className="@py-3 @text-center @font-mono @text-xs @text-slate-500">…</div>
      ) : (
        <>
          <div className="@mb-1.5 @flex @items-center @gap-2 @border-b @border-white/10 @pb-1.5">
            {sprite !== undefined && (
              <img
                src={unitSpriteUrl(sprite, army)}
                alt=""
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

          {/* Two columns of icon-labelled stats — compact enough to read without scanning words.
              Terrain (a pipe seam) has HP and nothing else: no fuel, ammo, movement or reach, so it
              shows the health line alone rather than a grid of dashes. */}
          <div className="@grid @grid-cols-2 @gap-x-3 @gap-y-1">
            {/* visualHp is null when the BE masks it (an enemy Sonja unit hides its HP). */}
            <StatCell
              icon={<HpIcon />}
              label="HP"
              value={details.visualHp === null ? "?/10" : `${details.visualHp}/10`}
            />
            {details.kind === "terrain" ? null : (
              <>
                <StatCell
                  icon={<FuelIcon />}
                  label="Fuel"
                  value={consumableLabel(details.fuel, details.maxFuel)}
                />
                <StatCell
                  icon={<AmmoIcon />}
                  label="Ammo"
                  value={consumableLabel(details.ammo, details.maxAmmo)}
                />
                <StatCell
                  icon={<MoveIcon />}
                  label={`Movement — ${details.movementType}`}
                  value={`${details.movementPoints}`}
                />
                <StatCell icon={<VisionIcon />} label="Vision" value={`${details.vision}`} />
                <StatCell
                  icon={<RangeIcon />}
                  label="Attack range"
                  value={rangeLabel(details.attackRange)}
                />
              </>
            )}
          </div>

          {/* The tile underfoot: its real art sliced from the spritesheet, its name, and the cover it
              gives as filled stars — the same star vocabulary the combat forecast uses. */}
          <div className="@mt-1.5 @flex @items-center @gap-2 @border-t @border-white/10 @pt-1.5">
            {thumb !== undefined && (
              <span
                className="@flex-none"
                style={{
                  width: thumb.width * 2,
                  height: thumb.height * 2,
                  backgroundImage: `url(${thumb.url})`,
                  backgroundPosition: `${-thumb.x * 2}px ${-thumb.y * 2}px`,
                  backgroundSize: `${thumb.sheetWidth * 2}px ${thumb.sheetHeight * 2}px`,
                  imageRendering: "pixelated",
                }}
                aria-hidden
              />
            )}
            <div className="@min-w-0 @flex-1">
              <div className="@truncate @text-xs @text-slate-200">
                {terrainLabel(details.terrain.type)}
              </div>
              <div
                className="@font-mono @text-[11px] @text-amber-400"
                title={`${details.terrain.defenseStars} defense stars`}
              >
                {details.terrain.defenseStars === 0
                  ? "no cover"
                  : "★".repeat(details.terrain.defenseStars)}
              </div>
            </div>
          </div>

          {/* Arms: the unit's weapon(s) and which classes each can reach. Absent when unarmed, and
              omitted entirely for terrain — a pipe seam is shot AT, it never shoots back. */}
          {details.kind === "unit" && (
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
          )}
        </>
      )}
    </div>
  );
}
