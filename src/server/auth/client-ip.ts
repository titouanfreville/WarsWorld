/** The minimum of a request we need to identify a caller — matches both Next's and the WS server's. */
type RequestLike = {
  headers?: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
};

/**
 * Best-effort caller address, for the burst limiter.
 *
 * `x-forwarded-for` is trusted because in production the app sits behind a proxy that sets it. That
 * makes the key spoofable by anyone who can reach the server directly — which is why it only ever
 * keys the coarse rate limiter, never the credential backoff. That one is keyed on the ACCOUNT
 * name (see `throttle.dbo.ts`), which an attacker cannot forge: guessing a password means sending
 * that account's name every time.
 */
export const clientIp = (req: RequestLike | undefined): string => {
  const forwarded = req?.headers?.["x-forwarded-for"];
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const fromProxy = first?.split(",")[0]?.trim();

  if (fromProxy !== undefined && fromProxy !== "") {
    return fromProxy;
  }

  return req?.socket?.remoteAddress ?? "unknown";
};
