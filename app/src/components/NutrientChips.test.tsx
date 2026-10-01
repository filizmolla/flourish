import React from 'react';
import { View } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { FoodGroup, Nutrient } from '../api/recipesClient';
import { GroupChip, NutrientChips } from './NutrientChips';

async function renderChips(mainGroup: FoodGroup | null, nutrients: Nutrient[]) {
  await render(
    <View testID="chips-host">
      <NutrientChips mainGroup={mainGroup} nutrients={nutrients} />
    </View>,
  );
}

describe('GroupChip', () => {
  it.each([
    [FoodGroup.Protein, 'Protein'],
    [FoodGroup.Fiber, 'Fiber'],
    [FoodGroup.HealthyFat, 'Healthy fat'],
    [FoodGroup.Carb, 'Carb'],
  ])('labels %s as "%s"', async (group, text) => {
    await render(<GroupChip group={group} />);

    expect(screen.getByText(text)).toBeOnTheScreen();
  });
});

describe('NutrientChips', () => {
  it('shows the main group first, then the other nutrients, without repeating the main group', async () => {
    await renderChips(FoodGroup.HealthyFat, [
      FoodGroup.HealthyFat,
      FoodGroup.Fiber,
    ]);

    const row = screen.getByLabelText('Mainly healthy fat, also fiber');
    expect(row).toHaveTextContent('Healthy fatFiber');
    expect(screen.getAllByText('Healthy fat')).toHaveLength(1);
  });

  it('keeps the main group first even when it is listed later in nutrients', async () => {
    await renderChips(FoodGroup.Protein, [FoodGroup.Fiber, FoodGroup.Protein]);

    expect(
      screen.getByLabelText('Mainly protein, also fiber'),
    ).toHaveTextContent('ProteinFiber');
  });

  it('reads "Mainly carb" for a carb with no nutrients', async () => {
    await renderChips(FoodGroup.Carb, []);

    expect(screen.getByLabelText('Mainly carb')).toHaveTextContent('Carb');
  });

  it('lists several extra nutrients after a carb main group', async () => {
    await renderChips(FoodGroup.Carb, [FoodGroup.Fiber, FoodGroup.Protein]);

    expect(
      screen.getByLabelText('Mainly carb, also fiber, protein'),
    ).toHaveTextContent('CarbFiberProtein');
  });

  it('reads "Has fiber" when there is no main group but a nutrient', async () => {
    await renderChips(null, [FoodGroup.Fiber]);

    expect(screen.getByLabelText('Has fiber')).toHaveTextContent('Fiber');
  });

  it('reads every nutrient after "Has" when there is no main group', async () => {
    await renderChips(null, [FoodGroup.Protein, FoodGroup.HealthyFat]);

    expect(screen.getByLabelText('Has protein, healthy fat')).toHaveTextContent(
      'ProteinHealthy fat',
    );
  });

  it('renders nothing for a seasoning (no main group, no nutrients)', async () => {
    await renderChips(null, []);

    expect(screen.getByTestId('chips-host')).toBeEmptyElement();
  });
});
