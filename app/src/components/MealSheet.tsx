import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Meal, MealKind, MealUpdate, mealPhotoUrl } from '../api/recipesClient';
import { useDeleteMeal, useUpdateMeal } from '../hooks/useMeals';
import {
  firstMissing,
  NUTRIENTS,
  presentStates,
} from '../nutrients/nutrientStates';
import { strings } from '../strings';
import { colors, fonts } from '../theme';
import { FullnessPicker } from './FullnessPicker';
import { NutrientDots } from './NutrientDots';

// "13:10", local time.
function formatTime(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const KINDS = [
  { kind: MealKind.Meal, label: 'meal' },
  { kind: MealKind.Snack, label: 'snack' },
] as const;

// 0 = eaten today, 1 = yesterday, null = earlier (local days).
function daysAgo(date: Date): 0 | 1 | null {
  const day = new Date(date);
  day.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - day.getTime()) / 86_400_000);
  return diff === 0 || diff === 1 ? diff : null;
}

// The same time of day, moved to today or yesterday; never later than now.
function movedTo(date: Date, days: 0 | 1): Date {
  const target = new Date();
  target.setDate(target.getDate() - days);
  target.setHours(date.getHours(), date.getMinutes(), date.getSeconds(), 0);
  return target.getTime() > Date.now() ? new Date() : target;
}

// A meal opened from Your week: its photo, what was in it, what that
// brought, and how full it kept you (editable here). Edit changes the text,
// kind and day (the photo stays as taken); it can be deleted too.
export function MealSheet({
  meal,
  token,
  onClose,
}: {
  meal: Meal;
  token: string | null;
  onClose: () => void;
}) {
  const update = useUpdateMeal(meal.id);
  const remove = useDeleteMeal(meal.id);
  const busy = remove.isPending;
  // The last reply until the week reloads, so an edit shows at once.
  const shown = update.data ?? meal;
  const [editing, setEditing] = useState(false);
  const [draftText, setDraftText] = useState('');
  const [draftKind, setDraftKind] = useState(meal.kind);
  const [draftDay, setDraftDay] = useState<0 | 1 | null>(null);
  const [needsText, setNeedsText] = useState(false);

  // The tapped answer while it saves, then the saved one, so the old answer
  // never flashes back before the week reloads.
  const fullness =
    update.isPending && update.variables.fullness !== undefined
      ? update.variables.fullness
      : shown.fullness;

  const eatenAt = new Date(shown.eatenAt);
  const day = strings.week.dayNames[(eatenAt.getDay() + 6) % 7];
  const has = NUTRIENTS.filter(n => shown.nutrients.includes(n));
  const missing = firstMissing(shown.nutrients);
  const words = (list: typeof NUTRIENTS) =>
    list.map(n => strings.ingredients.groups[n]);

  const startEditing = () => {
    update.reset();
    setDraftText(shown.text ?? '');
    setDraftKind(shown.kind);
    setDraftDay(daysAgo(eatenAt));
    setNeedsText(false);
    setEditing(true);
  };

  const cancelEditing = () => {
    update.reset();
    setEditing(false);
  };

  // Sends only what changed; the server recomputes the nutrients from new text.
  const saveEdit = () => {
    const text = draftText.trim();
    if (!text && !shown.hasPhoto) {
      setNeedsText(true);
      return;
    }
    setNeedsText(false);
    const changes: MealUpdate = {};
    if (text !== (shown.text ?? '')) changes.text = text || null;
    if (draftKind !== shown.kind) changes.kind = draftKind;
    if (draftDay !== null && draftDay !== daysAgo(eatenAt)) {
      changes.eatenAt = movedTo(eatenAt, draftDay).toISOString();
    }
    if (Object.keys(changes).length === 0) {
      setEditing(false);
      return;
    }
    update.mutate(changes, { onSuccess: () => setEditing(false) });
  };

  const confirmDelete = () =>
    Alert.alert(
      strings.mealSheet.deleteTitle,
      strings.mealSheet.deleteMessage,
      [
        { text: strings.common.cancel, style: 'cancel' },
        {
          text: strings.mealSheet.deleteConfirm,
          style: 'destructive',
          onPress: () =>
            remove.mutate(undefined, {
              onSuccess: onClose,
              onError: err =>
                Alert.alert(strings.mealSheet.deleteFailed, err.message),
            }),
        },
      ],
    );

  return (
    <Modal
      transparent
      animationType="slide"
      onRequestClose={busy ? undefined : onClose}
    >
      <View style={styles.backdrop}>
        <Pressable
          style={styles.backdropTap}
          accessibilityRole="button"
          accessibilityLabel={strings.mealSheet.close}
          onPress={busy ? undefined : onClose}
        />
        <View
          testID="meal-sheet"
          style={styles.sheet}
          accessibilityViewIsModal
          onAccessibilityEscape={busy ? undefined : onClose}
        >
          <View style={styles.handle} />
          <ScrollView contentContainerStyle={styles.content}>
            {meal.hasPhoto ? (
              <Image
                testID="meal-sheet-photo"
                source={{
                  uri: mealPhotoUrl(meal.id),
                  headers: token ? { Authorization: `Bearer ${token}` } : {},
                }}
                style={styles.photo}
                resizeMode="cover"
                accessibilityIgnoresInvertColors
              />
            ) : null}

            <Text style={styles.kicker}>
              {strings.week.kinds[shown.kind].toUpperCase()}
            </Text>
            <Text
              testID="meal-sheet-when"
              accessibilityRole="header"
              style={styles.title}
            >
              {strings.mealSheet.when(day, formatTime(eatenAt))}
            </Text>
            {editing ? (
              <View style={styles.form}>
                <View style={styles.segmented} accessibilityRole="radiogroup">
                  {KINDS.map(option => {
                    const selected = draftKind === option.kind;
                    return (
                      <Pressable
                        key={option.kind}
                        testID={`meal-sheet-kind-${option.label}`}
                        accessibilityRole="radio"
                        accessibilityState={{ checked: selected }}
                        style={[
                          styles.segment,
                          selected && styles.segmentSelected,
                        ]}
                        onPress={() => setDraftKind(option.kind)}
                      >
                        <Text
                          style={[
                            styles.segmentText,
                            selected && styles.segmentTextSelected,
                          ]}
                        >
                          {strings.addMeal[option.label]}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                <Text style={styles.label}>{strings.addMeal.textLabel}</Text>
                <TextInput
                  testID="meal-sheet-text-input"
                  style={styles.input}
                  value={draftText}
                  onChangeText={setDraftText}
                  placeholder={strings.addMeal.textPlaceholder}
                  placeholderTextColor={colors.placeholderText}
                  multiline
                  accessibilityLabel={strings.addMeal.textLabel}
                />

                <Text style={styles.label}>{strings.addMeal.when}</Text>
                <View style={styles.row} accessibilityRole="radiogroup">
                  {([0, 1] as const).map(days => {
                    const selected = draftDay === days;
                    return (
                      <Pressable
                        key={days}
                        testID={`meal-sheet-day-${
                          days === 0 ? 'today' : 'yesterday'
                        }`}
                        accessibilityRole="radio"
                        accessibilityState={{ checked: selected }}
                        style={[styles.chip, selected && styles.chipSelected]}
                        onPress={() => setDraftDay(days)}
                      >
                        <Text
                          style={[
                            styles.chipText,
                            selected && styles.chipTextSelected,
                          ]}
                        >
                          {days === 0
                            ? strings.addMeal.today
                            : strings.addMeal.yesterday}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                {needsText || update.isError ? (
                  <Text
                    testID="meal-sheet-error-text"
                    style={styles.error}
                    accessibilityLiveRegion="polite"
                  >
                    {needsText
                      ? strings.mealSheet.needsText
                      : strings.mealSheet.saveFailed}
                  </Text>
                ) : null}

                <View style={styles.formButtons}>
                  <Pressable
                    testID="meal-sheet-cancel-button"
                    accessibilityRole="button"
                    style={[styles.editButton, styles.formButton]}
                    disabled={update.isPending}
                    onPress={cancelEditing}
                  >
                    <Text style={styles.editText}>{strings.common.cancel}</Text>
                  </Pressable>
                  <Pressable
                    testID="meal-sheet-save-button"
                    accessibilityRole="button"
                    accessibilityState={{ busy: update.isPending }}
                    style={[styles.saveButton, styles.formButton]}
                    disabled={update.isPending}
                    onPress={saveEdit}
                  >
                    {update.isPending ? (
                      <ActivityIndicator color={colors.card} />
                    ) : (
                      <Text style={styles.saveText}>
                        {strings.addMeal.save}
                      </Text>
                    )}
                  </Pressable>
                </View>
              </View>
            ) : (
              <>
                {shown.text ? (
                  <Text testID="meal-sheet-text" style={styles.text}>
                    {shown.text}
                  </Text>
                ) : null}

                <View style={styles.balance}>
                  <NutrientDots
                    testID="meal-sheet-nutrient-dots"
                    size="small"
                    states={presentStates(shown.nutrients)}
                    accessibilityLabel={strings.balance.hasLabel(
                      words(has),
                      words(NUTRIENTS.filter(n => !has.includes(n))),
                    )}
                  />
                  <Text
                    testID="meal-sheet-balance-text"
                    style={styles.balanceText}
                  >
                    {!shown.text
                      ? strings.addMeal.photoOnly
                      : missing
                      ? strings.addMeal.inThis(words(has))
                      : strings.balance.balanced}
                  </Text>
                </View>

                <Text style={styles.label}>{strings.fullness.question}</Text>
                <FullnessPicker
                  testIDPrefix="meal-sheet-fullness"
                  value={fullness}
                  disabled={update.isPending || busy}
                  onChange={value => update.mutate({ fullness: value })}
                />
                {update.isError ? (
                  <Text testID="meal-sheet-error-text" style={styles.error}>
                    {strings.mealSheet.saveFailed}
                  </Text>
                ) : null}

                <Pressable
                  testID="meal-sheet-edit-button"
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    styles.editButton,
                    pressed && styles.pressed,
                  ]}
                  disabled={busy || update.isPending}
                  onPress={startEditing}
                >
                  <Text style={styles.editText}>{strings.mealSheet.edit}</Text>
                </Pressable>

                <Pressable
                  testID="meal-sheet-delete-button"
                  accessibilityRole="button"
                  style={styles.deleteButton}
                  disabled={busy}
                  onPress={confirmDelete}
                >
                  {busy ? (
                    <ActivityIndicator color={colors.danger} />
                  ) : (
                    <Text style={styles.deleteText}>
                      {strings.mealSheet.delete}
                    </Text>
                  )}
                </Pressable>
              </>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(43, 36, 32, 0.55)',
  },
  backdropTap: {
    flex: 1,
  },
  sheet: {
    maxHeight: '90%',
    paddingHorizontal: 24,
    paddingTop: 10,
    paddingBottom: 32,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: colors.paper,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    marginBottom: 16,
    borderRadius: 2,
    backgroundColor: colors.hairline,
  },
  content: {
    gap: 10,
  },
  photo: {
    width: '100%',
    aspectRatio: 4 / 3,
    borderRadius: 14,
    backgroundColor: colors.placeholder,
    marginBottom: 6,
  },
  kicker: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.4,
    color: colors.accent,
  },
  title: {
    fontFamily: fonts.serif,
    fontSize: 24,
    lineHeight: 30,
    color: colors.ink,
  },
  text: {
    fontFamily: fonts.serif,
    fontSize: 17,
    lineHeight: 25,
    color: colors.ink,
  },
  balance: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 6,
  },
  balanceText: {
    flex: 1,
    fontSize: 15,
    lineHeight: 21,
    color: colors.inkMuted,
  },
  label: {
    marginTop: 6,
    fontSize: 15,
    fontWeight: '600',
    color: colors.ink,
  },
  error: {
    color: colors.danger,
  },
  pressed: {
    opacity: 0.85,
  },
  editButton: {
    minHeight: 48,
    marginTop: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editText: {
    color: colors.accent,
    fontSize: 15,
    fontWeight: '700',
  },
  form: {
    gap: 10,
  },
  segmented: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: 999,
    overflow: 'hidden',
  },
  segment: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentSelected: {
    backgroundColor: colors.accent,
  },
  segmentText: {
    color: colors.accent,
    fontSize: 15,
    fontWeight: '600',
  },
  segmentTextSelected: {
    color: colors.card,
    fontWeight: '700',
  },
  input: {
    minHeight: 64,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: colors.card,
    color: colors.ink,
    fontSize: 16,
    textAlignVertical: 'top',
  },
  row: {
    flexDirection: 'row',
    gap: 8,
  },
  chip: {
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
  formButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  formButton: {
    flex: 1,
  },
  saveButton: {
    minHeight: 48,
    marginTop: 12,
    borderRadius: 999,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveText: {
    color: colors.card,
    fontSize: 15,
    fontWeight: '700',
  },
  deleteButton: {
    minHeight: 44,
    marginTop: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteText: {
    color: colors.danger,
    fontSize: 15,
    fontWeight: '600',
  },
});
