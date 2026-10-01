import React from 'react';
import { Alert, AlertButton } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  render,
  screen,
  userEvent,
  waitFor,
  within,
} from '@testing-library/react-native';
import {
  attemptPhotoUrl,
  deleteMeal,
  fetchWeek,
  FoodGroup,
  Fullness,
  Meal,
  mealPhotoUrl,
  MealKind,
  updateMeal,
  Week,
  WeekAttempt,
} from '../api/recipesClient';
import { useAuth } from '../auth/AuthContext';
import { mealKeys } from '../hooks/useMeals';
import { AppStackParamList, Screens } from '../navigation/types';
import { flowerImages } from '../components/Bouquet';
import { Flower } from '../nutrients/flowers';
import WeekScreen from './WeekScreen';

jest.mock('../api/recipesClient', () => ({
  ...jest.requireActual('../api/recipesClient'),
  fetchWeek: jest.fn(),
  updateMeal: jest.fn(),
  deleteMeal: jest.fn(),
}));
jest.mock('../auth/AuthContext', () => ({ useAuth: jest.fn() }));

type Props = NativeStackScreenProps<AppStackParamList, Screens.Week>;

const mockedFetchWeek = jest.mocked(fetchWeek);
const mockedUpdateMeal = jest.mocked(updateMeal);
const mockedDeleteMeal = jest.mocked(deleteMeal);
const mockedUseAuth = jest.mocked(useAuth);

const { Protein, Fiber, HealthyFat } = FoodGroup;

// Dates are built from local parts so a tile's day never depends on the
// machine's time zone. "Now" is Wednesday Sep 30 2026, noon local.
const local = (month: number, day: number, hour = 0, minute = 0) =>
  new Date(2026, month - 1, day, hour, minute);
const iso = (month: number, day: number, hour = 12, minute = 0) =>
  local(month, day, hour, minute).toISOString();
const NOW = local(9, 30, 12);

const EMPTY_TEXT =
  'Nothing logged this week. Add what you ate, a photo is enough.';
const NO_TEXT = 'Add what was in your meals to see the balance.';
const LOAD_FAILED = "Couldn't load your week.";

function makeMeal(overrides: Partial<Meal> = {}): Meal {
  return {
    id: 'm1',
    kind: MealKind.Meal,
    eatenAt: iso(9, 30),
    text: 'lentil soup',
    nutrients: [Protein, Fiber],
    fullness: Fullness.Satisfied,
    hasPhoto: false,
    createdAt: iso(9, 30),
    updatedAt: iso(9, 30),
    ...overrides,
  };
}

function makeAttempt(overrides: Partial<WeekAttempt> = {}): WeekAttempt {
  return {
    id: 'a1',
    recipeId: 'r1',
    madeAt: iso(10, 1),
    rating: 4,
    fullness: Fullness.VeryFull,
    hasPhoto: false,
    recipe: { id: 'r1', title: 'Shakshuka', imageUrl: null },
    nutrients: [Protein],
    ...overrides,
  };
}

function week(meals: Meal[] = [], attempts: WeekAttempt[] = []): Week {
  return { meals, attempts };
}

let queryClient: QueryClient;

function SignedInQueryProvider({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

function signIn(token: string | null) {
  mockedUseAuth.mockReturnValue({
    status: token ? 'signedIn' : 'signedOut',
    user: token ? { id: 'u1', name: 'Filiz', email: 'f@test.local' } : null,
    token,
    signIn: jest.fn(),
    signUp: jest.fn(),
    signOut: jest.fn(),
  } as unknown as ReturnType<typeof useAuth>);
}

async function renderScreen() {
  const navigation = { navigate: jest.fn() };
  await render(
    <WeekScreen
      navigation={navigation as unknown as Props['navigation']}
      route={{ key: 'Week-1', name: Screens.Week } as Props['route']}
    />,
    { wrapper: SignedInQueryProvider },
  );
  return navigation;
}

// Renders and waits until the week has loaded (the first day is shown).
async function renderLoaded(data: Week) {
  mockedFetchWeek.mockResolvedValue(data);
  const navigation = await renderScreen();
  await screen.findByTestId('week-day-2026-09-28');
  return navigation;
}

const day = (key: string) => within(screen.getByTestId(`week-day-${key}`));
const itemIdsIn = (key: string) =>
  day(key)
    .queryAllByTestId(/^week-item-/)
    .map(element => element.props.testID as string);

type HostNode = { type: string; props: Record<string, unknown> };
type TreeNode = HostNode & { children: (TreeNode | string)[] };

// Tile images have no label of their own (the tile is read out as one); find
// them by host type. tileImages leaves out the tile's small flower mark.
function imagesIn(node: TreeNode): HostNode[] {
  const found: HostNode[] = node.type === 'Image' ? [node] : [];
  for (const child of node.children) {
    if (typeof child !== 'string') found.push(...imagesIn(child));
  }
  return found;
}
const tileImages = (testID: string) =>
  imagesIn(screen.getByTestId(testID) as unknown as TreeNode).filter(
    image => image.props.testID !== `${testID}-flower`,
  );
const tileFlower = (testID: string) =>
  screen.getByTestId(`${testID}-flower`, { includeHiddenElements: true });
const bouquetFlowers = () =>
  screen
    .getAllByTestId(/^week-bouquet-flower-/, { includeHiddenElements: true })
    .map(element => element.props.source);

const prevButton = () => screen.getByRole('button', { name: 'Previous week' });
const nextButton = () => screen.getByRole('button', { name: 'Next week' });

beforeEach(() => {
  jest.resetAllMocks();
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
  signIn('tok');
});

afterEach(() => {
  queryClient.clear();
  jest.useRealTimers();
});

describe('WeekScreen week bounds and navigation', () => {
  it('asks for this week, local Monday midnight to the next Monday', async () => {
    await renderLoaded(week([makeMeal()]));

    expect(mockedFetchWeek).toHaveBeenCalledTimes(1);
    expect(mockedFetchWeek).toHaveBeenCalledWith(
      'tok',
      local(9, 28),
      local(10, 5),
    );
    expect(screen.getByText('Your week')).toBeOnTheScreen();
    expect(screen.getByText('Sep 28 – Oct 4')).toBeOnTheScreen();
  });

  it('counts a Sunday as the end of the week that started the Monday before', async () => {
    jest.setSystemTime(local(10, 4, 23, 30));
    await renderLoaded(week([makeMeal()]));

    expect(mockedFetchWeek).toHaveBeenCalledWith(
      'tok',
      local(9, 28),
      local(10, 5),
    );
    expect(screen.getByText('Sep 28 – Oct 4')).toBeOnTheScreen();
  });

  it('disables next on the current week, and pressing it does nothing', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    await renderLoaded(week([makeMeal()]));

    expect(nextButton()).toBeDisabled();
    expect(prevButton()).toBeEnabled();

    await user.press(nextButton());

    expect(screen.getByText('Sep 28 – Oct 4')).toBeOnTheScreen();
    expect(mockedFetchWeek).toHaveBeenCalledTimes(1);
  });

  it('goes back a week, then forward to this week again', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    await renderLoaded(week([makeMeal()]));

    await user.press(prevButton());

    expect(await screen.findByText('Sep 21 – Sep 27')).toBeOnTheScreen();
    expect(mockedFetchWeek).toHaveBeenLastCalledWith(
      'tok',
      local(9, 21),
      local(9, 28),
    );
    expect(nextButton()).toBeEnabled();
    expect(await screen.findByTestId('week-day-2026-09-21')).toBeOnTheScreen();

    await user.press(nextButton());

    expect(await screen.findByText('Sep 28 – Oct 4')).toBeOnTheScreen();
    expect(nextButton()).toBeDisabled();
    expect(screen.getByTestId('week-day-2026-09-28')).toBeOnTheScreen();
  });

  it('crosses a month and a year going back', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    jest.setSystemTime(new Date(2027, 0, 6, 12));
    mockedFetchWeek.mockResolvedValue(week([makeMeal()]));
    await renderScreen();

    expect(await screen.findByText('Jan 4 – Jan 10')).toBeOnTheScreen();

    await user.press(prevButton());

    expect(await screen.findByText('Dec 28 – Jan 3')).toBeOnTheScreen();
    expect(mockedFetchWeek).toHaveBeenLastCalledWith(
      'tok',
      new Date(2026, 11, 28),
      new Date(2027, 0, 4),
    );
  });

  it('does not ask for the week without a token', async () => {
    signIn(null);
    await renderScreen();

    expect(mockedFetchWeek).not.toHaveBeenCalled();
  });

  it('refreshes a loaded week when meals are invalidated (a meal was saved)', async () => {
    await renderLoaded(week([makeMeal()]));
    mockedFetchWeek.mockResolvedValue(
      week([makeMeal(), makeMeal({ id: 'm2', text: 'an apple' })]),
    );

    await act(() => queryClient.invalidateQueries({ queryKey: mealKeys.all }));

    expect(await screen.findByText('an apple')).toBeOnTheScreen();
    expect(mockedFetchWeek).toHaveBeenCalledTimes(2);
  });
});

describe('WeekScreen days', () => {
  it('shows the seven days Monday to Sunday, "Nothing logged" on empty ones', async () => {
    await renderLoaded(
      week(
        [makeMeal({ id: 'm1', eatenAt: iso(9, 30) })],
        [makeAttempt({ id: 'a1', madeAt: iso(10, 2) })],
      ),
    );

    const days = [
      ['2026-09-28', 'MON'],
      ['2026-09-29', 'TUE'],
      ['2026-09-30', 'WED'],
      ['2026-10-01', 'THU'],
      ['2026-10-02', 'FRI'],
      ['2026-10-03', 'SAT'],
      ['2026-10-04', 'SUN'],
    ];
    for (const [key, name] of days) {
      expect(day(key).getByText(name)).toBeOnTheScreen();
    }
    expect(screen.getAllByText('Nothing logged')).toHaveLength(5);
    expect(
      day('2026-09-30').queryByText('Nothing logged'),
    ).not.toBeOnTheScreen();
    expect(
      day('2026-10-02').queryByText('Nothing logged'),
    ).not.toBeOnTheScreen();
    expect(day('2026-09-28').getByText('Nothing logged')).toBeOnTheScreen();
  });

  it('places items by local day, right up to the edges of each day', async () => {
    await renderLoaded(
      week(
        [
          makeMeal({ id: 'early', eatenAt: iso(9, 29, 0, 30) }),
          makeMeal({ id: 'late', eatenAt: iso(9, 29, 23, 30) }),
          makeMeal({ id: 'monday', eatenAt: iso(9, 28, 0, 0) }),
        ],
        [makeAttempt({ id: 'sunday', madeAt: iso(10, 4, 23, 59) })],
      ),
    );

    expect(itemIdsIn('2026-09-28')).toEqual(['week-item-meal-monday']);
    expect(itemIdsIn('2026-09-29')).toEqual([
      'week-item-meal-early',
      'week-item-meal-late',
    ]);
    expect(itemIdsIn('2026-10-04')).toEqual(['week-item-attempt-sunday']);
    expect(itemIdsIn('2026-09-30')).toEqual([]);
  });

  it('orders meals and attempts by time within a day, whatever order they arrive in', async () => {
    await renderLoaded(
      week(
        [
          makeMeal({ id: 'dinner', eatenAt: iso(9, 30, 19) }),
          makeMeal({ id: 'lunch', eatenAt: iso(9, 30, 13) }),
        ],
        [
          makeAttempt({ id: 'breakfast', madeAt: iso(9, 30, 8) }),
          makeAttempt({ id: 'snack', madeAt: iso(9, 30, 16) }),
        ],
      ),
    );

    expect(itemIdsIn('2026-09-30')).toEqual([
      'week-item-attempt-breakfast',
      'week-item-meal-lunch',
      'week-item-attempt-snack',
      'week-item-meal-dinner',
    ]);
  });
});

describe('WeekScreen tiles', () => {
  it('shows a text meal as its text, read out with kind, day and fullness', async () => {
    await renderLoaded(week([makeMeal()]));

    const tile = screen.getByLabelText(
      'Meal, Wednesday, lentil soup, Satisfied',
    );
    expect(tile).toHaveProp('testID', 'week-item-meal-m1');
    expect(within(tile).getByText('lentil soup')).toBeOnTheScreen();
    expect(tileImages('week-item-meal-m1')).toHaveLength(0);
  });

  it('leaves out the fullness when none was picked, and says Snack for snacks', async () => {
    await renderLoaded(
      week([
        makeMeal({
          kind: MealKind.Snack,
          text: 'an apple',
          fullness: null,
          eatenAt: iso(9, 29),
        }),
      ]),
    );

    expect(screen.getByLabelText('Snack, Tuesday, an apple')).toBeOnTheScreen();
  });

  it('shows a photo meal as the photo, fetched with the token', async () => {
    await renderLoaded(
      week([
        makeMeal({
          id: 'p1',
          text: null,
          nutrients: [],
          fullness: null,
          hasPhoto: true,
          eatenAt: iso(9, 28),
        }),
      ]),
    );

    expect(screen.getByLabelText('Meal, Monday')).toBeOnTheScreen();
    const images = tileImages('week-item-meal-p1');
    expect(images).toHaveLength(1);
    expect(images[0].props.source).toEqual({
      uri: mealPhotoUrl('p1'),
      headers: { Authorization: 'Bearer tok' },
    });
  });

  it('shows the photo, not the text, when a meal has both', async () => {
    await renderLoaded(week([makeMeal({ hasPhoto: true })]));

    expect(tileImages('week-item-meal-m1')).toHaveLength(1);
    expect(screen.queryByText('lentil soup')).not.toBeOnTheScreen();
    // Still read out with its text.
    expect(
      screen.getByLabelText('Meal, Wednesday, lentil soup, Satisfied'),
    ).toBeOnTheScreen();
  });

  it('shows an attempt as its recipe title and opens that attempt on press', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    const navigation = await renderLoaded(
      week([], [makeAttempt({ id: 'a7', recipeId: 'r3' })]),
    );

    const tile = screen.getByRole('button', {
      name: 'Cooked, Shakshuka, Thursday, Very full',
    });
    expect(within(tile).getByText('Shakshuka')).toBeOnTheScreen();
    expect(tileImages('week-item-attempt-a7')).toHaveLength(0);

    await user.press(tile);

    expect(navigation.navigate).toHaveBeenCalledTimes(1);
    expect(navigation.navigate).toHaveBeenCalledWith(Screens.AttemptDetail, {
      recipeId: 'r3',
      attemptId: 'a7',
    });
  });

  it("shows an attempt's recipe image instead of the title when there is one", async () => {
    await renderLoaded(
      week(
        [],
        [
          makeAttempt({
            fullness: null,
            recipe: {
              id: 'r1',
              title: 'Shakshuka',
              imageUrl: 'https://example.com/shakshuka.jpg',
            },
          }),
        ],
      ),
    );

    expect(
      screen.getByRole('button', { name: 'Cooked, Shakshuka, Thursday' }),
    ).toBeOnTheScreen();
    expect(screen.queryByText('Shakshuka')).not.toBeOnTheScreen();
    const images = tileImages('week-item-attempt-a1');
    expect(images).toHaveLength(1);
    expect(images[0].props.source).toEqual({
      uri: 'https://example.com/shakshuka.jpg',
    });
  });

  it("shows the attempt's own photo, fetched with the token, over the recipe image", async () => {
    await renderLoaded(
      week(
        [],
        [
          makeAttempt({
            id: 'a7',
            fullness: null,
            hasPhoto: true,
            recipe: {
              id: 'r1',
              title: 'Shakshuka',
              imageUrl: 'https://example.com/shakshuka.jpg',
            },
          }),
        ],
      ),
    );

    const images = tileImages('week-item-attempt-a7');
    expect(images).toHaveLength(1);
    expect(images[0].props.source).toEqual({
      uri: attemptPhotoUrl('a7'),
      headers: { Authorization: 'Bearer tok' },
    });
    expect(screen.queryByText('Shakshuka')).not.toBeOnTheScreen();
    // Still read out with the recipe title.
    expect(
      screen.getByRole('button', { name: 'Cooked, Shakshuka, Thursday' }),
    ).toBeOnTheScreen();
  });

  it("shows the attempt's photo when the recipe has no image", async () => {
    await renderLoaded(week([], [makeAttempt({ id: 'a7', hasPhoto: true })]));

    const images = tileImages('week-item-attempt-a7');
    expect(images).toHaveLength(1);
    expect(images[0].props.source).toEqual({
      uri: attemptPhotoUrl('a7'),
      headers: { Authorization: 'Bearer tok' },
    });
    expect(screen.queryByText('Shakshuka')).not.toBeOnTheScreen();
  });
});

describe('WeekScreen tile tags', () => {
  // Scoped to the tile: the meal sheet shows the kind too.
  const tile = (testID: string) => within(screen.getByTestId(testID));
  const expectNoTags = (testID: string) => {
    for (const tag of ['COOKED', 'SNACK', 'MEAL']) {
      expect(tile(testID).queryByText(tag)).not.toBeOnTheScreen();
    }
  };

  it('tags a cooked recipe shown by its title', async () => {
    await renderLoaded(week([], [makeAttempt()]));

    expect(tile('week-item-attempt-a1').getByText('COOKED')).toBeOnTheScreen();
    expect(
      tile('week-item-attempt-a1').getByText('Shakshuka'),
    ).toBeOnTheScreen();
    expect(
      tile('week-item-attempt-a1').queryByText('SNACK'),
    ).not.toBeOnTheScreen();
  });

  it('tags a cooked recipe shown by its image', async () => {
    await renderLoaded(
      week(
        [],
        [
          makeAttempt({
            recipe: {
              id: 'r1',
              title: 'Shakshuka',
              imageUrl: 'https://example.com/shakshuka.jpg',
            },
          }),
        ],
      ),
    );

    expect(tileImages('week-item-attempt-a1')).toHaveLength(1);
    expect(tile('week-item-attempt-a1').getByText('COOKED')).toBeOnTheScreen();
  });

  it('tags a text snack', async () => {
    await renderLoaded(
      week([makeMeal({ kind: MealKind.Snack, text: 'an apple' })]),
    );

    expect(tile('week-item-meal-m1').getByText('SNACK')).toBeOnTheScreen();
    expect(tile('week-item-meal-m1').getByText('an apple')).toBeOnTheScreen();
    expect(
      tile('week-item-meal-m1').queryByText('COOKED'),
    ).not.toBeOnTheScreen();
  });

  it('tags a photo snack', async () => {
    await renderLoaded(
      week([makeMeal({ kind: MealKind.Snack, text: null, hasPhoto: true })]),
    );

    expect(tileImages('week-item-meal-m1')).toHaveLength(1);
    expect(tile('week-item-meal-m1').getByText('SNACK')).toBeOnTheScreen();
  });

  it('gives plain meals no tag, as text or photo', async () => {
    await renderLoaded(
      week([
        makeMeal({ id: 'text' }),
        makeMeal({ id: 'photo', text: null, hasPhoto: true }),
      ]),
    );

    expect(
      tile('week-item-meal-text').getByText('lentil soup'),
    ).toBeOnTheScreen();
    expectNoTags('week-item-meal-text');
    expect(tileImages('week-item-meal-photo')).toHaveLength(1);
    expectNoTags('week-item-meal-photo');
  });
});

describe('WeekScreen empty, loading and error states', () => {
  it('shows nothing but the week header while loading', async () => {
    mockedFetchWeek.mockReturnValue(new Promise(() => {}));
    await renderScreen();

    expect(screen.getByText('Sep 28 – Oct 4')).toBeOnTheScreen();
    expect(screen.queryByTestId('week-day-2026-09-28')).not.toBeOnTheScreen();
    expect(screen.queryByText(EMPTY_TEXT)).not.toBeOnTheScreen();
    expect(screen.queryByText(LOAD_FAILED)).not.toBeOnTheScreen();
  });

  it('offers to add a meal when the week is empty, instead of days and summary', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    mockedFetchWeek.mockResolvedValue(week());
    const navigation = await renderScreen();

    expect(await screen.findByText(EMPTY_TEXT)).toBeOnTheScreen();
    expect(screen.queryByTestId('week-day-2026-09-28')).not.toBeOnTheScreen();
    expect(screen.queryByTestId('week-bouquet')).not.toBeOnTheScreen();

    await user.press(
      screen.getByRole('button', { name: '＋ Add what you ate' }),
    );

    expect(navigation.navigate).toHaveBeenCalledTimes(1);
    expect(navigation.navigate).toHaveBeenCalledWith(Screens.AddMeal);
  });

  it('keeps week navigation on an empty week', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    mockedFetchWeek.mockResolvedValue(week());
    await renderScreen();
    await screen.findByText(EMPTY_TEXT);

    await user.press(prevButton());

    expect(await screen.findByText('Sep 21 – Sep 27')).toBeOnTheScreen();
  });

  it('shows an error with a retry that loads the week', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    mockedFetchWeek.mockRejectedValueOnce(new Error('offline'));
    mockedFetchWeek.mockResolvedValueOnce(week([makeMeal()]));
    await renderScreen();

    expect(await screen.findByText(LOAD_FAILED)).toBeOnTheScreen();
    expect(screen.queryByTestId('week-day-2026-09-28')).not.toBeOnTheScreen();

    await user.press(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('lentil soup')).toBeOnTheScreen();
    expect(screen.queryByText(LOAD_FAILED)).not.toBeOnTheScreen();
    expect(mockedFetchWeek).toHaveBeenCalledTimes(2);
  });
});

describe('WeekScreen summary', () => {
  const dots = () => screen.getByRole('image');
  const summaryText = () => screen.getByTestId('week-summary-text');
  const moreLink = () => screen.getByRole('link');

  it('does not count photo-only meals or attempts with no nutrients', async () => {
    // Judged: protein 2 of 2, fiber 1 of 2 (full). Counting the other two
    // would make fiber 1 of 4 (some).
    await renderLoaded(
      week(
        [
          makeMeal({ id: 'm1', nutrients: [Protein, Fiber] }),
          makeMeal({ id: 'm2', text: null, nutrients: [], hasPhoto: true }),
        ],
        [
          makeAttempt({ id: 'a1', nutrients: [Protein] }),
          makeAttempt({ id: 'a2', nutrients: [] }),
        ],
      ),
    );

    expect(summaryText()).toHaveTextContent(
      'Protein and fiber showed up often. No healthy fat yet.',
    );
    expect(dots()).toHaveAccessibleName(
      'Protein in most meals, fiber in most meals, healthy fat not yet',
    );
    expect(dots()).toHaveProp('testID', 'week-bouquet');
  });

  it('counts a text meal with no known foods, so it dilutes the week', async () => {
    await renderLoaded(
      week([
        makeMeal({ id: 'm1', nutrients: [Protein] }),
        makeMeal({ id: 'm2', text: 'water', nutrients: [] }),
        makeMeal({ id: 'm3', text: 'tea', nutrients: [] }),
      ]),
    );

    expect(summaryText()).toHaveTextContent(
      'Protein a few times. No fiber or healthy fat yet.',
    );
    expect(dots()).toHaveAccessibleName(
      'Protein in some, fiber not yet, healthy fat not yet',
    );
  });

  it('links to foods with the first nutrient not there yet', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    const navigation = await renderLoaded(
      week([makeMeal({ nutrients: [Protein, Fiber] })]),
    );

    expect(moreLink()).toHaveTextContent('See foods with healthy fat ›');

    await user.press(moreLink());

    expect(navigation.navigate).toHaveBeenCalledTimes(1);
    expect(navigation.navigate).toHaveBeenCalledWith(Screens.Ingredients, {
      group: HealthyFat,
    });
  });

  it('prefers a missing nutrient over one that showed up a few times', async () => {
    // Protein 1 of 3 (some), fiber none, healthy fat 2 of 3 (full).
    await renderLoaded(
      week([
        makeMeal({ id: 'm1', nutrients: [Protein, HealthyFat] }),
        makeMeal({ id: 'm2', nutrients: [HealthyFat] }),
        makeMeal({ id: 'm3', nutrients: [] }),
      ]),
    );

    expect(summaryText()).toHaveTextContent(
      'Healthy fat showed up often. Protein a few times. No fiber yet.',
    );
    expect(moreLink()).toHaveTextContent('See foods with fiber ›');
  });

  it('links to the first nutrient that showed up a few times when none is missing', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    const navigation = await renderLoaded(
      week([
        makeMeal({ id: 'm1', nutrients: [HealthyFat] }),
        makeMeal({ id: 'm2', nutrients: [Fiber] }),
        makeMeal({ id: 'm3', nutrients: [Protein] }),
      ]),
    );

    expect(summaryText()).toHaveTextContent(
      'Protein, fiber and healthy fat a few times.',
    );

    await user.press(moreLink());

    expect(navigation.navigate).toHaveBeenCalledWith(Screens.Ingredients, {
      group: Protein,
    });
  });

  it('has no link when every nutrient showed up often', async () => {
    await renderLoaded(
      week([], [makeAttempt({ nutrients: [Protein, Fiber, HealthyFat] })]),
    );

    expect(summaryText()).toHaveTextContent(
      'Protein, fiber and healthy fat showed up often.',
    );
    expect(screen.queryByRole('link')).not.toBeOnTheScreen();
  });

  it('counts an attempt that has nutrients', async () => {
    await renderLoaded(week([], [makeAttempt({ nutrients: [Fiber] })]));

    expect(summaryText()).toHaveTextContent(
      'Fiber showed up often. No protein or healthy fat yet.',
    );
    expect(moreLink()).toHaveTextContent('See foods with protein ›');
  });

  it('asks for meal text, with empty dots and no link, when nothing can be judged', async () => {
    await renderLoaded(
      week(
        [makeMeal({ text: null, nutrients: [], hasPhoto: true })],
        [makeAttempt({ nutrients: [] })],
      ),
    );

    expect(summaryText()).toHaveTextContent(NO_TEXT);
    expect(dots()).toHaveAccessibleName(
      'Protein not yet, fiber not yet, healthy fat not yet',
    );
    expect(screen.queryByRole('link')).not.toBeOnTheScreen();
  });
});

describe('WeekScreen bouquet', () => {
  it('grows one flower per meal and attempt, in time order across the week', async () => {
    await renderLoaded(
      week(
        [
          // Arrives out of order; shown Mon → Sun, by time within a day.
          makeMeal({
            id: 'balanced',
            eatenAt: iso(10, 2, 13),
            nutrients: [Protein, Fiber, HealthyFat],
          }),
          makeMeal({
            id: 'photo',
            text: null,
            nutrients: [],
            hasPhoto: true,
            eatenAt: iso(9, 28, 9),
          }),
          makeMeal({
            id: 'water',
            text: 'water',
            nutrients: [],
            eatenAt: iso(9, 29, 18),
          }),
        ],
        [
          makeAttempt({
            id: 'two',
            madeAt: iso(9, 29, 8),
            nutrients: [Protein, Fiber],
          }),
          makeAttempt({ id: 'none', madeAt: iso(10, 3), nutrients: [] }),
          makeAttempt({
            id: 'one',
            madeAt: iso(9, 28, 20),
            nutrients: [Fiber],
          }),
        ],
      ),
    );

    expect(bouquetFlowers()).toEqual(
      [
        Flower.Photo, // Mon 09:00 photo-only meal: herb
        Flower.One, // Mon 20:00 attempt with fiber
        Flower.Two, // Tue 08:00 attempt with two
        Flower.Sprout, // Tue 18:00 text meal, nothing known
        Flower.Balanced, // Fri meal with all three: sunflower
        Flower.Photo, // Sat attempt with no nutrients: not judged
      ].map(flower => flowerImages[flower]),
    );
  });

  it('is read out once, with the week balance, as the only image', async () => {
    await renderLoaded(
      week([makeMeal({ nutrients: [Protein, Fiber] })], [makeAttempt()]),
    );

    const bouquet = screen.getByRole('image');
    expect(bouquet).toHaveProp('testID', 'week-bouquet');
    expect(bouquet).toHaveAccessibleName(
      'Protein in most meals, fiber in most meals, healthy fat not yet',
    );
  });

  it("shows each tile's flower, hidden from screen readers", async () => {
    await renderLoaded(
      week(
        [
          makeMeal({ id: 'photo', text: null, nutrients: [], hasPhoto: true }),
          makeMeal({ id: 'full', nutrients: [Protein, Fiber, HealthyFat] }),
        ],
        [makeAttempt({ id: 'a1', nutrients: [Protein] })],
      ),
    );

    const flowers = [
      ['week-item-meal-photo', Flower.Photo],
      ['week-item-meal-full', Flower.Balanced],
      ['week-item-attempt-a1', Flower.One],
    ] as const;
    for (const [testID, flower] of flowers) {
      expect(tileFlower(testID)).toHaveProp('source', flowerImages[flower]);
      expect(tileFlower(testID)).not.toBeVisible();
      expect(screen.queryByTestId(`${testID}-flower`)).not.toBeOnTheScreen();
    }
  });
});

describe('WeekScreen meal sheet', () => {
  const sheet = () => screen.queryByTestId('meal-sheet');
  const lentils = makeMeal({ id: 'm1', text: 'lentil soup' });
  const apple = makeMeal({
    id: 'm2',
    kind: MealKind.Snack,
    text: 'an apple',
    nutrients: [Fiber],
    fullness: null,
    eatenAt: iso(9, 29, 16, 5),
  });

  it('makes meal tiles buttons that open the sheet for that meal', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    await renderLoaded(week([lentils, apple]));
    expect(sheet()).not.toBeOnTheScreen();

    await user.press(
      screen.getByRole('button', { name: 'Snack, Tuesday, an apple' }),
    );

    expect(screen.getByTestId('meal-sheet-when')).toHaveTextContent(
      'Tuesday, 16:05',
    );
    expect(screen.getByTestId('meal-sheet-text')).toHaveTextContent('an apple');
    expect(
      within(screen.getByTestId('meal-sheet')).getByText('SNACK'),
    ).toBeOnTheScreen();
    for (const option of screen.getAllByRole('radio')) {
      expect(option).not.toBeChecked();
    }
  });

  it('closes the sheet on a backdrop tap and opens another meal', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    await renderLoaded(week([lentils, apple]));

    await user.press(screen.getByTestId('week-item-meal-m2'));
    await user.press(
      screen.getByRole('button', {
        name: 'Close',
        includeHiddenElements: true,
      }),
    );
    expect(sheet()).not.toBeOnTheScreen();

    await user.press(screen.getByTestId('week-item-meal-m1'));
    expect(screen.getByTestId('meal-sheet-text')).toHaveTextContent(
      'lentil soup',
    );
    expect(screen.getByRole('radio', { name: 'Satisfied' })).toBeChecked();
  });

  it('saves a new fullness, then refetches the week and shows it on the tile', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    await renderLoaded(week([lentils]));
    const updated = { ...lentils, fullness: Fullness.VeryFull };
    mockedUpdateMeal.mockResolvedValue(updated);
    mockedFetchWeek.mockResolvedValue(week([updated]));

    await user.press(screen.getByTestId('week-item-meal-m1'));
    await user.press(screen.getByRole('radio', { name: 'Very full' }));

    expect(mockedUpdateMeal).toHaveBeenCalledWith('tok', 'm1', {
      fullness: Fullness.VeryFull,
    });
    expect(
      await screen.findByLabelText('Meal, Wednesday, lentil soup, Very full'),
    ).toBeOnTheScreen();
    expect(mockedFetchWeek).toHaveBeenCalledTimes(2);
    // The sheet stays open on the updated meal.
    expect(sheet()).toBeOnTheScreen();
    expect(screen.getByRole('radio', { name: 'Very full' })).toBeChecked();
  });

  it('deletes after confirming, closes the sheet, and the tile is gone after the refetch', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await renderLoaded(week([lentils, apple]));
    mockedDeleteMeal.mockResolvedValue(undefined);
    mockedFetchWeek.mockResolvedValue(week([apple]));

    await user.press(screen.getByTestId('week-item-meal-m1'));
    await user.press(screen.getByTestId('meal-sheet-delete-button'));
    const buttons = alert.mock.calls[0][2] as AlertButton[];
    await act(async () => {
      buttons.find(b => b.text === 'Delete')!.onPress!();
    });

    expect(mockedDeleteMeal).toHaveBeenCalledWith('tok', 'm1');
    await waitFor(() =>
      expect(screen.queryByTestId('week-item-meal-m1')).not.toBeOnTheScreen(),
    );
    expect(sheet()).not.toBeOnTheScreen();
    expect(screen.getByTestId('week-item-meal-m2')).toBeOnTheScreen();
    expect(mockedFetchWeek).toHaveBeenCalledTimes(2);
    expect(alert).toHaveBeenCalledTimes(1);
    alert.mockRestore();
  });

  it('closes the sheet when its meal is gone after a refetch', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    await renderLoaded(week([lentils, apple]));
    await user.press(screen.getByTestId('week-item-meal-m1'));
    mockedFetchWeek.mockResolvedValue(week([apple]));

    await act(() => queryClient.invalidateQueries({ queryKey: mealKeys.all }));

    await waitFor(() => expect(sheet()).not.toBeOnTheScreen());
    expect(screen.queryByTestId('week-item-meal-m1')).not.toBeOnTheScreen();
  });

  it('keeps the sheet closed through a later refetch once closed', async () => {
    // Closing clears the open meal, not just hides it.
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    await renderLoaded(week([lentils]));
    await user.press(screen.getByTestId('week-item-meal-m1'));
    await user.press(
      screen.getByRole('button', {
        name: 'Close',
        includeHiddenElements: true,
      }),
    );
    mockedFetchWeek.mockResolvedValue(week([lentils, apple]));

    await act(() => queryClient.invalidateQueries({ queryKey: mealKeys.all }));

    expect(await screen.findByText('an apple')).toBeOnTheScreen();
    expect(sheet()).not.toBeOnTheScreen();
  });
});
