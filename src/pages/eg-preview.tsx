import { EndGameScreen, type EndGamePlayer } from "frontend/components/match/hud/EndGameScreen";
import { type Army } from "frontend/utils/sprites";
import { trpc } from "frontend/utils/trpc-client";
import { useRouter } from "next/router";

/**
 * DEV-ONLY preview of the End-Game screen for any match id, so its design can be verified against a
 * real match's data without having to drive a full match to its finish. Usage:
 *   /eg-preview?matchId=<id>&playerId=<optional viewer id>
 * Not linked anywhere; safe to delete. The screen itself reads everything else from `endgame.summary`.
 */
export default function EgPreviewPage() {
  const router = useRouter();
  const matchId = typeof router.query.matchId === "string" ? router.query.matchId : undefined;
  const viewerParam = typeof router.query.playerId === "string" ? router.query.playerId : undefined;

  const summary = trpc.endgame.summary.useQuery(
    { matchId: matchId ?? "" },
    { enabled: matchId !== undefined },
  );

  if (matchId === undefined) {
    return <p style={{ padding: 24 }}>Pass ?matchId=… (and optional &playerId=…)</p>;
  }

  if (summary.data === undefined || summary.data === null) {
    return <p style={{ padding: 24 }}>Loading match {matchId}…</p>;
  }

  const viewerId = viewerParam ?? summary.data.players[0]?.playerId;

  const players: EndGamePlayer[] = summary.data.players.map((player) => ({
    id: player.playerId,
    name: player.name,
    army: player.army as Army,
    coName: player.coName ?? "andy",
    result: (player.result as EndGamePlayer["result"]) ?? undefined,
    isViewer: player.playerId === viewerId,
  }));

  const viewer = players.find((player) => player.isViewer);
  const outcome =
    viewer?.result === "won" ? "victory" : viewer?.result === "lost" ? "defeat" : "draw";

  return (
    <EndGameScreen
      matchId={matchId}
      outcome={outcome}
      players={players}
      onBackToLobby={() => void router.push("/your-games")}
    />
  );
}
