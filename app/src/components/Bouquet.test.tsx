import React from 'react';
import { AccessibilityInfo } from 'react-native';
import { act, render, screen } from '@testing-library/react-native';
import { Flower } from '../nutrients/flowers';
import { Bouquet, flowerImages } from './Bouquet';

const TEST_ID = 'bouquet';
const LABEL = 'Protein in most meals, fiber in some, healthy fat not yet';

// The RN jest preset's isReduceMotionEnabled resolves undefined; each test
// says what the phone reports.
function reduceMotion(enabled: boolean) {
  jest
    .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
    .mockResolvedValue(enabled);
}

async function renderBouquet(flowers: Flower[]) {
  await render(
    <Bouquet testID={TEST_ID} flowers={flowers} accessibilityLabel={LABEL} />,
  );
  // Let the reduce-motion check resolve, without moving any timers.
  await act(async () => {});
}

const flower = (index: number) =>
  screen.getByTestId(`${TEST_ID}-flower-${index}`, {
    includeHiddenElements: true,
  });

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('Bouquet', () => {
  it('is one image read out with the given label, one flower per item in order', async () => {
    reduceMotion(true);
    await renderBouquet([Flower.Photo, Flower.Balanced, Flower.One]);

    expect(screen.getByRole('image', { name: LABEL })).toHaveProp(
      'testID',
      TEST_ID,
    );
    expect(flower(0)).toHaveProp('source', flowerImages[Flower.Photo]);
    expect(flower(1)).toHaveProp('source', flowerImages[Flower.Balanced]);
    expect(flower(2)).toHaveProp('source', flowerImages[Flower.One]);
    expect(
      screen.queryByTestId(`${TEST_ID}-flower-3`, {
        includeHiddenElements: true,
      }),
    ).not.toBeOnTheScreen();
  });

  it('shows every flower finished with reduce motion on, without advancing timers', async () => {
    reduceMotion(true);
    await renderBouquet([Flower.Sprout, Flower.Two, Flower.Balanced]);

    for (const index of [0, 1, 2]) {
      expect(flower(index)).toHaveStyle({ opacity: 1 });
    }
  });

  // The pop-in itself runs on the native driver, which doesn't update props
  // under Jest; this only checks the flowers start hidden when it animates.
  it.each([false, undefined])(
    'starts the flowers hidden to animate when reduce motion is %s',
    async enabled => {
      jest
        .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
        .mockResolvedValue(enabled as boolean);
      await renderBouquet([Flower.Sprout, Flower.Two]);

      expect(flower(0)).toHaveStyle({ opacity: 0 });
      expect(flower(1)).toHaveStyle({ opacity: 0 });
    },
  );
});
