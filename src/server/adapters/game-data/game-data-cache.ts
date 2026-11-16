import type { PrismaClient } from "@prisma/client";
import { setCoProfiles } from "server/engine/rules/co";
import { createLogger } from "shared/utils/logger";
import type { COProfile } from "server/engine/constants/co-profile";
import { loadCoProfiles } from "./co-repo";
import { loadSkins } from "./skins-repo";
import type { SkinMap } from "./skins-repo";

/**
 * In-memory cache of the DB-sourced game data (commander profiles for now). The engine and codex
 * must read game knowledge synchronously on the hot path, so it's loaded once from the DB and held
 * here. Lazily populated on first read (works under both the bundled prod server and Next dev, which
 * don't share a boot path); `initGameData` warms it eagerly at prod startup.
 *
 * The DB is a proven-faithful mirror of the bundled `CO_PROFILES` (see `verify-co-roundtrip`), so
 * reads are behaviour-identical to the constant — the point of the cache is that the data becomes
 * editable via SQL. `invalidateGameData` drops the cache so the next read reflects DB edits.
 */

const logger = createLogger("game-data");

let coProfiles: COProfile[] | null = null;
let skins: SkinMap | null = null;

/** Load from the DB, cache it, and point the engine's CO index at it (combat reads DB too). */
const load = async (prisma: PrismaClient, how: "eager" | "lazy"): Promise<COProfile[]> => {
  coProfiles = await loadCoProfiles(prisma);
  setCoProfiles(coProfiles);
  logger.info(
    `${how === "eager" ? "Loaded" : "Lazily loaded"} ${coProfiles.length} CO profiles from DB.`,
  );
  return coProfiles;
};

/** Eagerly load game data into the cache + engine (call at server boot). */
export const initGameData = async (prisma: PrismaClient): Promise<void> => {
  await load(prisma, "eager");
};

/** CO profiles from the DB, loading + caching (and feeding the engine) on first use. */
export const getCoProfiles = async (prisma: PrismaClient): Promise<COProfile[]> => {
  return coProfiles ?? (await load(prisma, "lazy"));
};

/** Skin → asset path map from the DB (FE sprite resolution), cached on first use. */
export const getSkins = async (prisma: PrismaClient): Promise<SkinMap> => {
  return skins ?? (skins = await loadSkins(prisma));
};

/** Drop both caches so the next read reloads from the DB (after a SQL edit). */
export const invalidateGameData = (): void => {
  coProfiles = null;
  skins = null;
};
