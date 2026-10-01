import {
  addDays,
  dayKey,
  formatWeekRange,
  startOfWeek,
  weekDays,
} from './week';

// All dates are built from local parts, so these hold in any time zone.
const local = (y: number, m: number, d: number, h = 0, min = 0) =>
  new Date(y, m - 1, d, h, min);

describe('startOfWeek', () => {
  it.each([
    ['Wednesday afternoon', local(2026, 9, 30, 15, 20), local(2026, 9, 28)],
    ['Monday at midnight', local(2026, 9, 28, 0, 0), local(2026, 9, 28)],
    ['Monday late evening', local(2026, 9, 28, 23, 59), local(2026, 9, 28)],
    ['Sunday late evening', local(2026, 10, 4, 23, 59), local(2026, 9, 28)],
    ['the next Monday', local(2026, 10, 5, 0, 0), local(2026, 10, 5)],
    ['a Thursday across a month', local(2026, 10, 1, 9), local(2026, 9, 28)],
    ['a Friday across a year', local(2027, 1, 1, 9), local(2026, 12, 28)],
  ])('%s → local Monday midnight', (_, date, expected) => {
    expect(startOfWeek(date)).toEqual(expected);
  });

  it('puts Sunday in the week of the Monday before it, not after', () => {
    const sunday = local(2026, 10, 4, 12);
    expect(sunday.getDay()).toBe(0);
    expect(startOfWeek(sunday)).toEqual(local(2026, 9, 28));
  });

  it('does not change the date passed in', () => {
    const date = local(2026, 9, 30, 15);
    startOfWeek(date);
    expect(date).toEqual(local(2026, 9, 30, 15));
  });
});

describe('addDays', () => {
  it.each([
    [local(2026, 9, 28), 7, local(2026, 10, 5)],
    [local(2026, 9, 28), -7, local(2026, 9, 21)],
    [local(2026, 9, 28), 0, local(2026, 9, 28)],
    [local(2026, 12, 28), 7, local(2027, 1, 4)],
    [local(2027, 1, 4), -7, local(2026, 12, 28)],
    [local(2028, 2, 28), 1, local(2028, 2, 29)], // leap year
  ])('%s + %i days → %s', (date, days, expected) => {
    expect(addDays(date, days)).toEqual(expected);
  });

  it('returns local midnight, dropping the time of day', () => {
    expect(addDays(local(2026, 9, 30, 15, 20), 1)).toEqual(local(2026, 10, 1));
  });

  // Where the machine's zone has daylight saving, adding 24 h would land on
  // 23:00 or 01:00 once a year; calendar days never do.
  it('lands on midnight of the next calendar day for every day of a year', () => {
    let day = local(2026, 1, 1);
    for (let i = 0; i < 366; i++) {
      const next = addDays(day, 1);
      expect(next.getHours()).toBe(0);
      expect(dayKey(next)).not.toBe(dayKey(day));
      expect(dayKey(addDays(next, -1))).toBe(dayKey(day));
      day = next;
    }
    expect(dayKey(day)).toBe('2027-01-02');
  });
});

describe('weekDays', () => {
  it('lists the seven local midnights from Monday to Sunday', () => {
    const days = weekDays(local(2026, 9, 28));

    expect(days.map(dayKey)).toEqual([
      '2026-09-28',
      '2026-09-29',
      '2026-09-30',
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
      '2026-10-04',
    ]);
    expect(days.map(d => d.getDay())).toEqual([1, 2, 3, 4, 5, 6, 0]);
    expect(days.every(d => d.getHours() === 0)).toBe(true);
  });
});

describe('dayKey', () => {
  it.each([
    [local(2026, 9, 28), '2026-09-28'],
    [local(2026, 1, 5, 23, 59), '2026-01-05'], // local day, late evening
    [local(2026, 12, 31, 0, 1), '2026-12-31'],
    [local(2026, 10, 10), '2026-10-10'],
  ])('%s → %s', (date, expected) => {
    expect(dayKey(date)).toBe(expected);
  });
});

describe('formatWeekRange', () => {
  it.each([
    ['across a month', local(2026, 9, 28), 'Sep 28 – Oct 4'],
    ['within a month', local(2026, 10, 5), 'Oct 5 – Oct 11'],
    ['across a year', local(2026, 12, 28), 'Dec 28 – Jan 3'],
    ['across a leap day', local(2028, 2, 28), 'Feb 28 – Mar 5'],
  ])('%s: %s → %s', (_, monday, expected) => {
    expect(formatWeekRange(monday)).toBe(expected);
  });
});
