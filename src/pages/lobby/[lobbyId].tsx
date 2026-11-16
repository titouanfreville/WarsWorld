import { ProtectPage } from "frontend/components/auth/ProtectPage";
import LobbyRoom from "frontend/components/match/lobby/LobbyRoom";
import Head from "next/head";
import { useRouter } from "next/router";
import { z } from "zod";

export default function LobbyPage() {
  const { query } = useRouter();
  const parsed = z.string().safeParse(query.lobbyId);

  return (
    <ProtectPage>
      <Head>
        <title>Lobby — WarsWorld</title>
      </Head>
      {parsed.success ? (
        <LobbyRoom lobbyId={parsed.data} />
      ) : (
        <p className="@p-8 @text-red-400">Invalid lobby id.</p>
      )}
    </ProtectPage>
  );
}
