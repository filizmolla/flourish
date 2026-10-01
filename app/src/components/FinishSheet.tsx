import React, { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Enjoyment, Fullness } from '../api/recipesClient';
import { PICKER_OPTIONS, picker } from '../photoPicker';
import { strings } from '../strings';
import { EnjoymentPicker, FullnessPicker } from './FullnessPicker';
import { StarRating } from './StarRating';
import { colors, fonts } from '../theme';
import { formatDuration } from '../utils/recipeFormat';

export type FinishValues = {
  durationMinutes: number | null;
  rating: number | null;
  fullness: Fullness | null;
  enjoyment: Enjoyment | null;
  // What came out, in base64; null when no photo was taken.
  photo: string | null;
  notes: string;
};

type Photo = { uri: string; base64: string };

type Props = {
  date: string; // "September 24, 2026"
  durationMinutes: number; // from the cooking clock
  recipeMinutes: number | null; // prep + cook, when the recipe has them
  notes: string; // prefilled from cooking mode
  changeSummary: string | null; // "You changed 1 ingredient."
  saving: boolean;
  error: string | null;
  onSave: (values: FinishValues) => void;
  onDiscard: () => void;
  onClose: () => void; // back to cooking
};

// Bottom sheet that turns this cooking session into an attempt.
export default function FinishSheet({
  date,
  durationMinutes,
  recipeMinutes,
  notes: initialNotes,
  changeSummary,
  saving,
  error,
  onSave,
  onDiscard,
  onClose,
}: Props) {
  const [rating, setRating] = useState<number | null>(null);
  const [fullness, setFullness] = useState<Fullness | null>(null);
  const [enjoyment, setEnjoyment] = useState<Enjoyment | null>(null);
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [cameraError, setCameraError] = useState(false);

  const keepPhoto = (
    response: Awaited<ReturnType<typeof picker.launchCamera>>,
  ) => {
    const asset = response.assets?.[0];
    if (asset?.uri && asset.base64) {
      setPhoto({ uri: asset.uri, base64: asset.base64 });
      setCameraError(false);
    }
  };
  const takePhoto = async () => {
    const response = await picker.launchCamera(PICKER_OPTIONS);
    if (response.didCancel) return;
    if (response.errorCode) {
      setCameraError(true);
      return;
    }
    keepPhoto(response);
  };
  const choosePhoto = async () => {
    const response = await picker.launchImageLibrary({
      ...PICKER_OPTIONS,
      selectionLimit: 1,
    });
    if (response.didCancel || response.errorCode) return;
    keepPhoto(response);
  };
  const [notes, setNotes] = useState(initialNotes);
  // Text while correcting the time; null while showing the clock's value.
  const [durationText, setDurationText] = useState<string | null>(null);

  const typed = durationText === null ? null : durationText.trim();
  const duration =
    typed === null
      ? durationMinutes
      : /^\d+$/.test(typed)
      ? Number(typed)
      : null;

  return (
    <Modal
      transparent
      animationType="slide"
      onRequestClose={saving ? undefined : onClose}
    >
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable
          style={styles.backdropTap}
          accessibilityRole="button"
          accessibilityLabel={strings.finish.backToCooking}
          onPress={saving ? undefined : onClose}
        />
        <View
          style={styles.sheet}
          accessibilityViewIsModal
          // VoiceOver hides the backdrop; the escape gesture closes instead.
          onAccessibilityEscape={saving ? undefined : onClose}
        >
          <View style={styles.handle} />
          <ScrollView keyboardShouldPersistTaps="handled">
            <Text accessibilityRole="header" style={styles.title}>
              {strings.finish.title}
            </Text>

            {durationText === null ? (
              <View style={styles.durationRow}>
                <Text testID="finish-duration-text" style={styles.meta}>
                  {strings.finish.took(date, formatDuration(durationMinutes))}
                </Text>
                <Pressable
                  testID="finish-duration-edit-button"
                  accessibilityRole="button"
                  accessibilityLabel={strings.finish.editDuration}
                  style={styles.editButton}
                  onPress={() => setDurationText(String(durationMinutes))}
                >
                  <Text style={styles.editIcon}>✎</Text>
                </Pressable>
              </View>
            ) : (
              <View style={styles.durationRow}>
                <TextInput
                  testID="finish-duration-input"
                  accessibilityLabel={strings.finish.durationLabel}
                  style={styles.durationInput}
                  value={durationText}
                  onChangeText={setDurationText}
                  keyboardType="number-pad"
                  autoFocus
                  selectTextOnFocus
                />
                <Text style={styles.meta}>{strings.finish.durationUnit}</Text>
              </View>
            )}
            {recipeMinutes ? (
              <Text style={styles.meta}>
                {strings.finish.recipeSays(formatDuration(recipeMinutes))}
              </Text>
            ) : null}

            <Text style={styles.label}>{strings.enjoyment.photoTitle}</Text>
            {photo ? (
              <View style={styles.photoBox}>
                <Image
                  testID="finish-photo"
                  source={{ uri: photo.uri }}
                  style={styles.photo}
                  accessibilityLabel={strings.enjoyment.photoLabel}
                />
                <Pressable
                  testID="finish-photo-remove-button"
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
              <View style={styles.photoRow}>
                <Pressable
                  testID="finish-take-photo-button"
                  accessibilityRole="button"
                  style={styles.photoButton}
                  onPress={takePhoto}
                >
                  <Text style={styles.photoButtonText}>
                    {strings.addMeal.takePhoto}
                  </Text>
                </Pressable>
                <Pressable
                  testID="finish-choose-photo-button"
                  accessibilityRole="button"
                  style={styles.photoButton}
                  onPress={choosePhoto}
                >
                  <Text style={styles.photoButtonText}>
                    {strings.addMeal.choosePhoto}
                  </Text>
                </Pressable>
              </View>
            )}
            {cameraError ? (
              <Text testID="finish-camera-error-text" style={styles.hint}>
                {strings.enjoyment.cameraError}
              </Text>
            ) : null}

            <View style={styles.stars}>
              <StarRating
                testIDPrefix="finish-rating-star"
                rating={rating}
                onChange={setRating}
              />
            </View>
            <Text style={styles.hint}>{strings.finish.rateLaterHint}</Text>

            <Text style={styles.label}>{strings.enjoyment.question}</Text>
            <EnjoymentPicker
              testIDPrefix="finish-enjoyment"
              value={enjoyment}
              onChange={setEnjoyment}
            />

            <Text style={styles.label}>{strings.fullness.question}</Text>
            <FullnessPicker
              testIDPrefix="finish-fullness"
              value={fullness}
              onChange={setFullness}
            />

            <Text style={styles.label}>{strings.finish.notesLabel}</Text>
            <TextInput
              testID="finish-notes-input"
              accessibilityLabel={strings.finish.notesLabel}
              style={styles.notesInput}
              value={notes}
              onChangeText={setNotes}
              placeholder={strings.finish.notesPlaceholder}
              placeholderTextColor={colors.placeholderText}
              multiline
            />

            {changeSummary ? (
              <Text testID="finish-changes-text" style={styles.meta}>
                {changeSummary}
              </Text>
            ) : null}

            {error ? (
              <Text testID="finish-error-text" style={styles.error}>
                {error}
              </Text>
            ) : null}

            <Pressable
              testID="finish-save-button"
              accessibilityRole="button"
              accessibilityState={{ disabled: saving, busy: saving }}
              disabled={saving}
              style={styles.saveButton}
              onPress={() =>
                onSave({
                  durationMinutes: duration,
                  rating,
                  fullness,
                  enjoyment,
                  photo: photo?.base64 ?? null,
                  notes,
                })
              }
            >
              {saving ? (
                <ActivityIndicator color={colors.card} />
              ) : (
                <Text style={styles.saveText}>{strings.finish.save}</Text>
              )}
            </Pressable>
            <Pressable
              testID="finish-discard-button"
              accessibilityRole="button"
              disabled={saving}
              style={styles.discardButton}
              onPress={onDiscard}
            >
              <Text style={styles.discardText}>{strings.finish.discard}</Text>
            </Pressable>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  photoRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
  },
  photoButton: {
    flex: 1,
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoButtonText: {
    color: colors.accent,
    fontSize: 15,
    fontWeight: '700',
  },
  photoBox: {
    marginTop: 8,
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
  title: {
    fontFamily: fonts.serif,
    fontSize: 26,
    lineHeight: 33,
    color: colors.ink,
  },
  durationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  meta: {
    fontSize: 16,
    lineHeight: 23,
    color: colors.ink,
  },
  editButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editIcon: {
    fontSize: 20,
    color: colors.ink,
  },
  durationInput: {
    minWidth: 80,
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.card,
    fontSize: 18,
    color: colors.ink,
  },
  stars: {
    alignItems: 'center',
    marginTop: 20,
  },
  hint: {
    marginTop: 4,
    marginBottom: 20,
    fontSize: 15,
    lineHeight: 21,
    color: colors.ink,
    textAlign: 'center',
  },
  label: {
    marginBottom: 8,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.8,
    color: colors.ink,
  },
  notesInput: {
    minHeight: 100,
    marginBottom: 12,
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
  error: {
    marginTop: 8,
    fontSize: 15,
    color: colors.danger,
  },
  saveButton: {
    minHeight: 56,
    marginTop: 20,
    borderRadius: 14,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveText: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.card,
  },
  discardButton: {
    minHeight: 48,
    marginTop: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  discardText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.danger,
  },
});
