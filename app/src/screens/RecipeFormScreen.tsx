import { zodResolver } from '@hookform/resolvers/zod';
import { CommonActions, usePreventRemove } from '@react-navigation/native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { ReactNode, useLayoutEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextStyle,
  View,
} from 'react-native';
import { Recipe, RecipeInput, updateImport } from '../api/recipesClient';
import { useAuth } from '../auth/AuthContext';
import FormTextInput from '../components/FormTextInput';
import { useAttempt } from '../hooks/useAttempts';
import {
  useCreateRecipe,
  useRecipe,
  useUpdateRecipe,
} from '../hooks/useRecipes';
import { AppStackParamList, ImportQueue, Screens } from '../navigation/types';
import {
  emptyRecipeForm,
  fromParsedRecipe,
  RecipeFormValues,
  recipeFormSchema,
  toForkFormValues,
  toFormValues,
  toRecipeInput,
} from '../recipes/recipeForm';
import { strings } from '../strings';
import { colors, fonts } from '../theme';

type Props = NativeStackScreenProps<AppStackParamList, Screens.RecipeForm>;

type RecipeFormProps = {
  initialValues: RecipeFormValues;
  titlePlaceholder?: string;
  submitLabel: string;
  onSubmit: (input: RecipeInput) => Promise<unknown>;
  error: string | null;
  // Above the first field and under the save button (photo import).
  header?: ReactNode;
  footer?: ReactNode;
};

function Label({ children, hint }: { children: string; hint?: string }) {
  return (
    <View style={styles.labelRow}>
      <Text style={styles.label}>{children}</Text>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

function RecipeForm({
  initialValues,
  titlePlaceholder = strings.recipeForm.titlePlaceholder,
  submitLabel,
  onSubmit,
  error,
  header,
  footer,
}: RecipeFormProps) {
  const {
    control,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<RecipeFormValues>({
    defaultValues: initialValues,
    resolver: zodResolver(recipeFormSchema),
    mode: 'onChange',
  });

  const submit = handleSubmit(async values => {
    // Errors surface through the `error` prop; swallowing here keeps the
    // form's values so the user can fix and retry.
    await onSubmit(toRecipeInput(values)).catch(() => {});
  });

  return (
    <ScrollView
      testID="recipe-form-scroll"
      style={styles.screen}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets
    >
      {header}
      <Label>{strings.recipeForm.titleLabel}</Label>
      <FormTextInput
        control={control}
        name="title"
        testID="recipe-form-title-input"
        errorTestID="recipe-form-title-error-text"
        placeholder={titlePlaceholder}
        inputStyle={[styles.input, styles.titleInput]}
        placeholderTextColor={colors.placeholderText}
      />

      <Label hint={strings.recipeForm.optional}>
        {strings.recipeForm.sourceLabel}
      </Label>
      <FormTextInput
        control={control}
        name="source"
        testID="recipe-form-source-input"
        errorTestID="recipe-form-source-error-text"
        placeholder={strings.recipeForm.sourcePlaceholder}
        autoCapitalize="none"
        autoCorrect={false}
        inputStyle={styles.input}
        placeholderTextColor={colors.placeholderText}
      />

      <Label hint={strings.recipeForm.optional}>
        {strings.recipeForm.photoLabel}
      </Label>
      <FormTextInput
        control={control}
        name="imageUrl"
        testID="recipe-form-image-url-input"
        errorTestID="recipe-form-image-url-error-text"
        placeholder={strings.recipeForm.photoPlaceholder}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        inputStyle={styles.input}
        placeholderTextColor={colors.placeholderText}
      />

      <Label hint={strings.recipeForm.storyHint}>
        {strings.recipeForm.storyLabel}
      </Label>
      <FormTextInput
        control={control}
        name="story"
        testID="recipe-form-story-input"
        errorTestID="recipe-form-story-error-text"
        placeholder={strings.recipeForm.storyPlaceholder}
        multiline
        textAlignVertical="top"
        inputStyle={[styles.input, styles.storyInput]}
        placeholderTextColor={colors.placeholderText}
      />

      <View style={styles.timingRow}>
        {(
          [
            [
              'prepMinutes',
              strings.recipeForm.prepLabel,
              'recipe-form-prep-input',
            ],
            [
              'cookMinutes',
              strings.recipeForm.cookLabel,
              'recipe-form-cook-input',
            ],
            [
              'servings',
              strings.recipeForm.servesLabel,
              'recipe-form-servings-input',
            ],
          ] as const
        ).map(([name, label, testID]) => (
          <View key={name} style={styles.timingField}>
            <Label>{label}</Label>
            <FormTextInput
              control={control}
              name={name}
              testID={testID}
              errorTestID={`${testID.replace(/-input$/, '')}-error-text`}
              placeholder="–"
              keyboardType="number-pad"
              inputStyle={styles.input}
              placeholderTextColor={colors.placeholderText}
            />
          </View>
        ))}
      </View>

      <Label hint={strings.recipeForm.ingredientsHint}>
        {strings.recipeForm.ingredientsLabel}
      </Label>
      <Text testID="recipe-form-ingredients-hint" style={styles.sectionHint}>
        {strings.recipeForm.sectionHint}
      </Text>
      <FormTextInput
        control={control}
        name="ingredients"
        testID="recipe-form-ingredients-input"
        errorTestID="recipe-form-ingredients-error-text"
        placeholder={strings.recipeForm.ingredientsPlaceholder}
        multiline
        textAlignVertical="top"
        inputStyle={[styles.input, styles.listInput]}
        placeholderTextColor={colors.placeholderText}
      />

      <Label hint={strings.recipeForm.instructionsHint}>
        {strings.recipeForm.instructionsLabel}
      </Label>
      <Text testID="recipe-form-instructions-hint" style={styles.sectionHint}>
        {strings.recipeForm.sectionHint}
      </Text>
      <FormTextInput
        control={control}
        name="instructions"
        testID="recipe-form-instructions-input"
        errorTestID="recipe-form-instructions-error-text"
        placeholder={strings.recipeForm.instructionsPlaceholder}
        multiline
        textAlignVertical="top"
        inputStyle={[styles.input, styles.listInput]}
        placeholderTextColor={colors.placeholderText}
      />

      {error ? (
        <Text testID="recipe-form-error-text" style={styles.error}>
          {error}
        </Text>
      ) : null}

      <Pressable
        testID="recipe-form-save-button"
        style={[styles.button, isSubmitting && styles.buttonDisabled]}
        onPress={() => submit()}
        disabled={isSubmitting}
      >
        {isSubmitting ? (
          <ActivityIndicator color={colors.card} />
        ) : (
          <Text style={styles.buttonText}>{submitLabel}</Text>
        )}
      </Pressable>
      {footer}
    </ScrollView>
  );
}

function CreateRecipe({ navigation }: Pick<Props, 'navigation'>) {
  const createMutation = useCreateRecipe();

  return (
    <RecipeForm
      initialValues={emptyRecipeForm}
      submitLabel={strings.recipeForm.saveNew}
      error={createMutation.error?.message ?? null}
      onSubmit={input =>
        createMutation.mutateAsync(input).then(recipe =>
          // Back from the new recipe returns to the list: the form and New
          // recipe (the photo screen it was opened from) both go.
          navigation.dispatch(state =>
            CommonActions.reset({
              ...state,
              index: 1,
              routes: [
                state.routes[0],
                { name: Screens.RecipeDetail, params: { recipeId: recipe.id } },
              ],
            }),
          ),
        )
      }
    />
  );
}

// "Save as new recipe" from an attempt: a new recipe prefilled with that
// version, linked back to it by the server.
function ForkRecipe({
  navigation,
  recipeId,
  attemptId,
}: Pick<Props, 'navigation'> & { recipeId: string; attemptId: string }) {
  const createMutation = useCreateRecipe();
  const recipeQuery = useRecipe(recipeId);
  const attemptQuery = useAttempt(attemptId);

  if (recipeQuery.isPending || attemptQuery.isPending) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }
  const error = recipeQuery.error ?? attemptQuery.error;
  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error.message}</Text>
      </View>
    );
  }

  const recipe = recipeQuery.data!;
  return (
    <RecipeForm
      initialValues={toForkFormValues(recipe, attemptQuery.data!)}
      titlePlaceholder={strings.recipeForm.forkTitlePlaceholder(recipe.title)}
      submitLabel={strings.recipeForm.saveNew}
      error={createMutation.error?.message ?? null}
      onSubmit={input =>
        createMutation
          .mutateAsync({ ...input, forkedFromAttemptId: attemptId })
          .then(fork =>
            // Replace the form so Back from the new recipe returns to the attempt.
            navigation.replace(Screens.RecipeDetail, { recipeId: fork.id }),
          )
      }
    />
  );
}

// One recipe read from photos, prefilled. Several recipes form a queue: each
// Save or Skip replaces this screen with the next one.
function ImportRecipe({
  navigation,
  queue,
}: Pick<Props, 'navigation'> & { queue: ImportQueue }) {
  const { token } = useAuth();
  const createMutation = useCreateRecipe();
  const [skipping, setSkipping] = useState(false);
  const [skipError, setSkipError] = useState<string | null>(null);
  const { importId, recipes, index, savedIds } = queue;
  const total = recipes.length;
  const isLast = index === total - 1;
  // Set before this screen navigates on its own, so the leave guard lets it go.
  const moving = useRef(false);

  // Once a recipe is saved, New recipe is gone from the stack (reading the
  // photos again would save duplicates), so leaving ends the import.
  usePreventRemove(savedIds.length > 0, ({ data }) => {
    if (moving.current) {
      navigation.dispatch(data.action);
      return;
    }
    Alert.alert(
      strings.recipeForm.stopImportingTitle,
      strings.recipeForm.stopImportingMessage,
      [
        { text: strings.recipeForm.keepGoing, style: 'cancel' },
        {
          text: strings.recipeForm.stop,
          style: 'destructive',
          onPress: () => {
            // Best effort: an import left open only affects analysis.
            updateImport(token!, importId, { closed: true }).catch(() => {});
            moving.current = true;
            navigation.popToTop();
          },
        },
      ],
    );
  });

  // The next recipe, or the end of the queue: one saved → its detail,
  // otherwise the list. After a save the stack is just the list and this form.
  const goOn = (saved: string[]) => {
    moving.current = true;
    if (!isLast) {
      const next = {
        name: Screens.RecipeForm,
        params: { fromImport: { ...queue, index: index + 1, savedIds: saved } },
      } as const;
      if (saved.length === 0) {
        // Nothing saved yet: Back still returns to New recipe.
        navigation.replace(next.name, next.params);
      } else {
        navigation.dispatch(state =>
          CommonActions.reset({
            ...state,
            index: 1,
            routes: [state.routes[0], next],
          }),
        );
      }
    } else if (saved.length === 1) {
      navigation.dispatch(state =>
        CommonActions.reset({
          ...state,
          index: 1,
          routes: [
            state.routes[0],
            { name: Screens.RecipeDetail, params: { recipeId: saved[0] } },
          ],
        }),
      );
    } else {
      navigation.popToTop();
    }
  };

  const skip = async () => {
    setSkipping(true);
    setSkipError(null);
    try {
      await updateImport(token!, importId, { reviewedCount: index + 1 });
      goOn(savedIds);
    } catch (err) {
      setSkipError((err as Error).message);
      setSkipping(false);
    }
  };

  return (
    <RecipeForm
      initialValues={fromParsedRecipe(recipes[index])}
      submitLabel={
        isLast ? strings.recipeForm.saveNew : strings.recipeForm.saveAndNext
      }
      // A failed skip shows over an older failed save; saving again clears it.
      error={skipError ?? createMutation.error?.message ?? null}
      onSubmit={input => {
        setSkipError(null);
        return createMutation
          .mutateAsync({ ...input, importId, importIndex: index })
          .then(recipe => goOn([...savedIds, recipe.id]));
      }}
      header={
        <View style={styles.importHeader}>
          {total > 1 ? (
            <Text
              testID="recipe-form-import-progress-text"
              style={styles.label}
            >
              {strings.recipeForm.importProgress(index + 1, total)}
            </Text>
          ) : null}
          <View testID="recipe-form-import-banner" style={styles.banner}>
            <Text style={styles.bannerText}>
              {strings.recipeForm.importBanner}
            </Text>
          </View>
        </View>
      }
      footer={
        total > 1 ? (
          <Pressable
            testID="recipe-form-import-skip-button"
            accessibilityRole="button"
            style={styles.skipButton}
            disabled={skipping || createMutation.isPending}
            onPress={skip}
          >
            {skipping ? (
              <ActivityIndicator color={colors.accent} />
            ) : (
              <Text style={styles.skipText}>{strings.recipeForm.skip}</Text>
            )}
          </Pressable>
        ) : null
      }
    />
  );
}

function EditRecipe({
  navigation,
  recipe,
}: Pick<Props, 'navigation'> & { recipe: Recipe }) {
  const updateMutation = useUpdateRecipe(recipe.id);

  return (
    <RecipeForm
      initialValues={toFormValues(recipe)}
      submitLabel={strings.recipeForm.saveChanges}
      error={updateMutation.error?.message ?? null}
      onSubmit={input =>
        updateMutation.mutateAsync(input).then(() => navigation.goBack())
      }
    />
  );
}

function LoadRecipeToEdit({
  navigation,
  recipeId,
}: Pick<Props, 'navigation'> & { recipeId: string }) {
  const { data: recipe, isPending, isError, error } = useRecipe(recipeId);

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
  // Mounted only once the recipe is loaded, so the form starts with its values.
  return <EditRecipe navigation={navigation} recipe={recipe} />;
}

export default function RecipeFormScreen({ navigation, route }: Props) {
  const recipeId = route.params?.recipeId;
  const forkFrom = route.params?.forkFrom;
  const fromImport = route.params?.fromImport;

  useLayoutEffect(() => {
    navigation.setOptions({
      title: recipeId
        ? strings.recipeForm.editTitle
        : forkFrom
        ? strings.recipeForm.forkTitle
        : strings.recipeForm.newTitle,
    });
  }, [navigation, recipeId, forkFrom]);

  if (recipeId) {
    return <LoadRecipeToEdit navigation={navigation} recipeId={recipeId} />;
  }
  if (fromImport) {
    return <ImportRecipe navigation={navigation} queue={fromImport} />;
  }
  if (forkFrom) {
    return (
      <ForkRecipe
        navigation={navigation}
        recipeId={forkFrom.recipeId}
        attemptId={forkFrom.attemptId}
      />
    );
  }
  return <CreateRecipe navigation={navigation} />;
}

const inputBase: TextStyle = {
  backgroundColor: colors.card,
  borderColor: colors.hairline,
  borderRadius: 12,
  color: colors.ink,
};

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
  container: {
    padding: 20,
    paddingBottom: 48,
    gap: 8,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  label: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.4,
    color: colors.accent,
    textTransform: 'uppercase',
  },
  hint: {
    fontFamily: fonts.serif,
    fontStyle: 'italic',
    fontSize: 13,
    color: colors.inkMuted,
  },
  sectionHint: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.inkMuted,
  },
  input: inputBase,
  titleInput: {
    fontFamily: fonts.serif,
    fontSize: 20,
  },
  storyInput: {
    fontFamily: fonts.serif,
    fontSize: 16,
    lineHeight: 24,
    minHeight: 160,
  },
  listInput: {
    fontSize: 16,
    lineHeight: 24,
    minHeight: 130,
  },
  timingRow: {
    flexDirection: 'row',
    gap: 12,
  },
  timingField: {
    flex: 1,
    gap: 8,
  },
  error: {
    color: colors.danger,
    marginTop: 8,
  },
  button: {
    marginTop: 24,
    backgroundColor: colors.accent,
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: colors.card,
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  importHeader: {
    gap: 8,
  },
  banner: {
    backgroundColor: colors.card,
    borderColor: colors.hairline,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
  },
  bannerText: {
    fontFamily: fonts.serif,
    fontStyle: 'italic',
    fontSize: 15,
    lineHeight: 22,
    color: colors.inkMuted,
  },
  skipButton: {
    minHeight: 44,
    marginTop: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  skipText: {
    color: colors.accent,
    fontSize: 15,
    fontWeight: '600',
  },
});
