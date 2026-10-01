import React from 'react';
import { StyleSheet } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { FoodGroup } from '../api/recipesClient';
import { NutrientState, NutrientStates } from '../nutrients/nutrientStates';
import { colors } from '../theme';
import { NutrientDots } from './NutrientDots';

const TEST_ID = 'dots';

const mixed: NutrientStates = {
  [FoodGroup.Protein]: NutrientState.Full,
  [FoodGroup.Fiber]: NutrientState.Some,
  [FoodGroup.HealthyFat]: NutrientState.None,
};

async function renderDots(
  size?: 'small' | 'large',
  states: NutrientStates = mixed,
) {
  await render(
    <NutrientDots
      testID={TEST_ID}
      states={states}
      size={size}
      accessibilityLabel="Has protein and fiber, no healthy fat yet"
    />,
  );
}

const dot = (id: 'protein' | 'fiber' | 'healthy-fat') =>
  screen.getByTestId(`${TEST_ID}-dot-${id}`);

const widthOf = (id: 'protein' | 'fiber' | 'healthy-fat') =>
  StyleSheet.flatten(dot(id).props.style).width as number;

describe('NutrientDots', () => {
  it('is read out as one image with the given label', async () => {
    await renderDots();

    expect(
      screen.getByRole('image', {
        name: 'Has protein and fiber, no healthy fat yet',
      }),
    ).toBeOnTheScreen();
  });

  it('has one dot per nutrient', async () => {
    await renderDots();

    expect(dot('protein')).toBeOnTheScreen();
    expect(dot('fiber')).toBeOnTheScreen();
    expect(dot('healthy-fat')).toBeOnTheScreen();
  });

  it('fills each dot by its own state', async () => {
    await renderDots();

    // Full: solid accent. None: the card color with a gray outline.
    expect(dot('protein')).toHaveStyle({ backgroundColor: colors.accent });
    expect(dot('healthy-fat')).toHaveStyle({
      backgroundColor: colors.card,
      borderColor: colors.placeholderText,
    });
    // Some: an accent outline, with a fill that is neither full nor none.
    expect(dot('fiber')).toHaveStyle({ borderColor: colors.accent });
    expect(dot('fiber')).not.toHaveStyle({ backgroundColor: colors.accent });
    expect(dot('fiber')).not.toHaveStyle({ backgroundColor: colors.card });
  });

  it('follows the states when they change, not a fixed position', async () => {
    await renderDots('large', {
      [FoodGroup.Protein]: NutrientState.None,
      [FoodGroup.Fiber]: NutrientState.None,
      [FoodGroup.HealthyFat]: NutrientState.Full,
    });

    expect(dot('protein')).toHaveStyle({ backgroundColor: colors.card });
    expect(dot('fiber')).toHaveStyle({ backgroundColor: colors.card });
    expect(dot('healthy-fat')).toHaveStyle({ backgroundColor: colors.accent });
  });

  it('shows a word by each dot at the default (large) size', async () => {
    await renderDots();

    expect(screen.getByText('Protein')).toBeOnTheScreen();
    expect(screen.getByText('Fiber')).toBeOnTheScreen();
    expect(screen.getByText('Healthy fat')).toBeOnTheScreen();
  });

  it('shows no words at the small size', async () => {
    await renderDots('small');

    expect(screen.queryByText('Protein')).not.toBeOnTheScreen();
    expect(screen.queryByText('Fiber')).not.toBeOnTheScreen();
    expect(screen.queryByText('Healthy fat')).not.toBeOnTheScreen();
    expect(dot('protein')).toBeOnTheScreen();
  });

  it.each(['small', 'large'] as const)(
    'draws all three dots the same size (%s)',
    async size => {
      await renderDots(size);

      expect(widthOf('protein')).toBe(widthOf('fiber'));
      expect(widthOf('healthy-fat')).toBe(widthOf('protein'));
    },
  );

  it('lays the dots out in a row: protein, fiber, healthy fat', async () => {
    await renderDots();

    expect(screen.getByTestId(TEST_ID)).toHaveStyle({ flexDirection: 'row' });
    expect(
      screen.getAllByTestId(/-dot-/).map(dotView => dotView.props.testID),
    ).toEqual([
      `${TEST_ID}-dot-protein`,
      `${TEST_ID}-dot-fiber`,
      `${TEST_ID}-dot-healthy-fat`,
    ]);
  });

  it('draws the small dots smaller than the large ones', async () => {
    await renderDots('small');
    const small = widthOf('protein');
    await screen.rerender(
      <NutrientDots
        testID={TEST_ID}
        states={mixed}
        size="large"
        accessibilityLabel="x"
      />,
    );

    expect(small).toBeLessThan(widthOf('protein'));
  });
});
