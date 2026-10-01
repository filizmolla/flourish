import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { strings } from '../strings';
import { colors } from '../theme';

export enum StarSize {
  Large = 'large',
  Medium = 'medium',
}

type Props = {
  testIDPrefix: string; // "finish-rating-star" → finish-rating-star-1 … -5
  rating: number | null;
  // Tapping the current rating again passes null (clears it).
  onChange: (rating: number | null) => void;
  disabled?: boolean;
  size?: StarSize;
};

const STARS = [1, 2, 3, 4, 5];

// Five tappable stars, each at least 44pt.
export function StarRating({
  testIDPrefix,
  rating,
  onChange,
  disabled = false,
  size = StarSize.Large,
}: Props) {
  return (
    <View style={styles.row} accessibilityRole="radiogroup">
      {STARS.map(star => {
        const filled = rating !== null && star <= rating;
        return (
          <Pressable
            key={star}
            testID={`${testIDPrefix}-${star}`}
            accessibilityRole="radio"
            accessibilityState={{ checked: rating === star, disabled }}
            accessibilityLabel={strings.finish.rateLabel(star)}
            disabled={disabled}
            style={
              size === StarSize.Large ? styles.starLarge : styles.starMedium
            }
            onPress={() => onChange(rating === star ? null : star)}
          >
            <Text
              style={[
                size === StarSize.Large ? styles.textLarge : styles.textMedium,
                filled && styles.filled,
              ]}
            >
              {filled ? '★' : '☆'}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 4,
  },
  starLarge: {
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  starMedium: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textLarge: {
    fontSize: 36,
    color: colors.ink,
  },
  textMedium: {
    fontSize: 28,
    color: colors.ink,
  },
  filled: {
    color: colors.accent,
  },
});
