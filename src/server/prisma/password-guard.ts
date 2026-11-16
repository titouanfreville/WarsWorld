import { Prisma } from "@prisma/client";

/**
 * Whether a Prisma query explicitly asked for the password hash.
 *
 * Explicit means `select: { password: true }` — the only way to obtain the hash. A bare
 * `findFirst({ where })`, which returns every scalar column, does NOT count: that convenience is
 * exactly how the hash leaked out of `user.findFirstUserByName` to anonymous callers.
 */
const selectsPassword = (args: unknown): boolean =>
  typeof args === "object" &&
  args !== null &&
  "select" in args &&
  typeof (args as { select?: unknown }).select === "object" &&
  (args as { select: Record<string, unknown> | null }).select?.password === true;

/**
 * Recursively drop `password` from a query result — a single row, a list of rows, or neither
 * (`count`/`aggregate` return numbers, which pass through untouched).
 */
export const stripPassword = <T>(value: T): T => {
  if (Array.isArray(value)) {
    return value.map(stripPassword) as unknown as T;
  }

  if (typeof value === "object" && value !== null && "password" in value) {
    const { password: _hash, ...rest } = value as Record<string, unknown>;

    return rest as unknown as T;
  }

  return value;
};

/**
 * Makes the password hash **opt-in at the query site**: every `User` read drops it unless the
 * caller explicitly wrote `select: { password: true }`.
 *
 * This is a structural guarantee rather than a convention, because the convention already failed
 * once — `user.findFirstUserByName` was a public, unauthenticated tRPC query returning the raw row,
 * hash included. Deleting that endpoint fixes today's leak; this stops the next `findFirst({ where })`
 * from re-creating it.
 *
 * It fails CLOSED. Prisma's generated types still declare `password: string | null`, so a caller
 * that forgets the explicit select type-checks but reads `undefined` at runtime — a login that
 * rejects everyone, not a hash on the wire. `authorize()` in `authOptions.ts` is the one place that
 * opts in, and it null-checks before comparing.
 */
export const passwordGuardExtension = Prisma.defineExtension({
  name: "strip-user-password",
  query: {
    user: {
      async $allOperations({ args, query }) {
        const result: unknown = await query(args);

        return selectsPassword(args) ? result : stripPassword(result);
      },
    },
  },
});
