import {
  FoodGroup,
  IngredientSummary,
  Nutrient,
  RecipeLine,
} from '../api/recipesClient';
import {
  NUTRIENTS,
  NutrientState,
  coveredNutrients,
  firstMissing,
  ingredientStates,
  presentStates,
  recipeBalance,
  recipeStates,
  weekItems,
  weekState,
  weekStates,
} from './nutrientStates';

const { Protein, Fiber, HealthyFat, Carb } = FoodGroup;

function makeIngredient(
  overrides: Partial<IngredientSummary> = {},
): IngredientSummary {
  return {
    id: 'i-egg',
    name: 'Egg',
    mainGroup: Protein,
    nutrients: [Protein],
    ...overrides,
  };
}

function makeLine(
  ingredient: IngredientSummary | null,
  overrides: Partial<RecipeLine> = {},
): RecipeLine {
  return {
    position: 0,
    text: ingredient ? `1 ${ingredient.name}` : '# For the sauce',
    linkSetByOwner: false,
    ingredient,
    ...overrides,
  };
}

const egg = makeIngredient();
const lentils = makeIngredient({
  id: 'i-lentils',
  name: 'Lentils',
  mainGroup: Fiber,
  nutrients: [Fiber, Protein],
});
const avocado = makeIngredient({
  id: 'i-avocado',
  name: 'Avocado',
  mainGroup: HealthyFat,
  nutrients: [HealthyFat, Fiber],
});
const salt = makeIngredient({
  id: 'i-salt',
  name: 'Salt',
  mainGroup: null,
  nutrients: [],
});

describe('NUTRIENTS', () => {
  it('lists protein, fiber, healthy fat in dot order, without carb', () => {
    expect(NUTRIENTS).toEqual([Protein, Fiber, HealthyFat]);
  });
});

describe('ingredientStates', () => {
  it('marks the main group full and the other nutrients it has some', () => {
    expect(ingredientStates(Fiber, [Fiber, Protein])).toEqual({
      [Protein]: NutrientState.Some,
      [Fiber]: NutrientState.Full,
      [HealthyFat]: NutrientState.None,
    });
  });

  it('has nothing full when the main group is carb', () => {
    expect(ingredientStates(Carb, [Fiber])).toEqual({
      [Protein]: NutrientState.None,
      [Fiber]: NutrientState.Some,
      [HealthyFat]: NutrientState.None,
    });
  });

  it('is all none for a seasoning (no main group, no nutrients)', () => {
    expect(ingredientStates(null, [])).toEqual({
      [Protein]: NutrientState.None,
      [Fiber]: NutrientState.None,
      [HealthyFat]: NutrientState.None,
    });
  });
});

describe('coveredNutrients', () => {
  it('collects every nutrient of every linked line', () => {
    expect(coveredNutrients([makeLine(egg), makeLine(avocado)])).toEqual(
      new Set([Protein, HealthyFat, Fiber]),
    );
  });

  it('ignores headings and unlinked lines', () => {
    expect(
      coveredNutrients([
        makeLine(null),
        makeLine(null, { text: 'a pinch of love' }),
        makeLine(salt),
      ]),
    ).toEqual(new Set());
  });

  it('is empty for no lines', () => {
    expect(coveredNutrients([])).toEqual(new Set());
  });
});

describe('recipeStates', () => {
  it('makes any nutrient a linked line has full, even a secondary one', () => {
    // Lentils are mainly fiber, but their protein still counts as full.
    expect(recipeStates([makeLine(lentils), makeLine(null)])).toEqual({
      [Protein]: NutrientState.Full,
      [Fiber]: NutrientState.Full,
      [HealthyFat]: NutrientState.None,
    });
  });

  it('is all none without linked lines', () => {
    expect(recipeStates([makeLine(null)])).toEqual({
      [Protein]: NutrientState.None,
      [Fiber]: NutrientState.None,
      [HealthyFat]: NutrientState.None,
    });
  });
});

describe('presentStates', () => {
  it('makes each listed nutrient full and the rest none', () => {
    expect(presentStates([HealthyFat, Protein])).toEqual({
      [Protein]: NutrientState.Full,
      [Fiber]: NutrientState.None,
      [HealthyFat]: NutrientState.Full,
    });
  });

  it('is all none for no nutrients', () => {
    expect(presentStates([])).toEqual({
      [Protein]: NutrientState.None,
      [Fiber]: NutrientState.None,
      [HealthyFat]: NutrientState.None,
    });
  });

  it('is all full for all three, and ignores duplicates', () => {
    expect(presentStates([Fiber, Protein, HealthyFat, Fiber])).toEqual({
      [Protein]: NutrientState.Full,
      [Fiber]: NutrientState.Full,
      [HealthyFat]: NutrientState.Full,
    });
  });

  it('accepts any iterable, such as a Set', () => {
    expect(presentStates(new Set([Fiber]))).toEqual({
      [Protein]: NutrientState.None,
      [Fiber]: NutrientState.Full,
      [HealthyFat]: NutrientState.None,
    });
  });
});

describe('firstMissing', () => {
  it.each([
    [[], Protein],
    [[Fiber, HealthyFat], Protein],
    [[Protein], Fiber],
    [[Protein, HealthyFat], Fiber],
    [[Protein, Fiber], HealthyFat],
    [[HealthyFat, Fiber, Protein], null],
  ] as const)('%j → %s (dot order)', (nutrients, expected) => {
    expect(firstMissing(nutrients)).toBe(expected);
  });

  it('accepts a Set', () => {
    expect(firstMissing(new Set([Protein]))).toBe(Fiber);
  });
});

describe('weekState', () => {
  it.each([
    [0, 7, NutrientState.None],
    [1, 7, NutrientState.Some],
    [3, 7, NutrientState.Some],
    [4, 8, NutrientState.Full], // exactly half
    [4, 7, NutrientState.Full],
    [7, 7, NutrientState.Full],
    [1, 1, NutrientState.Full],
    [0, 0, NutrientState.None],
    [3, 0, NutrientState.None], // no meals: nothing to judge from
  ])('%i of %i meals → %s', (count, total, expected) => {
    expect(weekState(count, total)).toBe(expected);
  });
});

describe('recipeBalance', () => {
  it('is unknown with no lines', () => {
    expect(recipeBalance([])).toEqual({ kind: 'unknown' });
  });

  it('is unknown when only headings and unlinked lines exist', () => {
    expect(recipeBalance([makeLine(null), makeLine(null)])).toEqual({
      kind: 'unknown',
    });
  });

  it('asks for protein first when a linked seasoning covers nothing', () => {
    expect(recipeBalance([makeLine(salt)])).toEqual({
      kind: 'add',
      nutrient: Protein,
    });
  });

  it('asks for the first uncovered nutrient in dot order', () => {
    expect(recipeBalance([makeLine(egg)])).toEqual({
      kind: 'add',
      nutrient: Fiber,
    });
    expect(recipeBalance([makeLine(lentils)])).toEqual({
      kind: 'add',
      nutrient: HealthyFat,
    });
  });

  it('is balanced when all three are covered', () => {
    expect(
      recipeBalance([makeLine(egg), makeLine(null), makeLine(avocado)]),
    ).toEqual({ kind: 'balanced' });
  });
});

describe('weekStates', () => {
  const item = (nutrients: Nutrient[], judged = true) => ({
    nutrients,
    judged,
  });

  it('is none for every nutrient with no items', () => {
    expect(weekStates([])).toEqual({
      [Protein]: NutrientState.None,
      [Fiber]: NutrientState.None,
      [HealthyFat]: NutrientState.None,
    });
  });

  it('is none for every nutrient when nothing is judged', () => {
    expect(weekStates([item([], false), item([Protein], false)])).toEqual({
      [Protein]: NutrientState.None,
      [Fiber]: NutrientState.None,
      [HealthyFat]: NutrientState.None,
    });
  });

  it('shares each nutrient over the judged items (half or more is full)', () => {
    // Protein 3 of 4, fiber 1 of 4, healthy fat 2 of 4 (exactly half).
    expect(
      weekStates([
        item([Protein, HealthyFat]),
        item([Protein, Fiber]),
        item([Protein, HealthyFat]),
        item([]),
      ]),
    ).toEqual({
      [Protein]: NutrientState.Full,
      [Fiber]: NutrientState.Some,
      [HealthyFat]: NutrientState.Full,
    });
  });

  it('leaves unjudged items out of the count', () => {
    // Fiber 1 of 2 judged is full; counting the 2 unjudged would make it some.
    expect(
      weekStates([
        item([Protein, Fiber]),
        item([Protein]),
        item([], false),
        item([], false),
      ]),
    ).toEqual({
      [Protein]: NutrientState.Full,
      [Fiber]: NutrientState.Full,
      [HealthyFat]: NutrientState.None,
    });
  });

  it('ignores the nutrients of unjudged items', () => {
    expect(weekStates([item([]), item([Fiber], false)])[Fiber]).toBe(
      NutrientState.None,
    );
  });
});

describe('weekItems', () => {
  const meal = (nutrients: Nutrient[], text: string | null) => ({
    nutrients,
    text,
  });

  it('is empty for an empty week', () => {
    expect(weekItems({ meals: [], attempts: [] })).toEqual([]);
  });

  it('judges a meal by whether it has text, not by its nutrients', () => {
    expect(
      weekItems({
        meals: [
          meal([Protein], 'eggs'),
          meal([], 'coffee'),
          meal([], ''),
          meal([], null),
        ],
        attempts: [],
      }),
    ).toEqual([
      { nutrients: [Protein], judged: true },
      { nutrients: [], judged: true },
      { nutrients: [], judged: true },
      { nutrients: [], judged: false },
    ]);
  });

  it('judges an attempt only when its recipe brought nutrients', () => {
    expect(
      weekItems({
        meals: [],
        attempts: [{ nutrients: [Fiber, HealthyFat] }, { nutrients: [] }],
      }),
    ).toEqual([
      { nutrients: [Fiber, HealthyFat], judged: true },
      { nutrients: [], judged: false },
    ]);
  });

  it('lists meals first, then attempts', () => {
    expect(
      weekItems({
        meals: [meal([Fiber], 'salad')],
        attempts: [{ nutrients: [Protein] }],
      }).map(item => item.nutrients),
    ).toEqual([[Fiber], [Protein]]);
  });

  it('feeds weekStates so photo-only meals and unlinked attempts do not dilute the week', () => {
    // Fiber in 1 of 2 judged items is full; counting all 4 would make it some.
    expect(
      weekStates(
        weekItems({
          meals: [meal([Protein, Fiber], 'lentil soup'), meal([], null)],
          attempts: [{ nutrients: [Protein] }, { nutrients: [] }],
        }),
      ),
    ).toEqual({
      [Protein]: NutrientState.Full,
      [Fiber]: NutrientState.Full,
      [HealthyFat]: NutrientState.None,
    });
  });
});
