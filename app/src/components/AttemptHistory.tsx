import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Attempt } from '../api/recipesClient';
import { useAttempts } from '../hooks/useAttempts';
import { strings } from '../strings';
import { colors } from '../theme';
import {
  formatDuration,
  formatPostedDate,
  formatShortDate,
} from '../utils/recipeFormat';

function stars(rating: number): string {
  return '★'.repeat(rating) + '☆'.repeat(5 - rating);
}

// The notes preview shows only the first line.
function firstLine(notes: string | null): string | null {
  const line = notes?.split('\n').find(l => l.trim().length > 0);
  return line ? line.trim() : null;
}

function AttemptRow({
  attempt,
  onOpen,
}: {
  attempt: Attempt;
  onOpen: () => void;
}) {
  const { recipeDetail } = strings;
  const meta = [
    formatShortDate(attempt.madeAt),
    attempt.rating ? stars(attempt.rating) : recipeDetail.noRating,
    attempt.fullness ? strings.fullness[attempt.fullness] : null,
    attempt.durationMinutes ? formatDuration(attempt.durationMinutes) : null,
  ].filter(item => item !== null);
  const note = firstLine(attempt.notes);
  const changed = attempt.tweaked;

  // Read as one sentence by screen readers, stars spelled out.
  const label = [
    formatPostedDate(attempt.madeAt),
    attempt.rating
      ? recipeDetail.ratingLabel(attempt.rating)
      : recipeDetail.noRating,
    attempt.fullness ? strings.fullness[attempt.fullness] : null,
    attempt.durationMinutes ? formatDuration(attempt.durationMinutes) : null,
    changed ? recipeDetail.changedBadge : null,
    note,
  ]
    .filter(item => item !== null)
    .join(', ');

  return (
    <Pressable
      testID={`recipe-detail-attempt-${attempt.id}`}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={styles.row}
      onPress={onOpen}
    >
      <View style={styles.rowBody}>
        <View style={styles.metaLine}>
          <Text style={styles.meta}>{meta.join(' · ')}</Text>
          {changed ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{recipeDetail.changedBadge}</Text>
            </View>
          ) : null}
        </View>
        {note ? (
          <Text style={styles.note} numberOfLines={1}>
            “{note}”
          </Text>
        ) : null}
      </View>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

// "HISTORY · 3 times" and one row per past attempt, newest first.
export default function AttemptHistory({
  recipeId,
  onOpenAttempt,
}: {
  recipeId: string;
  onOpenAttempt: (attemptId: string) => void;
}) {
  const { data: attempts, isPending, isError, refetch } = useAttempts(recipeId);

  return (
    <View testID="recipe-detail-history" style={styles.section}>
      <View style={styles.heading}>
        <Text style={styles.kicker}>{strings.recipeDetail.historyKicker}</Text>
        {attempts && attempts.length > 0 ? (
          <Text style={styles.count}>
            {strings.recipeDetail.timesCooked(attempts.length)}
          </Text>
        ) : null}
      </View>

      {/* A failed background refresh keeps showing the list it already has. */}
      {attempts ? null : isPending ? (
        <ActivityIndicator style={styles.status} color={colors.accent} />
      ) : isError ? (
        <View style={styles.status}>
          <Text style={styles.statusText}>
            {strings.recipeDetail.historyFailed}
          </Text>
          <Pressable
            accessibilityRole="button"
            style={styles.retryButton}
            onPress={() => refetch()}
          >
            <Text style={styles.retryText}>{strings.common.tryAgain}</Text>
          </Pressable>
        </View>
      ) : null}
      {!attempts ? null : attempts.length === 0 ? (
        <Text testID="recipe-detail-history-empty" style={styles.statusText}>
          {strings.recipeDetail.historyEmpty}
        </Text>
      ) : (
        attempts.map(attempt => (
          <AttemptRow
            key={attempt.id}
            attempt={attempt}
            onOpen={() => onOpenAttempt(attempt.id)}
          />
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginTop: 32,
  },
  heading: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
  },
  kicker: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.8,
    color: colors.accent,
  },
  count: {
    fontSize: 14,
    color: colors.ink,
  },
  row: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
  },
  rowBody: {
    flex: 1,
  },
  chevron: {
    marginLeft: 8,
    fontSize: 22,
    color: colors.ink,
  },
  metaLine: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  meta: {
    fontSize: 16,
    color: colors.ink,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.ink,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.ink,
  },
  note: {
    marginTop: 4,
    fontSize: 15,
    fontStyle: 'italic',
    color: colors.ink,
  },
  status: {
    marginTop: 16,
  },
  statusText: {
    marginTop: 16,
    fontSize: 15,
    lineHeight: 22,
    color: colors.ink,
  },
  retryButton: {
    alignSelf: 'flex-start',
    paddingVertical: 8,
  },
  retryText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.accent,
  },
});
