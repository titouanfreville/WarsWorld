import { ProtectPage } from "frontend/components/auth/ProtectPage";
import PickPhase from "frontend/components/match/lobby/PickPhase";
import Head from "next/head";
import { useRouter } from "next/router";
import { z } from "zod";

export default function PickPage() {
  const { query } = useRouter();
  const parsed = z.string().safeParse(query.matchId);

  return (
    <ProtectPage>
      <Head>
        <title>Pick phase — WarsWorld</title>
      </Head>
      {parsed.success ? (
        <PickPhase matchId={parsed.data} />
      ) : (
        <p className="@p-8 @text-red-400">Invalid match id.</p>
      )}
    </ProtectPage>
  );
}
