import React from 'react';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, userEvent } from '@testing-library/react-native';
import {
  ImagePickerResponse,
  launchCamera,
  launchImageLibrary,
} from 'react-native-image-picker';
import {
  createMeal,
  fetchRecentSnacks,
  FoodGroup,
  Fullness,
  Meal,
  MealInput,
  MealKind,
  Nutrient,
  RecipesError,
} from '../api/recipesClient';
import { useAuth } from '../auth/AuthContext';
import { AuthStatus } from '../auth/authStatus';
import { AppStackParamList, Screens } from '../navigation/types';
import { PICKER_OPTIONS } from '../photoPicker';
import AddMealScreen from './AddMealScreen';

jest.mock('../api/recipesClient', () => ({
  ...jest.requireActual('../api/recipesClient'),
  createMeal: jest.fn(),
  fetchRecentSnacks: jest.fn(),
}));
jest.mock('../auth/AuthContext', () => ({ useAuth: jest.fn() }));

type Props = NativeStackScreenProps<AppStackParamList, Screens.AddMeal>;

const mockedCreateMeal = jest.mocked(createMeal);
const mockedFetchRecentSnacks = jest.mocked(fetchRecentSnacks);
const mockedUseAuth = jest.mocked(useAuth);
const mockedLaunchCamera = jest.mocked(launchCamera);
const mockedLaunchImageLibrary = jest.mocked(launchImageLibrary);

const DAY_MS = 24 * 60 * 60 * 1000;
const { Protein, Fiber, HealthyFat } = FoodGroup;

const NEEDS_SOMETHING = 'Add a photo or what was in it.';
const SAVE_FAILED = "Couldn't save. Check your connection and try again.";
const CAMERA_ERROR = "Couldn't open the camera. You can still choose a photo.";

function picked(n: number): ImagePickerResponse {
  return { assets: [{ uri: `file:///meal-${n}.jpg`, base64: `base64-${n}` }] };
}

function makeMeal(overrides: Partial<Meal> = {}): Meal {
  return {
    id: 'm1',
    kind: MealKind.Meal,
    eatenAt: '2026-09-29T12:00:00.000Z',
    text: 'lentil soup',
    nutrients: [],
    fullness: null,
    hasPhoto: false,
    createdAt: '2026-09-29T12:00:00.000Z',
    updatedAt: '2026-09-29T12:00:00.000Z',
    ...overrides,
  };
}

let queryClient: QueryClient;

function SignedInQueryProvider({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

async function renderScreen() {
  const navigation = { navigate: jest.fn(), goBack: jest.fn() };
  await render(
    <AddMealScreen
      navigation={navigation as unknown as Props['navigation']}
      route={{ key: 'AddMeal-1', name: Screens.AddMeal } as Props['route']}
    />,
    { wrapper: SignedInQueryProvider },
  );
  return navigation;
}

const saveButton = () => screen.getByRole('button', { name: 'Save' });
const textInput = () => screen.getByLabelText('What was in it?');
const sentInput = (): MealInput => mockedCreateMeal.mock.calls[0][1];

beforeEach(() => {
  jest.clearAllMocks();
  mockedLaunchCamera.mockResolvedValue({ didCancel: true });
  mockedLaunchImageLibrary.mockResolvedValue({ didCancel: true });
  mockedFetchRecentSnacks.mockResolvedValue([]);
  mockedCreateMeal.mockResolvedValue(makeMeal());
  queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
  mockedUseAuth.mockReturnValue({
    status: AuthStatus.SignedIn,
    user: { id: 'u1', name: 'Filiz Test', email: 'f@test.local' },
    token: 'tok',
    signIn: jest.fn(),
    signUp: jest.fn(),
    signOut: jest.fn(),
  } as unknown as ReturnType<typeof useAuth>);
});

afterEach(() => {
  queryClient.clear();
});

describe('AddMealScreen form', () => {
  it('starts as a meal for today with nothing chosen and Save disabled', async () => {
    await renderScreen();

    expect(screen.getByText('What did you eat?')).toBeOnTheScreen();
    expect(screen.getByRole('radio', { name: 'Meal' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Snack' })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: 'Today' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Yesterday' })).not.toBeChecked();
    for (const name of ['Still hungry', 'Satisfied', 'Very full']) {
      expect(screen.getByRole('radio', { name })).not.toBeChecked();
    }
    expect(saveButton()).toBeDisabled();
    expect(screen.getByText(NEEDS_SOMETHING)).toBeOnTheScreen();
  });

  it('enables Save once there is text and hides the hint', async () => {
    const user = userEvent.setup();
    await renderScreen();

    await user.type(textInput(), 'soup');

    expect(saveButton()).toBeEnabled();
    expect(screen.queryByText(NEEDS_SOMETHING)).not.toBeOnTheScreen();
  });

  it('keeps Save disabled for whitespace-only text', async () => {
    const user = userEvent.setup();
    await renderScreen();

    await user.type(textInput(), '   ');

    expect(saveButton()).toBeDisabled();
    expect(screen.getByText(NEEDS_SOMETHING)).toBeOnTheScreen();
  });

  it('saves a text-only meal for today with the text trimmed, no photo and no eatenAt', async () => {
    const user = userEvent.setup();
    await renderScreen();

    await user.type(textInput(), '  lentil soup  ');
    await user.press(saveButton());

    expect(mockedCreateMeal).toHaveBeenCalledTimes(1);
    expect(mockedCreateMeal).toHaveBeenCalledWith('tok', {
      kind: MealKind.Meal,
      text: 'lentil soup',
      fullness: null,
    });
    expect(sentInput()).not.toHaveProperty('photo');
    expect(sentInput()).not.toHaveProperty('eatenAt');
  });

  it('saves a snack when Snack is chosen', async () => {
    const user = userEvent.setup();
    await renderScreen();

    await user.press(screen.getByRole('radio', { name: 'Snack' }));
    expect(screen.getByRole('radio', { name: 'Snack' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Meal' })).not.toBeChecked();
    await user.type(textInput(), 'an apple');
    await user.press(saveButton());

    expect(sentInput().kind).toBe(MealKind.Snack);
  });

  it('sends the chosen fullness, and a second tap clears it', async () => {
    const user = userEvent.setup();
    await renderScreen();
    await user.type(textInput(), 'soup');

    const satisfied = screen.getByRole('radio', { name: 'Satisfied' });
    await user.press(satisfied);
    expect(satisfied).toBeChecked();
    await user.press(screen.getByRole('radio', { name: 'Very full' }));
    expect(satisfied).not.toBeChecked();
    expect(screen.getByRole('radio', { name: 'Very full' })).toBeChecked();

    await user.press(saveButton());
    expect(sentInput().fullness).toBe(Fullness.VeryFull);
  });

  it('sends fullness null after tapping the chosen one again', async () => {
    const user = userEvent.setup();
    await renderScreen();
    await user.type(textInput(), 'soup');

    const hungry = screen.getByRole('radio', { name: 'Still hungry' });
    await user.press(hungry);
    await user.press(hungry);
    expect(hungry).not.toBeChecked();

    await user.press(saveButton());
    expect(sentInput().fullness).toBeNull();
  });

  it('sends eatenAt a day back when Yesterday is chosen', async () => {
    const user = userEvent.setup();
    await renderScreen();
    await user.type(textInput(), 'soup');
    await user.press(screen.getByRole('radio', { name: 'Yesterday' }));
    expect(screen.getByRole('radio', { name: 'Yesterday' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Today' })).not.toBeChecked();

    const before = Date.now();
    await user.press(saveButton());
    const after = Date.now();

    const eatenAt = Date.parse(sentInput().eatenAt!);
    expect(eatenAt).toBeGreaterThanOrEqual(before - DAY_MS);
    expect(eatenAt).toBeLessThanOrEqual(after - DAY_MS);
  });

  it('sends no eatenAt after switching back to Today', async () => {
    const user = userEvent.setup();
    await renderScreen();
    await user.type(textInput(), 'soup');
    await user.press(screen.getByRole('radio', { name: 'Yesterday' }));
    await user.press(screen.getByRole('radio', { name: 'Today' }));

    await user.press(saveButton());

    expect(sentInput()).not.toHaveProperty('eatenAt');
  });
});

describe('AddMealScreen photo', () => {
  it('takes a photo with the shared picker options and shows it', async () => {
    const user = userEvent.setup();
    mockedLaunchCamera.mockResolvedValue(picked(1));
    await renderScreen();

    await user.press(screen.getByRole('button', { name: 'Take photo' }));

    expect(mockedLaunchCamera).toHaveBeenCalledWith(PICKER_OPTIONS);
    expect(screen.getByLabelText('Your meal photo')).toHaveProp('source', {
      uri: 'file:///meal-1.jpg',
    });
    expect(
      screen.queryByRole('button', { name: 'Take photo' }),
    ).not.toBeOnTheScreen();
    expect(saveButton()).toBeEnabled();
  });

  it('saves a photo-only meal with the base64 and text null', async () => {
    const user = userEvent.setup();
    mockedLaunchCamera.mockResolvedValue(picked(1));
    await renderScreen();

    await user.press(screen.getByRole('button', { name: 'Take photo' }));
    await user.press(saveButton());

    expect(mockedCreateMeal).toHaveBeenCalledWith('tok', {
      kind: MealKind.Meal,
      text: null,
      fullness: null,
      photo: 'base64-1',
    });
  });

  it('chooses one photo from the gallery', async () => {
    const user = userEvent.setup();
    mockedLaunchImageLibrary.mockResolvedValue(picked(2));
    await renderScreen();

    await user.press(screen.getByRole('button', { name: 'Choose photo' }));

    expect(mockedLaunchImageLibrary).toHaveBeenCalledWith({
      ...PICKER_OPTIONS,
      selectionLimit: 1,
    });
    expect(screen.getByLabelText('Your meal photo')).toHaveProp('source', {
      uri: 'file:///meal-2.jpg',
    });
  });

  it('does nothing when the camera is cancelled', async () => {
    const user = userEvent.setup();
    await renderScreen();

    await user.press(screen.getByRole('button', { name: 'Take photo' }));

    expect(
      screen.queryByLabelText('Your meal photo'),
    ).not.toBeOnTheScreen();
    expect(screen.queryByText(CAMERA_ERROR)).not.toBeOnTheScreen();
    expect(saveButton()).toBeDisabled();
  });

  it('ignores a response without base64', async () => {
    const user = userEvent.setup();
    mockedLaunchCamera.mockResolvedValue({
      assets: [{ uri: 'file:///meal-1.jpg' }],
    });
    await renderScreen();

    await user.press(screen.getByRole('button', { name: 'Take photo' }));

    expect(
      screen.queryByLabelText('Your meal photo'),
    ).not.toBeOnTheScreen();
    expect(saveButton()).toBeDisabled();
  });

  it('shows the camera error, and a gallery photo clears it', async () => {
    const user = userEvent.setup();
    mockedLaunchCamera.mockResolvedValue({ errorCode: 'camera_unavailable' });
    mockedLaunchImageLibrary.mockResolvedValue(picked(2));
    await renderScreen();

    await user.press(screen.getByRole('button', { name: 'Take photo' }));
    expect(screen.getByText(CAMERA_ERROR)).toBeOnTheScreen();
    expect(saveButton()).toBeDisabled();

    await user.press(screen.getByRole('button', { name: 'Choose photo' }));
    expect(screen.queryByText(CAMERA_ERROR)).not.toBeOnTheScreen();
    expect(screen.getByLabelText('Your meal photo')).toBeOnTheScreen();
  });

  it('removes the photo, bringing back the buttons and disabling Save', async () => {
    const user = userEvent.setup();
    mockedLaunchCamera.mockResolvedValue(picked(1));
    await renderScreen();
    await user.press(screen.getByRole('button', { name: 'Take photo' }));

    await user.press(screen.getByRole('button', { name: 'Remove photo' }));

    expect(
      screen.queryByLabelText('Your meal photo'),
    ).not.toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Take photo' })).toBeOnTheScreen();
    expect(saveButton()).toBeDisabled();
  });
});

describe('AddMealScreen recent snacks', () => {
  it("doesn't fetch or show recent snacks for a meal", async () => {
    mockedFetchRecentSnacks.mockResolvedValue(['an apple']);
    await renderScreen();

    expect(mockedFetchRecentSnacks).not.toHaveBeenCalled();
    expect(screen.queryByText('Recent snacks')).not.toBeOnTheScreen();
  });

  it('shows recent snacks for a snack and fills the text from a chip', async () => {
    const user = userEvent.setup();
    mockedFetchRecentSnacks.mockResolvedValue(['an apple', 'nuts']);
    await renderScreen();

    await user.press(screen.getByRole('radio', { name: 'Snack' }));
    expect(await screen.findByText('Recent snacks')).toBeOnTheScreen();
    expect(mockedFetchRecentSnacks).toHaveBeenCalledWith('tok');
    expect(screen.getByTestId('add-meal-recent-0')).toHaveTextContent(
      'an apple',
    );

    await user.press(screen.getByRole('button', { name: 'nuts' }));

    expect(textInput()).toHaveDisplayValue('nuts');
    expect(saveButton()).toBeEnabled();
  });

  it('hides the chips again when switching back to Meal', async () => {
    const user = userEvent.setup();
    mockedFetchRecentSnacks.mockResolvedValue(['an apple']);
    await renderScreen();
    await user.press(screen.getByRole('radio', { name: 'Snack' }));
    await screen.findByText('Recent snacks');

    await user.press(screen.getByRole('radio', { name: 'Meal' }));

    expect(screen.queryByText('Recent snacks')).not.toBeOnTheScreen();
    expect(
      screen.queryByRole('button', { name: 'an apple' }),
    ).not.toBeOnTheScreen();
  });

  it('shows no recent snacks section when there are none', async () => {
    const user = userEvent.setup();
    await renderScreen();

    await user.press(screen.getByRole('radio', { name: 'Snack' }));
    await screen.findByRole('radio', { name: 'Snack', checked: true });

    expect(mockedFetchRecentSnacks).toHaveBeenCalled();
    expect(screen.queryByText('Recent snacks')).not.toBeOnTheScreen();
  });
});

describe('AddMealScreen saving', () => {
  it('shows the error and keeps the form when saving fails', async () => {
    const user = userEvent.setup();
    mockedCreateMeal.mockRejectedValue(new RecipesError('Server error', 500));
    await renderScreen();
    await user.type(textInput(), 'soup');
    await user.press(screen.getByRole('radio', { name: 'Satisfied' }));

    await user.press(saveButton());

    expect(await screen.findByText(SAVE_FAILED)).toBeOnTheScreen();
    expect(textInput()).toHaveDisplayValue('soup');
    expect(screen.getByRole('radio', { name: 'Satisfied' })).toBeChecked();
    expect(saveButton()).toBeEnabled();
    expect(screen.queryByText('Saved ✓')).not.toBeOnTheScreen();
  });

  it('disables Save while the request is in flight', async () => {
    const user = userEvent.setup();
    mockedCreateMeal.mockReturnValue(new Promise<Meal>(() => {}));
    await renderScreen();
    await user.type(textInput(), 'soup');

    await user.press(saveButton());

    expect(screen.getByTestId('add-meal-save-button')).toBeDisabled();
    expect(mockedCreateMeal).toHaveBeenCalledTimes(1);
  });
});

describe('AddMealScreen after saving', () => {
  async function saveWith(meal: Meal) {
    const user = userEvent.setup();
    mockedCreateMeal.mockResolvedValue(meal);
    const navigation = await renderScreen();
    await user.type(textInput(), meal.text ?? 'x');
    await user.press(saveButton());
    await screen.findByText('Saved ✓');
    return { user, navigation };
  }

  it('asks for the text when only a photo was saved', async () => {
    await saveWith(makeMeal({ text: null, hasPhoto: true, nutrients: [] }));

    expect(screen.getByTestId('add-meal-result-text')).toHaveTextContent(
      'Add what was in it to see the balance.',
    );
    expect(screen.queryByRole('link')).not.toBeOnTheScreen();
    expect(screen.queryByText(/next time/)).not.toBeOnTheScreen();
  });

  it('shows a balanced plate and no link when all three are there', async () => {
    await saveWith(makeMeal({ nutrients: [HealthyFat, Protein, Fiber] }));

    expect(screen.getByTestId('add-meal-result-text')).toHaveTextContent(
      'Balanced plate ✓',
    );
    expect(
      screen.getByRole('image', { name: 'Has protein, fiber and healthy fat' }),
    ).toBeOnTheScreen();
    expect(screen.queryByRole('link')).not.toBeOnTheScreen();
  });

  it.each<[Nutrient[], string, string, string, Nutrient]>([
    [
      [Protein],
      'Protein in this.',
      'Add some fiber next time.',
      'See foods with fiber ›',
      Fiber,
    ],
    [
      [Protein, Fiber],
      'Protein and fiber in this.',
      'Add a healthy fat next time.',
      'See foods with healthy fat ›',
      HealthyFat,
    ],
    [
      [HealthyFat, Fiber],
      'Fiber and healthy fat in this.',
      'Add a protein next time.',
      'See foods with protein ›',
      Protein,
    ],
    [
      [],
      'No protein, fiber or healthy fat found.',
      'Add a protein next time.',
      'See foods with protein ›',
      Protein,
    ],
  ])(
    'for %j says what is in it, what to add, and links to that group',
    async (nutrients, inThis, addNext, linkName, group) => {
      const { user, navigation } = await saveWith(makeMeal({ nutrients }));

      expect(screen.getByTestId('add-meal-result-text')).toHaveTextContent(
        inThis,
      );
      expect(screen.getByText(addNext)).toBeOnTheScreen();

      await user.press(screen.getByRole('link', { name: linkName }));

      expect(navigation.navigate).toHaveBeenCalledTimes(1);
      expect(navigation.navigate).toHaveBeenCalledWith(Screens.Ingredients, {
        group,
      });
    },
  );

  it('labels the dots with what the meal has and lacks', async () => {
    await saveWith(makeMeal({ nutrients: [Fiber] }));

    expect(
      screen.getByRole('image', {
        name: 'Has fiber, no protein or healthy fat yet',
      }),
    ).toBeOnTheScreen();
  });

  it('goes back on Done', async () => {
    const { user, navigation } = await saveWith(makeMeal());

    await user.press(screen.getByRole('button', { name: 'Done' }));

    expect(navigation.goBack).toHaveBeenCalledTimes(1);
    expect(navigation.navigate).not.toHaveBeenCalled();
  });
});
