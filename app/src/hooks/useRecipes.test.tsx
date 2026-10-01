import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import * as client from '../api/recipesClient';
import { Recipe, RecipeInput } from '../api/recipesClient';
import { useAuth } from '../auth/AuthContext';
import { AuthStatus } from '../auth/authStatus';
import { attemptKeys } from './useAttempts';
import {
  recipeKeys,
  useCreateRecipe,
  useDeleteRecipe,
  useRecipe,
  useUpdateRecipe,
} from './useRecipes';

jest.mock('../api/recipesClient', () => ({
  ...jest.requireActual('../api/recipesClient'),
  fetchRecipes: jest.fn(),
  fetchRecipe: jest.fn(),
  createRecipe: jest.fn(),
  updateRecipe: jest.fn(),
  deleteRecipe: jest.fn(),
}));
jest.mock('../auth/AuthContext', () => ({ useAuth: jest.fn() }));

const mockedClient = jest.mocked(client);
const mockedUseAuth = jest.mocked(useAuth);

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
  title: 'New',
  ingredients: ['a'],
  instructions: 'b',
  story: null,
  imageUrl: null,
  source: null,
  prepMinutes: null,
  cookMinutes: null,
  servings: null,
};

let queryClient: QueryClient;

function QueryProvider({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

function signedInAs(token: string | null) {
  mockedUseAuth.mockReturnValue({
    status: token ? AuthStatus.SignedIn : AuthStatus.SignedOut,
    user: null,
    token,
    signIn: jest.fn(),
    signUp: jest.fn(),
    signOut: jest.fn(),
  });
}

beforeEach(() => {
  jest.resetAllMocks();
  // gcTime: Infinity keeps React Query from scheduling GC timers that would
  // keep Jest alive after the run.
  queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
  signedInAs('tok');
});

afterEach(() => {
  queryClient.clear();
});

describe('useRecipe', () => {
  it('fetches the recipe with the current token', async () => {
    const recipe = makeRecipe();
    mockedClient.fetchRecipe.mockResolvedValue(recipe);

    const { result } = await renderHook(() => useRecipe('r1'), {
      wrapper: QueryProvider,
    });

    await waitFor(() => expect(result.current.data).toEqual(recipe));
    expect(mockedClient.fetchRecipe).toHaveBeenCalledWith('tok', 'r1');
  });

  it('starts from the copy in the list cache, then refreshes it', async () => {
    const cached = makeRecipe({ title: 'Cached title' });
    const other = makeRecipe({ id: 'r2' });
    queryClient.setQueryData(recipeKeys.list, [other, cached]);
    let resolveFetch!: (recipe: Recipe) => void;
    mockedClient.fetchRecipe.mockReturnValue(
      new Promise(resolve => {
        resolveFetch = resolve;
      }),
    );

    const { result } = await renderHook(() => useRecipe('r1'), {
      wrapper: QueryProvider,
    });

    expect(result.current.isPending).toBe(false);
    expect(result.current.data).toEqual(cached);

    const fresh = makeRecipe({ title: 'Fresh title' });
    await act(async () => resolveFetch(fresh));
    await waitFor(() => expect(result.current.data).toEqual(fresh));
  });

  it('is pending when the list cache does not contain the recipe', async () => {
    queryClient.setQueryData(recipeKeys.list, [makeRecipe({ id: 'r2' })]);
    mockedClient.fetchRecipe.mockReturnValue(new Promise(() => {}));

    const { result } = await renderHook(() => useRecipe('r1'), {
      wrapper: QueryProvider,
    });

    expect(result.current.isPending).toBe(true);
  });

  it('does not fetch while signed out', async () => {
    signedInAs(null);

    const { result } = await renderHook(() => useRecipe('r1'), {
      wrapper: QueryProvider,
    });

    expect(result.current.isPending).toBe(true);
    expect(mockedClient.fetchRecipe).not.toHaveBeenCalled();
  });
});

describe('useCreateRecipe', () => {
  it('creates, caches the new recipe and invalidates the list', async () => {
    const created = makeRecipe({ id: 'new', title: 'New' });
    mockedClient.createRecipe.mockResolvedValue(created);
    queryClient.setQueryData(recipeKeys.list, [makeRecipe()]);

    const { result } = await renderHook(() => useCreateRecipe(), {
      wrapper: QueryProvider,
    });
    await act(async () => {
      await result.current.mutateAsync(input);
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockedClient.createRecipe).toHaveBeenCalledWith('tok', input);
    expect(queryClient.getQueryData(recipeKeys.detail('new'))).toEqual(created);
    expect(queryClient.getQueryState(recipeKeys.list)?.isInvalidated).toBe(
      true,
    );
  });

  it('leaves the caches alone when the request fails', async () => {
    mockedClient.createRecipe.mockRejectedValue(
      new client.RecipesError('title is required', 400),
    );
    queryClient.setQueryData(recipeKeys.list, [makeRecipe()]);

    const { result } = await renderHook(() => useCreateRecipe(), {
      wrapper: QueryProvider,
    });
    await act(async () => {
      await result.current.mutateAsync(input).catch(() => {});
    });

    await waitFor(() =>
      expect(result.current.error?.message).toBe('title is required'),
    );
    expect(queryClient.getQueryState(recipeKeys.list)?.isInvalidated).toBe(
      false,
    );
  });
});

describe('useUpdateRecipe', () => {
  it('updates, replaces the detail cache and invalidates only the list', async () => {
    const original = makeRecipe();
    const updated = makeRecipe({ title: 'Renamed' });
    const other = makeRecipe({ id: 'r2' });
    mockedClient.updateRecipe.mockResolvedValue(updated);
    queryClient.setQueryData(recipeKeys.list, [original, other]);
    queryClient.setQueryData(recipeKeys.detail('r1'), original);
    queryClient.setQueryData(recipeKeys.detail('r2'), other);

    const { result } = await renderHook(() => useUpdateRecipe('r1'), {
      wrapper: QueryProvider,
    });
    await act(async () => {
      await result.current.mutateAsync({ title: 'Renamed' });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockedClient.updateRecipe).toHaveBeenCalledWith('tok', 'r1', {
      title: 'Renamed',
    });
    expect(queryClient.getQueryData(recipeKeys.detail('r1'))).toEqual(updated);
    expect(queryClient.getQueryState(recipeKeys.list)?.isInvalidated).toBe(
      true,
    );
    // exact: true — other recipes' detail queries are untouched.
    expect(
      queryClient.getQueryState(recipeKeys.detail('r2'))?.isInvalidated,
    ).toBe(false);
  });
});

describe('useDeleteRecipe', () => {
  it('removes the recipe from the list cache but keeps its detail query', async () => {
    const doomed = makeRecipe();
    const other = makeRecipe({ id: 'r2' });
    mockedClient.deleteRecipe.mockResolvedValue(undefined);
    queryClient.setQueryData(recipeKeys.list, [doomed, other]);
    queryClient.setQueryData(recipeKeys.detail('r1'), doomed);

    const { result } = await renderHook(() => useDeleteRecipe('r1'), {
      wrapper: QueryProvider,
    });
    await act(async () => {
      await result.current.mutateAsync();
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockedClient.deleteRecipe).toHaveBeenCalledWith('tok', 'r1');
    expect(queryClient.getQueryData(recipeKeys.list)).toEqual([other]);
    // Intentionally kept so the still-mounted detail screen doesn't flash a 404.
    expect(queryClient.getQueryData(recipeKeys.detail('r1'))).toEqual(doomed);
  });

  it('does not create a list cache entry when none existed', async () => {
    mockedClient.deleteRecipe.mockResolvedValue(undefined);

    const { result } = await renderHook(() => useDeleteRecipe('r1'), {
      wrapper: QueryProvider,
    });
    await act(async () => {
      await result.current.mutateAsync();
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(queryClient.getQueryData(recipeKeys.list)).toBeUndefined();
  });

  it('keeps the list cache intact when the delete fails', async () => {
    const recipes = [makeRecipe(), makeRecipe({ id: 'r2' })];
    mockedClient.deleteRecipe.mockRejectedValue(
      new client.RecipesError('Recipe not found', 404),
    );
    queryClient.setQueryData(recipeKeys.list, recipes);

    const { result } = await renderHook(() => useDeleteRecipe('r1'), {
      wrapper: QueryProvider,
    });
    await act(async () => {
      await result.current.mutateAsync().catch(() => {});
    });
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(queryClient.getQueryData(recipeKeys.list)).toEqual(recipes);
  });
});

describe('fork links in the caches', () => {
  const forkedFrom = {
    id: 'r0',
    title: 'Shakshuka',
    attemptId: 'a0',
    madeAt: '2026-09-21T12:00:00.000Z',
  };
  const isInvalidated = (key: readonly unknown[]) =>
    queryClient.getQueryState(key)?.isInvalidated;

  // Every detail the tests look at, cached and valid to begin with.
  function seedDetails(...ids: string[]) {
    for (const id of ids) {
      queryClient.setQueryData(recipeKeys.detail(id), makeRecipe({ id }));
    }
    queryClient.setQueryData(attemptKeys.detail('a0'), { id: 'a0' });
    queryClient.setQueryData(attemptKeys.detail('a9'), { id: 'a9' });
  }

  it("creating a fork invalidates the original's detail and the attempt it came from", async () => {
    const created = makeRecipe({ id: 'fork', forkedFrom });
    mockedClient.createRecipe.mockResolvedValue(created);
    seedDetails('r0', 'r2');

    const { result } = await renderHook(() => useCreateRecipe(), {
      wrapper: QueryProvider,
    });
    await act(async () => {
      await result.current.mutateAsync({ ...input, forkedFromAttemptId: 'a0' });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockedClient.createRecipe).toHaveBeenCalledWith('tok', {
      ...input,
      forkedFromAttemptId: 'a0',
    });
    expect(queryClient.getQueryData(recipeKeys.detail('fork'))).toEqual(
      created,
    );
    expect(isInvalidated(recipeKeys.detail('r0'))).toBe(true);
    expect(isInvalidated(attemptKeys.detail('a0'))).toBe(true);
    expect(isInvalidated(recipeKeys.detail('r2'))).toBe(false);
    expect(isInvalidated(attemptKeys.detail('a9'))).toBe(false);
  });

  it('creating a plain recipe invalidates no other details', async () => {
    mockedClient.createRecipe.mockResolvedValue(makeRecipe({ id: 'new' }));
    seedDetails('r0', 'r2');

    const { result } = await renderHook(() => useCreateRecipe(), {
      wrapper: QueryProvider,
    });
    await act(async () => {
      await result.current.mutateAsync(input);
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(isInvalidated(recipeKeys.detail('r0'))).toBe(false);
    expect(isInvalidated(attemptKeys.detail('a0'))).toBe(false);
  });

  it("updating a recipe invalidates its original's and its forks' details, and no others", async () => {
    const updated = makeRecipe({
      title: 'Renamed',
      forkedFrom,
      forks: [
        { id: 'r8', title: 'Newer' },
        { id: 'r7', title: 'Older' },
      ],
    });
    mockedClient.updateRecipe.mockResolvedValue(updated);
    seedDetails('r1', 'r0', 'r8', 'r7', 'r2');

    const { result } = await renderHook(() => useUpdateRecipe('r1'), {
      wrapper: QueryProvider,
    });
    await act(async () => {
      await result.current.mutateAsync({ title: 'Renamed' });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(queryClient.getQueryData(recipeKeys.detail('r1'))).toEqual(updated);
    expect(isInvalidated(recipeKeys.detail('r1'))).toBe(false);
    expect(isInvalidated(recipeKeys.detail('r0'))).toBe(true);
    expect(isInvalidated(recipeKeys.detail('r8'))).toBe(true);
    expect(isInvalidated(recipeKeys.detail('r7'))).toBe(true);
    expect(isInvalidated(recipeKeys.detail('r2'))).toBe(false);
  });

  it('deleting a recipe with links invalidates the linked details and refetches the list', async () => {
    const doomed = makeRecipe({
      forkedFrom,
      forks: [{ id: 'r8', title: 'Spicy' }],
    });
    const other = makeRecipe({ id: 'r2' });
    mockedClient.deleteRecipe.mockResolvedValue(undefined);
    seedDetails('r0', 'r8', 'r2');
    queryClient.setQueryData(recipeKeys.detail('r1'), doomed);
    queryClient.setQueryData(recipeKeys.list, [doomed, other]);

    const { result } = await renderHook(() => useDeleteRecipe('r1'), {
      wrapper: QueryProvider,
    });
    await act(async () => {
      await result.current.mutateAsync();
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(queryClient.getQueryData(recipeKeys.list)).toEqual([other]);
    // The forks' "from …" line is on the list cards, so the list refetches.
    expect(isInvalidated(recipeKeys.list)).toBe(true);
    expect(isInvalidated(recipeKeys.detail('r0'))).toBe(true);
    expect(isInvalidated(recipeKeys.detail('r8'))).toBe(true);
    expect(isInvalidated(recipeKeys.detail('r2'))).toBe(false);
  });

  it('deleting a recipe without links only drops it from the list', async () => {
    const doomed = makeRecipe();
    const other = makeRecipe({ id: 'r2' });
    mockedClient.deleteRecipe.mockResolvedValue(undefined);
    seedDetails('r2');
    queryClient.setQueryData(recipeKeys.detail('r1'), doomed);
    queryClient.setQueryData(recipeKeys.list, [doomed, other]);

    const { result } = await renderHook(() => useDeleteRecipe('r1'), {
      wrapper: QueryProvider,
    });
    await act(async () => {
      await result.current.mutateAsync();
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(queryClient.getQueryData(recipeKeys.list)).toEqual([other]);
    expect(isInvalidated(recipeKeys.list)).toBe(false);
    expect(isInvalidated(recipeKeys.detail('r2'))).toBe(false);
  });
});
