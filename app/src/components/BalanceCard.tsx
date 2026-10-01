import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Nutrient, RecipeLine } from '../api/recipesClient';
import {
  NUTRIENTS,
  coveredNutrients,
  recipeBalance,
  recipeStates,
} from '../nutrients/nutrientStates';
import { strings } from '../strings';
import { colors, fonts } from '../theme';
import { NutrientDots } from './NutrientDots';

// What a recipe's linked lines bring, and what to add if something's gray:
// "Make it more filling · Add a healthy fat." with a link to the foods that
// have it. No fixed food chips: a short list can't fit every dish (avocado
// for a cake), so the whole filtered catalog is one tap away instead.
// Nothing when no line is linked, since there's nothing to judge from.
export function BalanceCard({
  lines,
  onMorePress,
}: {
  lines: RecipeLine[];
  onMorePress?: (nutrient: Nutrient) => void;
}) {
  const balance = recipeBalance(lines);
  if (balance.kind === 'unknown') return null;

  const nutrient = balance.kind === 'add' ? balance.nutrient : undefined;
  const covered = coveredNutrients(lines);
  const words = (list: typeof NUTRIENTS) =>
    list.map(n => strings.ingredients.groups[n]);
  const label = strings.balance.hasLabel(
    words(NUTRIENTS.filter(n => covered.has(n))),
    words(NUTRIENTS.filter(n => !covered.has(n))),
  );

  return (
    <View testID="recipe-detail-balance-card" style={styles.card}>
      <View style={styles.top}>
        <NutrientDots
          testID="recipe-detail-nutrient-dots"
          states={recipeStates(lines)}
          accessibilityLabel={label}
        />
        <View style={styles.words}>
          {nutrient ? (
            <>
              <Text style={styles.headline}>{strings.balance.moreFilling}</Text>
              <Text style={styles.add}>{strings.balance.add[nutrient]}</Text>
            </>
          ) : (
            <Text style={styles.headline}>{strings.balance.balanced}</Text>
          )}
        </View>
      </View>
      {nutrient && onMorePress ? (
        <Pressable
          testID="recipe-detail-balance-more-link"
          accessibilityRole="link"
          style={styles.more}
          onPress={() => onMorePress(nutrient)}
        >
          <Text style={styles.moreText}>{strings.balance.more[nutrient]}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 20,
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.card,
    gap: 12,
  },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  words: {
    flex: 1,
    gap: 4,
  },
  headline: {
    fontFamily: fonts.serif,
    fontSize: 18,
    lineHeight: 24,
    color: colors.ink,
  },
  add: {
    fontSize: 15,
    color: colors.inkMuted,
  },
  more: {
    minHeight: 44,
    justifyContent: 'center',
  },
  moreText: {
    color: colors.accent,
    fontSize: 15,
    fontWeight: '600',
  },
});
