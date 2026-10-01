import React from 'react';
import { usePreventRemove } from '@react-navigation/native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { act, render, screen, userEvent } from '@testing-library/react-native';
import { Alert, AlertButton } from 'react-native';
import {
  AttemptDetail,
  ImportState,
  Recipe,
  updateImport,
  ImportStatus,
} from '../api/recipesClient';
import { useAuth } from '../auth/AuthContext';
import { useAttempt } from '../hooks/useAttempts';
import {
  useCreateRecipe,
  useRecipe,
  useUpdateRecipe,
} from '../hooks/useRecipes';
import { AppStackParamList, ImportQueue, Screens } from '../navigation/types';
import RecipeFormScreen from './RecipeFormScreen';

jest.mock('../hooks/useRecipes', () => ({
  useCreateRecipe: jest.fn(),
  useUpdateRecipe: jest.fn(),
  useRecipe: jest.fn(),
}));
jest.mock('../hooks/useAttempts', () => ({ useAttempt: jest.fn() }));
jest.mock('../auth/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('../api/recipesClient', () => ({
  ...jest.requireActual('../api/recipesClient'),
  updateImport: jest.fn(),
}));
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  // Needs a real navigator; tests read its arguments from the mock instead.
  usePreventRemove: jest.fn(),
}));

type Props = NativeStackScreenProps<AppStackParamList, Screens.RecipeForm>;

const mockedUseCreateRecipe = jest.mocked(useCreateRecipe);
const mockedUseUpdateRecipe = jest.mocked(useUpdateRecipe);
const mockedUseRecipe = jest.mocked(useRecipe);
const mockedUseAttempt = jest.mocked(useAttempt);
const mockedUseAuth = jest.mocked(useAuth);
const mockedUpdateImport = jest.mocked(updateImport);
const mockedUsePreventRemove = jest.mocked(usePreventRemove);

function makeRecipe(overrides: Partial<Recipe> = {}): Recipe {
  return {
    id: 'r1',
    title: 'Sunday Pancakes',
    ingredients: ['1 cup flour', '1 egg'],
    instructions: 'Whisk.\nCook.',
    story: 'Grandma made these.',
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

function makeNavigation() {
  return {
    setOptions: jest.fn(),
    replace: jest.fn(),
    goBack: jest.fn(),
    navigate: jest.fn(),
    dispatch: jest.fn(),
    popToTop: jest.fn(),
  };
}

async function renderScreen(params: Props['route']['params']) {
  const navigation = makeNavigation();
  const route = { key: 'RecipeForm-1', name: Screens.RecipeForm, params };
  await render(
    <RecipeFormScreen
      navigation={navigation as unknown as Props['navigation']}
      route={route as Props['route']}
    />,
  );
  return navigation;
}

// The hooks return full React Query results; the screen only reads these.
type MutationResult = ReturnType<typeof useCreateRecipe> &
  ReturnType<typeof useUpdateRecipe>;

function mockMutation(
  hook: { mockReturnValue: (value: MutationResult) => unknown },
  { mutateAsync = jest.fn(), error = null as Error | null } = {},
) {
  hook.mockReturnValue({ mutateAsync, error } as unknown as MutationResult);
  return mutateAsync;
}

beforeEach(() => {
  jest.resetAllMocks();
});

describe('RecipeFormScreen, create mode', () => {
  it('titles the screen "New recipe"', async () => {
    mockMutation(mockedUseCreateRecipe);
    const navigation = await renderScreen(undefined);

    expect(navigation.setOptions).toHaveBeenCalledWith({ title: 'New recipe' });
  });

  it('shows the required-field errors when submitted empty and does not save', async () => {
    const user = userEvent.setup();
    const mutateAsync = mockMutation(mockedUseCreateRecipe);
    await renderScreen(undefined);

    await user.press(screen.getByText('Save recipe'));

    expect(await screen.findByText('Title is required')).toBeOnTheScreen();
    expect(screen.getByText('Add at least one ingredient')).toBeOnTheScreen();
    expect(screen.getByText('Add at least one step')).toBeOnTheScreen();
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('shows format errors for the optional fields', async () => {
    const user = userEvent.setup();
    const mutateAsync = mockMutation(mockedUseCreateRecipe);
    await renderScreen(undefined);

    await user.type(screen.getByTestId('recipe-form-image-url-input'), 'nope');
    await user.type(screen.getByTestId('recipe-form-prep-input'), '1.5');
    await user.type(screen.getByTestId('recipe-form-servings-input'), 'x');
    await user.press(screen.getByText('Save recipe'));

    expect(
      await screen.findByText('Enter a link starting with http:// or https://'),
    ).toBeOnTheScreen();
    expect(
      screen.getByText('Prep time must be a whole number'),
    ).toBeOnTheScreen();
    expect(
      screen.getByText('Servings must be a whole number'),
    ).toBeOnTheScreen();
    expect(
      screen.queryByText('Cook time must be a whole number'),
    ).not.toBeOnTheScreen();
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('creates the recipe from the converted input and opens it', async () => {
    const user = userEvent.setup();
    const mutateAsync = mockMutation(mockedUseCreateRecipe, {
      mutateAsync: jest.fn().mockResolvedValue(makeRecipe({ id: 'new-id' })),
    });
    const navigation = await renderScreen(undefined);

    await user.type(
      screen.getByPlaceholderText("Grandma's Sunday pancakes"),
      '  Pancakes ',
    );
    await user.type(screen.getByTestId('recipe-form-cook-input'), '15');
    await user.paste(
      screen.getByTestId('recipe-form-ingredients-input'),
      'flour\n\n  eggs  \n',
    );
    await user.paste(
      screen.getByTestId('recipe-form-instructions-input'),
      'Mix.\n\nCook.',
    );
    await user.press(screen.getByText('Save recipe'));

    expect(mutateAsync).toHaveBeenCalledWith({
      title: 'Pancakes',
      story: null,
      source: null,
      imageUrl: null,
      prepMinutes: null,
      cookMinutes: 15,
      servings: null,
      ingredients: ['flour', 'eggs'],
      instructions: 'Mix.\nCook.',
    });
    // The stack becomes [list, new recipe]: the form and New recipe go.
    expect(navigation.dispatch).toHaveBeenCalledTimes(1);
    const [build] = navigation.dispatch.mock.calls[0];
    const list = { key: 'recipes-key', name: Screens.Recipes };
    const action = build({
      routes: [
        list,
        { key: 'import-key', name: Screens.Import },
        { key: 'form-key', name: Screens.RecipeForm },
      ],
      index: 2,
    });
    expect(action).toMatchObject({
      type: 'RESET',
      payload: {
        index: 1,
        routes: [
          list,
          { name: Screens.RecipeDetail, params: { recipeId: 'new-id' } },
        ],
      },
    });
  });

  it('shows the section hint under Ingredients and Instructions', async () => {
    mockMutation(mockedUseCreateRecipe);
    await renderScreen(undefined);

    const hint = 'Start a line with # for a section, e.g. # For the cream';
    expect(
      screen.getByTestId('recipe-form-ingredients-hint'),
    ).toHaveTextContent(hint);
    expect(
      screen.getByTestId('recipe-form-instructions-hint'),
    ).toHaveTextContent(hint);
  });

  it('asks for more than headings in ingredients and steps', async () => {
    const user = userEvent.setup();
    const mutateAsync = mockMutation(mockedUseCreateRecipe);
    await renderScreen(undefined);

    await user.type(screen.getByTestId('recipe-form-title-input'), 'Cake');
    await user.paste(
      screen.getByTestId('recipe-form-ingredients-input'),
      '# For the cake\n# For the cream',
    );
    await user.paste(
      screen.getByTestId('recipe-form-instructions-input'),
      '# For the cake',
    );
    await user.press(screen.getByText('Save recipe'));

    expect(
      await screen.findByText('Add at least one ingredient, not just headings'),
    ).toBeOnTheScreen();
    expect(
      screen.getByText('Add at least one step, not just headings'),
    ).toBeOnTheScreen();
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('saves headings as ordinary lines, in place', async () => {
    const user = userEvent.setup();
    const mutateAsync = mockMutation(mockedUseCreateRecipe, {
      mutateAsync: jest.fn().mockResolvedValue(makeRecipe({ id: 'new-id' })),
    });
    await renderScreen(undefined);

    await user.type(screen.getByTestId('recipe-form-title-input'), 'Cake');
    await user.paste(
      screen.getByTestId('recipe-form-ingredients-input'),
      '# For the cake\nflour\n# For the cream\ncream',
    );
    await user.paste(
      screen.getByTestId('recipe-form-instructions-input'),
      '# For the cake\nBake.\n# For the cream\nWhip.',
    );
    await user.press(screen.getByText('Save recipe'));

    expect(mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        ingredients: ['# For the cake', 'flour', '# For the cream', 'cream'],
        instructions: '# For the cake\nBake.\n# For the cream\nWhip.',
      }),
    );
  });

  it('saves the trimmed source', async () => {
    const user = userEvent.setup();
    const mutateAsync = mockMutation(mockedUseCreateRecipe, {
      mutateAsync: jest.fn().mockResolvedValue(makeRecipe({ id: 'new-id' })),
    });
    await renderScreen(undefined);

    await user.type(screen.getByTestId('recipe-form-title-input'), 'Cake');
    await user.type(
      screen.getByPlaceholderText('@account, Mom, a cookbook…'),
      '  @someone ',
    );
    await user.paste(screen.getByTestId('recipe-form-ingredients-input'), 'a');
    await user.paste(screen.getByTestId('recipe-form-instructions-input'), 'b');
    await user.press(screen.getByText('Save recipe'));

    expect(mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ source: '@someone' }),
    );
  });

  it('rejects a source over 100 characters', async () => {
    const user = userEvent.setup();
    const mutateAsync = mockMutation(mockedUseCreateRecipe);
    await renderScreen(undefined);

    await user.type(screen.getByTestId('recipe-form-title-input'), 'Cake');
    await user.paste(
      screen.getByTestId('recipe-form-source-input'),
      'a'.repeat(101),
    );
    await user.paste(screen.getByTestId('recipe-form-ingredients-input'), 'a');
    await user.paste(screen.getByTestId('recipe-form-instructions-input'), 'b');
    await user.press(screen.getByText('Save recipe'));

    expect(
      await screen.findByTestId('recipe-form-source-error-text'),
    ).toHaveTextContent('Keep it under 100 characters');
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('shows the server error and stays on the form when saving fails', async () => {
    const user = userEvent.setup();
    const mutateAsync = mockMutation(mockedUseCreateRecipe, {
      mutateAsync: jest.fn().mockRejectedValue(new Error('Server said no')),
      error: new Error('Server said no'),
    });
    const navigation = await renderScreen(undefined);

    expect(screen.getByText('Server said no')).toBeOnTheScreen();

    await user.type(
      screen.getByPlaceholderText("Grandma's Sunday pancakes"),
      'Pancakes',
    );
    await user.paste(screen.getByTestId('recipe-form-ingredients-input'), 'a');
    await user.paste(screen.getByTestId('recipe-form-instructions-input'), 'b');
    await user.press(screen.getByText('Save recipe'));

    expect(mutateAsync).toHaveBeenCalledTimes(1);
    expect(navigation.replace).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue('Pancakes')).toBeOnTheScreen();
  });
});

describe('RecipeFormScreen, edit mode', () => {
  it('prefills the form and saves changes through the update mutation', async () => {
    const user = userEvent.setup();
    const recipe = makeRecipe({ source: 'Mom' });
    mockedUseRecipe.mockReturnValue({
      data: recipe,
      isPending: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof useRecipe>);
    const mutateAsync = mockMutation(mockedUseUpdateRecipe, {
      mutateAsync: jest.fn().mockResolvedValue(recipe),
    });
    const navigation = await renderScreen({ recipeId: 'r1' });

    expect(navigation.setOptions).toHaveBeenCalledWith({
      title: 'Edit recipe',
    });
    expect(mockedUseRecipe).toHaveBeenCalledWith('r1');
    expect(mockedUseUpdateRecipe).toHaveBeenCalledWith('r1');
    const title = screen.getByDisplayValue('Sunday Pancakes');
    expect(screen.getByTestId('recipe-form-source-input')).toHaveDisplayValue(
      'Mom',
    );

    await user.clear(title);
    await user.type(title, 'Renamed');
    await user.press(screen.getByText('Save changes'));

    expect(mutateAsync).toHaveBeenCalledWith({
      title: 'Renamed',
      story: 'Grandma made these.',
      source: 'Mom',
      imageUrl: null,
      prepMinutes: 5,
      cookMinutes: 20,
      servings: 4,
      ingredients: ['1 cup flour', '1 egg'],
      instructions: 'Whisk.\nCook.',
    });
    expect(navigation.goBack).toHaveBeenCalled();
  });

  it('clears the source when it is emptied', async () => {
    const user = userEvent.setup();
    const recipe = makeRecipe({ source: 'Mom' });
    mockedUseRecipe.mockReturnValue({
      data: recipe,
      isPending: false,
      isError: false,
      error: null,
    } as unknown as ReturnType<typeof useRecipe>);
    const mutateAsync = mockMutation(mockedUseUpdateRecipe, {
      mutateAsync: jest.fn().mockResolvedValue(recipe),
    });
    await renderScreen({ recipeId: 'r1' });

    await user.clear(screen.getByTestId('recipe-form-source-input'));
    await user.press(screen.getByText('Save changes'));

    expect(mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ source: null }),
    );
  });

  it('shows the load error instead of the form', async () => {
    mockedUseRecipe.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      error: new Error('Recipe not found'),
    } as unknown as ReturnType<typeof useRecipe>);
    await renderScreen({ recipeId: 'r1' });

    expect(screen.getByText('Recipe not found')).toBeOnTheScreen();
    expect(screen.queryByText('Save changes')).not.toBeOnTheScreen();
  });
});

describe('RecipeFormScreen, save as new recipe', () => {
  const forkFrom = { recipeId: 'r1', attemptId: 'a1' };

  // The attempt cooked 2 eggs instead of 1 and added a resting step.
  function makeAttemptDetail(
    overrides: Partial<AttemptDetail> = {},
  ): AttemptDetail {
    return {
      id: 'a1',
      recipeId: 'r1',
      durationMinutes: 30,
      madeAt: '2026-09-21T12:00:00.000Z',
      rating: 4,
      fullness: null,
      enjoyment: null,
      hasPhoto: false,
      notes: null,
      ingredients: [{ text: '1 cup flour' }, { text: '2 eggs' }],
      instructions: 'Whisk.\nRest.\nCook.',
      basedOnAttemptId: null,
      tweaked: true,
      basedOnAttempt: null,
      fork: null,
      createdAt: '2026-09-21T12:00:00.000Z',
      updatedAt: '2026-09-21T12:00:00.000Z',
      ...overrides,
    };
  }

  type QueryState<T> = { data?: T; isPending?: boolean; error?: Error | null };
  const asQuery = <T,>({
    data,
    isPending = false,
    error = null,
  }: QueryState<T>) => ({ data, isPending, isError: error !== null, error });

  function mockForkQueries({
    recipe = {
      data: makeRecipe({
        imageUrl: 'https://example.com/p.jpg',
        source: '@pancakelab',
      }),
    },
    attempt = { data: makeAttemptDetail() },
  }: {
    recipe?: QueryState<Recipe>;
    attempt?: QueryState<AttemptDetail>;
  } = {}) {
    mockedUseRecipe.mockReturnValue(
      asQuery(recipe) as unknown as ReturnType<typeof useRecipe>,
    );
    mockedUseAttempt.mockReturnValue(
      asQuery(attempt) as unknown as ReturnType<typeof useAttempt>,
    );
  }

  it("prefills that version's lines with the recipe's times, servings, photo and source, leaving title and story empty", async () => {
    mockForkQueries();
    mockMutation(mockedUseCreateRecipe);
    const navigation = await renderScreen({ forkFrom });

    expect(navigation.setOptions).toHaveBeenCalledWith({
      title: 'Save as new recipe',
    });
    expect(mockedUseRecipe).toHaveBeenCalledWith('r1');
    expect(mockedUseAttempt).toHaveBeenCalledWith('a1');
    expect(
      screen.getByPlaceholderText('Sunday Pancakes — my version'),
    ).toHaveDisplayValue('');
    expect(screen.getByTestId('recipe-form-story-input')).toHaveDisplayValue(
      '',
    );
    expect(
      screen.getByTestId('recipe-form-ingredients-input'),
    ).toHaveDisplayValue('1 cup flour\n2 eggs');
    expect(
      screen.getByTestId('recipe-form-instructions-input'),
    ).toHaveDisplayValue('Whisk.\nRest.\nCook.');
    expect(
      screen.getByTestId('recipe-form-image-url-input'),
    ).toHaveDisplayValue('https://example.com/p.jpg');
    expect(screen.getByTestId('recipe-form-prep-input')).toHaveDisplayValue(
      '5',
    );
    expect(screen.getByTestId('recipe-form-cook-input')).toHaveDisplayValue(
      '20',
    );
    expect(screen.getByTestId('recipe-form-servings-input')).toHaveDisplayValue(
      '4',
    );
    expect(screen.getByTestId('recipe-form-source-input')).toHaveDisplayValue(
      '@pancakelab',
    );
  });

  it('requires a title before saving', async () => {
    const user = userEvent.setup();
    mockForkQueries();
    const mutateAsync = mockMutation(mockedUseCreateRecipe);
    await renderScreen({ forkFrom });

    await user.press(screen.getByText('Save recipe'));

    expect(await screen.findByText('Title is required')).toBeOnTheScreen();
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('saves with forkedFromAttemptId and replaces the form with the new recipe', async () => {
    const user = userEvent.setup();
    mockForkQueries();
    const mutateAsync = mockMutation(mockedUseCreateRecipe, {
      mutateAsync: jest.fn().mockResolvedValue(makeRecipe({ id: 'fork-id' })),
    });
    const navigation = await renderScreen({ forkFrom });

    await user.type(
      screen.getByPlaceholderText('Sunday Pancakes — my version'),
      'Fluffy Pancakes',
    );
    await user.press(screen.getByText('Save recipe'));

    expect(mutateAsync).toHaveBeenCalledTimes(1);
    expect(mutateAsync).toHaveBeenCalledWith({
      title: 'Fluffy Pancakes',
      story: null,
      source: '@pancakelab',
      imageUrl: 'https://example.com/p.jpg',
      prepMinutes: 5,
      cookMinutes: 20,
      servings: 4,
      ingredients: ['1 cup flour', '2 eggs'],
      instructions: 'Whisk.\nRest.\nCook.',
      forkedFromAttemptId: 'a1',
    });
    expect(navigation.replace).toHaveBeenCalledWith(Screens.RecipeDetail, {
      recipeId: 'fork-id',
    });
    expect(mockedUseUpdateRecipe).not.toHaveBeenCalled();
  });

  it('shows the server error (e.g. already saved) and stays on the form', async () => {
    const user = userEvent.setup();
    mockForkQueries();
    const mutateAsync = mockMutation(mockedUseCreateRecipe, {
      mutateAsync: jest
        .fn()
        .mockRejectedValue(
          new Error('This attempt was already saved as a recipe'),
        ),
      error: new Error('This attempt was already saved as a recipe'),
    });
    const navigation = await renderScreen({ forkFrom });

    await user.type(
      screen.getByPlaceholderText('Sunday Pancakes — my version'),
      'Fluffy Pancakes',
    );
    await user.press(screen.getByText('Save recipe'));

    expect(mutateAsync).toHaveBeenCalledTimes(1);
    expect(
      screen.getByText('This attempt was already saved as a recipe'),
    ).toBeOnTheScreen();
    expect(navigation.replace).not.toHaveBeenCalled();
  });

  it.each([
    ['the recipe', { recipe: { isPending: true } }],
    ['the attempt', { attempt: { isPending: true } }],
  ])('shows no form while %s loads', async (_label, state) => {
    mockForkQueries(state);
    mockMutation(mockedUseCreateRecipe);
    await renderScreen({ forkFrom });

    expect(screen.queryByText('Save recipe')).not.toBeOnTheScreen();
  });

  it.each([
    ['the recipe', { recipe: { error: new Error('Recipe not found') } }],
    ['the attempt', { attempt: { error: new Error('Attempt not found') } }],
  ])(
    'shows the load error of %s instead of the form',
    async (_label, state) => {
      mockForkQueries(state);
      mockMutation(mockedUseCreateRecipe);
      await renderScreen({ forkFrom });

      expect(screen.getByText(/not found$/)).toBeOnTheScreen();
      expect(screen.queryByText('Save recipe')).not.toBeOnTheScreen();
    },
  );
});

describe('RecipeFormScreen, from a photo import', () => {
  const recipes: ImportQueue['recipes'] = [
    {
      title: 'Dough',
      source: '@doughlab',
      ingredients: ['500 g flour', '1 tsp salt'],
      instructions: 'Mix.\nKnead.',
    },
    { title: 'Sauce', ingredients: ['4 tomatoes'], instructions: 'Simmer.' },
    { title: 'Topping', ingredients: ['mozzarella'], instructions: 'Tear.' },
  ];

  function makeQueue(overrides: Partial<ImportQueue> = {}): ImportQueue {
    return { importId: 'imp-1', recipes, index: 0, savedIds: [], ...overrides };
  }

  const importState: ImportState = {
    id: 'imp-1',
    status: ImportStatus.Done,
    reviewedCount: 1,
    closedAt: null,
  };

  // The stack as the reset sees it: the list, New recipe (photos), this form.
  const stackState = {
    key: 'stack-1',
    index: 2,
    routeNames: Object.values(Screens),
    routes: [
      { key: 'Recipes-1', name: Screens.Recipes },
      { key: 'Import-1', name: Screens.Import },
      { key: 'RecipeForm-1', name: Screens.RecipeForm },
    ],
    type: 'stack',
    stale: false,
  };

  // The routes of the reset the screen dispatched, built from stackState.
  function resetRoutes(navigation: ReturnType<typeof makeNavigation>) {
    expect(navigation.dispatch).toHaveBeenCalledTimes(1);
    const [build] = navigation.dispatch.mock.calls[0];
    expect(build).toEqual(expect.any(Function));
    const action = build(stackState);
    expect(action).toMatchObject({ type: 'RESET', payload: { index: 1 } });
    return action.payload.routes;
  }

  function expectNoNavigation(navigation: ReturnType<typeof makeNavigation>) {
    expect(navigation.replace).not.toHaveBeenCalled();
    expect(navigation.dispatch).not.toHaveBeenCalled();
    expect(navigation.popToTop).not.toHaveBeenCalled();
  }

  // The arguments of the latest usePreventRemove call (the current render).
  function lastPreventRemove() {
    const call = mockedUsePreventRemove.mock.calls.at(-1);
    if (!call) throw new Error('usePreventRemove was not called');
    const [prevent, callback] = call;
    return { prevent, callback };
  }

  const leaveAction = { type: 'GO_BACK' };

  // Asks to leave the way a navigator would.
  async function tryToLeave() {
    const { callback } = lastPreventRemove();
    await act(async () =>
      callback({ data: { action: leaveAction } } as Parameters<
        typeof callback
      >[0]),
    );
  }

  function mockSave(id = 'new-id') {
    return mockMutation(mockedUseCreateRecipe, {
      mutateAsync: jest.fn().mockResolvedValue(makeRecipe({ id })),
    });
  }

  beforeEach(() => {
    mockedUseAuth.mockReturnValue({ token: 'tok' } as ReturnType<
      typeof useAuth
    >);
  });

  afterEach(() => {
    // Undo the Alert spies.
    jest.restoreAllMocks();
  });

  describe('what it shows', () => {
    it('prefills title, source, ingredients and steps, leaving the rest empty', async () => {
      mockMutation(mockedUseCreateRecipe);
      const navigation = await renderScreen({ fromImport: makeQueue() });

      expect(navigation.setOptions).toHaveBeenCalledWith({
        title: 'New recipe',
      });
      expect(screen.getByTestId('recipe-form-title-input')).toHaveDisplayValue(
        'Dough',
      );
      expect(screen.getByTestId('recipe-form-source-input')).toHaveDisplayValue(
        '@doughlab',
      );
      expect(
        screen.getByTestId('recipe-form-ingredients-input'),
      ).toHaveDisplayValue('500 g flour\n1 tsp salt');
      expect(
        screen.getByTestId('recipe-form-instructions-input'),
      ).toHaveDisplayValue('Mix.\nKnead.');
      expect(screen.getByTestId('recipe-form-story-input')).toHaveDisplayValue(
        '',
      );
      expect(screen.getByTestId('recipe-form-prep-input')).toHaveDisplayValue(
        '',
      );
      expect(
        screen.getByTestId('recipe-form-image-url-input'),
      ).toHaveDisplayValue('');
    });

    it('leaves the source empty for an import read before source existed', async () => {
      mockMutation(mockedUseCreateRecipe);
      // recipes[1] has no source field, like an older import result.
      await renderScreen({ fromImport: makeQueue({ index: 1 }) });

      expect(screen.getByTestId('recipe-form-source-input')).toHaveDisplayValue(
        '',
      );
    });

    it('prefills the recipe at the queue index', async () => {
      mockMutation(mockedUseCreateRecipe);
      await renderScreen({ fromImport: makeQueue({ index: 2 }) });

      expect(screen.getByTestId('recipe-form-title-input')).toHaveDisplayValue(
        'Topping',
      );
    });

    it('shows the banner but no progress or Skip for a single recipe, with "Save recipe"', async () => {
      mockMutation(mockedUseCreateRecipe);
      await renderScreen({
        fromImport: makeQueue({ recipes: [recipes[0]] }),
      });

      expect(screen.getByTestId('recipe-form-import-banner')).toHaveTextContent(
        'Read from your photos. Check the amounts before saving.',
      );
      expect(
        screen.queryByTestId('recipe-form-import-progress-text'),
      ).not.toBeOnTheScreen();
      expect(
        screen.queryByTestId('recipe-form-import-skip-button'),
      ).not.toBeOnTheScreen();
      expect(screen.getByText('Save recipe')).toBeOnTheScreen();
    });

    it('shows progress, Skip and "Save and next" in the middle of a queue', async () => {
      mockMutation(mockedUseCreateRecipe);
      await renderScreen({ fromImport: makeQueue({ index: 1 }) });

      expect(screen.getByTestId('recipe-form-import-banner')).toBeOnTheScreen();
      expect(
        screen.getByTestId('recipe-form-import-progress-text'),
      ).toHaveTextContent('Recipe 2 of 3');
      expect(
        screen.getByRole('button', { name: 'Skip this one' }),
      ).toBeOnTheScreen();
      expect(screen.getByText('Save and next')).toBeOnTheScreen();
      expect(screen.queryByText('Save recipe')).not.toBeOnTheScreen();
    });

    it('says "Save recipe" on the last recipe of a queue, still with progress and Skip', async () => {
      mockMutation(mockedUseCreateRecipe);
      await renderScreen({ fromImport: makeQueue({ index: 2 }) });

      expect(
        screen.getByTestId('recipe-form-import-progress-text'),
      ).toHaveTextContent('Recipe 3 of 3');
      expect(
        screen.getByRole('button', { name: 'Skip this one' }),
      ).toBeOnTheScreen();
      expect(screen.getByText('Save recipe')).toBeOnTheScreen();
      expect(screen.queryByText('Save and next')).not.toBeOnTheScreen();
    });

    it('requires a title when the photos had none', async () => {
      const user = userEvent.setup();
      const mutateAsync = mockMutation(mockedUseCreateRecipe);
      await renderScreen({
        fromImport: makeQueue({ recipes: [{ ...recipes[0], title: '' }] }),
      });

      await user.press(screen.getByText('Save recipe'));

      expect(await screen.findByText('Title is required')).toBeOnTheScreen();
      expect(mutateAsync).not.toHaveBeenCalled();
    });
  });

  describe('Save', () => {
    it('sends the edited recipe with importId and importIndex', async () => {
      const user = userEvent.setup();
      const mutateAsync = mockSave();
      await renderScreen({ fromImport: makeQueue({ index: 1 }) });

      await user.type(screen.getByTestId('recipe-form-cook-input'), '30');
      await user.press(screen.getByText('Save and next'));

      expect(mutateAsync).toHaveBeenCalledTimes(1);
      expect(mutateAsync).toHaveBeenCalledWith({
        title: 'Sauce',
        story: null,
        source: null,
        imageUrl: null,
        prepMinutes: null,
        cookMinutes: 30,
        servings: null,
        ingredients: ['4 tomatoes'],
        instructions: 'Simmer.',
        importId: 'imp-1',
        importIndex: 1,
      });
    });

    it('moves to the next recipe by resetting the stack to the list and the next form', async () => {
      const user = userEvent.setup();
      mockSave('saved-0');
      const navigation = await renderScreen({ fromImport: makeQueue() });

      await user.press(screen.getByText('Save and next'));

      // New recipe is dropped: reading the photos again would save twice.
      expect(resetRoutes(navigation)).toEqual([
        stackState.routes[0],
        {
          name: Screens.RecipeForm,
          params: {
            fromImport: makeQueue({ index: 1, savedIds: ['saved-0'] }),
          },
        },
      ]);
      expect(navigation.replace).not.toHaveBeenCalled();
      expect(navigation.popToTop).not.toHaveBeenCalled();
    });

    it('adds to the saved ids already in the queue', async () => {
      const user = userEvent.setup();
      mockSave('saved-1');
      const navigation = await renderScreen({
        fromImport: makeQueue({ index: 1, savedIds: ['saved-0'] }),
      });

      await user.press(screen.getByText('Save and next'));

      expect(resetRoutes(navigation)[1]).toEqual({
        name: Screens.RecipeForm,
        params: {
          fromImport: makeQueue({
            index: 2,
            savedIds: ['saved-0', 'saved-1'],
          }),
        },
      });
    });

    it('opens the recipe after saving a single-recipe import', async () => {
      const user = userEvent.setup();
      mockSave('only-one');
      const navigation = await renderScreen({
        fromImport: makeQueue({ recipes: [recipes[0]] }),
      });

      await user.press(screen.getByText('Save recipe'));

      expect(resetRoutes(navigation)).toEqual([
        stackState.routes[0],
        { name: Screens.RecipeDetail, params: { recipeId: 'only-one' } },
      ]);
      expect(navigation.popToTop).not.toHaveBeenCalled();
    });

    it('opens the recipe when the last one is the only one saved (the others skipped)', async () => {
      const user = userEvent.setup();
      mockSave('last');
      const navigation = await renderScreen({
        fromImport: makeQueue({ index: 2 }),
      });

      await user.press(screen.getByText('Save recipe'));

      expect(resetRoutes(navigation)[1]).toEqual({
        name: Screens.RecipeDetail,
        params: { recipeId: 'last' },
      });
    });

    it('goes back to the list when the last save makes 2 or more saved', async () => {
      const user = userEvent.setup();
      mockSave('saved-2');
      const navigation = await renderScreen({
        fromImport: makeQueue({ index: 2, savedIds: ['saved-0'] }),
      });

      await user.press(screen.getByText('Save recipe'));

      expect(navigation.popToTop).toHaveBeenCalledTimes(1);
      expect(navigation.dispatch).not.toHaveBeenCalled();
      expect(navigation.replace).not.toHaveBeenCalled();
    });

    it('shows the server error and stays on the recipe when saving fails', async () => {
      const user = userEvent.setup();
      const error = new Error('This recipe from the import was already saved');
      mockMutation(mockedUseCreateRecipe, {
        mutateAsync: jest.fn().mockRejectedValue(error),
        error,
      });
      const navigation = await renderScreen({ fromImport: makeQueue() });

      await user.press(screen.getByText('Save and next'));

      expect(
        screen.getByText('This recipe from the import was already saved'),
      ).toBeOnTheScreen();
      expectNoNavigation(navigation);
    });
  });

  describe('Skip', () => {
    it('marks the recipe reviewed and replaces the form with the next one when nothing is saved', async () => {
      const user = userEvent.setup();
      const mutateAsync = mockMutation(mockedUseCreateRecipe);
      mockedUpdateImport.mockResolvedValue(importState);
      const navigation = await renderScreen({ fromImport: makeQueue() });

      await user.press(screen.getByRole('button', { name: 'Skip this one' }));

      expect(mockedUpdateImport).toHaveBeenCalledWith('tok', 'imp-1', {
        reviewedCount: 1,
      });
      // Back from the next one still returns to New recipe.
      expect(navigation.replace).toHaveBeenCalledWith(Screens.RecipeForm, {
        fromImport: makeQueue({ index: 1 }),
      });
      expect(navigation.dispatch).not.toHaveBeenCalled();
      expect(mutateAsync).not.toHaveBeenCalled();
    });

    it('resets the stack to the next one when something is already saved', async () => {
      const user = userEvent.setup();
      mockMutation(mockedUseCreateRecipe);
      mockedUpdateImport.mockResolvedValue(importState);
      const navigation = await renderScreen({
        fromImport: makeQueue({ index: 1, savedIds: ['saved-0'] }),
      });

      await user.press(screen.getByRole('button', { name: 'Skip this one' }));

      expect(mockedUpdateImport).toHaveBeenCalledWith('tok', 'imp-1', {
        reviewedCount: 2,
      });
      expect(resetRoutes(navigation)[1]).toEqual({
        name: Screens.RecipeForm,
        params: {
          fromImport: makeQueue({ index: 2, savedIds: ['saved-0'] }),
        },
      });
      expect(navigation.replace).not.toHaveBeenCalled();
    });

    it('goes back to the list when the last one is skipped with nothing saved', async () => {
      const user = userEvent.setup();
      mockMutation(mockedUseCreateRecipe);
      mockedUpdateImport.mockResolvedValue(importState);
      const navigation = await renderScreen({
        fromImport: makeQueue({ index: 2 }),
      });

      await user.press(screen.getByRole('button', { name: 'Skip this one' }));

      expect(mockedUpdateImport).toHaveBeenCalledWith('tok', 'imp-1', {
        reviewedCount: 3,
      });
      expect(navigation.popToTop).toHaveBeenCalledTimes(1);
      expect(navigation.dispatch).not.toHaveBeenCalled();
    });

    it('opens the one saved recipe when the last one is skipped', async () => {
      const user = userEvent.setup();
      mockMutation(mockedUseCreateRecipe);
      mockedUpdateImport.mockResolvedValue(importState);
      const navigation = await renderScreen({
        fromImport: makeQueue({ index: 2, savedIds: ['saved-0'] }),
      });

      await user.press(screen.getByRole('button', { name: 'Skip this one' }));

      expect(resetRoutes(navigation)[1]).toEqual({
        name: Screens.RecipeDetail,
        params: { recipeId: 'saved-0' },
      });
    });

    it('shows the error and stays when the skip request fails, and can be retried', async () => {
      const user = userEvent.setup();
      mockMutation(mockedUseCreateRecipe);
      mockedUpdateImport.mockRejectedValueOnce(new Error('Import not found'));
      const navigation = await renderScreen({ fromImport: makeQueue() });

      await user.press(screen.getByRole('button', { name: 'Skip this one' }));

      expect(screen.getByTestId('recipe-form-error-text')).toHaveTextContent(
        'Import not found',
      );
      expectNoNavigation(navigation);

      mockedUpdateImport.mockResolvedValueOnce(importState);
      await user.press(screen.getByRole('button', { name: 'Skip this one' }));

      expect(mockedUpdateImport).toHaveBeenCalledTimes(2);
      expect(
        screen.queryByTestId('recipe-form-error-text'),
      ).not.toBeOnTheScreen();
      expect(navigation.replace).toHaveBeenCalledTimes(1);
    });
  });

  describe('leaving', () => {
    it('lets you leave freely while nothing is saved', async () => {
      mockMutation(mockedUseCreateRecipe);
      await renderScreen({ fromImport: makeQueue({ index: 1 }) });

      expect(lastPreventRemove().prevent).toBe(false);
    });

    it('asks "Stop importing?" with Keep going as the cancel button once something is saved', async () => {
      const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
      mockMutation(mockedUseCreateRecipe);
      const navigation = await renderScreen({
        fromImport: makeQueue({ index: 1, savedIds: ['saved-0'] }),
      });

      expect(lastPreventRemove().prevent).toBe(true);
      await tryToLeave();

      expect(alert).toHaveBeenCalledTimes(1);
      const [title, message, buttons] = alert.mock.calls[0];
      expect(title).toBe('Stop importing?');
      expect(message).toBe("The rest won't be saved.");
      expect(buttons).toEqual([
        { text: 'Keep going', style: 'cancel' },
        { text: 'Stop', style: 'destructive', onPress: expect.any(Function) },
      ]);
      expect(navigation.dispatch).not.toHaveBeenCalled();
    });

    it('Stop closes the import and goes back to the list', async () => {
      const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
      mockMutation(mockedUseCreateRecipe);
      mockedUpdateImport.mockResolvedValue(importState);
      const navigation = await renderScreen({
        fromImport: makeQueue({ index: 1, savedIds: ['saved-0'] }),
      });
      await tryToLeave();
      const buttons = alert.mock.calls[0][2] as AlertButton[];

      await act(async () => buttons.find(b => b.text === 'Stop')!.onPress!());

      expect(mockedUpdateImport).toHaveBeenCalledWith('tok', 'imp-1', {
        closed: true,
      });
      expect(navigation.popToTop).toHaveBeenCalledTimes(1);

      // popToTop removes this screen too: the guard now lets it go.
      await tryToLeave();
      expect(alert).toHaveBeenCalledTimes(1);
      expect(navigation.dispatch).toHaveBeenCalledWith(leaveAction);
    });

    it('Stop still leaves when closing the import fails', async () => {
      const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
      mockMutation(mockedUseCreateRecipe);
      mockedUpdateImport.mockRejectedValue(new Error('Network request failed'));
      const navigation = await renderScreen({
        fromImport: makeQueue({ index: 1, savedIds: ['saved-0'] }),
      });
      await tryToLeave();
      const buttons = alert.mock.calls[0][2] as AlertButton[];

      await act(async () => buttons.find(b => b.text === 'Stop')!.onPress!());

      expect(navigation.popToTop).toHaveBeenCalledTimes(1);
    });

    it('Keep going stays on the recipe', async () => {
      const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
      mockMutation(mockedUseCreateRecipe);
      const navigation = await renderScreen({
        fromImport: makeQueue({ index: 1, savedIds: ['saved-0'] }),
      });
      await tryToLeave();
      const buttons = alert.mock.calls[0][2] as AlertButton[];

      await act(async () =>
        buttons.find(b => b.text === 'Keep going')!.onPress?.(),
      );

      expect(mockedUpdateImport).not.toHaveBeenCalled();
      expectNoNavigation(navigation);
      expect(screen.getByTestId('recipe-form-title-input')).toHaveDisplayValue(
        'Sauce',
      );
    });

    it('does not ask when the screen moves on by itself after a save', async () => {
      const user = userEvent.setup();
      const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
      mockSave('saved-1');
      const navigation = await renderScreen({
        fromImport: makeQueue({ index: 1, savedIds: ['saved-0'] }),
      });

      await user.press(screen.getByText('Save and next'));
      // The reset removes this screen, which the guard sees as a leave.
      await tryToLeave();

      expect(alert).not.toHaveBeenCalled();
      expect(navigation.dispatch).toHaveBeenLastCalledWith(leaveAction);
    });
  });
});
