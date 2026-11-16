import type { IncomingHttpHeaders } from "http";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The session must be read from the cookie IN PROCESS.
 *
 * `createContext` used to call `getSession()` from `next-auth/react`, which on the server does not
 * read a cookie at all — it HTTP-fetches `NEXTAUTH_URL/session`, forwarding `req.body` as a POST
 * whenever the request had one. Next populates `req.body` for every `/api/trpc` request, so
 * next-auth read those as CSRF-less session updates and answered `400 {}`; the helper swallowed
 * that and returned `null`, quietly signing out players holding a valid cookie. The `fetch` spy
 * below is the guard: any reintroduction of a self-call fails these tests rather than production.
 */

// getToken reads both of these at call time; NEXTAUTH_URL's scheme also decides whether it looks
// for the `__Secure-` cookie prefix, so an http URL here keeps the plain name.
process.env.NEXTAUTH_SECRET = "test-secret-for-trpc-context";
process.env.NEXTAUTH_URL = "http://localhost:3000/api/auth";

const { encode } = await import("next-auth/jwt");
const { createContext } = await import("server/trpc/trpc-context");

const SESSION_COOKIE = "next-auth.session-token";

const signedCookie = async (token: Record<string, unknown>) =>
  `${SESSION_COOKIE}=${await encode({ token, secret: process.env.NEXTAUTH_SECRET! })}`;

/**
 * A WebSocket upgrade is a raw `IncomingMessage`: it has headers and NO `cookies` property, unlike
 * the Next API request. Both transports go through `createContext`, so the fixture deliberately
 * omits `cookies` — that is the shape the WS path actually hands over.
 */
const contextFor = (headers: IncomingHttpHeaders) =>
  createContext({ req: { headers } } as unknown as Parameters<typeof createContext>[0]);

describe("tRPC context session", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("never makes a network call to resolve a session", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const cookie = await signedCookie({ id: "user-1", name: "Andy", roles: [] });

    await contextFor({ cookie });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("reads id, name and roles off the cookie of a raw upgrade request", async () => {
    const cookie = await signedCookie({ id: "user-1", name: "Andy", roles: ["admin"] });

    const { session } = await contextFor({ cookie });

    expect(session?.user.id).toBe("user-1");
    expect(session?.user.name).toBe("Andy");
    expect(session?.user.roles).toEqual(["admin"]);
  });

  it("survives the cookie sitting alongside others", async () => {
    const cookie = await signedCookie({ id: "user-2", name: "Max", roles: [] });

    const { session } = await contextFor({ cookie: `theme=dark; ${cookie}; consent=1` });

    expect(session?.user.id).toBe("user-2");
  });

  it("has no session when there is no cookie", async () => {
    expect((await contextFor({})).session).toBeNull();
  });

  it("has no session for a token carrying no identity", async () => {
    const cookie = await signedCookie({ name: "Andy" });

    expect((await contextFor({ cookie })).session).toBeNull();
  });

  it("rejects a forged token rather than trusting it", async () => {
    const forged = await encode({
      token: { id: "user-1", name: "Andy", roles: ["admin"] },
      secret: "not-the-server-secret",
    });

    expect((await contextFor({ cookie: `${SESSION_COOKIE}=${forged}` })).session).toBeNull();
  });

  it("answers a malformed cookie header instead of throwing on it", async () => {
    // A stray `%` is not a valid escape — decoding it unguarded would 500 every request from a
    // client sending one.
    await expect(contextFor({ cookie: "broken; =empty; a=100%" })).resolves.toMatchObject({
      session: null,
    });
  });
});
