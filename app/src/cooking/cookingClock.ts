// Active cooking time. It counts up while cooking mode is open and stops
// while you're away, so breaks don't count: time banked from earlier
// sessions (elapsedMs) plus the current one, if running (since activeSince).
export type CookingClock = {
  elapsedMs: number;
  activeSince?: number; // epoch ms; absent while paused
};

export function startClock(now: number): CookingClock {
  return { elapsedMs: 0, activeSince: now };
}

export function isClockRunning(clock: CookingClock): boolean {
  return clock.activeSince !== undefined;
}

export function elapsedMs(clock: CookingClock, now: number): number {
  const running =
    clock.activeSince === undefined ? 0 : Math.max(0, now - clock.activeSince);
  return clock.elapsedMs + running;
}

export function pauseClock(clock: CookingClock, now: number): CookingClock {
  if (clock.activeSince === undefined) return clock;
  return { elapsedMs: elapsedMs(clock, now) };
}

export function resumeClock(clock: CookingClock, now: number): CookingClock {
  if (clock.activeSince !== undefined) return clock;
  return { elapsedMs: clock.elapsedMs, activeSince: now };
}

// Counts up in whole seconds: "00:00", "23:41", "1:02:05".
export function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${pad(minutes)}:${pad(seconds)}`;
}
