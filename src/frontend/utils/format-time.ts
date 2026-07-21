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
 * The match's time control as a chip: starting bank plus per-turn gain, e.g. `15m +2m/turn`.
 *
 * `null` when the match is untimed — every match created before the clock existed, and any custom
 * game that opted out. Callers drop the chip entirely rather than advertising a clock that isn't
 * there. A zero increment is a real setting (a plain, non-replenishing bank), so it's spelled out
 * rather than hidden.
 */
export const formatTimeControl = (
  bankSeconds: number | null | undefined,
  incrementSeconds: number | null | undefined,
): string | null => {
  if (bankSeconds === null || bankSeconds === undefined) {
    return null;
  }

  const bank = `${Math.round(bankSeconds / 60)}m`;

  // Explicitly: no increment at all, or an increment of zero, both mean a flat bank.
  return incrementSeconds === null || incrementSeconds === undefined || incrementSeconds === 0
    ? `${bank} flat`
    : `${bank} +${Math.round(incrementSeconds / 60)}m/turn`;
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

/**
 * A COUNTDOWN duration as m:ss, or h:mm:ss once it runs past an hour (the Long preset starts at 30m
 * but grows with the increment).
 *
 * Distinct from the other two duration/time helpers here, and deliberately so:
 * - `formatDuration` is the COARSE match length a player skims in a list ("15m", "2h 3m", "3d").
 * - `formatClockTime` renders a point in time in the viewer's timezone.
 * - this one is a PRECISE live countdown, ticking to the second, for the turn clock.
 *
 * It formats a span rather than an instant, so it is timezone-independent and needs no TZ pinning.
 *
 * `Math.ceil` so a clock reads "1:00" for the whole of its final minute and only shows 0:00 when the
 * time is genuinely gone — a countdown that displays 0:00 with a second still on it looks broken.
 */
export const formatCountdown = (ms: number): string => {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  const mm = hours > 0 ? String(minutes).padStart(2, "0") : String(minutes);

  return `${hours > 0 ? `${hours}:` : ""}${mm}:${String(seconds).padStart(2, "0")}`;
};
