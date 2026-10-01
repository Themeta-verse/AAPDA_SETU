/**
 * Time formatting for source-published forecast timestamps.
 *
 * WHY THIS EXISTS
 *
 * Open-Meteo is queried with `timezone=Asia/Kolkata`, so the `hourly.time`
 * strings it returns are Indian Standard Time wall-clock values with no offset
 * suffix. Two different renderings of those same strings existed in this
 * codebase:
 *
 *   - `TideForecast` sliced the string ("19:00")
 *   - `CoastalCommandCenter` did `new Date(point.isoTime).toLocaleTimeString()`
 *     with no `timeZone`, which re-rendered an already-correct IST value in the
 *     VIEWER's timezone.
 *
 * A user in UTC+0 therefore saw the 19:00 IST forecast hour labelled "13:30",
 * directly above a marine chart showing "19:00" for the same data.
 *
 * Every forecast timestamp is now rendered from the source-local string, which
 * is the value the authority actually published and is identical for every
 * viewer. `toLocaleDateString`/`toLocaleTimeString` are still used for the
 * human-friendly rendering, but pinned to Asia/Kolkata so the value cannot
 * drift with the browser's locale.
 */

import { SOURCE_TIMEZONE } from '@/integrations/adapters/openMeteoMarine';

/**
 * Split a source wall-clock string into its calendar parts.
 *
 * Returns null for anything that is not a `YYYY-MM-DDTHH:mm` source timestamp.
 * We slice rather than `new Date(...)` because parsing an offset-less string
 * would silently reinterpret it in the browser's timezone.
 */
function splitSourceTime(time: string): {
  date: string;
  hour: string;
  minute: string;
} | null {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(time);
  if (!match) return null;
  return { date: match[1], hour: match[2], minute: match[3] };
}

/** `14:00` — the source-local hour, exactly as published. */
export function formatForecastHourLabel(time: string): string {
  const parts = splitSourceTime(time);
  return parts ? `${parts.hour}:${parts.minute}` : time;
}

/**
 * `Wed 1 Oct, 14:00` — source-local, day and date included.
 *
 * Falls back to the raw string if it is not a recognisable source timestamp,
 * which keeps an unexpected value visible instead of rendering "Invalid Date".
 */
export function formatForecastTimestamp(time: string): string {
  const parts = splitSourceTime(time);
  if (!parts) return time;

  // Parsing the DATE only, with an explicit UTC noon, avoids any shift while
  // still letting Intl pick the correct weekday and month name.
  const date = new Date(`${parts.date}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return time;

  const label = date.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });

  return `${label}, ${parts.hour}:${parts.minute}`;
}

/** `1 Oct` — source-local date only, for chart axes. */
export function formatForecastDateLabel(time: string): string {
  const parts = splitSourceTime(time);
  if (!parts) return time;
  const date = new Date(`${parts.date}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return time;
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

/**
 * Format a real UTC instant (an ISO string ending in `Z`) for display.
 *
 * Used only for values that genuinely are absolute instants — our own fetch
 * timestamps, USGS event times — never for source-local forecast strings.
 */
export function formatInstantInSourceTimezone(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleString('en-GB', {
    timeZone: SOURCE_TIMEZONE,
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}