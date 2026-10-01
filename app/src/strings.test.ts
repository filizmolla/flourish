import { strings } from './strings';

describe('strings.balance.hasLabel', () => {
  const { hasLabel } = strings.balance;

  it.each([
    [
      ['Protein', 'Fiber'],
      ['Healthy fat'],
      'Has protein and fiber, no healthy fat yet',
    ],
    [
      ['Protein', 'Fiber', 'Healthy fat'],
      [],
      'Has protein, fiber and healthy fat',
    ],
    [
      [],
      ['Protein', 'Fiber', 'Healthy fat'],
      'No protein, fiber or healthy fat yet',
    ],
    [
      ['Protein'],
      ['Fiber', 'Healthy fat'],
      'Has protein, no fiber or healthy fat yet',
    ],
    [['Healthy fat'], [], 'Has healthy fat'],
    [[], ['Fiber'], 'No fiber yet'],
    [
      ['Fiber', 'Healthy fat'],
      ['Protein'],
      'Has fiber and healthy fat, no protein yet',
    ],
  ])('%j / %j → "%s"', (has, not, expected) => {
    expect(hasLabel(has, not)).toBe(expected);
  });
});

describe('strings.addMeal.inThis', () => {
  const { inThis } = strings.addMeal;

  it.each([
    [
      ['Protein', 'Fiber', 'Healthy fat'],
      'Protein, fiber and healthy fat in this.',
    ],
    [['Protein', 'Fiber'], 'Protein and fiber in this.'],
    [['Fiber', 'Healthy fat'], 'Fiber and healthy fat in this.'],
    [['Protein'], 'Protein in this.'],
    [['Healthy fat'], 'Healthy fat in this.'],
    [[], 'No protein, fiber or healthy fat found.'],
  ])('%j → "%s"', (has, expected) => {
    expect(inThis(has)).toBe(expected);
  });

  it("doesn't change the list it's given", () => {
    const has = ['Protein', 'Fiber'];
    inThis(has);
    expect(has).toEqual(['Protein', 'Fiber']);
  });
});

describe('strings.week.summary', () => {
  const { summary } = strings.week;
  const P = 'Protein';
  const F = 'Fiber';
  const H = 'Healthy fat';

  it.each([
    [
      [P],
      [F],
      [H],
      'Protein showed up often. Fiber a few times. No healthy fat yet.',
    ],
    [[P, F], [], [H], 'Protein and fiber showed up often. No healthy fat yet.'],
    [[P, F, H], [], [], 'Protein, fiber and healthy fat showed up often.'],
    [[], [P, F, H], [], 'Protein, fiber and healthy fat a few times.'],
    [[], [], [P, F, H], 'No protein, fiber or healthy fat yet.'],
    [[], [F], [P, H], 'Fiber a few times. No protein or healthy fat yet.'],
    [
      [H],
      [P, F],
      [],
      'Healthy fat showed up often. Protein and fiber a few times.',
    ],
  ])('often %j, some %j, not yet %j → %s', (often, some, notYet, expected) => {
    expect(summary(often, some, notYet)).toBe(expected);
  });

  it('does not change the lists passed in', () => {
    const often = [P, F];
    summary(often, [], []);
    expect(often).toEqual([P, F]);
  });
});

describe('strings.week.dotsLabel', () => {
  const { dotsLabel } = strings.week;

  it.each([
    [
      ['Protein'],
      ['Fiber'],
      ['Healthy fat'],
      'Protein in most meals, fiber in some, healthy fat not yet',
    ],
    [
      [],
      [],
      ['Protein', 'Fiber', 'Healthy fat'],
      'Protein not yet, fiber not yet, healthy fat not yet',
    ],
    [
      [],
      ['Healthy fat'],
      ['Protein', 'Fiber'],
      'Healthy fat in some, protein not yet, fiber not yet',
    ],
  ])('often %j, some %j, not yet %j → %s', (often, some, notYet, expected) => {
    expect(dotsLabel(often, some, notYet)).toBe(expected);
  });
});

describe('strings.week.tileLabel', () => {
  it('joins the parts, skipping missing ones', () => {
    expect(
      strings.week.tileLabel(['Meal', 'Wednesday', null, 'Satisfied']),
    ).toBe('Meal, Wednesday, Satisfied');
    expect(strings.week.tileLabel(['Snack', 'Monday', null, null])).toBe(
      'Snack, Monday',
    );
  });
});

describe('strings.makeToday', () => {
  const { addsMissing, addsLow, empty, times } = strings.makeToday;

  it.each([
    ['Healthy fat', 'Your week has no healthy fat yet. This adds it.'],
    ['Protein', 'Your week has no protein yet. This adds it.'],
    ['Fiber', 'Your week has no fiber yet. This adds it.'],
  ])('addsMissing(%s) → "%s"', (nutrient, expected) => {
    expect(addsMissing(nutrient)).toBe(expected);
  });

  it.each([
    ['Healthy fat', 'Your week is low on healthy fat. This adds some.'],
    ['Protein', 'Your week is low on protein. This adds some.'],
    ['Fiber', 'Your week is low on fiber. This adds some.'],
  ])('addsLow(%s) → "%s"', (nutrient, expected) => {
    expect(addsLow(nutrient)).toBe(expected);
  });

  it('labels the three time choices', () => {
    expect(times).toEqual({ 15: '15 min', 30: '30 min', 60: '1 h+' });
  });

  it.each([
    [times[15], 'No recipes fit in 15 min yet.'],
    [times[30], 'No recipes fit in 30 min yet.'],
  ])('empty(%s) → "%s"', (time, expected) => {
    expect(empty(time)).toBe(expected);
  });
});
