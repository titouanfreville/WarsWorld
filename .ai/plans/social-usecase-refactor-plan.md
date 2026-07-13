# Plan — `social` feature refactor (extract usecase/schemas + fix embedded bugs)

**Origin:** full-review finding #4 `[both]` (sheik structural + bmad concrete bugs), 2026-07-13.
`src/server/social/router.ts` is a 689-line transport with 46 inline `prisma.*` calls, 16 inline
`z.object` schemas, and block/idempotency/notification logic living directly in tRPC procedures. It is
the lone feature ignoring the module anatomy every sibling follows (honor, endgame, ranking, matches,
lobby, matchmaking all have `usecase.ts` + `schemas.ts`), and consequently has no tests — which is why
several concrete bugs live in it undetected.

## Goal
Bring `social` in line with `src/server/CLAUDE.md` module anatomy, then the bugs become testable and
fixable in the usecase:
```
src/server/social/
  social.usecase.ts   ENTRY POINT — class, deps (prisma, emitter) via constructor; methods read as intent.
  schemas.ts          the 16 inline zod schemas, named and exported.
  router.ts           thin: validate → call usecase → map errors → return. No prisma, no logic.
  dbo.ts              OPTIONAL — only if the prisma access stops being one-liners.
```

## Embedded bugs to fix during the extraction (from the review)
- **#10 ownership check** — `assignFriendToCategory`/`removeFriendFromCategory` (`:3592`): filter
  `categoryId`/`friendshipId` by `ownerId === currentPlayer.id`. A player can currently mutate
  another player's friend categories.
- **#9 write-in-a-query** — `getConversationHistory` (`:3827`) advances `lastReadAt` and emits
  `CONVERSATION_READ` from a tRPC **query**. Move the read-cursor advance into a mutation
  (`markConversationRead`) so prefetch/refetch can't fire spurious read-receipts.
- **#17 duplicate conversations** — `getOrCreateMatchChannels` `ensure` (`:3678`): `findFirst` +
  `create` with no unique constraint. Add a unique `(matchId, teamIndex)` and use `upsert`.
- **#19 post-game gate** — `sendMessage` (`:3737`) only gates `status === "finished"`; the new
  `cancelled` status stays writable, and a concurrently-deleted conversation is null → gate skipped →
  `message.create` on a dangling id. Gate all terminal statuses; handle null conversation.
- **#20 block/mute validation** — `block`/`mutePlayer` (`:3987`): validate the target exists and is
  not self (consistent with `sendFriendRequest`, which already forbids self-targeting).

## Approach
1. Add `schemas.ts` — lift the 16 inline schemas, name them.
2. Add `social.usecase.ts` — move each procedure's body into a usecase method (constructor-injected
   `prisma` + emitter); fix the bugs above as each method moves.
3. Slim `router.ts` to bindings; wire the usecase at the composition root (avoid the module-singleton
   pattern flagged in #11 — hand the router its instance).
4. Add the missing unique constraint (`Conversation (matchId, teamIndex)`) — Prisma `db push` in dev
   (migrations still deferred per project memory).
5. **Tests** (`src/tests/features/social-*.test.ts`, pure usecase): ownership rejection, read-cursor
   only advances via mutation, upsert idempotency, cancelled-match gate, self-block/self-mute rejection.

## Notes
- Keep authz on the correct base procedure (`playerBaseProcedure`) — several social procedures also
  overlap finding #16 (viewer-authorization) philosophy; ensure membership checks aren't dropped.
- Sequence after or alongside the composition-root work (#11) so wiring lands once, not twice.
