import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import {
  createMeal,
  deleteMeal,
  fetchRecentSnacks,
  fetchWeek,
  MealInput,
  MealUpdate,
  updateMeal,
} from '../api/recipesClient';
import { addDays } from '../utils/week';

export const mealKeys = {
  all: ['meals'] as const,
  recentSnacks: ['meals', 'recent-snacks'] as const,
  // Under 'meals', so saving a meal refreshes any week already loaded.
  week: (monday: Date) => ['meals', 'week', monday.toISOString()] as const,
};

export function useRecentSnacks({ enabled = true }: { enabled?: boolean }) {
  const { token } = useAuth();

  return useQuery({
    queryKey: mealKeys.recentSnacks,
    queryFn: () => fetchRecentSnacks(token!),
    enabled: enabled && token !== null,
  });
}

// A new meal changes the recent snacks and any week or list already loaded.
export function useCreateMeal() {
  const { token } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: MealInput) => createMeal(token!, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: mealKeys.all }),
  });
}

// The week starting at `monday` (local midnight): its meals and attempts.
export function useWeek(monday: Date) {
  const { token } = useAuth();

  return useQuery({
    queryKey: mealKeys.week(monday),
    queryFn: () => fetchWeek(token!, monday, addDays(monday, 7)),
    enabled: token !== null,
  });
}

// Editing or deleting a meal changes the week it's in and maybe the recent
// snacks, so every meal query is refreshed.
export function useUpdateMeal(id: string) {
  const { token } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: MealUpdate) => updateMeal(token!, id, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: mealKeys.all }),
  });
}

export function useDeleteMeal(id: string) {
  const { token } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => deleteMeal(token!, id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: mealKeys.all }),
  });
}
