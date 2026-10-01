import React from 'react';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  render,
  screen,
  userEvent,
  within,
} from '@testing-library/react-native';
import {
  fetchRecipes,
  fetchWeek,
  FoodGroup,
  IngredientSummary,
  Meal,
  MealKind,
  Nutrient,
  Recipe,
  RecipeLine,
  Week,
  WeekAttempt,
} from '../api/recipesClient';
import { useAuth } from '../auth/AuthContext';
import { AppStackParamList, Screens } from '../navigation/types';
import MakeTodayScreen from './MakeTodayScreen';

jest.mock('../api/recipesClient', () => ({
  ...jest.requireActual('../api/recipesClient'),
  fetchRecipes: jest.fn(),
  fetchWeek: jest.fn(),
}));
jest.mock('../auth/AuthContext', () => ({ useAuth: jest.fn() }));

type Props = NativeStackScreenProps<AppStackParamList, Screens.MakeToday>;

const mockedFetchRecipes = jest.mocked(fetchRecipes);
const mockedFetchWeek = jest.mocked(fetchWeek);
const mockedUseAuth = jest.mocked(useAuth);

const { Protein, Fiber, HealthyFat } = FoodGroup;

// "Now" is Wednesday Sep 30 2026, noon local: the week is Sep 28 – Oct 5.
const local = (month: number, day: number, hour = 0) =>
  new Date(2026, month - 1, day, hour);
const NOW = local(9, 30, 12);

const NO_RECIPES = 'No recipes yet. Add one and it shows up here.';
const LOAD_FAILED = "Couldn't load your recipes.";

function ingredient(name: string, nutrients: Nutrient[]): IngredientSummary {
  return { id: `i-${name}`, name, mainGroup: nutrients[0], nutrients };
}
const egg = ingredient('egg', [Protein]);
const lentils = ingredient('lentils', [Fiber, Protein]);
const oliveOil = ingredient('olive oil', [HealthyFat]);

const line = (ing: IngredientSummary | null, text = '# Base'): RecipeLine => ({
  position: 0,
  text: ing ? `1 ${ing.name}` : text,
  linkSetByOwner: false,
  ingredient: ing,
});

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
    prepMinutes: 5,
    cookMinutes: 5,
    servings: null,
    forkedFrom: null,
    forks: [],
    createdAt: '2026-09-21T12:00:00.000Z',
    updatedAt: '2026-09-21T12:00:00.000Z',
    ...overrides,
  };
}

function makeMeal(overrides: Partial<Meal> = {}): Meal {
  return {
    id: 'm1',
    kind: MealKind.Meal,
    eatenAt: '2026-09-29T12:00:00.000Z',
    text: 'eggs',
    nutrients: [Protein],
    fullness: null,
    hasPhoto: false,
    createdAt: '2026-09-29T12:00:00.000Z',
    updatedAt: '2026-09-29T12:00:00.000Z',
    ...overrides,
  };
}

function makeAttempt(overrides: Partial<WeekAttempt> = {}): WeekAttempt {
  return {
    id: 'a1',
    recipeId: 'r-other',
    madeAt: '2026-09-29T12:00:00.000Z',
    rating: null,
    fullness: null,
    hasPhoto: false,
    recipe: { id: 'r-other', title: 'Other', imageUrl: null },
    nutrients: [],
    ...overrides,
  };
}

// Protein full (2 of 3), fiber low (1 of 3), healthy fat none.
const PROTEIN_FULL_FIBER_LOW: Week = {
  meals: [
    makeMeal({ id: 'm1', nutrients: [Protein] }),
    makeMeal({ id: 'm2', nutrients: [Protein] }),
  ],
  attempts: [makeAttempt({ nutrients: [Fiber] })],
};

const soup = makeRecipe({
  id: 'soup',
  title: 'Lentil soup',
  prepMinutes: 10,
  cookMinutes: 15,
  lines: [line(null, '# Soup'), line(lentils)],
});
const toast = makeRecipe({
  id: 'toast',
  title: 'Avocado toast',
  prepMinutes: 5,
  cookMinutes: null,
  lines: [line(oliveOil)],
});
const omelette = makeRecipe({
  id: 'omelette',
  title: 'Omelette',
  prepMinutes: 5,
  cookMinutes: 5,
  lines: [line(egg)],
});
const stew = makeRecipe({
  id: 'stew',
  title: 'Bean stew',
  prepMinutes: 15,
  cookMinutes: 75,
  lines: [line(lentils)],
});
const granny = makeRecipe({
  id: 'granny',
  title: "Granny's pie",
  prepMinutes: null,
  cookMinutes: null,
});

let queryClient: QueryClient;

function SignedInQueryProvider({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

async function renderScreen() {
  const navigation = { navigate: jest.fn() };
  await render(
    <MakeTodayScreen
      navigation={navigation as unknown as Props['navigation']}
      route={{ key: 'MakeToday-1', name: Screens.MakeToday } as Props['route']}
    />,
    { wrapper: SignedInQueryProvider },
  );
  return navigation;
}

const timeRadio = (name: string) => screen.getByRole('radio', { name });
const shownIds = () =>
  screen
    .queryAllByTestId(/^make-today-recipe-/)
    .map(element => element.props.testID as string);
const row = (id: string) => within(screen.getByTestId(`make-today-recipe-${id}`));

beforeEach(() => {
  jest.resetAllMocks();
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  mockedUseAuth.mockReturnValue({
    status: 'signedIn',
    user: { id: 'u1', name: 'Filiz', email: 'f@test.local' },
    token: 'tok',
    signIn: jest.fn(),
    signUp: jest.fn(),
    signOut: jest.fn(),
  } as unknown as ReturnType<typeof useAuth>);
});

afterEach(() => {
  queryClient.clear();
  jest.useRealTimers();
});

describe('MakeTodayScreen time choice', () => {
  it('asks how much time there is, with 30 min chosen by default', async () => {
    mockedFetchRecipes.mockResolvedValue([soup]);
    mockedFetchWeek.mockResolvedValue(PROTEIN_FULL_FIBER_LOW);
    await renderScreen();

    expect(screen.getByText('What should I make?')).toBeOnTheScreen();
    expect(screen.getByText('How much time do you have?')).toBeOnTheScreen();
    expect(timeRadio('15 min')).not.toBeChecked();
    expect(timeRadio('30 min')).toBeChecked();
    expect(timeRadio('1 h+')).not.toBeChecked();
    expect(await screen.findByText('Lentil soup')).toBeOnTheScreen();
  });

  it('filters the list by the chosen time; "1 h+" shows everything', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    mockedFetchRecipes.mockResolvedValue([stew, granny, soup, toast, omelette]);
    mockedFetchWeek.mockResolvedValue({ meals: [], attempts: [] });
    await renderScreen();
    await screen.findByText('Lentil soup');

    // 30 min: the 90 min stew doesn't fit.
    expect(screen.queryByText('Bean stew')).not.toBeOnTheScreen();
    expect(shownIds()).toHaveLength(4);

    await user.press(timeRadio('15 min'));
    expect(timeRadio('15 min')).toBeChecked();
    expect(timeRadio('30 min')).not.toBeChecked();
    expect(screen.queryByText('Lentil soup')).not.toBeOnTheScreen();
    // An empty week has no protein first: the omelette leads.
    expect(shownIds()).toEqual([
      'make-today-recipe-omelette',
      'make-today-recipe-toast',
      'make-today-recipe-granny',
    ]);

    await user.press(timeRadio('1 h+'));
    expect(timeRadio('1 h+')).toBeChecked();
    expect(shownIds()).toHaveLength(5);
    expect(row('stew').getByText('1 hr 30 min')).toBeOnTheScreen();
  });

  it('asks for this week only, Monday to Monday local time', async () => {
    mockedFetchRecipes.mockResolvedValue([soup]);
    mockedFetchWeek.mockResolvedValue(PROTEIN_FULL_FIBER_LOW);
    await renderScreen();
    await screen.findByText('Lentil soup');

    expect(mockedFetchRecipes).toHaveBeenCalledWith('tok');
    expect(mockedFetchWeek).toHaveBeenCalledTimes(1);
    expect(mockedFetchWeek).toHaveBeenCalledWith(
      'tok',
      local(9, 28),
      local(10, 5),
    );
  });
});

describe('MakeTodayScreen suggestions', () => {
  it('lists what fills the week first, with the time and what it adds', async () => {
    mockedFetchRecipes.mockResolvedValue([omelette, soup, granny, toast]);
    mockedFetchWeek.mockResolvedValue(PROTEIN_FULL_FIBER_LOW);
    await renderScreen();

    expect(
      await screen.findByText(
        'Your week has no healthy fat yet. This adds it.',
      ),
    ).toBeOnTheScreen();
    // Healthy fat (none) → fiber (low) → nothing → untimed.
    expect(shownIds()).toEqual([
      'make-today-recipe-toast',
      'make-today-recipe-soup',
      'make-today-recipe-omelette',
      'make-today-recipe-granny',
    ]);

    expect(row('toast').getByText('Avocado toast')).toBeOnTheScreen();
    expect(row('toast').getByText('5 min')).toBeOnTheScreen();
    expect(
      row('toast').getByText('Your week has no healthy fat yet. This adds it.'),
    ).toBeOnTheScreen();

    expect(row('soup').getByText('25 min')).toBeOnTheScreen();
    expect(
      row('soup').getByText('Your week is low on fiber. This adds some.'),
    ).toBeOnTheScreen();

    // Protein is full this week: no line under the omelette.
    expect(row('omelette').getByText('10 min')).toBeOnTheScreen();
    expect(row('omelette').queryByText(/Your week/)).not.toBeOnTheScreen();

    expect(row('granny').getByText('No time given')).toBeOnTheScreen();
    expect(row('granny').queryByText(/Your week/)).not.toBeOnTheScreen();
  });

  it('does not count photo-only meals or unlinked attempts in the week', async () => {
    // Fiber in 1 of 2 judged items is full, so the soup adds nothing. If the
    // photo meal and the unlinked attempt counted, fiber would be low.
    mockedFetchRecipes.mockResolvedValue([soup]);
    mockedFetchWeek.mockResolvedValue({
      meals: [
        makeMeal({ id: 'm1', nutrients: [Protein, Fiber] }),
        makeMeal({ id: 'm2', text: null, hasPhoto: true, nutrients: [] }),
      ],
      attempts: [
        makeAttempt({ id: 'a1', nutrients: [Protein] }),
        makeAttempt({ id: 'a2', nutrients: [] }),
      ],
    });
    await renderScreen();
    await screen.findByText('Lentil soup');
    // Let the week settle before asserting there's no line.
    await jest.runAllTimersAsync();
    expect(mockedFetchWeek).toHaveBeenCalledTimes(1);

    expect(screen.queryByText(/Your week/)).not.toBeOnTheScreen();
  });

  it('shows the list without waiting for the week', async () => {
    mockedFetchRecipes.mockResolvedValue([toast, soup]);
    mockedFetchWeek.mockReturnValue(new Promise<Week>(() => {}));
    await renderScreen();

    expect(await screen.findByText('Avocado toast')).toBeOnTheScreen();
    expect(screen.getByText('Lentil soup')).toBeOnTheScreen();
    expect(screen.queryByText(/Your week/)).not.toBeOnTheScreen();
    // No gaps known: quickest first.
    expect(shownIds()).toEqual([
      'make-today-recipe-toast',
      'make-today-recipe-soup',
    ]);
  });

  it('still lists recipes when the week fails to load, without adds lines', async () => {
    mockedFetchRecipes.mockResolvedValue([toast]);
    mockedFetchWeek.mockRejectedValue(new Error('boom'));
    await renderScreen();

    expect(await screen.findByText('Avocado toast')).toBeOnTheScreen();
    await jest.runAllTimersAsync();
    expect(screen.queryByText(/Your week/)).not.toBeOnTheScreen();
    expect(screen.queryByText(LOAD_FAILED)).not.toBeOnTheScreen();
  });

  it('opens the recipe when a row is pressed', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    mockedFetchRecipes.mockResolvedValue([soup, toast]);
    mockedFetchWeek.mockResolvedValue(PROTEIN_FULL_FIBER_LOW);
    const navigation = await renderScreen();

    await user.press(await screen.findByRole('button', { name: /Lentil soup/ }));

    expect(navigation.navigate).toHaveBeenCalledTimes(1);
    expect(navigation.navigate).toHaveBeenCalledWith(Screens.RecipeDetail, {
      recipeId: 'soup',
    });
  });
});

describe('MakeTodayScreen empty and error states', () => {
  it('says there are no recipes yet when the list is empty', async () => {
    mockedFetchRecipes.mockResolvedValue([]);
    mockedFetchWeek.mockResolvedValue(PROTEIN_FULL_FIBER_LOW);
    await renderScreen();

    expect(await screen.findByText(NO_RECIPES)).toBeOnTheScreen();
    expect(shownIds()).toEqual([]);
  });

  it('says none fit the chosen time, and shows them again with more time', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    mockedFetchRecipes.mockResolvedValue([soup, stew]);
    mockedFetchWeek.mockResolvedValue(PROTEIN_FULL_FIBER_LOW);
    await renderScreen();
    await screen.findByText('Lentil soup');

    await user.press(timeRadio('15 min'));
    expect(
      screen.getByText('No recipes fit in 15 min yet.'),
    ).toBeOnTheScreen();
    expect(screen.queryByText(NO_RECIPES)).not.toBeOnTheScreen();
    expect(shownIds()).toEqual([]);

    await user.press(timeRadio('30 min'));
    expect(
      screen.queryByText('No recipes fit in 15 min yet.'),
    ).not.toBeOnTheScreen();
    expect(screen.getByText('Lentil soup')).toBeOnTheScreen();
  });

  it('names 30 min in the empty text when nothing fits in 30 min', async () => {
    mockedFetchRecipes.mockResolvedValue([stew]);
    mockedFetchWeek.mockResolvedValue(PROTEIN_FULL_FIBER_LOW);
    await renderScreen();

    expect(
      await screen.findByText('No recipes fit in 30 min yet.'),
    ).toBeOnTheScreen();
  });

  it('shows an error when the recipes fail to load', async () => {
    mockedFetchRecipes.mockRejectedValue(new Error('boom'));
    mockedFetchWeek.mockResolvedValue(PROTEIN_FULL_FIBER_LOW);
    await renderScreen();

    expect(await screen.findByText(LOAD_FAILED)).toBeOnTheScreen();
    expect(screen.queryByText(NO_RECIPES)).not.toBeOnTheScreen();
    expect(shownIds()).toEqual([]);
  });
});
