"use client";
import type { SpritesheetDataByArmy } from "frontend/components/match/getSpritesheetData";
import type { MatchView } from "frontend/components/match/match-view";
import { getArmyForSlot } from "frontend/components/match/match-view";
import type { BoardModes } from "frontend/components/match/useBoardModes";
import type { Army } from "frontend/utils/sprites";
import { DevToolsPanel } from "./DevToolsPanel";
import { MatchChat } from "./MatchChat";

type Props = {
  matchId: string;
  playerId: string;
  view: MatchView;
  spritesheetDataByArmy: SpritesheetDataByArmy;
  systemLines: { id: number; text: string }[];
  modes: BoardModes;
  onToggleTeleportMode: () => void;
  onToggleDevDeleteMode: () => void;
  devToolsOpen: boolean;
  onCloseDevTools: () => void;
};

/**
 * The column opposite the HUD: match chat, with the dev-tools panel stacked above it when open.
 *
 * Mirrors the HUD column: pinned to the TOP of the screen, chat pushed to the bottom. `h-full` +
 * `mt-auto` rather than `justify-between` on GameShell's column, which is `justify-end` — the chat
 * must stay at the bottom whether or not the panel is open, and `justify-between` would float it
 * upwards on its own.
 */
export function MatchSideColumn({
  matchId,
  playerId,
  view,
  spritesheetDataByArmy,
  systemLines,
  modes,
  onToggleTeleportMode,
  onToggleDevDeleteMode,
  devToolsOpen,
  onCloseDevTools,
}: Props) {
  // The acting player's own colours for the dev picker sprites; undefined -> name fallback.
  // Cosmetic only, so the loose lookup is fine here (unlike the slot the tools act on, which the
  // server states).
  const me = view.players.find((player) => player.id === playerId);
  const viewerArmy =
    me === undefined ? undefined : (getArmyForSlot(view, me.slot) as Army | undefined);

  return (
    <div className="@flex @h-full @flex-col">
      {devToolsOpen && (
        <DevToolsPanel
          matchId={matchId}
          playerId={playerId}
          teleportMode={modes.teleport !== null}
          onToggleTeleportMode={onToggleTeleportMode}
          devDeleteMode={modes.devDelete}
          onToggleDevDeleteMode={onToggleDevDeleteMode}
          sheets={spritesheetDataByArmy}
          army={viewerArmy}
          onClose={onCloseDevTools}
        />
      )}
      <div className="@mt-auto">
        <MatchChat
          matchId={matchId}
          playerId={playerId}
          players={view.players.map((player) => ({ id: player.id, name: player.name }))}
          systemLines={systemLines}
        />
      </div>
    </div>
  );
}
