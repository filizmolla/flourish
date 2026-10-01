import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import * as client from '../api/recipesClient';
import {
  FoodGroup,
  Fullness,
  Meal,
  MealInput,
  MealKind,
} from '../api/recipesClient';
import { useAuth } from '../auth/AuthContext';
import { AuthStatus } from '../auth/authStatus';
import {
  mealKeys,
  useCreateMeal,
  useDeleteMeal,
  useRecentSnacks,
  useUpdateMeal,
} from './useMeals';

jest.mock('../api/recipesClient', () => ({
  ...jest.requireActual('../api/recipesClient'),
  createMeal: jest.fn(),
  fetchRecentSnacks: jest.fn(),
  updateMeal: jest.fn(),
  deleteMeal: jest.fn(),
}));
jest.mock('../auth/AuthContext', () => ({ useAuth: jest.fn() }));

const mockedClient = jest.mocked(client);
const mockedUseAuth = jest.mocked(useAuth);

function makeMeal(overrides: Partial<Meal> = {}): Meal {
  return {
    id: 'm1',
    kind: MealKind.Snack,
    eatenAt: '2026-09-29T12:00:00.000Z',
    text: 'an apple',
    nutrients: [FoodGroup.Fiber],
    fullness: null,
    hasPhoto: false,
    createdAt: '2026-09-29T12:00:00.000Z',
    updatedAt: '2026-09-29T12:00:00.000Z',
    ...overrides,
  };
}

const input: MealInput = { kind: MealKind.Snack, text: 'an apple' };

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

describe('mealKeys', () => {
  it('nests recent snacks under ["meals"] so one invalidation covers both', () => {
    expect(mealKeys.all).toEqual(['meals']);
    expect(mealKeys.recentSnacks).toEqual(['meals', 'recent-snacks']);
  });
});

describe('useRecentSnacks', () => {
  it('fetches with the token and caches under the recent-snacks key', async () => {
    mockedClient.fetchRecentSnacks.mockResolvedValue(['an apple', 'nuts']);

    const { result } = await renderHook(
      () => useRecentSnacks({ enabled: true }),
      { wrapper: QueryProvider },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(['an apple', 'nuts']);
    expect(mockedClient.fetchRecentSnacks).toHaveBeenCalledWith('tok');
    expect(queryClient.getQueryData(mealKeys.recentSnacks)).toEqual([
      'an apple',
      'nuts',
    ]);
  });

  it('is enabled by default', async () => {
    mockedClient.fetchRecentSnacks.mockResolvedValue([]);

    const { result } = await renderHook(() => useRecentSnacks({}), {
      wrapper: QueryProvider,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedClient.fetchRecentSnacks).toHaveBeenCalledTimes(1);
  });

  it('does not fetch when disabled', async () => {
    const { result } = await renderHook(
      () => useRecentSnacks({ enabled: false }),
      { wrapper: QueryProvider },
    );

    expect(result.current.fetchStatus).toBe('idle');
    expect(mockedClient.fetchRecentSnacks).not.toHaveBeenCalled();
  });

  it('does not fetch without a token, even when enabled', async () => {
    signedInAs(null);

    const { result } = await renderHook(
      () => useRecentSnacks({ enabled: true }),
      { wrapper: QueryProvider },
    );

    expect(result.current.fetchStatus).toBe('idle');
    expect(mockedClient.fetchRecentSnacks).not.toHaveBeenCalled();
  });

  it('starts fetching once enabled flips to true', async () => {
    mockedClient.fetchRecentSnacks.mockResolvedValue(['nuts']);

    const { result, rerender } = await renderHook(
      ({ enabled }: { enabled: boolean }) => useRecentSnacks({ enabled }),
      { wrapper: QueryProvider, initialProps: { enabled: false } },
    );
    expect(mockedClient.fetchRecentSnacks).not.toHaveBeenCalled();

    await rerender({ enabled: true });

    await waitFor(() => expect(result.current.data).toEqual(['nuts']));
  });
});

describe('useCreateMeal', () => {
  it('creates the meal with the token and invalidates every meals query', async () => {
    const created = makeMeal();
    mockedClient.createMeal.mockResolvedValue(created);
    queryClient.setQueryData(mealKeys.recentSnacks, []);
    queryClient.setQueryData(['meals', 'week', '2026-09-28'], []);
    queryClient.setQueryData(['recipes'], []);

    const { result } = await renderHook(() => useCreateMeal(), {
      wrapper: QueryProvider,
    });
    await act(async () => {
      await result.current.mutateAsync(input);
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockedClient.createMeal).toHaveBeenCalledWith('tok', input);
    expect(result.current.data).toEqual(created);
    expect(
      queryClient.getQueryState(mealKeys.recentSnacks)?.isInvalidated,
    ).toBe(true);
    expect(
      queryClient.getQueryState(['meals', 'week', '2026-09-28'])?.isInvalidated,
    ).toBe(true);
    expect(queryClient.getQueryState(['recipes'])?.isInvalidated).toBe(false);
  });

  it('exposes the error and leaves the meals cache alone when the request fails', async () => {
    mockedClient.createMeal.mockRejectedValue(
      new client.RecipesError('A meal needs a photo or text', 400),
    );
    queryClient.setQueryData(mealKeys.recentSnacks, []);

    const { result } = await renderHook(() => useCreateMeal(), {
      wrapper: QueryProvider,
    });
    await act(async () => {
      await result.current.mutateAsync(input).catch(() => {});
    });

    await waitFor(() =>
      expect(result.current.error?.message).toBe(
        'A meal needs a photo or text',
      ),
    );
    expect(
      queryClient.getQueryState(mealKeys.recentSnacks)?.isInvalidated,
    ).toBe(false);
  });
});

describe('useUpdateMeal', () => {
  it('patches that meal with the token and invalidates every meals query', async () => {
    const updated = makeMeal({ fullness: Fullness.VeryFull });
    mockedClient.updateMeal.mockResolvedValue(updated);
    queryClient.setQueryData(mealKeys.recentSnacks, []);
    queryClient.setQueryData(['meals', 'week', '2026-09-28'], []);
    queryClient.setQueryData(['recipes'], []);

    const { result } = await renderHook(() => useUpdateMeal('m1'), {
      wrapper: QueryProvider,
    });
    await act(async () => {
      await result.current.mutateAsync({ fullness: Fullness.VeryFull });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockedClient.updateMeal).toHaveBeenCalledTimes(1);
    expect(mockedClient.updateMeal).toHaveBeenCalledWith('tok', 'm1', {
      fullness: Fullness.VeryFull,
    });
    expect(result.current.data).toEqual(updated);
    expect(
      queryClient.getQueryState(mealKeys.recentSnacks)?.isInvalidated,
    ).toBe(true);
    expect(
      queryClient.getQueryState(['meals', 'week', '2026-09-28'])?.isInvalidated,
    ).toBe(true);
    expect(queryClient.getQueryState(['recipes'])?.isInvalidated).toBe(false);
  });

  it('passes an explicit null through to clear a field', async () => {
    mockedClient.updateMeal.mockResolvedValue(makeMeal());

    const { result } = await renderHook(() => useUpdateMeal('m2'), {
      wrapper: QueryProvider,
    });
    await act(async () => {
      await result.current.mutateAsync({ fullness: null });
    });

    expect(mockedClient.updateMeal).toHaveBeenCalledWith('tok', 'm2', {
      fullness: null,
    });
  });

  it('exposes the error and leaves the meals cache alone when the request fails', async () => {
    mockedClient.updateMeal.mockRejectedValue(
      new client.RecipesError('Meal not found', 404),
    );
    queryClient.setQueryData(['meals', 'week', '2026-09-28'], []);

    const { result } = await renderHook(() => useUpdateMeal('m1'), {
      wrapper: QueryProvider,
    });
    await act(async () => {
      await result.current
        .mutateAsync({ fullness: Fullness.Satisfied })
        .catch(() => {});
    });

    await waitFor(() =>
      expect(result.current.error?.message).toBe('Meal not found'),
    );
    expect(mockedClient.updateMeal).toHaveBeenCalledTimes(1);
    expect(
      queryClient.getQueryState(['meals', 'week', '2026-09-28'])?.isInvalidated,
    ).toBe(false);
  });
});

describe('useDeleteMeal', () => {
  it('deletes that meal with the token and invalidates every meals query', async () => {
    mockedClient.deleteMeal.mockResolvedValue(undefined);
    queryClient.setQueryData(mealKeys.recentSnacks, []);
    queryClient.setQueryData(['meals', 'week', '2026-09-28'], []);
    queryClient.setQueryData(['recipes'], []);

    const { result } = await renderHook(() => useDeleteMeal('m1'), {
      wrapper: QueryProvider,
    });
    await act(async () => {
      await result.current.mutateAsync();
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockedClient.deleteMeal).toHaveBeenCalledTimes(1);
    expect(mockedClient.deleteMeal).toHaveBeenCalledWith('tok', 'm1');
    expect(
      queryClient.getQueryState(mealKeys.recentSnacks)?.isInvalidated,
    ).toBe(true);
    expect(
      queryClient.getQueryState(['meals', 'week', '2026-09-28'])?.isInvalidated,
    ).toBe(true);
    expect(queryClient.getQueryState(['recipes'])?.isInvalidated).toBe(false);
  });

  it('exposes the error and leaves the meals cache alone when the request fails', async () => {
    mockedClient.deleteMeal.mockRejectedValue(
      new client.RecipesError('Meal not found', 404),
    );
    queryClient.setQueryData(['meals', 'week', '2026-09-28'], []);

    const { result } = await renderHook(() => useDeleteMeal('m1'), {
      wrapper: QueryProvider,
    });
    await act(async () => {
      await result.current.mutateAsync().catch(() => {});
    });

    await waitFor(() =>
      expect(result.current.error?.message).toBe('Meal not found'),
    );
    expect(
      queryClient.getQueryState(['meals', 'week', '2026-09-28'])?.isInvalidated,
    ).toBe(false);
  });
});
