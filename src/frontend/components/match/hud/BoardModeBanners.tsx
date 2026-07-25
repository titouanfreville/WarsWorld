"use client";
import type { BoardModes } from "frontend/components/match/useBoardModes";
import { DeleteModeBanner } from "./DeleteModeBanner";
import { DevDeleteModeBanner } from "./DevDeleteModeBanner";
import { TeleportModeBanner } from "./TeleportModeBanner";

type Props = {
  modes: BoardModes;
  /** A finished match shows no mode banner — `useBoardModes` disarms them all on game-over. */
  hidden: boolean;
  onDisarm: () => void;
};

/**
 * The standing banner for whichever board mode is armed. The modes are mutually exclusive (see
 * `useBoardModes`), so at most one of these ever renders — they share the same slot over the board,
 * and exiting any of them is just "disarm".
 */
export function BoardModeBanners({ modes, hidden, onDisarm }: Props) {
  if (hidden) {
    return null;
  }

  if (modes.scrap) {
    return <DeleteModeBanner onExit={onDisarm} />;
  }

  if (modes.teleport !== null) {
    return <TeleportModeBanner hasPickedUnit={modes.teleport.from !== null} onExit={onDisarm} />;
  }

  if (modes.devDelete) {
    return <DevDeleteModeBanner onExit={onDisarm} />;
  }

  return null;
}
