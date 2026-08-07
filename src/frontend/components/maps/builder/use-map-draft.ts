import { useCallback, useEffect, useRef, useState } from "react";
import { trpc } from "frontend/utils/trpc-client";
import type { DraftMap, MapFairnessReport, SaveState } from "./builder-types";

/**
 * How long the grid must sit still before the checker is asked for a verdict. Short enough that the
 * ladder reads as live, long enough that dragging a road across the map is one call and not forty.
 */
export const CHECK_DEBOUNCE_MS = 400;

/** The requested idle autosave: the work is at rest, so write it down. */
export const AUTOSAVE_IDLE_MS = 45_000;

/**
 * A ceiling on unsaved work. Idle-only saving loses an hour of continuous painting, because someone
 * who never pauses never triggers it.
 */
export const AUTOSAVE_MAX_MS = 120_000;

type Options = {
  mapId: string;
  playerId: string;
  /** `updatedAt` as the server last reported it — the optimistic-concurrency token. */
  initialSeenAt: Date;
};

/**
 * Owns a draft's two server conversations, which run at different speeds on purpose:
 *
 * - **check** — debounced, read-only, frequent. Feeds the certification ladder.
 * - **save** — idle or capped, writes, infrequent. Returns an authoritative verdict of its own.
 *
 * The frontend renders both; it decides neither. Every verdict on screen came from the server, and
 * publish/submit re-evaluate again server-side regardless of what was last shown here.
 */
export const useMapDraft = ({ mapId, playerId, initialSeenAt }: Options) => {
  const [report, setReport] = useState<MapFairnessReport | null>(null);
  const [saveState, setSaveState] = useState<SaveState>({ kind: "saved", at: initialSeenAt });

  const seenAt = useRef(initialSeenAt);
  const pending = useRef<DraftMap | null>(null);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const evaluate = trpc.map.evaluate.useMutation();
  const updateDraft = trpc.map.updateDraft.useMutation();

  const clearTimers = () => {
    if (idleTimer.current !== null) {
      clearTimeout(idleTimer.current);
      idleTimer.current = null;
    }

    if (maxTimer.current !== null) {
      clearTimeout(maxTimer.current);
      maxTimer.current = null;
    }
  };

  const save = useCallback(async () => {
    const map = pending.current;

    if (map === null) {
      return;
    }

    clearTimers();
    pending.current = null;
    setSaveState({ kind: "saving" });

    try {
      const result = await updateDraft.mutateAsync({
        ...map,
        // The server schema types `tiles` as a NON-EMPTY tuple, which an FE-local array type cannot
        // prove. One documented cast at the boundary beats spreading tuple types through the
        // builder — and the server re-parses the payload with the same zod schema regardless.
        tiles: map.tiles as Parameters<typeof updateDraft.mutateAsync>[0]["tiles"],
        predeployedUnits: map.predeployedUnits as Parameters<
          typeof updateDraft.mutateAsync
        >[0]["predeployedUnits"],
        playerId,
        mapId,
        seenAt: seenAt.current,
      });

      seenAt.current = result.updatedAt;
      setReport(result.report);
      setSaveState({ kind: "saved", at: result.updatedAt });
    } catch (error) {
      // Keep the edit: a failed save must never be a lost stroke. It stays pending and the next
      // trigger retries it.
      pending.current = map;
      setSaveState({
        kind: "failed",
        message: error instanceof Error ? error.message : "Could not save.",
      });
    }
  }, [mapId, playerId, updateDraft]);

  /** Call on every edit. Schedules the check and the save; neither runs on the calling stroke. */
  const onEdit = useCallback(
    (map: DraftMap) => {
      pending.current = map;
      setSaveState((current) => (current.kind === "saving" ? current : { kind: "dirty" }));

      if (idleTimer.current !== null) {
        clearTimeout(idleTimer.current);
      }

      idleTimer.current = setTimeout(() => void save(), AUTOSAVE_IDLE_MS);

      // Started once and deliberately not reset by later edits: this is the ceiling on how long
      // work can stay unsaved, so a continuous painting session still lands on disk.
      if (maxTimer.current === null) {
        maxTimer.current = setTimeout(() => void save(), AUTOSAVE_MAX_MS);
      }
    },
    [save],
  );

  // A tab switch is the most common way work gets abandoned. `beforeunload` is deliberately absent:
  // a tRPC mutation is a POST and `keepalive` caps at 64KB, which a 40x40 grid exceeds — it would
  // appear to work on small maps and silently fail on exactly the large ones people care about.
  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === "hidden" && pending.current !== null) {
        void save();
      }
    };

    document.addEventListener("visibilitychange", onHidden);
    return () => document.removeEventListener("visibilitychange", onHidden);
  }, [save]);

  useEffect(() => clearTimers, []);

  return {
    report,
    setReport,
    saveState,
    onEdit,
    saveNow: save,
    evaluate,
    hasUnsavedWork: () => pending.current !== null,

    /** The concurrency token to send with the next write. */
    lastSeenAt: () => seenAt.current,

    /**
     * Take on an `updatedAt` from a write that went round this hook — resize, for one, rewrites the
     * whole grid server-side. Without this the next autosave would send a stale token and be
     * refused as a conflict with itself.
     */
    adopt: (updatedAt: Date) => {
      seenAt.current = updatedAt;
      pending.current = null;
      setSaveState({ kind: "saved", at: updatedAt });
    },
  };
};
