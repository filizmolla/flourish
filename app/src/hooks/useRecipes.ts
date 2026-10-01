import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import { attemptKeys } from './useAttempts';
import {
  createRecipe,
  CreateRecipeInput,
  deleteRecipe,
  fetchRecipe,
  fetchRecipes,
  Recipe,
  RecipeInput,
  updateRecipe,
} from '../api/recipesClient';

export const recipeKeys = {
  list: ['recipes'] as const,
  detail: (id: string) => ['recipes', id] as const,
};

// The recipes that show this one's title: its original and its forks.
function linkedRecipeIds(recipe: Recipe): string[] {
  return [
    ...(recipe.forkedFrom ? [recipe.forkedFrom.id] : []),
    ...recipe.forks.map(fork => fork.id),
  ];
}

export function useRecipes() {
  const { token } = useAuth();

  return useQuery({
    queryKey: recipeKeys.list,
    queryFn: () => fetchRecipes(token!),
    enabled: token !== null,
  });
}

export function useRecipe(id: string) {
  const { token } = useAuth();
  const queryClient = useQueryClient();

  return useQuery({
    queryKey: recipeKeys.detail(id),
    queryFn: () => fetchRecipe(token!, id),
    enabled: token !== null,
    // Opening a recipe from the list shows the cached copy immediately while
    // the fresh one loads in the background.
    initialData: () =>
      queryClient
        .getQueryData<Recipe[]>(recipeKeys.list)
        ?.find(recipe => recipe.id === id),
    initialDataUpdatedAt: () =>
      queryClient.getQueryState(recipeKeys.list)?.dataUpdatedAt,
  });
}

export function useCreateRecipe() {
  const { token } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateRecipeInput) => createRecipe(token!, input),
    onSuccess: recipe => {
      queryClient.setQueryData(recipeKeys.detail(recipe.id), recipe);
      queryClient.invalidateQueries({ queryKey: recipeKeys.list, exact: true });
      // A fork shows up under the original's VERSIONS and as "Saved as …"
      // on the attempt it came from.
      if (recipe.forkedFrom) {
        queryClient.invalidateQueries({
          queryKey: recipeKeys.detail(recipe.forkedFrom.id),
          exact: true,
        });
        queryClient.invalidateQueries({
          queryKey: attemptKeys.detail(recipe.forkedFrom.attemptId),
        });
      }
    },
  });
}

export function useUpdateRecipe(id: string) {
  const { token } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: Partial<RecipeInput>) =>
      updateRecipe(token!, id, input),
    onSuccess: recipe => {
      queryClient.setQueryData(recipeKeys.detail(id), recipe);
      queryClient.invalidateQueries({ queryKey: recipeKeys.list, exact: true });
      // Titles show up on linked recipes too ("Based on …", VERSIONS).
      for (const linkedId of linkedRecipeIds(recipe)) {
        queryClient.invalidateQueries({
          queryKey: recipeKeys.detail(linkedId),
          exact: true,
        });
      }
    },
  });
}

export function useDeleteRecipe(id: string) {
  const { token } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => deleteRecipe(token!, id),
    // The detail query is left alone: the detail screen is still mounted while
    // it navigates away, and removing its data would make it refetch and flash
    // a 404. React Query garbage-collects it once nothing observes it.
    onSuccess: () => {
      const deleted = queryClient.getQueryData<Recipe>(recipeKeys.detail(id));
      queryClient.setQueryData<Recipe[]>(recipeKeys.list, recipes =>
        recipes?.filter(recipe => recipe.id !== id),
      );
      // Its forks lose their "Based on" link; the original loses a version.
      if (deleted && linkedRecipeIds(deleted).length > 0) {
        queryClient.invalidateQueries({ queryKey: recipeKeys.list, exact: true });
        for (const linkedId of linkedRecipeIds(deleted)) {
          queryClient.invalidateQueries({
            queryKey: recipeKeys.detail(linkedId),
            exact: true,
          });
        }
      }
    },
  });
}
