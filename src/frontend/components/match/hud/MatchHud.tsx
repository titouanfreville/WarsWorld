"use client";
import type { MatchPlayer, MatchView } from "frontend/components/match/match-view";
import type { TurnSnapshot } from "frontend/components/match/turn-snapshot-view";
import { CommandBar, type CommandBarProps } from "./CommandBar";
import { derivePlayerStats } from "./derive-player-stats";
import { MINIMAP_STACK_W, type ShellControls } from "./GameShell";
import { MiniMap } from "./MiniMap";
import { PlayerBadge } from "./PlayerBadge";

/**
 * Permanent command HUD around the v2 board, living in the margin beside the board (never over it):
 * the slim `CommandBar` (day / weather / ping / End Turn) and the per-army `PlayerBadge`s at the TOP,
 * and — pushed to the BOTTOM of the same area — the in-match `MatchChat` (left) and live `MiniMap`
 * (right). Everything power-related lives in the badges. A thin composition — every value is
 * BE-authoritative (from `match.full` + the self turn snapshot); the HUD renders and forwards intent.
 *
 * `orientation` comes from `GameShell`: `horizontal` when stacked above the board (a wide bar + a
 * badge row), `vertical` when docked in the board's side margin (a full-height column).
 */
type Props = CommandBarProps & {
  orientation: "horizontal" | "vertical";
  /** Shell controls (burger + fullscreen + intel + minimap) surfaced in the CommandBar. */
  controls: ShellControls;
  playerId: string;
  /** Self turn snapshot (power activation detail); null when it isn't the viewer's turn. */
  snapshot: TurnSnapshot | null;
  powerPending: boolean;
  onActivatePower: (isSuper: boolean) => void;
};

/** Self first, then the rest by slot — the viewer always reads their own army leftmost/topmost. */
const orderPlayers = (players: MatchView["players"], playerId: string): MatchPlayer[] =>
  [...players].sort((a, b) => {
    if (a.id === playerId) {
      return -1;
    }

    if (b.id === playerId) {
      return 1;
    }

    return a.slot - b.slot;
  });

export function MatchHud(props: Props) {
  const { view, playerId, orientation, controls } = props;
  const vertical = orientation === "vertical";
  const players = orderPlayers(view.players, playerId);
  const activeSlot = view.players.find((player) => player.hasCurrentTurn === true)?.slot;

  // The minimap sits at the BOTTOM of the HUD area (tooling above it). In the side column it's pushed
  // down (`@mt-auto`) and fills the column width. Stacked on top of the board it's capped to
  // `MINIMAP_STACK_W` and centered, so it stays a compact panel instead of covering the game view —
  // GameShell reserves exactly that height for it. Chat lives in its own column on the board's left.
  const dock = controls.minimapOpen ? (
    <div
      className={vertical ? "@mt-auto" : "@mx-auto @w-full"}
      style={vertical ? undefined : { maxWidth: MINIMAP_STACK_W }}
    >
      <MiniMap view={view} />
    </div>
  ) : null;

  return (
    <div
      className={
        vertical
          ? "@flex @h-full @w-[340px] @flex-none @flex-col @gap-2 @overflow-y-auto"
          : "@flex @w-full @max-w-[960px] @flex-col @gap-2"
      }
    >
      <CommandBar
        {...props}
        minimapOpen={controls.minimapOpen}
        onToggleMinimap={controls.onToggleMinimap}
      />

      <div className={vertical ? "@flex @flex-col @gap-2" : "@flex @flex-wrap @gap-2"}>
        {players.map((player) => {
          // Power activation lives in the viewer's own badge, on their own turn (the snapshot power
          // is self-only). Every other badge shows just the read-only meter.
          const self = player.id === playerId;

          return (
            <PlayerBadge
              key={player.id}
              player={player}
              stats={derivePlayerStats(view, player, playerId)}
              active={player.slot === activeSlot}
              fill={vertical}
              activatablePower={self && props.isMyTurn ? (props.snapshot?.power ?? null) : null}
              onActivatePower={self ? props.onActivatePower : undefined}
              powerPending={props.powerPending}
              turnEndsAt={view.turnEndsAt}
            />
          );
        })}
      </div>

      {dock}
    </div>
  );
}
