import { usePreventRemove } from '@react-navigation/native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Asset, ImagePickerResponse } from 'react-native-image-picker';
import RevenueCatUI, { PAYWALL_RESULT } from 'react-native-purchases-ui';
import {
  FAKE_IMAGE_PICKER,
  PRO_ENTITLEMENT,
  PURCHASES_ENABLED,
} from '../config';
import { PICKER_OPTIONS, picker } from '../photoPicker';
import { parseImport } from '../api/recipesClient';
import { useAuth } from '../auth/AuthContext';
import { AppStackParamList, Screens } from '../navigation/types';
import { strings } from '../strings';
import { colors, fonts } from '../theme';

type Props = NativeStackScreenProps<AppStackParamList, Screens.Import>;

// Reading photos is the one Pro feature (its AI calls cost money per use).
// Detox can't drive RevenueCat's paywall any more than the system picker, so
// E2E runs with the fake picker skip the gate too.
const PRO_GATED = PURCHASES_ENABLED && !FAKE_IMAGE_PICKER;

const UNLOCKED = [
  PAYWALL_RESULT.NOT_PRESENTED,
  PAYWALL_RESULT.PURCHASED,
  PAYWALL_RESULT.RESTORED,
];

// Matches the server's limit (server/src/routes/imports.ts).
export const MAX_PHOTOS = 5;

// After this the reading line changes so a slow read doesn't look stuck.
const STILL_READING_MS = 10_000;

// key: the same picture can be added twice, so its uri isn't unique.
type Photo = { key: number; uri: string; base64: string };

let nextPhotoKey = 0;

// Where reading the photos stands; the last two show an error.
enum ReadStatus {
  Idle = 'idle',
  Reading = 'reading',
  NoRecipe = 'noRecipe',
  Failed = 'failed',
}

function toPhotos(response: ImagePickerResponse): Photo[] {
  return (response.assets ?? []).flatMap((asset: Asset) =>
    asset.uri && asset.base64
      ? [{ key: nextPhotoKey++, uri: asset.uri, base64: asset.base64 }]
      : [],
  );
}

export default function ImportScreen({ navigation }: Props) {
  const { token } = useAuth();
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [status, setStatus] = useState(ReadStatus.Idle);
  const [stillReading, setStillReading] = useState(false);
  const [cameraError, setCameraError] = useState(false);
  const [proError, setProError] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const reading = status === ReadStatus.Reading;
  const full = photos.length >= MAX_PHOTOS;

  const cancelReading = () => abortRef.current?.abort();

  // While reading everything is locked: the header's back arrow is hidden,
  // swipe-back is off, and Android back cancels the read instead of leaving.
  useLayoutEffect(() => {
    navigation.setOptions({
      headerBackVisible: !reading,
      gestureEnabled: !reading,
    });
  }, [navigation, reading]);

  useEffect(() => {
    if (!reading) return;
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        cancelReading();
        return true;
      },
    );
    const timeout = setTimeout(() => setStillReading(true), STILL_READING_MS);
    return () => {
      subscription.remove();
      clearTimeout(timeout);
    };
  }, [reading]);

  // Anything else that would remove the screen mid-read (none expected).
  usePreventRemove(reading, () => cancelReading());

  // Leaving the screen stops a read still in flight.
  useEffect(() => () => abortRef.current?.abort(), []);

  const addPhotos = (added: Photo[]) => {
    if (added.length === 0) return;
    setPhotos(current => [...current, ...added].slice(0, MAX_PHOTOS));
    setStatus(ReadStatus.Idle);
    setCameraError(false);
  };

  // Without Pro this shows the paywall; true once Pro is (or already was)
  // unlocked, so a purchase carries straight on to the picker.
  const hasPro = async () => {
    if (!PRO_GATED) return true;
    const result = await RevenueCatUI.presentPaywallIfNeeded({
      requiredEntitlementIdentifier: PRO_ENTITLEMENT,
    }).catch(() => PAYWALL_RESULT.ERROR);
    setProError(result === PAYWALL_RESULT.ERROR);
    return UNLOCKED.includes(result);
  };

  const takePhoto = async () => {
    if (!(await hasPro())) return;
    const response = await picker.launchCamera(PICKER_OPTIONS);
    if (response.didCancel) return;
    if (response.errorCode) {
      setCameraError(true);
      return;
    }
    addPhotos(toPhotos(response));
  };

  const pickPhotos = async () => {
    if (!(await hasPro())) return;
    const response = await picker.launchImageLibrary({
      ...PICKER_OPTIONS,
      selectionLimit: MAX_PHOTOS - photos.length,
    });
    // The system photo picker needs no permission, so a gallery error is
    // rare; like a cancel, it changes nothing.
    if (response.didCancel || response.errorCode) return;
    addPhotos(toPhotos(response));
  };

  const removePhoto = (index: number) => {
    setPhotos(current => current.filter((_, i) => i !== index));
    setStatus(ReadStatus.Idle);
    setCameraError(false);
  };

  const getRecipe = async () => {
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus(ReadStatus.Reading);
    setStillReading(false);
    try {
      const result = await parseImport(
        token!,
        photos.map(photo => photo.base64),
        controller.signal,
      );
      if (result.recipes.length === 0) {
        setStatus(ReadStatus.NoRecipe);
        return;
      }
      setStatus(ReadStatus.Idle);
      navigation.navigate(Screens.RecipeForm, {
        fromImport: {
          importId: result.importId,
          recipes: result.recipes,
          index: 0,
          savedIds: [],
        },
      });
    } catch {
      // Cancel keeps the photos and says nothing.
      setStatus(
        controller.signal.aborted ? ReadStatus.Idle : ReadStatus.Failed,
      );
    } finally {
      abortRef.current = null;
    }
  };

  const errorText =
    status === ReadStatus.NoRecipe
      ? strings.import.noRecipe
      : status === ReadStatus.Failed
      ? strings.import.readFailed
      : null;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      <Text style={styles.title}>{strings.recipeForm.newTitle}</Text>

      {photos.length === 0 ? (
        <Text style={styles.intro}>{strings.import.intro}</Text>
      ) : (
        <View style={reading && styles.dimmed}>
          <Text testID="import-photo-count-text" style={styles.kicker}>
            {strings.import.photoCount(photos.length, MAX_PHOTOS)}
          </Text>
          <View style={styles.thumbnails}>
            {photos.map((photo, index) => (
              <View
                key={photo.key}
                testID={`import-photo-${index}`}
                accessible
                accessibilityLabel={strings.import.photoLabel(
                  index + 1,
                  photos.length,
                )}
                style={styles.thumbnail}
              >
                <Image source={{ uri: photo.uri }} style={styles.image} />
                {reading ? null : (
                  <Pressable
                    testID={`import-photo-remove-${index}`}
                    accessibilityRole="button"
                    accessibilityLabel={strings.import.removePhoto(index + 1)}
                    hitSlop={8}
                    style={styles.remove}
                    onPress={() => removePhoto(index)}
                  >
                    <Text style={styles.removeText}>✕</Text>
                  </Pressable>
                )}
              </View>
            ))}
          </View>
        </View>
      )}

      {reading ? (
        <View
          testID="import-reading-indicator"
          style={styles.reading}
          accessibilityLiveRegion="polite"
        >
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.readingText}>
            {stillReading
              ? strings.import.stillReading
              : strings.import.reading}
          </Text>
          <Pressable
            testID="import-cancel-button"
            accessibilityRole="button"
            style={styles.secondaryButton}
            onPress={cancelReading}
          >
            <Text style={styles.secondaryButtonText}>
              {strings.common.cancel}
            </Text>
          </Pressable>
        </View>
      ) : (
        <>
          <View style={styles.pickRow}>
            {(
              [
                [
                  'import-take-photo-button',
                  strings.import.takePhoto,
                  takePhoto,
                ],
                [
                  'import-add-photos-button',
                  strings.import.addPhotos,
                  pickPhotos,
                ],
              ] as const
            ).map(([testID, label, onPress]) => (
              <Pressable
                key={testID}
                testID={testID}
                accessibilityRole="button"
                accessibilityState={{ disabled: full }}
                disabled={full}
                style={[
                  styles.secondaryButton,
                  styles.pickButton,
                  full && styles.disabled,
                ]}
                onPress={onPress}
              >
                <Text style={styles.secondaryButtonText}>{label}</Text>
              </Pressable>
            ))}
          </View>
          {full ? (
            <Text testID="import-photo-limit-text" style={styles.note}>
              {strings.import.limit(MAX_PHOTOS)}
            </Text>
          ) : null}
          {proError ? (
            <Text
              testID="import-pro-error-text"
              style={styles.error}
              accessibilityLiveRegion="polite"
            >
              {strings.import.proError}
            </Text>
          ) : null}
          {cameraError ? (
            <Text testID="import-camera-error-text" style={styles.note}>
              {strings.import.cameraError}
            </Text>
          ) : null}

          {errorText ? (
            <Text
              testID="import-error-text"
              style={styles.error}
              accessibilityLiveRegion="polite"
            >
              {errorText}
            </Text>
          ) : null}

          {errorText ? (
            <Pressable
              testID="import-retry-button"
              accessibilityRole="button"
              style={styles.primaryButton}
              onPress={getRecipe}
            >
              <Text style={styles.primaryButtonText}>
                {strings.common.tryAgain}
              </Text>
            </Pressable>
          ) : (
            <Pressable
              testID="import-get-recipe-button"
              accessibilityRole="button"
              accessibilityState={{ disabled: photos.length === 0 }}
              disabled={photos.length === 0}
              style={[
                styles.primaryButton,
                photos.length === 0 && styles.disabled,
              ]}
              onPress={getRecipe}
            >
              <Text style={styles.primaryButtonText}>
                {strings.import.getRecipe}
              </Text>
            </Pressable>
          )}

          <Text style={styles.note}>{strings.import.privacyNote}</Text>

          <View
            style={styles.orRow}
            importantForAccessibility="no-hide-descendants"
            accessibilityElementsHidden
          >
            <View style={styles.orLine} />
            <Text style={styles.orText}>{strings.import.or}</Text>
            <View style={styles.orLine} />
          </View>

          <Pressable
            testID="import-manual-link"
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.secondaryButton,
              pressed && styles.pressed,
            ]}
            onPress={() => navigation.navigate(Screens.RecipeForm)}
          >
            <Text style={styles.secondaryButtonText}>
              {strings.import.manualLink}
            </Text>
          </Pressable>
        </>
      )}
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
  intro: {
    fontFamily: fonts.serif,
    fontSize: 16,
    lineHeight: 24,
    color: colors.inkMuted,
  },
  kicker: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.4,
    color: colors.accent,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  dimmed: {
    opacity: 0.5,
  },
  thumbnails: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  thumbnail: {
    width: 88,
    height: 88,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: colors.placeholder,
  },
  image: {
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
    padding: 4,
  },
  removeText: {
    width: 24,
    height: 24,
    borderRadius: 12,
    overflow: 'hidden',
    textAlign: 'center',
    lineHeight: 24,
    fontSize: 13,
    color: colors.card,
    backgroundColor: 'rgba(43, 36, 32, 0.7)',
  },
  pickRow: {
    flexDirection: 'row',
    gap: 12,
  },
  pickButton: {
    flex: 1,
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: 999,
    paddingVertical: 12,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: colors.accent,
    fontSize: 15,
    fontWeight: '700',
  },
  primaryButton: {
    backgroundColor: colors.accent,
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: 'center',
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
  reading: {
    alignItems: 'center',
    gap: 16,
    paddingVertical: 32,
  },
  readingText: {
    fontFamily: fonts.serif,
    fontSize: 17,
    color: colors.ink,
  },
  // "or" between the photo import and typing the recipe by hand.
  orRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  orLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.hairline,
  },
  orText: {
    fontSize: 13,
    color: colors.inkMuted,
  },
  pressed: {
    opacity: 0.85,
  },
});
