import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import {
  fetchIngredient,
  fetchIngredients,
  IngredientFilters,
} from '../api/recipesClient';

export const ingredientKeys = {
  list: (filters: IngredientFilters) => ['ingredients', filters] as const,
  detail: (id: string) => ['ingredients', 'detail', id] as const,
};

// The catalog only changes when the server is reseeded, so a result stays
// fresh for an hour.
const CATALOG_STALE_MS = 60 * 60 * 1000;

export function useIngredients(filters: IngredientFilters) {
  const { token } = useAuth();

  return useQuery({
    queryKey: ingredientKeys.list(filters),
    queryFn: () => fetchIngredients(token!, filters),
    enabled: token !== null,
    staleTime: CATALOG_STALE_MS,
    // Typing or switching a filter keeps the last list on screen until the
    // new one arrives, instead of flashing a spinner.
    placeholderData: keepPreviousData,
  });
}

// One entry with "In your recipes". Not cached for long: that list changes
// whenever a recipe is saved.
export function useIngredient(id: string) {
  const { token } = useAuth();

  return useQuery({
    queryKey: ingredientKeys.detail(id),
    queryFn: () => fetchIngredient(token!, id),
    enabled: token !== null,
  });
}
