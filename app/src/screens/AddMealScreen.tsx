import { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useState } from 'react';
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
import { ImagePickerResponse } from 'react-native-image-picker';
import { Fullness, Meal, MealKind } from '../api/recipesClient';
import { FullnessPicker } from '../components/FullnessPicker';
import { NutrientDots } from '../components/NutrientDots';
import { useCreateMeal, useRecentSnacks } from '../hooks/useMeals';
import { AppStackParamList, Screens } from '../navigation/types';
import {
  firstMissing,
  NUTRIENTS,
  presentStates,
} from '../nutrients/nutrientStates';
import { PICKER_OPTIONS, picker } from '../photoPicker';
import { strings } from '../strings';
import { colors, fonts } from '../theme';

type Props = NativeStackScreenProps<AppStackParamList, Screens.AddMeal>;

type Photo = { uri: string; base64: string };

const DAY_MS = 24 * 60 * 60 * 1000;

const KINDS = [
  { kind: MealKind.Meal, testID: 'add-meal-kind-meal', label: 'meal' },
  { kind: MealKind.Snack, testID: 'add-meal-kind-snack', label: 'snack' },
] as const;

function firstPhoto(response: ImagePickerResponse): Photo | null {
  const asset = response.assets?.[0];
  return asset?.uri && asset.base64
    ? { uri: asset.uri, base64: asset.base64 }
    : null;
}

// A meal or snack eaten anywhere (a restaurant, a trip, leftovers), with a
// photo, what was in it and how full it kept you, all optional but one of
// photo or text. Nothing is counted: after saving, the dots show what
// it brought and one thing to add next time.
export default function AddMealScreen({ navigation }: Props) {
  const [kind, setKind] = useState(MealKind.Meal);
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [text, setText] = useState('');
  const [fullness, setFullness] = useState<Fullness | null>(null);
  const [yesterday, setYesterday] = useState(false);
  const [cameraError, setCameraError] = useState(false);
  const [saved, setSaved] = useState<Meal | null>(null);
  const createMeal = useCreateMeal();
  const snack = kind === MealKind.Snack;
  const { data: recentSnacks } = useRecentSnacks({ enabled: snack });

  const canSave = photo !== null || text.trim() !== '';

  const takePhoto = async () => {
    const response = await picker.launchCamera(PICKER_OPTIONS);
    if (response.didCancel) return;
    if (response.errorCode) {
      setCameraError(true);
      return;
    }
    setCameraError(false);
    setPhoto(firstPhoto(response) ?? photo);
  };

  const choosePhoto = async () => {
    const response = await picker.launchImageLibrary({
      ...PICKER_OPTIONS,
      selectionLimit: 1,
    });
    if (response.didCancel || response.errorCode) return;
    setCameraError(false);
    setPhoto(firstPhoto(response) ?? photo);
  };

  const save = () =>
    createMeal.mutate(
      {
        kind,
        text: text.trim() || null,
        fullness,
        ...(photo && { photo: photo.base64 }),
        // Yesterday: the same time of day, a day back; the day is what the
        // week view needs.
        ...(yesterday && {
          eatenAt: new Date(Date.now() - DAY_MS).toISOString(),
        }),
      },
      { onSuccess: setSaved },
    );

  if (saved) {
    return (
      <SavedMeal meal={saved} navigation={navigation} hasText={!!saved.text} />
    );
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.title}>{strings.addMeal.title}</Text>

      <View style={styles.segmented} accessibilityRole="radiogroup">
        {KINDS.map(option => {
          const selected = kind === option.kind;
          return (
            <Pressable
              key={option.kind}
              testID={option.testID}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              style={[styles.segment, selected && styles.segmentSelected]}
              onPress={() => setKind(option.kind)}
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

      {photo ? (
        <View style={styles.photoBox}>
          <Image
            testID="add-meal-photo"
            source={{ uri: photo.uri }}
            style={styles.photo}
            accessibilityLabel={strings.addMeal.photoLabel}
          />
          <Pressable
            testID="add-meal-photo-remove-button"
            accessibilityRole="button"
            accessibilityLabel={strings.addMeal.removePhoto}
            hitSlop={8}
            style={styles.remove}
            onPress={() => setPhoto(null)}
          >
            <Text style={styles.removeText}>✕</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.row}>
          <Pressable
            testID="add-meal-photo-button"
            accessibilityRole="button"
            style={[styles.secondaryButton, styles.flex]}
            onPress={takePhoto}
          >
            <Text style={styles.secondaryButtonText}>
              {strings.addMeal.takePhoto}
            </Text>
          </Pressable>
          <Pressable
            testID="add-meal-gallery-button"
            accessibilityRole="button"
            style={[styles.secondaryButton, styles.flex]}
            onPress={choosePhoto}
          >
            <Text style={styles.secondaryButtonText}>
              {strings.addMeal.choosePhoto}
            </Text>
          </Pressable>
        </View>
      )}
      {cameraError ? (
        <Text testID="add-meal-camera-error-text" style={styles.note}>
          {strings.addMeal.cameraError}
        </Text>
      ) : null}

      <View style={styles.field}>
        <Text style={styles.label}>
          {strings.addMeal.textLabel}{' '}
          <Text style={styles.optional}>{strings.addMeal.optional}</Text>
        </Text>
        <TextInput
          testID="add-meal-text-input"
          style={styles.input}
          value={text}
          onChangeText={setText}
          placeholder={strings.addMeal.textPlaceholder}
          placeholderTextColor={colors.placeholderText}
          multiline
          accessibilityLabel={strings.addMeal.textLabel}
        />
      </View>

      {snack && recentSnacks && recentSnacks.length > 0 ? (
        <View style={styles.field}>
          <Text style={styles.label}>{strings.addMeal.recentSnacks}</Text>
          <View style={styles.chips}>
            {recentSnacks.map((recent, index) => (
              <Pressable
                key={recent}
                testID={`add-meal-recent-${index}`}
                accessibilityRole="button"
                style={styles.chip}
                onPress={() => setText(recent)}
              >
                <Text style={styles.chipText}>{recent}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      <View style={styles.field}>
        <Text style={styles.label}>{strings.fullness.question}</Text>
        <FullnessPicker
          testIDPrefix="add-meal-fullness"
          value={fullness}
          onChange={setFullness}
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>{strings.addMeal.when}</Text>
        <View style={styles.row}>
          {[false, true].map(isYesterday => {
            const selected = yesterday === isYesterday;
            return (
              <Pressable
                key={String(isYesterday)}
                testID={`add-meal-when-${isYesterday ? 'yesterday' : 'today'}`}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                style={[styles.chip, selected && styles.chipSelected]}
                onPress={() => setYesterday(isYesterday)}
              >
                <Text
                  style={[styles.chipText, selected && styles.chipTextSelected]}
                >
                  {isYesterday
                    ? strings.addMeal.yesterday
                    : strings.addMeal.today}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {createMeal.isError ? (
        <Text
          testID="add-meal-error-text"
          style={styles.error}
          accessibilityLiveRegion="polite"
        >
          {strings.addMeal.saveFailed}
        </Text>
      ) : null}

      <Pressable
        testID="add-meal-save-button"
        accessibilityRole="button"
        accessibilityState={{ disabled: !canSave || createMeal.isPending }}
        disabled={!canSave || createMeal.isPending}
        style={[styles.primaryButton, !canSave && styles.disabled]}
        onPress={save}
      >
        {createMeal.isPending ? (
          <ActivityIndicator color={colors.card} />
        ) : (
          <Text style={styles.primaryButtonText}>{strings.addMeal.save}</Text>
        )}
      </Pressable>
      {canSave ? null : (
        <Text style={styles.note}>{strings.addMeal.needsSomething}</Text>
      )}
    </ScrollView>
  );
}

// After Save: the dots for what the meal brought and, if something's
// gray, one additive line with a way to see foods that have it.
function SavedMeal({
  meal,
  hasText,
  navigation,
}: {
  meal: Meal;
  hasText: boolean;
  navigation: Props['navigation'];
}) {
  const words = (list: typeof NUTRIENTS) =>
    list.map(n => strings.ingredients.groups[n]);
  const has = NUTRIENTS.filter(n => meal.nutrients.includes(n));
  const missing = firstMissing(meal.nutrients);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      <View testID="add-meal-result" style={styles.result}>
        <Text style={styles.title}>{strings.addMeal.saved}</Text>
        <View style={styles.resultTop}>
          <NutrientDots
            testID="add-meal-nutrient-dots"
            states={presentStates(meal.nutrients)}
            accessibilityLabel={strings.balance.hasLabel(
              words(has),
              words(NUTRIENTS.filter(n => !has.includes(n))),
            )}
          />
          <Text testID="add-meal-result-text" style={styles.resultText}>
            {hasText
              ? missing
                ? strings.addMeal.inThis(words(has))
                : strings.balance.balanced
              : strings.addMeal.photoOnly}
          </Text>
        </View>
        {hasText && missing ? (
          <>
            <Text style={styles.resultText}>
              {strings.addMeal.addNextTime[missing]}
            </Text>
            <Pressable
              testID="add-meal-more-link"
              accessibilityRole="link"
              style={styles.link}
              onPress={() =>
                navigation.navigate(Screens.Ingredients, { group: missing })
              }
            >
              <Text style={styles.linkText}>
                {strings.balance.more[missing]}
              </Text>
            </Pressable>
          </>
        ) : null}
      </View>
      <Pressable
        testID="add-meal-done-button"
        accessibilityRole="button"
        style={styles.primaryButton}
        onPress={() => navigation.goBack()}
      >
        <Text style={styles.primaryButtonText}>{strings.addMeal.done}</Text>
      </Pressable>
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
    gap: 18,
  },
  title: {
    fontFamily: fonts.serif,
    fontSize: 30,
    lineHeight: 37,
    color: colors.ink,
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
  photoBox: {
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: colors.placeholder,
    aspectRatio: 4 / 3,
  },
  photo: {
    width: '100%',
    height: '100%',
  },
  // 44pt touch target around a small ✕ in the corner.
  remove: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 44,
    height: 44,
    alignItems: 'flex-end',
    padding: 6,
  },
  removeText: {
    width: 26,
    height: 26,
    borderRadius: 13,
    overflow: 'hidden',
    textAlign: 'center',
    lineHeight: 26,
    fontSize: 14,
    color: colors.card,
    backgroundColor: 'rgba(43, 36, 32, 0.7)',
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  flex: {
    flexGrow: 1,
  },
  field: {
    gap: 8,
  },
  label: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.ink,
  },
  optional: {
    fontWeight: '400',
    color: colors.inkMuted,
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
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
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
  secondaryButton: {
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: 999,
    minHeight: 44,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    color: colors.accent,
    fontSize: 15,
    fontWeight: '700',
  },
  primaryButton: {
    backgroundColor: colors.accent,
    borderRadius: 999,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    color: colors.card,
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  disabled: {
    opacity: 0.4,
  },
  note: {
    fontSize: 13,
    lineHeight: 19,
    color: colors.inkMuted,
  },
  error: {
    color: colors.danger,
  },
  result: {
    gap: 14,
  },
  resultTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  resultText: {
    flexShrink: 1,
    fontFamily: fonts.serif,
    fontSize: 18,
    lineHeight: 25,
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
