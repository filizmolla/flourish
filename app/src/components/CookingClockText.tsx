import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  CookingClock,
  elapsedMs,
  formatElapsed,
  isClockRunning,
} from '../cooking/cookingClock';
import { strings } from '../strings';
import { colors } from '../theme';

type Props = {
  clock: CookingClock;
};

// "Cooking · 23:41" row at the top of cooking mode. The clock counts UP,
// scrolls away, and has no ⏱ icon, while step timers count down in the sticky
// stack, so the two aren't confused. It ticks on its own so the screen
// doesn't re-render every second just for the clock.
export default function CookingClockText({ clock }: Props) {
  const [now, setNow] = useState(() => Date.now());
  const running = isClockRunning(clock);

  useEffect(() => {
    setNow(Date.now());
    if (!running) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [running, clock]);

  const elapsed = formatElapsed(elapsedMs(clock, now));

  return (
    <View style={styles.row}>
      <Text
        testID="cooking-elapsed-text"
        style={styles.label}
        accessibilityLabel={strings.cooking.elapsedLabel(elapsed)}
      >
        {strings.cooking.elapsed(elapsed)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // Full-width row between hairlines, like the stats row on recipe detail:
  // no fill, so it stays light and reads as part of the page.
  row: {
    marginBottom: 20,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
  },
  label: {
    textAlign: 'center',
    fontSize: 15,
    fontWeight: '600',
    color: colors.ink,
    fontVariant: ['tabular-nums'],
  },
});
