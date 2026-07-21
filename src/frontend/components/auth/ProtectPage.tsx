import { useSession } from "next-auth/react";
import { useRouter } from "next/router";
import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Gate for pages that need a signed-in player (pick phase, lobby, your games, play, social).
 *
 * Two things it has to get right, both of which used to be wrong:
 *
 * 1. **Where it sends you.** It pushed `pathname: "/."`, which matches no route, so an unauthenticated
 *    visit rendered Next's 404 *while the address bar still showed the protected page* — which is how
 *    "the pick link 404s" presented. Home is the app's login surface (`authOptions.pages.signIn` is
 *    `/?authModalOpen`), and `callbackUrl` brings you back here afterwards.
 *
 * 2. **When it gives up.** next-auth reports a FAILED `/api/auth/session` request as
 *    `"unauthenticated"` — indistinguishable from a real logout. A dev-server recompile or a network
 *    blip is enough, so a signed-in player could be thrown off mid-match. We re-ask once before
 *    bouncing, and redirect only if the session is still genuinely absent.
 */

/** Grace before re-checking a session that came back empty, in ms. */
const RECHECK_MS = 1200;

export const ProtectPage = ({ children }: { children: ReactNode }) => {
  const router = useRouter();
  const { status, update } = useSession();
  // True while a suspicious "unauthenticated" gets its second chance — we show the loading state
  // rather than the page, so a protected view never flashes at a maybe-logged-out visitor.
  const [rechecking, setRechecking] = useState(false);

  // `update` and `router` are NOT stable identities across renders (next-auth doesn't document
  // `update` as memoised, and `router` changes on navigation). With them in the dependency list, any
  // re-render inside the grace window tore down the effect and restarted the 1200ms timer — a page
  // that re-renders often could postpone the re-check indefinitely. Read them through refs and
  // depend only on what should actually retrigger the gate: `status`.
  const updateRef = useRef(update);
  const routerRef = useRef(router);

  updateRef.current = update;
  routerRef.current = router;

  useEffect(() => {
    if (status !== "unauthenticated") {
      return;
    }

    let cancelled = false;

    setRechecking(true);

    const bounce = () => {
      void routerRef.current.push({
        pathname: "/",
        query: `authModalOpen&error=ProtectedPage&callbackUrl=${encodeURIComponent(
          window.location.href,
        )}`,
      });
    };

    const timer = setTimeout(() => {
      updateRef
        .current()
        .then((session) => {
          if (cancelled) {
            return;
          }

          if (session !== null) {
            setRechecking(false); // a blip: the session came back, stay on the page
            return;
          }

          bounce();
        })
        .catch(() => {
          // The re-check itself FAILED — `/api/auth/session` is down, which is the very scenario
          // this grace period exists for. Without this branch the `.then` never ran: `rechecking`
          // stayed true forever, the page rendered "LOADING . . ." with no redirect and no way out,
          // and the rejection surfaced as an unhandled promise.
          //
          // We gave the session its second chance and could not confirm one, so treat it exactly
          // like a confirmed absence and send them to the login surface.
          if (!cancelled) {
            bounce();
          }
        });
    }, RECHECK_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [status]);

  if (status === "loading" || rechecking) {
    return (
      <div className="@flex @flex-col @items-center @align-middle @justify-center @w-full @h-[50vh]">
        <div>LOADING . . .</div>
      </div>
    );
  }

  if (status === "unauthenticated") {
    return null; // redirect in flight — don't flash the protected page
  }

  return <>{children}</>;
};
