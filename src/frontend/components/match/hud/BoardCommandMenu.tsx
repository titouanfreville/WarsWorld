"use client";
import type { BoardPosition } from "frontend/components/match/match-view";
import type { PowerInfo } from "frontend/components/match/turn-snapshot-view";
import { trpc } from "frontend/utils/trpc-client";
import { useState } from "react";
import { BoardContextMenu } from "./BoardContextMenu";
import { SurrenderConfirm } from "./SurrenderConfirm";

type Props = {
  matchId: string;
  playerId: string;
  /** The right-clicked tile the menu anchors beside, or `null` when it's shut. */
  position: BoardPosition | null;
  /** A finished match offers no commands — but a confirmation already open stays up. */
  isGameOver: boolean;
  mapWidthInTiles: number;
  isMyTurn: boolean;
  power: PowerInfo | null;
  powerPending: boolean;
  canPassTurn: boolean;
  scrapMode: boolean;
  onToggleScrapMode: () => void;
  onActivatePower: (isSuper: boolean) => void;
  onPassTurn: () => void;
  devToolsEnabled: boolean;
  onOpenDevTools: () => void;
  onClose: () => void;
  onSurrenderError: (error: { message: string }) => void;
};

/**
 * The board's right-click command menu and the confirmations it launches. Every entry closes the
 * menu first, so the board is clear before the action lands.
 *
 * Surrender is NOT buffered through the action queue. The queue exists to keep a turn's intent
 * moving over a flaky link, replaying it against the BE; conceding isn't intent to be replayed —
 * it's a decision that ends the match at once. So it's a plain mutation, and the WS `matchEnd` the
 * BE pushes is what flips the board to its result screen.
 */
export function BoardCommandMenu({
  matchId,
  playerId,
  position,
  isGameOver,
  mapWidthInTiles,
  isMyTurn,
  power,
  powerPending,
  canPassTurn,
  scrapMode,
  onToggleScrapMode,
  onActivatePower,
  onPassTurn,
  devToolsEnabled,
  onOpenDevTools,
  onClose,
  onSurrenderError,
}: Props) {
  const [surrenderOpen, setSurrenderOpen] = useState(false);

  const surrenderMutation = trpc.action.surrender.useMutation({
    onError: onSurrenderError,
    onSettled: () => setSurrenderOpen(false),
  });

  /** Shut the menu, then run the command it launched. */
  const pick = (run: () => void) => {
    onClose();
    run();
  };

  return (
    <>
      {position !== null && !isGameOver && (
        <BoardContextMenu
          position={position}
          mapWidthInTiles={mapWidthInTiles}
          isMyTurn={isMyTurn}
          power={power}
          powerPending={powerPending}
          canPassTurn={canPassTurn}
          deleteMode={scrapMode}
          onToggleDeleteMode={onToggleScrapMode}
          onActivatePower={(isSuper) => pick(() => onActivatePower(isSuper))}
          onPassTurn={() => pick(onPassTurn)}
          onSurrender={() => pick(() => setSurrenderOpen(true))}
          devToolsEnabled={devToolsEnabled}
          onOpenDevTools={() => pick(onOpenDevTools)}
          onClose={onClose}
        />
      )}
      {surrenderOpen && (
        <SurrenderConfirm
          pending={surrenderMutation.isLoading}
          onConfirm={() => surrenderMutation.mutate({ matchId, playerId })}
          onCancel={() => setSurrenderOpen(false)}
        />
      )}
    </>
  );
}
