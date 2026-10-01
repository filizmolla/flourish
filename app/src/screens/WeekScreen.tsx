import { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  attemptPhotoUrl,
  Meal,
  MealKind,
  mealPhotoUrl,
  Nutrient,
  WeekAttempt,
} from '../api/recipesClient';
import { useAuth } from '../auth/AuthContext';
import { MealSheet } from '../components/MealSheet';
import { Bouquet, flowerImages } from '../components/Bouquet';
import { useWeek } from '../hooks/useMeals';
import { AppStackParamList, Screens } from '../navigation/types';
import { Flower, flowerFor } from '../nutrients/flowers';
import {
  attemptItem,
  mealItem,
  NUTRIENTS,
  NutrientState,
  weekItems,
  weekStates,
} from '../nutrients/nutrientStates';
import { strings } from '../strings';
import { colors, fonts } from '../theme';
import {
  addDays,
  dayKey,
  formatWeekRange,
  startOfWeek,
  weekDays,
} from '../utils/week';

type Props = NativeStackScreenProps<AppStackParamList, Screens.Week>;

type Item =
  | { type: 'meal'; at: Date; meal: Meal }
  | { type: 'attempt'; at: Date; attempt: WeekAttempt };

// The week's meals and attempts by local day, oldest first within a day.
function itemsByDay(
  meals: Meal[],
  attempts: WeekAttempt[],
): Map<string, Item[]> {
  const items: Item[] = [
    ...meals.map(meal => ({
      type: 'meal' as const,
      at: new Date(meal.eatenAt),
      meal,
    })),
    ...attempts.map(attempt => ({
      type: 'attempt' as const,
      at: new Date(attempt.madeAt),
      attempt,
    })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());

  const byDay = new Map<string, Item[]>();
  for (const item of items) {
    const key = dayKey(item.at);
    byDay.set(key, [...(byDay.get(key) ?? []), item]);
  }
  return byDay;
}

// An item's flower in the bouquet and on its tile.
function itemFlower(item: Item): Flower {
  return flowerFor(
    item.type === 'meal' ? mealItem(item.meal) : attemptItem(item.attempt),
  );
}

// A tile's inside: the photo with the tag as a badge on it, or the tag
// above the text. Every tile uses the same type; only cooked recipes and
// snacks get a tag, so plain meals (most tiles) stay quiet.
function TileBody({
  tag,
  image,
  text,
  flower,
  flowerTestID,
}: {
  tag: string | null;
  image: { uri: string; headers?: Record<string, string> } | null;
  text: string | null;
  flower: Flower;
  flowerTestID: string;
}) {
  // Its bouquet flower in the corner the badge doesn't use; the tile's
  // label already says what it is, so screen readers skip it.
  const flowerMark = (
    <Image
      testID={flowerTestID}
      source={flowerImages[flower]}
      style={styles.tileFlower}
      accessibilityElementsHidden
      importantForAccessibility="no"
    />
  );
  if (image) {
    return (
      <>
        <Image source={image} style={styles.tileImage} resizeMode="cover" />
        {tag ? (
          <Text style={[styles.tag, styles.tagBadge]}>{tag.toUpperCase()}</Text>
        ) : null}
        {flowerMark}
      </>
    );
  }
  return (
    <>
      <View style={styles.tileBody}>
        {tag ? <Text style={styles.tag}>{tag.toUpperCase()}</Text> : null}
        <Text style={styles.tileText} numberOfLines={tag ? 3 : 4}>
          {text}
        </Text>
      </View>
      {flowerMark}
    </>
  );
}

// A photo tile when the meal has one, else its text; an attempt shows the
// recipe's image, else its title.
function Tile({
  item,
  dayName,
  token,
  onOpenMeal,
  onOpenAttempt,
}: {
  item: Item;
  dayName: string;
  token: string | null;
  onOpenMeal: (meal: Meal) => void;
  onOpenAttempt: (attempt: WeekAttempt) => void;
}) {
  if (item.type === 'meal') {
    const { meal } = item;
    const label = strings.week.tileLabel([
      strings.week.kinds[meal.kind],
      dayName,
      meal.text,
      meal.fullness && strings.fullness[meal.fullness],
    ]);
    return (
      <Pressable
        testID={`week-item-meal-${meal.id}`}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={({ pressed }) => [styles.tile, pressed && styles.pressed]}
        onPress={() => onOpenMeal(meal)}
      >
        <TileBody
          tag={
            meal.kind === MealKind.Snack ? strings.week.kinds[meal.kind] : null
          }
          image={
            meal.hasPhoto
              ? {
                  uri: mealPhotoUrl(meal.id),
                  headers: token ? { Authorization: `Bearer ${token}` } : {},
                }
              : null
          }
          text={meal.text}
          flower={itemFlower(item)}
          flowerTestID={`week-item-meal-${meal.id}-flower`}
        />
      </Pressable>
    );
  }

  const { attempt } = item;
  const label = strings.week.tileLabel([
    strings.week.cooked,
    attempt.recipe.title,
    dayName,
    attempt.fullness && strings.fullness[attempt.fullness],
  ]);
  return (
    <Pressable
      testID={`week-item-attempt-${attempt.id}`}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.tile, pressed && styles.pressed]}
      onPress={() => onOpenAttempt(attempt)}
    >
      <TileBody
        tag={strings.week.cooked}
        // The photo of what came out, else the recipe's own image.
        image={
          attempt.hasPhoto
            ? {
                uri: attemptPhotoUrl(attempt.id),
                headers: token ? { Authorization: `Bearer ${token}` } : {},
              }
            : attempt.recipe.imageUrl
            ? { uri: attempt.recipe.imageUrl }
            : null
        }
        text={attempt.recipe.title}
        flower={itemFlower(item)}
        flowerTestID={`week-item-attempt-${attempt.id}-flower`}
      />
    </Pressable>
  );
}

// The week's balance: the bouquet, one sentence on what showed up, and a
// way to the foods that bring the one to add. No counts on screen.
function Summary({
  meals,
  attempts,
  flowers,
  onMore,
}: {
  meals: Meal[];
  attempts: WeekAttempt[];
  flowers: Flower[];
  onMore: (nutrient: Nutrient) => void;
}) {
  const items = weekItems({ meals, attempts });
  const states = weekStates(items);
  const judged = items.some(item => item.judged);
  const words = (state: NutrientState) =>
    NUTRIENTS.filter(n => states[n] === state).map(
      n => strings.ingredients.groups[n],
    );
  const often = words(NutrientState.Full);
  const some = words(NutrientState.Some);
  const notYet = words(NutrientState.None);
  const toAdd =
    NUTRIENTS.find(n => states[n] === NutrientState.None) ??
    NUTRIENTS.find(n => states[n] === NutrientState.Some);

  return (
    <View style={styles.summary}>
      <Bouquet
        // A new set of flowers replays the pop-in.
        key={flowers.join(',')}
        testID="week-bouquet"
        flowers={flowers}
        accessibilityLabel={strings.week.dotsLabel(often, some, notYet)}
      />
      <View style={styles.summaryWords}>
        <Text testID="week-summary-text" style={styles.summaryText}>
          {judged
            ? strings.week.summary(often, some, notYet)
            : strings.week.noText}
        </Text>
        {judged && toAdd ? (
          <Pressable
            testID="week-more-link"
            accessibilityRole="link"
            style={styles.link}
            onPress={() => onMore(toAdd)}
          >
            <Text style={styles.linkText}>{strings.balance.more[toAdd]}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

// Your week: what you ate and cooked, day by day, and the week's bouquet.
export default function WeekScreen({ navigation }: Props) {
  const { token } = useAuth();
  const thisMonday = useMemo(() => startOfWeek(new Date()), []);
  const [monday, setMonday] = useState(thisMonday);
  // The meal open in the sheet, looked up in the loaded week on each render
  // so a saved change shows up; gone (deleted) closes the sheet.
  const [openMealId, setOpenMealId] = useState<string | null>(null);
  const { data, isPending, isError, refetch } = useWeek(monday);
  const isCurrent = monday.getTime() === thisMonday.getTime();

  const byDay = useMemo(
    () => (data ? itemsByDay(data.meals, data.attempts) : new Map()),
    [data],
  );
  // One flower per meal and attempt, in time order.
  const flowers = useMemo(
    () => [...byDay.values()].flat().map(itemFlower),
    [byDay],
  );
  const empty = data && data.meals.length === 0 && data.attempts.length === 0;
  const openMeal = data?.meals.find(meal => meal.id === openMealId);

  return (
    <ScrollView
      testID="week-screen"
      style={styles.screen}
      contentContainerStyle={styles.container}
    >
      <Text style={styles.title}>{strings.week.title}</Text>

      <View style={styles.weekNav}>
        <Pressable
          testID="week-prev-button"
          accessibilityRole="button"
          accessibilityLabel={strings.week.previous}
          hitSlop={8}
          style={styles.navButton}
          onPress={() => setMonday(addDays(monday, -7))}
        >
          <Text style={styles.navText}>‹</Text>
        </Pressable>
        <Text style={styles.range}>{formatWeekRange(monday)}</Text>
        <Pressable
          testID="week-next-button"
          accessibilityRole="button"
          accessibilityLabel={strings.week.next}
          accessibilityState={{ disabled: isCurrent }}
          disabled={isCurrent}
          hitSlop={8}
          style={[styles.navButton, isCurrent && styles.disabled]}
          onPress={() => setMonday(addDays(monday, 7))}
        >
          <Text style={styles.navText}>›</Text>
        </Pressable>
      </View>

      {isPending ? (
        <ActivityIndicator color={colors.accent} style={styles.loading} />
      ) : isError ? (
        <View style={styles.center}>
          <Text testID="week-error-text" style={styles.error}>
            {strings.week.loadFailed}
          </Text>
          <Pressable
            accessibilityRole="button"
            style={styles.retryButton}
            onPress={() => refetch()}
          >
            <Text style={styles.linkText}>{strings.common.tryAgain}</Text>
          </Pressable>
        </View>
      ) : empty ? (
        <View style={styles.center}>
          <Text testID="week-empty-text" style={styles.emptyText}>
            {strings.week.empty}
          </Text>
          <Pressable
            testID="week-add-meal-button"
            accessibilityRole="button"
            style={styles.addButton}
            onPress={() => navigation.navigate(Screens.AddMeal)}
          >
            <Text style={styles.addButtonText}>{strings.addMeal.entry}</Text>
          </Pressable>
        </View>
      ) : (
        <>
          {weekDays(monday).map((day, index) => {
            const key = dayKey(day);
            const items: Item[] = byDay.get(key) ?? [];
            return (
              <View key={key} testID={`week-day-${key}`} style={styles.day}>
                <Text style={styles.dayName}>{strings.week.days[index]}</Text>
                {items.length === 0 ? (
                  <Text style={styles.nothing}>
                    {strings.week.nothingLogged}
                  </Text>
                ) : (
                  <View style={styles.tiles}>
                    {items.map(item => (
                      <Tile
                        key={`${item.type}-${
                          item.type === 'meal' ? item.meal.id : item.attempt.id
                        }`}
                        item={item}
                        dayName={strings.week.dayNames[index]}
                        token={token}
                        onOpenMeal={meal => setOpenMealId(meal.id)}
                        onOpenAttempt={attempt =>
                          navigation.navigate(Screens.AttemptDetail, {
                            recipeId: attempt.recipeId,
                            attemptId: attempt.id,
                          })
                        }
                      />
                    ))}
                  </View>
                )}
              </View>
            );
          })}
          <View style={styles.rule} />
          <Summary
            meals={data.meals}
            attempts={data.attempts}
            flowers={flowers}
            onMore={group =>
              navigation.navigate(Screens.Ingredients, { group })
            }
          />
        </>
      )}
      {openMeal ? (
        <MealSheet
          meal={openMeal}
          token={token}
          onClose={() => setOpenMealId(null)}
        />
      ) : null}
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
    gap: 16,
  },
  title: {
    fontFamily: fonts.serif,
    fontSize: 30,
    lineHeight: 37,
    color: colors.ink,
  },
  weekNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  navButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navText: {
    fontSize: 28,
    color: colors.accent,
  },
  range: {
    fontFamily: fonts.serif,
    fontSize: 18,
    color: colors.ink,
  },
  disabled: {
    opacity: 0.3,
  },
  loading: {
    marginTop: 32,
  },
  center: {
    alignItems: 'center',
    gap: 16,
    paddingVertical: 32,
  },
  error: {
    color: colors.danger,
    textAlign: 'center',
  },
  retryButton: {
    minHeight: 44,
    justifyContent: 'center',
  },
  emptyText: {
    fontFamily: fonts.serif,
    fontStyle: 'italic',
    fontSize: 16,
    lineHeight: 24,
    color: colors.inkMuted,
    textAlign: 'center',
  },
  addButton: {
    minHeight: 48,
    paddingHorizontal: 24,
    borderRadius: 14,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addButtonText: {
    color: colors.accent,
    fontSize: 16,
    fontWeight: '700',
  },
  day: {
    gap: 8,
  },
  dayName: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.4,
    color: colors.accent,
  },
  nothing: {
    fontSize: 14,
    color: colors.inkMuted,
  },
  tiles: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  // Three per row.
  tile: {
    width: '31.5%',
    aspectRatio: 1,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.hairline,
    justifyContent: 'center',
  },
  tileImage: {
    width: '100%',
    height: '100%',
  },
  tileBody: {
    padding: 8,
    gap: 4,
  },
  // The same type on every tile; cooked recipes and snacks carry a tag.
  tileText: {
    fontFamily: fonts.serif,
    fontSize: 15,
    lineHeight: 19,
    color: colors.ink,
  },
  tag: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
    color: colors.accent,
  },
  // On a photo: a small label in the corner, readable on any image.
  tagBadge: {
    position: 'absolute',
    top: 6,
    left: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    overflow: 'hidden',
    backgroundColor: 'rgba(255, 253, 249, 0.92)',
  },
  tileFlower: {
    position: 'absolute',
    right: 5,
    bottom: 5,
    width: 18,
    height: 18,
  },
  pressed: {
    opacity: 0.85,
  },
  rule: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.hairline,
    marginVertical: 8,
  },
  summary: {
    gap: 12,
  },
  summaryWords: {
    gap: 4,
  },
  summaryText: {
    fontFamily: fonts.serif,
    fontSize: 17,
    lineHeight: 24,
    color: colors.ink,
  },
  link: {
    minHeight: 44,
    justifyContent: 'center',
  },
  linkText: {
    color: colors.accent,
    fontSize: 15,
    fontWeight: '600',
  },
});
