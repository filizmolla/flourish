import React from 'react';
import { Alert, AlertButton, Linking } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  render,
  screen,
  userEvent,
  within,
} from '@testing-library/react-native';
import {
  Attempt,
  FoodGroup,
  IngredientSummary,
  Recipe,
  RecipesError,
} from '../api/recipesClient';
import { useAttempts } from '../hooks/useAttempts';
import { useDeleteRecipe, useRecipe } from '../hooks/useRecipes';
import { AppStackParamList, Screens } from '../navigation/types';
import RecipeDetailScreen, { instagramUrl } from './RecipeDetailScreen';

jest.mock('../hooks/useRecipes', () => ({
  useRecipe: jest.fn(),
  useDeleteRecipe: jest.fn(),
}));
jest.mock('../hooks/useAttempts', () => ({ useAttempts: jest.fn() }));

type Props = NativeStackScreenProps<AppStackParamList, Screens.RecipeDetail>;

const mockedUseRecipe = jest.mocked(useRecipe);
const mockedUseDeleteRecipe = jest.mocked(useDeleteRecipe);
const mockedUseAttempts = jest.mocked(useAttempts);

function makeRecipe(overrides: Partial<Recipe> = {}): Recipe {
  return {
    id: 'r1',
    title: 'Sunday Pancakes',
    ingredients: ['1 cup flour', '2 eggs', '1 cup milk'],
    instructions: 'Whisk the batter.\n\n  Let it rest.  \nCook on a hot pan.',
    story: 'Grandma made these.\n\n  \n\nEvery single Sunday.',
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

function makeAttempt(overrides: Partial<Attempt> = {}): Attempt {
  return {
    id: 'a1',
    recipeId: 'r1',
    durationMinutes: 42,
    madeAt: '2026-09-21T12:00:00.000Z',
    rating: 4,
    fullness: null,
    enjoyment: null,
    hasPhoto: false,
    notes: null,
    ingredients: null,
    instructions: null,
    basedOnAttemptId: null,
    tweaked: false,
    createdAt: '2026-09-21T12:00:00.000Z',
    updatedAt: '2026-09-21T12:00:00.000Z',
    ...overrides,
  };
}

type QueryState = {
  data?: Recipe;
  isPending?: boolean;
  isError?: boolean;
  error?: Error | null;
  refetch?: jest.Mock;
};

function mockRecipeQuery({
  data,
  isPending = false,
  isError = false,
  error = null,
  refetch = jest.fn(),
}: QueryState) {
  mockedUseRecipe.mockReturnValue({
    data,
    isPending,
    isError,
    error,
    refetch,
  } as unknown as ReturnType<typeof useRecipe>);
  return refetch;
}

let mutate: jest.Mock;

beforeEach(() => {
  jest.resetAllMocks();
  mutate = jest.fn();
  mockedUseDeleteRecipe.mockReturnValue({
    mutate,
    isPending: false,
  } as unknown as ReturnType<typeof useDeleteRecipe>);
  // Set again after resetAllMocks: no attempts yet, so the history section
  // shows its empty state (its own states are covered in AttemptHistory.test).
  mockedUseAttempts.mockReturnValue({
    data: [],
    isPending: false,
    isError: false,
    refetch: jest.fn(),
  } as unknown as ReturnType<typeof useAttempts>);
});

type StackRoute = { key: string; name: Screens; params?: object };

// previousRoutes are the routes below this screen in the stack, oldest first;
// getState() reports them with this screen on top.
async function renderScreen({
  previousRoutes = [],
}: { previousRoutes?: StackRoute[] } = {}) {
  const route = {
    key: 'RecipeDetail-1',
    name: Screens.RecipeDetail,
    params: { recipeId: 'r1' },
  };
  const routes = [...previousRoutes, route];
  const navigation = {
    setOptions: jest.fn(),
    push: jest.fn(),
    navigate: jest.fn(),
    goBack: jest.fn(),
    getState: jest.fn(() => ({ routes, index: routes.length - 1 })),
  };
  await render(
    <RecipeDetailScreen
      navigation={navigation as unknown as Props['navigation']}
      route={route as Props['route']}
    />,
  );
  return navigation;
}

describe('RecipeDetailScreen', () => {
  it('asks for the recipe from the route', async () => {
    mockRecipeQuery({ data: makeRecipe() });
    await renderScreen();

    expect(mockedUseRecipe).toHaveBeenCalledWith('r1');
    expect(mockedUseDeleteRecipe).toHaveBeenCalledWith('r1');
  });

  it('shows the date, title and timing stats', async () => {
    mockRecipeQuery({ data: makeRecipe() });
    await renderScreen();

    expect(screen.getByText('SEPTEMBER 21, 2026')).toBeOnTheScreen();
    expect(screen.getByTestId('recipe-detail-title')).toHaveTextContent(
      'Sunday Pancakes',
    );
    expect(screen.getByText('5 min')).toBeOnTheScreen();
    expect(screen.getByText('20 min')).toBeOnTheScreen();
    expect(screen.getByText('SERVES')).toBeOnTheScreen();
  });

  it('renders the story as separate paragraphs, skipping blank ones', async () => {
    mockRecipeQuery({ data: makeRecipe() });
    await renderScreen();

    expect(screen.getByText('Grandma made these.')).toBeOnTheScreen();
    expect(screen.getByText('Every single Sunday.')).toBeOnTheScreen();
  });

  it('lists the ingredients and numbers the steps, dropping blank lines', async () => {
    // No servings, so a stray "4" could only be an extra step number.
    mockRecipeQuery({ data: makeRecipe({ servings: null }) });
    await renderScreen();

    for (const ingredient of ['1 cup flour', '2 eggs', '1 cup milk']) {
      expect(screen.getByText(ingredient)).toBeOnTheScreen();
    }
    expect(screen.getByText('Whisk the batter.')).toBeOnTheScreen();
    expect(screen.getByText('Let it rest.')).toBeOnTheScreen();
    expect(screen.getByText('Cook on a hot pan.')).toBeOnTheScreen();
    expect(screen.getByText('1')).toBeOnTheScreen();
    expect(screen.getByText('2')).toBeOnTheScreen();
    expect(screen.getByText('3')).toBeOnTheScreen();
    expect(screen.queryByText('4')).not.toBeOnTheScreen();
  });

  it('shows the Jump button when there is a story', async () => {
    mockRecipeQuery({ data: makeRecipe() });
    await renderScreen();

    expect(screen.getByText('Jump to Recipe ↓')).toBeOnTheScreen();
  });

  it.each([
    ['null', null],
    ['blank', '  \n\n  '],
  ])('hides the Jump button when the story is %s', async (_label, story) => {
    mockRecipeQuery({ data: makeRecipe({ story }) });
    await renderScreen();

    expect(screen.queryByText('Jump to Recipe ↓')).not.toBeOnTheScreen();
    expect(screen.getByText('1 cup flour')).toBeOnTheScreen();
  });

  it('hides timing stats that are missing or zero', async () => {
    mockRecipeQuery({
      data: makeRecipe({ prepMinutes: 0, cookMinutes: null, servings: null }),
    });
    await renderScreen();

    expect(screen.queryByText('PREP')).not.toBeOnTheScreen();
    expect(screen.queryByText('COOK')).not.toBeOnTheScreen();
    expect(screen.queryByText('SERVES')).not.toBeOnTheScreen();
  });

  it('says the recipe no longer exists on a 404, without a retry', async () => {
    mockRecipeQuery({
      isError: true,
      error: new RecipesError('Recipe not found', 404),
    });
    await renderScreen();

    expect(screen.getByText('This recipe no longer exists.')).toBeOnTheScreen();
    expect(screen.queryByText('Try again')).not.toBeOnTheScreen();
  });

  it('shows other errors with a retry that refetches', async () => {
    const user = userEvent.setup();
    const refetch = mockRecipeQuery({
      isError: true,
      error: new RecipesError('Request failed (500)', 500),
    });
    await renderScreen();

    expect(screen.getByText('Request failed (500)')).toBeOnTheScreen();
    await user.press(screen.getByText('Try again'));
    expect(refetch).toHaveBeenCalled();
  });

  it('shows nothing of the recipe while loading', async () => {
    mockRecipeQuery({ isPending: true });
    await renderScreen();

    expect(screen.queryByTestId('recipe-detail-title')).not.toBeOnTheScreen();
    expect(screen.queryByText('Delete recipe')).not.toBeOnTheScreen();
  });

  it('adds an Edit header button that opens the form for this recipe', async () => {
    const user = userEvent.setup();
    mockRecipeQuery({ data: makeRecipe() });
    const navigation = await renderScreen();

    const { headerRight } = navigation.setOptions.mock.calls.at(-1)![0];
    await render(headerRight());
    await user.press(screen.getByText('Edit'));

    expect(navigation.navigate).toHaveBeenCalledWith(Screens.RecipeForm, {
      recipeId: 'r1',
    });
  });

  it('starts cooking this recipe from the recipe card', async () => {
    const user = userEvent.setup();
    mockRecipeQuery({ data: makeRecipe() });
    const navigation = await renderScreen();

    const button = screen.getByRole('button', { name: '▶ Start cooking' });
    expect(screen.getByTestId('recipe-detail-card')).toContainElement(button);

    await user.press(button);

    expect(navigation.navigate).toHaveBeenCalledTimes(1);
    expect(navigation.navigate).toHaveBeenCalledWith(Screens.Cooking, {
      recipeId: 'r1',
    });
  });

  it.each<[string, QueryState]>([
    ['loading', { isPending: true }],
    [
      'the recipe failed to load',
      { isError: true, error: new RecipesError('Request failed (500)', 500) },
    ],
  ])('has no Start cooking button while %s', async (_label, state) => {
    mockRecipeQuery(state);
    await renderScreen();

    expect(
      screen.queryByRole('button', { name: '▶ Start cooking' }),
    ).not.toBeOnTheScreen();
  });

  it("shows this recipe's cooking history", async () => {
    mockRecipeQuery({ data: makeRecipe() });
    await renderScreen();

    expect(mockedUseAttempts).toHaveBeenCalledWith('r1');
    expect(screen.getByTestId('recipe-detail-history')).toBeOnTheScreen();
    expect(
      screen.getByText(
        "You haven't cooked this yet. Tap Start cooking to begin.",
      ),
    ).toBeOnTheScreen();
  });

  it('places the history after the recipe card and before Delete', async () => {
    mockRecipeQuery({ data: makeRecipe() });
    await renderScreen();

    const card = screen.getByTestId('recipe-detail-card');
    const history = screen.getByTestId('recipe-detail-history');
    const deleteButton = screen.getByTestId('recipe-detail-delete-button');

    // All three are siblings in the content block; compare their positions.
    const siblings = history.parent!.children;
    expect(siblings).toContain(card);
    expect(siblings).toContain(deleteButton);
    const cardIndex = siblings.indexOf(card);
    const historyIndex = siblings.indexOf(history);
    expect(historyIndex).toBe(cardIndex + 1);
    expect(siblings.indexOf(deleteButton)).toBe(historyIndex + 1);
  });

  it('opens the attempt detail for this recipe when a history row is pressed', async () => {
    const user = userEvent.setup();
    mockedUseAttempts.mockReturnValue({
      data: [makeAttempt({ id: 'a1' }), makeAttempt({ id: 'a2' })],
      isPending: false,
      isError: false,
      refetch: jest.fn(),
    } as unknown as ReturnType<typeof useAttempts>);
    mockRecipeQuery({ data: makeRecipe() });
    const navigation = await renderScreen();

    await user.press(screen.getByTestId('recipe-detail-attempt-a2'));

    expect(navigation.navigate).toHaveBeenCalledTimes(1);
    expect(navigation.navigate).toHaveBeenCalledWith(Screens.AttemptDetail, {
      recipeId: 'r1',
      attemptId: 'a2',
    });
  });

  it('has no history section while the recipe is loading', async () => {
    mockRecipeQuery({ isPending: true });
    await renderScreen();

    expect(screen.queryByTestId('recipe-detail-history')).not.toBeOnTheScreen();
  });

  it('asks for confirmation before deleting, then deletes', async () => {
    const user = userEvent.setup();
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockRecipeQuery({ data: makeRecipe() });
    await renderScreen();

    await user.press(screen.getByText('Delete recipe'));

    expect(alert).toHaveBeenCalledTimes(1);
    const [title, , buttons] = alert.mock.calls[0];
    expect(title).toBe('Delete this recipe?');
    expect(mutate).not.toHaveBeenCalled();

    const confirm = (buttons as AlertButton[]).find(b => b.text === 'Delete');
    confirm!.onPress!();
    expect(mutate).toHaveBeenCalledTimes(1);
    alert.mockRestore();
  });
});

describe('RecipeDetailScreen section headings', () => {
  const layerCake = makeRecipe({
    servings: null,
    ingredients: [
      '# For the cake',
      '2 cups flour',
      '#10 can peaches',
      '## For the cream',
      '200 ml cream',
    ],
    instructions:
      '# For the cake\nMix flour and eggs.\nBake 30 min.\n\n#   For the cream  \nWhip the cream.',
  });

  // A step's row: its number and its text.
  const stepRow = (text: string) => screen.getByText(text).parent;

  it('shows ingredient headings as header rows without #', async () => {
    mockRecipeQuery({ data: layerCake });
    await renderScreen();

    const cake = screen.getByTestId('recipe-detail-ingredient-heading-0');
    const cream = screen.getByTestId('recipe-detail-ingredient-heading-3');
    expect(cake).toHaveTextContent('For the cake', { exact: true });
    expect(cream).toHaveTextContent('For the cream', { exact: true });
    expect(screen.getAllByRole('header', { name: 'For the cake' })).toContain(
      cake,
    );
    expect(screen.getAllByRole('header', { name: 'For the cream' })).toContain(
      cream,
    );
    // "#10 can" has no space after #: an ordinary ingredient.
    expect(screen.getByText('#10 can peaches')).toBeOnTheScreen();
    expect(
      screen.queryByTestId('recipe-detail-ingredient-heading-2'),
    ).not.toBeOnTheScreen();
  });

  it('shows step headings without # or a number, numbering steps straight through', async () => {
    mockRecipeQuery({ data: layerCake });
    await renderScreen();

    // Blank lines are dropped first, so the indices are of the split lines.
    expect(
      screen.getByTestId('recipe-detail-step-heading-0'),
    ).toHaveTextContent('For the cake', { exact: true });
    expect(
      screen.getByTestId('recipe-detail-step-heading-3'),
    ).toHaveTextContent('For the cream', { exact: true });

    expect(stepRow('Mix flour and eggs.')).toHaveTextContent(
      '1Mix flour and eggs.',
    );
    expect(stepRow('Bake 30 min.')).toHaveTextContent('2Bake 30 min.');
    expect(stepRow('Whip the cream.')).toHaveTextContent('3Whip the cream.');
    expect(screen.queryByText('4')).not.toBeOnTheScreen();
    expect(screen.queryByText(/^#+\s/)).not.toBeOnTheScreen();
  });
});

describe('instagramUrl', () => {
  it.each([
    ['@someone', 'https://www.instagram.com/someone/'],
    ['@some.one_1', 'https://www.instagram.com/some.one_1/'],
    ['@A', 'https://www.instagram.com/A/'],
    [`@${'a'.repeat(30)}`, `https://www.instagram.com/${'a'.repeat(30)}/`],
  ])('links %j to %j', (source, url) => {
    expect(instagramUrl(source)).toBe(url);
  });

  it.each([
    '@',
    `@${'a'.repeat(31)}`,
    'someone',
    'Mom',
    '@some one',
    '@one @two',
    'From @someone',
    '@someone!',
    '@some-one',
    '@someone/',
    '@ünlü',
    ' @someone',
    'https://instagram.com/someone',
  ])('does not link %j', source => {
    expect(instagramUrl(source)).toBeNull();
  });
});

describe('RecipeDetailScreen source', () => {
  afterEach(() => {
    // Undo the Linking and Alert spies.
    jest.restoreAllMocks();
  });

  it('shows no source line when the recipe has none', async () => {
    mockRecipeQuery({ data: makeRecipe({ source: null }) });
    await renderScreen();

    expect(
      screen.queryByTestId('recipe-detail-source-text'),
    ).not.toBeOnTheScreen();
    expect(
      screen.queryByTestId('recipe-detail-source-link'),
    ).not.toBeOnTheScreen();
    expect(screen.queryByText(/^From /)).not.toBeOnTheScreen();
  });

  it('shows any other source as plain "From …" text', async () => {
    mockRecipeQuery({ data: makeRecipe({ source: 'Mom' }) });
    await renderScreen();

    expect(screen.getByTestId('recipe-detail-source-text')).toHaveTextContent(
      'From Mom',
      { exact: true },
    );
    expect(screen.queryByRole('link')).not.toBeOnTheScreen();
  });

  it('shows text with a handle inside it as plain text, not a link', async () => {
    mockRecipeQuery({ data: makeRecipe({ source: 'Recipe by @someone' }) });
    await renderScreen();

    expect(screen.getByTestId('recipe-detail-source-text')).toHaveTextContent(
      'From Recipe by @someone',
    );
    expect(
      screen.queryByTestId('recipe-detail-source-link'),
    ).not.toBeOnTheScreen();
  });

  it('shows a handle as a link that opens the Instagram profile', async () => {
    const user = userEvent.setup();
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    mockRecipeQuery({ data: makeRecipe({ source: '@someone' }) });
    await renderScreen();

    const link = screen.getByRole('link', {
      name: 'Open @someone on Instagram',
    });
    expect(link).toBe(screen.getByTestId('recipe-detail-source-link'));
    expect(link).toHaveTextContent('From @someone ↗');
    expect(
      screen.queryByTestId('recipe-detail-source-text'),
    ).not.toBeOnTheScreen();

    await user.press(link);

    expect(openURL).toHaveBeenCalledTimes(1);
    expect(openURL).toHaveBeenCalledWith('https://www.instagram.com/someone/');
  });

  it('shows an alert when the link cannot be opened', async () => {
    const user = userEvent.setup();
    jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('No handler'));
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockRecipeQuery({ data: makeRecipe({ source: '@someone' }) });
    await renderScreen();

    await user.press(
      screen.getByRole('link', { name: 'Open @someone on Instagram' }),
    );

    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert).toHaveBeenCalledWith("Couldn't open Instagram");
  });
});

describe('RecipeDetailScreen forks', () => {
  // Midday UTC in the current year, so the short date has no year and doesn't
  // shift with the machine's timezone.
  const thisYear = new Date().getFullYear();
  const forkedFrom = {
    id: 'r0',
    title: 'Shakshuka',
    attemptId: 'a0',
    madeAt: `${thisYear}-09-21T12:00:00.000Z`,
  };

  describe('"Based on" link', () => {
    it('is not shown for a recipe that was not saved from an attempt', async () => {
      mockRecipeQuery({ data: makeRecipe() });
      await renderScreen();

      expect(
        screen.queryByTestId('recipe-detail-forked-from-link'),
      ).not.toBeOnTheScreen();
      expect(screen.queryByText(/^Based on/)).not.toBeOnTheScreen();
    });

    const basedOnLink = () =>
      screen.getByRole('link', { name: 'Based on Shakshuka · Sep 21 ›' });

    it('names the original and the attempt date, and opens the original recipe', async () => {
      const user = userEvent.setup();
      mockRecipeQuery({ data: makeRecipe({ forkedFrom }) });
      // Opened from the list: the original isn't below, so it is pushed.
      const navigation = await renderScreen({
        previousRoutes: [{ key: 'Recipes-0', name: Screens.Recipes }],
      });

      await user.press(basedOnLink());

      expect(navigation.push).toHaveBeenCalledTimes(1);
      expect(navigation.push).toHaveBeenCalledWith(Screens.RecipeDetail, {
        recipeId: 'r0',
      });
      expect(navigation.goBack).not.toHaveBeenCalled();
      expect(navigation.navigate).not.toHaveBeenCalled();
    });

    it('goes back when the fork was opened from the original', async () => {
      const user = userEvent.setup();
      mockRecipeQuery({ data: makeRecipe({ forkedFrom }) });
      const navigation = await renderScreen({
        previousRoutes: [
          { key: 'Recipes-0', name: Screens.Recipes },
          {
            key: 'RecipeDetail-0',
            name: Screens.RecipeDetail,
            params: { recipeId: 'r0' },
          },
        ],
      });

      await user.press(basedOnLink());

      expect(navigation.goBack).toHaveBeenCalledTimes(1);
      expect(navigation.push).not.toHaveBeenCalled();
      expect(navigation.navigate).not.toHaveBeenCalled();
    });

    it('adds the year when the attempt is from another year', async () => {
      mockRecipeQuery({
        data: makeRecipe({
          forkedFrom: { ...forkedFrom, madeAt: '2020-09-21T12:00:00.000Z' },
        }),
      });
      await renderScreen();

      expect(
        screen.getByTestId('recipe-detail-forked-from-link'),
      ).toHaveTextContent('Based on Shakshuka · Sep 21, 2020 ›');
    });
  });

  describe('VERSIONS', () => {
    const forks = [
      { id: 'r8', title: 'Spicy Pancakes' },
      { id: 'r7', title: 'Vegan Pancakes' },
    ];

    it('is hidden when no recipe was saved from this one', async () => {
      mockRecipeQuery({ data: makeRecipe() });
      await renderScreen();

      expect(
        screen.queryByTestId('recipe-detail-versions'),
      ).not.toBeOnTheScreen();
      expect(screen.queryByText('VERSIONS')).not.toBeOnTheScreen();
    });

    it('lists the forks in the order the server sends (newest first)', async () => {
      mockRecipeQuery({ data: makeRecipe({ forks }) });
      await renderScreen();

      expect(screen.getByText('VERSIONS')).toBeOnTheScreen();
      const links = screen.getAllByRole('link', { name: /Pancakes/ });
      expect(links.map(link => link.props.testID)).toEqual([
        'recipe-detail-version-r8',
        'recipe-detail-version-r7',
      ]);
      expect(
        within(screen.getByTestId('recipe-detail-version-r8')).getByText(
          'Spicy Pancakes',
        ),
      ).toBeOnTheScreen();
    });

    it('sits between the recipe card and the history', async () => {
      mockRecipeQuery({ data: makeRecipe({ forks }) });
      await renderScreen();

      const card = screen.getByTestId('recipe-detail-card');
      const versions = screen.getByTestId('recipe-detail-versions');
      const history = screen.getByTestId('recipe-detail-history');
      const siblings = versions.parent!.children;
      expect(siblings.indexOf(versions)).toBe(siblings.indexOf(card) + 1);
      expect(siblings.indexOf(history)).toBe(siblings.indexOf(versions) + 1);
    });

    it("pushes the version's own detail screen", async () => {
      const user = userEvent.setup();
      mockRecipeQuery({ data: makeRecipe({ forks }) });
      const navigation = await renderScreen();

      await user.press(screen.getByRole('link', { name: 'Vegan Pancakes ›' }));

      expect(navigation.push).toHaveBeenCalledTimes(1);
      expect(navigation.push).toHaveBeenCalledWith(Screens.RecipeDetail, {
        recipeId: 'r7',
      });
    });
  });

  describe('delete confirmation', () => {
    async function confirmMessage(recipe: Recipe): Promise<string> {
      const user = userEvent.setup();
      const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
      mockRecipeQuery({ data: recipe });
      await renderScreen();

      await user.press(screen.getByText('Delete recipe'));

      expect(alert).toHaveBeenCalledTimes(1);
      const message = alert.mock.calls[0][1] as string;
      alert.mockRestore();
      return message;
    }

    it('only says the recipe will be gone when it has no forks', async () => {
      expect(await confirmMessage(makeRecipe())).toBe(
        '"Sunday Pancakes" will be gone for good.',
      );
    });

    it('adds nothing for a fork, whose original is not affected', async () => {
      expect(await confirmMessage(makeRecipe({ forkedFrom }))).toBe(
        '"Sunday Pancakes" will be gone for good.',
      );
    });

    it.each([
      [
        'one fork',
        ['Spicy Pancakes'],
        'Spicy Pancakes stays, with its own history.',
      ],
      [
        'two forks',
        ['Spicy Pancakes', 'Vegan Pancakes'],
        'Spicy Pancakes and Vegan Pancakes stay, each with its own history.',
      ],
      [
        'three forks',
        ['Spicy Pancakes', 'Vegan Pancakes', 'Tiny Pancakes'],
        'Spicy Pancakes, Vegan Pancakes and Tiny Pancakes stay, each with its own history.',
      ],
    ])('says that the forks stay with %s', async (_label, titles, keeps) => {
      const recipe = makeRecipe({
        forks: titles.map((title, i) => ({ id: `f${i}`, title })),
      });

      expect(await confirmMessage(recipe)).toBe(
        `"Sunday Pancakes" will be gone for good. ${keeps}`,
      );
    });
  });
});

describe('RecipeDetailScreen balance card', () => {
  const egg: IngredientSummary = {
    id: 'i-egg',
    name: 'Egg',
    mainGroup: FoodGroup.Protein,
    nutrients: [FoodGroup.Protein],
  };

  it("shows what the recipe's linked lines bring", async () => {
    mockRecipeQuery({
      data: makeRecipe({
        lines: [
          {
            position: 0,
            text: '1 cup flour',
            linkSetByOwner: false,
            ingredient: null,
          },
          {
            position: 1,
            text: '2 eggs',
            linkSetByOwner: false,
            ingredient: egg,
          },
        ],
      }),
    });
    await renderScreen();

    expect(screen.getByTestId('recipe-detail-balance-card')).toBeOnTheScreen();
    expect(
      screen.getByRole('image', {
        name: 'Has protein, no fiber or healthy fat yet',
      }),
    ).toBeOnTheScreen();
    expect(screen.getByText('Add some fiber.')).toBeOnTheScreen();
  });

  it('has no balance card when no line is linked', async () => {
    mockRecipeQuery({
      data: makeRecipe({
        lines: [
          {
            position: 0,
            text: '1 cup flour',
            linkSetByOwner: false,
            ingredient: null,
          },
        ],
      }),
    });
    await renderScreen();

    expect(screen.getByText('1 cup flour')).toBeOnTheScreen();
    expect(
      screen.queryByTestId('recipe-detail-balance-card'),
    ).not.toBeOnTheScreen();
  });

  it('opens the ingredient list filtered to the first nutrient to add from the "See foods" link', async () => {
    const user = userEvent.setup();
    mockRecipeQuery({
      data: makeRecipe({
        lines: [
          {
            position: 0,
            text: '2 eggs',
            linkSetByOwner: false,
            ingredient: egg,
          },
        ],
      }),
    });
    const navigation = await renderScreen();

    // Egg only: fiber and healthy fat are missing; fiber comes first.
    await user.press(
      screen.getByRole('link', { name: 'See foods with fiber ›' }),
    );

    expect(navigation.navigate).toHaveBeenCalledTimes(1);
    expect(navigation.navigate).toHaveBeenCalledWith(Screens.Ingredients, {
      group: FoodGroup.Fiber,
    });
  });
});
