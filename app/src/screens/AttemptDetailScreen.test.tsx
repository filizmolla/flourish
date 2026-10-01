import React from 'react';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  getDefaultNormalizer,
  render,
  screen,
  userEvent,
  waitFor,
  within,
} from '@testing-library/react-native';
import * as client from '../api/recipesClient';
import {
  AttemptDetail,
  Enjoyment,
  FoodGroup,
  Fullness,
  IngredientSummary,
  Recipe,
  RecipeLine,
  RecipesError,
} from '../api/recipesClient';
import { useAuth } from '../auth/AuthContext';
import { AuthStatus } from '../auth/authStatus';
import { SAVED_VISIBLE_MS } from '../components/RatePromptCard';
import { attemptKeys, useAttempt } from '../hooks/useAttempts';
import { useRecipe } from '../hooks/useRecipes';
import { AppStackParamList, Screens } from '../navigation/types';
import { colors } from '../theme';
import AttemptDetailScreen from './AttemptDetailScreen';

// useAttempt is mocked to drive loading/error states; useUpdateAttempt is
// the real hook on top of a mocked API client.
jest.mock('../hooks/useAttempts', () => ({
  ...jest.requireActual('../hooks/useAttempts'),
  useAttempt: jest.fn(),
}));
jest.mock('../hooks/useRecipes', () => ({ useRecipe: jest.fn() }));
jest.mock('../api/recipesClient', () => ({
  ...jest.requireActual('../api/recipesClient'),
  updateAttempt: jest.fn(),
}));
jest.mock('../auth/AuthContext', () => ({ useAuth: jest.fn() }));

type Props = NativeStackScreenProps<AppStackParamList, Screens.AttemptDetail>;
type Element = ReturnType<typeof screen.getByTestId>;

const mockedUseAttempt = jest.mocked(useAttempt);
const mockedUseRecipe = jest.mocked(useRecipe);
const mockedClient = jest.mocked(client);
const mockedUseAuth = jest.mocked(useAuth);
const { useAttempt: realUseAttempt } = jest.requireActual<
  typeof import('../hooks/useAttempts')
>('../hooks/useAttempts');

let queryClient: QueryClient;

function SignedInQueryProvider({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

function makeRecipe(overrides: Partial<Recipe> = {}): Recipe {
  return {
    id: 'r1',
    title: 'Tomato Soup',
    ingredients: ['1 can tomatoes', '1 onion', 'salt'],
    instructions: 'Chop the onion.\n\nSimmer everything.\nBlend.',
    story: null,
    imageUrl: null,
    source: null,
    prepMinutes: 10,
    cookMinutes: 30,
    servings: 4,
    forkedFrom: null,
    lines: [],
    forks: [],
    createdAt: '2026-08-01T12:00:00.000Z',
    updatedAt: '2026-08-01T12:00:00.000Z',
    ...overrides,
  };
}

function makeAttempt(overrides: Partial<AttemptDetail> = {}): AttemptDetail {
  return {
    id: 'a2',
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
    basedOnAttempt: null,
    fork: null,
    createdAt: '2026-09-21T12:00:00.000Z',
    updatedAt: '2026-09-21T12:00:00.000Z',
    ...overrides,
  };
}

type QueryState<T> = {
  data?: T;
  isPending?: boolean;
  error?: Error | null;
};

function mockQueries({
  attempt = { data: makeAttempt() },
  recipe = { data: makeRecipe() },
}: {
  attempt?: QueryState<AttemptDetail>;
  recipe?: QueryState<Recipe>;
} = {}) {
  const asQuery = <T,>({
    data,
    isPending = false,
    error = null,
  }: QueryState<T>) => ({
    data,
    isPending,
    isError: error !== null,
    error,
  });
  mockedUseAttempt.mockReturnValue(
    asQuery(attempt) as unknown as ReturnType<typeof useAttempt>,
  );
  mockedUseRecipe.mockReturnValue(
    asQuery(recipe) as unknown as ReturnType<typeof useRecipe>,
  );
}

type StackRoute = { key: string; name: Screens; params?: object };

// The routes below this screen in the stack, oldest first; getState() reports
// them with this screen on top.
async function renderScreen({
  previousRoutes = [],
}: { previousRoutes?: StackRoute[] } = {}) {
  const route = {
    key: 'AttemptDetail-1',
    name: Screens.AttemptDetail,
    params: { recipeId: 'r1', attemptId: 'a2' },
  };
  const routes = [...previousRoutes, route];
  const navigation = {
    push: jest.fn(),
    navigate: jest.fn(),
    goBack: jest.fn(),
    getState: jest.fn(() => ({ routes, index: routes.length - 1 })),
  };
  await render(
    <AttemptDetailScreen
      navigation={navigation as unknown as Props['navigation']}
      route={route as Props['route']}
    />,
    { wrapper: SignedInQueryProvider },
  );
  return navigation;
}

// For the editors: the attempt comes from the query cache through the real
// useAttempt, so a saved change (put in the cache by useUpdateAttempt) shows
// up on screen like in the app.
async function renderWithCachedAttempt(attempt: AttemptDetail) {
  queryClient.setQueryData(attemptKeys.detail(attempt.id), attempt);
  mockedUseAttempt.mockImplementation(realUseAttempt);
  mockedUseRecipe.mockReturnValue({
    data: makeRecipe(),
    isPending: false,
    isError: false,
    error: null,
  } as unknown as ReturnType<typeof useRecipe>);
  return renderScreen();
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(res => {
    resolve = res;
  });
  return { promise, resolve };
}

// The loading spinner has no role or testID; find it by its host type.
function hasSpinner(): boolean {
  const search = (node: Element): boolean =>
    node.type === 'ActivityIndicator' ||
    node.children.some(child => typeof child !== 'string' && search(child));
  return search(screen.container);
}

// Every testID on screen, in render (depth-first, pre-order) order.
function testIDsInOrder(): string[] {
  const ids: string[] = [];
  const walk = (node: Element) => {
    if (typeof node.props.testID === 'string') ids.push(node.props.testID);
    node.children.forEach(child => {
      if (typeof child !== 'string') walk(child);
    });
  };
  walk(screen.container);
  return ids;
}

const ratingStar = (count: number) =>
  screen.getByRole('radio', { name: `${count} star${count === 1 ? '' : 's'}` });
const notesInput = () => screen.getByLabelText('Notes');

const ingredientChange = (index: number) =>
  screen.getByTestId(`attempt-detail-ingredient-change-${index}`);
const stepChange = (index: number) =>
  screen.getByTestId(`attempt-detail-step-change-${index}`);

// A line of the Full view; the index runs over the aligned lines, removed
// ones included.
type LineKind = 'ingredient' | 'step';
const fullLine = (kind: LineKind, index: number) =>
  screen.getByTestId(`attempt-detail-line-${kind}-${index}`);
const queryFullLine = (kind: LineKind, index: number) =>
  screen.queryByTestId(`attempt-detail-line-${kind}-${index}`);

const fullTab = () => screen.getByRole('tab', { name: 'Full' });
const changesTab = () => screen.getByRole('tab', { name: 'Changes' });

// Text matching that keeps leading spaces, so "  1 can tomatoes" (the whole
// row) and "1 can tomatoes" (the struck-through part) are told apart.
const keepSpaces = { normalizer: getDefaultNormalizer({ trim: false }) };

// The group ("Ingredients" / "Steps") a change title belongs to.
const group = (title: string) => screen.getByText(title).parent!;

beforeEach(() => {
  jest.resetAllMocks();
  // Short dates leave out the year only for the current year, so pin "now".
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-09-24T12:00:00.000Z'));
  // staleTime: Infinity so a seeded attempt isn't refetched on mount.
  queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
  mockedUseAuth.mockReturnValue({
    status: AuthStatus.SignedIn,
    user: null,
    token: 'tok',
    signIn: jest.fn(),
    signUp: jest.fn(),
    signOut: jest.fn(),
  });
});

afterEach(() => {
  queryClient.clear();
  jest.useRealTimers();
});

describe('AttemptDetailScreen', () => {
  it('asks for the attempt and the recipe from the route', async () => {
    mockQueries();
    await renderScreen();

    expect(mockedUseAttempt).toHaveBeenCalledWith('a2');
    expect(mockedUseRecipe).toHaveBeenCalledWith('r1');
  });

  describe('states', () => {
    it.each<[string, Parameters<typeof mockQueries>[0]]>([
      ['the attempt', { attempt: { isPending: true } }],
      ['the recipe', { recipe: { isPending: true } }],
      ['both', { attempt: { isPending: true }, recipe: { isPending: true } }],
    ])('shows only a spinner while %s is loading', async (_label, state) => {
      mockQueries(state);
      await renderScreen();

      expect(hasSpinner()).toBe(true);
      expect(
        screen.queryByTestId('attempt-detail-recipe-link'),
      ).not.toBeOnTheScreen();
      expect(
        screen.queryByTestId('attempt-detail-error-text'),
      ).not.toBeOnTheScreen();
    });

    it('says the attempt no longer exists on a 404', async () => {
      mockQueries({
        attempt: { error: new RecipesError('Attempt not found', 404) },
      });
      await renderScreen();

      expect(
        screen.getByText('This attempt no longer exists.'),
      ).toBeOnTheScreen();
      expect(screen.queryByText('Attempt not found')).not.toBeOnTheScreen();
      expect(hasSpinner()).toBe(false);
      expect(
        screen.queryByTestId('attempt-detail-recipe-link'),
      ).not.toBeOnTheScreen();
    });

    it('also says so when the recipe is gone (404)', async () => {
      mockQueries({
        recipe: { error: new RecipesError('Recipe not found', 404) },
      });
      await renderScreen();

      expect(
        screen.getByText('This attempt no longer exists.'),
      ).toBeOnTheScreen();
    });

    it.each<[string, Parameters<typeof mockQueries>[0]]>([
      [
        'attempt',
        { attempt: { error: new RecipesError('Request failed (500)', 500) } },
      ],
      [
        'recipe',
        { recipe: { error: new RecipesError('Request failed (500)', 500) } },
      ],
    ])('shows other %s errors with their message', async (_label, state) => {
      mockQueries(state);
      await renderScreen();

      expect(screen.getByText('Request failed (500)')).toBeOnTheScreen();
      expect(
        screen.queryByText('This attempt no longer exists.'),
      ).not.toBeOnTheScreen();
    });

    it('shows the message of a non-HTTP error, such as a network failure', async () => {
      mockQueries({
        attempt: { error: new TypeError('Network request failed') },
      });
      await renderScreen();

      expect(screen.getByText('Network request failed')).toBeOnTheScreen();
    });
  });

  describe('header', () => {
    it('shows the recipe title as a link to the recipe', async () => {
      mockQueries();
      await renderScreen();

      const link = screen.getByRole('link', {
        name: 'Open recipe Tomato Soup',
      });
      // Title and chevron are sibling Texts (a gap, not a space, between them).
      expect(link).toHaveTextContent('Tomato Soup›', { exact: true });
      // The title text itself stays findable for E2E.
      expect(screen.getByTestId('attempt-detail-title')).toHaveTextContent(
        'Tomato Soup',
        { exact: true },
      );
      expect(link).toContainElement(screen.getByTestId('attempt-detail-title'));
    });

    describe('title link', () => {
      const recipeLink = () =>
        screen.getByRole('link', { name: 'Open recipe Tomato Soup' });
      const recipesRoute: StackRoute = {
        key: 'Recipes-0',
        name: Screens.Recipes,
      };
      const recipeDetailRoute = (recipeId: string): StackRoute => ({
        key: `RecipeDetail-${recipeId}`,
        name: Screens.RecipeDetail,
        params: { recipeId },
      });

      it('goes back when the previous screen is this recipe', async () => {
        const user = userEvent.setup();
        mockQueries();
        const navigation = await renderScreen({
          previousRoutes: [recipesRoute, recipeDetailRoute('r1')],
        });

        await user.press(recipeLink());

        expect(navigation.goBack).toHaveBeenCalledTimes(1);
        expect(navigation.push).not.toHaveBeenCalled();
        expect(navigation.navigate).not.toHaveBeenCalled();
      });

      // Other stack shapes are covered in navigation/openRecipe.test.ts.
      it("pushes the attempt's recipe when the previous screen is another recipe (the fork it was opened from)", async () => {
        const user = userEvent.setup();
        mockQueries();
        const navigation = await renderScreen({
          previousRoutes: [recipesRoute, recipeDetailRoute('r9')],
        });

        await user.press(recipeLink());

        expect(navigation.push).toHaveBeenCalledTimes(1);
        expect(navigation.push).toHaveBeenCalledWith(Screens.RecipeDetail, {
          recipeId: 'r1',
        });
        expect(navigation.goBack).not.toHaveBeenCalled();
        expect(navigation.navigate).not.toHaveBeenCalled();
      });
    });

    it('shows only the full date and duration in the meta line', async () => {
      mockQueries();
      await renderScreen();

      expect(screen.getByTestId('attempt-detail-meta')).toHaveTextContent(
        'September 21, 2026 · 42 min',
        { exact: true },
      );
    });

    it('formats longer durations in hours', async () => {
      mockQueries({ attempt: { data: makeAttempt({ durationMinutes: 65 }) } });
      await renderScreen();

      expect(screen.getByTestId('attempt-detail-meta')).toHaveTextContent(
        'September 21, 2026 · 1 hr 5 min',
        { exact: true },
      );
    });

    it('leaves out a missing duration', async () => {
      mockQueries({
        attempt: { data: makeAttempt({ rating: null, durationMinutes: null }) },
      });
      await renderScreen();

      expect(screen.getByTestId('attempt-detail-meta')).toHaveTextContent(
        'September 21, 2026',
        { exact: true },
      );
    });

    it.each([1, 4, 5])(
      'shows a %i-star rating as editable stars, not a Rate link',
      async rating => {
        mockQueries({ attempt: { data: makeAttempt({ rating }) } });
        await renderScreen();

        for (const count of [1, 2, 3, 4, 5]) {
          const item = ratingStar(count);
          expect(item).toHaveTextContent(count <= rating ? '★' : '☆');
          if (count === rating) {
            expect(item).toBeChecked();
          } else {
            expect(item).not.toBeChecked();
          }
          expect(item).toBeEnabled();
        }
        expect(
          screen.queryByRole('button', { name: 'Rate' }),
        ).not.toBeOnTheScreen();
      },
    );

    it('shows a Rate link and no stars when unrated', async () => {
      mockQueries({ attempt: { data: makeAttempt({ rating: null }) } });
      await renderScreen();

      expect(screen.getByRole('button', { name: 'Rate' })).toBeOnTheScreen();
      expect(
        screen.queryByRole('radio', { name: /stars?$/ }),
      ).not.toBeOnTheScreen();
    });

    describe('nutrient dots', () => {
      const egg: IngredientSummary = {
        id: 'i-egg',
        name: 'Egg',
        mainGroup: FoodGroup.Protein,
        nutrients: [FoodGroup.Protein],
      };
      const lentils: IngredientSummary = {
        id: 'i-lentils',
        name: 'Lentils',
        mainGroup: FoodGroup.Fiber,
        nutrients: [FoodGroup.Fiber, FoodGroup.Protein],
      };
      const salt: IngredientSummary = {
        id: 'i-salt',
        name: 'Salt',
        mainGroup: null,
        nutrients: [],
      };
      const line = (
        position: number,
        text: string,
        ingredient: IngredientSummary | null,
      ): RecipeLine => ({
        position,
        text,
        linkSetByOwner: false,
        ingredient,
      });
      const dots = () => screen.getByTestId('attempt-detail-nutrient-dots');
      const queryDots = () =>
        screen.queryByTestId('attempt-detail-nutrient-dots');
      const dot = (id: string) =>
        screen.getByTestId(`attempt-detail-nutrient-dots-dot-${id}`);

      it("shows what the recipe's linked lines bring, beside the date", async () => {
        mockQueries({
          recipe: {
            data: makeRecipe({
              lines: [
                line(0, '# Soup', null),
                line(1, '2 eggs', egg),
                line(2, '1 cup lentils', lentils),
                line(3, 'a pinch of something', null),
              ],
            }),
          },
        });
        await renderScreen();

        expect(dots()).toBe(
          screen.getByRole('image', {
            name: 'Has protein and fiber, no healthy fat yet',
          }),
        );
        // In the meta row, next to the date.
        expect(
          screen.getByTestId('attempt-detail-meta').parent,
        ).toContainElement(dots());
        expect(dot('protein')).toHaveStyle({ backgroundColor: colors.accent });
        expect(dot('fiber')).toHaveStyle({ backgroundColor: colors.accent });
        expect(dot('healthy-fat')).not.toHaveStyle({
          backgroundColor: colors.accent,
        });
      });

      it('reads "Has …" alone once every nutrient is covered', async () => {
        const oil: IngredientSummary = {
          id: 'i-oil',
          name: 'Olive oil',
          mainGroup: FoodGroup.HealthyFat,
          nutrients: [FoodGroup.HealthyFat],
        };
        mockQueries({
          recipe: {
            data: makeRecipe({
              lines: [line(0, 'lentils', lentils), line(1, 'oil', oil)],
            }),
          },
        });
        await renderScreen();

        expect(dots()).toHaveAccessibleName(
          'Has protein, fiber and healthy fat',
        );
      });

      it('shows empty dots for linked lines that bring no nutrient', async () => {
        mockQueries({
          recipe: { data: makeRecipe({ lines: [line(0, 'salt', salt)] }) },
        });
        await renderScreen();

        expect(dots()).toHaveAccessibleName(
          'No protein, fiber or healthy fat yet',
        );
      });

      it.each<[string, RecipeLine[]]>([
        ['the recipe has no lines', []],
        [
          'no line is linked (headings and unmatched lines only)',
          [line(0, '# Soup', null), line(1, '1 cup flour', null)],
        ],
      ])('shows no dots when %s', async (_label, lines) => {
        mockQueries({ recipe: { data: makeRecipe({ lines }) } });
        await renderScreen();

        expect(queryDots()).not.toBeOnTheScreen();
        expect(screen.queryByRole('image')).not.toBeOnTheScreen();
        // The date is still there.
        expect(screen.getByTestId('attempt-detail-meta')).toHaveTextContent(
          'September 21, 2026 · 42 min',
          { exact: true },
        );
      });
    });
  });

  describe('feedback placement', () => {
    const indexOf = (ids: string[], id: string) => {
      const index = ids.indexOf(id);
      expect(index).toBeGreaterThanOrEqual(0);
      return index;
    };

    it.each<[string, number, string]>([
      ['the stars', 4, 'attempt-detail-rating-star-1'],
      ['the Rate link', 0, 'attempt-detail-rate-link'],
    ])(
      'puts %s, enjoyment and fullness after the version card and before Cook again',
      async (_label, rating, ratingID) => {
        mockQueries({
          attempt: { data: makeAttempt({ rating: rating || null }) },
        });
        await renderScreen();

        const version = screen.getByTestId('attempt-detail-version');
        const feedback = [
          ratingID,
          'attempt-detail-enjoyment-loved',
          'attempt-detail-fullness-satisfied',
        ];
        // Not inside the card, so coming later in pre-order means after it.
        for (const id of feedback) {
          expect(version).not.toContainElement(screen.getByTestId(id));
        }

        const ids = testIDsInOrder();
        const at = (id: string) => indexOf(ids, id);
        expect(at('attempt-detail-meta')).toBeLessThan(
          at('attempt-detail-version'),
        );
        expect(at('attempt-detail-version')).toBeLessThan(at(feedback[0]));
        expect(at(feedback[0])).toBeLessThan(at(feedback[1]));
        expect(at(feedback[1])).toBeLessThan(at(feedback[2]));
        expect(at(feedback[2])).toBeLessThan(
          at('attempt-detail-cook-again-button'),
        );
      },
    );
  });

  describe('notes', () => {
    it('shows the notes as written', async () => {
      const notes = 'More salt next time.\n\nBlend it longer.';
      mockQueries({ attempt: { data: makeAttempt({ notes }) } });
      await renderScreen();

      expect(screen.getByText('NOTES')).toBeOnTheScreen();
      expect(screen.getByTestId('attempt-detail-notes')).toHaveTextContent(
        notes,
        { normalizer: (text: string) => text },
      );
      expect(screen.queryByText('No notes.')).not.toBeOnTheScreen();
    });

    it('says "No notes." when there are none', async () => {
      mockQueries();
      await renderScreen();

      expect(screen.getByTestId('attempt-detail-notes')).toHaveTextContent(
        'No notes.',
        { exact: true },
      );
    });
  });

  describe('based on', () => {
    it('has no link when the attempt was not based on another', async () => {
      mockQueries();
      await renderScreen();

      expect(
        screen.queryByRole('link', { name: /^Based on/ }),
      ).not.toBeOnTheScreen();
      expect(screen.queryByText(/^Based on/)).not.toBeOnTheScreen();
    });

    it('links to the attempt it was based on, pushing a new detail screen', async () => {
      const user = userEvent.setup();
      mockQueries({
        attempt: {
          data: makeAttempt({
            basedOnAttemptId: 'a1',
            basedOnAttempt: { id: 'a1', madeAt: '2026-08-15T12:00:00.000Z' },
          }),
        },
      });
      const navigation = await renderScreen();

      const link = screen.getByRole('link', { name: 'Based on Aug 15 ›' });
      await user.press(link);

      expect(navigation.push).toHaveBeenCalledTimes(1);
      expect(navigation.push).toHaveBeenCalledWith(Screens.AttemptDetail, {
        recipeId: 'r1',
        attemptId: 'a1',
      });
      expect(navigation.navigate).not.toHaveBeenCalled();
    });

    it('adds the year when the earlier attempt is from another year', async () => {
      mockQueries({
        attempt: {
          data: makeAttempt({
            basedOnAttemptId: 'a1',
            basedOnAttempt: { id: 'a1', madeAt: '2025-08-15T12:00:00.000Z' },
          }),
        },
      });
      await renderScreen();

      expect(
        screen.getByRole('link', { name: 'Based on Aug 15, 2025 ›' }),
      ).toBeOnTheScreen();
    });
  });

  describe('this version', () => {
    // The recipe from makeRecipe: ingredients "1 can tomatoes", "1 onion",
    // "salt"; steps "Chop the onion.", "Simmer everything.", "Blend.".
    const withEditedIngredient = () =>
      makeAttempt({
        ingredients: [
          { text: '2 cans tomatoes' },
          { text: '1 onion' },
          { text: 'salt' },
        ],
      });
    const withEditedStep = () =>
      makeAttempt({
        instructions: 'Chop the onion.\nSimmer for 20 minutes.\nBlend.',
      });

    it('says "Cooked as the recipe" with no switch when nothing changed', async () => {
      mockQueries();
      await renderScreen();

      expect(
        within(screen.getByTestId('attempt-detail-version')).getByText(
          'THIS VERSION',
        ),
      ).toBeOnTheScreen();
      expect(
        screen.getByTestId('attempt-detail-unchanged-text'),
      ).toHaveTextContent('Cooked as the recipe', { exact: true });
      expect(screen.queryByRole('tab')).not.toBeOnTheScreen();
      expect(screen.queryByText('No changes')).not.toBeOnTheScreen();
      expect(
        screen.queryByTestId(/^attempt-detail-(ingredient|step)-change-/),
      ).not.toBeOnTheScreen();
      // The full lines are still shown.
      expect(fullLine('ingredient', 0)).toBeOnTheScreen();
      expect(fullLine('step', 0)).toBeOnTheScreen();
    });

    it('shows no "Cooked as the recipe" once something changed', async () => {
      mockQueries({ attempt: { data: withEditedIngredient() } });
      await renderScreen();

      expect(
        screen.queryByTestId('attempt-detail-unchanged-text'),
      ).not.toBeOnTheScreen();
      expect(screen.queryByText('Cooked as the recipe')).not.toBeOnTheScreen();
    });

    it.each<[string, AttemptDetail]>([
      [
        'steps that differ only in blank lines and outer spaces',
        makeAttempt({
          instructions:
            '\n  Chop the onion.  \n\n\nSimmer everything.\n   \nBlend.\n',
        }),
      ],
      [
        'saved lists that match the recipe',
        makeAttempt({
          ingredients: [
            { text: '1 can tomatoes' },
            { text: '1 onion' },
            { text: 'salt' },
          ],
          instructions: 'Chop the onion.\nSimmer everything.\nBlend.',
        }),
      ],
    ])('counts %s as cooked as the recipe', async (_label, attempt) => {
      mockQueries({ attempt: { data: attempt } });
      await renderScreen();

      expect(
        screen.getByTestId('attempt-detail-unchanged-text'),
      ).toBeOnTheScreen();
      expect(screen.queryByRole('tab')).not.toBeOnTheScreen();
    });

    it('compares with the recipe as it is now, so a later matching edit leaves no changes', async () => {
      // The attempt changed the recipe, and the recipe was later edited to
      // match what was cooked.
      mockQueries({
        attempt: {
          data: makeAttempt({
            ingredients: [{ text: '2 cans tomatoes' }, { text: '1 onion' }],
            instructions: 'Chop the onion.\nSimmer for 20 minutes.',
          }),
        },
        recipe: {
          data: makeRecipe({
            ingredients: ['2 cans tomatoes', '1 onion'],
            instructions: 'Chop the onion.\nSimmer for 20 minutes.',
          }),
        },
      });
      await renderScreen();

      expect(
        screen.getByTestId('attempt-detail-unchanged-text'),
      ).toBeOnTheScreen();
      expect(screen.queryByRole('tab')).not.toBeOnTheScreen();
      expect(fullLine('ingredient', 0)).toHaveAccessibleName('2 cans tomatoes');
      expect(fullLine('step', 1)).toHaveAccessibleName(
        'Simmer for 20 minutes.',
      );
    });

    describe('Full view', () => {
      it('is the selected tab by default when something changed', async () => {
        mockQueries({ attempt: { data: withEditedIngredient() } });
        await renderScreen();

        expect(fullTab()).toBeSelected();
        expect(changesTab()).not.toBeSelected();
        expect(fullLine('ingredient', 0)).toBeOnTheScreen();
        expect(
          screen.queryByTestId(/^attempt-detail-(ingredient|step)-change-/),
        ).not.toBeOnTheScreen();
      });

      it("shows today's recipe unmarked when the attempt saved no lists", async () => {
        mockQueries();
        await renderScreen();

        const ingredients = ['1 can tomatoes', '1 onion', 'salt'];
        ingredients.forEach((text, index) => {
          const line = fullLine('ingredient', index);
          expect(line).toHaveAccessibleName(text);
          expect(within(line).getByText(text)).not.toHaveStyle({
            textDecorationLine: 'line-through',
          });
          expect(within(line).queryByText('+')).not.toBeOnTheScreen();
        });
        expect(queryFullLine('ingredient', 3)).not.toBeOnTheScreen();

        const steps = ['Chop the onion.', 'Simmer everything.', 'Blend.'];
        steps.forEach((text, index) => {
          const line = fullLine('step', index);
          expect(line).toHaveAccessibleName(text);
          expect(within(line).getByText(String(index + 1))).toBeOnTheScreen();
          expect(within(line).queryByText('+')).not.toBeOnTheScreen();
        });
        expect(queryFullLine('step', 3)).not.toBeOnTheScreen();
      });

      it('keeps a removed line in place, struck through and muted, followed by the added one', async () => {
        mockQueries({ attempt: { data: withEditedIngredient() } });
        await renderScreen();

        const removed = fullLine('ingredient', 0);
        expect(removed).toHaveAccessibleName('Removed: 1 can tomatoes');
        expect(within(removed).getByText('1 can tomatoes')).toHaveStyle({
          textDecorationLine: 'line-through',
          color: colors.inkMuted,
        });
        expect(within(removed).queryByText('+')).not.toBeOnTheScreen();

        const added = fullLine('ingredient', 1);
        expect(added).toHaveAccessibleName('Added: 2 cans tomatoes');
        expect(within(added).getByText('+')).toBeOnTheScreen();
        expect(within(added).getByText('2 cans tomatoes')).not.toHaveStyle({
          textDecorationLine: 'line-through',
        });

        // Unchanged lines keep their plain text as the label, and the index
        // counts the removed line too.
        expect(fullLine('ingredient', 2)).toHaveAccessibleName('1 onion');
        expect(fullLine('ingredient', 3)).toHaveAccessibleName('salt');
        expect(queryFullLine('ingredient', 4)).not.toBeOnTheScreen();
      });

      it('marks an added line at the start and a removed one further down', async () => {
        mockQueries({
          attempt: {
            data: makeAttempt({
              ingredients: [
                { text: 'olive oil' },
                { text: '1 can tomatoes' },
                { text: 'salt' },
              ],
            }),
          },
        });
        await renderScreen();

        expect(
          [0, 1, 2, 3].map(
            index => fullLine('ingredient', index).props.accessibilityLabel,
          ),
        ).toEqual([
          'Added: olive oil',
          '1 can tomatoes',
          'Removed: 1 onion',
          'salt',
        ]);
      });

      it.each<[string, string, [string, string][]]>([
        [
          'an edited step',
          'Chop the onion.\nSimmer for 20 minutes.\nBlend.',
          [
            ['Chop the onion.', '1'],
            ['Removed: Simmer everything.', ''],
            ['Added: Simmer for 20 minutes.', '2'],
            ['Blend.', '3'],
          ],
        ],
        [
          'a dropped first step',
          'Simmer everything.\nBlend.',
          [
            ['Removed: Chop the onion.', ''],
            ['Simmer everything.', '1'],
            ['Blend.', '2'],
          ],
        ],
      ])(
        'numbers steps as cooked, skipping removed ones (%s)',
        async (_label, instructions, expected) => {
          mockQueries({ attempt: { data: makeAttempt({ instructions }) } });
          await renderScreen();

          expected.forEach(([label, number], index) => {
            const line = fullLine('step', index);
            expect(line).toHaveAccessibleName(label);
            if (number) {
              expect(within(line).getByText(number)).toBeOnTheScreen();
            } else {
              expect(within(line).queryByText(/^\d+$/)).not.toBeOnTheScreen();
            }
          });
          expect(queryFullLine('step', expected.length)).not.toBeOnTheScreen();
        },
      );

      it('shows headings without # or a number, and a renamed heading as removed and added', async () => {
        mockQueries({
          recipe: {
            data: makeRecipe({
              instructions:
                '# For the base\nChop the onion.\n# For the soup\nSimmer everything.\nBlend.',
            }),
          },
          attempt: {
            data: makeAttempt({
              instructions:
                '# For the base\nChop the onion.\n# For the broth\nSimmer everything.\nBlend.',
            }),
          },
        });
        await renderScreen();

        const expected: [string, string | null][] = [
          ['For the base', null],
          ['Chop the onion.', '1'],
          ['For the soup', null],
          ['For the broth', null],
          ['Simmer everything.', '2'],
          ['Blend.', '3'],
        ];
        expected.forEach(([text, number], index) => {
          const line = fullLine('step', index);
          expect(within(line).getByText(text)).toBeOnTheScreen();
          expect(within(line).queryByText(/#/)).not.toBeOnTheScreen();
          if (number) {
            expect(within(line).getByText(number)).toBeOnTheScreen();
          } else {
            expect(within(line).queryByText(/^\d+$/)).not.toBeOnTheScreen();
          }
        });
        expect(queryFullLine('step', expected.length)).not.toBeOnTheScreen();

        // The rename is a change like any other line.
        expect(fullLine('step', 2)).toHaveAccessibleName(/^Removed: /);
        expect(
          within(fullLine('step', 2)).getByText('For the soup'),
        ).toHaveStyle({ textDecorationLine: 'line-through' });
        expect(fullLine('step', 3)).toHaveAccessibleName(/^Added: /);
        expect(within(fullLine('step', 3)).getByText('+')).toBeOnTheScreen();
      });

      it('shows ingredient headings without #', async () => {
        mockQueries({
          attempt: {
            data: makeAttempt({
              ingredients: [
                { text: '# For the soup' },
                { text: '1 can tomatoes' },
                { text: '1 onion' },
                { text: 'salt' },
              ],
            }),
          },
        });
        await renderScreen();

        const heading = fullLine('ingredient', 0);
        expect(heading).toHaveAccessibleName(/^Added: /);
        expect(within(heading).getByText('For the soup')).toBeOnTheScreen();
        expect(within(heading).queryByText(/#/)).not.toBeOnTheScreen();
        expect(fullLine('ingredient', 1)).toHaveAccessibleName(
          '1 can tomatoes',
        );
      });

      it('switches to Changes and back', async () => {
        const user = userEvent.setup();
        mockQueries({ attempt: { data: withEditedStep() } });
        await renderScreen();

        await user.press(changesTab());

        expect(changesTab()).toBeSelected();
        expect(fullTab()).not.toBeSelected();
        expect(stepChange(0)).toHaveAccessibleName(
          'Removed: Simmer everything.',
        );
        expect(
          screen.queryByTestId(/^attempt-detail-line-/),
        ).not.toBeOnTheScreen();

        await user.press(fullTab());

        expect(fullTab()).toBeSelected();
        expect(changesTab()).not.toBeSelected();
        expect(fullLine('step', 1)).toHaveAccessibleName(
          'Removed: Simmer everything.',
        );
        expect(
          screen.queryByTestId(/^attempt-detail-(ingredient|step)-change-/),
        ).not.toBeOnTheScreen();
        expect(screen.queryByText('No changes')).not.toBeOnTheScreen();
      });
    });

    describe('Changes view', () => {
      async function showChanges() {
        const user = userEvent.setup();
        await user.press(changesTab());
      }

      it('shows an edited ingredient as the old line struck through, then the new one', async () => {
        mockQueries({ attempt: { data: withEditedIngredient() } });
        await renderScreen();
        await showChanges();

        const removedRow = ingredientChange(0);
        expect(removedRow).toHaveTextContent('  1 can tomatoes', {
          exact: true,
          ...keepSpaces,
        });
        expect(removedRow).toHaveAccessibleName('Removed: 1 can tomatoes');
        // Only the text is struck through, not the leading spaces.
        expect(removedRow).not.toHaveStyle({
          textDecorationLine: 'line-through',
        });
        expect(
          within(removedRow).getByText('1 can tomatoes', keepSpaces),
        ).toHaveStyle({ textDecorationLine: 'line-through' });

        const addedRow = ingredientChange(1);
        expect(addedRow).toHaveTextContent('+ 2 cans tomatoes', {
          exact: true,
        });
        expect(addedRow).toHaveAccessibleName('Added: 2 cans tomatoes');
        expect(addedRow).not.toHaveStyle({
          textDecorationLine: 'line-through',
        });
        expect(
          within(addedRow).getByText('2 cans tomatoes', keepSpaces),
        ).not.toHaveStyle({ textDecorationLine: 'line-through' });

        expect(
          screen.queryByTestId('attempt-detail-ingredient-change-2'),
        ).not.toBeOnTheScreen();
        expect(
          within(group('Ingredients')).queryByText('No changes'),
        ).not.toBeOnTheScreen();
        expect(
          within(group('Steps')).getByText('No changes'),
        ).toBeOnTheScreen();
      });

      it('lists added and removed ingredients in reading order', async () => {
        mockQueries({
          attempt: {
            data: makeAttempt({
              ingredients: [
                { text: 'olive oil' },
                { text: '1 can tomatoes' },
                { text: 'salt' },
              ],
            }),
          },
        });
        await renderScreen();
        await showChanges();

        expect(ingredientChange(0)).toHaveAccessibleName('Added: olive oil');
        expect(ingredientChange(1)).toHaveAccessibleName('Removed: 1 onion');
        expect(
          screen.queryByTestId('attempt-detail-ingredient-change-2'),
        ).not.toBeOnTheScreen();
      });

      it('compares the steps line by line, ignoring blank lines and outer spaces', async () => {
        mockQueries({
          attempt: {
            data: makeAttempt({
              instructions:
                '  Chop the onion.  \n\n\nSimmer for 20 minutes.\n   \nBlend.\n',
            }),
          },
        });
        await renderScreen();
        await showChanges();

        expect(stepChange(0)).toHaveAccessibleName(
          'Removed: Simmer everything.',
        );
        expect(
          within(stepChange(0)).getByText('Simmer everything.', keepSpaces),
        ).toHaveStyle({ textDecorationLine: 'line-through' });
        expect(stepChange(1)).toHaveAccessibleName(
          'Added: Simmer for 20 minutes.',
        );
        expect(stepChange(1)).toHaveTextContent('+ Simmer for 20 minutes.', {
          exact: true,
        });
        expect(
          screen.queryByTestId('attempt-detail-step-change-2'),
        ).not.toBeOnTheScreen();
        expect(
          within(group('Ingredients')).getByText('No changes'),
        ).toBeOnTheScreen();
      });

      it('shows recipe edits made after the attempt as changes too', async () => {
        // The attempt matched the recipe at the time (null would mean that),
        // but here it stored its own list and the recipe moved on since.
        mockQueries({
          attempt: {
            data: makeAttempt({
              ingredients: [{ text: '1 can tomatoes' }, { text: '1 onion' }],
            }),
          },
          recipe: {
            data: makeRecipe({
              ingredients: ['1 can tomatoes', '1 onion', 'basil'],
            }),
          },
        });
        await renderScreen();
        await showChanges();

        expect(ingredientChange(0)).toHaveAccessibleName('Removed: basil');
        expect(
          screen.queryByTestId('attempt-detail-ingredient-change-1'),
        ).not.toBeOnTheScreen();
      });
    });
  });
});

describe('AttemptDetailScreen rating editor', () => {
  it('opens the stars from the Rate link and saves the tapped rating', async () => {
    const user = userEvent.setup();
    mockedClient.updateAttempt.mockResolvedValue(makeAttempt({ rating: 4 }));
    await renderWithCachedAttempt(makeAttempt({ rating: null }));

    await user.press(screen.getByRole('button', { name: 'Rate' }));

    expect(
      screen.queryByRole('button', { name: 'Rate' }),
    ).not.toBeOnTheScreen();
    for (const count of [1, 2, 3, 4, 5]) {
      expect(ratingStar(count)).not.toBeChecked();
    }
    expect(mockedClient.updateAttempt).not.toHaveBeenCalled();

    await user.press(ratingStar(4));

    expect(mockedClient.updateAttempt).toHaveBeenCalledTimes(1);
    expect(mockedClient.updateAttempt).toHaveBeenCalledWith('tok', 'a2', {
      rating: 4,
    });
    expect(ratingStar(4)).toBeChecked();
    expect(ratingStar(4)).toBeEnabled();
    expect(
      queryClient.getQueryData<AttemptDetail>(attemptKeys.detail('a2'))?.rating,
    ).toBe(4);
  });

  it('changes an existing rating, showing the new one while it saves', async () => {
    const user = userEvent.setup();
    const save = deferred<AttemptDetail>();
    mockedClient.updateAttempt.mockReturnValue(save.promise);
    await renderWithCachedAttempt(makeAttempt({ rating: 4 }));

    await user.press(ratingStar(2));

    expect(mockedClient.updateAttempt).toHaveBeenCalledWith('tok', 'a2', {
      rating: 2,
    });
    expect(ratingStar(2)).toBeChecked();
    expect(ratingStar(4)).not.toBeChecked();
    expect(ratingStar(4)).toHaveTextContent('☆');
    expect(ratingStar(5)).toBeDisabled();

    await act(async () => {
      save.resolve(makeAttempt({ rating: 2 }));
    });

    await waitFor(() => expect(ratingStar(5)).toBeEnabled());
    expect(ratingStar(2)).toBeChecked();
  });

  it('clears the rating when the current star is tapped, going back to the Rate link', async () => {
    const user = userEvent.setup();
    mockedClient.updateAttempt.mockResolvedValue(makeAttempt({ rating: null }));
    await renderWithCachedAttempt(makeAttempt({ rating: 4 }));

    await user.press(ratingStar(4));

    expect(mockedClient.updateAttempt).toHaveBeenCalledWith('tok', 'a2', {
      rating: null,
    });
    expect(
      await screen.findByRole('button', { name: 'Rate' }),
    ).toBeOnTheScreen();
    expect(
      screen.queryByRole('radio', { name: /stars?$/ }),
    ).not.toBeOnTheScreen();
  });

  it('shows the error and keeps the saved rating when saving fails', async () => {
    const user = userEvent.setup();
    mockedClient.updateAttempt.mockRejectedValue(
      new RecipesError('Attempt not found', 404),
    );
    await renderWithCachedAttempt(makeAttempt({ rating: 4 }));

    await user.press(ratingStar(1));

    expect(
      await screen.findByTestId('attempt-detail-rating-error-text'),
    ).toHaveTextContent('Attempt not found', { exact: true });
    expect(ratingStar(4)).toBeChecked();
    expect(ratingStar(1)).toBeEnabled();
  });

  it('keeps showing the saved rating even before the cached attempt catches up', async () => {
    // useAttempt is mocked here, so the screen keeps getting the old attempt
    // (rating 4) after the save, like the moment before the cache update
    // reaches it in the app.
    const user = userEvent.setup();
    const save = deferred<AttemptDetail>();
    mockedClient.updateAttempt.mockReturnValue(save.promise);
    mockQueries({ attempt: { data: makeAttempt({ rating: 4 }) } });
    await renderScreen();

    await user.press(ratingStar(2));
    expect(ratingStar(2)).toBeChecked();

    await act(async () => {
      save.resolve(makeAttempt({ rating: 2 }));
    });

    await waitFor(() => expect(ratingStar(5)).toBeEnabled());
    expect(ratingStar(2)).toBeChecked();
    expect(ratingStar(4)).not.toBeChecked();
    expect(ratingStar(4)).toHaveTextContent('☆');
  });

  describe('"Saved ✓"', () => {
    const savedText = () => screen.getByText('Saved ✓');
    const querySavedText = () => screen.queryByText('Saved ✓');

    it('is not shown before anything is saved', async () => {
      await renderWithCachedAttempt(makeAttempt({ rating: 4 }));

      expect(querySavedText()).not.toBeOnTheScreen();
    });

    it(`shows next to the stars after a save, for ${SAVED_VISIBLE_MS} ms`, async () => {
      const user = userEvent.setup();
      const save = deferred<AttemptDetail>();
      mockedClient.updateAttempt.mockReturnValue(save.promise);
      await renderWithCachedAttempt(makeAttempt({ rating: 4 }));

      await user.press(ratingStar(2));
      // Not while it is still saving.
      expect(querySavedText()).not.toBeOnTheScreen();

      await act(async () => {
        save.resolve(makeAttempt({ rating: 2 }));
      });

      expect(savedText()).toBeOnTheScreen();
      expect(savedText()).toHaveProp('accessibilityLiveRegion', 'polite');
      expect(ratingStar(2)).toBeChecked();

      await act(async () => {
        jest.advanceTimersByTime(SAVED_VISIBLE_MS - 1);
      });
      expect(savedText()).toBeOnTheScreen();

      await act(async () => {
        jest.advanceTimersByTime(1);
      });
      expect(querySavedText()).not.toBeOnTheScreen();
      // The stars stay, with the saved rating.
      expect(ratingStar(2)).toBeChecked();
      expect(ratingStar(2)).toBeEnabled();
    });

    it('also shows after the first rating is set from the Rate link', async () => {
      const user = userEvent.setup();
      mockedClient.updateAttempt.mockResolvedValue(makeAttempt({ rating: 5 }));
      await renderWithCachedAttempt(makeAttempt({ rating: null }));

      await user.press(screen.getByRole('button', { name: 'Rate' }));
      await user.press(ratingStar(5));

      expect(await screen.findByText('Saved ✓')).toBeOnTheScreen();
      expect(ratingStar(5)).toBeChecked();
    });

    it('restarts its timer when another save finishes while it shows', async () => {
      const user = userEvent.setup();
      const first = deferred<AttemptDetail>();
      const second = deferred<AttemptDetail>();
      mockedClient.updateAttempt
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise);
      await renderWithCachedAttempt(makeAttempt({ rating: 4 }));

      await user.press(ratingStar(2));
      await act(async () => {
        first.resolve(makeAttempt({ rating: 2 }));
      });
      expect(savedText()).toBeOnTheScreen();

      await act(async () => {
        jest.advanceTimersByTime(SAVED_VISIBLE_MS - 500);
      });
      await user.press(ratingStar(3));
      await act(async () => {
        second.resolve(makeAttempt({ rating: 3 }));
      });
      expect(savedText()).toBeOnTheScreen();

      // Past the point where the first timer would have hidden it.
      await act(async () => {
        jest.advanceTimersByTime(SAVED_VISIBLE_MS - 1);
      });
      expect(savedText()).toBeOnTheScreen();
      expect(ratingStar(3)).toBeChecked();

      await act(async () => {
        jest.advanceTimersByTime(1);
      });
      expect(querySavedText()).not.toBeOnTheScreen();
    });

    it('hides as soon as a new star is tapped, and shows again once that saves', async () => {
      const user = userEvent.setup();
      const second = deferred<AttemptDetail>();
      mockedClient.updateAttempt
        .mockResolvedValueOnce(makeAttempt({ rating: 2 }))
        .mockReturnValueOnce(second.promise);
      await renderWithCachedAttempt(makeAttempt({ rating: 4 }));

      await user.press(ratingStar(2));
      expect(await screen.findByText('Saved ✓')).toBeOnTheScreen();

      await user.press(ratingStar(5));

      expect(querySavedText()).not.toBeOnTheScreen();
      expect(ratingStar(5)).toBeChecked();
      expect(ratingStar(1)).toBeDisabled();

      await act(async () => {
        second.resolve(makeAttempt({ rating: 5 }));
      });

      expect(savedText()).toBeOnTheScreen();
      expect(ratingStar(5)).toBeChecked();
    });

    it('is not shown when the save cleared the rating, even after reopening the stars', async () => {
      const user = userEvent.setup();
      mockedClient.updateAttempt.mockResolvedValue(
        makeAttempt({ rating: null }),
      );
      await renderWithCachedAttempt(makeAttempt({ rating: 4 }));

      await user.press(ratingStar(4));

      expect(
        await screen.findByRole('button', { name: 'Rate' }),
      ).toBeOnTheScreen();
      expect(querySavedText()).not.toBeOnTheScreen();

      await user.press(screen.getByRole('button', { name: 'Rate' }));

      expect(ratingStar(1)).toBeOnTheScreen();
      expect(querySavedText()).not.toBeOnTheScreen();
    });

    it('is not shown when the save fails', async () => {
      const user = userEvent.setup();
      mockedClient.updateAttempt.mockRejectedValue(
        new TypeError('Network request failed'),
      );
      await renderWithCachedAttempt(makeAttempt({ rating: 4 }));

      await user.press(ratingStar(2));

      expect(
        await screen.findByTestId('attempt-detail-rating-error-text'),
      ).toHaveTextContent('Network request failed', { exact: true });
      expect(querySavedText()).not.toBeOnTheScreen();

      await act(async () => {
        jest.advanceTimersByTime(SAVED_VISIBLE_MS);
      });
      expect(querySavedText()).not.toBeOnTheScreen();
    });
  });
});

describe('AttemptDetailScreen notes editor', () => {
  const editButton = () => screen.getByRole('button', { name: 'Edit notes' });
  const saveButton = () => screen.getByRole('button', { name: 'Save' });
  const cancelButton = () => screen.getByRole('button', { name: 'Cancel' });

  it('opens an input prefilled with the notes, in place of the text', async () => {
    const user = userEvent.setup();
    await renderWithCachedAttempt(makeAttempt({ notes: 'More salt.' }));

    await user.press(editButton());

    expect(notesInput()).toHaveDisplayValue('More salt.');
    expect(saveButton()).toBeEnabled();
    expect(cancelButton()).toBeOnTheScreen();
    expect(screen.queryByTestId('attempt-detail-notes')).not.toBeOnTheScreen();
    expect(
      screen.queryByRole('button', { name: 'Edit notes' }),
    ).not.toBeOnTheScreen();
  });

  it('starts empty when there are no notes', async () => {
    const user = userEvent.setup();
    await renderWithCachedAttempt(makeAttempt({ notes: null }));

    await user.press(editButton());

    expect(notesInput()).toHaveDisplayValue('');
    expect(
      screen.getByPlaceholderText('How was it? Anything to change next time?'),
    ).toBeOnTheScreen();
  });

  it('saves only the notes and shows the saved text', async () => {
    const user = userEvent.setup();
    const save = deferred<AttemptDetail>();
    mockedClient.updateAttempt.mockReturnValue(save.promise);
    await renderWithCachedAttempt(makeAttempt({ notes: 'More salt.' }));

    await user.press(editButton());
    await user.clear(notesInput());
    await user.type(notesInput(), 'Even better the next day.');
    await user.press(saveButton());

    expect(mockedClient.updateAttempt).toHaveBeenCalledTimes(1);
    expect(mockedClient.updateAttempt).toHaveBeenCalledWith('tok', 'a2', {
      notes: 'Even better the next day.',
    });
    // While saving: a busy, disabled Save and a locked input.
    const busySave = screen.getByTestId('attempt-detail-notes-save-button');
    expect(busySave).toBeDisabled();
    expect(busySave).toBeBusy();
    expect(cancelButton()).toBeDisabled();
    expect(notesInput()).toHaveProp('editable', false);

    await act(async () => {
      save.resolve(makeAttempt({ notes: 'Even better the next day.' }));
    });

    expect(
      await screen.findByText('Even better the next day.'),
    ).toBeOnTheScreen();
    expect(screen.getByTestId('attempt-detail-notes')).toHaveTextContent(
      'Even better the next day.',
      { exact: true },
    );
    expect(screen.queryByLabelText('Notes')).not.toBeOnTheScreen();
    expect(editButton()).toBeOnTheScreen();
  });

  it('shows "No notes." after saving blank notes (the server stores null)', async () => {
    const user = userEvent.setup();
    mockedClient.updateAttempt.mockResolvedValue(makeAttempt({ notes: null }));
    await renderWithCachedAttempt(makeAttempt({ notes: 'More salt.' }));

    await user.press(editButton());
    await user.clear(notesInput());
    await user.press(saveButton());

    expect(mockedClient.updateAttempt).toHaveBeenCalledWith('tok', 'a2', {
      notes: '',
    });
    expect(await screen.findByTestId('attempt-detail-notes')).toHaveTextContent(
      'No notes.',
      { exact: true },
    );
  });

  it('cancels without saving and forgets the draft', async () => {
    const user = userEvent.setup();
    await renderWithCachedAttempt(makeAttempt({ notes: 'More salt.' }));

    await user.press(editButton());
    await user.type(notesInput(), ' And pepper.');
    await user.press(cancelButton());

    expect(mockedClient.updateAttempt).not.toHaveBeenCalled();
    expect(screen.getByTestId('attempt-detail-notes')).toHaveTextContent(
      'More salt.',
      { exact: true },
    );

    await user.press(editButton());
    expect(notesInput()).toHaveDisplayValue('More salt.');
  });

  it('keeps the draft and shows the error when saving fails; reopening clears the error', async () => {
    const user = userEvent.setup();
    mockedClient.updateAttempt.mockRejectedValue(
      new TypeError('Network request failed'),
    );
    await renderWithCachedAttempt(makeAttempt({ notes: null }));

    await user.press(editButton());
    await user.type(notesInput(), 'Too spicy.');
    await user.press(saveButton());

    expect(
      await screen.findByTestId('attempt-detail-notes-error-text'),
    ).toHaveTextContent('Network request failed', { exact: true });
    expect(notesInput()).toHaveDisplayValue('Too spicy.');
    expect(saveButton()).toBeEnabled();

    await user.press(cancelButton());
    await user.press(editButton());

    expect(
      screen.queryByTestId('attempt-detail-notes-error-text'),
    ).not.toBeOnTheScreen();
  });
});

describe('AttemptDetailScreen fullness editor', () => {
  const fullness = (name: string) => screen.getByRole('radio', { name });
  const errorText = () =>
    screen.queryByTestId('attempt-detail-fullness-error-text');

  it('asks "How did you feel after?" with the saved answer checked', async () => {
    mockQueries({
      attempt: { data: makeAttempt({ fullness: Fullness.VeryFull }) },
    });
    await renderScreen();

    expect(screen.getByText('How did you feel after?')).toBeOnTheScreen();
    expect(screen.getByLabelText('How did you feel after?')).toHaveProp(
      'accessibilityRole',
      'radiogroup',
    );
    expect(fullness('Very full')).toBe(
      screen.getByTestId('attempt-detail-fullness-very-full'),
    );
    expect(fullness('Very full')).toBeChecked();
    expect(fullness('Still hungry')).not.toBeChecked();
    expect(fullness('Satisfied')).not.toBeChecked();
    expect(fullness('Satisfied')).toBeEnabled();
    expect(errorText()).not.toBeOnTheScreen();
  });

  it('shows the answers unchosen when there is none, also next to the Rate link', async () => {
    mockQueries({
      attempt: { data: makeAttempt({ rating: null, fullness: null }) },
    });
    await renderScreen();

    expect(screen.getByRole('button', { name: 'Rate' })).toBeOnTheScreen();
    for (const name of ['Still hungry', 'Satisfied', 'Very full']) {
      expect(fullness(name)).not.toBeChecked();
    }
  });

  it('saves only the tapped answer, showing it while it saves', async () => {
    const user = userEvent.setup();
    const save = deferred<AttemptDetail>();
    mockedClient.updateAttempt.mockReturnValue(save.promise);
    await renderWithCachedAttempt(makeAttempt({ fullness: null }));

    await user.press(fullness('Satisfied'));

    expect(mockedClient.updateAttempt).toHaveBeenCalledTimes(1);
    expect(mockedClient.updateAttempt).toHaveBeenCalledWith('tok', 'a2', {
      fullness: Fullness.Satisfied,
    });
    expect(fullness('Satisfied')).toBeChecked();
    for (const name of ['Still hungry', 'Satisfied', 'Very full']) {
      expect(fullness(name)).toBeDisabled();
    }
    // The stars are a separate editor and stay usable.
    expect(ratingStar(5)).toBeEnabled();

    await act(async () => {
      save.resolve(makeAttempt({ fullness: Fullness.Satisfied }));
    });

    await waitFor(() => expect(fullness('Very full')).toBeEnabled());
    expect(fullness('Satisfied')).toBeChecked();
    expect(
      queryClient.getQueryData<AttemptDetail>(attemptKeys.detail('a2'))
        ?.fullness,
    ).toBe(Fullness.Satisfied);
  });

  it('switches to another answer', async () => {
    const user = userEvent.setup();
    mockedClient.updateAttempt.mockResolvedValue(
      makeAttempt({ fullness: Fullness.StillHungry }),
    );
    await renderWithCachedAttempt(makeAttempt({ fullness: Fullness.VeryFull }));

    await user.press(fullness('Still hungry'));

    expect(mockedClient.updateAttempt).toHaveBeenCalledWith('tok', 'a2', {
      fullness: Fullness.StillHungry,
    });
    await waitFor(() => expect(fullness('Still hungry')).toBeEnabled());
    expect(fullness('Still hungry')).toBeChecked();
    expect(fullness('Very full')).not.toBeChecked();
  });

  it('clears the answer when the chosen one is tapped again', async () => {
    const user = userEvent.setup();
    const save = deferred<AttemptDetail>();
    mockedClient.updateAttempt.mockReturnValue(save.promise);
    await renderWithCachedAttempt(
      makeAttempt({ fullness: Fullness.Satisfied }),
    );

    await user.press(fullness('Satisfied'));

    expect(mockedClient.updateAttempt).toHaveBeenCalledWith('tok', 'a2', {
      fullness: null,
    });
    // The cleared answer shows while it saves, not the old one.
    expect(fullness('Satisfied')).not.toBeChecked();
    expect(fullness('Satisfied')).toBeDisabled();

    await act(async () => {
      save.resolve(makeAttempt({ fullness: null }));
    });

    await waitFor(() => expect(fullness('Satisfied')).toBeEnabled());
    for (const name of ['Still hungry', 'Satisfied', 'Very full']) {
      expect(fullness(name)).not.toBeChecked();
    }
  });

  it('keeps showing the saved answer before the cached attempt catches up', async () => {
    // useAttempt is mocked, so the screen keeps getting the old attempt.
    const user = userEvent.setup();
    mockedClient.updateAttempt.mockResolvedValue(
      makeAttempt({ fullness: Fullness.VeryFull }),
    );
    mockQueries({
      attempt: { data: makeAttempt({ fullness: Fullness.StillHungry }) },
    });
    await renderScreen();

    await user.press(fullness('Very full'));

    await waitFor(() => expect(fullness('Very full')).toBeEnabled());
    expect(fullness('Very full')).toBeChecked();
    expect(fullness('Still hungry')).not.toBeChecked();
  });

  it('shows the error and goes back to the saved answer when saving fails', async () => {
    const user = userEvent.setup();
    mockedClient.updateAttempt.mockRejectedValue(
      new RecipesError('Attempt not found', 404),
    );
    await renderWithCachedAttempt(
      makeAttempt({ fullness: Fullness.StillHungry }),
    );

    await user.press(fullness('Very full'));

    expect(
      await screen.findByTestId('attempt-detail-fullness-error-text'),
    ).toHaveTextContent('Attempt not found', { exact: true });
    expect(fullness('Still hungry')).toBeChecked();
    expect(fullness('Very full')).not.toBeChecked();
    expect(fullness('Very full')).toBeEnabled();
    // The rating editor's error is its own.
    expect(
      screen.queryByTestId('attempt-detail-rating-error-text'),
    ).not.toBeOnTheScreen();
  });

  it('drops the error once a retry saves', async () => {
    const user = userEvent.setup();
    mockedClient.updateAttempt
      .mockRejectedValueOnce(new RecipesError('Network down', 500))
      .mockResolvedValueOnce(makeAttempt({ fullness: Fullness.Satisfied }));
    await renderWithCachedAttempt(makeAttempt({ fullness: null }));

    await user.press(fullness('Satisfied'));
    expect(
      await screen.findByTestId('attempt-detail-fullness-error-text'),
    ).toBeOnTheScreen();

    await user.press(fullness('Satisfied'));

    await waitFor(() => expect(errorText()).not.toBeOnTheScreen());
    expect(fullness('Satisfied')).toBeChecked();
  });
});

describe('AttemptDetailScreen enjoyment editor', () => {
  const enjoyment = (name: string) => screen.getByRole('radio', { name });
  const errorText = () =>
    screen.queryByTestId('attempt-detail-enjoyment-error-text');
  const ENJOYMENT_NAMES = [
    'Loved making it',
    'It was fine',
    'Not worth the effort',
  ];

  it('asks "Was it enjoyable to make?" with the saved answer checked', async () => {
    mockQueries({
      attempt: { data: makeAttempt({ enjoyment: Enjoyment.NotWorthIt }) },
    });
    await renderScreen();

    expect(screen.getByText('Was it enjoyable to make?')).toBeOnTheScreen();
    expect(screen.getByLabelText('Was it enjoyable to make?')).toHaveProp(
      'accessibilityRole',
      'radiogroup',
    );
    expect(enjoyment('Not worth the effort')).toBe(
      screen.getByTestId('attempt-detail-enjoyment-not-worth-it'),
    );
    expect(enjoyment('Not worth the effort')).toBeChecked();
    expect(enjoyment('Loved making it')).not.toBeChecked();
    expect(enjoyment('It was fine')).not.toBeChecked();
    expect(enjoyment('It was fine')).toBeEnabled();
    expect(errorText()).not.toBeOnTheScreen();
  });

  it('shows the answers unchosen when there is none, also next to the Rate link', async () => {
    mockQueries({
      attempt: { data: makeAttempt({ rating: null, enjoyment: null }) },
    });
    await renderScreen();

    expect(screen.getByRole('button', { name: 'Rate' })).toBeOnTheScreen();
    for (const name of ENJOYMENT_NAMES) {
      expect(enjoyment(name)).not.toBeChecked();
    }
  });

  it('comes before the fullness question', async () => {
    mockQueries();
    await renderScreen();

    const labels = screen
      .getAllByText(/^(Was it enjoyable to make\?|How did you feel after\?)$/)
      .map(label => label.props.children);
    expect(labels).toEqual([
      'Was it enjoyable to make?',
      'How did you feel after?',
    ]);
  });

  it('saves only the tapped answer, showing it while it saves', async () => {
    const user = userEvent.setup();
    const save = deferred<AttemptDetail>();
    mockedClient.updateAttempt.mockReturnValue(save.promise);
    await renderWithCachedAttempt(
      makeAttempt({ enjoyment: null, fullness: Fullness.VeryFull }),
    );

    await user.press(enjoyment('Loved making it'));

    expect(mockedClient.updateAttempt).toHaveBeenCalledTimes(1);
    expect(mockedClient.updateAttempt).toHaveBeenCalledWith('tok', 'a2', {
      enjoyment: Enjoyment.Loved,
    });
    expect(enjoyment('Loved making it')).toBeChecked();
    for (const name of ENJOYMENT_NAMES) {
      expect(enjoyment(name)).toBeDisabled();
    }
    // Fullness and the stars are separate editors and stay usable.
    expect(screen.getByRole('radio', { name: 'Very full' })).toBeEnabled();
    expect(ratingStar(5)).toBeEnabled();

    await act(async () => {
      save.resolve(
        makeAttempt({
          enjoyment: Enjoyment.Loved,
          fullness: Fullness.VeryFull,
        }),
      );
    });

    await waitFor(() => expect(enjoyment('It was fine')).toBeEnabled());
    expect(enjoyment('Loved making it')).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Very full' })).toBeChecked();
    expect(
      queryClient.getQueryData<AttemptDetail>(attemptKeys.detail('a2'))
        ?.enjoyment,
    ).toBe(Enjoyment.Loved);
  });

  it('clears the answer when the chosen one is tapped again', async () => {
    const user = userEvent.setup();
    const save = deferred<AttemptDetail>();
    mockedClient.updateAttempt.mockReturnValue(save.promise);
    await renderWithCachedAttempt(makeAttempt({ enjoyment: Enjoyment.Fine }));

    await user.press(enjoyment('It was fine'));

    expect(mockedClient.updateAttempt).toHaveBeenCalledWith('tok', 'a2', {
      enjoyment: null,
    });
    // The cleared answer shows while it saves, not the old one.
    expect(enjoyment('It was fine')).not.toBeChecked();
    expect(enjoyment('It was fine')).toBeDisabled();

    await act(async () => {
      save.resolve(makeAttempt({ enjoyment: null }));
    });

    await waitFor(() => expect(enjoyment('It was fine')).toBeEnabled());
    for (const name of ENJOYMENT_NAMES) {
      expect(enjoyment(name)).not.toBeChecked();
    }
  });

  it('keeps showing the saved answer before the cached attempt catches up', async () => {
    // useAttempt is mocked, so the screen keeps getting the old attempt.
    const user = userEvent.setup();
    mockedClient.updateAttempt.mockResolvedValue(
      makeAttempt({ enjoyment: Enjoyment.Fine }),
    );
    mockQueries({
      attempt: { data: makeAttempt({ enjoyment: Enjoyment.Loved }) },
    });
    await renderScreen();

    await user.press(enjoyment('It was fine'));

    await waitFor(() => expect(enjoyment('It was fine')).toBeEnabled());
    expect(enjoyment('It was fine')).toBeChecked();
    expect(enjoyment('Loved making it')).not.toBeChecked();
  });

  it('shows the error and goes back to the saved answer when saving fails', async () => {
    const user = userEvent.setup();
    mockedClient.updateAttempt.mockRejectedValue(
      new RecipesError('Attempt not found', 404),
    );
    await renderWithCachedAttempt(makeAttempt({ enjoyment: Enjoyment.Loved }));

    await user.press(enjoyment('Not worth the effort'));

    expect(
      await screen.findByTestId('attempt-detail-enjoyment-error-text'),
    ).toHaveTextContent('Attempt not found', { exact: true });
    expect(enjoyment('Loved making it')).toBeChecked();
    expect(enjoyment('Not worth the effort')).not.toBeChecked();
    expect(enjoyment('Not worth the effort')).toBeEnabled();
    // The fullness editor's error is its own.
    expect(
      screen.queryByTestId('attempt-detail-fullness-error-text'),
    ).not.toBeOnTheScreen();
  });

  it('drops the error once a retry saves', async () => {
    const user = userEvent.setup();
    mockedClient.updateAttempt
      .mockRejectedValueOnce(new RecipesError('Network down', 500))
      .mockResolvedValueOnce(makeAttempt({ enjoyment: Enjoyment.Fine }));
    await renderWithCachedAttempt(makeAttempt({ enjoyment: null }));

    await user.press(enjoyment('It was fine'));
    expect(
      await screen.findByTestId('attempt-detail-enjoyment-error-text'),
    ).toBeOnTheScreen();

    await user.press(enjoyment('It was fine'));

    await waitFor(() => expect(errorText()).not.toBeOnTheScreen());
    expect(enjoyment('It was fine')).toBeChecked();
  });
});

describe('AttemptDetailScreen photo', () => {
  const photo = () => screen.getByLabelText('Photo of what you made');

  it('shows no photo when the attempt has none', async () => {
    mockQueries({ attempt: { data: makeAttempt({ hasPhoto: false }) } });
    await renderScreen();

    expect(
      screen.queryByLabelText('Photo of what you made'),
    ).not.toBeOnTheScreen();
    expect(screen.queryByTestId('attempt-detail-photo')).not.toBeOnTheScreen();
  });

  it("loads the attempt's photo with the signed-in token", async () => {
    mockQueries({ attempt: { data: makeAttempt({ hasPhoto: true }) } });
    await renderScreen();

    expect(photo()).toBe(screen.getByTestId('attempt-detail-photo'));
    expect(photo()).toHaveProp('source', {
      uri: client.attemptPhotoUrl('a2'),
      headers: { Authorization: 'Bearer tok' },
    });
  });

  it('sends no Authorization header without a token', async () => {
    mockedUseAuth.mockReturnValue({
      status: AuthStatus.SignedIn,
      user: null,
      token: null,
      signIn: jest.fn(),
      signUp: jest.fn(),
      signOut: jest.fn(),
    });
    mockQueries({ attempt: { data: makeAttempt({ hasPhoto: true }) } });
    await renderScreen();

    expect(photo()).toHaveProp('source', {
      uri: client.attemptPhotoUrl('a2'),
      headers: {},
    });
  });

  it('sits above the recipe link, at the top of the screen', async () => {
    mockQueries({ attempt: { data: makeAttempt({ hasPhoto: true }) } });
    await renderScreen();

    const scroll = screen.getByTestId('attempt-detail-scroll');
    const order = within(scroll)
      .getAllByTestId(/^attempt-detail-(photo|recipe-link)$/)
      .map(element => element.props.testID);
    expect(order).toEqual([
      'attempt-detail-photo',
      'attempt-detail-recipe-link',
    ]);
  });
});

describe('AttemptDetailScreen cook again', () => {
  it('opens cooking mode from this attempt', async () => {
    const user = userEvent.setup();
    mockQueries({
      attempt: {
        data: makeAttempt({ ingredients: [{ text: '2 cans tomatoes' }] }),
      },
    });
    const navigation = await renderScreen();

    await user.press(
      screen.getByRole('button', { name: 'Cook this version again' }),
    );

    expect(navigation.navigate).toHaveBeenCalledTimes(1);
    expect(navigation.navigate).toHaveBeenCalledWith(Screens.Cooking, {
      recipeId: 'r1',
      fromAttemptId: 'a2',
    });
    expect(navigation.push).not.toHaveBeenCalled();
  });
});

describe('AttemptDetailScreen save as new recipe', () => {
  const fork = { id: 'r9', title: 'Spicy Tomato Soup' };
  const queryForkButton = () =>
    screen.queryByRole('button', { name: 'Save as new recipe' });
  const queryForkLink = () => screen.queryByRole('link', { name: /^Saved as/ });

  it.each<[string, AttemptDetail]>([
    ['it saved no lists', makeAttempt()],
    [
      'its saved lists match the recipe',
      makeAttempt({
        ingredients: [
          { text: '1 can tomatoes' },
          { text: '1 onion' },
          { text: 'salt' },
        ],
        instructions: 'Chop the onion.\nSimmer everything.\nBlend.',
      }),
    ],
    [
      'only its notes and rating differ',
      makeAttempt({ notes: 'Great.', rating: 5, tweaked: true }),
    ],
  ])(
    'offers neither the button nor a link when %s',
    async (_label, attempt) => {
      mockQueries({ attempt: { data: attempt } });
      await renderScreen();

      expect(queryForkButton()).not.toBeOnTheScreen();
      expect(
        screen.queryByTestId('attempt-detail-fork-button'),
      ).not.toBeOnTheScreen();
      expect(queryForkLink()).not.toBeOnTheScreen();
      // Cooking it again is still offered.
      expect(
        screen.getByRole('button', { name: 'Cook this version again' }),
      ).toBeOnTheScreen();
    },
  );

  it('still shows the "Saved as …" link for an unchanged attempt that has a fork', async () => {
    mockQueries({ attempt: { data: makeAttempt({ fork }) } });
    await renderScreen();

    expect(
      screen.getByTestId('attempt-detail-unchanged-text'),
    ).toBeOnTheScreen();
    expect(
      screen.getByRole('link', { name: 'Saved as Spicy Tomato Soup ›' }),
    ).toBeOnTheScreen();
    expect(queryForkButton()).not.toBeOnTheScreen();
  });

  it.each<[string, AttemptDetail]>([
    [
      'an ingredient changed',
      makeAttempt({ ingredients: [{ text: '1 can tomatoes' }] }),
    ],
    [
      'a step changed',
      makeAttempt({ instructions: 'Chop the onion.\nBlend.' }),
    ],
  ])('offers the button when %s', async (_label, attempt) => {
    mockQueries({ attempt: { data: attempt } });
    await renderScreen();

    expect(
      screen.getByRole('button', { name: 'Save as new recipe' }),
    ).toBeOnTheScreen();
    expect(queryForkLink()).not.toBeOnTheScreen();
  });

  it('offers the button when the recipe was edited after an as-is attempt', async () => {
    // tweaked is false, but the recipe moved on, so this version is gone
    // from the recipe and worth saving.
    mockQueries({
      attempt: {
        data: makeAttempt({
          tweaked: false,
          ingredients: [
            { text: '1 can tomatoes' },
            { text: '1 onion' },
            { text: 'salt' },
          ],
        }),
      },
      recipe: {
        data: makeRecipe({
          ingredients: ['1 can tomatoes', '1 onion', 'salt', 'basil'],
        }),
      },
    });
    await renderScreen();

    expect(
      screen.getByRole('button', { name: 'Save as new recipe' }),
    ).toBeOnTheScreen();
  });

  it('offers "Save as new recipe" and opens the form prefilled from this attempt', async () => {
    const user = userEvent.setup();
    mockQueries({
      attempt: {
        data: makeAttempt({ ingredients: [{ text: '2 cans tomatoes' }] }),
      },
    });
    const navigation = await renderScreen();

    expect(
      screen.queryByRole('link', { name: /^Saved as/ }),
    ).not.toBeOnTheScreen();
    await user.press(
      screen.getByRole('button', { name: 'Save as new recipe' }),
    );

    expect(navigation.navigate).toHaveBeenCalledTimes(1);
    expect(navigation.navigate).toHaveBeenCalledWith(Screens.RecipeForm, {
      forkFrom: { recipeId: 'r1', attemptId: 'a2' },
    });
    expect(navigation.push).not.toHaveBeenCalled();
  });

  it('shows "Saved as …" instead once a changed attempt was saved, pushing the new recipe', async () => {
    const user = userEvent.setup();
    mockQueries({
      attempt: {
        data: makeAttempt({
          ingredients: [{ text: '2 cans tomatoes' }],
          fork,
        }),
      },
    });
    const navigation = await renderScreen();

    expect(
      screen.queryByRole('button', { name: 'Save as new recipe' }),
    ).not.toBeOnTheScreen();
    await user.press(
      screen.getByRole('link', { name: 'Saved as Spicy Tomato Soup ›' }),
    );

    expect(navigation.push).toHaveBeenCalledTimes(1);
    expect(navigation.push).toHaveBeenCalledWith(Screens.RecipeDetail, {
      recipeId: 'r9',
    });
    expect(navigation.navigate).not.toHaveBeenCalled();
  });
});
