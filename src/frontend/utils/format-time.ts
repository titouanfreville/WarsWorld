/**
 * The single home for timestamp/duration formatting on the client (see src/frontend/CLAUDE.md:
 * date/time is deterministic and centralised — don't sprinkle `new Date(...)` / `toLocaleString(...)`
 * through components). Wire timestamps are the source of truth; these format at the edge.
 *
 * Pure and dependency-free. `formatDuration` is timezone-independent; `formatMatchDate` is not, so
 * its tests pin `process.env.TZ`.
 */

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * Wall-clock length of a match, at the granularity a player cares about: minutes under an hour,
 * hours + minutes above it, days + hours for the correspondence games that run for weeks.
 * Sub-minute rounds up to "1m" — "0m" reads as missing data rather than a very fast match.
 */
export const formatDuration = (ms: number): string => {
  if (!Number.isFinite(ms) || ms <= 0) {
    return "—";
  }

  if (ms < HOUR_MS) {
    return `${Math.max(1, Math.round(ms / MINUTE_MS))}m`;
  }

  if (ms < DAY_MS) {
    const hours = Math.floor(ms / HOUR_MS);
    const minutes = Math.round((ms % HOUR_MS) / MINUTE_MS);

    return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
  }

  const days = Math.floor(ms / DAY_MS);
  const hours = Math.round((ms % DAY_MS) / HOUR_MS);

  return hours === 0 ? `${days}d` : `${days}d ${hours}h`;
};

/**
 * When a finished match ended. Short and scannable in a list — `finishedAt` may be null on rows
 * archived before the outcome was persisted, so null is a real case, not a bug.
 */
export const formatMatchDate = (value: Date | string | null | undefined): string => {
  if (value === null || value === undefined) {
    return "—";
  }

  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
};

/**
 * A wall-clock time (hours:minutes) for a chat/message timestamp. `undefined` locale means "use the
 * runtime default" — in the browser that's the navigator's locale and timezone — so the format
 * follows the viewer's own settings without the component choosing. Like `formatMatchDate` it's
 * timezone-dependent, so its tests pin `process.env.TZ`.
 */
export const formatClockTime = (value: Date | string): string =>
  new Date(value).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
