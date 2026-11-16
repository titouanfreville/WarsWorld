import { z } from "zod";

/**
 * "Which match" — the one piece of vocabulary shared by the engine (every emittable event carries
 * it) and transport (every match-scoped procedure takes it as input).
 *
 * It lives in `core` because both need it and neither may import the other: the engine used to read
 * this type from `trpc/middleware/match`, which drags transport — and, through that file's own
 * imports, Prisma and the match store — into the engine's type graph.
 *
 * Typed as a plain string rather than Prisma's `Match["id"]`: `core` is Prisma-free, and the
 * adapter boundary is where a row id becomes a domain id.
 */
export const withMatchIdSchema = z.object({ matchId: z.string() });

export type WithMatchId = z.infer<typeof withMatchIdSchema>;
