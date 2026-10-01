import {
  elapsedMs,
  formatElapsed,
  isClockRunning,
  pauseClock,
  resumeClock,
  startClock,
} from './cookingClock';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const NOW = Date.UTC(2026, 8, 21, 12, 0, 0);

describe('cooking clock', () => {
  it('starts running at zero', () => {
    const clock = startClock(NOW);

    expect(isClockRunning(clock)).toBe(true);
    expect(elapsedMs(clock, NOW)).toBe(0);
  });

  it('grows with the current time while running', () => {
    const clock = startClock(NOW);

    expect(elapsedMs(clock, NOW + 1)).toBe(1);
    expect(elapsedMs(clock, NOW + 5 * MINUTE)).toBe(5 * MINUTE);
  });

  it('banks the time on pause and stops counting', () => {
    const paused = pauseClock(startClock(NOW), NOW + 3 * MINUTE);

    expect(isClockRunning(paused)).toBe(false);
    expect(elapsedMs(paused, NOW + 3 * MINUTE)).toBe(3 * MINUTE);
    expect(elapsedMs(paused, NOW + 60 * MINUTE)).toBe(3 * MINUTE);
  });

  it('resumes from the banked time without counting the time away', () => {
    const paused = pauseClock(startClock(NOW), NOW + 3 * MINUTE);
    // 10 minutes away, then back.
    const resumed = resumeClock(paused, NOW + 13 * MINUTE);

    expect(isClockRunning(resumed)).toBe(true);
    expect(elapsedMs(resumed, NOW + 13 * MINUTE)).toBe(3 * MINUTE);
    expect(elapsedMs(resumed, NOW + 15 * MINUTE)).toBe(5 * MINUTE);

    // A second break is also left out.
    const pausedAgain = pauseClock(resumed, NOW + 15 * MINUTE);
    const resumedAgain = resumeClock(pausedAgain, NOW + 40 * MINUTE);
    expect(elapsedMs(resumedAgain, NOW + 41 * MINUTE)).toBe(6 * MINUTE);
  });

  it('ignores a pause while already paused', () => {
    const paused = pauseClock(startClock(NOW), NOW + MINUTE);
    const pausedTwice = pauseClock(paused, NOW + 10 * MINUTE);

    expect(pausedTwice).toBe(paused);
    expect(elapsedMs(pausedTwice, NOW + 20 * MINUTE)).toBe(MINUTE);
  });

  it('ignores a resume while already running', () => {
    const clock = startClock(NOW);
    const resumed = resumeClock(clock, NOW + 10 * MINUTE);

    expect(resumed).toBe(clock);
    // Still counting from the original start, not restarted.
    expect(elapsedMs(resumed, NOW + 10 * MINUTE)).toBe(10 * MINUTE);
  });

  it('never goes negative when now is before activeSince', () => {
    expect(elapsedMs(startClock(NOW), NOW - MINUTE)).toBe(0);

    const resumed = resumeClock(
      pauseClock(startClock(NOW), NOW + 2 * MINUTE),
      NOW + 5 * MINUTE,
    );
    // Only the banked time; the running part is clamped at zero.
    expect(elapsedMs(resumed, NOW + 4 * MINUTE)).toBe(2 * MINUTE);
    // Pausing with a clock that went backwards doesn't lose banked time.
    expect(elapsedMs(pauseClock(resumed, NOW), NOW)).toBe(2 * MINUTE);
  });
});

describe('formatElapsed', () => {
  it.each([
    [0, '00:00'],
    [999, '00:00'],
    [59 * SECOND + 999, '00:59'],
    [MINUTE, '01:00'],
    [23 * MINUTE + 41 * SECOND, '23:41'],
    [60 * MINUTE - 1, '59:59'],
    [60 * MINUTE, '1:00:00'],
    [62 * MINUTE + 5 * SECOND, '1:02:05'],
    [62 * MINUTE + 5 * SECOND + 999, '1:02:05'],
  ])('formats %i ms as "%s", rounding down', (ms, text) => {
    expect(formatElapsed(ms)).toBe(text);
  });
});
