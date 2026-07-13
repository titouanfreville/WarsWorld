"use client"; // This is a client component 👈🏽
import { Layout } from "frontend/components/layout";
import MapBanScreen from "frontend/components/matchmaking/MapBanScreen";
import QueueWidget from "frontend/components/matchmaking/QueueWidget";
import { ProvidePlayers } from "frontend/context/players";
import { ProvideQueue } from "frontend/context/matchmaking";
import "frontend/styles/global.scss";
import type { NextPageWithLayout } from "frontend/types/page";
import { bootstrapSkins } from "frontend/utils/sprites";
import { trpc } from "frontend/utils/trpc-client";
import type { Session } from "next-auth";
import { SessionProvider } from "next-auth/react";
import type { AppType } from "next/app";
import Head from "next/head";
import { useEffect, type ReactElement } from "react";

const MyApp: AppType<{ session: Session | null }> = ({
  Component,
  pageProps: { session, ...pageProps },
}) => {
  // Pages may opt out of the global navbar+footer via `getLayout` (the immersive match view does);
  // otherwise they get the default `Layout`. `ProvidePlayers`/`SessionProvider` wrap either way.
  const getLayout =
    (Component as NextPageWithLayout).getLayout ??
    ((page: ReactElement) => <Layout footer>{page}</Layout>);

  // Load DB-managed skin paths once; sprite resolvers fall back to the path convention until ready.
  useEffect(() => {
    void bootstrapSkins();
  }, []);

  return (
    <SessionProvider session={session}>
      <Head>
        <title>Wars World</title>
        <link rel="icon" href="/favicon.ico" />
        <meta name="viewport" content="width=device-width, initial-scale=1, minimum-scale=1" />
      </Head>
      <ProvidePlayers>
        <ProvideQueue>
          {getLayout(<Component {...pageProps} />)}
          {/* Global, page-independent matchmaking surfaces (render only when active). */}
          <QueueWidget />
          <MapBanScreen />
        </ProvideQueue>
      </ProvidePlayers>
    </SessionProvider>
  );
};

export default trpc.withTRPC(MyApp);
