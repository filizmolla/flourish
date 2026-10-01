import { API_BASE_URL } from '../config';
import {
  Attempt,
  AttemptDetail,
  AttemptInput,
  attemptPhotoUrl,
  createAttempt,
  createRecipe,
  deleteRecipe,
  Enjoyment,
  fetchAttempt,
  fetchAttempts,
  fetchIngredient,
  fetchIngredients,
  FoodGroup,
  IngredientDetail,
  IngredientSummary,
  fetchRecipe,
  fetchRecipes,
  fetchUnratedAttempt,
  ImportState,
  ParsedImport,
  parseImport,
  Recipe,
  RecipeInput,
  RecipesError,
  UnratedAttempt,
  updateAttempt,
  updateImport,
  updateRecipe,
  ImportStatus,
  usdaFoodUrl,
  createMeal,
  deleteMeal,
  fetchRecentSnacks,
  updateMeal,
  Fullness,
  Meal,
  MealInput,
  MealKind,
  mealPhotoUrl,
  fetchWeek,
  Week,
} from './recipesClient';

function makeRecipe(overrides: Partial<Recipe> = {}): Recipe {
  return {
    id: 'r1',
    title: 'Sunday Pancakes',
    ingredients: ['1 cup flour', '1 egg'],
    instructions: 'Whisk.\nCook.',
    story: null,
    imageUrl: null,
    source: null,
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

const input: RecipeInput = {
  title: 'Sunday Pancakes',
  ingredients: ['1 cup flour', '1 egg'],
  instructions: 'Whisk.\nCook.',
  story: null,
  imageUrl: null,
  source: null,
  prepMinutes: 5,
  cookMinutes: 20,
  servings: 4,
};

const attemptInput: AttemptInput = {
  durationMinutes: 42,
  rating: 4,
  fullness: null,
  enjoyment: null,
  notes: 'Needs more salt',
  ingredients: [{ text: '1 cup flour' }, { text: '3 eggs' }],
  instructions: 'Whisk.\nCook.',
  basedOnAttemptId: null,
};

function makeAttempt(overrides: Partial<Attempt> = {}): Attempt {
  return {
    id: 'a1',
    recipeId: 'r1',
    madeAt: '2026-09-24T12:00:00.000Z',
    createdAt: '2026-09-24T12:00:00.000Z',
    updatedAt: '2026-09-24T12:00:00.000Z',
    ...attemptInput,
    tweaked: true,
    hasPhoto: false,
    ...overrides,
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

let fetchMock: jest.SpyInstance;

beforeEach(() => {
  fetchMock = jest.spyOn(globalThis, 'fetch');
});

afterEach(() => {
  fetchMock.mockRestore();
});

function lastCall(): [string, RequestInit] {
  expect(fetchMock).toHaveBeenCalledTimes(1);
  return fetchMock.mock.calls[0] as [string, RequestInit];
}

describe('requests', () => {
  it('fetchRecipes GETs the list with the bearer token and no body', async () => {
    const recipes = [makeRecipe()];
    fetchMock.mockResolvedValue(jsonResponse(200, recipes));

    await expect(fetchRecipes('tok')).resolves.toEqual(recipes);

    const [url, init] = lastCall();
    expect(url).toBe(`${API_BASE_URL}/recipes`);
    expect(init.method).toBe('GET');
    expect(init.headers).toEqual({ Authorization: 'Bearer tok' });
    expect(init.body).toBeUndefined();
    expect(init.credentials).toBe('omit');
  });

  it('fetchRecipe GETs one recipe by id', async () => {
    const recipe = makeRecipe();
    fetchMock.mockResolvedValue(jsonResponse(200, recipe));

    await expect(fetchRecipe('tok', 'r1')).resolves.toEqual(recipe);

    const [url, init] = lastCall();
    expect(url).toBe(`${API_BASE_URL}/recipes/r1`);
    expect(init.method).toBe('GET');
  });

  it('URL-encodes the id', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, makeRecipe()));

    await fetchRecipe('tok', 'a/b?c');

    expect(lastCall()[0]).toBe(`${API_BASE_URL}/recipes/a%2Fb%3Fc`);
  });

  it('createRecipe POSTs the input as JSON', async () => {
    const created = makeRecipe({ id: 'new' });
    fetchMock.mockResolvedValue(jsonResponse(201, created));

    await expect(createRecipe('tok', input)).resolves.toEqual(created);

    const [url, init] = lastCall();
    expect(url).toBe(`${API_BASE_URL}/recipes`);
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      Authorization: 'Bearer tok',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(init.body as string)).toEqual(input);
  });

  it('createRecipe sends forkedFromAttemptId with the input for a fork', async () => {
    const forkedFrom = {
      id: 'r1',
      title: 'Sunday Pancakes',
      attemptId: 'a1',
      madeAt: '2026-09-21T12:00:00.000Z',
    };
    const created = makeRecipe({ id: 'fork', forkedFrom });
    fetchMock.mockResolvedValue(jsonResponse(201, created));

    await expect(
      createRecipe('tok', { ...input, forkedFromAttemptId: 'a1' }),
    ).resolves.toEqual(created);

    expect(JSON.parse(lastCall()[1].body as string)).toEqual({
      ...input,
      forkedFromAttemptId: 'a1',
    });
  });

  it('updateRecipe PATCHes only the given fields', async () => {
    const updated = makeRecipe({ title: 'Renamed' });
    fetchMock.mockResolvedValue(jsonResponse(200, updated));

    await expect(
      updateRecipe('tok', 'r1', { title: 'Renamed', story: null }),
    ).resolves.toEqual(updated);

    const [url, init] = lastCall();
    expect(url).toBe(`${API_BASE_URL}/recipes/r1`);
    expect(init.method).toBe('PATCH');
    expect(init.headers).toMatchObject({
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(init.body as string)).toEqual({
      title: 'Renamed',
      story: null,
    });
  });

  it('deleteRecipe sends DELETE and resolves to undefined on 204', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    await expect(deleteRecipe('tok', 'r1')).resolves.toBeUndefined();

    const [url, init] = lastCall();
    expect(url).toBe(`${API_BASE_URL}/recipes/r1`);
    expect(init.method).toBe('DELETE');
    expect(init.headers).toEqual({ Authorization: 'Bearer tok' });
    expect(init.body).toBeUndefined();
  });

  it("createAttempt POSTs the input as JSON to the recipe's attempts", async () => {
    const created = makeAttempt();
    fetchMock.mockResolvedValue(jsonResponse(201, created));

    await expect(createAttempt('tok', 'r1', attemptInput)).resolves.toEqual(
      created,
    );

    const [url, init] = lastCall();
    expect(url).toBe(`${API_BASE_URL}/recipes/r1/attempts`);
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      Authorization: 'Bearer tok',
      'Content-Type': 'application/json',
    });
    expect(init.credentials).toBe('omit');
    expect(JSON.parse(init.body as string)).toEqual(attemptInput);
  });

  it('createAttempt keeps nulls in the body and URL-encodes the recipe id', async () => {
    const emptyInput: AttemptInput = {
      durationMinutes: null,
      rating: null,
      fullness: null,
      enjoyment: null,
      notes: null,
      ingredients: null,
      instructions: null,
      basedOnAttemptId: null,
    };
    fetchMock.mockResolvedValue(jsonResponse(201, makeAttempt(emptyInput)));

    await createAttempt('tok', 'a/b?c', emptyInput);

    const [url, init] = lastCall();
    expect(url).toBe(`${API_BASE_URL}/recipes/a%2Fb%3Fc/attempts`);
    expect(JSON.parse(init.body as string)).toEqual(emptyInput);
  });

  it('createAttempt sends the enjoyment and the base64 photo in the body', async () => {
    const withPhoto: AttemptInput = {
      ...attemptInput,
      enjoyment: Enjoyment.Loved,
      photo: 'aGVsbG8=',
    };
    fetchMock.mockResolvedValue(
      jsonResponse(
        201,
        makeAttempt({ enjoyment: Enjoyment.Loved, hasPhoto: true }),
      ),
    );

    await expect(createAttempt('tok', 'r1', withPhoto)).resolves.toMatchObject({
      enjoyment: Enjoyment.Loved,
      hasPhoto: true,
    });

    expect(JSON.parse(lastCall()[1].body as string)).toEqual(withPhoto);
  });

  it("fetchAttempts GETs the recipe's attempts with the bearer token and no body", async () => {
    const attempts = [
      makeAttempt({ id: 'a2', madeAt: '2026-09-24T12:00:00.000Z' }),
      makeAttempt({ id: 'a1', madeAt: '2026-09-21T12:00:00.000Z' }),
    ];
    fetchMock.mockResolvedValue(jsonResponse(200, attempts));

    await expect(fetchAttempts('tok', 'r1')).resolves.toEqual(attempts);

    const [url, init] = lastCall();
    expect(url).toBe(`${API_BASE_URL}/recipes/r1/attempts`);
    expect(init.method).toBe('GET');
    expect(init.headers).toEqual({ Authorization: 'Bearer tok' });
    expect(init.body).toBeUndefined();
    expect(init.credentials).toBe('omit');
  });

  it('fetchAttempts resolves to an empty list when there are none', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, []));

    await expect(fetchAttempts('tok', 'r1')).resolves.toEqual([]);
  });

  it('fetchAttempts URL-encodes the recipe id', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, []));

    await fetchAttempts('tok', 'a/b?c');

    expect(lastCall()[0]).toBe(`${API_BASE_URL}/recipes/a%2Fb%3Fc/attempts`);
  });

  it('fetchAttempt GETs one attempt with the bearer token and no body', async () => {
    const detail: AttemptDetail = {
      ...makeAttempt({ id: 'a2', basedOnAttemptId: 'a1' }),
      basedOnAttempt: { id: 'a1', madeAt: '2026-08-15T12:00:00.000Z' },
      fork: null,
    };
    fetchMock.mockResolvedValue(jsonResponse(200, detail));

    await expect(fetchAttempt('tok', 'a2')).resolves.toEqual(detail);

    const [url, init] = lastCall();
    expect(url).toBe(`${API_BASE_URL}/attempts/a2`);
    expect(init.method).toBe('GET');
    expect(init.headers).toEqual({ Authorization: 'Bearer tok' });
    expect(init.body).toBeUndefined();
    expect(init.credentials).toBe('omit');
  });

  it('fetchAttempt URL-encodes the attempt id', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { ...makeAttempt(), basedOnAttempt: null }),
    );

    await fetchAttempt('tok', 'a/b?c');

    expect(lastCall()[0]).toBe(`${API_BASE_URL}/attempts/a%2Fb%3Fc`);
  });

  it('updateAttempt PATCHes only the given fields as JSON', async () => {
    const updated: AttemptDetail = {
      ...makeAttempt({ rating: 5 }),
      basedOnAttempt: null,
      fork: null,
    };
    fetchMock.mockResolvedValue(jsonResponse(200, updated));

    await expect(updateAttempt('tok', 'a1', { rating: 5 })).resolves.toEqual(
      updated,
    );

    const [url, init] = lastCall();
    expect(url).toBe(`${API_BASE_URL}/attempts/a1`);
    expect(init.method).toBe('PATCH');
    expect(init.headers).toEqual({
      Authorization: 'Bearer tok',
      'Content-Type': 'application/json',
    });
    expect(init.credentials).toBe('omit');
    // Omitted fields stay out of the body, so the server leaves them as is.
    expect(init.body).toBe('{"rating":5}');
  });

  it('updateAttempt keeps an explicit null (clear) in the body and URL-encodes the id', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { ...makeAttempt(), basedOnAttempt: null }),
    );

    await updateAttempt('tok', 'a/b?c', { rating: null, notes: null });

    const [url, init] = lastCall();
    expect(url).toBe(`${API_BASE_URL}/attempts/a%2Fb%3Fc`);
    expect(JSON.parse(init.body as string)).toEqual({
      rating: null,
      notes: null,
    });
  });

  it('fetchUnratedAttempt GETs the unrated query with the bearer token and no body', async () => {
    const unrated: UnratedAttempt = {
      ...makeAttempt({ rating: null }),
      recipe: { id: 'r1', title: 'Sunday Pancakes' },
    };
    fetchMock.mockResolvedValue(jsonResponse(200, unrated));

    await expect(fetchUnratedAttempt('tok')).resolves.toEqual(unrated);

    const [url, init] = lastCall();
    expect(url).toBe(`${API_BASE_URL}/attempts?unrated=true`);
    expect(init.method).toBe('GET');
    expect(init.headers).toEqual({ Authorization: 'Bearer tok' });
    expect(init.body).toBeUndefined();
    expect(init.credentials).toBe('omit');
  });

  it('fetchUnratedAttempt resolves to null when there is none', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, null));

    await expect(fetchUnratedAttempt('tok')).resolves.toBeNull();
  });

  it('createRecipe sends importId and importIndex with the input for an imported recipe', async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, makeRecipe({ id: 'imp' })));

    await createRecipe('tok', { ...input, importId: 'i1', importIndex: 0 });

    expect(JSON.parse(lastCall()[1].body as string)).toEqual({
      ...input,
      importId: 'i1',
      importIndex: 0,
    });
  });

  it('only parseImport gives fetch a signal; other requests pass none', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, []));

    await fetchRecipes('tok');

    expect(lastCall()[1].signal).toBeUndefined();
  });
});

describe('photo import', () => {
  const parsed: ParsedImport = {
    importId: 'i1',
    recipes: [
      {
        title: 'Lentil soup',
        ingredients: ['1 cup lentils', '1 onion'],
        instructions: 'Chop.\nBoil.',
      },
    ],
  };

  it('parseImport POSTs the images in order as JSON, with the abort signal', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, parsed));
    const controller = new AbortController();

    await expect(
      parseImport('tok', ['aaa', 'bbb'], controller.signal),
    ).resolves.toEqual(parsed);

    const [url, init] = lastCall();
    expect(url).toBe(`${API_BASE_URL}/imports/parse`);
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      Authorization: 'Bearer tok',
      'Content-Type': 'application/json',
    });
    expect(init.credentials).toBe('omit');
    expect(JSON.parse(init.body as string)).toEqual({ images: ['aaa', 'bbb'] });
    expect(init.signal).toBe(controller.signal);
  });

  it('parseImport resolves an empty recipes list as is (no recipe found)', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { importId: 'i2', recipes: [] }),
    );

    await expect(parseImport('tok', ['aaa'])).resolves.toEqual({
      importId: 'i2',
      recipes: [],
    });
  });

  it("parseImport rejects with the server's error on 502", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(502, { error: "Couldn't read the photos", importId: 'i3' }),
    );

    const error = await parseImport('tok', ['aaa']).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RecipesError);
    expect((error as RecipesError).message).toBe("Couldn't read the photos");
    expect((error as RecipesError).status).toBe(502);
  });

  it('parseImport passes an abort through as a rejection', async () => {
    const abort = new Error('Aborted');
    abort.name = 'AbortError';
    fetchMock.mockRejectedValue(abort);

    await expect(parseImport('tok', ['aaa'])).rejects.toBe(abort);
  });

  it.each([
    ['a skip', { reviewedCount: 2 }],
    ['a stop', { closed: true as const }],
  ])('updateImport PATCHes %s as JSON', async (_label, update) => {
    const state: ImportState = {
      id: 'i1',
      status: ImportStatus.Done,
      reviewedCount: 2,
      closedAt: null,
    };
    fetchMock.mockResolvedValue(jsonResponse(200, state));

    await expect(updateImport('tok', 'i1', update)).resolves.toEqual(state);

    const [url, init] = lastCall();
    expect(url).toBe(`${API_BASE_URL}/imports/i1`);
    expect(init.method).toBe('PATCH');
    expect(init.headers).toEqual({
      Authorization: 'Bearer tok',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(init.body as string)).toEqual(update);
  });

  it('updateImport URL-encodes the id', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, {}));

    await updateImport('tok', 'a/b?c', { closed: true });

    expect(lastCall()[0]).toBe(`${API_BASE_URL}/imports/a%2Fb%3Fc`);
  });

  it('updateImport carries a 404 for a missing import', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(404, { error: 'Import not found' }),
    );

    const error = await updateImport('tok', 'gone', { reviewedCount: 1 }).catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(RecipesError);
    expect((error as RecipesError).message).toBe('Import not found');
    expect((error as RecipesError).status).toBe(404);
  });
});

describe('errors', () => {
  async function rejection(promise: Promise<unknown>): Promise<RecipesError> {
    const error = await promise.then(
      () => {
        throw new Error('expected the request to fail');
      },
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(RecipesError);
    return error as RecipesError;
  }

  it("uses the server's error field and keeps the status", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(400, { error: 'imageUrl must be an http(s) URL' }),
    );

    const error = await rejection(createRecipe('tok', input));
    expect(error.message).toBe('imageUrl must be an http(s) URL');
    expect(error.status).toBe(400);
  });

  it('prefers a message field over error', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(401, { message: 'Unauthorized', error: 'other' }),
    );

    const error = await rejection(fetchRecipes('tok'));
    expect(error.message).toBe('Unauthorized');
    expect(error.status).toBe(401);
  });

  it('carries a 404 status for a missing recipe', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(404, { error: 'Recipe not found' }),
    );

    const error = await rejection(fetchRecipe('tok', 'gone'));
    expect(error.message).toBe('Recipe not found');
    expect(error.status).toBe(404);
  });

  it('fetchAttempt carries a 404 status for a missing attempt', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(404, { error: 'Attempt not found' }),
    );

    const error = await rejection(fetchAttempt('tok', 'gone'));
    expect(error.message).toBe('Attempt not found');
    expect(error.status).toBe(404);
  });

  it('falls back to a generic message when the body is not JSON', async () => {
    fetchMock.mockResolvedValue(
      new Response('<html>oops</html>', { status: 500 }),
    );

    const error = await rejection(deleteRecipe('tok', 'r1'));
    expect(error.message).toBe('Request failed (500)');
    expect(error.status).toBe(500);
  });

  it('falls back to a generic message when the JSON has no message', async () => {
    fetchMock.mockResolvedValue(jsonResponse(502, {}));

    const error = await rejection(updateRecipe('tok', 'r1', { title: 'x' }));
    expect(error.message).toBe('Request failed (502)');
    expect(error.status).toBe(502);
  });

  it('createAttempt throws a RecipesError with the status on failure', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(400, { error: 'rating must be an integer from 1 to 5' }),
    );

    const error = await rejection(createAttempt('tok', 'r1', attemptInput));
    expect(error.message).toBe('rating must be an integer from 1 to 5');
    expect(error.status).toBe(400);
  });

  it('createAttempt carries a 404 for a missing recipe', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(404, { error: 'Recipe not found' }),
    );

    const error = await rejection(createAttempt('tok', 'gone', attemptInput));
    expect(error.message).toBe('Recipe not found');
    expect(error.status).toBe(404);
  });

  it('fetchAttempts carries a 404 for a missing recipe', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(404, { error: 'Recipe not found' }),
    );

    const error = await rejection(fetchAttempts('tok', 'gone'));
    expect(error.message).toBe('Recipe not found');
    expect(error.status).toBe(404);
  });

  it('fetchAttempts throws a RecipesError on 401', async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { error: 'Unauthorized' }));

    const error = await rejection(fetchAttempts('expired', 'r1'));
    expect(error.message).toBe('Unauthorized');
    expect(error.status).toBe(401);
  });

  it('updateAttempt throws a RecipesError with the server message on 400', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(400, {
        error: 'rating: Too big: expected number to be <=5',
      }),
    );

    const error = await rejection(updateAttempt('tok', 'a1', { rating: 6 }));
    expect(error.message).toBe('rating: Too big: expected number to be <=5');
    expect(error.status).toBe(400);
  });

  it('updateAttempt carries a 404 for a missing attempt', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(404, { error: 'Attempt not found' }),
    );

    const error = await rejection(updateAttempt('tok', 'gone', { rating: 3 }));
    expect(error.message).toBe('Attempt not found');
    expect(error.status).toBe(404);
  });

  it('fetchUnratedAttempt throws a RecipesError on 401', async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { error: 'Unauthorized' }));

    const error = await rejection(fetchUnratedAttempt('expired'));
    expect(error.message).toBe('Unauthorized');
    expect(error.status).toBe(401);
  });

  it('lets network failures propagate as-is', async () => {
    fetchMock.mockRejectedValue(new TypeError('Network request failed'));

    await expect(fetchRecipes('tok')).rejects.toThrow('Network request failed');
  });
});

describe('fetchIngredients', () => {
  const avocado: IngredientSummary = {
    id: 'i1',
    name: 'Avocado',
    mainGroup: FoodGroup.HealthyFat,
    nutrients: [FoodGroup.HealthyFat, FoodGroup.Fiber],
  };

  it('GETs /ingredients with no query string when no filter is set', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, [avocado]));

    await expect(fetchIngredients('tok')).resolves.toEqual([avocado]);

    const [url, init] = lastCall();
    expect(url).toBe(`${API_BASE_URL}/ingredients`);
    expect(init.method).toBe('GET');
    expect(init.headers).toEqual({ Authorization: 'Bearer tok' });
  });

  it('leaves out an empty q', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, []));

    await fetchIngredients('tok', { q: '' });

    expect(lastCall()[0]).toBe(`${API_BASE_URL}/ingredients`);
  });

  it('sends only q when there is no group', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, []));

    await fetchIngredients('tok', { q: 'avo' });

    expect(lastCall()[0]).toBe(`${API_BASE_URL}/ingredients?q=avo`);
  });

  it('sends only group when there is no q', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, []));

    await fetchIngredients('tok', { group: FoodGroup.HealthyFat });

    expect(lastCall()[0]).toBe(`${API_BASE_URL}/ingredients?group=HEALTHY_FAT`);
  });

  it('sends q and group joined with &', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, []));

    await fetchIngredients('tok', { q: 'nut', group: FoodGroup.Protein });

    expect(lastCall()[0]).toBe(
      `${API_BASE_URL}/ingredients?q=nut&group=PROTEIN`,
    );
  });

  it('URI-encodes q, including spaces, & and Turkish letters', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, []));

    await fetchIngredients('tok', { q: 'süt & bal' });

    expect(lastCall()[0]).toBe(
      `${API_BASE_URL}/ingredients?q=s%C3%BCt%20%26%20bal`,
    );
  });

  it('throws a RecipesError with the server message on 400', async () => {
    fetchMock.mockResolvedValue(jsonResponse(400, { error: 'Invalid group' }));

    const error = await fetchIngredients('tok').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RecipesError);
    expect((error as RecipesError).message).toBe('Invalid group');
    expect((error as RecipesError).status).toBe(400);
  });
});

describe('fetchIngredient', () => {
  const egg: IngredientDetail = {
    id: 'i-egg',
    name: 'Egg',
    mainGroup: FoodGroup.Protein,
    nutrients: [FoodGroup.Protein],
    description: null,
    fdcId: 748967,
    recipes: [{ id: 'r1', title: 'Shakshuka' }],
  };

  it('GETs /ingredients/:id with the token and returns the entry', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, egg));

    await expect(fetchIngredient('tok', 'i-egg')).resolves.toEqual(egg);

    const [url, init] = lastCall();
    expect(url).toBe(`${API_BASE_URL}/ingredients/i-egg`);
    expect(init.method).toBe('GET');
    expect(init.headers).toEqual({ Authorization: 'Bearer tok' });
  });

  it('URI-encodes the id', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, egg));

    await fetchIngredient('tok', 'a/b c');

    expect(lastCall()[0]).toBe(`${API_BASE_URL}/ingredients/a%2Fb%20c`);
  });

  it('throws a RecipesError with the server message on 404', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(404, { error: 'Ingredient not found' }),
    );

    const error = await fetchIngredient('tok', 'nope').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RecipesError);
    expect((error as RecipesError).message).toBe('Ingredient not found');
    expect((error as RecipesError).status).toBe(404);
  });
});

describe('usdaFoodUrl', () => {
  it("links to the food's FoodData Central page", () => {
    expect(usdaFoodUrl(748967)).toBe(
      'https://fdc.nal.usda.gov/food-details/748967',
    );
  });
});

describe('meals', () => {
  function makeMeal(overrides: Partial<Meal> = {}): Meal {
    return {
      id: 'm1',
      kind: MealKind.Meal,
      eatenAt: '2026-09-29T12:00:00.000Z',
      text: 'lentil soup, bread',
      nutrients: [FoodGroup.Protein, FoodGroup.Fiber],
      fullness: Fullness.Satisfied,
      hasPhoto: false,
      createdAt: '2026-09-29T12:00:00.000Z',
      updatedAt: '2026-09-29T12:00:00.000Z',
      ...overrides,
    };
  }

  it('createMeal POSTs the input as JSON with the token and returns the meal', async () => {
    const mealInput: MealInput = {
      kind: MealKind.Snack,
      text: 'an apple',
      fullness: Fullness.StillHungry,
      photo: 'base64-photo',
      eatenAt: '2026-09-28T12:00:00.000Z',
    };
    const created = makeMeal({ kind: MealKind.Snack, hasPhoto: true });
    fetchMock.mockResolvedValue(jsonResponse(201, created));

    await expect(createMeal('tok', mealInput)).resolves.toEqual(created);

    const [url, init] = lastCall();
    expect(url).toBe(`${API_BASE_URL}/meals`);
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      Authorization: 'Bearer tok',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(init.body as string)).toEqual(mealInput);
  });

  it('createMeal keeps explicit nulls in the body', async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, makeMeal()));

    await createMeal('tok', {
      kind: MealKind.Meal,
      text: null,
      fullness: null,
      photo: 'p',
    });

    expect(JSON.parse(lastCall()[1].body as string)).toEqual({
      kind: 'MEAL',
      text: null,
      fullness: null,
      photo: 'p',
    });
  });

  it('createMeal throws a RecipesError with the server message on 400', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(400, { error: 'A meal needs a photo or text' }),
    );

    const error = await createMeal('tok', { kind: MealKind.Meal }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(RecipesError);
    expect((error as RecipesError).message).toBe(
      'A meal needs a photo or text',
    );
    expect((error as RecipesError).status).toBe(400);
  });

  it('fetchRecentSnacks GETs /meals/recent-snacks with the token and no body', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, ['an apple', 'nuts']));

    await expect(fetchRecentSnacks('tok')).resolves.toEqual([
      'an apple',
      'nuts',
    ]);

    const [url, init] = lastCall();
    expect(url).toBe(`${API_BASE_URL}/meals/recent-snacks`);
    expect(init.method).toBe('GET');
    expect(init.headers).toEqual({ Authorization: 'Bearer tok' });
    expect(init.body).toBeUndefined();
  });

  it('fetchRecentSnacks throws a RecipesError on 401', async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { error: 'Unauthorized' }));

    const error = await fetchRecentSnacks('tok').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RecipesError);
    expect((error as RecipesError).status).toBe(401);
  });

  it('updateMeal PATCHes only the given fields to that meal and returns it', async () => {
    const updated = makeMeal({ fullness: Fullness.VeryFull });
    fetchMock.mockResolvedValue(jsonResponse(200, updated));

    await expect(
      updateMeal('tok', 'm1', { fullness: Fullness.VeryFull }),
    ).resolves.toEqual(updated);

    const [url, init] = lastCall();
    expect(url).toBe(`${API_BASE_URL}/meals/m1`);
    expect(init.method).toBe('PATCH');
    expect(init.headers).toEqual({
      Authorization: 'Bearer tok',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(init.body as string)).toEqual({ fullness: 'VERY_FULL' });
  });

  it('updateMeal keeps an explicit null and URI-encodes the id', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, makeMeal()));

    await updateMeal('tok', 'a/b c', { fullness: null, text: null });

    const [url, init] = lastCall();
    expect(url).toBe(`${API_BASE_URL}/meals/a%2Fb%20c`);
    expect(JSON.parse(init.body as string)).toEqual({
      fullness: null,
      text: null,
    });
  });

  it("updateMeal throws a RecipesError with the server message on 404 (another user's meal)", async () => {
    fetchMock.mockResolvedValue(jsonResponse(404, { error: 'Meal not found' }));

    const error = await updateMeal('tok', 'm1', {
      fullness: Fullness.Satisfied,
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RecipesError);
    expect((error as RecipesError).message).toBe('Meal not found');
    expect((error as RecipesError).status).toBe(404);
  });

  it('deleteMeal DELETEs that meal with the token and no body, resolving on 204', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    await expect(deleteMeal('tok', 'a/b c')).resolves.toBeUndefined();

    const [url, init] = lastCall();
    expect(url).toBe(`${API_BASE_URL}/meals/a%2Fb%20c`);
    expect(init.method).toBe('DELETE');
    expect(init.headers).toEqual({ Authorization: 'Bearer tok' });
    expect(init.body).toBeUndefined();
  });

  it('deleteMeal throws a RecipesError with the server message on 404', async () => {
    fetchMock.mockResolvedValue(jsonResponse(404, { error: 'Meal not found' }));

    const error = await deleteMeal('tok', 'm1').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RecipesError);
    expect((error as RecipesError).message).toBe('Meal not found');
    expect((error as RecipesError).status).toBe(404);
  });

  it('mealPhotoUrl points at the photo route with the id URI-encoded', () => {
    expect(mealPhotoUrl('m1')).toBe(`${API_BASE_URL}/meals/m1/photo`);
    expect(mealPhotoUrl('a/b c')).toBe(`${API_BASE_URL}/meals/a%2Fb%20c/photo`);
  });

  it('attemptPhotoUrl points at the attempt photo route with the id URI-encoded', () => {
    expect(attemptPhotoUrl('a1')).toBe(`${API_BASE_URL}/attempts/a1/photo`);
    expect(attemptPhotoUrl('a/b c')).toBe(
      `${API_BASE_URL}/attempts/a%2Fb%20c/photo`,
    );
  });
});

describe('fetchWeek', () => {
  const week: Week = {
    meals: [],
    attempts: [
      {
        id: 'a1',
        recipeId: 'r1',
        madeAt: '2026-09-30T12:00:00.000Z',
        rating: null,
        fullness: null,
        hasPhoto: false,
        recipe: { id: 'r1', title: 'Shakshuka', imageUrl: null },
        nutrients: [FoodGroup.Protein],
      },
    ],
  };

  it('GETs /week with both bounds as encoded ISO instants and the token', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, week));

    await expect(
      fetchWeek(
        'tok',
        new Date('2026-09-27T21:00:00.000Z'),
        new Date('2026-10-04T21:00:00.000Z'),
      ),
    ).resolves.toEqual(week);

    const [url, init] = lastCall();
    expect(url).toBe(
      `${API_BASE_URL}/week?from=2026-09-27T21%3A00%3A00.000Z&to=2026-10-04T21%3A00%3A00.000Z`,
    );
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
    expect(init.headers).toEqual({ Authorization: 'Bearer tok' });
  });

  it('throws a RecipesError with the server message on 400', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(400, { error: 'from must be before to' }),
    );

    const error = await fetchWeek('tok', new Date(), new Date()).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(RecipesError);
    expect((error as RecipesError).status).toBe(400);
    expect((error as RecipesError).message).toBe('from must be before to');
  });
});
