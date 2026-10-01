import { Recipe } from '../api/recipesClient';
import {
  formatDuration,
  formatPostedDate,
  formatRecentDay,
  formatShortDate,
  formatTimeAgo,
  recipeMetaItems,
} from './recipeFormat';

function makeRecipe(overrides: Partial<Recipe> = {}): Recipe {
  return {
    id: 'r1',
    title: 'Pancakes',
    ingredients: ['flour', 'eggs', 'milk'],
    instructions: 'Mix and cook.',
    story: null,
    imageUrl: null,
    source: null,
    prepMinutes: null,
    cookMinutes: null,
    servings: null,
    forkedFrom: null,
    lines: [],
    forks: [],
    createdAt: '2026-09-21T12:00:00.000Z',
    updatedAt: '2026-09-21T12:00:00.000Z',
    ...overrides,
  };
}

describe('formatDuration', () => {
  it.each([
    [5, '5 min'],
    [60, '1 hr'],
    [80, '1 hr 20 min'],
    [140, '2 hr 20 min'],
  ])('formats %i minutes as "%s"', (minutes, expected) => {
    expect(formatDuration(minutes)).toBe(expected);
  });
});

describe('formatPostedDate', () => {
  it('writes the month out in full', () => {
    // Midday UTC, so the local date is the same in any realistic timezone.
    expect(formatPostedDate('2026-09-21T12:00:00.000Z')).toBe(
      'September 21, 2026',
    );
  });
});

describe('formatShortDate', () => {
  // Midday UTC throughout, so the local date and year match in any realistic
  // timezone.
  const now = new Date('2026-09-24T12:00:00.000Z');

  it('leaves the year out for dates in the current year', () => {
    expect(formatShortDate('2026-09-21T12:00:00.000Z', now)).toBe('Sep 21');
  });

  it('adds the year for dates in another year', () => {
    expect(formatShortDate('2025-09-21T12:00:00.000Z', now)).toBe(
      'Sep 21, 2025',
    );
  });

  it('adds the year for dates in a later year too', () => {
    expect(formatShortDate('2027-01-02T12:00:00.000Z', now)).toBe(
      'Jan 2, 2027',
    );
  });

  it.each([
    ['01', 'Jan'],
    ['02', 'Feb'],
    ['03', 'Mar'],
    ['04', 'Apr'],
    ['05', 'May'],
    ['06', 'Jun'],
    ['07', 'Jul'],
    ['08', 'Aug'],
    ['09', 'Sep'],
    ['10', 'Oct'],
    ['11', 'Nov'],
    ['12', 'Dec'],
  ])('abbreviates month %s as "%s"', (month, short) => {
    expect(formatShortDate(`2026-${month}-15T12:00:00.000Z`, now)).toBe(
      `${short} 15`,
    );
  });

  it('uses the first and last day of the year without a leading zero', () => {
    expect(formatShortDate('2026-01-01T12:00:00.000Z', now)).toBe('Jan 1');
    expect(formatShortDate('2026-12-31T12:00:00.000Z', now)).toBe('Dec 31');
  });

  describe('without an explicit now', () => {
    beforeEach(() => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-09-24T12:00:00.000Z'));
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('compares against the current year', () => {
      expect(formatShortDate('2026-09-21T12:00:00.000Z')).toBe('Sep 21');
      expect(formatShortDate('2025-12-31T12:00:00.000Z')).toBe('Dec 31, 2025');
    });
  });
});

describe('formatTimeAgo', () => {
  const SECOND = 1000;
  const MINUTE = 60 * SECOND;
  const HOUR = 60 * MINUTE;
  const DAY = 24 * HOUR;

  it.each([
    [0, 'just now'],
    [-5 * MINUTE, 'just now'],
    [59 * SECOND, 'just now'],
    [MINUTE, '1 min ago'],
    [59 * MINUTE + 59 * SECOND, '59 min ago'],
    [HOUR, '1 h ago'],
    [23 * HOUR + 59 * MINUTE, '23 h ago'],
    [DAY, '1 day ago'],
    [3 * DAY + 5 * HOUR, '3 days ago'],
  ])('formats %i ms as "%s"', (ms, expected) => {
    expect(formatTimeAgo(ms)).toBe(expected);
  });
});

describe('recipeMetaItems', () => {
  it('combines prep and cook time, servings and ingredient count', () => {
    const recipe = makeRecipe({
      prepMinutes: 10,
      cookMinutes: 20,
      servings: 4,
    });
    expect(recipeMetaItems(recipe)).toEqual([
      '30 min',
      'Serves 4',
      '3 ingredients',
    ]);
  });

  it('counts time when only one of prep or cook is set', () => {
    expect(recipeMetaItems(makeRecipe({ cookMinutes: 90 }))[0]).toBe(
      '1 hr 30 min',
    );
  });

  it('leaves out time and servings when they are unknown', () => {
    expect(recipeMetaItems(makeRecipe())).toEqual(['3 ingredients']);
  });

  it('uses the singular for one ingredient', () => {
    expect(recipeMetaItems(makeRecipe({ ingredients: ['water'] }))).toEqual([
      '1 ingredient',
    ]);
  });

  it('does not count section headings as ingredients', () => {
    const recipe = makeRecipe({
      ingredients: [
        '# For the cake',
        '2 cups flour',
        '#10 can tomatoes',
        '## For the cream',
        '200 ml cream',
      ],
    });
    expect(recipeMetaItems(recipe)).toEqual(['3 ingredients']);
  });

  it('says 0 ingredients for a recipe of headings only', () => {
    expect(recipeMetaItems(makeRecipe({ ingredients: ['# A'] }))).toEqual([
      '0 ingredients',
    ]);
  });
});

describe('formatRecentDay', () => {
  // Built with the local-time constructor: the function counts calendar days
  // in local time, so these hold in any timezone. Month 8 = September.
  const local = (day: number, hours: number, minutes = 0) =>
    new Date(2026, 8, day, hours, minutes);
  const iso = (day: number, hours: number, minutes = 0) =>
    local(day, hours, minutes).toISOString();

  it.each([
    ['earlier the same day', iso(24, 0, 10), local(24, 23, 30)],
    ['the same moment', iso(24, 12), local(24, 12)],
  ])('says "Today" for %s', (_label, date, now) => {
    expect(formatRecentDay(date, now)).toBe('Today');
  });

  it.each([
    ['late the day before, only an hour ago', iso(23, 23, 30), local(24, 0, 30)],
    ['early the day before, almost 48 h ago', iso(23, 0, 10), local(24, 23, 50)],
  ])('says "Yesterday" for %s', (_label, date, now) => {
    expect(formatRecentDay(date, now)).toBe('Yesterday');
  });

  it('falls back to the short date two calendar days back, even under 48 h', () => {
    expect(formatRecentDay(iso(22, 23, 0), local(24, 1, 0))).toBe('Sep 22');
  });

  it('adds the year like formatShortDate for another year', () => {
    expect(
      formatRecentDay(
        new Date(2025, 11, 30, 12).toISOString(),
        new Date(2026, 0, 2, 12),
      ),
    ).toBe('Dec 30, 2025');
  });

  it('says "Yesterday" across a year boundary', () => {
    expect(
      formatRecentDay(
        new Date(2025, 11, 31, 22).toISOString(),
        new Date(2026, 0, 1, 1),
      ),
    ).toBe('Yesterday');
  });

  describe('without an explicit now', () => {
    beforeEach(() => {
      jest.useFakeTimers();
      jest.setSystemTime(local(24, 12));
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('compares against the current day', () => {
      expect(formatRecentDay(iso(24, 8))).toBe('Today');
      expect(formatRecentDay(iso(23, 8))).toBe('Yesterday');
      expect(formatRecentDay(iso(21, 12))).toBe('Sep 21');
    });
  });
});
