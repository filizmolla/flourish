import {
  AttemptDetail,
  ParsedRecipe,
  Recipe,
  RecipeInput,
} from '../api/recipesClient';
import {
  emptyRecipeForm,
  fromParsedRecipe,
  headingText,
  isHeadingLine,
  MAX_SOURCE_LENGTH,
  MAX_WHOLE_NUMBER,
  RecipeFormValues,
  recipeFormSchema,
  splitLines,
  toForkFormValues,
  toFormValues,
  toRecipeInput,
} from './recipeForm';

function makeRecipe(overrides: Partial<Recipe> = {}): Recipe {
  return {
    id: 'r1',
    title: 'Sunday Pancakes',
    ingredients: ['1 cup flour', '1 egg', '1 cup milk'],
    instructions: 'Whisk everything.\nCook on a hot pan.',
    story: 'Grandma made these.\n\nEvery Sunday.',
    imageUrl: 'https://example.com/pancakes.jpg',
    source: '@sundaykitchen',
    prepMinutes: 5,
    cookMinutes: 20,
    servings: 4,
    forkedFrom: null,
    lines: [],
    forks: [],
    createdAt: '2026-09-21T12:00:00.000Z',
    updatedAt: '2026-09-21T12:00:00.000Z',
    ...overrides,
  };
}

function writableFields(recipe: Recipe): RecipeInput {
  return {
    title: recipe.title,
    ingredients: recipe.ingredients,
    instructions: recipe.instructions,
    story: recipe.story,
    imageUrl: recipe.imageUrl,
    source: recipe.source,
    prepMinutes: recipe.prepMinutes,
    cookMinutes: recipe.cookMinutes,
    servings: recipe.servings,
  };
}

const valid: RecipeFormValues = {
  ...emptyRecipeForm,
  title: 'Sunday Pancakes',
  ingredients: '1 cup flour',
  instructions: 'Cook.',
};

// Returns the first error message for a field, or undefined if it's valid.
function errorFor(
  overrides: Partial<RecipeFormValues>,
  field: keyof RecipeFormValues,
) {
  const result = recipeFormSchema.safeParse({ ...valid, ...overrides });
  if (result.success) return undefined;
  return result.error.issues.find(issue => issue.path[0] === field)?.message;
}

describe('recipeFormSchema', () => {
  it('accepts a minimal form with all optional fields blank', () => {
    expect(recipeFormSchema.safeParse(valid).success).toBe(true);
  });

  it('reports every required field on an empty form', () => {
    const result = recipeFormSchema.safeParse(emptyRecipeForm);
    expect(result.success).toBe(false);
    const messages = Object.fromEntries(
      result.error!.issues.map(issue => [issue.path[0], issue.message]),
    );
    expect(messages).toEqual({
      title: 'Title is required',
      ingredients: 'Add at least one ingredient',
      instructions: 'Add at least one step',
    });
  });

  describe('title', () => {
    it.each([
      ['empty', ''],
      ['whitespace only', '   '],
    ])('is required (%s)', (_label, title) => {
      expect(errorFor({ title }, 'title')).toBe('Title is required');
    });

    it('accepts a single character', () => {
      expect(errorFor({ title: 'A' }, 'title')).toBeUndefined();
    });

    it('accepts exactly 200 characters', () => {
      expect(errorFor({ title: 'a'.repeat(200) }, 'title')).toBeUndefined();
    });

    it('rejects 201 characters', () => {
      expect(errorFor({ title: 'a'.repeat(201) }, 'title')).toBe(
        'Title is too long',
      );
    });

    it('measures the length after trimming', () => {
      expect(
        errorFor({ title: `  ${'a'.repeat(200)}  ` }, 'title'),
      ).toBeUndefined();
    });
  });

  it('caps whole numbers at 10000', () => {
    expect(MAX_WHOLE_NUMBER).toBe(10000);
  });

  describe.each([
    ['prepMinutes', 'Prep time'],
    ['cookMinutes', 'Cook time'],
    ['servings', 'Servings'],
  ] as const)('%s', (field, label) => {
    it.each(['', '   ', '0', '1', '45', ' 12 ', '10000', '0010000'])(
      'accepts %j',
      value => {
        expect(errorFor({ [field]: value }, field)).toBeUndefined();
      },
    );

    it.each(['-1', '1.5', '1,5', 'abc', '10 min', '1e3', '10000.5'])(
      'rejects %j as not a whole number',
      value => {
        expect(errorFor({ [field]: value }, field)).toBe(
          `${label} must be a whole number`,
        );
      },
    );

    it.each([
      ['10001', '10001'],
      ['99999999999', '99999999999'],
      ['a 400-digit number', '9'.repeat(400)],
    ])('rejects %s as too big', (_label, value) => {
      expect(errorFor({ [field]: value }, field)).toBe(
        `${label} must be at most 10000`,
      );
    });
  });

  describe('imageUrl', () => {
    it.each([
      '',
      '   ',
      'https://example.com/a.jpg',
      'http://example.com/a.jpg',
      'HTTPS://EXAMPLE.COM/A.JPG',
      // Same pattern as the server, which also accepts this.
      'https://[',
      '  https://example.com/a.jpg  ',
    ])('accepts %j', imageUrl => {
      expect(errorFor({ imageUrl }, 'imageUrl')).toBeUndefined();
    });

    it.each([
      'example.com/a.jpg',
      'ftp://example.com/a.jpg',
      // eslint-disable-next-line no-script-url -- the point is to reject it
      'javascript:alert(1)',
      'https://',
      'https://exa mple.com',
    ])('rejects %j', imageUrl => {
      expect(errorFor({ imageUrl }, 'imageUrl')).toBe(
        'Enter a link starting with http:// or https://',
      );
    });
  });

  describe.each([
    ['ingredients', 'Add at least one ingredient'],
    ['instructions', 'Add at least one step'],
  ] as const)('%s', (field, message) => {
    it.each(['', '   ', '\n\n', ' \n \t\n '])(
      'rejects %j (no non-blank line)',
      value => {
        expect(errorFor({ [field]: value }, field)).toBe(message);
      },
    );

    it('accepts a single non-blank line among blank ones', () => {
      expect(errorFor({ [field]: '\n  one  \n\n' }, field)).toBeUndefined();
    });

    it.each([
      ['one heading', '# For the cake'],
      ['several headings', '# For the cake\n\n## For the cream\n  # Topping  '],
    ])('rejects %s and nothing else', (_label, value) => {
      expect(errorFor({ [field]: value }, field)).toBe(
        `${message}, not just headings`,
      );
    });

    it('accepts headings with at least one ordinary line', () => {
      expect(
        errorFor({ [field]: '# For the cake\nflour\n# For the cream' }, field),
      ).toBeUndefined();
    });

    it.each(['#hashtag', '#10 can tomatoes', '#', '# '])(
      'counts %j as an ordinary line, not a heading',
      value => {
        expect(errorFor({ [field]: value }, field)).toBeUndefined();
      },
    );
  });

  describe('source', () => {
    it.each(['', '   ', '@someone', 'Mom', 'a'.repeat(MAX_SOURCE_LENGTH)])(
      'accepts %j',
      source => {
        expect(errorFor({ source }, 'source')).toBeUndefined();
      },
    );

    it('rejects 101 characters', () => {
      expect(
        errorFor({ source: 'a'.repeat(MAX_SOURCE_LENGTH + 1) }, 'source'),
      ).toBe('Keep it under 100 characters');
    });

    it('measures the length after trimming', () => {
      expect(
        errorFor({ source: `  ${'a'.repeat(MAX_SOURCE_LENGTH)}  ` }, 'source'),
      ).toBeUndefined();
    });

    it('matches the server cap of 100', () => {
      expect(MAX_SOURCE_LENGTH).toBe(100);
    });
  });

  it('does not validate the story', () => {
    expect(errorFor({ story: '   ' }, 'story')).toBeUndefined();
  });
});

describe('splitLines', () => {
  it('trims each line and drops blank ones', () => {
    expect(splitLines('  a  \n\n b\n   \n\tc\t')).toEqual(['a', 'b', 'c']);
  });

  it('returns an empty array for blank text', () => {
    expect(splitLines('')).toEqual([]);
    expect(splitLines(' \n \n')).toEqual([]);
  });
});

describe('isHeadingLine', () => {
  it.each([
    '# A',
    '## A',
    '### For the cream',
    '#\tFor the cream',
    '  # For the cake  ',
    '# For the cream:',
  ])('treats %j as a heading', line => {
    expect(isHeadingLine(line)).toBe(true);
  });

  it.each([
    '#hashtag',
    '#10 can tomatoes',
    '#',
    '# ',
    '##',
    '#   ',
    '',
    'For the dough:',
    '2 cups flour # sifted',
  ])('treats %j as an ordinary line', line => {
    expect(isHeadingLine(line)).toBe(false);
  });
});

describe('headingText', () => {
  it.each([
    ['# For the cream', 'For the cream'],
    ['## For the cream', 'For the cream'],
    ['  #   For the cake  ', 'For the cake'],
    ['# C# notes', 'C# notes'],
  ])('shows %j as %j', (line, text) => {
    expect(headingText(line)).toBe(text);
  });

  it('returns any other line as it is', () => {
    expect(headingText('#hashtag')).toBe('#hashtag');
    expect(headingText('2 eggs')).toBe('2 eggs');
  });
});

describe('toFormValues', () => {
  it('turns a full recipe into form strings', () => {
    expect(toFormValues(makeRecipe())).toEqual({
      title: 'Sunday Pancakes',
      story: 'Grandma made these.\n\nEvery Sunday.',
      source: '@sundaykitchen',
      imageUrl: 'https://example.com/pancakes.jpg',
      prepMinutes: '5',
      cookMinutes: '20',
      servings: '4',
      ingredients: '1 cup flour\n1 egg\n1 cup milk',
      instructions: 'Whisk everything.\nCook on a hot pan.',
    });
  });

  it('turns null optionals into blank strings', () => {
    const values = toFormValues(
      makeRecipe({
        story: null,
        imageUrl: null,
        source: null,
        prepMinutes: null,
        cookMinutes: null,
        servings: null,
      }),
    );
    expect(values).toMatchObject({
      story: '',
      source: '',
      imageUrl: '',
      prepMinutes: '',
      cookMinutes: '',
      servings: '',
    });
  });

  it('keeps zero as "0" rather than blank', () => {
    expect(toFormValues(makeRecipe({ prepMinutes: 0 })).prepMinutes).toBe('0');
  });
});

describe('toRecipeInput', () => {
  it('converts blank optionals to null', () => {
    expect(toRecipeInput(valid)).toEqual({
      title: 'Sunday Pancakes',
      story: null,
      source: null,
      imageUrl: null,
      prepMinutes: null,
      cookMinutes: null,
      servings: null,
      ingredients: ['1 cup flour'],
      instructions: 'Cook.',
    });
  });

  it('treats whitespace-only optionals as blank', () => {
    const input = toRecipeInput({
      ...valid,
      story: '  \n ',
      source: ' \t ',
      imageUrl: '   ',
      prepMinutes: '  ',
    });
    expect(input).toMatchObject({
      story: null,
      source: null,
      imageUrl: null,
      prepMinutes: null,
    });
  });

  it('trims text, parses numbers and drops blank lines', () => {
    const input = toRecipeInput({
      title: '  Pancakes  ',
      story: '\n  First.\n\nSecond.  \n',
      source: '  @someone ',
      imageUrl: ' https://example.com/p.jpg ',
      prepMinutes: '0',
      cookMinutes: ' 15 ',
      servings: '007',
      ingredients: '  flour \n\n  \n eggs\n',
      instructions: '\nMix.  \n\n  Cook.\n',
    });
    expect(input).toEqual({
      title: 'Pancakes',
      story: 'First.\n\nSecond.',
      source: '@someone',
      imageUrl: 'https://example.com/p.jpg',
      prepMinutes: 0,
      cookMinutes: 15,
      servings: 7,
      ingredients: ['flour', 'eggs'],
      instructions: 'Mix.\nCook.',
    });
  });

  it('round-trips a recipe through the form unchanged', () => {
    const recipe = makeRecipe();
    expect(toRecipeInput(toFormValues(recipe))).toEqual(writableFields(recipe));
  });

  it('round-trips a recipe with no optional details', () => {
    const recipe = makeRecipe({
      story: null,
      imageUrl: null,
      source: null,
      prepMinutes: null,
      cookMinutes: null,
      servings: null,
    });
    expect(toRecipeInput(toFormValues(recipe))).toEqual(writableFields(recipe));
  });

  it('passes the cap value through as a number', () => {
    expect(toRecipeInput({ ...valid, servings: '10000' }).servings).toBe(10000);
  });

  it('converts values that went through the schema', () => {
    const parsed = recipeFormSchema.parse({
      ...valid,
      title: '  Pancakes ',
      servings: ' 3 ',
    });
    expect(toRecipeInput(parsed)).toMatchObject({
      title: 'Pancakes',
      servings: 3,
    });
  });
});

describe('toForkFormValues', () => {
  function makeAttempt(overrides: Partial<AttemptDetail> = {}): AttemptDetail {
    return {
      id: 'a1',
      recipeId: 'r1',
      durationMinutes: 30,
      madeAt: '2026-09-21T12:00:00.000Z',
      rating: 4,
      fullness: null,
      enjoyment: null,
      hasPhoto: false,
      notes: 'Needed more milk',
      ingredients: null,
      instructions: null,
      basedOnAttemptId: null,
      tweaked: false,
      basedOnAttempt: null,
      fork: null,
      createdAt: '2026-09-21T12:00:00.000Z',
      updatedAt: '2026-09-21T12:00:00.000Z',
      ...overrides,
    };
  }

  it("uses today's recipe lines when the attempt saved no snapshot, with title and story empty", () => {
    expect(toForkFormValues(makeRecipe(), makeAttempt())).toEqual({
      title: '',
      story: '',
      source: '@sundaykitchen',
      imageUrl: 'https://example.com/pancakes.jpg',
      prepMinutes: '5',
      cookMinutes: '20',
      servings: '4',
      ingredients: '1 cup flour\n1 egg\n1 cup milk',
      instructions: 'Whisk everything.\nCook on a hot pan.',
    });
  });

  it("uses the attempt's lines when it saved a snapshot, keeping the recipe's times, servings, photo and source", () => {
    const values = toForkFormValues(
      makeRecipe(),
      makeAttempt({
        ingredients: [
          { text: '1 cup flour', ingredientId: 'i1' },
          { text: '2 eggs' },
        ],
        instructions: 'Whisk.\nRest 10 minutes.\nCook.',
      }),
    );

    expect(values).toEqual({
      title: '',
      story: '',
      source: '@sundaykitchen',
      imageUrl: 'https://example.com/pancakes.jpg',
      prepMinutes: '5',
      cookMinutes: '20',
      servings: '4',
      ingredients: '1 cup flour\n2 eggs',
      instructions: 'Whisk.\nRest 10 minutes.\nCook.',
    });
  });

  it('takes each list on its own when only one was snapshotted', () => {
    const onlyIngredients = toForkFormValues(
      makeRecipe(),
      makeAttempt({ ingredients: [{ text: '2 eggs' }] }),
    );
    expect(onlyIngredients.ingredients).toBe('2 eggs');
    expect(onlyIngredients.instructions).toBe(
      'Whisk everything.\nCook on a hot pan.',
    );

    const onlyInstructions = toForkFormValues(
      makeRecipe(),
      makeAttempt({ instructions: 'Just cook.' }),
    );
    expect(onlyInstructions.ingredients).toBe('1 cup flour\n1 egg\n1 cup milk');
    expect(onlyInstructions.instructions).toBe('Just cook.');
  });

  it('leaves missing times, servings, photo and source empty', () => {
    const values = toForkFormValues(
      makeRecipe({
        imageUrl: null,
        source: null,
        prepMinutes: null,
        cookMinutes: null,
        servings: null,
        story: null,
      }),
      makeAttempt(),
    );

    expect(values).toMatchObject({
      title: '',
      story: '',
      source: '',
      imageUrl: '',
      prepMinutes: '',
      cookMinutes: '',
      servings: '',
    });
  });

  it('gives a form that validates once a title is filled in', () => {
    const values = toForkFormValues(
      makeRecipe(),
      makeAttempt({ ingredients: [{ text: '2 eggs' }] }),
    );

    expect(recipeFormSchema.safeParse(values).success).toBe(false);
    expect(
      recipeFormSchema.safeParse({ ...values, title: 'Fluffy Pancakes' })
        .success,
    ).toBe(true);
  });
});

describe('fromParsedRecipe', () => {
  const parsed: ParsedRecipe = {
    title: 'Mercimek çorbası',
    source: '@annemin.mutfagi',
    ingredients: [
      '1 su bardağı mercimek',
      '1 soğan',
      '2 yemek kaşığı tereyağı',
    ],
    instructions: 'Soğanı doğrayın.\nMercimeği ekleyip kaynatın.',
  };

  it('fills title, source, one ingredient per line and the instructions as is; the rest starts empty', () => {
    expect(fromParsedRecipe(parsed)).toEqual({
      ...emptyRecipeForm,
      title: 'Mercimek çorbası',
      source: '@annemin.mutfagi',
      ingredients: '1 su bardağı mercimek\n1 soğan\n2 yemek kaşığı tereyağı',
      instructions: 'Soğanı doğrayın.\nMercimeği ekleyip kaynatın.',
    });
  });

  it('gives a valid form that converts back to the same lines', () => {
    const values = fromParsedRecipe(parsed);

    expect(recipeFormSchema.safeParse(values).success).toBe(true);
    expect(toRecipeInput(values)).toEqual({
      title: 'Mercimek çorbası',
      story: null,
      source: '@annemin.mutfagi',
      imageUrl: null,
      prepMinutes: null,
      cookMinutes: null,
      servings: null,
      ingredients: parsed.ingredients,
      instructions: parsed.instructions,
    });
  });

  it('leaves the source empty when the photos credit no one', () => {
    const values = fromParsedRecipe({ ...parsed, source: '' });

    expect(values.source).toBe('');
    expect(toRecipeInput(values).source).toBeNull();
  });

  it('prefills an import read before source existed, with the source empty', () => {
    const oldImport: ParsedRecipe = {
      title: parsed.title,
      ingredients: parsed.ingredients,
      instructions: parsed.instructions,
    };

    const values = fromParsedRecipe(oldImport);

    expect(values).toEqual({
      ...emptyRecipeForm,
      title: 'Mercimek çorbası',
      ingredients: '1 su bardağı mercimek\n1 soğan\n2 yemek kaşığı tereyağı',
      instructions: 'Soğanı doğrayın.\nMercimeği ekleyip kaynatın.',
    });
    expect(recipeFormSchema.safeParse(values).success).toBe(true);
  });

  it('keeps section headings as their own lines', () => {
    const values = fromParsedRecipe({
      ...parsed,
      ingredients: ['# For the cake', 'flour', '# For the cream', 'cream'],
    });

    expect(values.ingredients).toBe(
      '# For the cake\nflour\n# For the cream\ncream',
    );
    expect(toRecipeInput(values).ingredients).toEqual([
      '# For the cake',
      'flour',
      '# For the cream',
      'cream',
    ]);
  });

  it('keeps a single ingredient without a trailing newline', () => {
    expect(
      fromParsedRecipe({ ...parsed, ingredients: ['flour'] }).ingredients,
    ).toBe('flour');
  });

  it('leaves the title empty when the photos had none, so the form asks for one', () => {
    const values = fromParsedRecipe({ ...parsed, title: '' });

    expect(values.title).toBe('');
    const result = recipeFormSchema.safeParse(values);
    expect(result.success).toBe(false);
    expect(result.error?.issues.map(issue => issue.path[0])).toEqual(['title']);
  });

  it('leaves the instructions empty when the photos had no steps, so the form asks for one', () => {
    const values = fromParsedRecipe({ ...parsed, instructions: '' });

    expect(values.instructions).toBe('');
    expect(recipeFormSchema.safeParse(values).success).toBe(false);
  });
});
