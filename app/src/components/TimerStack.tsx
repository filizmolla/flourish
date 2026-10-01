import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  CookingTimer,
  formatRemaining,
  isPaused,
  remainingMs,
} from '../cooking/cookingTimers';
import { strings } from '../strings';
import { colors } from '../theme';

// Drawn rather than typed: Android shows ⏸ and ▶ as color emoji, which
// ignore the text color and clash with the theme.
function PauseIcon() {
  return (
    <View style={styles.pauseIcon}>
      <View style={styles.pauseBar} />
      <View style={styles.pauseBar} />
    </View>
  );
}

function PlayIcon() {
  return <View style={styles.playIcon} />;
}

type Props = {
  timers: CookingTimer[]; // already sorted, soonest first
  now: number;
  labelFor: (timer: CookingTimer) => string;
  onTogglePause: (id: string) => void;
  onRemove: (id: string) => void;
};

// Sticky list above the recipe, one row per timer. Step timers count down;
// the cooking clock (counting up) lives in the header, so the two never
// sit side by side.
export default function TimerStack({
  timers,
  now,
  labelFor,
  onTogglePause,
  onRemove,
}: Props) {
  if (timers.length === 0) return null;

  return (
    <View testID="cooking-timers" style={styles.stack}>
      {timers.map(timer => {
        const label = labelFor(timer);
        const paused = isPaused(timer);
        const remaining = formatRemaining(remainingMs(timer, now));
        return (
          <View
            key={timer.id}
            testID={`cooking-timer-${timer.id}`}
            style={styles.row}
          >
            <Text style={styles.label} numberOfLines={1}>
              ⏱ {label}
            </Text>
            <Text
              testID={`cooking-timer-remaining-${timer.id}`}
              accessibilityLabel={strings.cooking.timerRemaining(
                label,
                remaining,
              )}
              style={[styles.remaining, paused && styles.remainingPaused]}
            >
              {remaining}
            </Text>
            <Pressable
              testID={`cooking-timer-pause-${timer.id}`}
              accessibilityRole="button"
              accessibilityLabel={
                paused
                  ? strings.cooking.resumeTimer(label)
                  : strings.cooking.pauseTimer(label)
              }
              style={styles.iconButton}
              onPress={() => onTogglePause(timer.id)}
            >
              {paused ? <PlayIcon /> : <PauseIcon />}
            </Pressable>
            <Pressable
              testID={`cooking-timer-remove-${timer.id}`}
              accessibilityRole="button"
              accessibilityLabel={strings.cooking.removeTimer(label)}
              style={styles.iconButton}
              onPress={() => onRemove(timer.id)}
            >
              <Text style={styles.icon}>✕</Text>
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: {
    paddingHorizontal: 16,
    paddingVertical: 4,
    backgroundColor: colors.card,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
  },
  row: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
  },
  label: {
    flex: 1,
    fontSize: 17,
    color: colors.ink,
  },
  remaining: {
    marginHorizontal: 8,
    fontSize: 20,
    fontWeight: '700',
    color: colors.ink,
    fontVariant: ['tabular-nums'],
  },
  // Paused timers read as "on hold" without losing contrast.
  remainingPaused: {
    fontWeight: '400',
    fontStyle: 'italic',
  },
  iconButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pauseIcon: {
    flexDirection: 'row',
    gap: 4,
  },
  pauseBar: {
    width: 4,
    height: 16,
    borderRadius: 1,
    backgroundColor: colors.ink,
  },
  // A right-pointing triangle made from borders.
  playIcon: {
    width: 0,
    height: 0,
    marginLeft: 3,
    borderTopWidth: 8,
    borderBottomWidth: 8,
    borderLeftWidth: 14,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    borderLeftColor: colors.ink,
  },
  icon: {
    fontSize: 20,
    color: colors.ink,
  },
});
