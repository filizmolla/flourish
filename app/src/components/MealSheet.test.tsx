import React from 'react';
import { Alert, AlertButton } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render,
  screen,
  userEvent,
  waitFor,
} from '@testing-library/react-native';
import {
  deleteMeal,
  FoodGroup,
  Fullness,
  Meal,
  mealPhotoUrl,
  MealKind,
  RecipesError,
  updateMeal,
} from '../api/recipesClient';
import { useAuth } from '../auth/AuthContext';
import { mealKeys } from '../hooks/useMeals';
import { MealSheet } from './MealSheet';

jest.mock('../api/recipesClient', () => ({
  ...jest.requireActual('../api/recipesClient'),
  updateMeal: jest.fn(),
  deleteMeal: jest.fn(),
}));
jest.mock('../auth/AuthContext', () => ({ useAuth: jest.fn() }));

const mockedUpdateMeal = jest.mocked(updateMeal);
const mockedDeleteMeal = jest.mocked(deleteMeal);
const mockedUseAuth = jest.mocked(useAuth);

const { Protein, Fiber, HealthyFat } = FoodGroup;

type Element = ReturnType<typeof screen.getByTestId>;

// Built from local parts so the day and time shown never depend on the
// machine's time zone. Sep 30 2026 is a Wednesday.
const localIso = (month: number, day: number, hour: number, minute: number) =>
  new Date(2026, month - 1, day, hour, minute).toISOString();

function makeMeal(overrides: Partial<Meal> = {}): Meal {
  return {
    id: 'm1',
    kind: MealKind.Meal,
    eatenAt: localIso(9, 30, 13, 10),
    text: 'lentil soup, bread',
    nutrients: [Protein, Fiber],
    fullness: Fullness.Satisfied,
    hasPhoto: false,
    createdAt: '2026-09-30T12:00:00.000Z',
    updatedAt: '2026-09-30T12:00:00.000Z',
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

let queryClient: QueryClient;

function SignedInQueryProvider({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

function signIn(token: string | null) {
  mockedUseAuth.mockReturnValue({
    status: token ? 'signedIn' : 'signedOut',
    user: null,
    token,
    signIn: jest.fn(),
    signUp: jest.fn(),
    signOut: jest.fn(),
  } as unknown as ReturnType<typeof useAuth>);
}

async function renderSheet(meal: Meal = makeMeal(), token: string | null = 'tok') {
  const onClose = jest.fn();
  await render(<MealSheet meal={meal} token={token} onClose={onClose} />, {
    wrapper: SignedInQueryProvider,
  });
  return onClose;
}

// The Modal host element around the sheet.
function modal(): Element {
  let node = screen.getByTestId('meal-sheet').parent;
  while (node && node.type !== 'Modal') node = node.parent;
  if (!node) throw new Error('No Modal around the sheet');
  return node;
}

const radio = (name: string) => screen.getByRole('radio', { name });
const radios = () => screen.getAllByRole('radio');
const deleteButton = () => screen.getByTestId('meal-sheet-delete-button');
// The sheet is accessibilityViewIsModal, which hides its sibling backdrop
// from screen readers (and from default queries); it is still tappable.
const backdrop = () =>
  screen.getByRole('button', { name: 'Close', includeHiddenElements: true });

// Presses Delete and returns the confirm Alert's buttons.
async function openDeleteConfirm(
  user: ReturnType<typeof userEvent.setup>,
  alert: jest.SpyInstance,
) {
  await user.press(deleteButton());
  expect(alert).toHaveBeenCalledTimes(1);
  return alert.mock.calls[0][2] as AlertButton[];
}
const button = (buttons: AlertButton[], text: string) =>
  buttons.find(b => b.text === text)!;

let alert: jest.SpyInstance;

beforeEach(() => {
  jest.resetAllMocks();
  alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
  signIn('tok');
});

afterEach(() => {
  alert.mockRestore();
  queryClient.clear();
});

describe('MealSheet content', () => {
  it('shows the kind, the local day and time as a header, and the text', async () => {
    await renderSheet();

    expect(screen.getByText('MEAL')).toBeOnTheScreen();
    expect(
      screen.getByRole('header', { name: 'Wednesday, 13:10' }),
    ).toHaveProp('testID', 'meal-sheet-when');
    expect(screen.getByTestId('meal-sheet-text')).toHaveTextContent(
      'lentil soup, bread',
    );
  });

  it('says SNACK for a snack', async () => {
    await renderSheet(makeMeal({ kind: MealKind.Snack }));

    expect(screen.getByText('SNACK')).toBeOnTheScreen();
    expect(screen.queryByText('MEAL')).not.toBeOnTheScreen();
  });

  it.each([
    ['Monday just after midnight', localIso(9, 28, 0, 5), 'Monday, 00:05'],
    ['Sunday just before midnight', localIso(10, 4, 23, 59), 'Sunday, 23:59'],
    ['a single-digit hour', localIso(10, 1, 8, 0), 'Thursday, 08:00'],
  ])('pads the time and names the day for %s', async (_, eatenAt, when) => {
    await renderSheet(makeMeal({ eatenAt }));

    expect(screen.getByTestId('meal-sheet-when')).toHaveTextContent(when);
  });

  it('has no photo when the meal has none', async () => {
    await renderSheet();

    expect(screen.queryByTestId('meal-sheet-photo')).not.toBeOnTheScreen();
  });

  it('shows the photo fetched with the token', async () => {
    await renderSheet(makeMeal({ id: 'p 1', hasPhoto: true }));

    expect(screen.getByTestId('meal-sheet-photo')).toHaveProp('source', {
      uri: mealPhotoUrl('p 1'),
      headers: { Authorization: 'Bearer tok' },
    });
  });

  it('sends no Authorization header for the photo without a token', async () => {
    await renderSheet(makeMeal({ hasPhoto: true }), null);

    expect(screen.getByTestId('meal-sheet-photo')).toHaveProp('source', {
      uri: mealPhotoUrl('m1'),
      headers: {},
    });
  });
});

describe('MealSheet balance', () => {
  const dots = () => screen.getByRole('image');
  const balanceText = () => screen.getByTestId('meal-sheet-balance-text');

  it('names what the meal brought, and reads the dots out', async () => {
    await renderSheet(makeMeal({ nutrients: [Protein, Fiber] }));

    expect(balanceText()).toHaveTextContent('Protein and fiber in this.');
    expect(dots()).toHaveProp('testID', 'meal-sheet-nutrient-dots');
    expect(dots()).toHaveAccessibleName(
      'Has protein and fiber, no healthy fat yet',
    );
  });

  it('lists nutrients in dot order, whatever order they arrive in', async () => {
    await renderSheet(makeMeal({ nutrients: [HealthyFat, Protein] }));

    expect(balanceText()).toHaveTextContent('Protein and healthy fat in this.');
    expect(dots()).toHaveAccessibleName(
      'Has protein and healthy fat, no fiber yet',
    );
  });

  it('says Balanced plate when all three are there', async () => {
    await renderSheet(makeMeal({ nutrients: [Fiber, HealthyFat, Protein] }));

    expect(balanceText()).toHaveTextContent('Balanced plate ✓');
    expect(dots()).toHaveAccessibleName(
      'Has protein, fiber and healthy fat',
    );
  });

  it('says nothing was found for a text meal with no known foods', async () => {
    await renderSheet(makeMeal({ text: 'tea', nutrients: [] }));

    expect(balanceText()).toHaveTextContent(
      'No protein, fiber or healthy fat found.',
    );
    expect(dots()).toHaveAccessibleName(
      'No protein, fiber or healthy fat yet',
    );
  });

  it('asks for the text on a photo-only meal, with no text shown', async () => {
    await renderSheet(makeMeal({ text: null, nutrients: [], hasPhoto: true }));

    expect(balanceText()).toHaveTextContent(
      'Add what was in it to see the balance.',
    );
    expect(screen.queryByTestId('meal-sheet-text')).not.toBeOnTheScreen();
  });
});

describe('MealSheet fullness', () => {
  it("checks the meal's fullness", async () => {
    await renderSheet();

    expect(screen.getByLabelText('How did you feel after?')).toBeOnTheScreen();
    expect(radio('Satisfied')).toBeChecked();
    expect(radio('Still hungry')).not.toBeChecked();
    expect(radio('Very full')).not.toBeChecked();
    expect(radio('Satisfied')).toHaveProp('testID', 'meal-sheet-fullness-satisfied');
  });

  it('checks none when no fullness was picked', async () => {
    await renderSheet(makeMeal({ fullness: null }));

    for (const option of radios()) expect(option).not.toBeChecked();
  });

  it('saves a tapped answer, showing it and disabling the picker while it saves', async () => {
    const user = userEvent.setup();
    const save = deferred<Meal>();
    mockedUpdateMeal.mockReturnValue(save.promise);
    queryClient.setQueryData(['meals', 'week', 'x'], []);
    queryClient.setQueryData(['recipes'], []);
    await renderSheet();

    await user.press(radio('Very full'));

    expect(mockedUpdateMeal).toHaveBeenCalledTimes(1);
    expect(mockedUpdateMeal).toHaveBeenCalledWith('tok', 'm1', {
      fullness: Fullness.VeryFull,
    });
    expect(radio('Very full')).toBeChecked();
    expect(radio('Satisfied')).not.toBeChecked();
    for (const option of radios()) expect(option).toBeDisabled();
    // Deleting isn't blocked by a save.
    expect(deleteButton()).toBeEnabled();

    await act(async () => {
      save.resolve(makeMeal({ fullness: Fullness.VeryFull }));
    });

    // Still the saved answer, although the meal prop is the old one.
    await waitFor(() => expect(radio('Very full')).toBeEnabled());
    expect(radio('Very full')).toBeChecked();
    expect(radio('Satisfied')).not.toBeChecked();
    for (const option of radios()) expect(option).toBeEnabled();
    expect(screen.queryByTestId('meal-sheet-error-text')).not.toBeOnTheScreen();
    expect(
      queryClient.getQueryState(['meals', 'week', 'x'])?.isInvalidated,
    ).toBe(true);
    expect(queryClient.getQueryState(['recipes'])?.isInvalidated).toBe(false);
  });

  it('clears the answer when the checked one is tapped again', async () => {
    const user = userEvent.setup();
    const save = deferred<Meal>();
    mockedUpdateMeal.mockReturnValue(save.promise);
    await renderSheet();

    await user.press(radio('Satisfied'));

    expect(mockedUpdateMeal).toHaveBeenCalledWith('tok', 'm1', {
      fullness: null,
    });
    // The pending null is shown, not the meal's old answer.
    for (const option of radios()) expect(option).not.toBeChecked();

    await act(async () => {
      save.resolve(makeMeal({ fullness: null }));
    });

    for (const option of radios()) expect(option).not.toBeChecked();
  });

  it("shows an error and the meal's own answer when saving fails, and a retry clears it", async () => {
    const user = userEvent.setup();
    mockedUpdateMeal.mockRejectedValueOnce(new RecipesError('offline', 500));
    mockedUpdateMeal.mockResolvedValueOnce(
      makeMeal({ fullness: Fullness.StillHungry }),
    );
    queryClient.setQueryData(mealKeys.all, []);
    await renderSheet();

    await user.press(radio('Very full'));

    expect(await screen.findByTestId('meal-sheet-error-text')).toHaveTextContent(
      "Couldn't save. Try again.",
    );
    expect(radio('Satisfied')).toBeChecked();
    expect(radio('Very full')).not.toBeChecked();
    for (const option of radios()) expect(option).toBeEnabled();
    expect(queryClient.getQueryState(mealKeys.all)?.isInvalidated).toBe(false);

    await user.press(radio('Still hungry'));

    expect(await screen.findByRole('radio', { name: 'Still hungry', checked: true })).toBeOnTheScreen();
    expect(screen.queryByTestId('meal-sheet-error-text')).not.toBeOnTheScreen();
    expect(mockedUpdateMeal).toHaveBeenLastCalledWith('tok', 'm1', {
      fullness: Fullness.StillHungry,
    });
  });
});

describe('MealSheet delete', () => {
  it('asks before deleting, and Cancel deletes nothing', async () => {
    const user = userEvent.setup();
    const onClose = await renderSheet();

    expect(deleteButton()).toHaveTextContent('Delete this meal');
    const buttons = await openDeleteConfirm(user, alert);

    const [title, message] = alert.mock.calls[0];
    expect(title).toBe('Delete this meal?');
    expect(message).toBe('It will be gone from your week, photo and all.');
    expect(buttons.map(b => [b.text, b.style])).toEqual([
      ['Cancel', 'cancel'],
      ['Delete', 'destructive'],
    ]);
    expect(button(buttons, 'Cancel').onPress).toBeUndefined();
    expect(mockedDeleteMeal).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('deletes on confirm, locks the sheet while deleting, then closes', async () => {
    const user = userEvent.setup();
    const removal = deferred<void>();
    mockedDeleteMeal.mockReturnValue(removal.promise);
    queryClient.setQueryData(['meals', 'week', 'x'], []);
    const onClose = await renderSheet();

    const buttons = await openDeleteConfirm(user, alert);
    await act(async () => {
      button(buttons, 'Delete').onPress!();
    });

    expect(mockedDeleteMeal).toHaveBeenCalledTimes(1);
    expect(mockedDeleteMeal).toHaveBeenCalledWith('tok', 'm1');
    await waitFor(() => expect(deleteButton()).toBeDisabled());
    expect(screen.queryByText('Delete this meal')).not.toBeOnTheScreen();
    for (const option of radios()) expect(option).toBeDisabled();

    // Neither the backdrop nor Android back closes it mid-delete.
    await user.press(backdrop());
    await fireEvent(modal(), 'requestClose');
    await fireEvent(screen.getByTestId('meal-sheet'), 'accessibilityEscape');
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => {
      removal.resolve();
    });

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(
      queryClient.getQueryState(['meals', 'week', 'x'])?.isInvalidated,
    ).toBe(true);
    // Only the confirm Alert, no failure Alert.
    expect(alert).toHaveBeenCalledTimes(1);
  });

  it('tells the user when deleting fails and keeps the sheet open', async () => {
    const user = userEvent.setup();
    mockedDeleteMeal.mockRejectedValue(new RecipesError('Meal not found', 404));
    queryClient.setQueryData(mealKeys.all, []);
    const onClose = await renderSheet();

    const buttons = await openDeleteConfirm(user, alert);
    await act(async () => {
      button(buttons, 'Delete').onPress!();
    });

    expect(alert).toHaveBeenCalledTimes(2);
    expect(alert).toHaveBeenLastCalledWith(
      "Couldn't delete the meal",
      'Meal not found',
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(deleteButton()).toBeEnabled();
    expect(screen.getByText('Delete this meal')).toBeOnTheScreen();
    expect(queryClient.getQueryState(mealKeys.all)?.isInvalidated).toBe(false);
  });
});

describe('MealSheet edit', () => {
  // Wednesday Sep 30 2026, 15:00 local: the default meal (13:10) is today.
  const NOW = new Date(2026, 8, 30, 15, 0);
  let user: ReturnType<typeof userEvent.setup>;

  const editButton = () => screen.getByRole('button', { name: 'Edit' });
  const saveButton = () => screen.getByRole('button', { name: 'Save' });
  const cancelButton = () => screen.getByRole('button', { name: 'Cancel' });
  const textInput = () => screen.getByLabelText('What was in it?');

  async function retype(text: string) {
    await user.clear(textInput());
    if (text) await user.type(textInput(), text);
  }

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
    user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('opens a form prefilled from the meal, in place of the view', async () => {
    await renderSheet();

    await user.press(editButton());

    expect(radio('Meal')).toBeChecked();
    expect(radio('Snack')).not.toBeChecked();
    expect(textInput()).toHaveDisplayValue('lentil soup, bread');
    expect(radio('Today')).toBeChecked();
    expect(radio('Yesterday')).not.toBeChecked();
    expect(saveButton()).toBeEnabled();
    expect(cancelButton()).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeOnTheScreen();
    expect(screen.queryByTestId('meal-sheet-text')).not.toBeOnTheScreen();
    expect(screen.queryByTestId('meal-sheet-delete-button')).not.toBeOnTheScreen();
    expect(screen.queryByRole('radio', { name: 'Satisfied' })).not.toBeOnTheScreen();
    expect(screen.queryByTestId('meal-sheet-error-text')).not.toBeOnTheScreen();
  });

  it('prefills Snack and Yesterday for a snack eaten yesterday', async () => {
    await renderSheet(
      makeMeal({ kind: MealKind.Snack, eatenAt: localIso(9, 29, 23, 30) }),
    );

    await user.press(editButton());

    expect(radio('Snack')).toBeChecked();
    expect(radio('Meal')).not.toBeChecked();
    expect(radio('Yesterday')).toBeChecked();
    expect(radio('Today')).not.toBeChecked();
  });

  it('prefills today for a meal eaten just after midnight', async () => {
    await renderSheet(makeMeal({ eatenAt: localIso(9, 30, 0, 1) }));

    await user.press(editButton());

    expect(radio('Today')).toBeChecked();
  });

  it('selects no day for a meal older than yesterday, and keeps its date on Save', async () => {
    await renderSheet(makeMeal({ eatenAt: localIso(9, 28, 13, 10) }));

    await user.press(editButton());

    expect(radio('Today')).not.toBeChecked();
    expect(radio('Yesterday')).not.toBeChecked();

    await user.press(radio('Snack'));
    await user.press(saveButton());

    expect(mockedUpdateMeal).toHaveBeenCalledTimes(1);
    expect(mockedUpdateMeal).toHaveBeenCalledWith('tok', 'm1', {
      kind: MealKind.Snack,
    });
  });

  it('sends only the trimmed text when only the text changed', async () => {
    mockedUpdateMeal.mockReturnValue(deferred<Meal>().promise);
    await renderSheet();

    await user.press(editButton());
    await retype('  lentil soup, rice  ');
    await user.press(saveButton());

    expect(mockedUpdateMeal).toHaveBeenCalledTimes(1);
    expect(mockedUpdateMeal).toHaveBeenCalledWith('tok', 'm1', {
      text: 'lentil soup, rice',
    });
  });

  it('sends only the kind when only the kind changed', async () => {
    mockedUpdateMeal.mockReturnValue(deferred<Meal>().promise);
    await renderSheet();

    await user.press(editButton());
    await user.press(radio('Snack'));

    expect(radio('Snack')).toBeChecked();
    expect(radio('Meal')).not.toBeChecked();

    await user.press(saveButton());

    expect(mockedUpdateMeal).toHaveBeenCalledTimes(1);
    expect(mockedUpdateMeal).toHaveBeenCalledWith('tok', 'm1', {
      kind: MealKind.Snack,
    });
  });

  it('moves the meal to yesterday at the same time of day', async () => {
    mockedUpdateMeal.mockReturnValue(deferred<Meal>().promise);
    await renderSheet();

    await user.press(editButton());
    await user.press(radio('Yesterday'));
    await user.press(saveButton());

    expect(mockedUpdateMeal).toHaveBeenCalledTimes(1);
    expect(mockedUpdateMeal).toHaveBeenCalledWith('tok', 'm1', {
      eatenAt: localIso(9, 29, 13, 10),
    });
  });

  it('moves an older meal to yesterday at the same time of day', async () => {
    mockedUpdateMeal.mockReturnValue(deferred<Meal>().promise);
    await renderSheet(makeMeal({ eatenAt: localIso(9, 21, 8, 45) }));

    await user.press(editButton());
    await user.press(radio('Yesterday'));
    await user.press(saveButton());

    expect(mockedUpdateMeal).toHaveBeenCalledWith('tok', 'm1', {
      eatenAt: localIso(9, 29, 8, 45),
    });
  });

  it('moves a meal to today at the same time when that is already past', async () => {
    mockedUpdateMeal.mockReturnValue(deferred<Meal>().promise);
    await renderSheet(makeMeal({ eatenAt: localIso(9, 29, 9, 30) }));

    await user.press(editButton());
    await user.press(radio('Today'));
    await user.press(saveButton());

    expect(mockedUpdateMeal).toHaveBeenCalledWith('tok', 'm1', {
      eatenAt: localIso(9, 30, 9, 30),
    });
  });

  it('moves a meal to now when its time of day today is still ahead', async () => {
    mockedUpdateMeal.mockReturnValue(deferred<Meal>().promise);
    await renderSheet(makeMeal({ eatenAt: localIso(9, 29, 20, 0) }));

    await user.press(editButton());
    await user.press(radio('Today'));
    await user.press(saveButton());

    expect(mockedUpdateMeal).toHaveBeenCalledTimes(1);
    const { eatenAt } = mockedUpdateMeal.mock.calls[0][2];
    // Now, give or take the milliseconds the fake timers moved on while pressing.
    const sent = new Date(eatenAt!).getTime();
    expect(sent).toBeGreaterThanOrEqual(NOW.getTime());
    expect(sent).toBeLessThan(NOW.getTime() + 60_000);
    expect(mockedUpdateMeal.mock.calls[0][2]).toEqual({ eatenAt });
  });

  it('sends every changed field together', async () => {
    mockedUpdateMeal.mockReturnValue(deferred<Meal>().promise);
    await renderSheet();

    await user.press(editButton());
    await retype('tea');
    await user.press(radio('Snack'));
    await user.press(radio('Yesterday'));
    await user.press(saveButton());

    expect(mockedUpdateMeal).toHaveBeenCalledWith('tok', 'm1', {
      text: 'tea',
      kind: MealKind.Snack,
      eatenAt: localIso(9, 29, 13, 10),
    });
  });

  it('closes the form without a request when nothing changed', async () => {
    await renderSheet();

    await user.press(editButton());
    // Touched but back to the same values, text only differing by spaces.
    await retype(' lentil soup, bread ');
    await user.press(radio('Snack'));
    await user.press(radio('Meal'));
    await user.press(radio('Yesterday'));
    await user.press(radio('Today'));
    await user.press(saveButton());

    expect(mockedUpdateMeal).not.toHaveBeenCalled();
    expect(editButton()).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeOnTheScreen();
    expect(screen.getByTestId('meal-sheet-text')).toHaveTextContent(
      'lentil soup, bread',
    );
  });

  it('sends nothing for an unchanged photo-only meal', async () => {
    await renderSheet(makeMeal({ text: null, nutrients: [], hasPhoto: true }));

    await user.press(editButton());

    expect(textInput()).toHaveDisplayValue('');

    await user.press(saveButton());

    expect(mockedUpdateMeal).not.toHaveBeenCalled();
    expect(editButton()).toBeOnTheScreen();
  });

  it.each([
    ['empty', ''],
    ['only spaces', '   '],
  ])(
    'asks for the text when it is %s on a meal without a photo',
    async (_, text) => {
      await renderSheet();

      await user.press(editButton());
      await retype(text);
      await user.press(saveButton());

      expect(mockedUpdateMeal).not.toHaveBeenCalled();
      expect(screen.getByTestId('meal-sheet-error-text')).toHaveTextContent(
        'A meal without a photo needs what was in it.',
      );
      expect(saveButton()).toBeOnTheScreen();
      expect(textInput()).toHaveDisplayValue(text);
    },
  );

  it('clears the missing-text error once text is back and saves', async () => {
    mockedUpdateMeal.mockReturnValue(deferred<Meal>().promise);
    await renderSheet();

    await user.press(editButton());
    await retype('');
    await user.press(saveButton());
    expect(screen.getByTestId('meal-sheet-error-text')).toBeOnTheScreen();

    await user.type(textInput(), 'rice');
    await user.press(saveButton());

    expect(mockedUpdateMeal).toHaveBeenCalledWith('tok', 'm1', { text: 'rice' });
    expect(screen.queryByTestId('meal-sheet-error-text')).not.toBeOnTheScreen();
  });

  it('sends null for emptied text on a meal with a photo', async () => {
    mockedUpdateMeal.mockReturnValue(deferred<Meal>().promise);
    await renderSheet(makeMeal({ hasPhoto: true }));

    await user.press(editButton());
    await retype('  ');
    await user.press(saveButton());

    expect(mockedUpdateMeal).toHaveBeenCalledTimes(1);
    expect(mockedUpdateMeal).toHaveBeenCalledWith('tok', 'm1', { text: null });
    expect(screen.queryByTestId('meal-sheet-error-text')).not.toBeOnTheScreen();
  });

  it('disables Save and Cancel while saving', async () => {
    mockedUpdateMeal.mockReturnValue(deferred<Meal>().promise);
    await renderSheet();

    await user.press(editButton());
    await user.press(radio('Snack'));
    await user.press(screen.getByTestId('meal-sheet-save-button'));

    const save = screen.getByTestId('meal-sheet-save-button');
    expect(save).toBeDisabled();
    expect(save).toBeBusy();
    expect(cancelButton()).toBeDisabled();
  });

  it('keeps the form and the typed values when saving fails', async () => {
    mockedUpdateMeal.mockRejectedValue(new RecipesError('offline', 500));
    queryClient.setQueryData(mealKeys.all, []);
    await renderSheet();

    await user.press(editButton());
    await retype('lentil soup, rice');
    await user.press(radio('Snack'));
    await user.press(radio('Yesterday'));
    await user.press(saveButton());

    expect(await screen.findByTestId('meal-sheet-error-text')).toHaveTextContent(
      "Couldn't save. Try again.",
    );
    expect(textInput()).toHaveDisplayValue('lentil soup, rice');
    expect(radio('Snack')).toBeChecked();
    expect(radio('Yesterday')).toBeChecked();
    expect(saveButton()).toBeEnabled();
    expect(cancelButton()).toBeEnabled();
    expect(queryClient.getQueryState(mealKeys.all)?.isInvalidated).toBe(false);
  });

  it('shows the saved reply in the view before the parent passes a fresh meal', async () => {
    const save = deferred<Meal>();
    mockedUpdateMeal.mockReturnValue(save.promise);
    queryClient.setQueryData(mealKeys.all, []);
    await renderSheet();

    await user.press(editButton());
    await retype('almonds, apple');
    await user.press(radio('Snack'));
    await user.press(radio('Yesterday'));
    await user.press(saveButton());

    // Still the form until the reply arrives.
    expect(textInput()).toBeOnTheScreen();

    await act(async () => {
      save.resolve(
        makeMeal({
          kind: MealKind.Snack,
          text: 'almonds, apple',
          nutrients: [Fiber, HealthyFat],
          eatenAt: localIso(9, 29, 13, 10),
        }),
      );
    });

    expect(await screen.findByRole('button', { name: 'Edit' })).toBeOnTheScreen();
    expect(screen.queryByLabelText('What was in it?')).not.toBeOnTheScreen();
    expect(screen.getByText('SNACK')).toBeOnTheScreen();
    expect(screen.queryByText('MEAL')).not.toBeOnTheScreen();
    expect(screen.getByTestId('meal-sheet-text')).toHaveTextContent(
      'almonds, apple',
    );
    expect(screen.getByTestId('meal-sheet-balance-text')).toHaveTextContent(
      'Fiber and healthy fat in this.',
    );
    expect(screen.getByRole('image')).toHaveAccessibleName(
      'Has fiber and healthy fat, no protein yet',
    );
    expect(screen.getByTestId('meal-sheet-when')).toHaveTextContent(
      'Tuesday, 13:10',
    );
    expect(screen.queryByTestId('meal-sheet-error-text')).not.toBeOnTheScreen();
    expect(queryClient.getQueryState(mealKeys.all)?.isInvalidated).toBe(true);

    // Editing again starts from the reply, not the stale prop.
    await user.press(editButton());

    expect(textInput()).toHaveDisplayValue('almonds, apple');
    expect(radio('Snack')).toBeChecked();
    expect(radio('Yesterday')).toBeChecked();
  });

  it('Cancel restores the view with the original values and sends nothing', async () => {
    await renderSheet();

    await user.press(editButton());
    await retype('something else');
    await user.press(radio('Snack'));
    await user.press(radio('Yesterday'));
    await user.press(cancelButton());

    expect(mockedUpdateMeal).not.toHaveBeenCalled();
    expect(editButton()).toBeOnTheScreen();
    expect(screen.queryByLabelText('What was in it?')).not.toBeOnTheScreen();
    expect(screen.getByText('MEAL')).toBeOnTheScreen();
    expect(screen.getByTestId('meal-sheet-text')).toHaveTextContent(
      'lentil soup, bread',
    );
    expect(screen.getByTestId('meal-sheet-when')).toHaveTextContent(
      'Wednesday, 13:10',
    );

    // The next Edit is prefilled from the meal again, not the discarded draft.
    await user.press(editButton());

    expect(textInput()).toHaveDisplayValue('lentil soup, bread');
    expect(radio('Meal')).toBeChecked();
    expect(radio('Today')).toBeChecked();
  });

  it('Cancel after a failed save clears the error from the view and the next form', async () => {
    mockedUpdateMeal.mockRejectedValue(new RecipesError('offline', 500));
    await renderSheet();

    await user.press(editButton());
    await user.press(radio('Snack'));
    await user.press(saveButton());
    expect(await screen.findByTestId('meal-sheet-error-text')).toBeOnTheScreen();

    await user.press(cancelButton());

    expect(screen.queryByTestId('meal-sheet-error-text')).not.toBeOnTheScreen();
    expect(screen.getByText('MEAL')).toBeOnTheScreen();

    await user.press(editButton());

    expect(screen.queryByTestId('meal-sheet-error-text')).not.toBeOnTheScreen();
    expect(radio('Meal')).toBeChecked();
  });

  it('Cancel clears the missing-text error for the next form', async () => {
    await renderSheet();

    await user.press(editButton());
    await retype('');
    await user.press(saveButton());
    expect(screen.getByTestId('meal-sheet-error-text')).toBeOnTheScreen();

    await user.press(cancelButton());
    await user.press(editButton());

    expect(screen.queryByTestId('meal-sheet-error-text')).not.toBeOnTheScreen();
    expect(textInput()).toHaveDisplayValue('lentil soup, bread');
  });
});

describe('MealSheet closing', () => {
  it('closes on a backdrop tap', async () => {
    const user = userEvent.setup();
    const onClose = await renderSheet();

    await user.press(backdrop());

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Android back', async () => {
    const onClose = await renderSheet();

    await fireEvent(modal(), 'requestClose');

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on the screen reader escape gesture', async () => {
    const onClose = await renderSheet();

    await fireEvent(screen.getByTestId('meal-sheet'), 'accessibilityEscape');

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
