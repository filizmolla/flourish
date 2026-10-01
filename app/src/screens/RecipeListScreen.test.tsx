import React from 'react';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, userEvent } from '@testing-library/react-native';
import * as client from '../api/recipesClient';
import { UnratedAttempt } from '../api/recipesClient';
import { useAuth } from '../auth/AuthContext';
import { useRecipes } from '../hooks/useRecipes';
import { AppStackParamList, Screens } from '../navigation/types';
import RecipeListScreen from './RecipeListScreen';

jest.mock('../hooks/useRecipes', () => ({ useRecipes: jest.fn() }));
jest.mock('../api/recipesClient', () => ({
  ...jest.requireActual('../api/recipesClient'),
  fetchUnratedAttempt: jest.fn(),
}));
jest.mock('../auth/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

type Props = NativeStackScreenProps<AppStackParamList, Screens.Recipes>;

const mockedUseRecipes = jest.mocked(useRecipes);
const mockedClient = jest.mocked(client);
const mockedUseAuth = jest.mocked(useAuth);

function makeUnrated(overrides: Partial<UnratedAttempt> = {}): UnratedAttempt {
  return {
    id: 'a7',
    recipeId: 'r3',
    madeAt: '2026-09-24T12:00:00.000Z',
    durationMinutes: 42,
    rating: null,
    fullness: null,
    enjoyment: null,
    hasPhoto: false,
    notes: null,
    ingredients: null,
    instructions: null,
    basedOnAttemptId: null,
    tweaked: false,
    createdAt: '2026-09-24T12:00:00.000Z',
    updatedAt: '2026-09-24T12:00:00.000Z',
    recipe: { id: 'r3', title: 'Shakshuka' },
    ...overrides,
  };
}

let queryClient: QueryClient;

function SignedInQueryProvider({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

async function renderScreen() {
  const navigation = { navigate: jest.fn() };
  await render(
    <RecipeListScreen
      navigation={navigation as unknown as Props['navigation']}
      route={{ key: 'Recipes-1', name: Screens.Recipes } as Props['route']}
    />,
    { wrapper: SignedInQueryProvider },
  );
  return navigation;
}

beforeEach(() => {
  mockedClient.fetchUnratedAttempt.mockReset();
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  mockedUseAuth.mockReturnValue({
    status: 'signedIn',
    user: { id: 'u1', name: 'Filiz Test', email: 'f@test.local' },
    token: 'tok',
    signIn: jest.fn(),
    signUp: jest.fn(),
    signOut: jest.fn(),
  } as unknown as ReturnType<typeof useAuth>);
  mockedUseRecipes.mockReturnValue({
    data: [],
    isPending: false,
    isError: false,
    error: null,
    refetch: jest.fn(),
    isRefetching: false,
  } as unknown as ReturnType<typeof useRecipes>);
});

afterEach(() => {
  queryClient.clear();
});

describe('RecipeListScreen rate prompt', () => {
  it('shows the rate prompt card and opens that attempt from it', async () => {
    const user = userEvent.setup();
    mockedClient.fetchUnratedAttempt.mockResolvedValue(makeUnrated());
    const navigation = await renderScreen();

    await user.press(
      await screen.findByRole('button', {
        name: 'Open your Shakshuka attempt',
      }),
    );

    expect(navigation.navigate).toHaveBeenCalledTimes(1);
    expect(navigation.navigate).toHaveBeenCalledWith(Screens.AttemptDetail, {
      recipeId: 'r3',
      attemptId: 'a7',
    });
  });
});

describe('RecipeListScreen add meal', () => {
  it('opens the "What did you eat?" screen', async () => {
    const user = userEvent.setup();
    mockedClient.fetchUnratedAttempt.mockResolvedValue(null);
    const navigation = await renderScreen();

    await user.press(
      screen.getByRole('button', { name: '＋ Add what you ate' }),
    );

    expect(navigation.navigate).toHaveBeenCalledTimes(1);
    expect(navigation.navigate).toHaveBeenCalledWith(Screens.AddMeal);
  });
});

describe('RecipeListScreen week link', () => {
  it('opens Your week', async () => {
    const user = userEvent.setup();
    mockedClient.fetchUnratedAttempt.mockResolvedValue(null);
    const navigation = await renderScreen();

    await user.press(screen.getByRole('link', { name: 'Your week ›' }));

    expect(navigation.navigate).toHaveBeenCalledTimes(1);
    expect(navigation.navigate).toHaveBeenCalledWith(Screens.Week);
  });
});

describe('RecipeListScreen make-today link', () => {
  const recipe: client.Recipe = {
    id: 'r1',
    title: 'Lentil soup',
    ingredients: [],
    lines: [],
    instructions: '',
    story: null,
    imageUrl: null,
    source: null,
    prepMinutes: 10,
    cookMinutes: 15,
    servings: null,
    forkedFrom: null,
    forks: [],
    createdAt: '2026-09-21T12:00:00.000Z',
    updatedAt: '2026-09-21T12:00:00.000Z',
  };

  it('opens "What should I make?" when there are recipes', async () => {
    const user = userEvent.setup();
    mockedClient.fetchUnratedAttempt.mockResolvedValue(null);
    mockedUseRecipes.mockReturnValue({
      data: [recipe],
      isPending: false,
      isError: false,
      error: null,
      refetch: jest.fn(),
      isRefetching: false,
    } as unknown as ReturnType<typeof useRecipes>);
    const navigation = await renderScreen();

    await user.press(
      screen.getByRole('button', { name: 'What should I make today?' }),
    );

    expect(navigation.navigate).toHaveBeenCalledTimes(1);
    expect(navigation.navigate).toHaveBeenCalledWith(Screens.MakeToday);
  });

  it('is hidden when there are no recipes yet', async () => {
    mockedClient.fetchUnratedAttempt.mockResolvedValue(null);
    await renderScreen();

    expect(
      screen.queryByRole('button', { name: 'What should I make today?' }),
    ).not.toBeOnTheScreen();
    expect(screen.getByRole('link', { name: 'Your week ›' })).toBeOnTheScreen();
  });
});

describe('RecipeListScreen search and filters', () => {
  function makeRecipe(overrides: Partial<client.Recipe> = {}): client.Recipe {
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

  const soup = makeRecipe({
    id: 'soup',
    title: 'Lentil soup',
    ingredients: ['1 cup red lentils'],
    source: 'Mom',
    prepMinutes: 5,
    cookMinutes: 10,
  });
  const curry = makeRecipe({
    id: 'curry',
    title: 'Weeknight curry',
    ingredients: ['400 g chickpeas', '200 g spinach'],
    source: 'Cookbook',
    prepMinutes: 15,
    cookMinutes: 30,
  });
  const borek = makeRecipe({
    id: 'borek',
    title: 'Ispanaklı börek',
    ingredients: ['yufka', 'ıspanak'],
    source: 'mom',
    prepMinutes: null,
    cookMinutes: null,
  });

  function givenRecipes(recipes: client.Recipe[]) {
    mockedUseRecipes.mockReturnValue({
      data: recipes,
      isPending: false,
      isError: false,
      error: null,
      refetch: jest.fn(),
      isRefetching: false,
    } as unknown as ReturnType<typeof useRecipes>);
  }

  function searchBox() {
    return screen.getByLabelText('Search recipes and ingredients');
  }

  function filtersButton() {
    return screen.getByRole('button', { name: /^Filters/ });
  }

  async function openFilters(user: ReturnType<typeof userEvent.setup>) {
    await user.press(filtersButton());
  }

  beforeEach(() => {
    mockedClient.fetchUnratedAttempt.mockResolvedValue(null);
  });

  it('shows every recipe and no "no match" message before filtering', async () => {
    givenRecipes([soup, curry, borek]);
    await renderScreen();

    expect(screen.getByText('Lentil soup')).toBeOnTheScreen();
    expect(screen.getByText('Weeknight curry')).toBeOnTheScreen();
    expect(screen.getByText('Ispanaklı börek')).toBeOnTheScreen();
    expect(screen.queryByText('No recipes match.')).not.toBeOnTheScreen();
  });

  it('filters the list as the user types, matching ingredients too', async () => {
    const user = userEvent.setup();
    givenRecipes([soup, curry, borek]);
    await renderScreen();

    await user.type(searchBox(), 'spinach');

    expect(screen.getByText('Weeknight curry')).toBeOnTheScreen();
    expect(screen.queryByText('Lentil soup')).not.toBeOnTheScreen();
    expect(screen.queryByText('Ispanaklı börek')).not.toBeOnTheScreen();
  });

  it('finds a Turkish title typed with a different i', async () => {
    const user = userEvent.setup();
    givenRecipes([soup, curry, borek]);
    await renderScreen();

    await user.type(searchBox(), 'İSPANAK');

    expect(screen.getByText('Ispanaklı börek')).toBeOnTheScreen();
    expect(screen.queryByText('Weeknight curry')).not.toBeOnTheScreen();
  });

  it('keeps the greeting count at the total while filtering', async () => {
    const user = userEvent.setup();
    givenRecipes([soup, curry, borek]);
    await renderScreen();

    await user.type(searchBox(), 'curry');

    expect(screen.getByText('3 recipes, each with a story.')).toBeOnTheScreen();
  });

  it('filters by time and clears it when the chip is tapped again', async () => {
    const user = userEvent.setup();
    givenRecipes([soup, curry, borek]);
    await renderScreen();
    await openFilters(user);

    await user.press(screen.getByRole('radio', { name: 'Up to 15 min' }));

    expect(screen.getByRole('radio', { name: 'Up to 15 min' })).toBeChecked();
    expect(screen.getByText('Lentil soup')).toBeOnTheScreen();
    expect(screen.queryByText('Weeknight curry')).not.toBeOnTheScreen();
    // No times: a time filter leaves it out.
    expect(screen.queryByText('Ispanaklı börek')).not.toBeOnTheScreen();

    await user.press(screen.getByRole('radio', { name: 'Up to 15 min' }));

    expect(screen.getByRole('radio', { name: 'Any time' })).toBeChecked();
    expect(screen.getByText('Weeknight curry')).toBeOnTheScreen();
    expect(screen.getByText('Ispanaklı börek')).toBeOnTheScreen();
  });

  it('offers one From chip per source, whatever its case, A to Z', async () => {
    const user = userEvent.setup();
    givenRecipes([soup, curry, borek]);
    await renderScreen();
    await openFilters(user);

    expect(screen.getByTestId('recipes-from-0')).toHaveTextContent(
      'From Cookbook',
    );
    expect(screen.getByTestId('recipes-from-1')).toHaveTextContent(
      /^From (Mom|mom)$/,
    );
    expect(screen.queryByTestId('recipes-from-2')).not.toBeOnTheScreen();
  });

  it('filters by source across spellings and clears on a second tap', async () => {
    const user = userEvent.setup();
    givenRecipes([soup, curry, borek]);
    await renderScreen();
    await openFilters(user);

    await user.press(screen.getByTestId('recipes-from-1'));

    expect(screen.getByTestId('recipes-from-1')).toBeChecked();
    expect(screen.getByText('Lentil soup')).toBeOnTheScreen();
    expect(screen.getByText('Ispanaklı börek')).toBeOnTheScreen();
    expect(screen.queryByText('Weeknight curry')).not.toBeOnTheScreen();

    await user.press(screen.getByTestId('recipes-from-1'));

    expect(screen.getByRole('radio', { name: 'From anywhere' })).toBeChecked();
    expect(screen.getByText('Weeknight curry')).toBeOnTheScreen();
  });

  it('hides the From row when no recipe has a source', async () => {
    const user = userEvent.setup();
    givenRecipes([makeRecipe({ id: 'a', title: 'Toast', source: null })]);
    await renderScreen();
    await openFilters(user);

    expect(searchBox()).toBeOnTheScreen();
    expect(screen.getByRole('radio', { name: 'Any time' })).toBeOnTheScreen();
    expect(
      screen.queryByRole('radio', { name: 'From anywhere' }),
    ).not.toBeOnTheScreen();
  });

  it('combines search, time and source', async () => {
    const user = userEvent.setup();
    givenRecipes([soup, curry, borek]);
    await renderScreen();
    await openFilters(user);

    await user.press(screen.getByTestId('recipes-from-1'));
    await user.type(searchBox(), 'ıspanak');

    expect(screen.getByText('Ispanaklı börek')).toBeOnTheScreen();
    expect(screen.queryByText('Lentil soup')).not.toBeOnTheScreen();

    await user.press(screen.getByRole('radio', { name: 'Up to 1 h' }));

    expect(screen.queryByText('Ispanaklı börek')).not.toBeOnTheScreen();
    expect(screen.getByText('No recipes match.')).toBeOnTheScreen();
  });

  it('shows "no match" with a clear button that resets every filter', async () => {
    const user = userEvent.setup();
    givenRecipes([soup, curry, borek]);
    await renderScreen();
    await openFilters(user);

    await user.press(screen.getByRole('radio', { name: 'Up to 30 min' }));
    await user.press(screen.getByTestId('recipes-from-0'));
    await user.type(searchBox(), 'pizza');

    expect(screen.getByText('No recipes match.')).toBeOnTheScreen();
    expect(
      screen.queryByText('The recipe box is empty.'),
    ).not.toBeOnTheScreen();
    expect(screen.queryByText('Lentil soup')).not.toBeOnTheScreen();

    await user.press(screen.getByRole('button', { name: 'Clear filters' }));

    expect(screen.queryByText('No recipes match.')).not.toBeOnTheScreen();
    expect(screen.getByText('Lentil soup')).toBeOnTheScreen();
    expect(screen.getByText('Weeknight curry')).toBeOnTheScreen();
    expect(screen.getByText('Ispanaklı börek')).toBeOnTheScreen();
    expect(searchBox()).toHaveDisplayValue('');
    expect(screen.getByRole('radio', { name: 'Any time' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'From anywhere' })).toBeChecked();
  });

  it('shows no filter bar and the usual empty state with no recipes', async () => {
    givenRecipes([]);
    await renderScreen();

    expect(screen.getByText('The recipe box is empty.')).toBeOnTheScreen();
    expect(
      screen.queryByLabelText('Search recipes and ingredients'),
    ).not.toBeOnTheScreen();
    expect(
      screen.queryByRole('button', { name: /^Filters/ }),
    ).not.toBeOnTheScreen();
    expect(
      screen.queryByRole('radio', { name: 'Any time' }),
    ).not.toBeOnTheScreen();
    expect(screen.queryByText('No recipes match.')).not.toBeOnTheScreen();
  });

  it('hides the chips until Filters is pressed, keeping the search box', async () => {
    const user = userEvent.setup();
    givenRecipes([soup, curry, borek]);
    await renderScreen();

    expect(searchBox()).toBeOnTheScreen();
    expect(filtersButton()).toBeCollapsed();
    expect(
      screen.queryByRole('radio', { name: 'Any time' }),
    ).not.toBeOnTheScreen();

    await openFilters(user);

    expect(filtersButton()).toBeExpanded();
    expect(screen.getByRole('radio', { name: 'Any time' })).toBeOnTheScreen();
  });

  it('keeps the list filtered and counts the filters after hiding the chips', async () => {
    const user = userEvent.setup();
    givenRecipes([soup, curry, borek]);
    await renderScreen();
    await openFilters(user);

    await user.press(screen.getByRole('radio', { name: 'Up to 30 min' }));
    await user.press(screen.getByTestId('recipes-from-1'));
    await user.press(filtersButton());

    expect(filtersButton()).toBeCollapsed();
    expect(
      screen.queryByRole('radio', { name: 'Up to 30 min' }),
    ).not.toBeOnTheScreen();
    expect(filtersButton()).toHaveTextContent('2', { exact: true });
    expect(filtersButton()).toHaveAccessibleName('Filters, 2 on');
    // Mom's soup is 15 min; the untimed börek and Cookbook curry stay out.
    expect(screen.getByText('Lentil soup')).toBeOnTheScreen();
    expect(screen.queryByText('Ispanaklı börek')).not.toBeOnTheScreen();
    expect(screen.queryByText('Weeknight curry')).not.toBeOnTheScreen();

    await openFilters(user);

    expect(screen.getByRole('radio', { name: 'Up to 30 min' })).toBeChecked();
    expect(screen.getByTestId('recipes-from-1')).toBeChecked();
  });

  it('counts one filter when only a time limit is on', async () => {
    const user = userEvent.setup();
    givenRecipes([soup, curry, borek]);
    await renderScreen();
    await openFilters(user);

    await user.press(screen.getByRole('radio', { name: 'Up to 15 min' }));

    expect(filtersButton()).toHaveTextContent('1', { exact: true });
    expect(filtersButton()).toHaveAccessibleName('Filters, 1 on');
  });

  it('does not count search text as a filter', async () => {
    const user = userEvent.setup();
    givenRecipes([soup, curry, borek]);
    await renderScreen();

    await user.type(searchBox(), 'curry');

    expect(screen.queryByText('Lentil soup')).not.toBeOnTheScreen();
    expect(filtersButton()).not.toHaveTextContent(/d/);
    expect(filtersButton()).toHaveAccessibleName('Filters');
  });
});
