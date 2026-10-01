import React from 'react';
import { Alert, Linking } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { render, screen, userEvent } from '@testing-library/react-native';
import { FoodGroup, IngredientDetail } from '../api/recipesClient';
import { useIngredient } from '../hooks/useIngredients';
import { AppStackParamList, Screens } from '../navigation/types';
import { colors } from '../theme';
import IngredientDetailScreen from './IngredientDetailScreen';

jest.mock('../hooks/useIngredients', () => ({ useIngredient: jest.fn() }));

type Props = NativeStackScreenProps<
  AppStackParamList,
  Screens.IngredientDetail
>;

const mockedUseIngredient = jest.mocked(useIngredient);

const DOTS = 'ingredient-detail-nutrient-dots';
const SEASONING = "Doesn't count toward a balanced plate";

function makeIngredient(
  overrides: Partial<IngredientDetail> = {},
): IngredientDetail {
  return {
    id: 'i-avocado',
    name: 'Avocado',
    mainGroup: FoodGroup.HealthyFat,
    nutrients: [FoodGroup.HealthyFat, FoodGroup.Fiber],
    description: 'Creamy, and full of fat that keeps you going.',
    fdcId: 171705,
    recipes: [
      { id: 'r1', title: 'Guacamole' },
      { id: 'r2', title: 'Green toast' },
    ],
    ...overrides,
  };
}

type QueryState = {
  data?: IngredientDetail;
  isPending?: boolean;
  isError?: boolean;
  refetch?: jest.Mock;
};

function mockIngredientQuery({
  data,
  isPending = false,
  isError = false,
  refetch = jest.fn(),
}: QueryState) {
  mockedUseIngredient.mockReturnValue({
    data,
    isPending,
    isError,
    refetch,
  } as unknown as ReturnType<typeof useIngredient>);
  return refetch;
}

async function renderScreen() {
  const navigation = { push: jest.fn(), navigate: jest.fn() };
  await render(
    <IngredientDetailScreen
      navigation={navigation as unknown as Props['navigation']}
      route={
        {
          key: 'IngredientDetail-1',
          name: Screens.IngredientDetail,
          params: { ingredientId: 'i-avocado' },
        } as Props['route']
      }
    />,
  );
  return navigation;
}

// The row a chip label ("Mainly", "Also has") starts. The large dots
// print the nutrient words too, so chips are read through their row.
function chipRow(label: string) {
  const row = screen.getByText(label).parent;
  if (!row) throw new Error(`No row around "${label}"`);
  return row;
}

const dot = (id: 'protein' | 'fiber' | 'healthy-fat') =>
  screen.getByTestId(`${DOTS}-dot-${id}`);

beforeEach(() => {
  jest.resetAllMocks();
});

afterEach(() => {
  // Undo the Linking and Alert spies.
  jest.restoreAllMocks();
});

describe('IngredientDetailScreen', () => {
  it('asks for the ingredient from the route', async () => {
    mockIngredientQuery({ data: makeIngredient() });
    await renderScreen();

    expect(mockedUseIngredient).toHaveBeenCalledWith('i-avocado');
  });

  describe('loading and error', () => {
    it('shows neither the ingredient nor an error while loading', async () => {
      mockIngredientQuery({ isPending: true });
      await renderScreen();

      expect(
        screen.queryByTestId('ingredient-detail-name'),
      ).not.toBeOnTheScreen();
      expect(
        screen.queryByTestId('ingredient-detail-error-text'),
      ).not.toBeOnTheScreen();
    });

    it('shows the error text and retries with Try again', async () => {
      const user = userEvent.setup();
      const refetch = mockIngredientQuery({ isError: true });
      await renderScreen();

      expect(
        screen.getByTestId('ingredient-detail-error-text'),
      ).toHaveTextContent("Couldn't load this ingredient.");
      expect(
        screen.queryByTestId('ingredient-detail-name'),
      ).not.toBeOnTheScreen();

      await user.press(screen.getByRole('button', { name: 'Try again' }));

      expect(refetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('name, chips and dots', () => {
    it('shows the name as the header', async () => {
      mockIngredientQuery({ data: makeIngredient() });
      await renderScreen();

      const name = screen.getByRole('header', { name: 'Avocado' });
      expect(name).toBe(screen.getByTestId('ingredient-detail-name'));
    });

    it('shows the main group under "Mainly" and the others under "Also has"', async () => {
      mockIngredientQuery({
        data: makeIngredient({
          nutrients: [FoodGroup.HealthyFat, FoodGroup.Fiber, FoodGroup.Protein],
        }),
      });
      await renderScreen();

      expect(chipRow('Mainly')).toHaveTextContent('MainlyHealthy fat');
      expect(chipRow('Also has')).toHaveTextContent('Also hasFiberProtein');
      expect(screen.queryByText(SEASONING)).not.toBeOnTheScreen();
    });

    it('has no "Also has" row when the main group is its only nutrient', async () => {
      mockIngredientQuery({
        data: makeIngredient({
          name: 'Egg',
          mainGroup: FoodGroup.Protein,
          nutrients: [FoodGroup.Protein],
        }),
      });
      await renderScreen();

      expect(chipRow('Mainly')).toHaveTextContent('MainlyProtein');
      expect(screen.queryByText('Also has')).not.toBeOnTheScreen();
      expect(
        screen.getByRole('image', { name: 'Mainly protein' }),
      ).toBeOnTheScreen();
    });

    it('shows a carb main group as a chip but not as a dot', async () => {
      mockIngredientQuery({
        data: makeIngredient({
          name: 'Oats',
          mainGroup: FoodGroup.Carb,
          nutrients: [FoodGroup.Fiber],
        }),
      });
      await renderScreen();

      expect(chipRow('Mainly')).toHaveTextContent('MainlyCarb');
      expect(chipRow('Also has')).toHaveTextContent('Also hasFiber');
      expect(
        screen.getByRole('image', { name: 'Mainly carb, also fiber' }),
      ).toBeOnTheScreen();
      // Carb has no dot: only fiber is filled, and only partly.
      expect(dot('fiber')).toHaveStyle({ borderColor: colors.accent });
      expect(dot('fiber')).not.toHaveStyle({ backgroundColor: colors.accent });
      expect(dot('protein')).toHaveStyle({ backgroundColor: colors.card });
      expect(dot('healthy-fat')).toHaveStyle({ backgroundColor: colors.card });
    });

    it('reads the dots as the groups and fills main full, others some', async () => {
      mockIngredientQuery({ data: makeIngredient() });
      await renderScreen();

      const dots = screen.getByRole('image', {
        name: 'Mainly healthy fat, also fiber',
      });
      expect(dots).toBe(screen.getByTestId(DOTS));
      expect(dot('healthy-fat')).toHaveStyle({
        backgroundColor: colors.accent,
      });
      expect(dot('fiber')).toHaveStyle({ borderColor: colors.accent });
      expect(dot('fiber')).not.toHaveStyle({ backgroundColor: colors.accent });
      expect(dot('fiber')).not.toHaveStyle({ backgroundColor: colors.card });
      expect(dot('protein')).toHaveStyle({ backgroundColor: colors.card });
    });

    it('says a seasoning does not count toward a balanced plate, and reads its dots that way', async () => {
      mockIngredientQuery({
        data: makeIngredient({ name: 'Cumin', mainGroup: null, nutrients: [] }),
      });
      await renderScreen();

      expect(screen.getByText(SEASONING)).toBeOnTheScreen();
      expect(screen.queryByText('Mainly')).not.toBeOnTheScreen();
      expect(screen.queryByText('Also has')).not.toBeOnTheScreen();
      expect(screen.getByRole('image', { name: SEASONING })).toBeOnTheScreen();
      for (const id of ['protein', 'fiber', 'healthy-fat'] as const) {
        expect(dot(id)).toHaveStyle({ backgroundColor: colors.card });
      }
    });

    it('shows only "Also has" when there is no main group but nutrients', async () => {
      mockIngredientQuery({
        data: makeIngredient({ mainGroup: null, nutrients: [FoodGroup.Fiber] }),
      });
      await renderScreen();

      expect(screen.queryByText('Mainly')).not.toBeOnTheScreen();
      expect(chipRow('Also has')).toHaveTextContent('Also hasFiber');
      expect(screen.queryByText(SEASONING)).not.toBeOnTheScreen();
      expect(screen.getByRole('image', { name: 'Has fiber' })).toBeOnTheScreen();
    });
  });

  describe('description', () => {
    it('shows the description when there is one', async () => {
      mockIngredientQuery({ data: makeIngredient() });
      await renderScreen();

      expect(
        screen.getByTestId('ingredient-detail-description'),
      ).toHaveTextContent('Creamy, and full of fat that keeps you going.');
    });

    it.each([null, ''])('shows no description for %j', async description => {
      mockIngredientQuery({ data: makeIngredient({ description }) });
      await renderScreen();

      expect(
        screen.queryByTestId('ingredient-detail-description'),
      ).not.toBeOnTheScreen();
    });
  });

  describe('in your recipes', () => {
    it('lists each recipe as a link that pushes its detail', async () => {
      const user = userEvent.setup();
      mockIngredientQuery({ data: makeIngredient() });
      const navigation = await renderScreen();

      expect(screen.getByText('IN YOUR RECIPES')).toBeOnTheScreen();
      expect(
        screen.getByTestId('ingredient-detail-used-in-r1'),
      ).toHaveTextContent('Guacamole', { exact: false });
      expect(
        screen.queryByTestId('ingredient-detail-not-used-text'),
      ).not.toBeOnTheScreen();

      await user.press(screen.getByRole('link', { name: /Green toast/ }));

      expect(navigation.push).toHaveBeenCalledTimes(1);
      expect(navigation.push).toHaveBeenCalledWith(Screens.RecipeDetail, {
        recipeId: 'r2',
      });
      expect(navigation.navigate).not.toHaveBeenCalled();
    });

    it('says the ingredient is not used yet when no recipe has it', async () => {
      mockIngredientQuery({ data: makeIngredient({ recipes: [] }) });
      await renderScreen();

      expect(
        screen.getByTestId('ingredient-detail-not-used-text'),
      ).toHaveTextContent("You haven't used this in a recipe yet.");
      expect(
        screen.queryByTestId(/^ingredient-detail-used-in-/),
      ).not.toBeOnTheScreen();
    });
  });

  describe('USDA link', () => {
    it('opens the food on FoodData Central', async () => {
      const user = userEvent.setup();
      const openURL = jest
        .spyOn(Linking, 'openURL')
        .mockResolvedValue(undefined);
      mockIngredientQuery({ data: makeIngredient({ fdcId: 171705 }) });
      await renderScreen();

      const link = screen.getByRole('link', {
        name: 'Source: USDA FoodData Central ›',
      });
      expect(link).toBe(screen.getByTestId('ingredient-detail-usda-link'));

      await user.press(link);

      expect(openURL).toHaveBeenCalledTimes(1);
      expect(openURL).toHaveBeenCalledWith(
        'https://fdc.nal.usda.gov/food-details/171705',
      );
    });

    it('has no link when the entry has no fdcId', async () => {
      mockIngredientQuery({ data: makeIngredient({ fdcId: null }) });
      await renderScreen();

      expect(
        screen.queryByTestId('ingredient-detail-usda-link'),
      ).not.toBeOnTheScreen();
      expect(
        screen.queryByText('Source: USDA FoodData Central ›'),
      ).not.toBeOnTheScreen();
    });

    it('shows an alert when the page cannot be opened', async () => {
      const user = userEvent.setup();
      jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('No handler'));
      const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
      mockIngredientQuery({ data: makeIngredient() });
      await renderScreen();

      await user.press(screen.getByTestId('ingredient-detail-usda-link'));

      expect(alert).toHaveBeenCalledTimes(1);
      expect(alert).toHaveBeenCalledWith("Couldn't open the USDA page");
    });
  });
});
