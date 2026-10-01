import React from 'react';
import { render, screen, userEvent } from '@testing-library/react-native';
import { NO_FILTERS, RecipeFilters } from '../recipes/recipeFilters';
import { RecipeFilterBar } from './RecipeFilterBar';

const sources = [
  { key: 'cookbook', label: 'Cookbook' },
  { key: 'mom', label: 'Mom' },
];

type User = ReturnType<typeof userEvent.setup>;

async function renderBar(
  filters: RecipeFilters = NO_FILTERS,
  barSources = sources,
) {
  const onChange = jest.fn();
  await render(
    <RecipeFilterBar
      filters={filters}
      sources={barSources}
      onChange={onChange}
    />,
  );
  return onChange;
}

function filtersButton() {
  return screen.getByRole('button', { name: /^Filters/ });
}

async function openFilters(user: User) {
  await user.press(filtersButton());
}

describe('RecipeFilterBar', () => {
  it('shows the time chips with "Any time" selected by default', async () => {
    const user = userEvent.setup();
    await renderBar();
    await openFilters(user);

    expect(screen.getByRole('radio', { name: 'Any time' })).toBeChecked();
    expect(
      screen.getByRole('radio', { name: 'Up to 15 min' }),
    ).not.toBeChecked();
    expect(
      screen.getByRole('radio', { name: 'Up to 30 min' }),
    ).not.toBeChecked();
    expect(screen.getByRole('radio', { name: 'Up to 1 h' })).not.toBeChecked();
  });

  it('marks the selected time and source chips', async () => {
    const user = userEvent.setup();
    await renderBar({ query: '', maxMinutes: 30, source: 'mom' });
    await openFilters(user);

    expect(screen.getByRole('radio', { name: 'Up to 30 min' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Any time' })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: 'From Mom' })).toBeChecked();
    expect(
      screen.getByRole('radio', { name: 'From anywhere' }),
    ).not.toBeChecked();
  });

  it('lists the From chips in the given order with the source labels', async () => {
    const user = userEvent.setup();
    await renderBar();
    await openFilters(user);

    expect(screen.getByRole('radio', { name: 'From anywhere' })).toBeChecked();
    expect(screen.getByTestId('recipes-from-0')).toHaveTextContent(
      'From Cookbook',
    );
    expect(screen.getByTestId('recipes-from-1')).toHaveTextContent('From Mom');
  });

  it('hides the From row when there are no sources', async () => {
    const user = userEvent.setup();
    await renderBar(NO_FILTERS, []);
    await openFilters(user);

    expect(
      screen.queryByRole('radio', { name: 'From anywhere' }),
    ).not.toBeOnTheScreen();
    expect(screen.getByRole('radio', { name: 'Any time' })).toBeOnTheScreen();
  });

  it('reports each typed character as the new query, keeping other filters', async () => {
    const user = userEvent.setup();
    const onChange = await renderBar({
      query: '',
      maxMinutes: 15,
      source: 'mom',
    });

    await user.type(
      screen.getByLabelText('Search recipes and ingredients'),
      'ab',
    );

    expect(onChange).toHaveBeenLastCalledWith({
      query: 'b',
      maxMinutes: 15,
      source: 'mom',
    });
  });

  it('shows the current query in the search box', async () => {
    await renderBar({ ...NO_FILTERS, query: 'soup' });

    expect(
      screen.getByLabelText('Search recipes and ingredients'),
    ).toHaveDisplayValue('soup');
  });

  it('selects a time limit, keeping the query and source', async () => {
    const user = userEvent.setup();
    const onChange = await renderBar({
      query: 'soup',
      maxMinutes: null,
      source: 'mom',
    });
    await openFilters(user);

    await user.press(screen.getByRole('radio', { name: 'Up to 1 h' }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({
      query: 'soup',
      maxMinutes: 60,
      source: 'mom',
    });
  });

  it('clears the time limit when the selected chip is tapped again', async () => {
    const user = userEvent.setup();
    const onChange = await renderBar({ ...NO_FILTERS, maxMinutes: 15 });
    await openFilters(user);

    await user.press(screen.getByRole('radio', { name: 'Up to 15 min' }));

    expect(onChange).toHaveBeenCalledWith({ ...NO_FILTERS, maxMinutes: null });
  });

  it('switches straight from one time limit to another', async () => {
    const user = userEvent.setup();
    const onChange = await renderBar({ ...NO_FILTERS, maxMinutes: 15 });
    await openFilters(user);

    await user.press(screen.getByRole('radio', { name: 'Up to 30 min' }));

    expect(onChange).toHaveBeenCalledWith({ ...NO_FILTERS, maxMinutes: 30 });
  });

  it('clears the time limit from "Any time"', async () => {
    const user = userEvent.setup();
    const onChange = await renderBar({ ...NO_FILTERS, maxMinutes: 60 });
    await openFilters(user);

    await user.press(screen.getByRole('radio', { name: 'Any time' }));

    expect(onChange).toHaveBeenCalledWith({ ...NO_FILTERS, maxMinutes: null });
  });

  it('selects a source by its key, keeping the query and time', async () => {
    const user = userEvent.setup();
    const onChange = await renderBar({
      query: 'soup',
      maxMinutes: 30,
      source: null,
    });
    await openFilters(user);

    await user.press(screen.getByRole('radio', { name: 'From Mom' }));

    expect(onChange).toHaveBeenCalledWith({
      query: 'soup',
      maxMinutes: 30,
      source: 'mom',
    });
  });

  it('clears the source when the selected chip is tapped again', async () => {
    const user = userEvent.setup();
    const onChange = await renderBar({ ...NO_FILTERS, source: 'mom' });
    await openFilters(user);

    await user.press(screen.getByRole('radio', { name: 'From Mom' }));

    expect(onChange).toHaveBeenCalledWith({ ...NO_FILTERS, source: null });
  });

  it('clears the source from "From anywhere"', async () => {
    const user = userEvent.setup();
    const onChange = await renderBar({ ...NO_FILTERS, source: 'cookbook' });
    await openFilters(user);

    await user.press(screen.getByRole('radio', { name: 'From anywhere' }));

    expect(onChange).toHaveBeenCalledWith({ ...NO_FILTERS, source: null });
  });
});

describe('RecipeFilterBar Filters button', () => {
  it('hides the chips by default but always shows the search box', async () => {
    await renderBar();

    expect(
      screen.getByLabelText('Search recipes and ingredients'),
    ).toBeOnTheScreen();
    expect(filtersButton()).toBeCollapsed();
    expect(
      screen.queryByRole('radio', { name: 'Any time' }),
    ).not.toBeOnTheScreen();
    expect(
      screen.queryByRole('radio', { name: 'From anywhere' }),
    ).not.toBeOnTheScreen();
  });

  it('shows the chips on press and hides them on a second press', async () => {
    const user = userEvent.setup();
    await renderBar();

    await openFilters(user);

    expect(filtersButton()).toBeExpanded();
    expect(screen.getByRole('radio', { name: 'Any time' })).toBeOnTheScreen();
    expect(
      screen.getByRole('radio', { name: 'From anywhere' }),
    ).toBeOnTheScreen();

    await user.press(filtersButton());

    expect(filtersButton()).toBeCollapsed();
    expect(
      screen.queryByRole('radio', { name: 'Any time' }),
    ).not.toBeOnTheScreen();
    expect(
      screen.queryByRole('radio', { name: 'From anywhere' }),
    ).not.toBeOnTheScreen();
  });

  it('does not change the filters when opened or closed', async () => {
    const user = userEvent.setup();
    const onChange = await renderBar({
      query: '',
      maxMinutes: 30,
      source: 'mom',
    });

    await openFilters(user);
    await user.press(filtersButton());

    expect(onChange).not.toHaveBeenCalled();
  });

  it('reads plain "Filters" with no chip filter on', async () => {
    await renderBar();

    expect(filtersButton()).not.toHaveTextContent(/d/);
    expect(filtersButton()).toHaveAccessibleName('Filters');
  });

  it('counts time and source as two filters on', async () => {
    await renderBar({ query: '', maxMinutes: 30, source: 'mom' });

    expect(filtersButton()).toHaveTextContent('2', { exact: true });
    expect(filtersButton()).toHaveAccessibleName('Filters, 2 on');
  });

  it('counts a time limit alone as one filter on', async () => {
    await renderBar({ ...NO_FILTERS, maxMinutes: 15 });

    expect(filtersButton()).toHaveTextContent('1', { exact: true });
    expect(filtersButton()).toHaveAccessibleName('Filters, 1 on');
  });

  it('counts a source alone as one filter on', async () => {
    await renderBar({ ...NO_FILTERS, source: 'cookbook' });

    expect(filtersButton()).toHaveTextContent('1', { exact: true });
    expect(filtersButton()).toHaveAccessibleName('Filters, 1 on');
  });

  it('does not count the search text', async () => {
    await renderBar({ ...NO_FILTERS, query: 'soup' });

    expect(filtersButton()).not.toHaveTextContent(/d/);
    expect(filtersButton()).toHaveAccessibleName('Filters');
  });

  it('counts only the chip filters when search text is also set', async () => {
    await renderBar({ query: 'soup', maxMinutes: 60, source: null });

    expect(filtersButton()).toHaveTextContent('1', { exact: true });
    expect(filtersButton()).toHaveAccessibleName('Filters, 1 on');
  });
});
