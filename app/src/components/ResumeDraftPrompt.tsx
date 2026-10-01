import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { strings } from '../strings';
import { colors, fonts } from '../theme';

type Props = {
  startedAgo: string; // "2 h ago"
  stepsDone: number;
  stepsTotal: number;
  onStartOver: () => void;
  onResume: () => void;
};

// Shown instead of cooking mode when this recipe has a saved draft.
export default function ResumeDraftPrompt({
  startedAgo,
  stepsDone,
  stepsTotal,
  onStartOver,
  onResume,
}: Props) {
  return (
    <View style={styles.screen}>
      <View style={styles.card}>
        <Text accessibilityRole="header" style={styles.title}>
          {strings.resumeDraft.title}
        </Text>
        <Text style={styles.body}>
          {strings.resumeDraft.startedAgo(startedAgo)}
        </Text>
        <Text style={styles.body}>
          {strings.resumeDraft.stepsDone(stepsDone, stepsTotal)}
        </Text>
        <View style={styles.actions}>
          <Pressable
            testID="cooking-start-over-button"
            accessibilityRole="button"
            style={[styles.button, styles.secondaryButton]}
            onPress={onStartOver}
          >
            <Text style={styles.secondaryText}>
              {strings.resumeDraft.startOver}
            </Text>
          </Pressable>
          <Pressable
            testID="cooking-resume-button"
            accessibilityRole="button"
            style={[styles.button, styles.primaryButton]}
            onPress={onResume}
          >
            <Text style={styles.primaryText}>{strings.resumeDraft.resume}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    justifyContent: 'center',
    padding: 20,
    backgroundColor: colors.paper,
  },
  card: {
    padding: 24,
    borderRadius: 20,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
  },
  title: {
    marginBottom: 12,
    fontFamily: fonts.serif,
    fontSize: 24,
    lineHeight: 31,
    color: colors.ink,
  },
  body: {
    fontSize: 17,
    lineHeight: 25,
    color: colors.ink,
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 24,
  },
  button: {
    flex: 1,
    minHeight: 56,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButton: {
    borderWidth: 1.5,
    borderColor: colors.ink,
  },
  secondaryText: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.ink,
  },
  primaryButton: {
    backgroundColor: colors.accent,
  },
  primaryText: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.card,
  },
});
