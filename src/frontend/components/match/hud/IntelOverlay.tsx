"use client";
import type { MatchPlayer, MatchView } from "frontend/components/match/match-view";
import { IntelCard } from "./IntelCard";

/**
 * The on-map intel overview (toggled by Tab / the CommandBar button). Renders inside the board's
 * scaled box (a game overlay ON THE MAP), over a dimming scrim owned by `GameShell`.
 *
 * Layout is a centered **VS** composition, team-aware (`view.rules.teamMapping`): the viewer's team
 * stacks on the left, the enemy team on the right, with a VS divider between — so teammates read at
 * the same level and the two sides face off, using the centre space rather than the corners. 3+
 * teams (FFA) fall back to a centered wrap grid.
 *
 * Each `IntelCard` is fog-respecting (visible units/properties only; enemy funds `$ ??`).
 */
type Props = {
  view: MatchView;
  playerId: string;
};

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

export function IntelOverlay({ view, playerId }: Props) {
  const players = orderPlayers(view.players, playerId);
  const activeSlot = view.players.find((player) => player.hasCurrentTurn === true)?.slot;
  const teamOf = (slot: number): number => view.rules.teamMapping[slot] ?? slot;

  // Distinct teams in encounter order — the viewer's team lands first (players are self-first).
  const teamOrder: number[] = [];

  for (const player of players) {
    const team = teamOf(player.slot);

    if (!teamOrder.includes(team)) {
      teamOrder.push(team);
    }
  }

  const card = (player: MatchPlayer) => (
    <div key={player.id} className="@pointer-events-auto @w-[300px] @max-w-full">
      <IntelCard
        view={view}
        player={player}
        viewerPlayerId={playerId}
        active={player.slot === activeSlot}
      />
    </div>
  );

  const heading = (
    <div className="@absolute @left-1/2 @top-3 @-translate-x-1/2 @font-russoOne @text-xs @uppercase @tracking-[0.3em] @text-slate-300 @drop-shadow">
      Battlefield Intel
    </div>
  );

  // Two teams → a VS face-off. Otherwise (FFA / degenerate) → a centered wrap grid.
  if (teamOrder.length === 2) {
    const left = players.filter((player) => teamOf(player.slot) === teamOrder[0]);
    const right = players.filter((player) => teamOf(player.slot) === teamOrder[1]);

    return (
      <div className="@pointer-events-none @absolute @inset-0 @flex @items-center @justify-center @gap-5 @p-6">
        {heading}
        <div className="@flex @flex-col @gap-3">{left.map(card)}</div>
        <span className="@font-russoOne @text-4xl @text-primary @drop-shadow-[0_0_8px_rgba(228,114,32,0.5)]">
          VS
        </span>
        <div className="@flex @flex-col @gap-3">{right.map(card)}</div>
      </div>
    );
  }

  return (
    <div className="@pointer-events-none @absolute @inset-0 @flex @flex-wrap @items-center @justify-center @gap-3 @p-6">
      {heading}
      {players.map(card)}
    </div>
  );
}
