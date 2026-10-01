import React from 'react';
import { usePreventRemove } from '@react-navigation/native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { act, render, screen, userEvent } from '@testing-library/react-native';
import { BackHandler } from 'react-native';
import {
  Asset,
  ImagePickerResponse,
  launchCamera,
  launchImageLibrary,
} from 'react-native-image-picker';
import RevenueCatUI from 'react-native-purchases-ui';
import { ParsedImport, parseImport } from '../api/recipesClient';
import { useAuth } from '../auth/AuthContext';
import { AppStackParamList, Screens } from '../navigation/types';
import ImportScreen from './ImportScreen';

jest.mock('../api/recipesClient', () => ({
  ...jest.requireActual('../api/recipesClient'),
  parseImport: jest.fn(),
}));
// Pro off, whatever key config.ts holds; the gated behavior is covered in
// ImportScreen.pro.test.tsx.
jest.mock('../config', () => ({
  ...jest.requireActual('../config'),
  PURCHASES_ENABLED: false,
}));
jest.mock('../auth/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  // Needs a real navigator; tests read its arguments from the mock instead.
  usePreventRemove: jest.fn(),
}));

type Props = NativeStackScreenProps<AppStackParamList, Screens.Import>;

const mockedParseImport = jest.mocked(parseImport);
const mockedUseAuth = jest.mocked(useAuth);
const mockedUsePreventRemove = jest.mocked(usePreventRemove);
const mockedLaunchCamera = jest.mocked(launchCamera);
const mockedLaunchImageLibrary = jest.mocked(launchImageLibrary);
const mockedPresentPaywall = jest.mocked(RevenueCatUI.presentPaywallIfNeeded);

const NO_RECIPE = 'No recipe found in these photos.';
const READ_FAILED = "Couldn't read the photos. They're still here, try again.";
const CAMERA_ERROR = "Couldn't open the camera. You can still add photos.";

function asset(n: number): Asset {
  return { uri: `file:///photo-${n}.jpg`, base64: `base64-${n}` };
}

function picked(...assets: Asset[]): ImagePickerResponse {
  return { assets };
}

function makeParsed(overrides: Partial<ParsedImport> = {}): ParsedImport {
  return {
    importId: 'imp-1',
    recipes: [
      {
        title: 'Lentil soup',
        ingredients: ['1 cup lentils', '1 onion'],
        instructions: 'Chop.\nBoil.',
      },
    ],
    ...overrides,
  };
}

function makeNavigation() {
  return { setOptions: jest.fn(), navigate: jest.fn() };
}

async function renderScreen() {
  const navigation = makeNavigation();
  await render(
    <ImportScreen
      navigation={navigation as unknown as Props['navigation']}
      route={{ key: 'Import-1', name: Screens.Import } as Props['route']}
    />,
  );
  return navigation;
}

// The parse request stays open until the test settles it; Cancel rejects it
// the way fetch does when its signal is aborted.
function holdParse() {
  let settle!: {
    resolve: (v: ParsedImport) => void;
    reject: (e: Error) => void;
  };
  let signal: AbortSignal | undefined;
  mockedParseImport.mockImplementationOnce(
    (_token, _images, abortSignal) =>
      new Promise<ParsedImport>((resolve, reject) => {
        settle = { resolve, reject };
        signal = abortSignal;
        abortSignal?.addEventListener('abort', () => {
          const error = new Error('Aborted');
          error.name = 'AbortError';
          reject(error);
        });
      }),
  );
  return {
    resolve: (value: ParsedImport) => act(async () => settle.resolve(value)),
    reject: (error: Error) => act(async () => settle.reject(error)),
    signal: () => signal,
  };
}

const takePhotoButton = () =>
  screen.getByRole('button', { name: 'Take photo' });
const addPhotosButton = () =>
  screen.getByRole('button', { name: 'Add photos' });
const getRecipeButton = () =>
  screen.getByRole('button', { name: 'Get recipe' });

// Adds photos through the gallery picker.
async function addPhotos(
  user: ReturnType<typeof userEvent.setup>,
  ...assets: Asset[]
) {
  mockedLaunchImageLibrary.mockResolvedValueOnce(picked(...assets));
  await user.press(addPhotosButton());
}

// The arguments of the latest usePreventRemove call (the current render).
function lastPreventRemove() {
  const call = mockedUsePreventRemove.mock.calls.at(-1);
  if (!call) throw new Error('usePreventRemove was not called');
  const [prevent, callback] = call;
  return { prevent, callback };
}

beforeEach(() => {
  jest.resetAllMocks();
  mockedUseAuth.mockReturnValue({ token: 'tok' } as ReturnType<typeof useAuth>);
  mockedLaunchCamera.mockResolvedValue({ didCancel: true });
  mockedLaunchImageLibrary.mockResolvedValue({ didCancel: true });
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('ImportScreen, picking photos', () => {
  it('starts with the intro and Get recipe disabled', async () => {
    await renderScreen();

    expect(
      screen.getByText(
        'Photograph a cookbook page, a recipe card or pick screenshots. Up to 5.',
      ),
    ).toBeOnTheScreen();
    expect(getRecipeButton()).toBeDisabled();
    expect(takePhotoButton()).toBeEnabled();
    expect(addPhotosButton()).toBeEnabled();
    expect(
      screen.queryByTestId('import-photo-count-text'),
    ).not.toBeOnTheScreen();
    expect(screen.queryByTestId('import-photo-0')).not.toBeOnTheScreen();
  });

  it('adds a camera photo as a thumbnail, counts it and enables Get recipe', async () => {
    const user = userEvent.setup();
    mockedLaunchCamera.mockResolvedValueOnce(picked(asset(1)));
    await renderScreen();

    await user.press(takePhotoButton());

    expect(mockedLaunchCamera).toHaveBeenCalledWith(
      expect.objectContaining({ mediaType: 'photo', includeBase64: true }),
    );
    expect(screen.getByTestId('import-photo-0')).toBeOnTheScreen();
    expect(screen.getByTestId('import-photo-count-text')).toHaveTextContent(
      'Photos · 1 of 5',
    );
    expect(getRecipeButton()).toBeEnabled();
  });

  it('adds several gallery photos in order, asking only for the photos still allowed', async () => {
    const user = userEvent.setup();
    await renderScreen();

    await addPhotos(user, asset(1), asset(2));

    expect(mockedLaunchImageLibrary).toHaveBeenLastCalledWith(
      expect.objectContaining({ selectionLimit: 5, includeBase64: true }),
    );
    expect(screen.getByLabelText('Photo 1 of 2')).toBeOnTheScreen();
    expect(screen.getByLabelText('Photo 2 of 2')).toBeOnTheScreen();
    expect(screen.getByTestId('import-photo-count-text')).toHaveTextContent(
      'Photos · 2 of 5',
    );

    await addPhotos(user, asset(3));

    expect(mockedLaunchImageLibrary).toHaveBeenLastCalledWith(
      expect.objectContaining({ selectionLimit: 3 }),
    );
    expect(screen.getByTestId('import-photo-count-text')).toHaveTextContent(
      'Photos · 3 of 5',
    );
  });

  it('ignores picked assets without base64 data', async () => {
    const user = userEvent.setup();
    await renderScreen();

    await addPhotos(user, { uri: 'file:///no-data.jpg' }, asset(2));

    expect(screen.getByTestId('import-photo-count-text')).toHaveTextContent(
      'Photos · 1 of 5',
    );
    expect(screen.queryByTestId('import-photo-1')).not.toBeOnTheScreen();
  });

  it('disables both pickers at 5 photos and says why, keeping only the first 5', async () => {
    const user = userEvent.setup();
    await renderScreen();

    await addPhotos(user, asset(1), asset(2), asset(3));
    // More than the 2 still allowed: only 2 are kept.
    await addPhotos(user, asset(4), asset(5), asset(6));

    expect(screen.getByTestId('import-photo-count-text')).toHaveTextContent(
      'Photos · 5 of 5',
    );
    expect(screen.getByTestId('import-photo-4')).toBeOnTheScreen();
    expect(screen.queryByTestId('import-photo-5')).not.toBeOnTheScreen();
    expect(takePhotoButton()).toBeDisabled();
    expect(addPhotosButton()).toBeDisabled();
    expect(screen.getByTestId('import-photo-limit-text')).toHaveTextContent(
      'Up to 5 photos.',
    );
  });

  it('re-enables the pickers after a photo is removed at the limit', async () => {
    const user = userEvent.setup();
    await renderScreen();
    await addPhotos(user, asset(1), asset(2), asset(3), asset(4), asset(5));

    await user.press(screen.getByTestId('import-photo-remove-4'));

    expect(takePhotoButton()).toBeEnabled();
    expect(addPhotosButton()).toBeEnabled();
    expect(
      screen.queryByTestId('import-photo-limit-text'),
    ).not.toBeOnTheScreen();
  });

  it('removes the chosen photo and keeps the others in order', async () => {
    const user = userEvent.setup();
    mockedParseImport.mockResolvedValue(makeParsed());
    await renderScreen();
    await addPhotos(user, asset(1), asset(2), asset(3));

    await user.press(screen.getByRole('button', { name: 'Remove photo 2' }));

    expect(screen.getByTestId('import-photo-count-text')).toHaveTextContent(
      'Photos · 2 of 5',
    );
    expect(screen.queryByTestId('import-photo-2')).not.toBeOnTheScreen();

    // What is left is what gets sent.
    await user.press(getRecipeButton());
    expect(mockedParseImport).toHaveBeenCalledWith(
      'tok',
      ['base64-1', 'base64-3'],
      expect.any(AbortSignal),
    );
  });

  it('goes back to the intro and disables Get recipe when the last photo is removed', async () => {
    const user = userEvent.setup();
    await renderScreen();
    await addPhotos(user, asset(1));

    await user.press(screen.getByTestId('import-photo-remove-0'));

    expect(screen.queryByTestId('import-photo-0')).not.toBeOnTheScreen();
    expect(
      screen.queryByTestId('import-photo-count-text'),
    ).not.toBeOnTheScreen();
    expect(getRecipeButton()).toBeDisabled();
  });

  it('shows the camera error and adds nothing when the camera fails, then clears it on the next photo', async () => {
    const user = userEvent.setup();
    mockedLaunchCamera.mockResolvedValueOnce({
      errorCode: 'camera_unavailable',
    });
    await renderScreen();

    await user.press(takePhotoButton());

    expect(screen.getByTestId('import-camera-error-text')).toHaveTextContent(
      CAMERA_ERROR,
    );
    expect(screen.queryByTestId('import-photo-0')).not.toBeOnTheScreen();

    mockedLaunchCamera.mockResolvedValueOnce(picked(asset(1)));
    await user.press(takePhotoButton());

    expect(
      screen.queryByTestId('import-camera-error-text'),
    ).not.toBeOnTheScreen();
    expect(screen.getByTestId('import-photo-0')).toBeOnTheScreen();
  });

  it.each([
    ['the camera', takePhotoButton],
    ['the gallery', addPhotosButton],
  ])('changes nothing when %s is cancelled', async (_label, button) => {
    const user = userEvent.setup();
    await renderScreen();
    await addPhotos(user, asset(1));

    // Both pickers resolve { didCancel: true } by default.
    await user.press(button());

    expect(screen.getByTestId('import-photo-count-text')).toHaveTextContent(
      'Photos · 1 of 5',
    );
    expect(
      screen.queryByTestId('import-camera-error-text'),
    ).not.toBeOnTheScreen();
  });

  // Pro is off in this file (see the config mock at the top).
  it.each([
    ['Take photo', takePhotoButton, mockedLaunchCamera],
    ['Add photos', addPhotosButton, mockedLaunchImageLibrary],
  ])(
    'opens the picker from %s without the paywall when purchases are off',
    async (_label, button, launch) => {
      const user = userEvent.setup();
      await renderScreen();

      await user.press(button());

      expect(launch).toHaveBeenCalledTimes(1);
      expect(mockedPresentPaywall).not.toHaveBeenCalled();
      expect(
        screen.queryByTestId('import-pro-error-text'),
      ).not.toBeOnTheScreen();
    },
  );

  it('opens the empty form from "Type it yourself"', async () => {
    const user = userEvent.setup();
    const navigation = await renderScreen();

    await user.press(screen.getByRole('button', { name: 'Type it yourself' }));

    expect(navigation.navigate).toHaveBeenCalledWith(Screens.RecipeForm);
  });
});

describe('ImportScreen, reading the photos', () => {
  async function renderWithPhotos(...assets: Asset[]) {
    const user = userEvent.setup();
    const navigation = await renderScreen();
    await addPhotos(user, ...assets);
    return { user, navigation };
  }

  it('sends the photos in order and locks the screen while reading', async () => {
    const parse = holdParse();
    const { user, navigation } = await renderWithPhotos(asset(1), asset(2));

    await user.press(getRecipeButton());

    expect(mockedParseImport).toHaveBeenCalledWith(
      'tok',
      ['base64-1', 'base64-2'],
      parse.signal(),
    );
    expect(screen.getByTestId('import-reading-indicator')).toBeOnTheScreen();
    expect(screen.getByText('Reading your photos…')).toBeOnTheScreen();
    expect(
      screen.queryByRole('button', { name: 'Get recipe' }),
    ).not.toBeOnTheScreen();
    expect(
      screen.queryByRole('button', { name: 'Take photo' }),
    ).not.toBeOnTheScreen();
    expect(screen.queryByTestId('import-photo-remove-0')).not.toBeOnTheScreen();
    // Photos stay visible.
    expect(screen.getByTestId('import-photo-1')).toBeOnTheScreen();
    expect(navigation.setOptions).toHaveBeenLastCalledWith({
      headerBackVisible: false,
      gestureEnabled: false,
    });
    expect(lastPreventRemove().prevent).toBe(true);
  });

  it('says "Still reading…" after 10 seconds', async () => {
    jest.useFakeTimers();
    holdParse();
    const { user } = await renderWithPhotos(asset(1));

    await user.press(getRecipeButton());
    await act(() => jest.advanceTimersByTime(9_000));

    expect(screen.getByText('Reading your photos…')).toBeOnTheScreen();
    expect(screen.queryByText('Still reading…')).not.toBeOnTheScreen();

    await act(() => jest.advanceTimersByTime(1_000));

    expect(screen.getByText('Still reading…')).toBeOnTheScreen();
    expect(screen.queryByText('Reading your photos…')).not.toBeOnTheScreen();
  });

  it('opens the form with the import queue when recipes are found', async () => {
    const parse = holdParse();
    const { user, navigation } = await renderWithPhotos(asset(1));
    const parsed = makeParsed({
      importId: 'imp-9',
      recipes: [
        { title: 'Dough', ingredients: ['flour'], instructions: 'Knead.' },
        { title: '', ingredients: ['tomatoes'], instructions: 'Simmer.' },
      ],
    });

    await user.press(getRecipeButton());
    await parse.resolve(parsed);

    expect(navigation.navigate).toHaveBeenCalledTimes(1);
    expect(navigation.navigate).toHaveBeenCalledWith(Screens.RecipeForm, {
      fromImport: {
        importId: 'imp-9',
        recipes: parsed.recipes,
        index: 0,
        savedIds: [],
      },
    });
    // Back from the form finds the screen ready again.
    expect(
      screen.queryByTestId('import-reading-indicator'),
    ).not.toBeOnTheScreen();
    expect(getRecipeButton()).toBeEnabled();
    expect(screen.queryByTestId('import-error-text')).not.toBeOnTheScreen();
    expect(lastPreventRemove().prevent).toBe(false);
  });

  it('says no recipe was found, keeps the photos and offers Try again', async () => {
    const parse = holdParse();
    const { user, navigation } = await renderWithPhotos(asset(1));

    await user.press(getRecipeButton());
    await parse.resolve(makeParsed({ recipes: [] }));

    expect(screen.getByTestId('import-error-text')).toHaveTextContent(
      NO_RECIPE,
    );
    expect(screen.getByTestId('import-photo-0')).toBeOnTheScreen();
    expect(screen.getByTestId('import-retry-button')).toHaveTextContent(
      'Try again',
    );
    expect(
      screen.queryByRole('button', { name: 'Get recipe' }),
    ).not.toBeOnTheScreen();
    expect(navigation.navigate).not.toHaveBeenCalled();

    mockedParseImport.mockResolvedValueOnce(makeParsed());
    await user.press(screen.getByRole('button', { name: 'Try again' }));

    expect(mockedParseImport).toHaveBeenCalledTimes(2);
    expect(mockedParseImport).toHaveBeenLastCalledWith(
      'tok',
      ['base64-1'],
      expect.any(AbortSignal),
    );
    expect(navigation.navigate).toHaveBeenCalledWith(
      Screens.RecipeForm,
      expect.objectContaining({
        fromImport: expect.objectContaining({ importId: 'imp-1' }),
      }),
    );
  });

  it('says the photos could not be read when the request fails, keeping the photos', async () => {
    const parse = holdParse();
    const { user, navigation } = await renderWithPhotos(asset(1), asset(2));

    await user.press(getRecipeButton());
    await parse.reject(new Error("Couldn't read the photos"));

    expect(screen.getByTestId('import-error-text')).toHaveTextContent(
      READ_FAILED,
    );
    expect(screen.getByTestId('import-retry-button')).toBeOnTheScreen();
    expect(screen.getByTestId('import-photo-count-text')).toHaveTextContent(
      'Photos · 2 of 5',
    );
    expect(navigation.navigate).not.toHaveBeenCalled();
  });

  it('clears the error when a photo is added', async () => {
    mockedParseImport.mockRejectedValueOnce(
      new Error('Network request failed'),
    );
    const { user } = await renderWithPhotos(asset(1));
    await user.press(getRecipeButton());
    expect(screen.getByTestId('import-error-text')).toBeOnTheScreen();

    await addPhotos(user, asset(2));

    expect(screen.queryByTestId('import-error-text')).not.toBeOnTheScreen();
    expect(screen.queryByTestId('import-retry-button')).not.toBeOnTheScreen();
    expect(getRecipeButton()).toBeEnabled();
  });

  it('clears the error when a photo is removed', async () => {
    mockedParseImport.mockResolvedValueOnce(makeParsed({ recipes: [] }));
    const { user } = await renderWithPhotos(asset(1), asset(2));
    await user.press(getRecipeButton());
    expect(screen.getByTestId('import-error-text')).toBeOnTheScreen();

    await user.press(screen.getByTestId('import-photo-remove-1'));

    expect(screen.queryByTestId('import-error-text')).not.toBeOnTheScreen();
    expect(getRecipeButton()).toBeEnabled();
  });

  it('keeps the error when a picker is cancelled', async () => {
    mockedParseImport.mockResolvedValueOnce(makeParsed({ recipes: [] }));
    const { user } = await renderWithPhotos(asset(1));
    await user.press(getRecipeButton());

    await user.press(addPhotosButton());

    expect(screen.getByTestId('import-error-text')).toHaveTextContent(
      NO_RECIPE,
    );
  });

  it('Cancel aborts the request and returns to the photos with no error', async () => {
    const parse = holdParse();
    const { user, navigation } = await renderWithPhotos(asset(1), asset(2));
    await user.press(getRecipeButton());

    await user.press(screen.getByTestId('import-cancel-button'));

    expect(parse.signal()?.aborted).toBe(true);
    expect(
      screen.queryByTestId('import-reading-indicator'),
    ).not.toBeOnTheScreen();
    expect(screen.queryByTestId('import-error-text')).not.toBeOnTheScreen();
    expect(screen.getByTestId('import-photo-count-text')).toHaveTextContent(
      'Photos · 2 of 5',
    );
    expect(getRecipeButton()).toBeEnabled();
    expect(navigation.navigate).not.toHaveBeenCalled();
    expect(navigation.setOptions).toHaveBeenLastCalledWith({
      headerBackVisible: true,
      gestureEnabled: true,
    });
  });

  it('Android back while reading cancels the read instead of leaving', async () => {
    type BackHandlerListener = Parameters<
      typeof BackHandler.addEventListener
    >[1];
    const handlers: BackHandlerListener[] = [];
    jest
      .spyOn(BackHandler, 'addEventListener')
      .mockImplementation((_event, handler) => {
        handlers.push(handler);
        return { remove: jest.fn() };
      });
    const parse = holdParse();
    const { user } = await renderWithPhotos(asset(1));
    await user.press(getRecipeButton());
    expect(handlers).toHaveLength(1);

    let handled: ReturnType<BackHandlerListener>;
    await act(async () => {
      handled = handlers[0]({} as Parameters<BackHandlerListener>[0]);
    });

    expect(handled).toBe(true);
    expect(parse.signal()?.aborted).toBe(true);
    expect(
      screen.queryByTestId('import-reading-indicator'),
    ).not.toBeOnTheScreen();
    expect(screen.queryByTestId('import-error-text')).not.toBeOnTheScreen();
  });

  it('a blocked leave while reading cancels the read', async () => {
    const parse = holdParse();
    const { user } = await renderWithPhotos(asset(1));
    await user.press(getRecipeButton());

    const { callback } = lastPreventRemove();
    await act(async () =>
      callback({
        data: { action: { type: 'GO_BACK' } },
      } as Parameters<typeof callback>[0]),
    );

    expect(parse.signal()?.aborted).toBe(true);
    expect(
      screen.queryByTestId('import-reading-indicator'),
    ).not.toBeOnTheScreen();
  });

  it('aborts a read still in flight when the screen unmounts', async () => {
    const parse = holdParse();
    const { user } = await renderWithPhotos(asset(1));
    await user.press(getRecipeButton());

    await screen.unmount();

    expect(parse.signal()?.aborted).toBe(true);
  });
});
