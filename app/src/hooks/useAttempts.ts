import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import {
  AttemptInput,
  AttemptUpdate,
  createAttempt,
  fetchAttempt,
  fetchAttempts,
  fetchUnratedAttempt,
  updateAttempt,
} from '../api/recipesClient';

export const attemptKeys = {
  list: (recipeId: string) => ['recipes', recipeId, 'attempts'] as const,
  detail: (id: string) => ['attempts', id] as const,
  unrated: ['attempts', 'unrated'] as const,
};

// A recipe's past attempts, newest first.
export function useAttempts(recipeId: string) {
  const { token } = useAuth();

  return useQuery({
    queryKey: attemptKeys.list(recipeId),
    queryFn: () => fetchAttempts(token!, recipeId),
    enabled: token !== null,
  });
}

// Pass undefined to skip loading (e.g. cooking without a past version).
export function useAttempt(id: string | undefined) {
  const { token } = useAuth();

  return useQuery({
    queryKey: attemptKeys.detail(id ?? ''),
    queryFn: () => fetchAttempt(token!, id!),
    enabled: token !== null && id !== undefined,
  });
}

// The newest unrated attempt of the last 48 h, or null.
export function useUnratedAttempt() {
  const { token } = useAuth();

  return useQuery({
    queryKey: attemptKeys.unrated,
    queryFn: () => fetchUnratedAttempt(token!),
    enabled: token !== null,
  });
}

export function useCreateAttempt(recipeId: string) {
  const { token } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: AttemptInput) => createAttempt(token!, recipeId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: attemptKeys.list(recipeId) });
      // A new attempt without stars may be the rate card's next one.
      queryClient.invalidateQueries({ queryKey: attemptKeys.unrated });
    },
  });
}

// Rate later / edit notes. The rate card passes `refreshUnrated: false` and
// refreshes the card itself, so "Saved ✓" shows before the card goes away.
export function useUpdateAttempt(
  recipeId: string,
  attemptId: string,
  { refreshUnrated = true }: { refreshUnrated?: boolean } = {},
) {
  const { token } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: AttemptUpdate) =>
      updateAttempt(token!, attemptId, input),
    onSuccess: attempt => {
      queryClient.setQueryData(attemptKeys.detail(attemptId), attempt);
      queryClient.invalidateQueries({ queryKey: attemptKeys.list(recipeId) });
      if (refreshUnrated) {
        queryClient.invalidateQueries({ queryKey: attemptKeys.unrated });
      }
    },
  });
}
