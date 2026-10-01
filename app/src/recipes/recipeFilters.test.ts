import { Recipe } from '../api/recipesClient';
import {
  filterRecipes,
  foldForSearch,
  hasFilters,
  NO_FILTERS,
  RecipeFilters,
  sourceOptions,
} from './recipeFilters';

function makeRecipe(overrides: Partial<Recipe> = {}): Recipe {
  return {
    id: 'r1',
    title: 'Lentil soup',
    ingredients: [],
    lines: [],
    instructions: '',
    story: null,
    imageUrl: null,
    source: null,
    prepMinutes: null,
    cookMinutes: null,
    servings: null,
    forkedFrom: null,
    forks: [],
    createdAt: '2026-09-21T12:00:00.000Z',
    updatedAt: '2026-09-21T12:00:00.000Z',
    ...overrides,
  };
}

function withFilters(overrides: Partial<RecipeFilters>): RecipeFilters {
  return { ...NO_FILTERS, ...overrides };
}

function ids(recipes: Recipe[]): string[] {
  return recipes.map(recipe => recipe.id);
}

describe('foldForSearch', () => {
  it.each([
    ['İSPANAK', 'ispanak'],
    ['ıspanak', 'ispanak'],
    ['Ispanak', 'ispanak'],
    ['ispanak', 'ispanak'],
    ['KIRMIZI BİBER', 'kirmizi biber'],
    ['Chickpea', 'chickpea'],
  ])('folds %p to %p', (input, expected) => {
    expect(foldForSearch(input)).toBe(expected);
  });

  it('makes İ, I, ı and i all fold to the same letter', () => {
    expect(new Set(['İ', 'I', 'ı', 'i'].map(foldForSearch))).toEqual(
      new Set(['i']),
    );
  });

  it('keeps other Turkish letters and trims surrounding space', () => {
    expect(foldForSearch('  ÇÖREK Otu ŞİŞ ')).toBe('çörek otu şiş');
  });

  it('returns an empty string for blank input', () => {
    expect(foldForSearch('   ')).toBe('');
  });
});

describe('hasFilters', () => {
  it('is false for no filters and for a whitespace-only query', () => {
    expect(hasFilters(NO_FILTERS)).toBe(false);
    expect(hasFilters(withFilters({ query: '   ' }))).toBe(false);
  });

  it.each<[string, Partial<RecipeFilters>]>([
    ['a query', { query: 'soup' }],
    ['a time limit', { maxMinutes: 15 }],
    ['a source', { source: 'mom' }],
  ])('is true with %s', (_label, overrides) => {
    expect(hasFilters(withFilters(overrides))).toBe(true);
  });
});

describe('filterRecipes query', () => {
  const soup = makeRecipe({
    id: 'soup',
    title: 'Lentil soup',
    ingredients: ['1 cup red lentils', '1 onion'],
  });
  const curry = makeRecipe({
    id: 'curry',
    title: 'Weeknight curry',
    ingredients: ['400 g chickpeas', '200 g spinach', '# For the rice', 'rice'],
  });
  const borek = makeRecipe({
    id: 'borek',
    title: 'ISPANAKLI BÖREK',
    ingredients: ['yufka', 'beyaz peynir'],
  });
  const recipes = [soup, curry, borek];

  it('returns every recipe, in order, with no filters', () => {
    expect(ids(filterRecipes(recipes, NO_FILTERS))).toEqual([
      'soup',
      'curry',
      'borek',
    ]);
  });

  it('returns every recipe for a whitespace-only query', () => {
    expect(ids(filterRecipes(recipes, withFilters({ query: '  ' })))).toEqual(
      ['soup', 'curry', 'borek'],
    );
  });

  it('matches the title case-insensitively', () => {
    expect(ids(filterRecipes(recipes, withFilters({ query: 'SOUP' })))).toEqual(
      ['soup'],
    );
  });

  it('matches an ingredient line when the title does not', () => {
    expect(
      ids(filterRecipes(recipes, withFilters({ query: 'spinach' }))),
    ).toEqual(['curry']);
  });

  it('matches part of a word', () => {
    expect(ids(filterRecipes(recipes, withFilters({ query: 'lent' })))).toEqual(
      ['soup'],
    );
  });

  it('matches across Turkish dotted and dotless i', () => {
    expect(
      ids(filterRecipes(recipes, withFilters({ query: 'ıspanaklı' }))),
    ).toEqual(['borek']);
    expect(
      ids(filterRecipes(recipes, withFilters({ query: 'İspanakli' }))),
    ).toEqual(['borek']);
  });

  it('requires every word, which may come from title and ingredients', () => {
    expect(
      ids(filterRecipes(recipes, withFilters({ query: 'chickpea spinach' }))),
    ).toEqual(['curry']);
    expect(
      ids(filterRecipes(recipes, withFilters({ query: 'curry  rice ' }))),
    ).toEqual(['curry']);
  });

  it('drops a recipe when only some of the words match', () => {
    expect(
      ids(filterRecipes(recipes, withFilters({ query: 'chickpea lentil' }))),
    ).toEqual([]);
  });

  it('does not match a word split across two ingredient lines', () => {
    const recipe = makeRecipe({ id: 'x', ingredients: ['sal', 't'] });
    expect(ids(filterRecipes([recipe], withFilters({ query: 'salt' })))).toEqual(
      [],
    );
  });

  it('returns nothing when nothing matches', () => {
    expect(filterRecipes(recipes, withFilters({ query: 'pizza' }))).toEqual([]);
  });

  it('handles an empty recipe list', () => {
    expect(filterRecipes([], withFilters({ query: 'soup' }))).toEqual([]);
  });
});

describe('filterRecipes time', () => {
  it.each([15, 30, 60] as const)(
    'keeps a recipe of exactly %i minutes and drops one a minute longer',
    limit => {
      const exact = makeRecipe({
        id: 'exact',
        prepMinutes: 5,
        cookMinutes: limit - 5,
      });
      const over = makeRecipe({
        id: 'over',
        prepMinutes: 5,
        cookMinutes: limit - 4,
      });
      expect(
        ids(filterRecipes([exact, over], withFilters({ maxMinutes: limit }))),
      ).toEqual(['exact']);
    },
  );

  it('adds prep and cook together', () => {
    const recipe = makeRecipe({ prepMinutes: 10, cookMinutes: 10 });
    expect(filterRecipes([recipe], withFilters({ maxMinutes: 15 }))).toEqual(
      [],
    );
    expect(
      ids(filterRecipes([recipe], withFilters({ maxMinutes: 30 }))),
    ).toEqual(['r1']);
  });

  it('counts a recipe with only a prep time', () => {
    const recipe = makeRecipe({ prepMinutes: 15, cookMinutes: null });
    expect(
      ids(filterRecipes([recipe], withFilters({ maxMinutes: 15 }))),
    ).toEqual(['r1']);
  });

  it('counts a recipe with only a cook time', () => {
    const recipe = makeRecipe({ prepMinutes: null, cookMinutes: 30 });
    expect(filterRecipes([recipe], withFilters({ maxMinutes: 15 }))).toEqual(
      [],
    );
    expect(
      ids(filterRecipes([recipe], withFilters({ maxMinutes: 30 }))),
    ).toEqual(['r1']);
  });

  it.each([
    ['no times', null, null],
    ['zero times', 0, 0],
    ['zero prep and no cook', 0, null],
  ])(
    'excludes a recipe with %s from any time filter',
    (_label, prepMinutes, cookMinutes) => {
      const recipe = makeRecipe({ prepMinutes, cookMinutes });
      expect(filterRecipes([recipe], withFilters({ maxMinutes: 60 }))).toEqual(
        [],
      );
    },
  );

  it('keeps an untimed recipe when there is no time filter', () => {
    const recipe = makeRecipe({ prepMinutes: null, cookMinutes: null });
    expect(ids(filterRecipes([recipe], NO_FILTERS))).toEqual(['r1']);
  });
});

describe('filterRecipes source', () => {
  const recipes = [
    makeRecipe({ id: 'a', source: 'Mom' }),
    makeRecipe({ id: 'b', source: 'mom' }),
    makeRecipe({ id: 'c', source: ' MOM ' }),
    makeRecipe({ id: 'd', source: 'Mommy' }),
    makeRecipe({ id: 'e', source: null }),
    makeRecipe({ id: 'f', source: '' }),
  ];

  it('matches the source key in any case, ignoring surrounding space', () => {
    expect(ids(filterRecipes(recipes, withFilters({ source: 'mom' })))).toEqual(
      ['a', 'b', 'c'],
    );
  });

  it('does not match a source that only starts with the key', () => {
    expect(
      ids(filterRecipes(recipes, withFilters({ source: 'mommy' }))),
    ).toEqual(['d']);
  });

  it('matches a Turkish source whatever its casing', () => {
    const recipe = makeRecipe({ source: 'İNCİ TEYZE' });
    const key = sourceOptions([makeRecipe({ source: 'inci teyze' })])[0].key;
    expect(ids(filterRecipes([recipe], withFilters({ source: key })))).toEqual(
      ['r1'],
    );
  });

  it('drops recipes with no source', () => {
    expect(
      ids(filterRecipes(recipes, withFilters({ source: 'nobody' }))),
    ).toEqual([]);
  });
});

describe('filterRecipes combined', () => {
  const recipes = [
    makeRecipe({
      id: 'quick-mom-soup',
      title: 'Quick soup',
      source: 'Mom',
      prepMinutes: 5,
      cookMinutes: 10,
    }),
    makeRecipe({
      id: 'slow-mom-soup',
      title: 'Slow soup',
      source: 'Mom',
      prepMinutes: 20,
      cookMinutes: 40,
    }),
    makeRecipe({
      id: 'quick-book-soup',
      title: 'Book soup',
      source: 'Cookbook',
      prepMinutes: 5,
      cookMinutes: 5,
    }),
    makeRecipe({
      id: 'quick-mom-salad',
      title: 'Salad',
      source: 'Mom',
      prepMinutes: 10,
      cookMinutes: null,
    }),
  ];

  it('applies query, time and source together', () => {
    expect(
      ids(
        filterRecipes(
          recipes,
          withFilters({ query: 'soup', maxMinutes: 15, source: 'mom' }),
        ),
      ),
    ).toEqual(['quick-mom-soup']);
  });

  it('widens again when one filter is relaxed', () => {
    expect(
      ids(
        filterRecipes(recipes, withFilters({ query: 'soup', source: 'mom' })),
      ),
    ).toEqual(['quick-mom-soup', 'slow-mom-soup']);
  });
});

describe('sourceOptions', () => {
  it('returns nothing when no recipe has a source', () => {
    expect(
      sourceOptions([
        makeRecipe({ source: null }),
        makeRecipe({ source: '' }),
        makeRecipe({ source: '   ' }),
      ]),
    ).toEqual([]);
  });

  it('returns nothing for an empty list', () => {
    expect(sourceOptions([])).toEqual([]);
  });

  it('lists each source once, keyed by its folded form', () => {
    expect(
      sourceOptions([
        makeRecipe({ source: 'Mom' }),
        makeRecipe({ source: 'Mom' }),
        makeRecipe({ source: '@chef' }),
      ]),
    ).toEqual([
      { key: '@chef', label: '@chef' },
      { key: 'mom', label: 'Mom' },
    ]);
  });

  it('merges spellings and labels the chip with the most frequent one', () => {
    const options = sourceOptions([
      makeRecipe({ source: 'mom' }),
      makeRecipe({ source: 'Mom' }),
      makeRecipe({ source: 'MOM' }),
      makeRecipe({ source: 'Mom' }),
    ]);
    expect(options).toEqual([{ key: 'mom', label: 'Mom' }]);
  });

  it('merges Turkish spellings of the same source', () => {
    const options = sourceOptions([
      makeRecipe({ source: 'İnci Teyze' }),
      makeRecipe({ source: 'İNCİ TEYZE' }),
      makeRecipe({ source: 'İnci Teyze' }),
      makeRecipe({ source: 'Inci teyze' }),
    ]);
    expect(options).toEqual([{ key: 'inci teyze', label: 'İnci Teyze' }]);
  });

  it('trims the label and merges padded spellings', () => {
    expect(
      sourceOptions([
        makeRecipe({ source: '  Mom ' }),
        makeRecipe({ source: 'Mom' }),
      ]),
    ).toEqual([{ key: 'mom', label: 'Mom' }]);
  });

  it('breaks a frequency tie alphabetically, whatever the recipe order', () => {
    const first = sourceOptions([
      makeRecipe({ source: 'Grandma Ayla' }),
      makeRecipe({ source: 'GRANDMA AYLA' }),
    ]);
    const second = sourceOptions([
      makeRecipe({ source: 'GRANDMA AYLA' }),
      makeRecipe({ source: 'Grandma Ayla' }),
    ]);
    expect(first).toEqual(second);
    expect(first).toEqual([{ key: 'grandma ayla', label: 'Grandma Ayla' }]);
  });

  it('sorts chips A to Z by label, case-insensitively', () => {
    expect(
      sourceOptions([
        makeRecipe({ source: 'zeynep' }),
        makeRecipe({ source: 'Ayşe' }),
        makeRecipe({ source: 'mom' }),
        makeRecipe({ source: 'Book' }),
      ]).map(option => option.label),
    ).toEqual(['Ayşe', 'Book', 'mom', 'zeynep']);
  });

  it('sorts with the Turkish alphabet (C before Ç)', () => {
    expect(
      sourceOptions([
        makeRecipe({ source: 'Çiğdem' }),
        makeRecipe({ source: 'Cüneyt' }),
        makeRecipe({ source: 'Dilek' }),
      ]).map(option => option.label),
    ).toEqual(['Cüneyt', 'Çiğdem', 'Dilek']);
  });
});
