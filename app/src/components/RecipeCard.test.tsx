import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { Recipe } from '../api/recipesClient';
import { RecipeCard } from './RecipeCard';

const recipe: Recipe = {
  id: 'r1',
  title: 'Lemony Mushroom Risotto',
  ingredients: ['rice', 'mushrooms', 'lemon'],
  instructions: 'Stir.',
  story:
    'Risotto has a reputation for being fussy.\n\nA second paragraph that stays hidden.',
  imageUrl: 'https://example.com/risotto.jpg',
  source: null,
  prepMinutes: 10,
  cookMinutes: 35,
  servings: 4,
  forkedFrom: null,
  lines: [],
  forks: [],
  createdAt: '2026-08-27T12:00:00.000Z',
  updatedAt: '2026-08-27T12:00:00.000Z',
};

describe('RecipeCard', () => {
  it('shows the post date, title, story excerpt and meta line', async () => {
    await render(<RecipeCard recipe={recipe} />);

    expect(screen.getByText('AUGUST 27, 2026')).toBeOnTheScreen();
    expect(screen.getByText('Lemony Mushroom Risotto')).toBeOnTheScreen();
    expect(
      screen.getByText('Risotto has a reputation for being fussy.'),
    ).toBeOnTheScreen();
    expect(
      screen.getByText('45 min   ·   Serves 4   ·   3 ingredients'),
    ).toBeOnTheScreen();
  });

  it('only shows the first paragraph of the story', async () => {
    await render(<RecipeCard recipe={recipe} />);

    expect(screen.queryByText(/second paragraph/)).not.toBeOnTheScreen();
  });

  it('omits the excerpt when there is no story', async () => {
    await render(<RecipeCard recipe={{ ...recipe, story: null }} />);

    expect(screen.queryByText(/reputation/)).not.toBeOnTheScreen();
  });

  it("falls back to the title's first letter when there is no photo", async () => {
    await render(<RecipeCard recipe={{ ...recipe, imageUrl: null }} />);

    expect(screen.getByText('L')).toBeOnTheScreen();
  });

  it('does not show the letter placeholder when there is a photo', async () => {
    await render(<RecipeCard recipe={recipe} />);

    expect(screen.queryByText('L')).not.toBeOnTheScreen();
  });

  it('shows no "from" line for a recipe that was not saved from another', async () => {
    await render(<RecipeCard recipe={recipe} />);

    expect(screen.queryByText(/^from /)).not.toBeOnTheScreen();
  });

  it('names the original under the title of a saved version', async () => {
    await render(
      <RecipeCard
        recipe={{
          ...recipe,
          forkedFrom: {
            id: 'r0',
            title: 'Plain Risotto',
            attemptId: 'a0',
            madeAt: '2026-08-20T12:00:00.000Z',
          },
        }}
      />,
    );

    expect(screen.getByTestId('recipe-card-forked-from-r1')).toHaveTextContent(
      'from Plain Risotto',
    );
  });
});
