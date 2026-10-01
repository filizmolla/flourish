import { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  AttemptDetail,
  attemptPhotoUrl,
  Recipe,
  RecipesError,
} from '../api/recipesClient';
import { useAuth } from '../auth/AuthContext';
import {
  alignLines,
  LineChange,
  LineOp,
  LineOpType,
} from '../cooking/lineDiff';
import { LineKind } from '../cooking/cookingLines';
import { EnjoymentPicker, FullnessPicker } from '../components/FullnessPicker';
import { NutrientDots } from '../components/NutrientDots';
import { SAVED_VISIBLE_MS } from '../components/RatePromptCard';
import { StarRating, StarSize } from '../components/StarRating';
import { useAttempt, useUpdateAttempt } from '../hooks/useAttempts';
import { useRecipe } from '../hooks/useRecipes';
import { openRecipe } from '../navigation/openRecipe';
import { AppStackParamList, Screens } from '../navigation/types';
import {
  coveredNutrients,
  NUTRIENTS,
  recipeStates,
} from '../nutrients/nutrientStates';
import { headingText, isHeadingLine, splitLines } from '../recipes/recipeForm';
import { strings } from '../strings';
import { colors, fonts } from '../theme';
import {
  formatDuration,
  formatPostedDate,
  formatShortDate,
} from '../utils/recipeFormat';

type Props = NativeStackScreenProps<AppStackParamList, Screens.AttemptDetail>;

// A saved list is compared with the recipe as it is today, so later edits
// to the recipe show up as differences too. null means "same as today's
// recipe": a recipe edit writes the old lines into null snapshots first.
function ingredientOps(attempt: AttemptDetail, recipe: Recipe) {
  const base = recipe.ingredients;
  return alignLines(
    base,
    attempt.ingredients ? attempt.ingredients.map(line => line.text) : base,
  );
}

function stepOps(attempt: AttemptDetail, recipe: Recipe) {
  const base = splitLines(recipe.instructions);
  return alignLines(
    base,
    attempt.instructions === null ? base : splitLines(attempt.instructions),
  );
}

function onlyChanges(ops: LineOp[]) {
  return ops.filter((op): op is LineChange => op.type !== LineOpType.Same);
}

// Headings are read without their #.
function lineLabel(op: LineOp) {
  const text = headingText(op.text);
  if (op.type === LineOpType.Removed)
    return strings.attemptDetail.removedLine(text);
  if (op.type === LineOpType.Added)
    return strings.attemptDetail.addedLine(text);
  return text;
}

// The whole list as cooked that day: removed lines stay in place, struck
// through and muted; added lines get "+" and an accent bar. Steps are
// numbered as cooked, so a removed step has no number.
function FullLines({
  kind,
  title,
  ops,
}: {
  kind: LineKind;
  title: string;
  ops: LineOp[];
}) {
  let stepNumber = 0;
  return (
    <View style={styles.changeGroup}>
      <Text style={styles.changeTitle}>{title}</Text>
      {ops.map((op, index) => {
        const heading = isHeadingLine(op.text);
        const number =
          kind === LineKind.Step && op.type !== LineOpType.Removed && !heading
            ? ++stepNumber
            : null;
        return (
          <View
            key={index}
            testID={`attempt-detail-line-${kind}-${index}`}
            accessible
            accessibilityLabel={lineLabel(op)}
            style={[
              styles.versionLine,
              op.type === LineOpType.Added && styles.added,
            ]}
          >
            <Text style={styles.versionMark}>
              {op.type === LineOpType.Added ? '+' : ''}
            </Text>
            {kind === LineKind.Step ? (
              <Text style={styles.versionNumber}>{number ?? ''}</Text>
            ) : null}
            <Text
              style={[
                styles.versionText,
                op.type === LineOpType.Removed && styles.removedMuted,
                heading && styles.lineHeading,
              ]}
            >
              {heading ? headingText(op.text) : op.text}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

enum VersionView {
  Full = 'full',
  Changes = 'changes',
}

function ViewSwitch({
  view,
  onChange,
}: {
  view: VersionView;
  onChange: (view: VersionView) => void;
}) {
  const tabs = [
    { value: VersionView.Full, label: strings.attemptDetail.viewFull },
    { value: VersionView.Changes, label: strings.attemptDetail.viewChanges },
  ] as const;
  return (
    <View accessibilityRole="tablist" style={styles.switch}>
      {tabs.map(tab => {
        const selected = view === tab.value;
        return (
          <Pressable
            key={tab.value}
            testID={`attempt-detail-view-${tab.value}-tab`}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            style={[styles.switchTab, selected && styles.switchTabSelected]}
            onPress={() => onChange(tab.value)}
          >
            <Text
              style={[styles.switchText, selected && styles.switchTextSelected]}
            >
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// The attempt's version against today's recipe. hasChanges drives both the
// version card ("Cooked as the recipe") and whether it can be saved as a new
// recipe; the server applies the same rule to forks.
function compareWithRecipe(attempt: AttemptDetail, recipe: Recipe) {
  const ingredients = ingredientOps(attempt, recipe);
  const steps = stepOps(attempt, recipe);
  const ingredientChanges = onlyChanges(ingredients);
  const stepChanges = onlyChanges(steps);
  return {
    ingredients,
    steps,
    ingredientChanges,
    stepChanges,
    hasChanges: ingredientChanges.length > 0 || stepChanges.length > 0,
  };
}

function VersionCard({
  version,
}: {
  version: ReturnType<typeof compareWithRecipe>;
}) {
  const [view, setView] = useState<VersionView>(VersionView.Full);
  const { ingredients, steps, ingredientChanges, stepChanges, hasChanges } =
    version;

  return (
    <View testID="attempt-detail-version" style={styles.versionCard}>
      <View style={styles.versionHeader}>
        <Text style={styles.versionKicker}>
          {strings.attemptDetail.versionKicker}
        </Text>
        {hasChanges ? <ViewSwitch view={view} onChange={setView} /> : null}
      </View>
      {hasChanges ? null : (
        <Text testID="attempt-detail-unchanged-text" style={styles.unchanged}>
          {strings.attemptDetail.cookedAsRecipe}
        </Text>
      )}
      {hasChanges && view === VersionView.Changes ? (
        <>
          <ChangeList
            testIDPrefix="attempt-detail-ingredient-change"
            title={strings.attemptDetail.ingredients}
            changes={ingredientChanges}
          />
          <ChangeList
            testIDPrefix="attempt-detail-step-change"
            title={strings.attemptDetail.steps}
            changes={stepChanges}
          />
        </>
      ) : (
        <>
          <FullLines
            kind={LineKind.Ingredient}
            title={strings.attemptDetail.ingredients}
            ops={ingredients}
          />
          <FullLines
            kind={LineKind.Step}
            title={strings.attemptDetail.steps}
            ops={steps}
          />
        </>
      )}
    </View>
  );
}

function ChangeList({
  testIDPrefix,
  title,
  changes,
}: {
  testIDPrefix: string;
  title: string;
  changes: LineChange[];
}) {
  return (
    <View style={styles.changeGroup}>
      <Text style={styles.changeTitle}>{title}</Text>
      {changes.length === 0 ? (
        <Text style={styles.body}>{strings.attemptDetail.noChanges}</Text>
      ) : (
        changes.map((change, index) => (
          <Text
            key={index}
            testID={`${testIDPrefix}-${index}`}
            accessibilityLabel={
              change.type === LineOpType.Removed
                ? strings.attemptDetail.removedLine(change.text)
                : strings.attemptDetail.addedLine(change.text)
            }
            style={styles.body}
          >
            {change.type === LineOpType.Removed ? '  ' : '+ '}
            <Text style={change.type === LineOpType.Removed && styles.removed}>
              {change.text}
            </Text>
          </Text>
        ))
      )}
    </View>
  );
}

// The recipe's balance beside the date, as on Your week: what its linked
// lines bring. No linked lines, nothing to judge from: no dots.
function AttemptDots({ recipe }: { recipe: Recipe }) {
  if (!recipe.lines.some(line => line.ingredient)) return null;
  const covered = coveredNutrients(recipe.lines);
  const words = (list: typeof NUTRIENTS) =>
    list.map(n => strings.ingredients.groups[n]);
  return (
    <NutrientDots
      testID="attempt-detail-nutrient-dots"
      size="small"
      states={recipeStates(recipe.lines)}
      accessibilityLabel={strings.balance.hasLabel(
        words(NUTRIENTS.filter(n => covered.has(n))),
        words(NUTRIENTS.filter(n => !covered.has(n))),
      )}
    />
  );
}

// Unrated: a "Rate" link that opens the stars. Rated: the stars themselves,
// editable; tapping the current rating again clears it. Saves on each tap and
// shows "Saved ✓" for a moment, as the rate prompt card does.
function RatingEditor({ attempt }: { attempt: AttemptDetail }) {
  const update = useUpdateAttempt(attempt.recipeId, attempt.id);
  const [open, setOpen] = useState(false);
  // Bumped on each successful save, so a second save restarts the timer.
  const [savedCount, setSavedCount] = useState(0);
  const [showSaved, setShowSaved] = useState(false);

  useEffect(() => {
    if (savedCount === 0) return;
    setShowSaved(true);
    const timeout = setTimeout(() => setShowSaved(false), SAVED_VISIBLE_MS);
    return () => clearTimeout(timeout);
  }, [savedCount]);
  // Show the tapped rating while it saves, then the saved one, so the old
  // rating never flashes back before the cached attempt catches up.
  const rating =
    update.isPending && update.variables.rating !== undefined
      ? update.variables.rating
      : update.isSuccess
      ? update.data.rating
      : attempt.rating;

  if (rating === null && !open) {
    return (
      <Pressable
        testID="attempt-detail-rate-link"
        accessibilityRole="button"
        style={styles.rateLink}
        onPress={() => setOpen(true)}
      >
        <Text style={styles.rateLinkText}>{strings.attemptDetail.rate}</Text>
      </Pressable>
    );
  }

  return (
    <View>
      <View style={styles.starsRow}>
        <StarRating
          testIDPrefix="attempt-detail-rating-star"
          size={StarSize.Medium}
          rating={rating}
          disabled={update.isPending}
          onChange={value => {
            setShowSaved(false);
            update.mutate(
              { rating: value },
              { onSuccess: () => setSavedCount(count => count + 1) },
            );
          }}
        />
        {showSaved && rating !== null ? (
          <Text
            testID="attempt-detail-rating-saved-text"
            accessibilityLiveRegion="polite"
            style={styles.saved}
          >
            {strings.common.saved}
          </Text>
        ) : null}
      </View>
      {update.isError ? (
        <Text testID="attempt-detail-rating-error-text" style={styles.error}>
          {update.error.message}
        </Text>
      ) : null}
    </View>
  );
}

// "How did you feel after?" under the stars; saves on each tap, and tapping
// the chosen answer again clears it.
function FullnessEditor({ attempt }: { attempt: AttemptDetail }) {
  const update = useUpdateAttempt(attempt.recipeId, attempt.id);
  // The tapped answer while it saves, then the saved one (as the stars do).
  const fullness =
    update.isPending && update.variables.fullness !== undefined
      ? update.variables.fullness
      : update.isSuccess
      ? update.data.fullness
      : attempt.fullness;

  return (
    <View style={styles.fullness}>
      <Text style={styles.fullnessLabel}>{strings.fullness.question}</Text>
      <FullnessPicker
        testIDPrefix="attempt-detail-fullness"
        value={fullness}
        disabled={update.isPending}
        onChange={value => update.mutate({ fullness: value })}
      />
      {update.isError ? (
        <Text testID="attempt-detail-fullness-error-text" style={styles.error}>
          {update.error.message}
        </Text>
      ) : null}
    </View>
  );
}

// "Was it enjoyable to make?" beside fullness; the same save-on-tap.
function EnjoymentEditor({ attempt }: { attempt: AttemptDetail }) {
  const update = useUpdateAttempt(attempt.recipeId, attempt.id);
  const enjoyment =
    update.isPending && update.variables.enjoyment !== undefined
      ? update.variables.enjoyment
      : update.isSuccess
      ? update.data.enjoyment
      : attempt.enjoyment;

  return (
    <View style={styles.fullness}>
      <Text style={styles.fullnessLabel}>{strings.enjoyment.question}</Text>
      <EnjoymentPicker
        testIDPrefix="attempt-detail-enjoyment"
        value={enjoyment}
        disabled={update.isPending}
        onChange={value => update.mutate({ enjoyment: value })}
      />
      {update.isError ? (
        <Text testID="attempt-detail-enjoyment-error-text" style={styles.error}>
          {update.error.message}
        </Text>
      ) : null}
    </View>
  );
}

function NotesEditor({ attempt }: { attempt: AttemptDetail }) {
  const update = useUpdateAttempt(attempt.recipeId, attempt.id);
  // The text being edited; null while showing the saved notes.
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <>
      <View style={styles.kickerRow}>
        <Text style={[styles.kicker, styles.kickerInRow]}>
          {strings.attemptDetail.notesKicker}
        </Text>
        {draft === null ? (
          <Pressable
            testID="attempt-detail-notes-edit-button"
            accessibilityRole="button"
            accessibilityLabel={strings.attemptDetail.editNotes}
            style={styles.iconButton}
            onPress={() => {
              update.reset();
              setDraft(attempt.notes ?? '');
            }}
          >
            <Text style={styles.editIcon}>✎</Text>
          </Pressable>
        ) : null}
      </View>
      {draft === null ? (
        <Text testID="attempt-detail-notes" style={styles.body}>
          {attempt.notes ?? strings.attemptDetail.noNotes}
        </Text>
      ) : (
        <>
          <TextInput
            testID="attempt-detail-notes-input"
            accessibilityLabel={strings.attemptDetail.notesLabel}
            style={styles.notesInput}
            value={draft}
            onChangeText={setDraft}
            placeholder={strings.attemptDetail.notesPlaceholder}
            placeholderTextColor={colors.placeholderText}
            editable={!update.isPending}
            multiline
            autoFocus
          />
          {update.isError ? (
            <Text testID="attempt-detail-notes-error-text" style={styles.error}>
              {update.error.message}
            </Text>
          ) : null}
          <View style={styles.notesButtons}>
            <Pressable
              testID="attempt-detail-notes-cancel-button"
              accessibilityRole="button"
              disabled={update.isPending}
              style={styles.notesCancel}
              onPress={() => setDraft(null)}
            >
              <Text style={styles.notesCancelText}>
                {strings.common.cancel}
              </Text>
            </Pressable>
            <Pressable
              testID="attempt-detail-notes-save-button"
              accessibilityRole="button"
              accessibilityState={{
                disabled: update.isPending,
                busy: update.isPending,
              }}
              disabled={update.isPending}
              style={styles.notesSave}
              onPress={() =>
                // The server stores a blank note as "no notes".
                update.mutate(
                  { notes: draft },
                  { onSuccess: () => setDraft(null) },
                )
              }
            >
              {update.isPending ? (
                <ActivityIndicator color={colors.card} />
              ) : (
                <Text style={styles.notesSaveText}>
                  {strings.attemptDetail.saveNotes}
                </Text>
              )}
            </Pressable>
          </View>
        </>
      )}
    </>
  );
}

export default function AttemptDetailScreen({ navigation, route }: Props) {
  const { recipeId, attemptId } = route.params;
  const attemptQuery = useAttempt(attemptId);
  const recipeQuery = useRecipe(recipeId);
  const { token } = useAuth();

  if (attemptQuery.isPending || recipeQuery.isPending) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  const error = attemptQuery.error ?? recipeQuery.error;
  if (error) {
    const notFound = error instanceof RecipesError && error.status === 404;
    return (
      <View style={styles.center}>
        <Text testID="attempt-detail-error-text" style={styles.errorText}>
          {notFound ? strings.attemptDetail.notFound : error.message}
        </Text>
      </View>
    );
  }

  const attempt = attemptQuery.data!;
  const recipe = recipeQuery.data!;
  const meta = [
    formatPostedDate(attempt.madeAt),
    attempt.durationMinutes ? formatDuration(attempt.durationMinutes) : null,
  ]
    .filter(item => item !== null)
    .join(' · ');
  const basedOn = attempt.basedOnAttempt;
  const version = compareWithRecipe(attempt, recipe);

  return (
    <ScrollView testID="attempt-detail-scroll" style={styles.screen}>
      {attempt.hasPhoto ? (
        <Image
          testID="attempt-detail-photo"
          source={{
            uri: attemptPhotoUrl(attempt.id),
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          }}
          style={styles.photo}
          resizeMode="cover"
          accessibilityLabel={strings.enjoyment.photoLabel}
          accessibilityIgnoresInvertColors
        />
      ) : null}
      <View style={styles.content}>
        <Pressable
          testID="attempt-detail-recipe-link"
          accessibilityRole="link"
          accessibilityLabel={strings.attemptDetail.openRecipe(recipe.title)}
          onPress={() => openRecipe(navigation, recipeId)}
          style={styles.titleRow}
        >
          {/* Sibling Texts, not nested: on Android a nested Text has no view
              of its own, so its testID would never reach Detox. */}
          <Text
            testID="attempt-detail-title"
            style={[styles.title, styles.titleText]}
          >
            {recipe.title}
          </Text>
          <Text style={[styles.title, styles.titleChevron]}>›</Text>
        </Pressable>
        <View style={styles.metaRow}>
          <Text testID="attempt-detail-meta" style={styles.meta}>
            {meta}
          </Text>
          <AttemptDots recipe={recipe} />
        </View>

        {basedOn ? (
          <Pressable
            testID="attempt-detail-based-on-link"
            accessibilityRole="link"
            style={styles.basedOn}
            onPress={() =>
              navigation.push(Screens.AttemptDetail, {
                recipeId,
                attemptId: basedOn.id,
              })
            }
          >
            <Text style={styles.basedOnText}>
              {strings.attemptDetail.basedOn(formatShortDate(basedOn.madeAt))} ›
            </Text>
          </Pressable>
        ) : null}

        <NotesEditor attempt={attempt} />

        <VersionCard version={version} />

        {/* How it went, after what was cooked: the stars and the chips. */}
        <View style={styles.feedback}>
          <RatingEditor attempt={attempt} />
          <EnjoymentEditor attempt={attempt} />
          <FullnessEditor attempt={attempt} />
        </View>

        <Pressable
          testID="attempt-detail-cook-again-button"
          accessibilityRole="button"
          style={styles.cookAgainButton}
          onPress={() =>
            navigation.navigate(Screens.Cooking, {
              recipeId,
              fromAttemptId: attempt.id,
            })
          }
        >
          <Text style={styles.cookAgainText}>
            {strings.attemptDetail.cookAgain}
          </Text>
        </Pressable>

        {/* An unchanged version would only copy the recipe; an existing
            fork keeps its link either way. */}
        {attempt.fork ? (
          <Pressable
            testID="attempt-detail-fork-link"
            accessibilityRole="link"
            style={styles.forkLink}
            onPress={() =>
              navigation.push(Screens.RecipeDetail, {
                recipeId: attempt.fork!.id,
              })
            }
          >
            <Text style={styles.forkLinkText}>
              {strings.attemptDetail.savedAs(attempt.fork.title)} ›
            </Text>
          </Pressable>
        ) : version.hasChanges ? (
          <Pressable
            testID="attempt-detail-fork-button"
            accessibilityRole="button"
            style={styles.forkButton}
            onPress={() =>
              navigation.navigate(Screens.RecipeForm, {
                forkFrom: { recipeId, attemptId: attempt.id },
              })
            }
          >
            <Text style={styles.forkButtonText}>
              {strings.attemptDetail.saveAsRecipe}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  // What came out, full width above the title, like a recipe's hero image.
  photo: {
    width: '100%',
    aspectRatio: 4 / 3,
    backgroundColor: colors.placeholder,
  },
  feedback: {
    marginTop: 28,
  },
  fullness: {
    marginTop: 12,
    gap: 8,
  },
  fullnessLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.ink,
  },
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
  content: {
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 48,
  },
  // A size below the recipe's own title (32), so an attempt reads as one.
  title: {
    fontFamily: fonts.serif,
    fontSize: 26,
    lineHeight: 33,
    color: colors.ink,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: 12,
    marginTop: 8,
  },
  meta: {
    fontSize: 16,
    color: colors.ink,
  },
  starsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    columnGap: 12,
  },
  saved: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.ink,
  },
  rateLink: {
    minHeight: 44,
    justifyContent: 'center',
  },
  rateLinkText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.ink,
    textDecorationLine: 'underline',
  },
  error: {
    marginTop: 4,
    fontSize: 15,
    color: colors.danger,
  },
  kickerRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginTop: 28,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
  },
  kickerInRow: {
    flex: 1,
    marginTop: 0,
    borderBottomWidth: 0,
  },
  iconButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editIcon: {
    fontSize: 20,
    color: colors.ink,
  },
  notesInput: {
    minHeight: 100,
    marginTop: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.card,
    fontSize: 17,
    lineHeight: 24,
    color: colors.ink,
    textAlignVertical: 'top',
  },
  notesButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 12,
  },
  notesCancel: {
    minHeight: 44,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notesCancelText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.ink,
  },
  notesSave: {
    minHeight: 44,
    minWidth: 96,
    paddingHorizontal: 20,
    borderRadius: 12,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notesSaveText: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.card,
  },
  basedOn: {
    alignSelf: 'flex-start',
    minHeight: 44,
    justifyContent: 'center',
  },
  basedOnText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.ink,
    textDecorationLine: 'underline',
  },
  kicker: {
    marginTop: 28,
    paddingBottom: 8,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.8,
    color: colors.accent,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
  },
  body: {
    marginTop: 8,
    fontSize: 17,
    lineHeight: 25,
    color: colors.ink,
  },
  changeGroup: {
    marginTop: 12,
  },
  changeTitle: {
    fontFamily: fonts.serif,
    fontSize: 19,
    color: colors.ink,
  },
  cookAgainButton: {
    minHeight: 56,
    marginTop: 32,
    borderRadius: 14,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  cookAgainText: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.card,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    columnGap: 8,
  },
  // Long titles wrap instead of pushing the chevron off screen.
  titleText: {
    flexShrink: 1,
  },
  titleChevron: {
    color: colors.inkMuted,
  },
  forkButton: {
    minHeight: 56,
    marginTop: 12,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  forkButtonText: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.accent,
  },
  forkLink: {
    alignSelf: 'center',
    minHeight: 44,
    marginTop: 12,
    justifyContent: 'center',
  },
  forkLinkText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.ink,
    textDecorationLine: 'underline',
  },
  removed: {
    textDecorationLine: 'line-through',
  },
  removedMuted: {
    textDecorationLine: 'line-through',
    color: colors.inkMuted,
  },
  versionCard: {
    marginTop: 28,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 20,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    backgroundColor: colors.card,
  },
  versionHeader: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    rowGap: 8,
    columnGap: 12,
  },
  versionKicker: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.8,
    color: colors.accent,
  },
  unchanged: {
    marginTop: 8,
    fontSize: 16,
    color: colors.inkMuted,
  },
  switch: {
    flexDirection: 'row',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.hairline,
    overflow: 'hidden',
  },
  switchTab: {
    minHeight: 44,
    minWidth: 84,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  switchTabSelected: {
    backgroundColor: colors.accent,
  },
  switchText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.ink,
  },
  switchTextSelected: {
    color: colors.card,
  },
  versionLine: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 8,
    paddingLeft: 8,
    borderLeftWidth: 3,
    borderColor: 'transparent',
  },
  added: {
    borderColor: colors.accent,
  },
  versionMark: {
    width: 16,
    fontSize: 17,
    lineHeight: 25,
    fontWeight: '700',
    color: colors.accent,
  },
  versionNumber: {
    width: 24,
    fontSize: 17,
    lineHeight: 25,
    fontWeight: '700',
    color: colors.accent,
  },
  versionText: {
    flex: 1,
    fontSize: 17,
    lineHeight: 25,
    color: colors.ink,
  },
  // A section heading line ("FOR THE CREAM"): never numbered.
  lineHeading: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
});
