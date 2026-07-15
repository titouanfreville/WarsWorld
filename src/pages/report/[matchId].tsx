import { EndGameScreen, type EndGamePlayer } from "frontend/components/match/hud/EndGameScreen";
import { usePlayers } from "frontend/context/players";
import { type Army } from "frontend/utils/sprites";
import { trpc } from "frontend/utils/trpc-client";
import Head from "next/head";
import { useRouter } from "next/router";

/**
 * The battle report for a finished match — the same End-Game screen shown the moment a game ends,
 * reachable afterwards from Your Games → History.
 *
 * Public on purpose, mirroring `endgame.summary` (a `publicBaseProcedure`: "post-game stats aren't
 * secret, and it must work after the match leaves the live store"). So a report URL is shareable,
 * and a logged-out visitor sees the match from the winner's seat rather than a login wall.
 *
 * Supersedes `eg-preview`, which did this as a DEV-ONLY page with the viewer passed by query string.
 */
export default function MatchReportPage() {
  const router = useRouter();
  const { currentPlayer } = usePlayers();
  const matchId = typeof router.query.matchId === "string" ? router.query.matchId : undefined;

  const summary = trpc.endgame.summary.useQuery(
    { matchId: matchId ?? "" },
    { enabled: matchId !== undefined },
  );

  if (matchId === undefined || summary.isLoading) {
    return (
      <div className="@flex @h-[60vh] @items-center @justify-center @text-slate-500">
        Loading battle report…
      </div>
    );
  }

  if (summary.isError || summary.data === null || summary.data === undefined) {
    return (
      <div className="@flex @h-[60vh] @flex-col @items-center @justify-center @gap-4">
        <p className="@py-0 @text-slate-400">No battle report for this match.</p>
        <button
          onClick={() => void router.push("/your-games?tab=history")}
          className="@rounded-lg @border @border-bg-tertiary @px-4 @py-2 @text-xs @font-semibold @uppercase @tracking-wide @text-slate-300 hover:@text-white"
        >
          Back to your games
        </button>
      </div>
    );
  }

  // Show the match from the reader's own seat when they played it; a spectator (or a logged-out
  // visitor following a shared link) gets the first seat, which `endgame.summary` orders by result.
  const viewerId = summary.data.players.some((player) => player.playerId === currentPlayer?.id)
    ? currentPlayer?.id
    : summary.data.players[0]?.playerId;

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
    <>
      <Head>
        <title>{summary.data.mapName} — Battle Report | Wars World</title>
      </Head>
      <EndGameScreen
        matchId={matchId}
        outcome={outcome}
        players={players}
        onBackToLobby={() => void router.push("/your-games?tab=history")}
      />
    </>
  );
}
