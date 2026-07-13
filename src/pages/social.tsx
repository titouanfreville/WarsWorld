import { ProtectPage } from "frontend/components/auth/ProtectPage";
import SocialPanel from "frontend/components/social/SocialPanel";
import Head from "next/head";

export default function SocialPage() {
  return (
    <ProtectPage>
      <Head>
        <title>Tactical Communications | Wars World</title>
        <meta
          name="description"
          content="Secure communications console and player network management of Wars World."
        />
      </Head>

      <div className="@mx-auto @max-w-[1200px] @px-4 @pt-8 @pb-16">
        <header className="@mb-6 @flex @flex-col @gap-1 @border-b @border-bg-tertiary/60 @pb-4">
          <h1 className="@py-0 @text-3xl @font-bold @uppercase @tracking-wide @font-russoOne @text-primary">
            Tactical Communications Hub
          </h1>
          <p className="@py-0 @text-xs @text-slate-400 @uppercase @tracking-widest">
            Establish secure encrypted com-links, manage defense categorization, and view military
            network connections.
          </p>
        </header>

        <main className="@min-w-0 @bg-bg-primary/40 @rounded-2xl @p-2 @outline @outline-1 @outline-bg-tertiary/20">
          <SocialPanel />
        </main>
      </div>
    </ProtectPage>
  );
}
