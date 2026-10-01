import React from 'react';
import { render, screen, userEvent } from '@testing-library/react-native';
import { FoodGroup, IngredientSummary, RecipeLine } from '../api/recipesClient';
import { BalanceCard } from './BalanceCard';

function makeIngredient(
  overrides: Partial<IngredientSummary> = {},
): IngredientSummary {
  return {
    id: 'i-egg',
    name: 'Egg',
    mainGroup: FoodGroup.Protein,
    nutrients: [FoodGroup.Protein],
    ...overrides,
  };
}

function makeLine(
  ingredient: IngredientSummary | null,
  overrides: Partial<RecipeLine> = {},
): RecipeLine {
  return {
    position: 0,
    text: ingredient ? `1 ${ingredient.name}` : '# For the sauce',
    linkSetByOwner: false,
    ingredient,
    ...overrides,
  };
}

const egg = makeIngredient();
const lentils = makeIngredient({
  id: 'i-lentils',
  name: 'Lentils',
  mainGroup: FoodGroup.Fiber,
  nutrients: [FoodGroup.Fiber, FoodGroup.Protein],
});
const avocado = makeIngredient({
  id: 'i-avocado',
  name: 'Avocado',
  mainGroup: FoodGroup.HealthyFat,
  nutrients: [FoodGroup.HealthyFat, FoodGroup.Fiber],
});

// Egg and lentils: protein and fiber, no healthy fat yet.
const missingFat = [
  makeLine(null, { position: 0 }),
  makeLine(egg, { position: 1 }),
  makeLine(null, { position: 2, text: 'a pinch of love' }),
  makeLine(lentils, { position: 3 }),
];

describe('BalanceCard', () => {
  it('renders nothing when no line is linked', async () => {
    await render(<BalanceCard lines={[makeLine(null), makeLine(null)]} />);

    expect(
      screen.queryByTestId('recipe-detail-balance-card'),
    ).not.toBeOnTheScreen();
    expect(screen.queryByRole('image')).not.toBeOnTheScreen();
  });

  it('renders nothing for a recipe with no lines', async () => {
    await render(<BalanceCard lines={[]} />);

    expect(
      screen.queryByTestId('recipe-detail-balance-card'),
    ).not.toBeOnTheScreen();
  });

  it('says the plate is balanced', async () => {
    await render(
      <BalanceCard
        lines={[makeLine(egg), makeLine(null), makeLine(avocado)]}
      />,
    );

    expect(screen.getByText('Balanced plate ✓')).toBeOnTheScreen();
    expect(screen.queryByText('Make it more filling')).not.toBeOnTheScreen();
    expect(
      screen.getByRole('image', { name: 'Has protein, fiber and healthy fat' }),
    ).toBeOnTheScreen();
  });

  it('asks for the missing nutrient', async () => {
    await render(<BalanceCard lines={missingFat} />);

    expect(screen.getByText('Make it more filling')).toBeOnTheScreen();
    expect(screen.getByText('Add a healthy fat.')).toBeOnTheScreen();
    expect(screen.queryByText('Balanced plate ✓')).not.toBeOnTheScreen();
    expect(
      screen.getByRole('image', {
        name: 'Has protein and fiber, no healthy fat yet',
      }),
    ).toBeOnTheScreen();
  });

  it('asks for protein first when a linked line brings nothing', async () => {
    const salt = makeIngredient({
      id: 'i-salt',
      name: 'Salt',
      mainGroup: null,
      nutrients: [],
    });
    await render(<BalanceCard lines={[makeLine(salt)]} />);

    expect(screen.getByText('Add a protein.')).toBeOnTheScreen();
    expect(
      screen.getByRole('image', {
        name: 'No protein, fiber or healthy fat yet',
      }),
    ).toBeOnTheScreen();
  });

  describe('"See foods" link', () => {
    it('links to foods with the missing nutrient and reports it when pressed', async () => {
      const onMorePress = jest.fn();
      const user = userEvent.setup();
      await render(
        <BalanceCard lines={missingFat} onMorePress={onMorePress} />,
      );

      const link = screen.getByRole('link', {
        name: 'See foods with healthy fat ›',
      });
      expect(link).toHaveProp('testID', 'recipe-detail-balance-more-link');

      await user.press(link);

      expect(onMorePress).toHaveBeenCalledTimes(1);
      expect(onMorePress).toHaveBeenCalledWith(FoodGroup.HealthyFat);
    });

    it('names the first nutrient to add when several are missing', async () => {
      const onMorePress = jest.fn();
      const user = userEvent.setup();
      // Egg only: fiber and healthy fat are missing; fiber comes first.
      await render(
        <BalanceCard lines={[makeLine(egg)]} onMorePress={onMorePress} />,
      );

      expect(screen.getByText('Add some fiber.')).toBeOnTheScreen();
      await user.press(
        screen.getByRole('link', { name: 'See foods with fiber ›' }),
      );

      expect(onMorePress).toHaveBeenCalledWith(FoodGroup.Fiber);
    });

    it('links to protein foods when nothing linked brings a nutrient', async () => {
      const onMorePress = jest.fn();
      const user = userEvent.setup();
      const salt = makeIngredient({
        id: 'i-salt',
        name: 'Salt',
        mainGroup: null,
        nutrients: [],
      });
      await render(
        <BalanceCard lines={[makeLine(salt)]} onMorePress={onMorePress} />,
      );

      await user.press(
        screen.getByRole('link', { name: 'See foods with protein ›' }),
      );

      expect(onMorePress).toHaveBeenCalledWith(FoodGroup.Protein);
    });

    it('is not shown when the plate is balanced', async () => {
      await render(
        <BalanceCard
          lines={[makeLine(egg), makeLine(avocado)]}
          onMorePress={jest.fn()}
        />,
      );

      expect(screen.getByText('Balanced plate ✓')).toBeOnTheScreen();
      expect(
        screen.queryByTestId('recipe-detail-balance-more-link'),
      ).not.toBeOnTheScreen();
    });

    it('is not shown without an onMorePress handler', async () => {
      await render(<BalanceCard lines={missingFat} />);

      expect(screen.getByText('Add a healthy fat.')).toBeOnTheScreen();
      expect(screen.queryByRole('link')).not.toBeOnTheScreen();
      expect(
        screen.queryByTestId('recipe-detail-balance-more-link'),
      ).not.toBeOnTheScreen();
    });
  });
});
