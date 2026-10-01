import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { FoodGroup, Nutrient } from '../api/recipesClient';
import { strings } from '../strings';
import { colors } from '../theme';

// One group as a chip: the main group filled (white on accent), any other
// nutrient outlined. Always a text label, never color alone.
export function GroupChip({
  group,
  main = false,
}: {
  group: FoodGroup;
  main?: boolean;
}) {
  return (
    <View style={[styles.chip, main ? styles.mainChip : styles.alsoChip]}>
      <Text style={main ? styles.mainText : styles.alsoText}>
        {strings.ingredients.groups[group]}
      </Text>
    </View>
  );
}

// A catalog entry's groups on one line: main group first, then the other
// nutrients. Nothing for a seasoning. Read out as one sentence.
export function NutrientChips({
  mainGroup,
  nutrients,
}: {
  mainGroup: FoodGroup | null;
  nutrients: Nutrient[];
}) {
  const also = nutrients.filter(nutrient => nutrient !== mainGroup);
  if (!mainGroup && also.length === 0) return null;

  const label = strings.ingredients.groupsLabel(
    mainGroup && strings.ingredients.groups[mainGroup],
    also.map(nutrient => strings.ingredients.groups[nutrient]),
  );

  return (
    <View style={styles.row} accessible accessibilityLabel={label}>
      {mainGroup ? <GroupChip group={mainGroup} main /> : null}
      {also.map(nutrient => (
        <GroupChip key={nutrient} group={nutrient} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    paddingVertical: 3,
    paddingHorizontal: 10,
  },
  mainChip: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  alsoChip: {
    borderColor: colors.hairline,
  },
  mainText: {
    color: colors.card,
    fontSize: 13,
    fontWeight: '600',
  },
  alsoText: {
    color: colors.ink,
    fontSize: 13,
  },
});
