import { NativeStackScreenProps } from '@react-navigation/native-stack';
import React from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { usdaFoodUrl } from '../api/recipesClient';
import { GroupChip } from '../components/NutrientChips';
import { NutrientDots } from '../components/NutrientDots';
import { useIngredient } from '../hooks/useIngredients';
import { AppStackParamList, Screens } from '../navigation/types';
import { ingredientStates } from '../nutrients/nutrientStates';
import { strings } from '../strings';
import { colors, fonts } from '../theme';

type Props = NativeStackScreenProps<
  AppStackParamList,
  Screens.IngredientDetail
>;

// One catalog entry: what it mainly is and what else it has, as the
// dots and chips (never per-100 g numbers), then the viewer's recipes
// that use it and where the values come from.
export default function IngredientDetailScreen({ navigation, route }: Props) {
  const { ingredientId } = route.params;
  const {
    data: ingredient,
    isPending,
    isError,
    refetch,
  } = useIngredient(ingredientId);

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
        <Text testID="ingredient-detail-error-text" style={styles.errorText}>
          {strings.ingredients.loadFailed}
        </Text>
        <Pressable
          accessibilityRole="button"
          style={styles.retryButton}
          onPress={() => refetch()}
        >
          <Text style={styles.retryText}>{strings.common.tryAgain}</Text>
        </Pressable>
      </View>
    );
  }

  const { name, mainGroup, nutrients, description, fdcId, recipes } =
    ingredient;
  const also = nutrients.filter(nutrient => nutrient !== mainGroup);
  const label =
    strings.ingredients.groupsLabel(
      mainGroup && strings.ingredients.groups[mainGroup],
      also.map(nutrient => strings.ingredients.groups[nutrient]),
    ) || strings.ingredients.noGroups;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.top}>
        <View style={styles.words}>
          <Text
            testID="ingredient-detail-name"
            accessibilityRole="header"
            style={styles.title}
          >
            {name}
          </Text>
          {mainGroup ? (
            <View style={styles.chipRow}>
              <Text style={styles.chipLabel}>{strings.ingredients.mainly}</Text>
              <GroupChip group={mainGroup} main />
            </View>
          ) : null}
          {also.length > 0 ? (
            <View style={styles.chipRow}>
              <Text style={styles.chipLabel}>{strings.ingredients.also}</Text>
              {also.map(nutrient => (
                <GroupChip key={nutrient} group={nutrient} />
              ))}
            </View>
          ) : null}
          {!mainGroup && also.length === 0 ? (
            <Text style={styles.muted}>{strings.ingredients.noGroups}</Text>
          ) : null}
        </View>
        <NutrientDots
          testID="ingredient-detail-nutrient-dots"
          states={ingredientStates(mainGroup, nutrients)}
          accessibilityLabel={label}
        />
      </View>

      {description ? (
        <Text testID="ingredient-detail-description" style={styles.paragraph}>
          {description}
        </Text>
      ) : null}

      <View style={styles.rule} />

      <Text style={styles.kicker}>{strings.ingredients.inYourRecipes}</Text>
      {recipes.length === 0 ? (
        <Text testID="ingredient-detail-not-used-text" style={styles.muted}>
          {strings.ingredients.notUsedYet}
        </Text>
      ) : (
        recipes.map(recipe => (
          <Pressable
            key={recipe.id}
            testID={`ingredient-detail-used-in-${recipe.id}`}
            accessibilityRole="link"
            style={({ pressed }) => [styles.recipeRow, pressed && styles.pressed]}
            onPress={() =>
              navigation.push(Screens.RecipeDetail, { recipeId: recipe.id })
            }
          >
            <Text style={styles.recipeTitle}>{recipe.title}</Text>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        ))
      )}

      {fdcId !== null ? (
        <Pressable
          testID="ingredient-detail-usda-link"
          accessibilityRole="link"
          style={styles.link}
          onPress={() =>
            Linking.openURL(usdaFoodUrl(fdcId)).catch(() =>
              Alert.alert(strings.ingredients.usdaLinkFailed),
            )
          }
        >
          <Text style={styles.linkText}>{strings.ingredients.usdaLink}</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: colors.paper,
  },
  content: {
    padding: 20,
    paddingBottom: 48,
    gap: 12,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 16,
    backgroundColor: colors.paper,
  },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  words: {
    flex: 1,
    gap: 10,
  },
  title: {
    fontFamily: fonts.serif,
    fontSize: 30,
    lineHeight: 37,
    color: colors.ink,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
  },
  chipLabel: {
    fontSize: 14,
    color: colors.inkMuted,
    marginRight: 2,
  },
  paragraph: {
    fontFamily: fonts.serif,
    fontSize: 16,
    lineHeight: 24,
    color: colors.ink,
  },
  rule: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.hairline,
    marginVertical: 8,
  },
  kicker: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.4,
    color: colors.accent,
  },
  muted: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.inkMuted,
  },
  recipeRow: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  recipeTitle: {
    flex: 1,
    fontFamily: fonts.serif,
    fontSize: 17,
    color: colors.ink,
  },
  chevron: {
    fontSize: 20,
    color: colors.inkMuted,
  },
  pressed: {
    opacity: 0.85,
  },
  link: {
    minHeight: 44,
    justifyContent: 'center',
    marginTop: 12,
  },
  linkText: {
    color: colors.accent,
    fontSize: 15,
    fontWeight: '600',
  },
  errorText: {
    color: colors.danger,
    textAlign: 'center',
  },
  retryButton: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 20,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.accent,
  },
  retryText: {
    color: colors.accent,
    fontWeight: '700',
  },
});
