import { strings } from '../strings';

// Weeks run Monday to Monday in the phone's own time zone; the server only
// ever sees the two instants.

// Midnight on the Monday of `date`'s week, local time.
export function startOfWeek(date: Date): Date {
  const daysSinceMonday = (date.getDay() + 6) % 7;
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() - daysSinceMonday,
  );
}

// By calendar day, not 24 h, so a daylight-saving change can't shift it.
export function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

// The seven local midnights of the week starting at `monday`.
export function weekDays(monday: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

// "2026-09-28": a local calendar day, for testIDs and grouping.
export function dayKey(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}`;
}

// "Sep 28 – Oct 4" (the Sunday is the last day shown).
export function formatWeekRange(monday: Date): string {
  const sunday = addDays(monday, 6);
  const short = (d: Date) =>
    strings.format.shortDate(
      strings.format.shortMonths[d.getMonth()],
      d.getDate(),
    );
  return `${short(monday)} – ${short(sunday)}`;
}
