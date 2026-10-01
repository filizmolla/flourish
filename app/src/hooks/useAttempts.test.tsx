import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import * as client from '../api/recipesClient';
import {
  Attempt,
  AttemptDetail,
  AttemptInput,
  UnratedAttempt,
} from '../api/recipesClient';
import { useAuth } from '../auth/AuthContext';
import { AuthStatus } from '../auth/authStatus';
import {
  attemptKeys,
  useAttempt,
  useAttempts,
  useCreateAttempt,
  useUnratedAttempt,
  useUpdateAttempt,
} from './useAttempts';

jest.mock('../api/recipesClient', () => ({
  ...jest.requireActual('../api/recipesClient'),
  createAttempt: jest.fn(),
  fetchAttempt: jest.fn(),
  fetchAttempts: jest.fn(),
  fetchUnratedAttempt: jest.fn(),
  updateAttempt: jest.fn(),
}));
jest.mock('../auth/AuthContext', () => ({ useAuth: jest.fn() }));

const mockedClient = jest.mocked(client);
const mockedUseAuth = jest.mocked(useAuth);

const input: AttemptInput = {
  durationMinutes: 42,
  rating: 4,
  fullness: null,
  enjoyment: null,
  notes: 'Needs more salt',
  ingredients: null,
  instructions: null,
  basedOnAttemptId: null,
};

function makeAttempt(overrides: Partial<Attempt> = {}): Attempt {
  return {
    id: 'a1',
    recipeId: 'r1',
    madeAt: '2026-09-24T12:00:00.000Z',
    createdAt: '2026-09-24T12:00:00.000Z',
    updatedAt: '2026-09-24T12:00:00.000Z',
    ...input,
    tweaked: false,
    hasPhoto: false,
    ...overrides,
  };
}

let queryClient: QueryClient;

function QueryProvider({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
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

afterEach(() => {
  queryClient.clear();
});

describe('attemptKeys', () => {
  it('nests the attempt list under its recipe', () => {
    expect(attemptKeys.list('r1')).toEqual(['recipes', 'r1', 'attempts']);
  });

  it('keys a single attempt by its own id, outside any recipe', () => {
    expect(attemptKeys.detail('a1')).toEqual(['attempts', 'a1']);
  });

  it('keys the unrated attempt apart from the list and detail keys', () => {
    expect(attemptKeys.unrated).toEqual(['attempts', 'unrated']);
  });
});

function makeUnrated(overrides: Partial<UnratedAttempt> = {}): UnratedAttempt {
  return {
    ...makeAttempt({ rating: null }),
    recipe: { id: 'r1', title: 'Shakshuka' },
    ...overrides,
  };
}

function makeAttemptDetail(
  overrides: Partial<AttemptDetail> = {},
): AttemptDetail {
  return { ...makeAttempt(), basedOnAttempt: null, fork: null, ...overrides };
}

describe('useUnratedAttempt', () => {
  it('fetches with the token and caches under attemptKeys.unrated', async () => {
    const unrated = makeUnrated();
    mockedClient.fetchUnratedAttempt.mockResolvedValue(unrated);

    const { result } = await renderHook(() => useUnratedAttempt(), {
      wrapper: QueryProvider,
    });

    await waitFor(() => expect(result.current.data).toEqual(unrated));
    expect(mockedClient.fetchUnratedAttempt).toHaveBeenCalledTimes(1);
    expect(mockedClient.fetchUnratedAttempt).toHaveBeenCalledWith('tok');
    expect(queryClient.getQueryData(attemptKeys.unrated)).toEqual(unrated);
  });

  it('resolves to null when there is no unrated attempt', async () => {
    mockedClient.fetchUnratedAttempt.mockResolvedValue(null);

    const { result } = await renderHook(() => useUnratedAttempt(), {
      wrapper: QueryProvider,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it('does not fetch while signed out', async () => {
    signedInAs(null);

    const { result } = await renderHook(() => useUnratedAttempt(), {
      wrapper: QueryProvider,
    });

    expect(result.current.fetchStatus).toBe('idle');
    expect(mockedClient.fetchUnratedAttempt).not.toHaveBeenCalled();
  });
});

describe('useUpdateAttempt', () => {
  function seedCaches() {
    queryClient.setQueryData(attemptKeys.detail('a1'), makeAttemptDetail());
    queryClient.setQueryData(attemptKeys.list('r1'), [makeAttempt()]);
    queryClient.setQueryData(attemptKeys.list('r2'), []);
    queryClient.setQueryData(attemptKeys.unrated, makeUnrated());
  }

  const isInvalidated = (key: readonly unknown[]) =>
    queryClient.getQueryState(key)?.isInvalidated;

  it('patches with the token, puts the response in the detail cache and invalidates the list and unrated', async () => {
    const updated = makeAttemptDetail({ rating: 5 });
    mockedClient.updateAttempt.mockResolvedValue(updated);
    seedCaches();

    const { result } = await renderHook(() => useUpdateAttempt('r1', 'a1'), {
      wrapper: QueryProvider,
    });
    await act(async () => {
      await result.current.mutateAsync({ rating: 5 });
    });

    expect(mockedClient.updateAttempt).toHaveBeenCalledWith('tok', 'a1', {
      rating: 5,
    });
    expect(queryClient.getQueryData(attemptKeys.detail('a1'))).toEqual(updated);
    // Set from the response, not refetched.
    expect(isInvalidated(attemptKeys.detail('a1'))).toBe(false);
    expect(isInvalidated(attemptKeys.list('r1'))).toBe(true);
    expect(isInvalidated(attemptKeys.list('r2'))).toBe(false);
    expect(isInvalidated(attemptKeys.unrated)).toBe(true);
  });

  it('leaves the unrated attempt alone with refreshUnrated: false', async () => {
    mockedClient.updateAttempt.mockResolvedValue(
      makeAttemptDetail({ rating: 3 }),
    );
    seedCaches();

    const { result } = await renderHook(
      () => useUpdateAttempt('r1', 'a1', { refreshUnrated: false }),
      { wrapper: QueryProvider },
    );
    await act(async () => {
      await result.current.mutateAsync({ rating: 3 });
    });

    expect(isInvalidated(attemptKeys.list('r1'))).toBe(true);
    expect(isInvalidated(attemptKeys.unrated)).toBe(false);
  });

  it('exposes the error and leaves every cache alone when the request fails', async () => {
    mockedClient.updateAttempt.mockRejectedValue(
      new client.RecipesError('Attempt not found', 404),
    );
    seedCaches();
    const before = queryClient.getQueryData(attemptKeys.detail('a1'));

    const { result } = await renderHook(() => useUpdateAttempt('r1', 'a1'), {
      wrapper: QueryProvider,
    });
    await act(async () => {
      await result.current.mutateAsync({ rating: 2 }).catch(() => {});
    });

    await waitFor(() =>
      expect(result.current.error?.message).toBe('Attempt not found'),
    );
    expect(queryClient.getQueryData(attemptKeys.detail('a1'))).toBe(before);
    expect(isInvalidated(attemptKeys.list('r1'))).toBe(false);
    expect(isInvalidated(attemptKeys.unrated)).toBe(false);
  });
});

describe('useAttempt', () => {
  function makeDetail(overrides: Partial<AttemptDetail> = {}): AttemptDetail {
    return { ...makeAttempt(), basedOnAttempt: null, fork: null, ...overrides };
  }

  it('fetches the attempt with the token and caches it under attemptKeys.detail', async () => {
    const detail = makeDetail({
      id: 'a2',
      basedOnAttemptId: 'a1',
      basedOnAttempt: { id: 'a1', madeAt: '2026-08-15T12:00:00.000Z' },
    });
    mockedClient.fetchAttempt.mockResolvedValue(detail);

    const { result } = await renderHook(() => useAttempt('a2'), {
      wrapper: QueryProvider,
    });

    await waitFor(() => expect(result.current.data).toEqual(detail));
    expect(mockedClient.fetchAttempt).toHaveBeenCalledTimes(1);
    expect(mockedClient.fetchAttempt).toHaveBeenCalledWith('tok', 'a2');
    expect(queryClient.getQueryData(attemptKeys.detail('a2'))).toEqual(detail);
    expect(queryClient.getQueryData(attemptKeys.detail('a1'))).toBeUndefined();
  });

  it('serves an attempt already in the cache under attemptKeys.detail', async () => {
    const cached = makeDetail({ id: 'cached' });
    queryClient.setQueryData(attemptKeys.detail('a1'), cached);
    mockedClient.fetchAttempt.mockReturnValue(new Promise(() => {}));

    const { result } = await renderHook(() => useAttempt('a1'), {
      wrapper: QueryProvider,
    });

    expect(result.current.isPending).toBe(false);
    expect(result.current.data).toEqual(cached);
  });

  it('does not fetch while signed out', async () => {
    signedInAs(null);

    const { result } = await renderHook(() => useAttempt('a1'), {
      wrapper: QueryProvider,
    });

    expect(result.current.isPending).toBe(true);
    expect(result.current.fetchStatus).toBe('idle');
    expect(mockedClient.fetchAttempt).not.toHaveBeenCalled();
  });

  it('stays idle and does not fetch when the id is undefined', async () => {
    const { result } = await renderHook(() => useAttempt(undefined), {
      wrapper: QueryProvider,
    });

    expect(result.current.isPending).toBe(true);
    expect(result.current.fetchStatus).toBe('idle');
    expect(result.current.data).toBeUndefined();
    expect(mockedClient.fetchAttempt).not.toHaveBeenCalled();
  });

  it('exposes the error when the request fails', async () => {
    mockedClient.fetchAttempt.mockRejectedValue(
      new client.RecipesError('Attempt not found', 404),
    );

    const { result } = await renderHook(() => useAttempt('gone'), {
      wrapper: QueryProvider,
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(client.RecipesError);
    expect(result.current.error?.message).toBe('Attempt not found');
  });
});

describe('useAttempts', () => {
  it("fetches the recipe's attempts with the token and caches them under attemptKeys.list", async () => {
    const attempts = [
      makeAttempt({ id: 'a2' }),
      makeAttempt({ id: 'a1', madeAt: '2026-09-21T12:00:00.000Z' }),
    ];
    mockedClient.fetchAttempts.mockResolvedValue(attempts);

    const { result } = await renderHook(() => useAttempts('r1'), {
      wrapper: QueryProvider,
    });

    await waitFor(() => expect(result.current.data).toEqual(attempts));
    expect(mockedClient.fetchAttempts).toHaveBeenCalledTimes(1);
    expect(mockedClient.fetchAttempts).toHaveBeenCalledWith('tok', 'r1');
    expect(queryClient.getQueryData(attemptKeys.list('r1'))).toEqual(attempts);
    expect(queryClient.getQueryData(attemptKeys.list('r2'))).toBeUndefined();
  });

  it('serves attempts already in the cache under attemptKeys.list', async () => {
    const cached = [makeAttempt({ id: 'cached' })];
    queryClient.setQueryData(attemptKeys.list('r1'), cached);
    mockedClient.fetchAttempts.mockReturnValue(new Promise(() => {}));

    const { result } = await renderHook(() => useAttempts('r1'), {
      wrapper: QueryProvider,
    });

    expect(result.current.isPending).toBe(false);
    expect(result.current.data).toEqual(cached);
  });

  it('does not fetch while signed out', async () => {
    signedInAs(null);

    const { result } = await renderHook(() => useAttempts('r1'), {
      wrapper: QueryProvider,
    });

    expect(result.current.isPending).toBe(true);
    expect(result.current.fetchStatus).toBe('idle');
    expect(mockedClient.fetchAttempts).not.toHaveBeenCalled();
  });

  it('exposes the error when the request fails', async () => {
    mockedClient.fetchAttempts.mockRejectedValue(
      new client.RecipesError('Recipe not found', 404),
    );

    const { result } = await renderHook(() => useAttempts('gone'), {
      wrapper: QueryProvider,
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('Recipe not found');
  });
});

describe('useCreateAttempt', () => {
  it("creates the attempt with the token and invalidates only that recipe's attempts", async () => {
    const created = makeAttempt();
    mockedClient.createAttempt.mockResolvedValue(created);
    queryClient.setQueryData(attemptKeys.list('r1'), []);
    queryClient.setQueryData(attemptKeys.list('r2'), []);

    const { result } = await renderHook(() => useCreateAttempt('r1'), {
      wrapper: QueryProvider,
    });
    await act(async () => {
      await result.current.mutateAsync(input);
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockedClient.createAttempt).toHaveBeenCalledWith('tok', 'r1', input);
    expect(result.current.data).toEqual(created);
    expect(
      queryClient.getQueryState(attemptKeys.list('r1'))?.isInvalidated,
    ).toBe(true);
    expect(
      queryClient.getQueryState(attemptKeys.list('r2'))?.isInvalidated,
    ).toBe(false);
  });

  it('also invalidates the unrated attempt, since a new unrated one may replace it', async () => {
    mockedClient.createAttempt.mockResolvedValue(makeAttempt({ rating: null }));
    queryClient.setQueryData(attemptKeys.unrated, null);

    const { result } = await renderHook(() => useCreateAttempt('r1'), {
      wrapper: QueryProvider,
    });
    await act(async () => {
      await result.current.mutateAsync({ ...input, rating: null });
    });

    expect(queryClient.getQueryState(attemptKeys.unrated)?.isInvalidated).toBe(
      true,
    );
  });

  it('exposes the error and leaves the attempts cache alone when the request fails', async () => {
    mockedClient.createAttempt.mockRejectedValue(
      new client.RecipesError('Recipe not found', 404),
    );
    queryClient.setQueryData(attemptKeys.list('r1'), []);

    const { result } = await renderHook(() => useCreateAttempt('r1'), {
      wrapper: QueryProvider,
    });
    await act(async () => {
      await result.current.mutateAsync(input).catch(() => {});
    });

    await waitFor(() =>
      expect(result.current.error?.message).toBe('Recipe not found'),
    );
    expect(
      queryClient.getQueryState(attemptKeys.list('r1'))?.isInvalidated,
    ).toBe(false);
  });
});
