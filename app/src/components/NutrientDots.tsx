import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { FoodGroup, Nutrient } from '../api/recipesClient';
import {
  NUTRIENTS,
  NutrientState,
  NutrientStates,
} from '../nutrients/nutrientStates';
import { strings } from '../strings';
import { colors } from '../theme';

// Light accent tint for "some": the accent (#B5562F) at 30%.
const ACCENT_TINT = 'rgba(181, 86, 47, 0.3)';

// Fixed geometry per size; only the fill ever changes with data. All three
// dots are the same size: no nutrient counts for more than another.
const SIZES = {
  small: { dot: 8, gap: 4, labels: false },
  large: { dot: 22, gap: 8, labels: true },
} as const;

const LABEL_WIDTH = 72;

const DOT_IDS: Record<Nutrient, string> = {
  [FoodGroup.Protein]: 'protein',
  [FoodGroup.Fiber]: 'fiber',
  [FoodGroup.HealthyFat]: 'healthy-fat',
};

// Three equal dots in a row, one per nutrient, each none (gray, outlined),
// some (light tint) or full (accent). The large size puts a word under each
// dot so the meaning never rests on color alone; the small one leaves that
// to the row's text. Read out as one label from the caller.
export function NutrientDots({
  states,
  accessibilityLabel,
  size = 'large',
  testID,
}: {
  states: NutrientStates;
  accessibilityLabel: string;
  size?: 'small' | 'large';
  testID: string;
}) {
  const { dot, gap, labels } = SIZES[size];

  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
      style={[styles.row, { gap }]}
    >
      {NUTRIENTS.map(nutrient => (
        <View
          key={nutrient}
          style={[styles.item, labels && { width: LABEL_WIDTH }]}
        >
          <View
            testID={`${testID}-dot-${DOT_IDS[nutrient]}`}
            style={[
              styles.dot,
              styles[states[nutrient]],
              { width: dot, height: dot, borderRadius: dot / 2 },
            ]}
          />
          {labels ? (
            <Text
              numberOfLines={1}
              style={[
                styles.label,
                states[nutrient] === NutrientState.None && styles.labelNone,
              ]}
            >
              {strings.ingredients.groups[nutrient]}
            </Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  item: {
    alignItems: 'center',
  },
  dot: {
    borderWidth: 1.5,
  },
  [NutrientState.None]: {
    backgroundColor: colors.card,
    borderColor: colors.placeholderText,
  },
  [NutrientState.Some]: {
    backgroundColor: ACCENT_TINT,
    borderColor: colors.accent,
  },
  [NutrientState.Full]: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  label: {
    marginTop: 6,
    textAlign: 'center',
    fontSize: 11,
    fontWeight: '600',
    color: colors.ink,
  },
  labelNone: {
    color: colors.inkMuted,
  },
});
