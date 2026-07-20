"use client";
import type { PowerInfo } from "frontend/components/match/turn-snapshot-view";
import type { BoardPosition } from "frontend/components/match/match-view";
import type { ReactNode } from "react";
import { tileSizeCss, tileTopLeftCss } from "./board-overlay-geometry";

/**
 * The board context menu — right-click an empty tile to reach the actions that aren't tied to a unit:
 * scrap mode, the CO powers, ending the turn, and conceding.
 *
 * Powers and End Turn are deliberate DUPLICATES of the HUD's controls (`PowerActions`, `CommandBar`).
 * They call the very same handlers rather than re-implementing them — the point is reach, not a second
 * code path: the player's hand is already on the board, so the common actions should be under the
 * cursor instead of across the screen.
 *
 * Rendered as DOM rather than a pixi `createBoardMenu` because every entry is a React concern (a
 * typed-confirm modal, tRPC mutations, the HUD's own handlers) — see `board-controller`'s note.
 */
type Props = {
  /** The right-clicked tile — the menu anchors beside it. */
  position: BoardPosition;
  /** Board width in tiles; the menu flips to the tile's left past the halfway mark. */
  mapWidthInTiles: number;
  isMyTurn: boolean;
  /** BE-computed power state; null while the turn snapshot is still loading (or not your turn). */
  power: PowerInfo | null;
  /** True while a power activation is already buffered — blocks a double-tap, as in `PowerActions`. */
  powerPending: boolean;
  /** False while buffered actions are still unresolved, matching `CommandBar`'s End Turn gate. */
  canPassTurn: boolean;
  deleteMode: boolean;
  onToggleDeleteMode: () => void;
  onActivatePower: (isSuper: boolean) => void;
  onPassTurn: () => void;
  /** Opens the surrender confirmation. The menu never surrenders directly — the modal does. */
  onSurrender: () => void;
  /**
   * Whether to offer the dev/admin tools entry. The BE decides this
   * (`match.devTools.availability`) — the board never reasons about roles, it just renders what it's
   * told, and the mutations re-check authorisation regardless.
   */
  devToolsEnabled: boolean;
  /** Opens the dev-tools panel in the chat column. */
  onOpenDevTools: () => void;
  onClose: () => void;
};

const ICON_PROPS = {
  width: 14,
  height: 14,
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

/** Bin glyph — scrap/delete mode. */
const ScrapIcon = () => (
  <svg {...ICON_PROPS}>
    <path d="M2.5 4.5h11M6 4.5V2.5h4v2M4 4.5l.8 9h6.4l.8-9M6.5 7v4M9.5 7v4" />
  </svg>
);

/** A star — the CO power meter's own symbol. */
const StarIcon = () => (
  <svg {...ICON_PROPS} fill="currentColor" stroke="none">
    <path d="M8 1.5l1.9 4 4.4.6-3.2 3 .8 4.4L8 11.4l-3.9 2.1.8-4.4-3.2-3 4.4-.6z" />
  </svg>
);

/** Arrow into a bar — ending your turn / handing over. */
const EndTurnIcon = () => (
  <svg {...ICON_PROPS}>
    <path d="M2.5 8h8M7.5 5l3 3-3 3M13.5 2.5v11" />
  </svg>
);

/** Spanner — the staff dev/admin tools. */
const WrenchIcon = () => (
  <svg {...ICON_PROPS}>
    <path d="M10.8 2.6a3.5 3.5 0 0 0-4.3 4.3L2.6 10.8a1.4 1.4 0 0 0 2 2l3.9-3.9a3.5 3.5 0 0 0 4.3-4.3l-2 2-1.9-.5-.5-1.9z" />
  </svg>
);

/** White flag — surrender. */
const FlagIcon = () => (
  <svg {...ICON_PROPS}>
    <path d="M4 14V2.5M4 3h8l-1.6 2.6L12 8.5H4" />
  </svg>
);

function MenuRow({
  icon,
  label,
  hint,
  onClick,
  disabled = false,
  active = false,
  danger = false,
}: {
  icon: ReactNode;
  label: string;
  hint?: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  danger?: boolean;
}) {
  const tone = active
    ? "@bg-primary @text-black"
    : danger
      ? "@text-red-300 hover:@bg-red-500/15"
      : "@text-slate-200 hover:@bg-white/10";

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={hint ?? label}
      className={`@flex @w-full @items-center @gap-2 @rounded @px-2 @py-1.5 @text-left @font-russoOne @text-[11px] @uppercase @tracking-wide @transition disabled:@cursor-not-allowed disabled:@opacity-35 ${tone}`}
    >
      <span className="@flex-none" aria-hidden>
        {icon}
      </span>
      <span className="@flex-1 @truncate">{label}</span>
    </button>
  );
}

export function BoardContextMenu({
  position,
  mapWidthInTiles,
  isMyTurn,
  power,
  powerPending,
  canPassTurn,
  deleteMode,
  onToggleDeleteMode,
  onActivatePower,
  onPassTurn,
  onSurrender,
  devToolsEnabled,
  onOpenDevTools,
  onClose,
}: Props) {
  const anchor = tileTopLeftCss(position);
  const menuWidth = 168;
  // Flip to the tile's left past the board's midpoint, mirroring the pixi menus' placement rule
  // (see `createBoardMenu`) so both kinds of menu behave the same way near the right edge.
  const flip = position[0] > mapWidthInTiles / 2;
  const left = flip ? anchor.left - menuWidth - 6 : anchor.left + tileSizeCss + 6;

  // Powers show only on your own turn and only once the CO actually has one — the same conditions
  // `PowerActions` renders under, so the two can't disagree about availability.
  const showPowers = isMyTurn && power !== null && power.state === "no-power" && !powerPending;

  return (
    <>
      {/* Click-away scrim. Transparent, and BELOW the menu, so the board stays visible while it's up. */}
      <button
        aria-label="Close menu"
        className="@fixed @inset-0 @z-30 @cursor-default"
        onClick={onClose}
      />

      <div
        className="@absolute @z-40 @flex @flex-col @gap-0.5 @rounded-md @border @border-white/15 @bg-bg-secondary/95 @p-1 @shadow-xl @shadow-black/50 @backdrop-blur"
        style={{ left, top: anchor.top, width: menuWidth }}
      >
        <MenuRow
          icon={<ScrapIcon />}
          label={deleteMode ? "Scrapping…" : "Scrap units"}
          hint={
            deleteMode
              ? "Click your units to scrap them. Select again to stop."
              : "Scrap mode: click your units to disband them, one after another"
          }
          active={deleteMode}
          onClick={onToggleDeleteMode}
        />

        {showPowers && power.copower !== null && (
          <MenuRow
            icon={<StarIcon />}
            label="CO Power"
            hint={`${power.copower.name} — ${power.copower.stars}★`}
            disabled={!power.copower.available}
            onClick={() => onActivatePower(false)}
          />
        )}

        {showPowers && power.superCopower !== null && (
          <MenuRow
            icon={<StarIcon />}
            label="Super Power"
            hint={`${power.superCopower.name} — ${power.superCopower.stars}★`}
            disabled={!power.superCopower.available}
            onClick={() => onActivatePower(true)}
          />
        )}

        {isMyTurn && (
          <MenuRow
            icon={<EndTurnIcon />}
            label="End turn"
            hint={canPassTurn ? "End your turn" : "Waiting for buffered actions to resolve"}
            disabled={!canPassTurn}
            onClick={onPassTurn}
          />
        )}

        {/* Staff only, and offered on or off your turn — the whole point of these tools is staging a
            position at any moment, which is why the backend puts them on `matchBaseProcedure` rather
            than the turn-gated one. Hiding the row is convenience; the mutations re-check the
            capability regardless. */}
        {devToolsEnabled && (
          <>
            <div className="@my-0.5 @border-t @border-white/10" />
            <MenuRow
              icon={<WrenchIcon />}
              label="Dev tools"
              hint="Staff tools: funds, power, locks, production — opens in the chat column"
              onClick={onOpenDevTools}
            />
            {/* Teleport and delete-any-unit are NOT here: they're dev tools, so they live in the dev
                toolbar with the rest. This row is the single door to all of them. */}
          </>
        )}

        <div className="@my-0.5 @border-t @border-white/10" />
        {/* Always offered, on or off your turn — you may concede at any moment, which is why the
            backend gates surrender on membership rather than on holding the turn. */}
        <MenuRow
          icon={<FlagIcon />}
          label="Surrender"
          hint="Concede the match"
          danger
          onClick={onSurrender}
        />
      </div>
    </>
  );
}
