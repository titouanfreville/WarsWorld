"use client";
import type { MatchView } from "frontend/components/match/match-view";
import { MatchChat } from "./MatchChat";

type Props = {
  matchId: string;
  playerId: string;
  view: MatchView;
  systemLines: { id: number; text: string }[];
};

/**
 * The column opposite the HUD: match chat.
 *
 * Mirrors the HUD column: pinned to the TOP of the screen, chat pushed to the bottom. `h-full` +
 * `mt-auto` rather than `justify-between` on GameShell's column, which is `justify-end` — the chat
 * must stay at the bottom whatever else is stacked above it.
 *
 * The dev-tools panel stacks above the chat here; it (and the props it needs) land with the
 * dev-tools feature rather than sitting unused in the meantime.
 */
export function MatchSideColumn({ matchId, playerId, view, systemLines }: Props) {
  return (
    <div className="@flex @h-full @flex-col">
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
