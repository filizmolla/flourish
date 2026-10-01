import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react-native';
import * as client from '../api/recipesClient';
import {
  FoodGroup,
  IngredientDetail,
  IngredientFilters,
  IngredientSummary,
} from '../api/recipesClient';
import { useAuth } from '../auth/AuthContext';
import { AuthStatus } from '../auth/authStatus';
import {
  ingredientKeys,
  useIngredient,
  useIngredients,
} from './useIngredients';

jest.mock('../api/recipesClient', () => ({
  ...jest.requireActual('../api/recipesClient'),
  fetchIngredients: jest.fn(),
  fetchIngredient: jest.fn(),
}));
jest.mock('../auth/AuthContext', () => ({ useAuth: jest.fn() }));

const mockedClient = jest.mocked(client);
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
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  signedInAs('tok');
});

afterEach(() => {
  queryClient.clear();
});

describe('useIngredients', () => {
  it('fetches with the token and filters and caches under the filters key', async () => {
    const list = [makeIngredient()];
    mockedClient.fetchIngredients.mockResolvedValue(list);
    const filters = { q: 'avo', group: FoodGroup.HealthyFat };

    const { result } = await renderHook(() => useIngredients(filters), {
      wrapper: QueryProvider,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(list);
    expect(mockedClient.fetchIngredients).toHaveBeenCalledWith('tok', filters);
    expect(
      queryClient.getQueryData(['ingredients', { q: 'avo', group: 'HEALTHY_FAT' }]),
    ).toEqual(list);
  });

  it('builds the key as ["ingredients", filters]', () => {
    expect(ingredientKeys.list({ q: 'x' })).toEqual(['ingredients', { q: 'x' }]);
  });

  it('does not fetch without a token', async () => {
    signedInAs(null);

    const { result } = await renderHook(() => useIngredients({}), {
      wrapper: QueryProvider,
    });

    expect(result.current.isPending).toBe(true);
    expect(result.current.fetchStatus).toBe('idle');
    expect(mockedClient.fetchIngredients).not.toHaveBeenCalled();
  });

  it('keeps the previous list while the next filter loads', async () => {
    const all = [makeIngredient()];
    const proteins = [
      makeIngredient({
        id: 'i2',
        name: 'Lentils',
        mainGroup: FoodGroup.Protein,
        nutrients: [FoodGroup.Protein, FoodGroup.Fiber],
      }),
    ];
    let resolveProteins: (value: IngredientSummary[]) => void = () => {};
    mockedClient.fetchIngredients
      .mockResolvedValueOnce(all)
      .mockReturnValueOnce(
        new Promise(resolve => {
          resolveProteins = resolve;
        }),
      );

    const { result, rerender } = await renderHook(
      (filters: IngredientFilters) => useIngredients(filters),
      { wrapper: QueryProvider, initialProps: {} },
    );
    await waitFor(() => expect(result.current.data).toEqual(all));

    await rerender({ group: FoodGroup.Protein });

    expect(result.current.data).toEqual(all);
    expect(result.current.isPlaceholderData).toBe(true);
    expect(result.current.isPending).toBe(false);

    resolveProteins(proteins);
    await waitFor(() => expect(result.current.data).toEqual(proteins));
    expect(result.current.isPlaceholderData).toBe(false);
  });

  it('serves the same filters from cache instead of refetching (catalog stays fresh)', async () => {
    mockedClient.fetchIngredients.mockResolvedValue([makeIngredient()]);

    const first = await renderHook(() => useIngredients({ q: 'avo' }), {
      wrapper: QueryProvider,
    });
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    await first.unmount();

    const second = await renderHook(() => useIngredients({ q: 'avo' }), {
      wrapper: QueryProvider,
    });

    expect(second.result.current.isSuccess).toBe(true);
    expect(second.result.current.isFetching).toBe(false);
    expect(mockedClient.fetchIngredients).toHaveBeenCalledTimes(1);
  });
});

describe('useIngredient', () => {
  const detail: IngredientDetail = {
    ...makeIngredient(),
    description: null,
    fdcId: 171705,
    recipes: [],
  };

  it('fetches the entry with the token and caches it under the detail key', async () => {
    mockedClient.fetchIngredient.mockResolvedValue(detail);

    const { result } = await renderHook(() => useIngredient('i1'), {
      wrapper: QueryProvider,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(detail);
    expect(mockedClient.fetchIngredient).toHaveBeenCalledWith('tok', 'i1');
    expect(queryClient.getQueryData(['ingredients', 'detail', 'i1'])).toEqual(
      detail,
    );
  });

  it('builds the key as ["ingredients", "detail", id]', () => {
    expect(ingredientKeys.detail('i1')).toEqual(['ingredients', 'detail', 'i1']);
  });

  it('does not fetch without a token', async () => {
    signedInAs(null);

    const { result } = await renderHook(() => useIngredient('i1'), {
      wrapper: QueryProvider,
    });

    expect(result.current.isPending).toBe(true);
    expect(result.current.fetchStatus).toBe('idle');
    expect(mockedClient.fetchIngredient).not.toHaveBeenCalled();
  });
});
