import { useQueryClient } from '@tanstack/react-query';
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { UnratedAttempt } from '../api/recipesClient';
import {
  dismissAttempt,
  loadDismissed,
} from '../attempts/ratePromptDismissals';
import {
  attemptKeys,
  useUnratedAttempt,
  useUpdateAttempt,
} from '../hooks/useAttempts';
import { strings } from '../strings';
import { colors, fonts } from '../theme';
import { formatDuration, formatRecentDay } from '../utils/recipeFormat';
import { StarRating, StarSize } from './StarRating';

// How long "Saved ✓" stays before the card goes away.
export const SAVED_VISIBLE_MS = 1500;

type Props = {
  onOpen: (attempt: UnratedAttempt) => void;
};

// A quiet card at the top of the recipe list asking to rate the newest
// unrated attempt of the last 48 h. One card at most, never a stack.
export function RatePromptCard({ onOpen }: Props) {
  const { data: attempt } = useUnratedAttempt();
  // null while loading from AsyncStorage, so a dismissed card never flashes.
  const [dismissed, setDismissed] = useState<string[] | null>(null);

  useEffect(() => {
    let active = true;
    loadDismissed().then(ids => {
      if (active) setDismissed(ids);
    });
    return () => {
      active = false;
    };
  }, []);

  if (!attempt || dismissed === null || dismissed.includes(attempt.id)) {
    return null;
  }

  return (
    <RatePromptCardContent
      // A fresh card (stars, "Saved ✓") for each attempt.
      key={attempt.id}
      attempt={attempt}
      onOpen={() => onOpen(attempt)}
      onDismiss={() => {
        setDismissed([attempt.id, ...dismissed]);
        dismissAttempt(attempt.id);
      }}
    />
  );
}

function RatePromptCardContent({
  attempt,
  onOpen,
  onDismiss,
}: {
  attempt: UnratedAttempt;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  const queryClient = useQueryClient();
  const update = useUpdateAttempt(attempt.recipeId, attempt.id, {
    refreshUnrated: false,
  });
  const [rating, setRating] = useState<number | null>(null);

  useEffect(() => {
    if (!update.isSuccess) return;
    const timeout = setTimeout(() => {
      queryClient.invalidateQueries({ queryKey: attemptKeys.unrated });
    }, SAVED_VISIBLE_MS);
    return () => clearTimeout(timeout);
  }, [update.isSuccess, queryClient]);

  const title = strings.ratePrompt.title(attempt.recipe.title);
  const meta = [
    formatRecentDay(attempt.madeAt),
    attempt.durationMinutes ? formatDuration(attempt.durationMinutes) : null,
  ]
    .filter(item => item !== null)
    .join(' · ');

  return (
    <View testID="rate-prompt-card" style={styles.card}>
      <View style={styles.headerRow}>
        <Pressable
          testID="rate-prompt-open-button"
          accessibilityRole="button"
          accessibilityLabel={strings.ratePrompt.open(attempt.recipe.title)}
          style={styles.openArea}
          onPress={onOpen}
        >
          <Text accessibilityRole="header" style={styles.title}>
            {title}
          </Text>
          <Text style={styles.meta}>{meta}</Text>
        </Pressable>
        <Pressable
          testID="rate-prompt-dismiss-button"
          accessibilityRole="button"
          accessibilityLabel={strings.ratePrompt.dismiss}
          style={styles.dismissButton}
          onPress={onDismiss}
        >
          <Text style={styles.dismissText}>✕</Text>
        </Pressable>
      </View>

      <View style={styles.starsRow}>
        <StarRating
          testIDPrefix="rate-prompt-star"
          size={StarSize.Medium}
          rating={rating}
          disabled={update.isPending || update.isSuccess}
          onChange={star => {
            // Tapping the chosen star again doesn't clear it here: each tap
            // saves at once, and there's nothing to clear yet.
            if (star === null) return;
            setRating(star);
            update.mutate({ rating: star });
          }}
        />
        {update.isSuccess ? (
          <Text
            testID="rate-prompt-saved-text"
            accessibilityLiveRegion="polite"
            style={styles.saved}
          >
            {strings.common.saved}
          </Text>
        ) : null}
      </View>
      {update.isError ? (
        <Text testID="rate-prompt-error-text" style={styles.error}>
          {strings.ratePrompt.saveFailed}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginBottom: 24,
    paddingLeft: 16,
    paddingRight: 4,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.card,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  openArea: {
    flex: 1,
    minHeight: 44,
    justifyContent: 'center',
  },
  title: {
    fontFamily: fonts.serif,
    fontSize: 19,
    lineHeight: 25,
    color: colors.ink,
  },
  meta: {
    marginTop: 2,
    fontSize: 15,
    color: colors.ink,
  },
  dismissButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dismissText: {
    fontSize: 18,
    color: colors.ink,
  },
  starsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 4,
    marginLeft: -10,
  },
  saved: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.ink,
  },
  error: {
    marginTop: 4,
    fontSize: 15,
    color: colors.danger,
  },
});
