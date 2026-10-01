// Several countdown timers can run at once while cooking. Each is stored by
// its end time rather than a ticking counter, so it stays right after the
// screen locks or the app is closed: remaining = endsAt - now.
export type CookingTimer = {
  id: string; // "step-2" | "manual-1"
  stepIndex?: number; // index into the step lines; absent for manual timers
  label: string; // shown for manual timers ("Timer 1")
  endsAt?: number; // epoch ms, set while running
  pausedRemainingMs?: number; // set while paused
};

const MINUTE_MS = 60_000;

const NUMBER = String.raw`(\d+(?:[.,]\d+)?)\s*(½)?`;
const RANGE = String.raw`(?:\s*(?:-|–|to)\s*\d+(?:[.,]\d+)?)?`;
const UNIT = String.raw`(hours?|hrs?|minutes?|mins?)\b`;
const DURATION = new RegExp(`${NUMBER}${RANGE}\\s*${UNIT}`, 'i');
const TRAILING_MINUTES = new RegExp(
  String.raw`^\s*(?:and\s+)?(\d+)\s*(?:minutes?|mins?)\b`,
  'i',
);

// First duration mentioned in a step, in whole minutes: "simmer for 10
// minutes" → 10, "1 hour 30 min" → 90, "1½ hours" → 90. A range uses its
// lower end ("10-12 min" → 10), so the timer rings in time to check.
export function detectDurationMinutes(text: string): number | null {
  const match = DURATION.exec(text);
  if (!match) return null;
  let amount = Number(match[1].replace(',', '.'));
  if (match[2]) amount += 0.5;
  const isHours = match[3].toLowerCase().startsWith('h');
  let minutes = isHours ? amount * 60 : amount;
  if (isHours) {
    const rest = text.slice(match.index + match[0].length);
    const extra = TRAILING_MINUTES.exec(rest);
    if (extra) minutes += Number(extra[1]);
  }
  minutes = Math.round(minutes);
  return minutes > 0 ? minutes : null;
}

export function stepTimerId(stepIndex: number): string {
  return `step-${stepIndex}`;
}

export function nextManualTimer(timers: CookingTimer[]): {
  id: string;
  number: number;
} {
  const used = timers
    .map(timer => /^manual-(\d+)$/.exec(timer.id))
    .map(match => (match ? Number(match[1]) : 0));
  const number = Math.max(0, ...used) + 1;
  return { id: `manual-${number}`, number };
}

export function isPaused(timer: CookingTimer): boolean {
  return timer.pausedRemainingMs !== undefined;
}

export function remainingMs(timer: CookingTimer, now: number): number {
  if (timer.pausedRemainingMs !== undefined) return timer.pausedRemainingMs;
  return Math.max(0, (timer.endsAt ?? now) - now);
}

export function isFinished(timer: CookingTimer, now: number): boolean {
  return !isPaused(timer) && remainingMs(timer, now) === 0;
}

// A timer with the same id keeps running: tapping a step's chip twice
// doesn't start a second timer for it.
export function startTimer(
  timers: CookingTimer[],
  timer: Omit<CookingTimer, 'endsAt' | 'pausedRemainingMs'>,
  minutes: number,
  now: number,
): CookingTimer[] {
  if (timers.some(t => t.id === timer.id)) return timers;
  return [...timers, { ...timer, endsAt: now + minutes * MINUTE_MS }];
}

export function pauseTimer(
  timers: CookingTimer[],
  id: string,
  now: number,
): CookingTimer[] {
  return timers.map(timer =>
    timer.id === id && !isPaused(timer)
      ? {
          id: timer.id,
          stepIndex: timer.stepIndex,
          label: timer.label,
          pausedRemainingMs: remainingMs(timer, now),
        }
      : timer,
  );
}

export function resumeTimer(
  timers: CookingTimer[],
  id: string,
  now: number,
): CookingTimer[] {
  return timers.map(timer =>
    timer.id === id && timer.pausedRemainingMs !== undefined
      ? {
          id: timer.id,
          stepIndex: timer.stepIndex,
          label: timer.label,
          endsAt: now + timer.pausedRemainingMs,
        }
      : timer,
  );
}

// "Add time" on a finished (or any) timer: it runs again for `minutes`
// from now, keeping its id and step.
export function restartTimer(
  timers: CookingTimer[],
  id: string,
  minutes: number,
  now: number,
): CookingTimer[] {
  return timers.map(timer =>
    timer.id === id
      ? {
          id: timer.id,
          stepIndex: timer.stepIndex,
          label: timer.label,
          endsAt: now + minutes * MINUTE_MS,
        }
      : timer,
  );
}

export function removeTimer(
  timers: CookingTimer[],
  id: string,
): CookingTimer[] {
  return timers.filter(timer => timer.id !== id);
}

// Soonest to finish first; paused timers sort by the time they have left.
export function sortBySoonest(
  timers: CookingTimer[],
  now: number,
): CookingTimer[] {
  return [...timers].sort((a, b) => remainingMs(a, now) - remainingMs(b, now));
}

// Counts down in whole seconds, rounding up, so "00:00" only shows at the
// end: "04:12", "1:02:05".
export function formatRemaining(ms: number): string {
  const totalSeconds = Math.ceil(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${pad(minutes)}:${pad(seconds)}`;
}
