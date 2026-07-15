-- Phase 1 backfill: LeagueType -> GameMode x Ruleset  (.ai/plans/ranked-ladder-plan.md §3.1)
--
-- Runs BETWEEN the two `db push`es, while `leagueType` still exists:
--   1. push #1 (additive) — adds GameMode/Ruleset + mode/ruleset columns with defaults
--   2. THIS SCRIPT       — derives real values from leagueType, casts Lobby.mode in place
--   3. push #2           — drops leagueType, types Lobby.mode as GameMode, re-keys MMR
--
-- Idempotent: every statement is a deterministic function of `leagueType`, so re-running is a no-op.
-- Written as SQL, not a Prisma migration, because migrations are still deferred in this project
-- (dev uses `db push`); fold it into the first real migration when that changes.

BEGIN;

-- ── match ───────────────────────────────────────────────────────────────────────────────────────
-- mode: every league except standardTeams is a duel. dualLeague is parked (plan §1.1) and has no
-- rows; if any appear, they'd fall through to duel — assert below catches the case.
UPDATE "match" SET
  "mode" = CASE "leagueType"
             WHEN 'standardTeams' THEN 'teams'::"GameMode"
             ELSE 'duel'::"GameMode"
           END,
  "ruleset" = CASE "leagueType"
                WHEN 'fog'           THEN 'fog'::"Ruleset"
                WHEN 'highFunds'     THEN 'highFunds'::"Ruleset"
                WHEN 'broken'        THEN 'broken'::"Ruleset"
                ELSE 'standard'::"Ruleset"   -- standard, standardTeams, dualLeague
              END;

-- ── Lobby ───────────────────────────────────────────────────────────────────────────────────────
UPDATE "Lobby" SET
  "ruleset" = CASE "leagueType"
                WHEN 'fog'       THEN 'fog'::"Ruleset"
                WHEN 'highFunds' THEN 'highFunds'::"Ruleset"
                WHEN 'broken'    THEN 'broken'::"Ruleset"
                ELSE 'standard'::"Ruleset"
              END;

-- Lobby.mode: free-text -> enum, IN PLACE. `db push` can't express a USING clause, so it would drop
-- and recreate the column (losing every value); raw SQL can. After this, push #2 sees no drift.
-- Guard first: an unmapped value would cast to NULL and violate NOT NULL, so fail loudly instead.
DO $$
DECLARE unmapped text;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'Lobby' AND column_name = 'mode' AND data_type <> 'USER-DEFINED')
  THEN
    SELECT string_agg(DISTINCT "mode", ', ') INTO unmapped
      FROM "Lobby" WHERE "mode" NOT IN ('1v1', '2v2', 'ffa4');

    IF unmapped IS NOT NULL THEN
      RAISE EXCEPTION 'Lobby.mode has unmapped values: %', unmapped;
    END IF;

    ALTER TABLE "Lobby"
      ALTER COLUMN "mode" TYPE "GameMode"
      USING (CASE "mode"
               WHEN '1v1'  THEN 'duel'::"GameMode"
               WHEN '2v2'  THEN 'teams'::"GameMode"
               WHEN 'ffa4' THEN 'ffa'::"GameMode"
             END);
  END IF;
END $$;

-- ── MMR ─────────────────────────────────────────────────────────────────────────────────────────
-- Pooling: rulesets collapse into their mode. This is only lossless while no player holds ratings in
-- two rulesets of the same mode — true today (2 rows, both `standard`, different players), but it is
-- a property of the DATA, not the schema. Assert it rather than trust it: push #2 re-keys the PK to
-- ([playerId, mode]), and a collision there would fail the push after the drop.
UPDATE "MMR" SET
  "mode" = CASE "leagueType"
             WHEN 'standardTeams' THEN 'teams'::"GameMode"
             ELSE 'duel'::"GameMode"
           END;

DO $$
DECLARE dupes int;
BEGIN
  SELECT count(*) INTO dupes FROM (
    SELECT "playerId", "mode" FROM "MMR" GROUP BY 1, 2 HAVING count(*) > 1
  ) x;

  IF dupes > 0 THEN
    RAISE EXCEPTION
      'MMR pooling would collide for % (playerId, mode) pair(s) — push #2 would fail. Resolve before continuing.',
      dupes;
  END IF;
END $$;

COMMIT;
