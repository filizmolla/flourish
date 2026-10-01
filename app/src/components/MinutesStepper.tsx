import React, { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { strings } from '../strings';
import { colors } from '../theme';

export const MIN_MINUTES = 1;
export const MAX_MINUTES = 60;
const REPEAT_MS = 120;

export function clampMinutes(minutes: number): number {
  return Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, minutes));
}

type Props = {
  testIDPrefix: string; // e.g. "timer-done" → timer-done-minus-button
  value: number;
  onChange: (minutes: number) => void;
};

// [ − ]  5 min  [ + ] with large buttons; holding a button keeps stepping.
// Screen readers get one adjustable control ("5 minutes"), changed by
// swiping up or down.
export default function MinutesStepper({
  testIDPrefix,
  value,
  onChange,
}: Props) {
  const valueRef = useRef(value);
  valueRef.current = value;
  const repeat = useRef<ReturnType<typeof setInterval> | null>(null);

  function step(delta: number) {
    const next = clampMinutes(valueRef.current + delta);
    if (next === valueRef.current) return;
    valueRef.current = next;
    onChange(next);
  }

  function startRepeat(delta: number) {
    stopRepeat();
    repeat.current = setInterval(() => step(delta), REPEAT_MS);
  }

  function stopRepeat() {
    if (repeat.current) clearInterval(repeat.current);
    repeat.current = null;
  }

  useEffect(() => stopRepeat, []);

  return (
    <View
      style={styles.stepper}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={strings.stepper.label}
      accessibilityValue={{ text: strings.stepper.value(value) }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={event =>
        step(event.nativeEvent.actionName === 'increment' ? 1 : -1)
      }
    >
      <Pressable
        testID={`${testIDPrefix}-minus-button`}
        style={[styles.button, value <= MIN_MINUTES && styles.buttonDisabled]}
        disabled={value <= MIN_MINUTES}
        onPress={() => step(-1)}
        onLongPress={() => startRepeat(-1)}
        onPressOut={stopRepeat}
      >
        <Text style={styles.buttonText}>−</Text>
      </Pressable>
      <Text testID={`${testIDPrefix}-minutes-text`} style={styles.value}>
        {strings.format.minutes(value)}
      </Text>
      <Pressable
        testID={`${testIDPrefix}-plus-button`}
        style={[styles.button, value >= MAX_MINUTES && styles.buttonDisabled]}
        disabled={value >= MAX_MINUTES}
        onPress={() => step(1)}
        onLongPress={() => startRepeat(1)}
        onPressOut={stopRepeat}
      >
        <Text style={styles.buttonText}>+</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
  },
  button: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 2,
    borderColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: {
    opacity: 0.35,
  },
  buttonText: {
    fontSize: 28,
    lineHeight: 32,
    color: colors.ink,
  },
  value: {
    minWidth: 88,
    textAlign: 'center',
    fontSize: 24,
    fontWeight: '600',
    color: colors.ink,
    fontVariant: ['tabular-nums'],
  },
});
