import { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useWeek } from '../hooks/useMeals';
import { useRecipes } from '../hooks/useRecipes';
import {
  suggestRecipes,
  TIME_CHOICES,
  TimeChoice,
} from '../nutrients/makeToday';
import {
  NutrientState,
  weekItems,
  weekStates,
} from '../nutrients/nutrientStates';
import { AppStackParamList, Screens } from '../navigation/types';
import { strings } from '../strings';
import { colors, fonts } from '../theme';
import { formatDuration } from '../utils/recipeFormat';
import { startOfWeek } from '../utils/week';

type Props = NativeStackScreenProps<AppStackParamList, Screens.MakeToday>;

// "What should I make?": your recipes that fit the time you have, the ones
// that add what this week is short on first. Uses only recipes, their times
// and this week's meals and attempts; no fridge yet (Phase 7).
export default function MakeTodayScreen({ navigation }: Props) {
  const [time, setTime] = useState<TimeChoice>(30);
  const recipes = useRecipes();
  const monday = useMemo(() => startOfWeek(new Date()), []);
  // Without the week (still loading, or failed) the list just has no
  // "Adds …" lines; it never waits on it.
  const { data: week } = useWeek(monday);

  const suggestions = useMemo(
    () =>
      recipes.data
        ? suggestRecipes(
            recipes.data,
            time,
            week ? weekStates(weekItems(week)) : null,
          )
        : [],
    [recipes.data, time, week],
  );

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      <Text style={styles.title}>{strings.makeToday.title}</Text>
      <Text style={styles.question}>{strings.makeToday.question}</Text>
      <View style={styles.times} accessibilityRole="radiogroup">
        {TIME_CHOICES.map(choice => {
          const selected = time === choice;
          return (
            <Pressable
              key={choice}
              testID={`make-today-time-${choice}`}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              style={[styles.chip, selected && styles.chipSelected]}
              onPress={() => setTime(choice)}
            >
              <Text
                style={[styles.chipText, selected && styles.chipTextSelected]}
              >
                {strings.makeToday.times[choice]}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.rule} />

      {recipes.isPending ? (
        <ActivityIndicator color={colors.accent} style={styles.loading} />
      ) : recipes.isError ? (
        <Text testID="make-today-error-text" style={styles.error}>
          {strings.makeToday.loadFailed}
        </Text>
      ) : recipes.data.length === 0 ? (
        <Text testID="make-today-empty-text" style={styles.empty}>
          {strings.makeToday.noRecipes}
        </Text>
      ) : suggestions.length === 0 ? (
        <Text testID="make-today-empty-text" style={styles.empty}>
          {strings.makeToday.empty(strings.makeToday.times[time])}
        </Text>
      ) : (
        suggestions.map(({ recipe, minutes, adds }) => (
          <Pressable
            key={recipe.id}
            testID={`make-today-recipe-${recipe.id}`}
            accessibilityRole="button"
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            onPress={() =>
              navigation.navigate(Screens.RecipeDetail, { recipeId: recipe.id })
            }
          >
            <View style={styles.rowText}>
              <View style={styles.rowTop}>
                <Text style={styles.recipeTitle}>{recipe.title}</Text>
                <Text style={styles.minutes}>
                  {minutes !== null
                    ? formatDuration(minutes)
                    : strings.makeToday.noTime}
                </Text>
              </View>
              {adds ? (
                <Text style={styles.adds}>
                  {(adds.week === NutrientState.None
                    ? strings.makeToday.addsMissing
                    : strings.makeToday.addsLow)(
                    strings.ingredients.groups[adds.nutrient],
                  )}
                </Text>
              ) : null}
            </View>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: colors.paper,
  },
  container: {
    padding: 20,
    paddingBottom: 48,
    gap: 12,
  },
  title: {
    fontFamily: fonts.serif,
    fontSize: 30,
    lineHeight: 37,
    color: colors.ink,
  },
  question: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.ink,
  },
  times: {
    flexDirection: 'row',
    gap: 8,
  },
  chip: {
    flexGrow: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.card,
  },
  chipSelected: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  chipText: {
    color: colors.ink,
    fontSize: 15,
  },
  chipTextSelected: {
    color: colors.card,
    fontWeight: '700',
  },
  rule: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.hairline,
    marginVertical: 4,
  },
  loading: {
    marginTop: 32,
  },
  error: {
    color: colors.danger,
  },
  empty: {
    fontFamily: fonts.serif,
    fontStyle: 'italic',
    fontSize: 16,
    lineHeight: 24,
    color: colors.inkMuted,
    textAlign: 'center',
    paddingVertical: 32,
  },
  row: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  pressed: {
    opacity: 0.85,
  },
  rowText: {
    flex: 1,
    gap: 4,
  },
  rowTop: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
  },
  recipeTitle: {
    flex: 1,
    fontFamily: fonts.serif,
    fontSize: 18,
    color: colors.ink,
  },
  minutes: {
    fontSize: 14,
    color: colors.inkMuted,
  },
  adds: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.accent,
  },
  chevron: {
    fontSize: 20,
    color: colors.inkMuted,
  },
});
