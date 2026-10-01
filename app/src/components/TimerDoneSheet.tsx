import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { strings } from '../strings';
import { colors, fonts } from '../theme';
import MinutesStepper from './MinutesStepper';

const DEFAULT_EXTRA_MINUTES = 5;

type Props = {
  title: string; // "Step 2 done" / "Timer 1 done"
  stepText?: string; // absent for manual timers
  onAddTime: (minutes: number) => void;
  onCheckStep?: () => void; // absent for manual timers
  onDismiss: () => void;
};

// Shown when a timer reaches zero. Other timers keep running behind it.
// Mount it with a `key` per timer so the stepper starts at 5 each time.
export default function TimerDoneSheet({
  title,
  stepText,
  onAddTime,
  onCheckStep,
  onDismiss,
}: Props) {
  const [minutes, setMinutes] = useState(DEFAULT_EXTRA_MINUTES);

  return (
    <Modal transparent animationType="fade" onRequestClose={onDismiss}>
      <View style={styles.backdrop}>
        <View style={styles.card} accessibilityViewIsModal>
          <Text
            testID="timer-done-title"
            accessibilityRole="header"
            style={styles.title}
          >
            {title}
          </Text>
          {stepText ? <Text style={styles.stepText}>{stepText}</Text> : null}

          <Text style={styles.moreTime}>{strings.timerDone.needMoreTime}</Text>
          <MinutesStepper
            testIDPrefix="timer-done"
            value={minutes}
            onChange={setMinutes}
          />
          <Pressable
            testID="timer-done-add-time-button"
            accessibilityRole="button"
            style={styles.addTimeButton}
            onPress={() => onAddTime(minutes)}
          >
            <Text style={styles.addTimeText}>
              {strings.timerDone.addTime(minutes)}
            </Text>
          </Pressable>

          <View style={styles.actions}>
            {onCheckStep ? (
              <Pressable
                testID="timer-done-check-step-button"
                accessibilityRole="button"
                style={styles.secondaryButton}
                onPress={onCheckStep}
              >
                <Text style={styles.secondaryText}>
                  {strings.timerDone.checkStep}
                </Text>
              </Pressable>
            ) : null}
            <Pressable
              testID="timer-done-dismiss-button"
              accessibilityRole="button"
              style={styles.secondaryButton}
              onPress={onDismiss}
            >
              <Text style={styles.secondaryText}>
                {strings.timerDone.dismiss}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    padding: 20,
    backgroundColor: 'rgba(43, 36, 32, 0.55)',
  },
  card: {
    padding: 24,
    borderRadius: 20,
    backgroundColor: colors.card,
  },
  title: {
    fontFamily: fonts.serif,
    fontSize: 26,
    lineHeight: 33,
    color: colors.ink,
    textAlign: 'center',
  },
  stepText: {
    marginTop: 14,
    fontSize: 19,
    lineHeight: 27,
    color: colors.ink,
  },
  moreTime: {
    marginTop: 24,
    marginBottom: 12,
    fontSize: 16,
    fontWeight: '600',
    color: colors.ink,
    textAlign: 'center',
  },
  addTimeButton: {
    minHeight: 56,
    marginTop: 18,
    borderRadius: 14,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addTimeText: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.card,
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
  },
  secondaryButton: {
    flex: 1,
    minHeight: 56,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryText: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.ink,
  },
});
