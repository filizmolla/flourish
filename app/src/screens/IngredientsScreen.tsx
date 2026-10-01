import { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { FoodGroup } from '../api/recipesClient';
import { NutrientChips } from '../components/NutrientChips';
import { NutrientDots } from '../components/NutrientDots';
import { useIngredients } from '../hooks/useIngredients';
import { AppStackParamList, Screens } from '../navigation/types';
import { ingredientStates } from '../nutrients/nutrientStates';
import { strings } from '../strings';
import { colors, fonts } from '../theme';

type Props = NativeStackScreenProps<AppStackParamList, Screens.Ingredients>;

// Wait this long after the last keystroke before searching.
export const SEARCH_DELAY_MS = 250;

const FILTERS: { group: FoodGroup | undefined; testID: string }[] = [
  { group: undefined, testID: 'ingredient-filter-all' },
  { group: FoodGroup.Protein, testID: 'ingredient-filter-protein' },
  { group: FoodGroup.Fiber, testID: 'ingredient-filter-fiber' },
  { group: FoodGroup.HealthyFat, testID: 'ingredient-filter-healthy-fat' },
  { group: FoodGroup.Carb, testID: 'ingredient-filter-carb' },
];

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

// The catalog, read-only: search by name (or a Turkish name), filter by
// group. A nutrient filter shows every ingredient that has it, so Fiber
// also shows avocado.
export default function IngredientsScreen({ navigation, route }: Props) {
  const [search, setSearch] = useState('');
  const [group, setGroup] = useState<FoodGroup | undefined>(
    route.params?.group,
  );
  const q = useDebouncedValue(search.trim(), SEARCH_DELAY_MS);
  const {
    data: ingredients,
    isPending,
    isError,
    error,
    isPlaceholderData,
  } = useIngredients({ q: q || undefined, group });

  return (
    <View style={styles.screen}>
      <View style={styles.controls}>
        <TextInput
          testID="ingredient-search-input"
          style={styles.search}
          value={search}
          onChangeText={setSearch}
          placeholder={strings.ingredients.searchPlaceholder}
          placeholderTextColor={colors.placeholderText}
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
          returnKeyType="search"
        />
        <View style={styles.filters}>
          {FILTERS.map(filter => {
            const selected = filter.group === group;
            return (
              <Pressable
                key={filter.testID}
                testID={filter.testID}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => setGroup(filter.group)}
                style={({ pressed }) => [
                  styles.filter,
                  selected && styles.filterSelected,
                  pressed && styles.pressed,
                ]}
              >
                <Text
                  style={[
                    styles.filterText,
                    selected && styles.filterTextSelected,
                  ]}
                >
                  {filter.group
                    ? strings.ingredients.groups[filter.group]
                    : strings.ingredients.all}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {isPending ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : isError ? (
        <View style={styles.center}>
          <Text style={styles.error}>{error.message}</Text>
        </View>
      ) : (
        <FlatList
          testID="ingredient-list"
          data={ingredients}
          keyExtractor={item => item.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={Separator}
          ListEmptyComponent={
            // While the next search loads, the empty list on screen is the
            // last one's, so it would name the wrong search.
            isPlaceholderData ? undefined : (
              <Text testID="ingredient-list-empty-text" style={styles.empty}>
                {q ? strings.ingredients.noMatch(q) : strings.ingredients.empty}
              </Text>
            )
          }
          renderItem={({ item }) => (
            <Pressable
              testID={`ingredient-list-item-${item.id}`}
              accessibilityRole="button"
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              onPress={() =>
                navigation.navigate(Screens.IngredientDetail, {
                  ingredientId: item.id,
                })
              }
            >
              {/* The chips carry the meaning; the dots are a glance. */}
              <View importantForAccessibility="no-hide-descendants">
                <NutrientDots
                  testID={`ingredient-list-item-${item.id}-nutrient-dots`}
                  size="small"
                  states={ingredientStates(item.mainGroup, item.nutrients)}
                  accessibilityLabel=""
                />
              </View>
              <View style={styles.rowText}>
                <Text style={styles.name}>{item.name}</Text>
                <NutrientChips
                  mainGroup={item.mainGroup}
                  nutrients={item.nutrients}
                />
              </View>
            </Pressable>
          )}
        />
      )}
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
  controls: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
    gap: 12,
  },
  search: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: 12,
    paddingHorizontal: 14,
    backgroundColor: colors.card,
    color: colors.ink,
    fontSize: 16,
  },
  filters: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  filter: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.card,
  },
  filterSelected: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  filterText: {
    color: colors.ink,
    fontSize: 15,
  },
  filterTextSelected: {
    color: colors.card,
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.85,
  },
  list: {
    flexGrow: 1,
    paddingHorizontal: 16,
    paddingBottom: 32,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    gap: 14,
  },
  rowText: {
    flex: 1,
    gap: 6,
  },
  name: {
    fontFamily: fonts.serif,
    fontSize: 18,
    color: colors.ink,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.hairline,
  },
  empty: {
    fontFamily: fonts.serif,
    fontStyle: 'italic',
    fontSize: 16,
    color: colors.inkMuted,
    textAlign: 'center',
    paddingVertical: 48,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  error: {
    color: colors.danger,
  },
});
