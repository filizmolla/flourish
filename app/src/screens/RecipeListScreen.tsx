import { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../auth/AuthContext';
import { useQueryClient } from '@tanstack/react-query';
import { attemptKeys } from '../hooks/useAttempts';
import { useRecipes } from '../hooks/useRecipes';
import { RatePromptCard } from '../components/RatePromptCard';
import { RecipeCard } from '../components/RecipeCard';
import { RecipeFilterBar } from '../components/RecipeFilterBar';
import {
  filterRecipes,
  hasFilters,
  NO_FILTERS,
  sourceOptions,
} from '../recipes/recipeFilters';
import { AppStackParamList, Screens } from '../navigation/types';
import { strings } from '../strings';
import { colors, fonts } from '../theme';

type Props = NativeStackScreenProps<AppStackParamList, Screens.Recipes>;

function ListHeader({
  count,
  onMakeToday,
}: {
  count: number;
  onMakeToday: () => void;
}) {
  const { user } = useAuth();
  const firstName = user?.name.split(' ')[0];

  return (
    <View style={styles.header}>
      <Text style={styles.kicker}>{strings.recipeList.kicker}</Text>
      <Text style={styles.headline}>
        {firstName
          ? strings.recipeList.greeting(firstName)
          : strings.recipeList.greetingNoName}
      </Text>
      {count > 0 ? (
        <Text style={styles.subhead}>
          {strings.recipeList.recipeCount(count)}
        </Text>
      ) : null}
      {count > 0 ? (
        <Pressable
          testID="recipes-make-today-link"
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.makeTodayButton,
            pressed && styles.pressed,
          ]}
          onPress={onMakeToday}
        >
          <Text style={styles.addMealText}>{strings.makeToday.link}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export default function RecipeListScreen({ navigation }: Props) {
  const {
    data: recipes,
    isPending,
    isError,
    error,
    refetch,
    isRefetching,
  } = useRecipes();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState(NO_FILTERS);
  const sources = useMemo(() => sourceOptions(recipes ?? []), [recipes]);
  const shown = useMemo(
    () => filterRecipes(recipes ?? [], filters),
    [recipes, filters],
  );
  const filtering = hasFilters(filters);

  if (isPending) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (isError) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error.message}</Text>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <FlatList
        testID="recipe-list"
        contentContainerStyle={styles.list}
        data={shown}
        keyExtractor={item => item.id}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            tintColor={colors.accent}
            colors={[colors.accent]}
            onRefresh={() => {
              refetch();
              queryClient.invalidateQueries({ queryKey: attemptKeys.unrated });
            }}
          />
        }
        ListHeaderComponent={
          <>
            <ListHeader
              count={recipes.length}
              onMakeToday={() => navigation.navigate(Screens.MakeToday)}
            />
            <RatePromptCard
              onOpen={attempt =>
                navigation.navigate(Screens.AttemptDetail, {
                  recipeId: attempt.recipeId,
                  attemptId: attempt.id,
                })
              }
            />
            <View style={styles.mealRow}>
              <Pressable
                testID="recipes-add-meal-button"
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.addMealButton,
                  pressed && styles.pressed,
                ]}
                onPress={() => navigation.navigate(Screens.AddMeal)}
              >
                <Text style={styles.addMealText}>{strings.addMeal.entry}</Text>
              </Pressable>
              <Pressable
                testID="recipes-week-link"
                accessibilityRole="link"
                style={({ pressed }) => [
                  styles.weekLink,
                  pressed && styles.pressed,
                ]}
                onPress={() => navigation.navigate(Screens.Week)}
              >
                <Text style={styles.addMealText}>{strings.week.link}</Text>
              </Pressable>
            </View>
            {recipes.length > 0 ? (
              <RecipeFilterBar
                filters={filters}
                sources={sources}
                onChange={setFilters}
              />
            ) : null}
          </>
        }
        ListEmptyComponent={
          filtering ? (
            <View style={styles.empty}>
              <Text testID="recipe-list-no-match-text" style={styles.emptyText}>
                {strings.recipeList.noMatch}
              </Text>
              <Pressable
                testID="recipes-clear-filters-button"
                accessibilityRole="button"
                style={styles.clearButton}
                onPress={() => setFilters(NO_FILTERS)}
              >
                <Text style={styles.addMealText}>
                  {strings.recipeList.clearFilters}
                </Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.empty}>
              <Text testID="recipe-list-empty-text" style={styles.emptyTitle}>
                {strings.recipeList.emptyTitle}
              </Text>
              <Text style={styles.emptyText}>
                {strings.recipeList.emptyText}
              </Text>
            </View>
          )
        }
        ItemSeparatorComponent={Separator}
        renderItem={({ item, index }) => (
          <Pressable
            testID={`recipe-list-item-${item.id}`}
            onPress={() =>
              navigation.navigate(Screens.RecipeDetail, { recipeId: item.id })
            }
            style={({ pressed }) => pressed && styles.pressed}
          >
            <RecipeCard recipe={item} featured={index === 0} />
          </Pressable>
        )}
      />
      <Pressable
        testID="recipe-list-new-button"
        style={({ pressed }) => [
          styles.newButton,
          { bottom: 24 + insets.bottom },
          pressed && styles.pressed,
        ]}
        onPress={() => navigation.navigate(Screens.Import)}
      >
        <Text style={styles.newButtonText}>{strings.recipeList.newRecipe}</Text>
      </Pressable>
    </View>
  );
}

function Separator() {
  return <View style={styles.separator} />;
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.paper,
  },
  pressed: {
    opacity: 0.85,
  },
  clearButton: {
    minHeight: 44,
    justifyContent: 'center',
    marginTop: 8,
  },
  // Full width like "+ Add what you ate"; the header's side padding is undone
  // so both line up with the recipe cards.
  makeTodayButton: {
    minHeight: 48,
    marginTop: 16,
    marginHorizontal: -4,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // A meal eaten anywhere, logged from the top of the list.
  mealRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
  },
  addMealButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  weekLink: {
    minHeight: 48,
    paddingHorizontal: 16,
    borderRadius: 14,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.hairline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addMealText: {
    color: colors.accent,
    fontSize: 16,
    fontWeight: '700',
  },
  newButton: {
    position: 'absolute',
    right: 20,
    paddingVertical: 14,
    paddingHorizontal: 22,
    borderRadius: 999,
    backgroundColor: colors.accent,
    elevation: 4,
    shadowColor: colors.ink,
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  newButtonText: {
    color: colors.card,
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: colors.paper,
  },
  list: {
    flexGrow: 1,
    paddingHorizontal: 16,
    // Room for the floating "New recipe" button over the last card.
    paddingBottom: 110,
  },
  header: {
    paddingTop: 20,
    paddingBottom: 16,
    paddingHorizontal: 4,
  },
  kicker: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 2,
    color: colors.accent,
  },
  headline: {
    fontFamily: fonts.serif,
    fontSize: 30,
    lineHeight: 37,
    color: colors.ink,
    marginTop: 8,
  },
  subhead: {
    fontFamily: fonts.serif,
    fontStyle: 'italic',
    fontSize: 15,
    color: colors.inkMuted,
    marginTop: 8,
  },
  separator: {
    height: 20,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
  },
  emptyTitle: {
    fontFamily: fonts.serif,
    fontSize: 20,
    color: colors.ink,
  },
  emptyText: {
    fontFamily: fonts.serif,
    fontStyle: 'italic',
    fontSize: 15,
    color: colors.inkMuted,
    marginTop: 8,
  },
  error: {
    color: '#c0392b',
  },
});
