import { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useLayoutEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Recipe, RecipesError } from '../api/recipesClient';
import { BalanceCard } from '../components/BalanceCard';
import AttemptHistory from '../components/AttemptHistory';
import { useDeleteRecipe, useRecipe } from '../hooks/useRecipes';
import { openRecipe } from '../navigation/openRecipe';
import { AppStackParamList, Screens } from '../navigation/types';
import { headingText, isHeadingLine, splitLines } from '../recipes/recipeForm';
import { strings } from '../strings';
import { colors, fonts } from '../theme';
import {
  formatDuration,
  formatPostedDate,
  formatShortDate,
} from '../utils/recipeFormat';

type Props = NativeStackScreenProps<AppStackParamList, Screens.RecipeDetail>;

// Exactly one Instagram handle: "@someone", letters, digits, . and _.
const HANDLE_PATTERN = /^@([A-Za-z0-9._]{1,30})$/;

export function instagramUrl(source: string): string | null {
  const handle = source.match(HANDLE_PATTERN)?.[1];
  return handle ? `https://www.instagram.com/${handle}/` : null;
}

// "From @someone ↗" opens the profile (the Instagram app when installed, else
// the browser); any other source is plain text. The app never fetches it.
function Source({ source }: { source: string }) {
  const url = instagramUrl(source);
  if (!url) {
    return (
      <Text testID="recipe-detail-source-text" style={styles.sourceText}>
        {strings.recipeDetail.source(source)}
      </Text>
    );
  }
  return (
    <Pressable
      testID="recipe-detail-source-link"
      accessibilityRole="link"
      accessibilityLabel={strings.recipeDetail.openSource(source)}
      style={styles.forkedFrom}
      onPress={() =>
        Linking.openURL(url).catch(() =>
          Alert.alert(strings.recipeDetail.openSourceFailed),
        )
      }
    >
      <Text style={styles.forkedFromText}>
        {strings.recipeDetail.source(source)} ↗
      </Text>
    </Pressable>
  );
}

// Blank lines separate paragraphs in the story.
// Recipes saved from this one's attempts ("Save as new recipe"), newest first.
function Versions({
  forks,
  onOpen,
}: {
  forks: Recipe['forks'];
  onOpen: (recipeId: string) => void;
}) {
  return (
    <View testID="recipe-detail-versions" style={styles.versions}>
      <Text style={[styles.kicker, styles.versionsKicker]}>
        {strings.recipeDetail.versionsKicker}
      </Text>
      {forks.map(fork => (
        <Pressable
          key={fork.id}
          testID={`recipe-detail-version-${fork.id}`}
          accessibilityRole="link"
          style={styles.versionRow}
          onPress={() => onOpen(fork.id)}
        >
          <Text style={styles.versionTitle}>{fork.title}</Text>
          <Text style={styles.versionChevron}>›</Text>
        </Pressable>
      ))}
    </View>
  );
}

function storyParagraphs(story: string | null): string[] {
  if (!story) return [];
  return story
    .split(/\n\s*\n/)
    .map(paragraph => paragraph.trim())
    .filter(paragraph => paragraph.length > 0);
}

function TimingStats({ recipe }: { recipe: Recipe }) {
  const stats = [
    recipe.prepMinutes
      ? {
          label: strings.recipeDetail.prep,
          value: formatDuration(recipe.prepMinutes),
        }
      : null,
    recipe.cookMinutes
      ? {
          label: strings.recipeDetail.cook,
          value: formatDuration(recipe.cookMinutes),
        }
      : null,
    recipe.servings
      ? { label: strings.recipeDetail.serves, value: String(recipe.servings) }
      : null,
  ].filter(stat => stat !== null);

  if (stats.length === 0) return null;

  return (
    <View style={styles.stats}>
      {stats.map((stat, index) => (
        <View
          key={stat.label}
          style={[styles.stat, index > 0 && styles.statDivider]}
        >
          <Text style={styles.statLabel}>{stat.label}</Text>
          <Text style={styles.statValue}>{stat.value}</Text>
        </View>
      ))}
    </View>
  );
}

export default function RecipeDetailScreen({ navigation, route }: Props) {
  const { recipeId } = route.params;
  const {
    data: recipe,
    isPending,
    isError,
    error,
    refetch,
  } = useRecipe(recipeId);
  const deleteMutation = useDeleteRecipe(recipeId);

  const scrollRef = useRef<React.ComponentRef<typeof ScrollView>>(null);
  // onLayout reports y relative to the parent, so the card's offset inside
  // the content block and the content block's offset in the scroll view are
  // tracked separately and added up.
  const [contentY, setContentY] = useState(0);
  const [recipeCardY, setRecipeCardY] = useState(0);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: recipe
        ? () => (
            <Pressable
              testID="recipe-detail-edit-button"
              hitSlop={8}
              onPress={() =>
                navigation.navigate(Screens.RecipeForm, { recipeId })
              }
            >
              <Text style={styles.headerAction}>
                {strings.recipeDetail.edit}
              </Text>
            </Pressable>
          )
        : undefined,
    });
  }, [navigation, recipe, recipeId]);

  const confirmDelete = () => {
    if (!recipe) return;
    const message = [
      strings.recipeDetail.deleteMessage(recipe.title),
      ...(recipe.forks.length > 0
        ? [
            strings.recipeDetail.deleteKeepsForks(
              recipe.forks.map(f => f.title),
            ),
          ]
        : []),
    ].join(' ');
    Alert.alert(strings.recipeDetail.deleteTitle, message, [
      { text: strings.common.cancel, style: 'cancel' },
      {
        text: strings.recipeDetail.deleteConfirm,
        style: 'destructive',
        onPress: () =>
          deleteMutation.mutate(undefined, {
            onSuccess: () => navigation.goBack(),
            onError: err =>
              Alert.alert(strings.recipeDetail.deleteFailed, err.message),
          }),
      },
    ]);
  };

  if (isPending) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (isError) {
    const notFound = error instanceof RecipesError && error.status === 404;
    return (
      <View style={styles.center}>
        <Text testID="recipe-detail-error-text" style={styles.errorText}>
          {notFound ? strings.recipeDetail.notFound : error.message}
        </Text>
        {notFound ? null : (
          <Pressable style={styles.retryButton} onPress={() => refetch()}>
            <Text style={styles.retryText}>{strings.common.tryAgain}</Text>
          </Pressable>
        )}
      </View>
    );
  }

  const paragraphs = storyParagraphs(recipe.story);
  const steps = splitLines(recipe.instructions);
  let stepNumber = 0;

  return (
    <ScrollView
      ref={scrollRef}
      testID="recipe-detail-scroll"
      style={styles.screen}
    >
      {recipe.imageUrl ? (
        <Image
          source={{ uri: recipe.imageUrl }}
          style={styles.hero}
          resizeMode="cover"
          accessibilityIgnoresInvertColors
        />
      ) : null}

      <View
        style={styles.content}
        onLayout={event => setContentY(event.nativeEvent.layout.y)}
      >
        <Text style={styles.kicker}>
          {formatPostedDate(recipe.createdAt).toUpperCase()}
        </Text>
        <Text testID="recipe-detail-title" style={styles.title}>
          {recipe.title}
        </Text>
        {recipe.source ? <Source source={recipe.source} /> : null}
        {recipe.forkedFrom ? (
          <Pressable
            testID="recipe-detail-forked-from-link"
            accessibilityRole="link"
            style={styles.forkedFrom}
            onPress={() => openRecipe(navigation, recipe.forkedFrom!.id)}
          >
            <Text style={styles.forkedFromText}>
              {strings.recipeDetail.forkedFrom(
                recipe.forkedFrom.title,
                formatShortDate(recipe.forkedFrom.madeAt),
              )}{' '}
              ›
            </Text>
          </Pressable>
        ) : null}

        <TimingStats recipe={recipe} />

        {paragraphs.length > 0 ? (
          <Pressable
            testID="recipe-detail-jump-button"
            style={styles.jumpButton}
            onPress={() =>
              scrollRef.current?.scrollTo({
                y: contentY + recipeCardY - 16,
                animated: true,
              })
            }
          >
            <Text style={styles.jumpButtonText}>
              {strings.recipeDetail.jumpToRecipe}
            </Text>
          </Pressable>
        ) : null}

        {paragraphs.map((paragraph, index) => (
          <Text
            key={index}
            style={[styles.paragraph, index === 0 && styles.leadParagraph]}
          >
            {paragraph}
          </Text>
        ))}

        <View
          testID="recipe-detail-card"
          style={styles.recipeCard}
          onLayout={event => setRecipeCardY(event.nativeEvent.layout.y)}
        >
          <Text style={styles.kicker}>{strings.recipeDetail.recipeKicker}</Text>
          <Text style={styles.cardTitle}>{recipe.title}</Text>

          <Pressable
            testID="recipe-detail-start-cooking-button"
            accessibilityRole="button"
            style={styles.startCookingButton}
            onPress={() => navigation.navigate(Screens.Cooking, { recipeId })}
          >
            <Text style={styles.startCookingText}>
              {strings.recipeDetail.startCooking}
            </Text>
          </Pressable>

          <Text style={styles.sectionHeading}>
            {strings.recipeDetail.ingredients}
          </Text>
          {recipe.ingredients.map((ingredient, index) =>
            isHeadingLine(ingredient) ? (
              <Text
                key={index}
                testID={`recipe-detail-ingredient-heading-${index}`}
                accessibilityRole="header"
                style={styles.lineHeading}
              >
                {headingText(ingredient)}
              </Text>
            ) : (
              <View key={index} style={styles.ingredientRow}>
                <View style={styles.bullet} />
                <Text style={styles.ingredientText}>{ingredient}</Text>
              </View>
            ),
          )}

          <Text style={styles.sectionHeading}>
            {strings.recipeDetail.instructions}
          </Text>
          {steps.map((step, index) => {
            if (isHeadingLine(step)) {
              return (
                <Text
                  key={index}
                  testID={`recipe-detail-step-heading-${index}`}
                  accessibilityRole="header"
                  style={styles.lineHeading}
                >
                  {headingText(step)}
                </Text>
              );
            }
            // Numbers run on across sections: headings get none.
            stepNumber += 1;
            return (
              <View key={index} style={styles.stepRow}>
                <View style={styles.stepNumber}>
                  <Text
                    testID={`recipe-detail-step-number-${index}`}
                    style={styles.stepNumberText}
                  >
                    {stepNumber}
                  </Text>
                </View>
                <Text style={styles.stepText}>{step}</Text>
              </View>
            );
          })}
        </View>

        <BalanceCard
          lines={recipe.lines}
          onMorePress={group =>
            navigation.navigate(Screens.Ingredients, { group })
          }
        />

        {recipe.forks.length > 0 ? (
          <Versions
            forks={recipe.forks}
            onOpen={forkId =>
              navigation.push(Screens.RecipeDetail, { recipeId: forkId })
            }
          />
        ) : null}

        <AttemptHistory
          recipeId={recipeId}
          onOpenAttempt={attemptId =>
            navigation.navigate(Screens.AttemptDetail, { recipeId, attemptId })
          }
        />

        <Pressable
          testID="recipe-detail-delete-button"
          style={styles.deleteButton}
          onPress={confirmDelete}
          disabled={deleteMutation.isPending}
        >
          {deleteMutation.isPending ? (
            <ActivityIndicator color={colors.danger} />
          ) : (
            <Text style={styles.deleteText}>
              {strings.recipeDetail.deleteRecipe}
            </Text>
          )}
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: colors.paper,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: colors.paper,
  },
  errorText: {
    fontFamily: fonts.serif,
    fontSize: 17,
    color: colors.ink,
    textAlign: 'center',
  },
  retryButton: {
    marginTop: 16,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  retryText: {
    color: colors.accent,
    fontSize: 15,
    fontWeight: '600',
  },
  headerAction: {
    color: colors.accent,
    fontSize: 16,
  },
  hero: {
    width: '100%',
    aspectRatio: 4 / 3,
    backgroundColor: colors.placeholder,
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 48,
  },
  kicker: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.8,
    color: colors.accent,
  },
  title: {
    fontFamily: fonts.serif,
    fontSize: 32,
    lineHeight: 40,
    color: colors.ink,
    marginTop: 8,
  },
  forkedFrom: {
    alignSelf: 'flex-start',
    minHeight: 44,
    justifyContent: 'center',
  },
  sourceText: {
    fontSize: 16,
    color: colors.ink,
    marginTop: 6,
  },
  forkedFromText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.ink,
    textDecorationLine: 'underline',
  },
  versions: {
    marginTop: 32,
  },
  versionsKicker: {
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
  },
  versionRow: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
  },
  versionTitle: {
    flex: 1,
    fontFamily: fonts.serif,
    fontSize: 18,
    color: colors.ink,
  },
  versionChevron: {
    marginLeft: 8,
    fontSize: 22,
    color: colors.ink,
  },
  stats: {
    flexDirection: 'row',
    marginTop: 20,
    paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
  },
  stat: {
    flex: 1,
    alignItems: 'center',
  },
  statDivider: {
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
  },
  statLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.4,
    color: colors.inkMuted,
  },
  statValue: {
    fontFamily: fonts.serif,
    fontSize: 17,
    color: colors.ink,
    marginTop: 4,
  },
  jumpButton: {
    alignSelf: 'flex-start',
    marginTop: 20,
    marginBottom: 8,
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 999,
    backgroundColor: colors.accent,
  },
  jumpButtonText: {
    color: colors.card,
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  paragraph: {
    fontFamily: fonts.serif,
    fontSize: 17,
    lineHeight: 29,
    color: colors.ink,
    marginTop: 18,
  },
  leadParagraph: {
    fontSize: 19,
    lineHeight: 31,
  },
  recipeCard: {
    marginTop: 32,
    padding: 22,
    borderRadius: 18,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
  },
  cardTitle: {
    fontFamily: fonts.serif,
    fontSize: 24,
    lineHeight: 31,
    color: colors.ink,
    marginTop: 6,
  },
  startCookingButton: {
    minHeight: 56,
    marginTop: 18,
    borderRadius: 14,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  startCookingText: {
    color: colors.card,
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  sectionHeading: {
    fontFamily: fonts.serif,
    fontSize: 20,
    color: colors.ink,
    marginTop: 24,
    marginBottom: 10,
  },
  // A section inside ingredients or steps ("FOR THE CREAM").
  lineHeading: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    color: colors.ink,
    marginTop: 14,
    marginBottom: 6,
  },
  ingredientRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 7,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
  },
  bullet: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.accent,
    marginTop: 8,
    marginRight: 12,
  },
  ingredientText: {
    flex: 1,
    fontSize: 16,
    lineHeight: 22,
    color: colors.ink,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  stepNumber: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  stepNumberText: {
    color: colors.card,
    fontWeight: '700',
    fontSize: 14,
  },
  stepText: {
    flex: 1,
    fontSize: 16,
    lineHeight: 24,
    color: colors.ink,
    marginTop: 2,
  },
  deleteButton: {
    alignSelf: 'center',
    marginTop: 32,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  deleteText: {
    color: colors.danger,
    fontSize: 15,
    fontWeight: '600',
  },
});
