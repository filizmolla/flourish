import {
  FoodGroup,
  IngredientSummary,
  Nutrient,
  Recipe,
  RecipeLine,
} from '../api/recipesClient';
import { NO_LIMIT, suggestRecipes, TIME_CHOICES } from './makeToday';
import { NutrientState, NutrientStates } from './nutrientStates';

const { Protein, Fiber, HealthyFat } = FoodGroup;
const { None, Some, Full } = NutrientState;

function ingredient(
  name: string,
  nutrients: Nutrient[],
  mainGroup: FoodGroup | null = nutrients[0] ?? null,
): IngredientSummary {
  return { id: `i-${name}`, name, mainGroup, nutrients };
}

const egg = ingredient('egg', [Protein]);
const lentils = ingredient('lentils', [Fiber, Protein]);
const oliveOil = ingredient('olive-oil', [HealthyFat]);
const rice = ingredient('rice', [], FoodGroup.Carb);

function line(
  ing: IngredientSummary | null,
  text = ing ? `1 ${ing.name}` : 'a pinch of salt',
): RecipeLine {
  return { position: 0, text, linkSetByOwner: false, ingredient: ing };
}

function makeRecipe(overrides: Partial<Recipe> = {}): Recipe {
  return {
    id: 'r1',
    title: 'Recipe',
    ingredients: [],
    lines: [],
    instructions: '',
    story: null,
    imageUrl: null,
    source: null,
    prepMinutes: 10,
    cookMinutes: 10,
    servings: null,
    forkedFrom: null,
    forks: [],
    createdAt: '2026-09-21T12:00:00.000Z',
    updatedAt: '2026-09-21T12:00:00.000Z',
    ...overrides,
  };
}

const states = (
  protein: NutrientState,
  fiber: NutrientState,
  healthyFat: NutrientState,
): NutrientStates => ({
  [Protein]: protein,
  [Fiber]: fiber,
  [HealthyFat]: healthyFat,
});

const ids = (recipes: Recipe[], ...args: [15 | 30 | 60, NutrientStates | null]) =>
  suggestRecipes(recipes, ...args).map(s => s.recipe.id);

describe('TIME_CHOICES and NO_LIMIT', () => {
  it('offers 15, 30 and 60 minutes, 60 meaning no limit', () => {
    expect(TIME_CHOICES).toEqual([15, 30, 60]);
    expect(NO_LIMIT).toBe(60);
  });
});

describe('suggestRecipes minutes', () => {
  it.each([
    ['prep + cook', 10, 15, 25],
    ['cook only', null, 20, 20],
    ['prep only', 5, null, 5],
    ['prep 0 + cook', 0, 12, 12],
    ['neither', null, null, null],
    ['both 0', 0, 0, null],
  ])('%s → %p', (_, prepMinutes, cookMinutes, expected) => {
    const [suggestion] = suggestRecipes(
      [makeRecipe({ prepMinutes, cookMinutes })],
      NO_LIMIT,
      null,
    );
    expect(suggestion.minutes).toBe(expected);
  });

  it('keeps the recipe itself on the suggestion', () => {
    const recipe = makeRecipe({ id: 'r9', title: 'Soup' });
    expect(suggestRecipes([recipe], 30, null)[0].recipe).toBe(recipe);
  });
});

describe('suggestRecipes time filter', () => {
  const recipes = [
    makeRecipe({ id: 'm14', prepMinutes: 4, cookMinutes: 10 }),
    makeRecipe({ id: 'm15', prepMinutes: 5, cookMinutes: 10 }),
    makeRecipe({ id: 'm16', prepMinutes: 6, cookMinutes: 10 }),
    makeRecipe({ id: 'm30', prepMinutes: 10, cookMinutes: 20 }),
    makeRecipe({ id: 'm31', prepMinutes: 11, cookMinutes: 20 }),
    makeRecipe({ id: 'm60', prepMinutes: 30, cookMinutes: 30 }),
    makeRecipe({ id: 'm240', prepMinutes: 60, cookMinutes: 180 }),
    makeRecipe({ id: 'untimed', prepMinutes: null, cookMinutes: null }),
  ];

  it('15 min keeps recipes up to and including 15 min, plus untimed ones', () => {
    expect(ids(recipes, 15, null)).toEqual(['m14', 'm15', 'untimed']);
  });

  it('30 min keeps recipes up to and including 30 min, plus untimed ones', () => {
    expect(ids(recipes, 30, null)).toEqual([
      'm14',
      'm15',
      'm16',
      'm30',
      'untimed',
    ]);
  });

  it('"1 h+" has no limit: even a 4 h recipe fits', () => {
    expect(ids(recipes, NO_LIMIT, null)).toEqual([
      'm14',
      'm15',
      'm16',
      'm30',
      'm31',
      'm60',
      'm240',
      'untimed',
    ]);
  });

  it('returns nothing for no recipes', () => {
    expect(suggestRecipes([], 30, null)).toEqual([]);
  });

  it('returns nothing when no recipe fits', () => {
    expect(
      suggestRecipes([makeRecipe({ prepMinutes: 20, cookMinutes: 20 })], 15, null),
    ).toEqual([]);
  });

  it('does not mutate the input array', () => {
    const input = [
      makeRecipe({ id: 'slow', prepMinutes: 20 }),
      makeRecipe({ id: 'fast', prepMinutes: 1 }),
    ];
    suggestRecipes(input, NO_LIMIT, null);
    expect(input.map(r => r.id)).toEqual(['slow', 'fast']);
  });
});

describe('suggestRecipes adds', () => {
  it('is null while the week is not known, even for a recipe with nutrients', () => {
    const [suggestion] = suggestRecipes(
      [makeRecipe({ lines: [line(egg), line(lentils), line(oliveOil)] })],
      30,
      null,
    );
    expect(suggestion.adds).toBeNull();
  });

  it('is null when the week is full on everything', () => {
    const [suggestion] = suggestRecipes(
      [makeRecipe({ lines: [line(egg), line(lentils), line(oliveOil)] })],
      30,
      states(Full, Full, Full),
    );
    expect(suggestion.adds).toBeNull();
  });

  it('is null when the recipe only brings what the week is full on', () => {
    const [suggestion] = suggestRecipes(
      [makeRecipe({ lines: [line(egg)] })],
      30,
      states(Full, None, Some),
    );
    expect(suggestion.adds).toBeNull();
  });

  it('marks a nutrient the week has none of', () => {
    const [suggestion] = suggestRecipes(
      [makeRecipe({ lines: [line(oliveOil)] })],
      30,
      states(Full, Full, None),
    );
    expect(suggestion.adds).toEqual({ nutrient: HealthyFat, week: None });
  });

  it('marks a nutrient the week is low on', () => {
    const [suggestion] = suggestRecipes(
      [makeRecipe({ lines: [line(oliveOil)] })],
      30,
      states(Full, Full, Some),
    );
    expect(suggestion.adds).toEqual({ nutrient: HealthyFat, week: Some });
  });

  it('prefers a nutrient the week has none of over one it is low on', () => {
    // Lentils bring fiber (low) and protein (none): protein wins, though
    // fiber is listed first on the ingredient.
    const [suggestion] = suggestRecipes(
      [makeRecipe({ lines: [line(lentils)] })],
      30,
      states(None, Some, Full),
    );
    expect(suggestion.adds).toEqual({ nutrient: Protein, week: None });
  });

  it('between two "none" gaps, picks the first in dot order', () => {
    const [suggestion] = suggestRecipes(
      [makeRecipe({ lines: [line(oliveOil), line(lentils)] })],
      30,
      states(Full, None, None),
    );
    expect(suggestion.adds).toEqual({ nutrient: Fiber, week: None });
  });

  it('between two "some" gaps, picks the first in dot order', () => {
    const [suggestion] = suggestRecipes(
      [makeRecipe({ lines: [line(oliveOil), line(egg)] })],
      30,
      states(Some, Full, Some),
    );
    expect(suggestion.adds).toEqual({ nutrient: Protein, week: Some });
  });

  it('ignores headings, unlinked lines and ingredients with no nutrients', () => {
    const [suggestion] = suggestRecipes(
      [
        makeRecipe({
          lines: [
            line(null, '# For the sauce'),
            line(null, 'a pinch of salt'),
            line(rice),
          ],
        }),
      ],
      30,
      states(None, None, None),
    );
    expect(suggestion.adds).toBeNull();
  });

  it('finds the linked line among headings and unlinked ones', () => {
    const [suggestion] = suggestRecipes(
      [
        makeRecipe({
          lines: [
            line(null, '# Base'),
            line(null, 'water'),
            line(null, '# Topping'),
            line(oliveOil),
          ],
        }),
      ],
      30,
      states(Full, Full, None),
    );
    expect(suggestion.adds).toEqual({ nutrient: HealthyFat, week: None });
  });

  it('works for untimed recipes too', () => {
    const [suggestion] = suggestRecipes(
      [makeRecipe({ prepMinutes: null, cookMinutes: null, lines: [line(egg)] })],
      15,
      states(None, Full, Full),
    );
    expect(suggestion).toMatchObject({
      minutes: null,
      adds: { nutrient: Protein, week: None },
    });
  });
});

describe('suggestRecipes order', () => {
  it('with no week, lists the quickest first, then by title, untimed last', () => {
    const recipes = [
      makeRecipe({ id: 'untimed-b', title: 'Bread', prepMinutes: null, cookMinutes: null }),
      makeRecipe({ id: 'slow', title: 'Aaa', prepMinutes: 20, cookMinutes: 5 }),
      makeRecipe({ id: 'fast-z', title: 'Zucchini', prepMinutes: 5, cookMinutes: 5 }),
      makeRecipe({ id: 'fast-a', title: 'Apple', prepMinutes: 10, cookMinutes: 0 }),
      makeRecipe({ id: 'untimed-a', title: 'Aioli', prepMinutes: 0, cookMinutes: null }),
    ];
    expect(ids(recipes, 30, null)).toEqual([
      'fast-a',
      'fast-z',
      'slow',
      'untimed-a',
      'untimed-b',
    ]);
  });

  it('puts recipes that fill a gap first: "none" gaps, then "some", then none', () => {
    // Week: protein full, fiber none, healthy fat some.
    const recipes = [
      makeRecipe({ id: 'nothing', title: 'A', prepMinutes: 1, cookMinutes: 0, lines: [line(egg)] }),
      makeRecipe({ id: 'low-fat', title: 'B', prepMinutes: 2, cookMinutes: 0, lines: [line(oliveOil)] }),
      makeRecipe({ id: 'no-fiber', title: 'C', prepMinutes: 25, cookMinutes: 0, lines: [line(lentils)] }),
    ];
    expect(ids(recipes, 30, states(Full, None, Some))).toEqual([
      'no-fiber',
      'low-fat',
      'nothing',
    ]);
  });

  it('ranks "none" gaps among themselves in dot order', () => {
    const recipes = [
      makeRecipe({ id: 'fat', prepMinutes: 1, lines: [line(oliveOil)] }),
      makeRecipe({ id: 'fiber', prepMinutes: 2, lines: [line(ingredient('bran', [Fiber]))] }),
      makeRecipe({ id: 'protein', prepMinutes: 3, lines: [line(egg)] }),
    ];
    expect(ids(recipes, NO_LIMIT, states(None, None, None))).toEqual([
      'protein',
      'fiber',
      'fat',
    ]);
  });

  it('within the same gap, the quicker recipe comes first, then the title', () => {
    const recipes = [
      makeRecipe({ id: 'slow', title: 'A', prepMinutes: 20, lines: [line(oliveOil)] }),
      makeRecipe({ id: 'fast-b', title: 'B', prepMinutes: 5, lines: [line(oliveOil)] }),
      makeRecipe({ id: 'fast-a', title: 'A', prepMinutes: 5, lines: [line(oliveOil)] }),
    ];
    expect(ids(recipes, NO_LIMIT, states(Full, Full, None))).toEqual([
      'fast-a',
      'fast-b',
      'slow',
    ]);
  });

  it('keeps untimed recipes last, even when they fill the biggest gap', () => {
    const recipes = [
      makeRecipe({ id: 'untimed-gap', prepMinutes: null, cookMinutes: null, lines: [line(egg)] }),
      makeRecipe({ id: 'timed-plain', prepMinutes: 25, cookMinutes: 0 }),
    ];
    expect(ids(recipes, 30, states(None, Full, Full))).toEqual([
      'timed-plain',
      'untimed-gap',
    ]);
  });

  it('orders untimed recipes by gap, then by title', () => {
    const untimed = { prepMinutes: null, cookMinutes: null };
    const recipes = [
      makeRecipe({ id: 'u-plain', title: 'A', ...untimed }),
      makeRecipe({ id: 'u-low', title: 'B', ...untimed, lines: [line(oliveOil)] }),
      makeRecipe({ id: 'u-none-z', title: 'Z', ...untimed, lines: [line(egg)] }),
      makeRecipe({ id: 'u-none-c', title: 'C', ...untimed, lines: [line(egg)] }),
    ];
    expect(ids(recipes, 15, states(None, Full, Some))).toEqual([
      'u-none-c',
      'u-none-z',
      'u-low',
      'u-plain',
    ]);
  });
});
