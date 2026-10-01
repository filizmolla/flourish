import React, { useEffect, useRef } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Image,
  ImageSourcePropType,
  StyleSheet,
  View,
} from 'react-native';
import { Flower } from '../nutrients/flowers';

// Microsoft Fluent Emoji 3D (MIT), not system emoji, so every phone
// shows the same flowers.
export const flowerImages: Record<Flower, ImageSourcePropType> = {
  [Flower.Photo]: require('../assets/flowers/herb.png'),
  [Flower.Sprout]: require('../assets/flowers/seedling.png'),
  [Flower.One]: require('../assets/flowers/tulip.png'),
  [Flower.Two]: require('../assets/flowers/cherry_blossom.png'),
  [Flower.Balanced]: require('../assets/flowers/sunflower.png'),
};
const ribbon: ImageSourcePropType = require('../assets/flowers/ribbon.png');

const STAGGER_MS = 90;
const POP_MS = 260;

// The week's flowers in a centered cluster tied with a ribbon. They pop in
// one after another; with reduce motion on the bouquet is shown finished.
// One label for the whole bouquet; the flowers are hidden from screen
// readers. Remount (a new key) to replay the animation.
export function Bouquet({
  flowers,
  testID,
  accessibilityLabel,
}: {
  flowers: Flower[];
  testID?: string;
  accessibilityLabel: string;
}) {
  const progress = useRef(flowers.map(() => new Animated.Value(0))).current;

  useEffect(() => {
    let active = true;
    // Not known (or it fails): animate.
    Promise.resolve()
      .then(() => AccessibilityInfo.isReduceMotionEnabled())
      .catch(() => false)
      .then(reduce => {
        if (!active) return;
        if (reduce) {
          progress.forEach(value => value.setValue(1));
          return;
        }
        Animated.stagger(
          STAGGER_MS,
          progress.map(value =>
            Animated.timing(value, {
              toValue: 1,
              duration: POP_MS,
              useNativeDriver: true,
            }),
          ),
        ).start();
      });
    return () => {
      active = false;
    };
  }, [progress]);

  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
      style={styles.bouquet}
    >
      <View style={styles.flowers}>
        {flowers.map((flower, index) => (
          <Animated.Image
            key={index}
            testID={testID && `${testID}-flower-${index}`}
            source={flowerImages[flower]}
            style={[
              styles.flower,
              {
                opacity: progress[index],
                transform: [
                  {
                    scale: progress[index].interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.4, 1],
                    }),
                  },
                ],
              },
            ]}
          />
        ))}
      </View>
      <Image source={ribbon} style={styles.ribbon} />
    </View>
  );
}

const styles = StyleSheet.create({
  bouquet: {
    alignItems: 'center',
    gap: 2,
  },
  flowers: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    maxWidth: 240,
  },
  flower: {
    width: 32,
    height: 32,
    margin: 1,
  },
  ribbon: {
    width: 36,
    height: 36,
  },
});
