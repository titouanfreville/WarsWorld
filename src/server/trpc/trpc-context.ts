import type { CreateWSSContextFnOptions } from "@trpc/server/adapters/ws";
import type { CreateNextContextOptions } from "@trpc/server/src/adapters/next";
import type { IncomingHttpHeaders } from "http";
import type { Session } from "next-auth";
import type { GetTokenParams } from "next-auth/jwt";
import { getToken } from "next-auth/jwt";
import { logger } from "shared/utils/logger";

/**
 * The session is read from the request cookie IN PROCESS. That is the whole point of this module.
 *
 * It used to call `getSession()` from `next-auth/react` — the CLIENT helper. On the server that does
 * not read a cookie: it issues an HTTP request to `NEXTAUTH_URL/session`, so every tRPC call and
 * every WebSocket connect made the server fetch its own public URL back through the reverse proxy.
 * Both ways that breaks are SILENT, because `fetchData` swallows the failure and returns `null` —
 * which reads downstream as "signed out" for a caller holding a perfectly valid cookie, so
 * `authMiddleware` answers UNAUTHORIZED and `playerMiddleware` answers "you don't own that player":
 *
 * 1. That helper switches to POST and forwards `req.body` whenever the body is truthy — and Next
 *    populates `req.body` for every `/api/trpc` request (its parser even returns `{}` for an empty
 *    JSON body). next-auth reads a POST to `/session` as a session UPDATE, finds no `csrfToken` in
 *    the tRPC payload, and answers `400 {}`. That is the `CLIENT_FETCH_ERROR … error: {}` that
 *    filled the production logs, and it fired on ordinary gameplay traffic.
 * 2. The self-call has to leave the container, hairpin off the public hostname and come back in, so
 *    a DNS, NAT, TLS or latency hiccup logs a player out mid-match.
 *
 * `getToken` decrypts the session JWT straight from the cookie: no network, no request body,
 * nothing to misroute. It picks the `__Secure-` cookie prefix off `NEXTAUTH_URL`'s scheme — the
 * same source next-auth used when it WROTE the cookie — so the two cannot disagree.
 */

if (process.env.NEXTAUTH_SECRET === undefined) {
  logger.error(
    "NEXTAUTH_SECRET is not set — the session cookie cannot be decrypted, so every request will " +
      "be treated as signed out.",
  );
}

/** Cookie values are percent-encoded; a malformed one must not 500 the request that carried it. */
const decodeCookieValue = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

/**
 * `getToken` reads its cookies off `req.cookies`, which Next populates for an API route but which a
 * raw WebSocket upgrade request simply doesn't have. Parsing the header ourselves gives both
 * transports the same input instead of leaving the WS path silently sessionless.
 */
const parseCookies = (header: string | undefined): Record<string, string> => {
  const cookies: Record<string, string> = {};

  if (header === undefined) {
    return cookies;
  }

  for (const pair of header.split(";")) {
    const separator = pair.indexOf("=");

    if (separator === -1) {
      continue;
    }

    const name = pair.slice(0, separator).trim();

    if (name !== "") {
      cookies[name] = decodeCookieValue(pair.slice(separator + 1).trim());
    }
  }

  return cookies;
};

/**
 * Mirrors `authOptions.callbacks.session` deliberately: the browser gets its session from that
 * callback and tRPC gets it from here, so the two must agree on what a token means. Keep them in
 * step — an id or a role that exists on one side and not the other is a capability check that
 * disagrees with the UI showing it.
 */
const sessionFromHeaders = async (headers: IncomingHttpHeaders): Promise<Session | null> => {
  const token = await getToken({
    // `getToken` only ever reads `headers` (for a Bearer token) and `cookies`, so this shape is
    // everything it needs — the cast just spares us pretending to be a full NextApiRequest.
    req: { headers, cookies: parseCookies(headers.cookie) } as unknown as GetTokenParams["req"],
  });

  // No token, or one carrying no identity, is not a session. The old code handed back a session
  // with `id: ""`, which nothing could act on but which still read as "signed in".
  if (token === null || typeof token.id !== "string" || token.id === "") {
    return null;
  }

  return {
    user: {
      id: token.id,
      name: token.name ?? null,
      email: token.email ?? null,
      image: token.picture ?? null,
      roles: token.roles ?? [],
    },
    // Part of next-auth's Session contract. Nothing in our middleware reads it, but reporting the
    // token's real expiry means a consumer that does can't be misled by a made-up one.
    expires: new Date(typeof token.exp === "number" ? token.exp * 1000 : 0).toISOString(),
  };
};

export async function createContext(opts: CreateNextContextOptions | CreateWSSContextFnOptions) {
  const req = "req" in opts ? opts.req : undefined;
  const session = req === undefined ? null : await sessionFromHeaders(req.headers);

  return {
    session,
    req,
    // Include res for Next.js API routes
    res: "res" in opts ? opts.res : undefined,
  };
}

// Explicitly define Context as an object type
export type Context = Awaited<ReturnType<typeof createContext>>;
