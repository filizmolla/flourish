import {
  CookingTimer,
  detectDurationMinutes,
  formatRemaining,
  isFinished,
  isPaused,
  nextManualTimer,
  pauseTimer,
  remainingMs,
  removeTimer,
  restartTimer,
  resumeTimer,
  sortBySoonest,
  startTimer,
  stepTimerId,
} from './cookingTimers';

const MINUTE = 60_000;
const NOW = Date.UTC(2026, 8, 21, 12, 0, 0);

function running(id: string, msLeft: number, stepIndex?: number) {
  return { id, stepIndex, label: id, endsAt: NOW + msLeft } as CookingTimer;
}

function paused(id: string, msLeft: number) {
  return { id, label: id, pausedRemainingMs: msLeft } as CookingTimer;
}

const ids = (timers: CookingTimer[]) => timers.map(timer => timer.id);

describe('detectDurationMinutes', () => {
  it.each([
    ['simmer for 10 minutes', 10],
    ['Bake 20 min', 20],
    ['Rest 1 minute', 1],
    ['Cook 5 mins', 5],
    ['Braise 1 hour 30 minutes', 90],
    ['Roast 1½ hours', 90],
    ['Roast 1 ½ hours', 90],
    ['Slow cook 1.5 hrs', 90],
    ['Slow cook 1,5 hrs', 90],
    ['Bake 2 hr', 120],
    ['Braise 2 hours and 15 mins', 135],
    ['Bake 10-12 min', 10],
    ['Bake 10–12 min', 10],
    ['Steam 5 to 7 minutes', 5],
    ['SIMMER FOR 10 MINUTES', 10],
    ['Bake 20 Min', 20],
  ])('reads "%s" as %i minutes', (text, minutes) => {
    expect(detectDurationMinutes(text)).toBe(minutes);
  });

  it('uses the first duration when a step mentions two', () => {
    expect(detectDurationMinutes('Bake 20 min, then rest 5 minutes')).toBe(20);
    expect(detectDurationMinutes('Rest 5 minutes, then bake 1 hour')).toBe(5);
  });

  it('does not add minutes that come later in the step after minutes', () => {
    // Only an hour amount picks up a following "N minutes".
    expect(detectDurationMinutes('Boil 10 minutes and 5 minutes more')).toBe(
      10,
    );
  });

  it.each([
    ['seconds', 'Blend for 30 seconds'],
    ['a word starting with "min"', 'Add 2 mint leaves'],
    ['no number', 'Simmer for a few minutes'],
    ['no text', ''],
    ['a number without a unit', 'Add 3 eggs'],
    ['zero minutes', 'Rest 0 minutes'],
  ])('returns null for %s', (_label, text) => {
    expect(detectDurationMinutes(text)).toBeNull();
  });
});

describe('stepTimerId', () => {
  it('names a step timer by its line index', () => {
    expect(stepTimerId(0)).toBe('step-0');
    expect(stepTimerId(12)).toBe('step-12');
  });
});

describe('nextManualTimer', () => {
  it('starts at 1 with no timers', () => {
    expect(nextManualTimer([])).toEqual({ id: 'manual-1', number: 1 });
  });

  it('ignores step timers when numbering', () => {
    expect(
      nextManualTimer([running('step-0', MINUTE, 0), running('step-3', 1, 3)]),
    ).toEqual({ id: 'manual-1', number: 1 });
  });

  it('continues after the highest manual number, even across gaps', () => {
    expect(
      nextManualTimer([
        running('manual-1', MINUTE),
        running('step-2', MINUTE, 2),
        running('manual-2', MINUTE),
      ]),
    ).toEqual({ id: 'manual-3', number: 3 });
    // Timer 1 was removed; the next one is still Timer 4, not Timer 1.
    expect(
      nextManualTimer([running('manual-3', MINUTE), paused('manual-2', 1)]),
    ).toEqual({ id: 'manual-4', number: 4 });
  });
});

describe('remainingMs', () => {
  it('counts down from endsAt to the given now', () => {
    const timer = running('step-0', 10 * MINUTE);
    expect(remainingMs(timer, NOW)).toBe(10 * MINUTE);
    expect(remainingMs(timer, NOW + 4 * MINUTE + 500)).toBe(6 * MINUTE - 500);
  });

  it('never goes below zero', () => {
    const timer = running('step-0', MINUTE);
    expect(remainingMs(timer, NOW + MINUTE)).toBe(0);
    expect(remainingMs(timer, NOW + 5 * MINUTE)).toBe(0);
  });

  it('returns the stored remaining time of a paused timer, whatever now is', () => {
    const timer = paused('manual-1', 90_000);
    expect(remainingMs(timer, NOW)).toBe(90_000);
    expect(remainingMs(timer, NOW + 60 * MINUTE)).toBe(90_000);
  });
});

describe('isFinished', () => {
  it('is false while time is left and true once it runs out', () => {
    const timer = running('step-0', MINUTE);
    expect(isFinished(timer, NOW + MINUTE - 1)).toBe(false);
    expect(isFinished(timer, NOW + MINUTE)).toBe(true);
    expect(isFinished(timer, NOW + 2 * MINUTE)).toBe(true);
  });

  it('never finishes while paused, even with nothing left', () => {
    expect(isFinished(paused('manual-1', 0), NOW)).toBe(false);
    expect(isFinished(paused('manual-1', 5000), NOW + MINUTE)).toBe(false);
  });
});

describe('several timers together', () => {
  const stepTimer = { id: 'step-1', stepIndex: 1, label: 'Step 2' };
  const manualTimer = { id: 'manual-1', label: 'Timer 1' };

  function twoRunning() {
    const one = startTimer([], stepTimer, 10, NOW);
    return startTimer(one, manualTimer, 5, NOW);
  }

  it('starts each timer with endsAt = now + minutes', () => {
    const timers = twoRunning();
    expect(timers).toEqual([
      { ...stepTimer, endsAt: NOW + 10 * MINUTE },
      { ...manualTimer, endsAt: NOW + 5 * MINUTE },
    ]);
    expect(timers.some(isPaused)).toBe(false);
  });

  it('returns the list unchanged when a timer with that id already runs', () => {
    const timers = twoRunning();
    const again = startTimer(timers, stepTimer, 3, NOW + MINUTE);
    expect(again).toBe(timers);
    expect(ids(again)).toEqual(['step-1', 'manual-1']);
    expect(remainingMs(again[0], NOW)).toBe(10 * MINUTE);
  });

  it('pauses one timer without changing the other', () => {
    const at = NOW + 2 * MINUTE;
    const timers = pauseTimer(twoRunning(), 'step-1', at);

    const [step, manual] = timers;
    expect(isPaused(step)).toBe(true);
    expect(step).toEqual({ ...stepTimer, pausedRemainingMs: 8 * MINUTE });
    expect(step).not.toHaveProperty('endsAt');
    expect(isPaused(manual)).toBe(false);
    expect(manual).toEqual({ ...manualTimer, endsAt: NOW + 5 * MINUTE });

    // Later on, only the running one has moved.
    const later = at + 2 * MINUTE;
    expect(remainingMs(step, later)).toBe(8 * MINUTE);
    expect(remainingMs(manual, later)).toBe(MINUTE);
  });

  it('pausing an already paused timer keeps its remaining time', () => {
    const once = pauseTimer(twoRunning(), 'step-1', NOW + MINUTE);
    const twice = pauseTimer(once, 'step-1', NOW + 5 * MINUTE);
    expect(remainingMs(twice[0], NOW + 9 * MINUTE)).toBe(9 * MINUTE);
  });

  it('resumes from the paused remaining time: endsAt = now + paused', () => {
    const pausedAt = NOW + 2 * MINUTE;
    const resumedAt = NOW + 30 * MINUTE;
    const timers = resumeTimer(
      pauseTimer(twoRunning(), 'step-1', pausedAt),
      'step-1',
      resumedAt,
    );

    expect(timers[0]).toEqual({ ...stepTimer, endsAt: resumedAt + 8 * MINUTE });
    expect(timers[0]).not.toHaveProperty('pausedRemainingMs');
    expect(isPaused(timers[0])).toBe(false);
    expect(timers[1]).toEqual({ ...manualTimer, endsAt: NOW + 5 * MINUTE });
  });

  it('resuming a running timer changes nothing', () => {
    const timers = twoRunning();
    expect(resumeTimer(timers, 'manual-1', NOW + MINUTE)).toEqual(timers);
  });

  it('restarts a finished timer with endsAt = now + minutes, keeping its id and step', () => {
    const finishedAt = NOW + 10 * MINUTE;
    const timers = twoRunning();
    expect(isFinished(timers[0], finishedAt)).toBe(true);

    const restarted = restartTimer(timers, 'step-1', 6, finishedAt);

    expect(restarted[0]).toEqual({
      ...stepTimer,
      endsAt: finishedAt + 6 * MINUTE,
    });
    expect(isFinished(restarted[0], finishedAt)).toBe(false);
    expect(remainingMs(restarted[0], finishedAt)).toBe(6 * MINUTE);
    // The other timer is the very same object.
    expect(restarted[1]).toBe(timers[1]);
    // The input list is not changed.
    expect(timers[0]).toEqual({ ...stepTimer, endsAt: NOW + 10 * MINUTE });
  });

  it('restarting a paused timer clears its pause', () => {
    const at = NOW + 2 * MINUTE;
    const timers = pauseTimer(twoRunning(), 'manual-1', at);

    const restarted = restartTimer(timers, 'manual-1', 1, at);

    expect(restarted[1]).toEqual({ ...manualTimer, endsAt: at + MINUTE });
    expect(restarted[1]).not.toHaveProperty('pausedRemainingMs');
    expect(isPaused(restarted[1])).toBe(false);
    expect(restarted[0]).toBe(timers[0]);
  });

  it('restarting an unknown id changes nothing', () => {
    const timers = twoRunning();
    expect(restartTimer(timers, 'missing', 5, NOW)).toEqual(timers);
  });

  it('removes only the given timer', () => {
    const timers = [
      ...twoRunning(),
      { id: 'step-4', stepIndex: 4, label: 'Step 5', pausedRemainingMs: 1 },
    ];
    expect(ids(removeTimer(timers, 'manual-1'))).toEqual(['step-1', 'step-4']);
    expect(ids(removeTimer(timers, 'missing'))).toEqual(ids(timers));
    expect(removeTimer(removeTimer(timers, 'step-1'), 'step-4')).toEqual([
      { ...manualTimer, endsAt: NOW + 5 * MINUTE },
    ]);
  });

  it('sorts soonest first, placing paused timers by the time they have left', () => {
    const timers = [
      running('step-0', 10 * MINUTE, 0),
      paused('manual-1', 3 * MINUTE),
      running('step-2', 2 * MINUTE, 2),
      paused('manual-2', 20 * MINUTE),
      running('step-5', 7 * MINUTE, 5),
    ];

    expect(ids(sortBySoonest(timers, NOW))).toEqual([
      'step-2',
      'manual-1',
      'step-5',
      'step-0',
      'manual-2',
    ]);
    // Running timers catch up with a paused one as time passes.
    expect(ids(sortBySoonest(timers, NOW + 5 * MINUTE))).toEqual([
      'step-2',
      'step-5',
      'manual-1',
      'step-0',
      'manual-2',
    ]);
  });

  it('does not reorder the list it is given', () => {
    const timers = [running('a', 2 * MINUTE), running('b', MINUTE)];
    sortBySoonest(timers, NOW);
    expect(ids(timers)).toEqual(['a', 'b']);
  });
});

describe('formatRemaining', () => {
  it.each([
    [0, '00:00'],
    [1, '00:01'],
    [999, '00:01'],
    [1000, '00:01'],
    [1001, '00:02'],
    [59_000, '00:59'],
    [60_000, '01:00'],
    [9 * MINUTE, '09:00'],
    [4 * MINUTE + 12_000, '04:12'],
    [59 * MINUTE + 59_000, '59:59'],
    [59 * MINUTE + 59_001, '1:00:00'],
    [60 * MINUTE, '1:00:00'],
    [62 * MINUTE + 5000, '1:02:05'],
    [10 * 60 * MINUTE, '10:00:00'],
  ])('formats %i ms as "%s"', (ms, text) => {
    expect(formatRemaining(ms)).toBe(text);
  });
});
