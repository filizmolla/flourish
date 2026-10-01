import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  act,
  render,
  screen,
  userEvent,
  within,
} from '@testing-library/react-native';
import { FoodGroup, IngredientSummary } from '../api/recipesClient';
import { useAuth } from '../auth/AuthContext';
import { AuthStatus } from '../auth/authStatus';
import { API_BASE_URL } from '../config';
import { AppStackParamList, Screens } from '../navigation/types';
import { colors } from '../theme';
import IngredientsScreen, { SEARCH_DELAY_MS } from './IngredientsScreen';

jest.mock('../auth/AuthContext', () => ({ useAuth: jest.fn() }));

type Props = NativeStackScreenProps<AppStackParamList, Screens.Ingredients>;

const mockedUseAuth = jest.mocked(useAuth);

function makeIngredient(
  overrides: Partial<IngredientSummary> = {},
): IngredientSummary {
  return {
    id: 'i1',
    name: 'Avocado',
    mainGroup: FoodGroup.HealthyFat,
    nutrients: [FoodGroup.HealthyFat, FoodGroup.Fiber],
    ...overrides,
  };
}

const avocado = makeIngredient();
const lentils = makeIngredient({
  id: 'i2',
  name: 'Lentils',
  mainGroup: FoodGroup.Protein,
  nutrients: [FoodGroup.Protein, FoodGroup.Fiber],
});
const cumin = makeIngredient({
  id: 'i3',
  name: 'Cumin',
  mainGroup: null,
  nutrients: [],
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

let fetchMock: jest.SpyInstance;
let queryClient: QueryClient;

function SignedInQueryProvider({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

// Answers each request by its path + query; anything unlisted is [].
function serveIngredients(byPath: Record<string, IngredientSummary[]>) {
  fetchMock.mockImplementation(async (url: string) =>
    jsonResponse(200, byPath[url.slice(API_BASE_URL.length)] ?? []),
  );
}

function requestedPaths(): string[] {
  return fetchMock.mock.calls.map(([url]) =>
    (url as string).slice(API_BASE_URL.length),
  );
}

async function renderScreen(params?: Props['route']['params']) {
  const user = userEvent.setup();
  const navigation = { navigate: jest.fn() };
  await render(
    <IngredientsScreen
      navigation={navigation as unknown as Props['navigation']}
      route={
        { key: 'Ingredients-1', name: Screens.Ingredients, params } as Props['route']
      }
    />,
    { wrapper: SignedInQueryProvider },
  );
  return { user, navigation };
}

function searchInput() {
  return screen.getByPlaceholderText('Search ingredients');
}

function filter(name: string) {
  return screen.getByRole('button', { name });
}

async function waitOutSearchDelay() {
  await act(() => jest.advanceTimersByTime(SEARCH_DELAY_MS));
}

beforeEach(() => {
  jest.useFakeTimers();
  fetchMock = jest.spyOn(globalThis, 'fetch');
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  mockedUseAuth.mockReturnValue({
    status: AuthStatus.SignedIn,
    user: { id: 'u1', name: 'Filiz Test', email: 'f@test.local' },
    token: 'tok',
    signIn: jest.fn(),
    signUp: jest.fn(),
    signOut: jest.fn(),
  });
});

afterEach(() => {
  queryClient.clear();
  fetchMock.mockRestore();
  jest.useRealTimers();
});

describe('IngredientsScreen', () => {
  describe('initial load', () => {
    it('requests the whole catalog with the token and lists each ingredient with its chips', async () => {
      serveIngredients({ '/ingredients': [avocado, lentils, cumin] });
      await renderScreen();

      const avocadoRow = await screen.findByTestId('ingredient-list-item-i1');
      expect(avocadoRow).toHaveTextContent('Avocado', { exact: false });
      expect(
        within(avocadoRow).getByLabelText('Mainly healthy fat, also fiber'),
      ).toBeOnTheScreen();

      const lentilsRow = screen.getByTestId('ingredient-list-item-i2');
      expect(
        within(lentilsRow).getByLabelText('Mainly protein, also fiber'),
      ).toBeOnTheScreen();

      // A seasoning shows only its name.
      expect(screen.getByTestId('ingredient-list-item-i3')).toHaveTextContent(
        'Cumin',
      );

      expect(requestedPaths()).toEqual(['/ingredients']);
      const init = fetchMock.mock.calls[0][1] as RequestInit;
      expect(init.headers).toEqual({ Authorization: 'Bearer tok' });
    });

    // The ActivityIndicator has no role or label to query by, so this checks
    // that neither the list nor its empty text shows up early.
    it('shows no list and no empty text while the first request is pending', async () => {
      fetchMock.mockReturnValue(new Promise(() => {}));
      await renderScreen();

      expect(screen.queryByTestId('ingredient-list')).not.toBeOnTheScreen();
      expect(
        screen.queryByTestId('ingredient-list-empty-text'),
      ).not.toBeOnTheScreen();
    });

    it('shows the server error message when the request fails', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(500, { error: 'Catalog unavailable' }),
      );
      await renderScreen();

      expect(await screen.findByText('Catalog unavailable')).toBeOnTheScreen();
      expect(screen.queryByTestId('ingredient-list')).not.toBeOnTheScreen();
    });

    it('says the catalog is empty when there is nothing and no search', async () => {
      serveIngredients({});
      await renderScreen();

      expect(
        await screen.findByTestId('ingredient-list-empty-text'),
      ).toHaveTextContent('No ingredients here yet.');
    });

    it('starts with "All" selected and no group chip selected', async () => {
      serveIngredients({});
      await renderScreen();

      expect(filter('All')).toBeSelected();
      for (const name of ['Protein', 'Fiber', 'Healthy fat', 'Carb']) {
        expect(filter(name)).not.toBeSelected();
      }
    });

    it('starts filtered to the group passed in the route', async () => {
      serveIngredients({ '/ingredients?group=HEALTHY_FAT': [avocado] });
      await renderScreen({ group: FoodGroup.HealthyFat });

      expect(
        await screen.findByTestId('ingredient-list-item-i1'),
      ).toBeOnTheScreen();
      expect(filter('Healthy fat')).toBeSelected();
      for (const name of ['All', 'Protein', 'Fiber', 'Carb']) {
        expect(filter(name)).not.toBeSelected();
      }
      // No unfiltered request first.
      expect(requestedPaths()).toEqual(['/ingredients?group=HEALTHY_FAT']);
    });

    it('lets All clear a group that came from the route', async () => {
      serveIngredients({ '/ingredients': [avocado, lentils] });
      const { user } = await renderScreen({ group: FoodGroup.HealthyFat });
      await screen.findByTestId('ingredient-list-empty-text');

      await user.press(filter('All'));

      expect(filter('All')).toBeSelected();
      expect(
        await screen.findByTestId('ingredient-list-item-i2'),
      ).toBeOnTheScreen();
      expect(requestedPaths()).toEqual([
        '/ingredients?group=HEALTHY_FAT',
        '/ingredients',
      ]);
    });
  });

  describe('search', () => {
    it('waits for the typing to pause before sending one request with q', async () => {
      serveIngredients({ '/ingredients': [avocado, lentils] });
      const { user } = await renderScreen();
      await screen.findByTestId('ingredient-list-item-i1');

      await user.type(searchInput(), 'avo');
      await act(() => jest.advanceTimersByTime(SEARCH_DELAY_MS - 1));

      expect(requestedPaths()).toEqual(['/ingredients']);

      await act(() => jest.advanceTimersByTime(1));

      expect(requestedPaths()).toEqual(['/ingredients', '/ingredients?q=avo']);
    });

    it('restarts the delay on every keystroke', async () => {
      serveIngredients({});
      const { user } = await renderScreen();
      await screen.findByTestId('ingredient-list-empty-text');

      await user.type(searchInput(), 'a');
      await act(() => jest.advanceTimersByTime(SEARCH_DELAY_MS - 50));
      await user.type(searchInput(), 'v');
      await act(() => jest.advanceTimersByTime(SEARCH_DELAY_MS - 50));

      expect(requestedPaths()).toEqual(['/ingredients']);

      await act(() => jest.advanceTimersByTime(50));

      expect(requestedPaths()).toEqual(['/ingredients', '/ingredients?q=av']);
    });

    it('shows the matches for the search', async () => {
      serveIngredients({
        '/ingredients': [avocado],
        '/ingredients?q=lent': [lentils],
      });
      const { user } = await renderScreen();
      await screen.findByTestId('ingredient-list-item-i1');

      await user.type(searchInput(), 'lent');
      await waitOutSearchDelay();

      expect(
        await screen.findByTestId('ingredient-list-item-i2'),
      ).toHaveTextContent('Lentils', { exact: false });
      expect(
        screen.queryByTestId('ingredient-list-item-i1'),
      ).not.toBeOnTheScreen();
    });

    it('trims the search and URI-encodes it', async () => {
      serveIngredients({});
      const { user } = await renderScreen();
      await screen.findByTestId('ingredient-list-empty-text');

      await user.type(searchInput(), '  süt tozu  ');
      await waitOutSearchDelay();

      expect(requestedPaths()).toEqual([
        '/ingredients',
        '/ingredients?q=s%C3%BCt%20tozu',
      ]);
    });

    it('says nothing matched, quoting the trimmed search', async () => {
      serveIngredients({ '/ingredients': [avocado] });
      const { user } = await renderScreen();
      await screen.findByTestId('ingredient-list-item-i1');

      await user.type(searchInput(), ' kale ');
      await waitOutSearchDelay();

      expect(await screen.findByText('No "kale" yet.')).toBeOnTheScreen();
    });

    it('treats a whitespace-only search as no search', async () => {
      serveIngredients({});
      const { user } = await renderScreen();
      await screen.findByTestId('ingredient-list-empty-text');

      await user.type(searchInput(), '   ');
      await waitOutSearchDelay();

      expect(requestedPaths()).toEqual(['/ingredients']);
      expect(screen.getByTestId('ingredient-list-empty-text')).toHaveTextContent(
        'No ingredients here yet.',
      );
    });

    it('keeps the previous list on screen while the search request is in flight', async () => {
      fetchMock.mockImplementation(async (url: string) =>
        url.endsWith('/ingredients')
          ? jsonResponse(200, [avocado])
          : new Promise(() => {}),
      );
      const { user } = await renderScreen();
      await screen.findByTestId('ingredient-list-item-i1');

      await user.type(searchInput(), 'len');
      await waitOutSearchDelay();

      expect(requestedPaths()).toEqual(['/ingredients', '/ingredients?q=len']);
      expect(screen.getByTestId('ingredient-list-item-i1')).toBeOnTheScreen();
    });
  });

  describe('group filter', () => {
    it.each([
      ['Protein', 'PROTEIN'],
      ['Fiber', 'FIBER'],
      ['Healthy fat', 'HEALTHY_FAT'],
      ['Carb', 'CARB'],
    ])(
      'pressing %s selects it and requests group=%s',
      async (name, group) => {
        serveIngredients({});
        const { user } = await renderScreen();
        await screen.findByTestId('ingredient-list-empty-text');

        await user.press(filter(name));

        expect(filter(name)).toBeSelected();
        expect(filter('All')).not.toBeSelected();
        expect(requestedPaths()).toEqual([
          '/ingredients',
          `/ingredients?group=${group}`,
        ]);
      },
    );

    it('shows the filtered list', async () => {
      serveIngredients({
        '/ingredients': [avocado, lentils],
        '/ingredients?group=PROTEIN': [lentils],
      });
      const { user } = await renderScreen();
      await screen.findByTestId('ingredient-list-item-i1');

      await user.press(filter('Protein'));

      expect(
        await screen.findByTestId('ingredient-list-item-i2'),
      ).toBeOnTheScreen();
      expect(
        screen.queryByTestId('ingredient-list-item-i1'),
      ).not.toBeOnTheScreen();
    });

    it('combines the search and the group in one request', async () => {
      serveIngredients({});
      const { user } = await renderScreen();
      await screen.findByTestId('ingredient-list-empty-text');

      await user.press(filter('Fiber'));
      await user.type(searchInput(), 'avo');
      await waitOutSearchDelay();

      expect(requestedPaths()).toEqual([
        '/ingredients',
        '/ingredients?group=FIBER',
        '/ingredients?q=avo&group=FIBER',
      ]);
    });

    it('pressing All clears the group and reuses the cached catalog', async () => {
      serveIngredients({
        '/ingredients': [avocado, lentils],
        '/ingredients?group=CARB': [],
      });
      const { user } = await renderScreen();
      await screen.findByTestId('ingredient-list-item-i1');

      await user.press(filter('Carb'));
      await screen.findByTestId('ingredient-list-empty-text');
      await user.press(filter('All'));

      expect(filter('All')).toBeSelected();
      expect(filter('Carb')).not.toBeSelected();
      expect(
        await screen.findByTestId('ingredient-list-item-i1'),
      ).toBeOnTheScreen();
      expect(requestedPaths()).toEqual([
        '/ingredients',
        '/ingredients?group=CARB',
      ]);
    });
  });

  describe('rows', () => {
    it('opens the ingredient detail with the row id when a row is pressed', async () => {
      serveIngredients({ '/ingredients': [avocado, lentils] });
      const { user, navigation } = await renderScreen();

      await user.press(
        await screen.findByRole('button', { name: /Lentils/ }),
      );

      expect(navigation.navigate).toHaveBeenCalledTimes(1);
      expect(navigation.navigate).toHaveBeenCalledWith(
        Screens.IngredientDetail,
        { ingredientId: 'i2' },
      );
    });

    it('shows small dots per row that screen readers skip', async () => {
      serveIngredients({ '/ingredients': [avocado, cumin] });
      await renderScreen();

      await screen.findByTestId('ingredient-list-item-i1');
      for (const id of ['i1', 'i3']) {
        const dots = screen.getByTestId(
          `ingredient-list-item-${id}-nutrient-dots`,
          { includeHiddenElements: true },
        );
        expect(dots).toBeOnTheScreen();
        // Queries leave out what accessibility hides.
        expect(
          screen.queryByTestId(`ingredient-list-item-${id}-nutrient-dots`),
        ).not.toBeOnTheScreen();
      }
      expect(screen.queryByRole('image')).not.toBeOnTheScreen();
    });

    it('fills the row dots from the main group and nutrients', async () => {
      serveIngredients({ '/ingredients': [avocado] });
      await renderScreen();

      const dot = (id: string) =>
        screen.getByTestId(
          `ingredient-list-item-i1-nutrient-dots-dot-${id}`,
          { includeHiddenElements: true },
        );
      await screen.findByTestId('ingredient-list-item-i1');
      // Avocado: mainly healthy fat (full), also fiber (some), no protein.
      expect(dot('healthy-fat')).toHaveStyle({ backgroundColor: colors.accent });
      expect(dot('protein')).toHaveStyle({ backgroundColor: colors.card });
      expect(dot('fiber')).toHaveStyle({ borderColor: colors.accent });
      expect(dot('fiber')).not.toHaveStyle({ backgroundColor: colors.accent });
    });
  });
});
