import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation, usePreventRemove } from '@react-navigation/native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  activateKeepAwake,
  deactivateKeepAwake,
} from '@sayem314/react-native-keep-awake';
import {
  act,
  fireEvent,
  render,
  screen,
  userEvent,
  within,
} from '@testing-library/react-native';
import {
  Alert,
  AppState,
  AppStateStatus,
  ScrollView,
  TextInput,
  Vibration,
} from 'react-native';
import { launchCamera, launchImageLibrary } from 'react-native-image-picker';
import {
  AttemptDetail,
  Enjoyment,
  Fullness,
  Recipe,
  RecipesError,
} from '../api/recipesClient';
import { CookingDraft } from '../cooking/cookingDraft';
import { useAttempt, useCreateAttempt } from '../hooks/useAttempts';
import { useRecipe } from '../hooks/useRecipes';
import { AppStackParamList, Screens } from '../navigation/types';
import { colors } from '../theme';
import CookingScreen from './CookingScreen';

jest.mock('../hooks/useRecipes', () => ({
  useRecipe: jest.fn(),
}));

jest.mock('../hooks/useAttempts', () => ({
  useAttempt: jest.fn(),
  useCreateAttempt: jest.fn(),
}));

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: jest.fn(),
  // Needs a real navigator; tests read its arguments from the mock instead.
  usePreventRemove: jest.fn(),
}));

type Props = NativeStackScreenProps<AppStackParamList, Screens.Cooking>;

const mockedUseRecipe = jest.mocked(useRecipe);
const mockedUseNavigation = jest.mocked(useNavigation);
const mockedUsePreventRemove = jest.mocked(usePreventRemove);
const mockedUseCreateAttempt = jest.mocked(useCreateAttempt);
const mockedUseAttempt = jest.mocked(useAttempt);

// The past attempt for "Cook this version again". The default is what React
// Query returns for a disabled query (no fromAttemptId): pending, no data.
function mockAttemptQuery(
  state: {
    data?: AttemptDetail;
    isPending?: boolean;
    error?: Error | null;
  } = { isPending: true },
) {
  mockedUseAttempt.mockReturnValue({
    isPending: false,
    isError: state.error != null,
    error: null,
    ...state,
  } as unknown as ReturnType<typeof useAttempt>);
}

// The create-attempt mutation the screen gets. Tests change isPending/error
// with setAttemptState, and call mutate's onSuccess option themselves.
type AttemptMutation = {
  mutate: jest.Mock;
  reset: jest.Mock;
  isPending: boolean;
  error: Error | null;
};
let attemptMutation: AttemptMutation;

function mockAttemptMutation() {
  attemptMutation = {
    mutate: jest.fn(),
    reset: jest.fn(),
    isPending: false,
    error: null,
  };
  // A fresh object per render, like React Query's result.
  mockedUseCreateAttempt.mockImplementation(
    () =>
      ({ ...attemptMutation } as unknown as ReturnType<
        typeof useCreateAttempt
      >),
  );
}

// The arguments of the latest usePreventRemove call (the current render).
function lastPreventRemove() {
  const call = mockedUsePreventRemove.mock.calls.at(-1);
  if (!call) throw new Error('usePreventRemove was not called');
  const [prevent, callback] = call;
  return { prevent, callback };
}

function makeRecipe(overrides: Partial<Recipe> = {}): Recipe {
  return {
    id: 'r1',
    title: 'Sunday Pancakes',
    ingredients: ['1 cup flour', '2 eggs'],
    instructions: 'Whisk the batter.\nCook on a hot pan.',
    story: null,
    imageUrl: null,
    source: null,
    prepMinutes: 5,
    cookMinutes: 20,
    servings: 4,
    forkedFrom: null,
    lines: [],
    forks: [],
    createdAt: '2026-09-21T12:00:00.000Z',
    updatedAt: '2026-09-21T12:00:00.000Z',
    ...overrides,
  };
}

function mockRecipeQuery(state: {
  data?: Recipe;
  isPending?: boolean;
  isError?: boolean;
  error?: Error | null;
}) {
  mockedUseRecipe.mockReturnValue({
    isPending: false,
    isError: false,
    error: null,
    ...state,
  } as unknown as ReturnType<typeof useRecipe>);
}

// The screen listens to AppState to pause the cooking clock. resetAllMocks
// also resets the Jest preset's AppState mock (it would return undefined), so
// it is set up again here, keeping the listener for tests to call.
let appStateListener: ((state: AppStateStatus) => void) | undefined;
let removeAppStateListener: jest.Mock;

beforeEach(async () => {
  jest.resetAllMocks();
  mockAttemptMutation();
  mockAttemptQuery();
  // Cooking drafts are saved to the in-memory AsyncStorage mock, which lives
  // for the whole file; start each test without a draft. The mock's methods
  // are plain functions, so resetAllMocks leaves them working.
  await AsyncStorage.clear();
  appStateListener = undefined;
  removeAppStateListener = jest.fn();
  jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((_type, listener) => {
      appStateListener = listener;
      return { remove: removeAppStateListener };
    });
});

async function changeAppState(state: AppStateStatus) {
  if (!appStateListener) throw new Error('No AppState listener registered');
  const listener = appStateListener;
  await act(() => listener(state));
}

// The latest element renderScreen rendered, for setAttemptState to re-render.
let renderedScreen: React.ReactElement | undefined;

async function renderScreen(
  params: AppStackParamList[Screens.Cooking] = { recipeId: 'r1' },
) {
  const navigation = {
    setOptions: jest.fn(),
    navigate: jest.fn(),
    goBack: jest.fn(),
    popTo: jest.fn(),
    dispatch: jest.fn(),
  };
  const route = {
    key: 'Cooking-1',
    name: Screens.Cooking,
    params,
  };
  renderedScreen = (
    <CookingScreen
      navigation={navigation as unknown as Props['navigation']}
      route={route as Props['route']}
    />
  );
  await render(renderedScreen);
  return navigation;
}

// Moves the mocked mutation to a new state (pending, failed) and re-renders
// the screen so it picks that up, as React Query would.
async function setAttemptState(state: Partial<AttemptMutation>) {
  if (!renderedScreen) throw new Error('Render the screen first');
  Object.assign(attemptMutation, state);
  // A new element: React skips re-rendering the root for the same one.
  await screen.rerender(React.cloneElement(renderedScreen));
}

type Navigation = Awaited<ReturnType<typeof renderScreen>>;

// After saving or discarding, cooking mode closes back to recipe detail,
// also when it was opened from an attempt's detail screen.
function expectBackToRecipe(navigation: Navigation) {
  expect(navigation.popTo).toHaveBeenCalledTimes(1);
  expect(navigation.popTo).toHaveBeenCalledWith(Screens.RecipeDetail, {
    recipeId: 'r1',
  });
  expect(navigation.goBack).not.toHaveBeenCalled();
}

// The header options as the navigator would have them: setOptions merges.
function headerOptions(navigation: Navigation) {
  return Object.assign(
    {},
    ...navigation.setOptions.mock.calls.map(([options]) => options),
  );
}

type Element = ReturnType<typeof screen.getByTestId>;

// The nearest ancestor that reports its layout: for a checkbox that is its
// row (which also carries the highlight), for a row it is the section.
function layoutParent(element: Element): Element {
  let node = element.parent;
  while (node && !node.props.onLayout) node = node.parent;
  if (!node) throw new Error('No ancestor with onLayout');
  return node;
}

const highlighted = { borderLeftColor: colors.accent };

describe('CookingScreen', () => {
  it('loads the recipe from the route and titles the header with it', async () => {
    mockRecipeQuery({ data: makeRecipe() });
    const navigation = await renderScreen();

    expect(mockedUseRecipe).toHaveBeenCalledWith('r1');
    expect(headerOptions(navigation)).toMatchObject({
      title: 'Sunday Pancakes',
    });
  });

  it('uses an empty header title while the recipe is loading', async () => {
    mockRecipeQuery({ isPending: true });
    const navigation = await renderScreen();

    expect(navigation.setOptions).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: '' }),
    );
    expect(screen.queryByTestId('cooking-error-text')).not.toBeOnTheScreen();
  });

  it('shows the error message when the recipe fails to load', async () => {
    mockRecipeQuery({
      isError: true,
      error: new RecipesError('Request failed (500)', 500),
    });
    await renderScreen();

    expect(screen.getByTestId('cooking-error-text')).toHaveTextContent(
      'Request failed (500)',
    );
  });

  it('adds a Stop cooking header button that goes back', async () => {
    const user = userEvent.setup();
    const goBack = jest.fn();
    mockedUseNavigation.mockReturnValue({ goBack } as unknown as ReturnType<
      typeof useNavigation
    >);
    mockRecipeQuery({ data: makeRecipe() });
    const navigation = await renderScreen();

    const { headerLeft } = headerOptions(navigation);
    await render(headerLeft());
    await user.press(screen.getByRole('button', { name: 'Stop cooking' }));

    expect(goBack).toHaveBeenCalledTimes(1);
  });

  it('keeps the screen awake while cooking and releases it on exit', async () => {
    mockRecipeQuery({ data: makeRecipe() });
    await renderScreen();

    expect(activateKeepAwake).toHaveBeenCalledTimes(1);
    expect(deactivateKeepAwake).not.toHaveBeenCalled();

    await screen.unmount();

    expect(deactivateKeepAwake).toHaveBeenCalledTimes(1);
  });
});

describe('CookingScreen ingredients checklist', () => {
  it('lists every ingredient as an unchecked checkbox row', async () => {
    mockRecipeQuery({ data: makeRecipe() });
    await renderScreen();

    expect(screen.getByText('INGREDIENTS')).toBeOnTheScreen();
    expect(screen.getByText('0 of 2 used')).toBeOnTheScreen();

    const flour = screen.getByRole('checkbox', { name: '1 cup flour' });
    const eggs = screen.getByRole('checkbox', { name: '2 eggs' });
    expect(flour).toBe(screen.getByTestId('cooking-ingredient-0'));
    expect(eggs).toBe(screen.getByTestId('cooking-ingredient-1'));
    expect(flour).not.toBeChecked();
    expect(eggs).not.toBeChecked();
    // ✎ is its own button next to the checkbox, not inside it.
    const editFlour = screen.getByRole('button', {
      name: 'Edit "1 cup flour"',
    });
    expect(flour).not.toContainElement(editFlour);
    expect(
      screen.getByRole('button', { name: 'Edit "2 eggs"' }),
    ).toBeOnTheScreen();
  });

  it('checks an ingredient on tap and unchecks it on a second tap', async () => {
    const user = userEvent.setup();
    mockRecipeQuery({ data: makeRecipe() });
    await renderScreen();

    const flour = screen.getByRole('checkbox', { name: '1 cup flour' });
    await user.press(flour);

    expect(flour).toBeChecked();
    expect(screen.getByRole('checkbox', { name: '2 eggs' })).not.toBeChecked();
    expect(screen.getByText('1 of 2 used')).toBeOnTheScreen();

    await user.press(flour);

    expect(flour).not.toBeChecked();
    expect(screen.getByText('0 of 2 used')).toBeOnTheScreen();
  });
});

describe('CookingScreen steps checklist', () => {
  const stepOne = 'Step 1: Whisk the batter.';
  const stepTwo = 'Step 2: Cook on a hot pan.';
  const stepThree = 'Step 3: Serve warm.';

  it('splits instructions into trimmed steps and ignores blank lines', async () => {
    mockRecipeQuery({
      data: makeRecipe({
        instructions: '  Whisk the batter.  \n\n   \nCook on a hot pan.\n',
      }),
    });
    await renderScreen();

    expect(screen.getByText('STEPS')).toBeOnTheScreen();
    expect(screen.getByText('0 of 2 done')).toBeOnTheScreen();

    const first = screen.getByRole('checkbox', { name: stepOne });
    const second = screen.getByRole('checkbox', { name: stepTwo });
    expect(first).toBe(screen.getByTestId('cooking-step-0'));
    expect(second).toBe(screen.getByTestId('cooking-step-1'));
    expect(first).toHaveTextContent('1Whisk the batter.');
    expect(first).not.toBeChecked();
    expect(second).not.toBeChecked();
    expect(screen.queryByTestId('cooking-step-2')).not.toBeOnTheScreen();
  });

  it('checks a step on tap, updates the counter, and unchecks on a second tap', async () => {
    const user = userEvent.setup();
    mockRecipeQuery({ data: makeRecipe() });
    await renderScreen();

    const first = screen.getByRole('checkbox', { name: stepOne });
    await user.press(first);

    expect(first).toBeChecked();
    expect(screen.getByRole('checkbox', { name: stepTwo })).not.toBeChecked();
    expect(screen.getByText('1 of 2 done')).toBeOnTheScreen();

    await user.press(first);

    expect(first).not.toBeChecked();
    expect(screen.getByText('0 of 2 done')).toBeOnTheScreen();
  });

  it('highlights the first unchecked step and moves the highlight as steps are done', async () => {
    const user = userEvent.setup();
    mockRecipeQuery({
      data: makeRecipe({
        instructions: 'Whisk the batter.\nCook on a hot pan.\nServe warm.',
      }),
    });
    await renderScreen();

    const first = screen.getByRole('checkbox', { name: stepOne });
    const second = screen.getByRole('checkbox', { name: stepTwo });
    const third = screen.getByRole('checkbox', { name: stepThree });
    // The highlight is on the whole row, the checkbox's layout parent.
    const firstRow = layoutParent(first);
    const secondRow = layoutParent(second);
    const thirdRow = layoutParent(third);

    expect(firstRow).toHaveStyle(highlighted);
    expect(secondRow).not.toHaveStyle(highlighted);
    expect(thirdRow).not.toHaveStyle(highlighted);

    await user.press(first);
    expect(firstRow).not.toHaveStyle(highlighted);
    expect(secondRow).toHaveStyle(highlighted);

    await user.press(second);
    expect(secondRow).not.toHaveStyle(highlighted);
    expect(thirdRow).toHaveStyle(highlighted);

    // Unchecking a step in the middle makes it the next one again.
    await user.press(second);
    expect(secondRow).toHaveStyle(highlighted);
    expect(thirdRow).not.toHaveStyle(highlighted);

    await user.press(second);
    await user.press(third);
    expect(screen.getByText('3 of 3 done')).toBeOnTheScreen();
    expect(firstRow).not.toHaveStyle(highlighted);
    expect(secondRow).not.toHaveStyle(highlighted);
    expect(thirdRow).not.toHaveStyle(highlighted);
  });

  it('scrolls the next step into view when a step is checked, not when unchecked', async () => {
    const user = userEvent.setup();
    // The Jest preset's ScrollView mock puts a jest.fn scrollTo on the prototype.
    const scrollTo = jest.spyOn(ScrollView.prototype, 'scrollTo');
    mockRecipeQuery({ data: makeRecipe() });
    await renderScreen();

    const first = screen.getByRole('checkbox', { name: stepOne });
    const second = screen.getByRole('checkbox', { name: stepTwo });
    const layout = (y: number) => ({ nativeEvent: { layout: { y } } });
    // Rows report their offset within the steps section, and the section
    // reports its own offset within the scroll content.
    const firstRow = layoutParent(first);
    await fireEvent(layoutParent(firstRow), 'layout', layout(300));
    await fireEvent(firstRow, 'layout', layout(0));
    await fireEvent(layoutParent(second), 'layout', layout(80));

    await user.press(first);

    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith({ y: 300 + 80 - 16, animated: true });

    await user.press(first);
    expect(scrollTo).toHaveBeenCalledTimes(1);

    // Checking the last remaining step leaves nothing to scroll to.
    await user.press(first);
    await user.press(second);
    expect(scrollTo).toHaveBeenCalledTimes(2);
  });
});

describe('CookingScreen line edits for this attempt', () => {
  const threeSteps = 'Whisk the batter.\nCook on a hot pan.\nServe warm.';
  type User = ReturnType<typeof userEvent.setup>;

  async function openEditor(user: User, text: string) {
    await user.press(screen.getByRole('button', { name: `Edit "${text}"` }));
  }

  async function replaceText(user: User, input: Element, text: string) {
    await user.clear(input);
    await user.type(input, text);
  }

  function rowOfStep(name: string) {
    return layoutParent(screen.getByRole('checkbox', { name }));
  }

  it('opens the editor prefilled with the line when ✎ is pressed', async () => {
    const user = userEvent.setup();
    mockRecipeQuery({ data: makeRecipe() });
    await renderScreen();

    await openEditor(user, '2 eggs');

    expect(screen.getByDisplayValue('2 eggs')).toBeOnTheScreen();
    expect(
      screen.queryByRole('checkbox', { name: '2 eggs' }),
    ).not.toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    // The other rows stay as they were.
    expect(
      screen.getByRole('checkbox', { name: '1 cup flour' }),
    ).toBeOnTheScreen();
  });

  it('shows the saved text with the struck original, and undo restores it', async () => {
    const user = userEvent.setup();
    mockRecipeQuery({ data: makeRecipe() });
    await renderScreen();

    await openEditor(user, '2 eggs');
    // Extra whitespace is cleaned up on save.
    await replaceText(user, screen.getByDisplayValue('2 eggs'), '  3   eggs ');
    await user.press(screen.getByRole('button', { name: 'Save' }));

    expect(screen.getByRole('checkbox', { name: '3 eggs' })).toBeOnTheScreen();
    expect(
      screen.queryByRole('checkbox', { name: '2 eggs' }),
    ).not.toBeOnTheScreen();
    expect(screen.getByText(/^was:/)).toHaveTextContent('was: 2 eggs ·');
    expect(screen.getByText('2 eggs')).toHaveStyle({
      textDecorationLine: 'line-through',
    });
    expect(screen.queryByDisplayValue(/eggs/)).not.toBeOnTheScreen();
    expect(screen.getByText('0 of 2 used')).toBeOnTheScreen();

    await user.press(
      screen.getByRole('button', { name: 'Undo change to "2 eggs"' }),
    );

    expect(screen.getByRole('checkbox', { name: '2 eggs' })).toBeOnTheScreen();
    expect(screen.queryByText(/^was:/)).not.toBeOnTheScreen();
    expect(
      screen.queryByRole('button', { name: 'Undo change to "2 eggs"' }),
    ).not.toBeOnTheScreen();
  });

  it('keeps the line as it was when the edit is cancelled', async () => {
    const user = userEvent.setup();
    mockRecipeQuery({ data: makeRecipe() });
    await renderScreen();

    await openEditor(user, '2 eggs');
    await replaceText(user, screen.getByDisplayValue('2 eggs'), '3 eggs');
    await user.press(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.getByRole('checkbox', { name: '2 eggs' })).toBeOnTheScreen();
    expect(
      screen.queryByRole('checkbox', { name: '3 eggs' }),
    ).not.toBeOnTheScreen();
    expect(screen.queryByText(/^was:/)).not.toBeOnTheScreen();
    expect(screen.queryByDisplayValue('3 eggs')).not.toBeOnTheScreen();
  });

  it('disables Save while the text is blank or only whitespace', async () => {
    const user = userEvent.setup();
    mockRecipeQuery({ data: makeRecipe() });
    await renderScreen();

    await openEditor(user, '2 eggs');
    const input = screen.getByDisplayValue('2 eggs');
    await user.clear(input);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

    await user.type(input, '   ');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

    await user.type(input, 'x');
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it('marks a removed line, drops it from the count, and undo brings it back', async () => {
    const user = userEvent.setup();
    mockRecipeQuery({ data: makeRecipe() });
    await renderScreen();

    // A checked line that gets removed no longer counts as used.
    await user.press(screen.getByRole('checkbox', { name: '1 cup flour' }));
    expect(screen.getByText('1 of 2 used')).toBeOnTheScreen();

    await openEditor(user, '1 cup flour');
    await user.press(screen.getByRole('button', { name: 'Remove' }));

    expect(screen.getByText(/^Removed/)).toBeOnTheScreen();
    expect(screen.getByText('1 cup flour')).toHaveStyle({
      textDecorationLine: 'line-through',
    });
    expect(
      screen.queryByRole('checkbox', { name: '1 cup flour' }),
    ).not.toBeOnTheScreen();
    expect(
      screen.queryByRole('button', { name: 'Edit "1 cup flour"' }),
    ).not.toBeOnTheScreen();
    expect(screen.getByText('0 of 1 used')).toBeOnTheScreen();

    await user.press(
      screen.getByRole('button', { name: 'Undo change to "1 cup flour"' }),
    );

    expect(screen.queryByText(/^Removed/)).not.toBeOnTheScreen();
    // It comes back as it was before the removal, check included.
    expect(screen.getByRole('checkbox', { name: '1 cup flour' })).toBeChecked();
    expect(screen.getByText('1 of 2 used')).toBeOnTheScreen();
  });

  it('adds an ingredient marked "Added this time"', async () => {
    const user = userEvent.setup();
    mockRecipeQuery({ data: makeRecipe() });
    await renderScreen();

    await user.press(screen.getByRole('button', { name: '+ Add ingredient' }));

    const input = screen.getByPlaceholderText('New ingredient');
    expect(input).toHaveDisplayValue('');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    // Nothing to remove yet, and the editor takes the add button's place.
    expect(
      screen.queryByRole('button', { name: 'Remove' }),
    ).not.toBeOnTheScreen();
    expect(
      screen.queryByRole('button', { name: '+ Add ingredient' }),
    ).not.toBeOnTheScreen();

    await user.type(input, 'a pinch of salt');
    await user.press(screen.getByRole('button', { name: 'Save' }));

    expect(
      screen.getByRole('checkbox', { name: 'a pinch of salt' }),
    ).toBeOnTheScreen();
    expect(screen.getByText('Added this time')).toBeOnTheScreen();
    expect(screen.getByText('0 of 3 used')).toBeOnTheScreen();
    expect(
      screen.getByRole('button', { name: '+ Add ingredient' }),
    ).toBeOnTheScreen();
  });

  it('adds nothing when adding a line is cancelled', async () => {
    const user = userEvent.setup();
    mockRecipeQuery({ data: makeRecipe() });
    await renderScreen();

    await user.press(screen.getByRole('button', { name: '+ Add step' }));
    await user.type(screen.getByPlaceholderText('New step'), 'Serve warm.');
    await user.press(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByText('Serve warm.')).not.toBeOnTheScreen();
    expect(screen.queryByText('Added this time')).not.toBeOnTheScreen();
    expect(screen.getByText('0 of 2 done')).toBeOnTheScreen();
  });

  it('adds a step with the next step number and grows the counter', async () => {
    const user = userEvent.setup();
    mockRecipeQuery({ data: makeRecipe() });
    await renderScreen();

    await user.press(screen.getByRole('button', { name: '+ Add step' }));
    await user.type(screen.getByPlaceholderText('New step'), 'Serve warm.');
    await user.press(screen.getByRole('button', { name: 'Save' }));

    const added = screen.getByRole('checkbox', { name: 'Step 3: Serve warm.' });
    expect(added).toHaveTextContent('3Serve warm.');
    expect(screen.getByText('Added this time')).toBeOnTheScreen();
    expect(screen.getByText('0 of 3 done')).toBeOnTheScreen();
  });

  it('renumbers the following steps and moves the highlight past a removed step', async () => {
    const user = userEvent.setup();
    mockRecipeQuery({ data: makeRecipe({ instructions: threeSteps }) });
    await renderScreen();

    await user.press(
      screen.getByRole('checkbox', { name: 'Step 1: Whisk the batter.' }),
    );
    // Step 2 is next; remove it.
    expect(rowOfStep('Step 2: Cook on a hot pan.')).toHaveStyle(highlighted);
    await openEditor(user, 'Cook on a hot pan.');
    await user.press(screen.getByRole('button', { name: 'Remove' }));

    expect(
      screen.queryByRole('checkbox', { name: /Cook on a hot pan/ }),
    ).not.toBeOnTheScreen();
    const serve = screen.getByRole('checkbox', { name: 'Step 2: Serve warm.' });
    expect(serve).toHaveTextContent('2Serve warm.');
    expect(layoutParent(serve)).toHaveStyle(highlighted);
    expect(screen.getByText('1 of 2 done')).toBeOnTheScreen();

    await user.press(
      screen.getByRole('button', {
        name: 'Undo change to "Cook on a hot pan."',
      }),
    );

    expect(rowOfStep('Step 2: Cook on a hot pan.')).toHaveStyle(highlighted);
    expect(rowOfStep('Step 3: Serve warm.')).not.toHaveStyle(highlighted);
    expect(screen.getByText('1 of 3 done')).toBeOnTheScreen();
  });

  it('never modifies the saved recipe', async () => {
    const user = userEvent.setup();
    const recipe = makeRecipe({ instructions: threeSteps });
    const saved = { ...recipe, ingredients: [...recipe.ingredients] };
    mockRecipeQuery({ data: recipe });
    await renderScreen();

    await openEditor(user, '2 eggs');
    await replaceText(user, screen.getByDisplayValue('2 eggs'), '3 eggs');
    await user.press(screen.getByRole('button', { name: 'Save' }));
    await openEditor(user, '1 cup flour');
    await user.press(screen.getByRole('button', { name: 'Remove' }));
    await user.press(screen.getByRole('button', { name: '+ Add ingredient' }));
    await user.type(screen.getByPlaceholderText('New ingredient'), 'salt');
    await user.press(screen.getByRole('button', { name: 'Save' }));

    await openEditor(user, 'Whisk the batter.');
    await replaceText(
      user,
      screen.getByDisplayValue('Whisk the batter.'),
      'Whisk well.',
    );
    await user.press(screen.getByRole('button', { name: 'Save' }));
    await openEditor(user, 'Serve warm.');
    await user.press(screen.getByRole('button', { name: 'Remove' }));
    await user.press(screen.getByRole('button', { name: '+ Add step' }));
    await user.type(screen.getByPlaceholderText('New step'), 'Enjoy.');
    await user.press(screen.getByRole('button', { name: 'Save' }));

    expect(screen.getByText('0 of 2 used')).toBeOnTheScreen();
    expect(screen.getByText('0 of 3 done')).toBeOnTheScreen();
    expect(recipe).toEqual(saved);
  });
});

describe('CookingScreen section headings', () => {
  const layerCake = makeRecipe({
    title: 'Lemon layer cake',
    ingredients: [
      '# For the cake',
      '2 cups flour',
      '3 eggs',
      '# For the cream',
      '200 ml cream',
    ],
    instructions: [
      '# For the cake',
      'Mix flour and eggs.',
      'Bake 30 min.',
      '## For the cream',
      'Whip the cream.',
    ].join('\n'),
  });

  const step = (number: number, text: string) =>
    screen.getByRole('checkbox', { name: `Step ${number}: ${text}` });

  it('shows headings as header rows without #, with no checkbox, ✎ or ✍', async () => {
    mockRecipeQuery({ data: layerCake });
    await renderScreen();

    const cakeIngredients = screen.getByTestId('cooking-ingredient-heading-0');
    const creamSteps = screen.getByTestId('cooking-step-heading-3');
    expect(cakeIngredients).toHaveTextContent('For the cake', { exact: true });
    expect(creamSteps).toHaveTextContent('For the cream', { exact: true });
    expect(screen.getAllByRole('header', { name: 'For the cake' })).toContain(
      cakeIngredients,
    );
    expect(screen.getAllByRole('header', { name: 'For the cream' })).toContain(
      creamSteps,
    );

    expect(screen.queryByText(/#/)).not.toBeOnTheScreen();
    expect(screen.queryByTestId('cooking-ingredient-0')).not.toBeOnTheScreen();
    expect(screen.queryByTestId('cooking-step-3')).not.toBeOnTheScreen();
    expect(
      screen.queryByTestId('cooking-ingredient-edit-0'),
    ).not.toBeOnTheScreen();
    expect(screen.queryByTestId('cooking-step-edit-0')).not.toBeOnTheScreen();
    expect(screen.queryByTestId('cooking-step-note-0')).not.toBeOnTheScreen();
    expect(screen.queryByTestId('cooking-step-note-3')).not.toBeOnTheScreen();
    // 3 ingredients + 3 steps are checkable, nothing else.
    expect(screen.getAllByRole('checkbox')).toHaveLength(6);
    expect(screen.getAllByText('✎')).toHaveLength(6);
    expect(screen.getAllByText('✍')).toHaveLength(3);
  });

  it('leaves headings out of the "x of y" counters', async () => {
    const user = userEvent.setup();
    mockRecipeQuery({ data: layerCake });
    await renderScreen();

    expect(screen.getByText('0 of 3 used')).toBeOnTheScreen();
    expect(screen.getByText('0 of 3 done')).toBeOnTheScreen();

    await user.press(screen.getByRole('checkbox', { name: '200 ml cream' }));
    await user.press(step(3, 'Whip the cream.'));

    expect(screen.getByText('1 of 3 used')).toBeOnTheScreen();
    expect(screen.getByText('1 of 3 done')).toBeOnTheScreen();
  });

  it('numbers steps straight through the sections', async () => {
    mockRecipeQuery({ data: layerCake });
    await renderScreen();

    expect(step(1, 'Mix flour and eggs.')).toBe(
      screen.getByTestId('cooking-step-1'),
    );
    expect(step(2, 'Bake 30 min.')).toBe(screen.getByTestId('cooking-step-2'));
    const whip = step(3, 'Whip the cream.');
    expect(whip).toBe(screen.getByTestId('cooking-step-4'));
    expect(whip).toHaveTextContent('3Whip the cream.');
    expect(screen.getByRole('button', { name: 'Add a note for step 3' })).toBe(
      screen.getByTestId('cooking-step-note-4'),
    );
  });

  it('never makes a heading the next step', async () => {
    const user = userEvent.setup();
    mockRecipeQuery({ data: layerCake });
    await renderScreen();

    const cakeHeading = screen.getByTestId('cooking-step-heading-0');
    const creamHeading = screen.getByTestId('cooking-step-heading-3');
    expect(layoutParent(step(1, 'Mix flour and eggs.'))).toHaveStyle(
      highlighted,
    );
    expect(layoutParent(cakeHeading)).not.toHaveStyle(highlighted);

    await user.press(step(1, 'Mix flour and eggs.'));
    await user.press(step(2, 'Bake 30 min.'));

    expect(layoutParent(step(3, 'Whip the cream.'))).toHaveStyle(highlighted);
    expect(layoutParent(creamHeading)).not.toHaveStyle(highlighted);
  });

  it('gives a heading no timer chip, even when it mentions a duration', async () => {
    mockRecipeQuery({
      data: makeRecipe({
        instructions: '# Rest 10 minutes\nBake 30 min.\nCool.',
      }),
    });
    await renderScreen();

    expect(screen.queryByTestId('cooking-step-timer-0')).not.toBeOnTheScreen();
    expect(
      screen.getByRole('button', {
        name: 'Start a 30 minute timer for step 1',
      }),
    ).toBe(screen.getByTestId('cooking-step-timer-1'));
    expect(screen.getAllByText(/^⏱/)).toHaveLength(1);
  });

  it('makes a line added as "# …" a heading marked "Added this time", which undo takes away', async () => {
    const user = userEvent.setup();
    mockRecipeQuery({ data: layerCake });
    await renderScreen();

    await user.press(screen.getByRole('button', { name: '+ Add ingredient' }));
    await user.type(
      screen.getByPlaceholderText('New ingredient'),
      '# For the glaze',
    );
    await user.press(screen.getByRole('button', { name: 'Save' }));

    const glaze = screen.getByTestId('cooking-ingredient-heading-5');
    expect(glaze).toHaveTextContent('For the glaze', { exact: true });
    expect(glaze).toHaveAccessibleName('For the glaze');
    expect(screen.getByText(/^Added this time/)).toBeOnTheScreen();
    expect(screen.queryByTestId('cooking-ingredient-5')).not.toBeOnTheScreen();
    expect(screen.getByText('0 of 3 used')).toBeOnTheScreen();

    await user.press(screen.getByTestId('cooking-ingredient-undo-5'));

    expect(
      screen.queryByTestId('cooking-ingredient-heading-5'),
    ).not.toBeOnTheScreen();
    expect(screen.queryByText(/^Added this time/)).not.toBeOnTheScreen();
  });

  it('turns a checked step edited into "# …" into a heading that no longer counts, and undo brings it back', async () => {
    const user = userEvent.setup();
    mockRecipeQuery({ data: layerCake });
    await renderScreen();

    await user.press(step(2, 'Bake 30 min.'));
    expect(screen.getByText('1 of 3 done')).toBeOnTheScreen();

    await user.press(
      screen.getByRole('button', { name: 'Edit "Bake 30 min."' }),
    );
    const editor = screen.getByDisplayValue('Bake 30 min.');
    await user.clear(editor);
    await user.type(editor, '# To bake');
    await user.press(screen.getByRole('button', { name: 'Save' }));

    expect(screen.getByTestId('cooking-step-heading-2')).toHaveTextContent(
      'To bake',
      { exact: true },
    );
    expect(screen.getByText(/^was:/)).toHaveTextContent('was: Bake 30 min. ·');
    expect(screen.getByText('0 of 2 done')).toBeOnTheScreen();
    // The step after it moves up to number 2.
    expect(step(2, 'Whip the cream.')).toBeOnTheScreen();
    expect(screen.queryByTestId('cooking-step-timer-2')).not.toBeOnTheScreen();

    await user.press(screen.getByTestId('cooking-step-undo-2'));

    expect(step(2, 'Bake 30 min.')).toBeChecked();
    expect(screen.getByText('1 of 3 done')).toBeOnTheScreen();
  });

  it('counts only the draft’s non-heading steps in the resume prompt', async () => {
    const at = Date.now();
    const draft: CookingDraft = {
      version: 1,
      recipeId: 'r1',
      startedAt: at,
      savedAt: at,
      elapsedMs: 0,
      ingredients: null,
      instructions: null,
      checkedIngredients: [],
      checkedSteps: [1],
      notes: '',
      timers: [],
    };
    await AsyncStorage.setItem('cooking-draft:r1', JSON.stringify(draft));
    mockRecipeQuery({ data: layerCake });
    await renderScreen();

    expect(await screen.findByText('1 of 3 steps done.')).toBeOnTheScreen();
  });

  it('restores checks by line index after leaving and coming back', async () => {
    const user = userEvent.setup();
    mockRecipeQuery({ data: layerCake });
    await renderScreen();

    await user.press(screen.getByRole('checkbox', { name: '200 ml cream' }));
    await user.press(step(3, 'Whip the cream.'));
    await user.press(screen.getByRole('button', { name: '+ Add step' }));
    await user.type(screen.getByPlaceholderText('New step'), '# To serve');
    await user.press(screen.getByRole('button', { name: 'Save' }));
    await screen.unmount();

    await renderScreen();
    await user.press(await screen.findByRole('button', { name: 'Resume' }));

    expect(
      screen.getByRole('checkbox', { name: '200 ml cream' }),
    ).toBeChecked();
    expect(step(3, 'Whip the cream.')).toBeChecked();
    expect(screen.getByTestId('cooking-step-heading-5')).toHaveTextContent(
      'To serve',
      { exact: true },
    );
    expect(screen.getByText('1 of 3 used')).toBeOnTheScreen();
    expect(screen.getByText('1 of 3 done')).toBeOnTheScreen();
  });
});

describe('CookingScreen notes', () => {
  const placeholder = 'How is it going? Anything to change next time?';

  function notesInput() {
    return screen.getByLabelText('NOTES');
  }

  function noteButton(stepNumber: number) {
    return screen.getByRole('button', {
      name: `Add a note for step ${stepNumber}`,
    });
  }

  it('starts with an empty notes field showing its placeholder', async () => {
    mockRecipeQuery({ data: makeRecipe() });
    await renderScreen();

    expect(screen.getByText('NOTES')).toBeOnTheScreen();
    const input = screen.getByPlaceholderText(placeholder);
    expect(input).toBe(screen.getByTestId('cooking-notes-input'));
    expect(input).toBe(notesInput());
    expect(input).toHaveDisplayValue('');
  });

  it('keeps what is typed into the notes', async () => {
    const user = userEvent.setup();
    mockRecipeQuery({ data: makeRecipe() });
    await renderScreen();

    await user.type(notesInput(), 'Needs more salt');

    expect(notesInput()).toHaveDisplayValue('Needs more salt');
  });

  it('has a note button for each step but none for ingredients', async () => {
    mockRecipeQuery({ data: makeRecipe() });
    await renderScreen();

    expect(noteButton(1)).toBe(screen.getByTestId('cooking-step-note-0'));
    expect(noteButton(2)).toBe(screen.getByTestId('cooking-step-note-1'));
    expect(noteButton(1)).toHaveTextContent('✍');
    // Like ✎, it sits next to the checkbox, not inside it.
    expect(
      screen.getByRole('checkbox', { name: 'Step 1: Whisk the batter.' }),
    ).not.toContainElement(noteButton(1));
    expect(
      screen.queryByRole('button', { name: /Add a note for step 3/ }),
    ).not.toBeOnTheScreen();
    expect(
      screen.queryByTestId('cooking-ingredient-note-0'),
    ).not.toBeOnTheScreen();
    expect(
      screen.queryByTestId('cooking-ingredient-note-1'),
    ).not.toBeOnTheScreen();
    expect(screen.getAllByText('✍')).toHaveLength(2);
  });

  it('starts a "Step N: " line for the pressed step, on a new line after existing notes', async () => {
    const user = userEvent.setup();
    mockRecipeQuery({ data: makeRecipe() });
    await renderScreen();

    await user.press(noteButton(2));
    expect(notesInput()).toHaveDisplayValue('Step 2: ');

    await user.press(noteButton(1));
    expect(notesInput()).toHaveDisplayValue('Step 2: \nStep 1: ');
  });

  it('does not repeat the prefix when the same step button is pressed twice', async () => {
    const user = userEvent.setup();
    mockRecipeQuery({ data: makeRecipe() });
    await renderScreen();

    await user.type(notesInput(), 'Batter was lumpy');
    await user.press(noteButton(2));
    await user.press(noteButton(2));

    expect(notesInput()).toHaveDisplayValue('Batter was lumpy\nStep 2: ');
  });

  it('uses the shown step number after an earlier step is removed', async () => {
    const user = userEvent.setup();
    mockRecipeQuery({ data: makeRecipe() });
    await renderScreen();

    await user.press(
      screen.getByRole('button', { name: 'Edit "Whisk the batter."' }),
    );
    await user.press(screen.getByRole('button', { name: 'Remove' }));

    // The removed row has no note button; the old step 2 is now step 1.
    expect(screen.queryByTestId('cooking-step-note-0')).not.toBeOnTheScreen();
    expect(
      screen.queryByRole('button', { name: 'Add a note for step 2' }),
    ).not.toBeOnTheScreen();
    expect(noteButton(1)).toBe(screen.getByTestId('cooking-step-note-1'));

    await user.press(noteButton(1));

    expect(notesInput()).toHaveDisplayValue('Step 1: ');
  });

  it('scrolls to the notes and focuses the input when a note button is pressed', async () => {
    const user = userEvent.setup();
    // The Jest preset's TextInput mock puts a jest.fn focus on the prototype,
    // like scrollTo on ScrollView.
    const focus = jest.spyOn(TextInput.prototype, 'focus');
    const scrollTo = jest.spyOn(ScrollView.prototype, 'scrollTo');
    mockRecipeQuery({ data: makeRecipe() });
    await renderScreen();

    const layout = (y: number) => ({ nativeEvent: { layout: { y } } });
    await fireEvent(layoutParent(notesInput()), 'layout', layout(900));

    expect(focus).not.toHaveBeenCalled();

    await user.press(noteButton(2));

    // The notes input is the only TextInput on screen (no line editor open).
    expect(focus).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith({ y: 900 - 16, animated: true });
  });
});

describe('CookingScreen timers', () => {
  const MINUTE = 60_000;
  const simmer = 'Simmer for 10 minutes.';
  const stir = 'Stir well.';
  const bake = 'Bake 20 min.';
  const timedSteps = [simmer, stir, bake].join('\n');
  const simmerLabel = `Step 1 · ${simmer}`;
  const bakeLabel = `Step 3 · ${bake}`;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-21T12:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  async function renderTimedRecipe() {
    mockRecipeQuery({ data: makeRecipe({ instructions: timedSteps }) });
    await renderScreen();
    return userEvent.setup();
  }

  async function advance(ms: number) {
    await act(() => jest.advanceTimersByTime(ms));
  }

  const startChip = (stepNumber: number, minutes: number) =>
    screen.getByRole('button', {
      name: `Start a ${minutes} minute timer for step ${stepNumber}`,
    });
  const stepChip = (index: number) =>
    screen.getByTestId(`cooking-step-timer-${index}`);
  const stack = () => screen.getByTestId('cooking-timers');
  const timerRow = (id: string) => screen.getByTestId(`cooking-timer-${id}`);
  const remaining = (id: string) =>
    screen.getByTestId(`cooking-timer-remaining-${id}`);
  const stepperText = () =>
    screen.getByTestId('cooking-new-timer-minutes-text');
  // Rows in the order the sticky stack shows them.
  const rowIds = () =>
    within(stack())
      .getAllByTestId(/^cooking-timer-(step|manual)-\d+$/)
      .map(row => row.props.testID);

  // The timer-done sheet: the Modal host element around its title.
  const sheetTitle = () => screen.getByTestId('timer-done-title');
  function doneSheet(): Element {
    let node = sheetTitle().parent;
    while (node && node.type !== 'Modal') node = node.parent;
    if (!node) throw new Error('The done sheet is not inside a Modal');
    return node;
  }
  const sheetButton = (name: string) =>
    screen.getByTestId(`timer-done-${name}-button`);
  const sheetMinutes = () => screen.getByTestId('timer-done-minutes-text');
  // fireEvent.press takes no time (user.press takes ~130 ms), so actions
  // land exactly on the 1 s tick and the shown times are exact.
  const press = (element: Element) => fireEvent.press(element);

  async function startManual(minutes: number) {
    await press(screen.getByRole('button', { name: '+ Timer' }));
    const delta = minutes - 5;
    const button = screen.getByTestId(
      `cooking-new-timer-${delta < 0 ? 'minus' : 'plus'}-button`,
    );
    for (let i = 0; i < Math.abs(delta); i++) await press(button);
    await press(screen.getByRole('button', { name: 'Start' }));
  }

  it('shows a timer chip only on steps that mention a duration', async () => {
    await renderTimedRecipe();

    expect(startChip(1, 10)).toBe(stepChip(0));
    expect(startChip(1, 10)).toHaveTextContent('⏱ 10 min');
    expect(startChip(3, 20)).toBe(stepChip(2));
    expect(startChip(3, 20)).toHaveTextContent('⏱ 20 min');
    expect(screen.queryByTestId('cooking-step-timer-1')).not.toBeOnTheScreen();
    expect(screen.getAllByText(/^⏱/)).toHaveLength(2);
    // No timers yet, so no stack.
    expect(screen.queryByTestId('cooking-timers')).not.toBeOnTheScreen();
  });

  it('starts a step timer from its chip and counts down in the stack and the chip', async () => {
    const user = await renderTimedRecipe();

    await user.press(startChip(1, 10));

    expect(stack()).toContainElement(timerRow('step-0'));
    expect(timerRow('step-0')).toHaveTextContent(`⏱ ${simmerLabel}`, {
      exact: false,
    });
    expect(remaining('step-0')).toHaveTextContent('10:00');
    expect(stepChip(0)).toHaveTextContent('⏱ running 10:00');
    expect(
      screen.queryByRole('button', { name: /timer for step 1/ }),
    ).not.toBeOnTheScreen();

    await advance(MINUTE);

    expect(remaining('step-0')).toHaveTextContent('09:00');
    expect(stepChip(0)).toHaveTextContent('⏱ running 09:00');
  });

  it('does not start a second timer when the running chip is tapped', async () => {
    const user = await renderTimedRecipe();

    await user.press(startChip(1, 10));
    await advance(MINUTE);
    await user.press(stepChip(0));

    expect(rowIds()).toEqual(['cooking-timer-step-0']);
    expect(remaining('step-0')).toHaveTextContent('09:00');
  });

  it('lists several timers soonest first', async () => {
    const user = await renderTimedRecipe();

    await user.press(startChip(3, 20));
    await user.press(startChip(1, 10));

    expect(rowIds()).toEqual(['cooking-timer-step-0', 'cooking-timer-step-2']);
    expect(remaining('step-0')).toHaveTextContent('10:00');
    expect(remaining('step-2')).toHaveTextContent('20:00');
    expect(timerRow('step-2')).toHaveTextContent(`⏱ ${bakeLabel}`, {
      exact: false,
    });
  });

  it('freezes a paused timer while time passes and resumes from there', async () => {
    await renderTimedRecipe();

    await press(startChip(1, 10));
    await press(startChip(3, 20));
    await advance(MINUTE);
    await press(screen.getByRole('button', { name: `Pause ${simmerLabel}` }));

    expect(remaining('step-0')).toHaveTextContent('09:00');
    expect(stepChip(0)).toHaveTextContent('paused 09:00');

    await advance(5 * MINUTE);

    expect(remaining('step-0')).toHaveTextContent('09:00');
    // The other timer kept running and now finishes sooner.
    expect(remaining('step-2')).toHaveTextContent('14:00');

    await advance(6 * MINUTE);
    expect(remaining('step-2')).toHaveTextContent('08:00');
    expect(rowIds()).toEqual(['cooking-timer-step-2', 'cooking-timer-step-0']);

    await press(screen.getByRole('button', { name: `Resume ${simmerLabel}` }));
    await advance(MINUTE);

    expect(remaining('step-0')).toHaveTextContent('08:00');
    expect(stepChip(0)).toHaveTextContent('⏱ running 08:00');
    expect(remaining('step-2')).toHaveTextContent('07:00');
  });

  it('removes only the chosen timer and hides the stack when none are left', async () => {
    const user = await renderTimedRecipe();

    await user.press(startChip(1, 10));
    await user.press(startChip(3, 20));
    await user.press(
      screen.getByRole('button', { name: `Remove ${simmerLabel}` }),
    );

    expect(rowIds()).toEqual(['cooking-timer-step-2']);
    // The step gets its start chip back.
    expect(startChip(1, 10)).toHaveTextContent('⏱ 10 min');

    await user.press(
      screen.getByRole('button', { name: `Remove ${bakeLabel}` }),
    );

    expect(screen.queryByTestId('cooking-timers')).not.toBeOnTheScreen();
  });

  it('starts a manual timer with the minutes picked in the stepper', async () => {
    const user = await renderTimedRecipe();

    await user.press(screen.getByRole('button', { name: '+ Timer' }));

    expect(stepperText()).toHaveTextContent('5 min');
    expect(
      screen.queryByRole('button', { name: '+ Timer' }),
    ).not.toBeOnTheScreen();

    await user.press(screen.getByTestId('cooking-new-timer-plus-button'));
    expect(stepperText()).toHaveTextContent('6 min');

    await user.press(screen.getByRole('button', { name: 'Start' }));

    expect(timerRow('manual-1')).toHaveTextContent('⏱ Timer 1', {
      exact: false,
    });
    expect(remaining('manual-1')).toHaveTextContent('06:00');
    // The panel closes again.
    expect(
      screen.queryByTestId('cooking-new-timer-minutes-text'),
    ).not.toBeOnTheScreen();
    expect(screen.getByRole('button', { name: '+ Timer' })).toBeOnTheScreen();

    // The next one is Timer 2 and opens at the default 5 minutes again.
    await user.press(screen.getByRole('button', { name: '+ Timer' }));
    expect(stepperText()).toHaveTextContent('5 min');
    await user.press(screen.getByRole('button', { name: 'Start' }));

    expect(rowIds()).toEqual([
      'cooking-timer-manual-2',
      'cooking-timer-manual-1',
    ]);
    expect(timerRow('manual-2')).toHaveTextContent('⏱ Timer 2', {
      exact: false,
    });
  });

  it('closes the new timer panel on Cancel without adding a timer', async () => {
    const user = await renderTimedRecipe();

    await user.press(screen.getByRole('button', { name: '+ Timer' }));
    await user.press(screen.getByTestId('cooking-new-timer-plus-button'));
    await user.press(screen.getByRole('button', { name: 'Cancel' }));

    expect(
      screen.queryByTestId('cooking-new-timer-minutes-text'),
    ).not.toBeOnTheScreen();
    expect(screen.queryByTestId('cooking-timers')).not.toBeOnTheScreen();
    expect(screen.getByRole('button', { name: '+ Timer' })).toBeOnTheScreen();
  });

  it('vibrates once and shows the done sheet when a step timer reaches zero', async () => {
    const user = await renderTimedRecipe();

    await user.press(startChip(1, 10));
    await advance(10 * MINUTE - 2000);
    expect(screen.queryByTestId('timer-done-title')).not.toBeOnTheScreen();
    expect(Vibration.vibrate).not.toHaveBeenCalled();

    await advance(2000);

    expect(Vibration.vibrate).toHaveBeenCalledTimes(1);
    expect(sheetTitle()).toHaveTextContent('Step 1 done');
    expect(within(doneSheet()).getByText(simmer)).toBeOnTheScreen();
    expect(sheetButton('check-step')).toHaveTextContent('Check step');
    expect(sheetButton('dismiss')).toHaveTextContent('Dismiss');
    expect(remaining('step-0')).toHaveTextContent('00:00');

    // Further ticks don't ring or stack a second sheet.
    await advance(5000);
    expect(Vibration.vibrate).toHaveBeenCalledTimes(1);
    expect(screen.getAllByTestId('timer-done-title')).toHaveLength(1);
  });

  it('"Check step" in the sheet checks the step and removes its timer', async () => {
    const user = await renderTimedRecipe();

    await user.press(startChip(1, 10));
    await user.press(startChip(3, 20));
    await advance(10 * MINUTE);
    await user.press(sheetButton('check-step'));

    expect(
      screen.getByRole('checkbox', { name: `Step 1: ${simmer}` }),
    ).toBeChecked();
    expect(screen.getByText('1 of 3 done')).toBeOnTheScreen();
    expect(rowIds()).toEqual(['cooking-timer-step-2']);
    expect(screen.queryByTestId('timer-done-title')).not.toBeOnTheScreen();
  });

  it('"Dismiss" in the sheet only removes the timer', async () => {
    const user = await renderTimedRecipe();

    await user.press(startChip(1, 10));
    await advance(10 * MINUTE);
    await user.press(sheetButton('dismiss'));

    expect(
      screen.getByRole('checkbox', { name: `Step 1: ${simmer}` }),
    ).not.toBeChecked();
    expect(screen.queryByTestId('cooking-timers')).not.toBeOnTheScreen();
    expect(screen.queryByTestId('timer-done-title')).not.toBeOnTheScreen();
  });

  it('closing the sheet with the Android back button acts as Dismiss', async () => {
    const user = await renderTimedRecipe();

    await user.press(startChip(1, 10));
    await advance(10 * MINUTE);
    await fireEvent(doneSheet(), 'requestClose');

    expect(
      screen.getByRole('checkbox', { name: `Step 1: ${simmer}` }),
    ).not.toBeChecked();
    expect(screen.queryByTestId('cooking-timers')).not.toBeOnTheScreen();
    expect(screen.queryByTestId('timer-done-title')).not.toBeOnTheScreen();
  });

  it('rings again for a step whose timer was restarted after finishing', async () => {
    const user = await renderTimedRecipe();

    await user.press(startChip(1, 10));
    await advance(10 * MINUTE);
    await user.press(sheetButton('dismiss'));
    await user.press(startChip(1, 10));
    await advance(10 * MINUTE);

    expect(Vibration.vibrate).toHaveBeenCalledTimes(2);
    expect(sheetTitle()).toHaveTextContent('Step 1 done');
  });

  it('gives a manual timer a sheet without Check step or step text', async () => {
    await renderTimedRecipe();

    await startManual(4);
    await advance(4 * MINUTE);

    expect(Vibration.vibrate).toHaveBeenCalledTimes(1);
    expect(sheetTitle()).toHaveTextContent('Timer 1 done');
    expect(
      screen.queryByTestId('timer-done-check-step-button'),
    ).not.toBeOnTheScreen();
    for (const text of [simmer, stir, bake]) {
      expect(within(doneSheet()).queryByText(text)).not.toBeOnTheScreen();
    }

    await press(sheetButton('dismiss'));
    expect(screen.queryByTestId('cooking-timers')).not.toBeOnTheScreen();
  });

  it('does not ring while paused', async () => {
    const user = await renderTimedRecipe();

    await user.press(startChip(1, 10));
    await user.press(
      screen.getByRole('button', { name: `Pause ${simmerLabel}` }),
    );
    await advance(30 * MINUTE);

    expect(screen.queryByTestId('timer-done-title')).not.toBeOnTheScreen();
    expect(Vibration.vibrate).not.toHaveBeenCalled();
  });

  it('labels a step timer with the shown step number after an earlier step is removed', async () => {
    const user = await renderTimedRecipe();

    await user.press(startChip(3, 20));
    await user.press(screen.getByRole('button', { name: `Edit "${simmer}"` }));
    await user.press(screen.getByRole('button', { name: 'Remove' }));

    // "Bake" is now step 2, in the stack and in the sheet.
    expect(timerRow('step-2')).toHaveTextContent(`⏱ Step 2 · ${bake}`, {
      exact: false,
    });
    expect(
      screen.getByRole('button', { name: `Pause Step 2 · ${bake}` }),
    ).toBeOnTheScreen();

    await advance(20 * MINUTE);

    expect(sheetTitle()).toHaveTextContent('Step 2 done');
    expect(within(doneSheet()).getByText(bake)).toBeOnTheScreen();
  });

  it('adds the picked minutes to only that timer, closes the sheet, and rings again', async () => {
    await renderTimedRecipe();

    await press(startChip(1, 10));
    await press(startChip(3, 20));
    await advance(10 * MINUTE);

    expect(sheetMinutes()).toHaveTextContent('5 min');
    expect(sheetButton('add-time')).toHaveTextContent('Add 5 min');

    await press(sheetButton('plus'));

    expect(sheetMinutes()).toHaveTextContent('6 min');
    expect(sheetButton('add-time')).toHaveTextContent('Add 6 min');

    await press(sheetButton('add-time'));

    expect(screen.queryByTestId('timer-done-title')).not.toBeOnTheScreen();
    expect(remaining('step-0')).toHaveTextContent('06:00');
    expect(stepChip(0)).toHaveTextContent('⏱ running 06:00');
    // The other timer is untouched, and the step stays unchecked.
    expect(remaining('step-2')).toHaveTextContent('10:00');
    expect(rowIds()).toEqual(['cooking-timer-step-0', 'cooking-timer-step-2']);
    expect(
      screen.getByRole('checkbox', { name: `Step 1: ${simmer}` }),
    ).not.toBeChecked();

    await advance(6 * MINUTE - 1000);
    expect(screen.queryByTestId('timer-done-title')).not.toBeOnTheScreen();
    expect(Vibration.vibrate).toHaveBeenCalledTimes(1);
    expect(remaining('step-2')).toHaveTextContent('04:01');

    await advance(1000);

    expect(Vibration.vibrate).toHaveBeenCalledTimes(2);
    expect(sheetTitle()).toHaveTextContent('Step 1 done');
    // A fresh sheet starts at 5 again.
    expect(sheetMinutes()).toHaveTextContent('5 min');
  });

  it('vibrates once for timers finishing on the same tick and shows their sheets one after the other', async () => {
    await renderTimedRecipe();

    await press(startChip(1, 10));
    await startManual(10);
    await advance(10 * MINUTE);

    expect(Vibration.vibrate).toHaveBeenCalledTimes(1);
    expect(screen.getAllByTestId('timer-done-title')).toHaveLength(1);
    expect(sheetTitle()).toHaveTextContent('Step 1 done');

    // Change the stepper, then dismiss: the next sheet starts over at 5.
    await press(sheetButton('plus'));
    expect(sheetMinutes()).toHaveTextContent('6 min');
    await press(sheetButton('dismiss'));

    expect(sheetTitle()).toHaveTextContent('Timer 1 done');
    expect(sheetMinutes()).toHaveTextContent('5 min');
    expect(sheetButton('add-time')).toHaveTextContent('Add 5 min');
    expect(
      screen.queryByTestId('timer-done-check-step-button'),
    ).not.toBeOnTheScreen();
    expect(Vibration.vibrate).toHaveBeenCalledTimes(1);

    await press(sheetButton('dismiss'));

    expect(screen.queryByTestId('timer-done-title')).not.toBeOnTheScreen();
    expect(screen.queryByTestId('cooking-timers')).not.toBeOnTheScreen();
  });

  it('drops a queued timer from the queue when it is removed from the stack', async () => {
    await renderTimedRecipe();

    await press(startChip(1, 10));
    await startManual(10);
    await advance(10 * MINUTE);
    expect(sheetTitle()).toHaveTextContent('Step 1 done');

    await press(screen.getByRole('button', { name: 'Remove Timer 1' }));

    // The shown sheet stays; once it is dismissed nothing else follows.
    expect(sheetTitle()).toHaveTextContent('Step 1 done');
    expect(rowIds()).toEqual(['cooking-timer-step-0']);

    await press(sheetButton('dismiss'));

    expect(screen.queryByTestId('timer-done-title')).not.toBeOnTheScreen();
    expect(screen.queryByTestId('cooking-timers')).not.toBeOnTheScreen();

    // A new manual timer reuses the id "manual-1"; a stale queue entry
    // would show its done sheet straight away.
    await startManual(5);

    expect(remaining('manual-1')).toHaveTextContent('05:00');
    expect(screen.queryByTestId('timer-done-title')).not.toBeOnTheScreen();
  });

  it('keeps the other timers counting down while the sheet is open', async () => {
    await renderTimedRecipe();

    await press(startChip(1, 10));
    await press(startChip(3, 20));
    await advance(10 * MINUTE);
    expect(sheetTitle()).toHaveTextContent('Step 1 done');
    expect(remaining('step-2')).toHaveTextContent('10:00');

    await advance(MINUTE);

    expect(sheetTitle()).toHaveTextContent('Step 1 done');
    expect(remaining('step-2')).toHaveTextContent('09:00');
    expect(stepChip(2)).toHaveTextContent('⏱ running 09:00');
  });
});

describe('CookingScreen cooking clock', () => {
  const MINUTE = 60_000;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-21T12:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  async function advance(ms: number) {
    await act(() => jest.advanceTimersByTime(ms));
  }

  // True when `a` comes before `b` in the rendered tree (depth-first order):
  // walk up to their lowest common ancestor and compare the branches' indexes.
  function comesBefore(a: Element, b: Element): boolean {
    const pathTo = (element: Element) => {
      const path: Element[] = [];
      for (let node: Element | null = element; node; node = node.parent) {
        path.unshift(node);
      }
      return path;
    };
    const pathA = pathTo(a);
    const pathB = pathTo(b);
    let depth = 0;
    while (pathA[depth] === pathB[depth]) depth++;
    const siblings = pathA[depth - 1].children;
    return siblings.indexOf(pathA[depth]) < siblings.indexOf(pathB[depth]);
  }

  const elapsedText = () => screen.getByTestId('cooking-elapsed-text');

  it('keeps the header title-only and shows the clock above the ingredients', async () => {
    mockRecipeQuery({ data: makeRecipe() });
    const navigation = await renderScreen();

    expect(navigation.setOptions).toHaveBeenCalled();
    for (const [options] of navigation.setOptions.mock.calls) {
      expect(options).not.toHaveProperty('headerTitle');
    }
    expect(elapsedText()).toHaveTextContent('Cooking · 00:00');
    expect(comesBefore(elapsedText(), screen.getByText('INGREDIENTS'))).toBe(
      true,
    );
  });

  it('counts the clock up while a step timer counts down', async () => {
    mockRecipeQuery({
      data: makeRecipe({ instructions: 'Simmer for 10 minutes.' }),
    });
    await renderScreen();

    await fireEvent.press(
      screen.getByRole('button', {
        name: 'Start a 10 minute timer for step 1',
      }),
    );
    const remaining = screen.getByTestId('cooking-timer-remaining-step-0');
    expect(remaining).toHaveTextContent('10:00');
    expect(elapsedText()).toHaveTextContent('Cooking · 00:00');

    await advance(MINUTE);

    expect(remaining).toHaveTextContent('09:00');
    expect(elapsedText()).toHaveTextContent('Cooking · 01:00');
  });

  it('pauses while the app is in the background and continues when it is back', async () => {
    mockRecipeQuery({ data: makeRecipe() });
    await renderScreen();

    expect(AppState.addEventListener).toHaveBeenCalledWith(
      'change',
      expect.any(Function),
    );

    await advance(2 * MINUTE);
    await changeAppState('background');
    await advance(10 * MINUTE);

    expect(elapsedText()).toHaveTextContent('Cooking · 02:00');

    await changeAppState('active');
    await advance(MINUTE);

    // The 10 minutes away are not counted.
    expect(elapsedText()).toHaveTextContent('Cooking · 03:00');
  });

  it('keeps counting when the app is only inactive', async () => {
    mockRecipeQuery({ data: makeRecipe() });
    await renderScreen();

    await advance(2 * MINUTE);
    await changeAppState('inactive');
    await advance(3 * MINUTE);

    expect(elapsedText()).toHaveTextContent('Cooking · 05:00');
  });

  it('stops listening to AppState on unmount', async () => {
    mockRecipeQuery({ data: makeRecipe() });
    await renderScreen();

    expect(removeAppStateListener).not.toHaveBeenCalled();

    await screen.unmount();

    expect(removeAppStateListener).toHaveBeenCalledTimes(1);
  });
});

describe('CookingScreen draft', () => {
  const MINUTE = 60_000;
  const DRAFT_KEY = 'cooking-draft:r1';
  const simmer = 'Simmer for 10 minutes.';
  const timedSteps = `${simmer}\nCook on a hot pan.`;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-21T12:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
    // Undo AsyncStorage spies: resetAllMocks alone would leave them
    // returning undefined for the tests that follow.
    jest.restoreAllMocks();
  });

  async function advance(ms: number) {
    await act(() => jest.advanceTimersByTime(ms));
  }

  async function storedDraft(): Promise<CookingDraft | null> {
    const json = await AsyncStorage.getItem(DRAFT_KEY);
    return json === null ? null : JSON.parse(json);
  }

  function makeDraft(overrides: Partial<CookingDraft> = {}): CookingDraft {
    const at = Date.now();
    return {
      version: 1,
      recipeId: 'r1',
      startedAt: at,
      savedAt: at,
      elapsedMs: 0,
      ingredients: null,
      instructions: null,
      checkedIngredients: [],
      checkedSteps: [],
      notes: '',
      timers: [],
      ...overrides,
    };
  }

  // getItem that only answers when the test says so.
  function deferGetItem() {
    let resolve!: (json: string | null) => void;
    jest.spyOn(AsyncStorage, 'getItem').mockImplementation(
      () =>
        new Promise<string | null>(done => {
          resolve = done;
        }),
    );
    return (json: string | null) => act(async () => resolve(json));
  }

  // The loading spinner has no role or testID; find it by its host type.
  function hasSpinner(): boolean {
    const search = (node: Element): boolean =>
      node.type === 'ActivityIndicator' ||
      node.children.some(child => typeof child !== 'string' && search(child));
    return search(screen.container);
  }

  const stepCheckbox = (text: string, number: number) =>
    screen.getByRole('checkbox', { name: `Step ${number}: ${text}` });
  const elapsedText = () => screen.getByTestId('cooking-elapsed-text');
  const notesInput = () => screen.getByLabelText('NOTES');

  // With a saved draft the screen asks first; fireEvent.press takes no time,
  // so clocks and timers stay exact.
  async function resume() {
    await fireEvent.press(screen.getByRole('button', { name: 'Resume' }));
  }

  it('writes no draft when cooking mode is opened and left at once', async () => {
    mockRecipeQuery({ data: makeRecipe() });
    await renderScreen();

    await screen.unmount();

    expect(await storedDraft()).toBeNull();
  });

  it('writes no draft while nothing has been done, even as time passes or the app goes to the background', async () => {
    mockRecipeQuery({ data: makeRecipe() });
    await renderScreen();

    await advance(5 * MINUTE);
    await changeAppState('background');
    await changeAppState('active');
    await advance(MINUTE);
    await screen.unmount();

    expect(await AsyncStorage.getAllKeys()).toEqual([]);
  });

  it('saves a checked step 500 ms after the change', async () => {
    mockRecipeQuery({ data: makeRecipe() });
    await renderScreen();

    await fireEvent.press(stepCheckbox('Whisk the batter.', 1));
    await advance(499);

    expect(await storedDraft()).toBeNull();

    await advance(1);

    expect(await storedDraft()).toMatchObject({
      version: 1,
      recipeId: 'r1',
      checkedSteps: [0],
      checkedIngredients: [],
    });
  });

  it('restores checks, edits, notes and a running timer after leaving and coming back', async () => {
    const user = userEvent.setup();
    mockRecipeQuery({ data: makeRecipe({ instructions: timedSteps }) });
    await renderScreen();

    await user.press(screen.getByRole('checkbox', { name: '1 cup flour' }));
    await user.press(stepCheckbox('Cook on a hot pan.', 2));
    await user.press(screen.getByRole('button', { name: 'Edit "2 eggs"' }));
    const editor = screen.getByDisplayValue('2 eggs');
    await user.clear(editor);
    await user.type(editor, '3 eggs');
    await user.press(screen.getByRole('button', { name: 'Save' }));
    await user.type(notesInput(), 'Needs more salt');
    await fireEvent.press(
      screen.getByRole('button', {
        name: 'Start a 10 minute timer for step 1',
      }),
    );
    await advance(2 * MINUTE);
    await screen.unmount();

    await renderScreen();
    await resume();

    expect(screen.getByRole('checkbox', { name: '1 cup flour' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: '3 eggs' })).not.toBeChecked();
    expect(
      screen.queryByRole('checkbox', { name: '2 eggs' }),
    ).not.toBeOnTheScreen();
    expect(screen.getByText(/^was:/)).toHaveTextContent('was: 2 eggs ·');
    expect(screen.getByText('1 of 2 used')).toBeOnTheScreen();
    expect(stepCheckbox(simmer, 1)).not.toBeChecked();
    expect(stepCheckbox('Cook on a hot pan.', 2)).toBeChecked();
    expect(notesInput()).toHaveDisplayValue('Needs more salt');
    expect(
      screen.getByTestId('cooking-timer-remaining-step-0'),
    ).toHaveTextContent('08:00');
    expect(screen.getByTestId('cooking-step-timer-0')).toHaveTextContent(
      '⏱ running 08:00',
    );

    // The restored timer keeps counting down.
    await advance(MINUTE);

    expect(
      screen.getByTestId('cooking-timer-remaining-step-0'),
    ).toHaveTextContent('07:00');
  });

  it('saves the clock paused on leaving and does not count the time away', async () => {
    mockRecipeQuery({ data: makeRecipe() });
    await renderScreen();

    await fireEvent.press(stepCheckbox('Whisk the batter.', 1));
    await advance(2 * MINUTE);
    await screen.unmount();

    const draft = await storedDraft();
    expect(draft).not.toHaveProperty('activeSince');
    expect(draft).toMatchObject({
      elapsedMs: 2 * MINUTE,
      savedAt: Date.now(),
    });

    await advance(10 * MINUTE);
    await renderScreen();
    await resume();

    expect(elapsedText()).toHaveTextContent('Cooking · 02:00');

    await advance(MINUTE);

    expect(elapsedText()).toHaveTextContent('Cooking · 03:00');
  });

  it('saves at once, with the clock paused, when the app goes to the background', async () => {
    mockRecipeQuery({ data: makeRecipe() });
    await renderScreen();

    await advance(MINUTE);
    await fireEvent.press(stepCheckbox('Whisk the batter.', 1));
    // Still inside the 500 ms wait.
    expect(await storedDraft()).toBeNull();

    await changeAppState('background');

    const draft = await storedDraft();
    expect(draft).not.toHaveProperty('activeSince');
    expect(draft).toMatchObject({ checkedSteps: [0], elapsedMs: MINUTE });
  });

  it('rings for a timer that finished while cooking mode was closed', async () => {
    mockRecipeQuery({ data: makeRecipe({ instructions: timedSteps }) });
    await renderScreen();

    await fireEvent.press(
      screen.getByRole('button', {
        name: 'Start a 10 minute timer for step 1',
      }),
    );
    await advance(MINUTE);
    await screen.unmount();
    await advance(15 * MINUTE);

    expect(Vibration.vibrate).not.toHaveBeenCalled();

    await renderScreen();
    // Nothing rings behind the resume prompt.
    expect(Vibration.vibrate).not.toHaveBeenCalled();

    await resume();

    expect(Vibration.vibrate).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('timer-done-title')).toHaveTextContent(
      'Step 1 done',
    );
  });

  it('opens fresh when the stored draft is corrupt', async () => {
    await AsyncStorage.setItem(DRAFT_KEY, '{"version":1,"recipeId":');
    mockRecipeQuery({ data: makeRecipe() });
    await renderScreen();

    expect(elapsedText()).toHaveTextContent('Cooking · 00:00');
    expect(
      screen.getByRole('checkbox', { name: '1 cup flour' }),
    ).not.toBeChecked();
    expect(stepCheckbox('Whisk the batter.', 1)).not.toBeChecked();
    expect(notesInput()).toHaveDisplayValue('');
  });

  it('opens fresh when reading the draft fails', async () => {
    jest
      .spyOn(AsyncStorage, 'getItem')
      .mockRejectedValue(new Error('storage unavailable'));
    mockRecipeQuery({ data: makeRecipe() });
    await renderScreen();

    expect(hasSpinner()).toBe(false);
    expect(elapsedText()).toHaveTextContent('Cooking · 00:00');
    expect(stepCheckbox('Whisk the batter.', 1)).not.toBeChecked();
  });

  it('shows the spinner while the draft is loading, then the restored progress', async () => {
    const resolveDraft = deferGetItem();
    mockRecipeQuery({ data: makeRecipe() });
    await renderScreen();

    expect(hasSpinner()).toBe(true);
    expect(screen.queryByText('INGREDIENTS')).not.toBeOnTheScreen();

    await resolveDraft(
      JSON.stringify(makeDraft({ checkedSteps: [0], notes: 'Lumpy' })),
    );

    expect(hasSpinner()).toBe(false);
    await resume();
    expect(stepCheckbox('Whisk the batter.', 1)).toBeChecked();
    expect(notesInput()).toHaveDisplayValue('Lumpy');
  });

  it('shows the error rather than the spinner while the draft is still loading', async () => {
    deferGetItem();
    mockRecipeQuery({
      isError: true,
      error: new RecipesError('Request failed (500)', 500),
    });
    await renderScreen();

    expect(hasSpinner()).toBe(false);
    expect(screen.getByTestId('cooking-error-text')).toHaveTextContent(
      'Request failed (500)',
    );
  });

  it('keeps saving after everything is unchecked again', async () => {
    mockRecipeQuery({ data: makeRecipe() });
    await renderScreen();

    const first = stepCheckbox('Whisk the batter.', 1);
    await fireEvent.press(first);
    await advance(500);
    expect(await storedDraft()).toMatchObject({ checkedSteps: [0] });

    await fireEvent.press(first);
    await advance(500);

    expect(await storedDraft()).toMatchObject({ checkedSteps: [] });
  });

  it('keeps a restored draft up to date when its only check is undone', async () => {
    await AsyncStorage.setItem(
      DRAFT_KEY,
      JSON.stringify(makeDraft({ checkedIngredients: [1] })),
    );
    mockRecipeQuery({ data: makeRecipe() });
    await renderScreen();
    await resume();

    const eggs = screen.getByRole('checkbox', { name: '2 eggs' });
    expect(eggs).toBeChecked();

    await fireEvent.press(eggs);
    await advance(500);

    expect(await storedDraft()).toMatchObject({ checkedIngredients: [] });
  });

  describe('resume prompt', () => {
    const HOUR = 60 * MINUTE;
    const threeSteps = 'Whisk the batter.\nCook on a hot pan.\nServe warm.';
    const promptTitle = () =>
      screen.getByRole('header', { name: 'Pick up where you left off?' });

    async function saveDraftAndRender(draft: CookingDraft, recipe: Recipe) {
      await AsyncStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
      mockRecipeQuery({ data: recipe });
      await renderScreen();
    }

    it('asks first when a draft exists, counting only the draft’s steps still in use', async () => {
      await saveDraftAndRender(
        makeDraft({
          startedAt: Date.now() - 2 * HOUR,
          // Edited, removed (though checked), and added this time.
          instructions: [
            { original: 'Whisk the batter.', text: 'Whisk well.' },
            { original: 'Cook on a hot pan.', text: null },
            { original: null, text: 'Serve warm.' },
          ],
          checkedSteps: [0, 1],
        }),
        // Three steps in the recipe: the prompt must use the draft's lines.
        makeRecipe({ instructions: threeSteps }),
      );

      expect(promptTitle()).toBeOnTheScreen();
      expect(screen.getByText('You started this 2 h ago.')).toBeOnTheScreen();
      expect(screen.getByText('1 of 2 steps done.')).toBeOnTheScreen();
      expect(screen.getByRole('button', { name: 'Resume' })).toBe(
        screen.getByTestId('cooking-resume-button'),
      );
      expect(screen.getByRole('button', { name: 'Start over' })).toBe(
        screen.getByTestId('cooking-start-over-button'),
      );
      // The session isn't shown behind the prompt.
      expect(screen.queryByText('INGREDIENTS')).not.toBeOnTheScreen();
      expect(
        screen.queryByTestId('cooking-elapsed-text'),
      ).not.toBeOnTheScreen();
    });

    it('counts the recipe’s steps when the draft has no edited lines', async () => {
      await saveDraftAndRender(
        makeDraft({ startedAt: Date.now() - 5 * MINUTE, checkedSteps: [2] }),
        makeRecipe({ instructions: threeSteps }),
      );

      expect(screen.getByText('You started this 5 min ago.')).toBeOnTheScreen();
      expect(screen.getByText('1 of 3 steps done.')).toBeOnTheScreen();
    });

    it('opens straight into cooking mode when there is no draft', async () => {
      mockRecipeQuery({ data: makeRecipe() });
      await renderScreen();

      expect(
        screen.queryByRole('header', { name: 'Pick up where you left off?' }),
      ).not.toBeOnTheScreen();
      expect(
        screen.queryByRole('button', { name: 'Resume' }),
      ).not.toBeOnTheScreen();
      expect(screen.getByText('INGREDIENTS')).toBeOnTheScreen();
    });

    it('Resume opens cooking mode with the saved progress', async () => {
      await saveDraftAndRender(
        makeDraft({
          elapsedMs: 3 * MINUTE,
          checkedIngredients: [1],
          checkedSteps: [0],
          notes: 'Lumpy',
        }),
        makeRecipe(),
      );

      await resume();

      expect(
        screen.queryByRole('header', { name: 'Pick up where you left off?' }),
      ).not.toBeOnTheScreen();
      expect(screen.getByRole('checkbox', { name: '2 eggs' })).toBeChecked();
      expect(stepCheckbox('Whisk the batter.', 1)).toBeChecked();
      expect(notesInput()).toHaveDisplayValue('Lumpy');
      expect(elapsedText()).toHaveTextContent('Cooking · 03:00');
      expect(await storedDraft()).toMatchObject({ notes: 'Lumpy' });
    });

    it('Start over deletes the draft and opens a fresh session', async () => {
      await saveDraftAndRender(
        makeDraft({
          elapsedMs: 3 * MINUTE,
          checkedIngredients: [1],
          checkedSteps: [0],
          notes: 'Lumpy',
        }),
        makeRecipe(),
      );

      await fireEvent.press(screen.getByRole('button', { name: 'Start over' }));

      expect(await storedDraft()).toBeNull();
      expect(
        screen.queryByRole('header', { name: 'Pick up where you left off?' }),
      ).not.toBeOnTheScreen();
      expect(
        screen.getByRole('checkbox', { name: '1 cup flour' }),
      ).not.toBeChecked();
      expect(
        screen.getByRole('checkbox', { name: '2 eggs' }),
      ).not.toBeChecked();
      expect(stepCheckbox('Whisk the batter.', 1)).not.toBeChecked();
      expect(elapsedText()).toHaveTextContent('Cooking · 00:00');
      expect(notesInput()).toHaveDisplayValue('');

      // Leaving again without doing anything leaves no draft behind.
      await advance(MINUTE);
      await screen.unmount();
      expect(await storedDraft()).toBeNull();
    });

    it('saves a new draft, started now, once there is progress after Start over', async () => {
      await saveDraftAndRender(
        makeDraft({
          startedAt: Date.now() - 2 * HOUR,
          checkedSteps: [0],
          notes: 'Lumpy',
        }),
        makeRecipe(),
      );
      const startedOverAt = Date.now();

      await fireEvent.press(screen.getByRole('button', { name: 'Start over' }));
      await fireEvent.press(stepCheckbox('Cook on a hot pan.', 2));
      await advance(500);

      expect(await storedDraft()).toMatchObject({
        startedAt: startedOverAt,
        checkedSteps: [1],
        notes: '',
      });
    });
  });

  describe('leave confirmation', () => {
    const leaveAction = { type: 'GO_BACK' };

    async function renderWithProgress() {
      mockRecipeQuery({ data: makeRecipe() });
      const navigation = await renderScreen();
      await fireEvent.press(stepCheckbox('Whisk the batter.', 1));
      return navigation;
    }

    // Asks to leave the way a navigator would, and returns the Alert buttons.
    async function tryToLeave() {
      const alert = jest.spyOn(Alert, 'alert');
      const { callback } = lastPreventRemove();
      await act(() =>
        callback({ data: { action: leaveAction } } as Parameters<
          typeof callback
        >[0]),
      );
      expect(alert).toHaveBeenCalledTimes(1);
      return alert.mock.calls[0];
    }

    it('lets you leave a fresh screen without asking', async () => {
      mockRecipeQuery({ data: makeRecipe() });
      await renderScreen();

      expect(lastPreventRemove().prevent).toBe(false);
    });

    it('asks before leaving once something is checked, and not after it is unchecked', async () => {
      await renderWithProgress();

      expect(lastPreventRemove().prevent).toBe(true);

      await fireEvent.press(stepCheckbox('Whisk the batter.', 1));

      expect(lastPreventRemove().prevent).toBe(false);
    });

    it('asks before leaving a resumed draft, even with nothing checked', async () => {
      await AsyncStorage.setItem(DRAFT_KEY, JSON.stringify(makeDraft()));
      mockRecipeQuery({ data: makeRecipe() });
      await renderScreen();
      await resume();

      expect(lastPreventRemove().prevent).toBe(true);
    });

    it('lets you leave a fresh session after Start over without asking', async () => {
      await AsyncStorage.setItem(
        DRAFT_KEY,
        JSON.stringify(makeDraft({ checkedSteps: [0] })),
      );
      mockRecipeQuery({ data: makeRecipe() });
      await renderScreen();
      await fireEvent.press(screen.getByRole('button', { name: 'Start over' }));

      expect(lastPreventRemove().prevent).toBe(false);
    });

    it('shows a Stop cooking? alert with Keep cooking as the cancel button', async () => {
      await renderWithProgress();

      const [title, message, buttons] = await tryToLeave();

      expect(title).toBe('Stop cooking?');
      expect(message).toBe('Your progress is kept on this phone.');
      expect(buttons).toEqual([
        { text: 'Keep cooking', style: 'cancel' },
        { text: 'Leave', onPress: expect.any(Function) },
      ]);
    });

    it('Leave carries out the blocked navigation action', async () => {
      const navigation = await renderWithProgress();
      const [, , buttons] = await tryToLeave();
      const leave = buttons!.find(button => button.text === 'Leave');

      expect(navigation.dispatch).not.toHaveBeenCalled();

      await act(() => leave!.onPress!());

      expect(navigation.dispatch).toHaveBeenCalledTimes(1);
      expect(navigation.dispatch).toHaveBeenCalledWith(leaveAction);
    });

    it('Keep cooking stays on the screen', async () => {
      const navigation = await renderWithProgress();
      const [, , buttons] = await tryToLeave();
      const keep = buttons!.find(button => button.text === 'Keep cooking');

      await act(() => keep!.onPress?.());

      expect(navigation.dispatch).not.toHaveBeenCalled();
      expect(stepCheckbox('Whisk the batter.', 1)).toBeChecked();
    });
  });
});

describe('CookingScreen finish', () => {
  const MINUTE = 60_000;
  const DRAFT_KEY = 'cooking-draft:r1';
  const whisk = 'Whisk the batter.';
  const cook = 'Cook on a hot pan.';

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-24T12:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
    // Undo the Alert spies.
    jest.restoreAllMocks();
  });

  async function advance(ms: number) {
    await act(() => jest.advanceTimersByTime(ms));
  }

  async function storedDraft(): Promise<CookingDraft | null> {
    const json = await AsyncStorage.getItem(DRAFT_KEY);
    return json === null ? null : JSON.parse(json);
  }

  // The header's Finish button element, as the navigator would render it.
  function finishButton(navigation: Navigation) {
    const { headerRight } = headerOptions(navigation);
    if (!headerRight) throw new Error('No headerRight set');
    return headerRight() as React.ReactElement<{ onPress: () => void }>;
  }

  // Presses Finish in the header. The header lives outside the screen's
  // tree, so its onPress is called directly.
  async function pressFinish(navigation: Navigation) {
    const { onPress } = finishButton(navigation).props;
    await act(() => onPress());
  }

  // fireEvent.press takes no time, so the cooking clock stays exact.
  const press = (element: Element) => fireEvent.press(element);
  const elapsedText = () => screen.getByTestId('cooking-elapsed-text');
  const tookText = () => screen.getByTestId('finish-duration-text');
  const sheetTitle = () =>
    screen.queryByRole('header', { name: 'How did it go?' });
  const saveButton = () => screen.getByRole('button', { name: 'Save attempt' });
  // Hidden from screen readers by the sheet's accessibilityViewIsModal.
  const backdrop = () =>
    screen.getByRole('button', {
      name: 'Back to cooking',
      includeHiddenElements: true,
    });
  const stepCheckbox = (text: string, number: number) =>
    screen.getByRole('checkbox', { name: `Step ${number}: ${text}` });

  // The body passed to mutate, and its onSuccess option.
  function mutateCall() {
    expect(attemptMutation.mutate).toHaveBeenCalledTimes(1);
    const [body, options] = attemptMutation.mutate.mock.calls[0];
    return { body, onSuccess: options.onSuccess as () => void };
  }

  async function editLineText(from: string, to: string) {
    await press(screen.getByRole('button', { name: `Edit "${from}"` }));
    await fireEvent.changeText(screen.getByDisplayValue(from), to);
    await press(screen.getByRole('button', { name: 'Save' }));
  }

  async function removeLineText(text: string) {
    await press(screen.getByRole('button', { name: `Edit "${text}"` }));
    await press(screen.getByRole('button', { name: 'Remove' }));
  }

  async function addStep(text: string) {
    await press(screen.getByRole('button', { name: '+ Add step' }));
    await fireEvent.changeText(screen.getByPlaceholderText('New step'), text);
    await press(screen.getByRole('button', { name: 'Save' }));
  }

  async function renderCooking() {
    mockRecipeQuery({ data: makeRecipe() });
    return renderScreen();
  }

  it('puts a Finish button in the header', async () => {
    const user = userEvent.setup();
    const navigation = await renderCooking();
    const onPress = jest.fn();

    // Render the header's button with a spy to check what it shows and calls.
    await render(React.cloneElement(finishButton(navigation), { onPress }));
    await user.press(screen.getByRole('button', { name: 'Finish' }));

    expect(screen.getByTestId('cooking-finish-button')).toHaveTextContent(
      'Finish',
    );
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('opens the sheet with the time cooked so far, and no sheet before that', async () => {
    const navigation = await renderCooking();
    await advance(42 * MINUTE);

    expect(sheetTitle()).not.toBeOnTheScreen();

    await pressFinish(navigation);

    expect(sheetTitle()).toBeOnTheScreen();
    expect(tookText()).toHaveTextContent('September 24, 2026 · took 42 min');
    // prep 5 + cook 20 from makeRecipe.
    expect(screen.getByText('(recipe says 25 min)')).toBeOnTheScreen();
    expect(screen.getByTestId('finish-notes-input')).toHaveDisplayValue('');
  });

  it('leaves out the recipe time when the recipe has none', async () => {
    mockRecipeQuery({
      data: makeRecipe({ prepMinutes: null, cookMinutes: null }),
    });
    const navigation = await renderScreen();

    await pressFinish(navigation);

    expect(screen.queryByText(/recipe says/)).not.toBeOnTheScreen();
  });

  it('pauses the clock while the sheet is open, even when the app comes back to the foreground', async () => {
    const navigation = await renderCooking();
    await advance(42 * MINUTE);
    await pressFinish(navigation);

    await advance(10 * MINUTE);
    await changeAppState('background');
    await advance(5 * MINUTE);
    await changeAppState('active');
    await advance(5 * MINUTE);
    // Re-render so the sheet recomputes its duration from the clock.
    await setAttemptState({});

    expect(elapsedText()).toHaveTextContent('Cooking · 42:00');
    expect(tookText()).toHaveTextContent('took 42 min', { exact: false });
  });

  it('resumes the clock when the sheet is closed, and resets the mutation', async () => {
    const navigation = await renderCooking();
    await advance(42 * MINUTE);
    await pressFinish(navigation);
    await advance(10 * MINUTE);

    await press(backdrop());

    expect(sheetTitle()).not.toBeOnTheScreen();
    expect(attemptMutation.reset).toHaveBeenCalledTimes(1);
    expect(elapsedText()).toHaveTextContent('Cooking · 42:00');

    await advance(MINUTE);

    expect(elapsedText()).toHaveTextContent('Cooking · 43:00');
  });

  it('resumes the clock when the sheet is closed with the Android back button', async () => {
    const navigation = await renderCooking();
    await advance(5 * MINUTE);
    await pressFinish(navigation);
    let modal = tookText().parent;
    while (modal && modal.type !== 'Modal') modal = modal.parent;
    if (!modal) throw new Error('No Modal around the sheet');

    await fireEvent(modal, 'requestClose');
    await advance(MINUTE);

    expect(sheetTitle()).not.toBeOnTheScreen();
    expect(elapsedText()).toHaveTextContent('Cooking · 06:00');
  });

  describe('Save', () => {
    it('sends the time, rating and trimmed notes, with no line changes', async () => {
      const navigation = await renderCooking();
      await fireEvent.changeText(
        screen.getByLabelText('NOTES'),
        '  Needs more salt  ',
      );
      await advance(42 * MINUTE);
      await pressFinish(navigation);

      expect(screen.getByTestId('finish-notes-input')).toHaveDisplayValue(
        '  Needs more salt  ',
      );
      await press(screen.getByRole('radio', { name: '4 stars' }));
      await press(saveButton());

      // No photo taken: no photo key at all.
      expect(mutateCall().body).toEqual({
        durationMinutes: 42,
        rating: 4,
        fullness: null,
        enjoyment: null,
        notes: 'Needs more salt',
        ingredients: null,
        instructions: null,
        basedOnAttemptId: null,
      });
      expect(screen.queryByTestId('finish-changes-text')).not.toBeOnTheScreen();
    });

    it('sends null notes and rating when the notes are blank and no star is picked', async () => {
      const navigation = await renderCooking();
      await fireEvent.changeText(screen.getByLabelText('NOTES'), '   \n ');
      await pressFinish(navigation);

      await press(saveButton());

      expect(mutateCall().body).toMatchObject({
        durationMinutes: 0,
        rating: null,
        fullness: null,
        notes: null,
      });
    });

    it('sends the fullness picked in the sheet', async () => {
      const navigation = await renderCooking();
      await pressFinish(navigation);

      await press(screen.getByRole('radio', { name: 'Still hungry' }));
      await press(saveButton());

      expect(mutateCall().body).toMatchObject({
        fullness: Fullness.StillHungry,
      });
    });

    it('sends the enjoyment picked in the sheet, apart from the fullness', async () => {
      const navigation = await renderCooking();
      await pressFinish(navigation);

      await press(screen.getByRole('radio', { name: 'Not worth the effort' }));
      await press(saveButton());

      expect(mutateCall().body).toMatchObject({
        enjoyment: Enjoyment.NotWorthIt,
        fullness: null,
      });
    });

    it('sends the photo taken in the sheet as base64', async () => {
      jest.mocked(launchCamera).mockResolvedValueOnce({
        assets: [{ uri: 'file:///pancakes.jpg', base64: 'cGFuY2FrZXM=' }],
      });
      const navigation = await renderCooking();
      await pressFinish(navigation);

      await press(screen.getByTestId('finish-take-photo-button'));
      expect(
        await screen.findByLabelText('Photo of what you made'),
      ).toBeOnTheScreen();
      await press(saveButton());

      expect(mutateCall().body).toMatchObject({ photo: 'cGFuY2FrZXM=' });
    });

    it('sends no photo key after the photo is removed', async () => {
      jest.mocked(launchImageLibrary).mockResolvedValueOnce({
        assets: [{ uri: 'file:///pancakes.jpg', base64: 'cGFuY2FrZXM=' }],
      });
      const navigation = await renderCooking();
      await pressFinish(navigation);

      await press(screen.getByTestId('finish-choose-photo-button'));
      await press(await screen.findByTestId('finish-photo-remove-button'));
      await press(saveButton());

      expect(mutateCall().body).not.toHaveProperty('photo');
    });

    it('sends the corrected time from the sheet', async () => {
      const navigation = await renderCooking();
      await advance(42 * MINUTE);
      await pressFinish(navigation);

      await press(screen.getByTestId('finish-duration-edit-button'));
      await fireEvent.changeText(
        screen.getByTestId('finish-duration-input'),
        '50',
      );
      await press(saveButton());

      expect(mutateCall().body).toMatchObject({ durationMinutes: 50 });
    });

    it('sends the changed lines and summarises the changes', async () => {
      const navigation = await renderCooking();
      await editLineText('2 eggs', '3 eggs');
      await removeLineText(whisk);
      await addStep('Serve warm.');
      await pressFinish(navigation);

      expect(screen.getByTestId('finish-changes-text')).toHaveTextContent(
        'You changed 1 ingredient and 2 steps.',
      );

      await press(saveButton());

      expect(mutateCall().body).toMatchObject({
        ingredients: [{ text: '1 cup flour' }, { text: '3 eggs' }],
        instructions: `${cook}\nServe warm.`,
      });
    });

    it('sends only the list that changed', async () => {
      const navigation = await renderCooking();
      await editLineText(cook, 'Cook on a very hot pan.');
      await pressFinish(navigation);

      expect(screen.getByTestId('finish-changes-text')).toHaveTextContent(
        'You changed 1 step.',
      );

      await press(saveButton());

      expect(mutateCall().body).toMatchObject({
        ingredients: null,
        instructions: `${whisk}\nCook on a very hot pan.`,
      });
    });

    it('summarises ingredient-only changes', async () => {
      const navigation = await renderCooking();
      await removeLineText('1 cup flour');
      await editLineText('2 eggs', '3 eggs');
      await pressFinish(navigation);

      expect(screen.getByTestId('finish-changes-text')).toHaveTextContent(
        'You changed 2 ingredients.',
      );
    });

    it('sends null lines and no summary when edits were reverted', async () => {
      const navigation = await renderCooking();
      await editLineText('2 eggs', '3 eggs');
      await press(
        screen.getByRole('button', { name: 'Undo change to "2 eggs"' }),
      );
      await removeLineText(whisk);
      await press(
        screen.getByRole('button', { name: `Undo change to "${whisk}"` }),
      );
      await addStep('Serve warm.');
      await removeLineText('Serve warm.');
      await pressFinish(navigation);

      expect(screen.queryByTestId('finish-changes-text')).not.toBeOnTheScreen();

      await press(saveButton());

      expect(mutateCall().body).toMatchObject({
        ingredients: null,
        instructions: null,
      });
    });

    it('sends basedOnAttemptId from a resumed draft', async () => {
      const at = Date.now();
      const draft: CookingDraft = {
        version: 1,
        recipeId: 'r1',
        basedOnAttemptId: 'a0',
        startedAt: at,
        savedAt: at,
        elapsedMs: 30 * MINUTE,
        ingredients: null,
        instructions: null,
        checkedIngredients: [],
        checkedSteps: [0],
        notes: '',
        timers: [],
      };
      await AsyncStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
      const navigation = await renderCooking();
      await press(screen.getByRole('button', { name: 'Resume' }));
      await pressFinish(navigation);

      expect(tookText()).toHaveTextContent('took 30 min', { exact: false });

      await press(saveButton());

      expect(mutateCall().body).toMatchObject({
        durationMinutes: 30,
        basedOnAttemptId: 'a0',
      });
    });

    it('shows a busy Save while the request is pending', async () => {
      const navigation = await renderCooking();
      await pressFinish(navigation);
      await press(saveButton());

      await setAttemptState({ isPending: true });

      expect(screen.getByTestId('finish-save-button')).toBeDisabled();
      expect(
        screen.queryByRole('button', { name: 'Save attempt' }),
      ).not.toBeOnTheScreen();
    });

    it('on success deletes the draft for good, turns off the leave prompt and goes back', async () => {
      const navigation = await renderCooking();
      await press(stepCheckbox(whisk, 1));
      await advance(500);
      expect(await storedDraft()).toMatchObject({ checkedSteps: [0] });
      expect(lastPreventRemove().prevent).toBe(true);

      await pressFinish(navigation);
      await press(saveButton());
      const { onSuccess } = mutateCall();

      // Nothing happens until the server answers.
      expect(navigation.popTo).not.toHaveBeenCalled();
      expect(await storedDraft()).not.toBeNull();

      await act(async () => onSuccess());

      expect(await storedDraft()).toBeNull();
      expect(lastPreventRemove().prevent).toBe(false);
      expectBackToRecipe(navigation);
      expect(navigation.dispatch).not.toHaveBeenCalled();

      // Neither a pending save, the background nor leaving writes it back.
      await advance(5000);
      await changeAppState('background');
      await screen.unmount();

      expect(await AsyncStorage.getAllKeys()).toEqual([]);
    });

    it('on error shows the message and keeps the sheet open; closing it resets the mutation', async () => {
      const navigation = await renderCooking();
      await pressFinish(navigation);
      await press(saveButton());

      await setAttemptState({
        error: new RecipesError('Recipe not found', 404),
      });

      expect(sheetTitle()).toBeOnTheScreen();
      expect(screen.getByTestId('finish-error-text')).toHaveTextContent(
        'Recipe not found',
      );
      expect(saveButton()).toBeEnabled();
      expect(navigation.popTo).not.toHaveBeenCalled();
      expect(attemptMutation.reset).not.toHaveBeenCalled();

      await press(backdrop());

      expect(attemptMutation.reset).toHaveBeenCalledTimes(1);
      expect(sheetTitle()).not.toBeOnTheScreen();
    });
  });

  describe('Discard', () => {
    async function pressDiscard(navigation: Navigation) {
      const alert = jest.spyOn(Alert, 'alert');
      await pressFinish(navigation);
      await press(screen.getByRole('button', { name: 'Discard' }));
      expect(alert).toHaveBeenCalledTimes(1);
      return alert.mock.calls[0];
    }

    async function renderWithDraft() {
      const navigation = await renderCooking();
      await press(stepCheckbox(whisk, 1));
      await advance(500);
      expect(await storedDraft()).not.toBeNull();
      return navigation;
    }

    it('asks first, with Cancel as the cancel button and a destructive Discard', async () => {
      const navigation = await renderWithDraft();

      const [title, message, buttons] = await pressDiscard(navigation);

      expect(title).toBe('Discard this attempt?');
      expect(message).toBe('Your progress on this phone will be deleted.');
      expect(buttons).toEqual([
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Discard',
          style: 'destructive',
          onPress: expect.any(Function),
        },
      ]);
      expect(attemptMutation.mutate).not.toHaveBeenCalled();
    });

    it('Cancel keeps the sheet, the draft and the leave prompt', async () => {
      const navigation = await renderWithDraft();
      const [, , buttons] = await pressDiscard(navigation);
      const cancel = buttons!.find(button => button.style === 'cancel');

      await act(async () => cancel!.onPress?.());
      await advance(500);

      expect(sheetTitle()).toBeOnTheScreen();
      expect(await storedDraft()).toMatchObject({ checkedSteps: [0] });
      expect(lastPreventRemove().prevent).toBe(true);
      expect(navigation.popTo).not.toHaveBeenCalled();
    });

    it('Discard deletes the draft and goes back without the leave prompt', async () => {
      const navigation = await renderWithDraft();
      const [, , buttons] = await pressDiscard(navigation);
      const discard = buttons!.find(button => button.style === 'destructive');

      await act(async () => discard!.onPress!());

      expect(await storedDraft()).toBeNull();
      expect(lastPreventRemove().prevent).toBe(false);
      expectBackToRecipe(navigation);
      expect(navigation.dispatch).not.toHaveBeenCalled();
      expect(attemptMutation.mutate).not.toHaveBeenCalled();

      await screen.unmount();

      expect(await AsyncStorage.getAllKeys()).toEqual([]);
    });
  });
});

describe('CookingScreen cooking a past version', () => {
  const DRAFT_KEY = 'cooking-draft:r1';
  const madeAt = '2026-09-21T12:00:00.000Z';
  const whisk = 'Whisk the batter.';
  const cook = 'Cook on a hot pan.';
  const fromVersion = { recipeId: 'r1', fromAttemptId: 'a1' };

  // Against makeRecipe: "2 eggs" became "3 eggs" and the whisk step was left
  // out.
  function makeVersion(overrides: Partial<AttemptDetail> = {}): AttemptDetail {
    return {
      id: 'a1',
      recipeId: 'r1',
      durationMinutes: 30,
      madeAt,
      rating: 4,
      fullness: null,
      enjoyment: null,
      hasPhoto: false,
      notes: null,
      ingredients: [{ text: '1 cup flour' }, { text: '3 eggs' }],
      instructions: cook,
      basedOnAttemptId: null,
      tweaked: true,
      basedOnAttempt: null,
      fork: null,
      createdAt: madeAt,
      updatedAt: madeAt,
      ...overrides,
    };
  }

  beforeEach(() => {
    // Short dates leave out the year only for the current year.
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-24T12:00:00.000Z'));
    mockRecipeQuery({ data: makeRecipe() });
    mockAttemptQuery({ data: makeVersion() });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  async function advance(ms: number) {
    await act(() => jest.advanceTimersByTime(ms));
  }

  async function storedDraft(): Promise<CookingDraft | null> {
    const json = await AsyncStorage.getItem(DRAFT_KEY);
    return json === null ? null : JSON.parse(json);
  }

  // The loading spinner has no role or testID; find it by its host type.
  function hasSpinner(): boolean {
    const search = (node: Element): boolean =>
      node.type === 'ActivityIndicator' ||
      node.children.some(child => typeof child !== 'string' && search(child));
    return search(screen.container);
  }

  const banner = () => screen.queryByTestId('cooking-based-on-banner');
  const stepCheckbox = (text: string, number: number) =>
    screen.getByRole('checkbox', { name: `Step ${number}: ${text}` });
  const undoButton = (original: string) =>
    screen.getByRole('button', { name: `Undo change to "${original}"` });

  // The recipe with the version's changes laid over it.
  function expectVersionLines() {
    expect(screen.getByRole('checkbox', { name: '3 eggs' })).toBeOnTheScreen();
    expect(
      screen.queryByRole('checkbox', { name: '2 eggs' }),
    ).not.toBeOnTheScreen();
    expect(screen.getByText(/^was:/)).toHaveTextContent('was: 2 eggs ·');
    expect(screen.getByText(/^Removed/)).toBeOnTheScreen();
    expect(stepCheckbox(cook, 1)).toBeOnTheScreen();
  }

  // The header lives outside the screen's tree, so its onPress is called
  // directly.
  function pressFinish(navigation: Navigation) {
    const { headerRight } = headerOptions(navigation);
    const button = headerRight() as React.ReactElement<{
      onPress: () => void;
    }>;
    return act(() => button.props.onPress());
  }

  it('asks for the attempt from the route, and for none without it', async () => {
    await renderScreen(fromVersion);

    expect(mockedUseAttempt).toHaveBeenCalledWith('a1');

    mockedUseAttempt.mockClear();
    await renderScreen();

    expect(mockedUseAttempt).toHaveBeenCalledWith(undefined);
  });

  it('shows the spinner while the attempt loads', async () => {
    mockAttemptQuery({ isPending: true });
    await renderScreen(fromVersion);

    expect(hasSpinner()).toBe(true);
    expect(screen.queryByRole('checkbox')).not.toBeOnTheScreen();
  });

  it('shows the error message when the attempt fails to load', async () => {
    mockAttemptQuery({ error: new RecipesError('Attempt not found', 404) });
    await renderScreen(fromVersion);

    expect(screen.getByTestId('cooking-error-text')).toHaveTextContent(
      'Attempt not found',
    );
    expect(hasSpinner()).toBe(false);
  });

  it('shows which version is being cooked', async () => {
    await renderScreen(fromVersion);

    expect(banner()).toHaveTextContent('Cooking your Sep 21 version');
  });

  it('adds the year to the banner for a version from another year', async () => {
    mockAttemptQuery({
      data: makeVersion({ madeAt: '2025-09-21T12:00:00.000Z' }),
    });
    await renderScreen(fromVersion);

    expect(banner()).toHaveTextContent('Cooking your Sep 21, 2025 version');
  });

  it('shows no banner when cooking the recipe itself', async () => {
    await renderScreen();

    expect(banner()).not.toBeOnTheScreen();
    expect(screen.getByRole('checkbox', { name: '2 eggs' })).toBeOnTheScreen();
  });

  it('shows a version without changes as the recipe lines, with the banner', async () => {
    mockAttemptQuery({
      data: makeVersion({ ingredients: null, instructions: null }),
    });
    await renderScreen(fromVersion);

    expect(banner()).toBeOnTheScreen();
    expect(screen.getByRole('checkbox', { name: '2 eggs' })).toBeOnTheScreen();
    expect(stepCheckbox(whisk, 1)).toBeOnTheScreen();
    expect(screen.queryByText(/^was:/)).not.toBeOnTheScreen();
  });

  it('shows the edited ingredient with its old text, and undo restores the recipe line', async () => {
    const user = userEvent.setup();
    await renderScreen(fromVersion);

    expectVersionLines();

    await user.press(undoButton('2 eggs'));

    expect(screen.getByRole('checkbox', { name: '2 eggs' })).toBeOnTheScreen();
    expect(
      screen.queryByRole('checkbox', { name: '3 eggs' }),
    ).not.toBeOnTheScreen();
    expect(screen.queryByText(/^was:/)).not.toBeOnTheScreen();
  });

  it('shows a step the version left out as removed, and undo brings it back', async () => {
    const user = userEvent.setup();
    await renderScreen(fromVersion);

    expect(screen.getByText(whisk)).toBeOnTheScreen();
    expect(screen.getByText(/^Removed/)).toBeOnTheScreen();
    expect(stepCheckbox(cook, 1)).toBeOnTheScreen();

    await user.press(undoButton(whisk));

    expect(stepCheckbox(whisk, 1)).toBeOnTheScreen();
    expect(stepCheckbox(cook, 2)).toBeOnTheScreen();
  });

  it('does not count the version edits as progress: no draft and no leave prompt', async () => {
    await renderScreen(fromVersion);

    expect(lastPreventRemove().prevent).toBe(false);

    await advance(5000);
    await screen.unmount();

    expect(await AsyncStorage.getAllKeys()).toEqual([]);
  });

  it('counts undoing one of the version edits as progress', async () => {
    await renderScreen(fromVersion);

    await fireEvent.press(undoButton('2 eggs'));
    await advance(500);

    expect(lastPreventRemove().prevent).toBe(true);
    expect(await storedDraft()).toMatchObject({
      basedOnAttemptId: 'a1',
      ingredients: [
        { original: '1 cup flour', text: '1 cup flour' },
        { original: '2 eggs', text: '2 eggs' },
      ],
    });
  });

  it('saves the version it is based on, and its lines, in the draft', async () => {
    await renderScreen(fromVersion);

    await fireEvent.press(stepCheckbox(cook, 1));
    await advance(500);

    expect(await storedDraft()).toMatchObject({
      recipeId: 'r1',
      basedOnAttemptId: 'a1',
      basedOnMadeAt: madeAt,
      checkedSteps: [1],
      ingredients: [
        { original: '1 cup flour', text: '1 cup flour' },
        { original: '2 eggs', text: '3 eggs' },
      ],
      instructions: [
        { original: whisk, text: null },
        { original: cook, text: cook },
      ],
    });
  });

  it('keeps the banner and the edits when the draft is resumed', async () => {
    await renderScreen(fromVersion);
    await fireEvent.press(stepCheckbox(cook, 1));
    await advance(500);
    await screen.unmount();

    // Back through recipe detail's Start cooking: no fromAttemptId.
    await renderScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Resume' }));

    expect(banner()).toHaveTextContent('Cooking your Sep 21 version');
    expectVersionLines();
    expect(stepCheckbox(cook, 1)).toBeChecked();
  });

  describe('with a draft already on the phone', () => {
    beforeEach(async () => {
      const at = Date.now();
      const draft: CookingDraft = {
        version: 1,
        recipeId: 'r1',
        startedAt: at,
        savedAt: at,
        elapsedMs: 0,
        ingredients: null,
        instructions: null,
        checkedIngredients: [0],
        checkedSteps: [],
        notes: 'Lumpy',
        timers: [],
      };
      await AsyncStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    });

    it('asks about the draft first', async () => {
      await renderScreen(fromVersion);

      expect(
        screen.getByRole('header', { name: 'Pick up where you left off?' }),
      ).toBeOnTheScreen();
      expect(banner()).not.toBeOnTheScreen();
    });

    it('Start over starts from the version', async () => {
      await renderScreen(fromVersion);

      await fireEvent.press(screen.getByRole('button', { name: 'Start over' }));

      expect(banner()).toHaveTextContent('Cooking your Sep 21 version');
      expectVersionLines();
      expect(
        screen.getByRole('checkbox', { name: '1 cup flour' }),
      ).not.toBeChecked();
      expect(screen.getByLabelText('NOTES')).toHaveDisplayValue('');
    });

    it('Resume picks up the draft instead of the version', async () => {
      await renderScreen(fromVersion);

      await fireEvent.press(screen.getByRole('button', { name: 'Resume' }));

      expect(banner()).not.toBeOnTheScreen();
      expect(
        screen.getByRole('checkbox', { name: '2 eggs' }),
      ).toBeOnTheScreen();
      expect(
        screen.getByRole('checkbox', { name: '1 cup flour' }),
      ).toBeChecked();
      expect(stepCheckbox(whisk, 1)).toBeOnTheScreen();
      expect(screen.getByLabelText('NOTES')).toHaveDisplayValue('Lumpy');
    });
  });

  it('saves the attempt as based on the version, with its lines, then goes back to the recipe', async () => {
    const navigation = await renderScreen(fromVersion);
    await pressFinish(navigation);

    await fireEvent.press(screen.getByRole('button', { name: 'Save attempt' }));

    expect(attemptMutation.mutate).toHaveBeenCalledTimes(1);
    const [body, options] = attemptMutation.mutate.mock.calls[0];
    expect(body).toMatchObject({
      basedOnAttemptId: 'a1',
      ingredients: [{ text: '1 cup flour' }, { text: '3 eggs' }],
      instructions: cook,
    });

    await act(async () => options.onSuccess());

    expectBackToRecipe(navigation);
  });
});
