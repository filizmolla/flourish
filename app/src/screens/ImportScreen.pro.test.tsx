import React from 'react';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { render, screen, userEvent } from '@testing-library/react-native';
import {
  Asset,
  ImagePickerResponse,
  launchCamera,
  launchImageLibrary,
} from 'react-native-image-picker';
import RevenueCatUI, { PAYWALL_RESULT } from 'react-native-purchases-ui';
import { useAuth } from '../auth/AuthContext';
import { AppStackParamList, Screens } from '../navigation/types';
import ImportScreen from './ImportScreen';

// ImportScreen decides whether photo import is gated once, when the module
// loads, so the whole file runs with a RevenueCat key and the real pickers.
// Pro off (the default config) is covered in ImportScreen.test.tsx.
jest.mock('../config', () => ({
  ...jest.requireActual('../config'),
  PURCHASES_ENABLED: true,
  FAKE_IMAGE_PICKER: false,
}));
jest.mock('../auth/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  usePreventRemove: jest.fn(),
}));

type Props = NativeStackScreenProps<AppStackParamList, Screens.Import>;

const mockedUseAuth = jest.mocked(useAuth);
const mockedLaunchCamera = jest.mocked(launchCamera);
const mockedLaunchImageLibrary = jest.mocked(launchImageLibrary);
const mockedPresentPaywall = jest.mocked(RevenueCatUI.presentPaywallIfNeeded);

const PRO_ERROR = "Couldn't open Pro. Check your connection and try again.";

function asset(n: number): Asset {
  return { uri: `file:///photo-${n}.jpg`, base64: `base64-${n}` };
}

function picked(...assets: Asset[]): ImagePickerResponse {
  return { assets };
}

async function renderScreen() {
  const navigation = { setOptions: jest.fn(), navigate: jest.fn() };
  await render(
    <ImportScreen
      navigation={navigation as unknown as Props['navigation']}
      route={{ key: 'Import-1', name: Screens.Import } as Props['route']}
    />,
  );
  return navigation;
}

const takePhotoButton = () =>
  screen.getByRole('button', { name: 'Take photo' });
const addPhotosButton = () =>
  screen.getByRole('button', { name: 'Add photos' });

beforeEach(() => {
  jest.resetAllMocks();
  mockedUseAuth.mockReturnValue({ token: 'tok' } as ReturnType<typeof useAuth>);
  mockedPresentPaywall.mockResolvedValue(PAYWALL_RESULT.NOT_PRESENTED);
  mockedLaunchCamera.mockResolvedValue(picked(asset(1)));
  mockedLaunchImageLibrary.mockResolvedValue(picked(asset(1)));
});

describe.each([
  ['Take photo', takePhotoButton, () => mockedLaunchCamera],
  ['Add photos', addPhotosButton, () => mockedLaunchImageLibrary],
])('ImportScreen with Pro gating, %s', (_label, button, launcher) => {
  it('asks RevenueCat for the pro entitlement before opening the picker', async () => {
    const user = userEvent.setup();
    await renderScreen();

    await user.press(button());

    expect(mockedPresentPaywall).toHaveBeenCalledTimes(1);
    expect(mockedPresentPaywall).toHaveBeenCalledWith({
      requiredEntitlementIdentifier: 'pro',
    });
    expect(mockedPresentPaywall.mock.invocationCallOrder[0]).toBeLessThan(
      launcher().mock.invocationCallOrder[0],
    );
  });

  it('opens the picker straight away for a user who already has Pro', async () => {
    const user = userEvent.setup();
    await renderScreen();

    await user.press(button());

    expect(launcher()).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('import-photo-0')).toBeOnTheScreen();
    expect(screen.queryByTestId('import-pro-error-text')).not.toBeOnTheScreen();
  });

  it.each([PAYWALL_RESULT.PURCHASED, PAYWALL_RESULT.RESTORED])(
    'opens the picker right after the paywall returns %s',
    async result => {
      const user = userEvent.setup();
      mockedPresentPaywall.mockResolvedValueOnce(result);
      await renderScreen();

      await user.press(button());

      expect(launcher()).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('import-photo-0')).toBeOnTheScreen();
      expect(
        screen.queryByTestId('import-pro-error-text'),
      ).not.toBeOnTheScreen();
    },
  );

  it('does nothing when the paywall is closed without buying', async () => {
    const user = userEvent.setup();
    mockedPresentPaywall.mockResolvedValueOnce(PAYWALL_RESULT.CANCELLED);
    await renderScreen();

    await user.press(button());

    expect(mockedPresentPaywall).toHaveBeenCalledTimes(1);
    expect(launcher()).not.toHaveBeenCalled();
    expect(screen.queryByTestId('import-photo-0')).not.toBeOnTheScreen();
    expect(screen.queryByTestId('import-pro-error-text')).not.toBeOnTheScreen();
  });

  it.each([
    [
      'returns ERROR',
      () => mockedPresentPaywall.mockResolvedValueOnce(PAYWALL_RESULT.ERROR),
    ],
    [
      'rejects',
      () => mockedPresentPaywall.mockRejectedValueOnce(new Error('offline')),
    ],
  ])(
    'shows the Pro error and opens no picker when the paywall %s',
    async (_case, arrange) => {
      const user = userEvent.setup();
      arrange();
      await renderScreen();

      await user.press(button());

      expect(screen.getByTestId('import-pro-error-text')).toHaveTextContent(
        PRO_ERROR,
      );
      expect(launcher()).not.toHaveBeenCalled();
    },
  );

  it('clears the Pro error on the next attempt, even one that is cancelled', async () => {
    const user = userEvent.setup();
    mockedPresentPaywall
      .mockResolvedValueOnce(PAYWALL_RESULT.ERROR)
      .mockResolvedValueOnce(PAYWALL_RESULT.CANCELLED);
    await renderScreen();
    await user.press(button());
    expect(screen.getByTestId('import-pro-error-text')).toBeOnTheScreen();

    await user.press(button());

    expect(screen.queryByTestId('import-pro-error-text')).not.toBeOnTheScreen();
    expect(launcher()).not.toHaveBeenCalled();
  });

  it('clears the Pro error when the next attempt unlocks and opens the picker', async () => {
    const user = userEvent.setup();
    mockedPresentPaywall.mockResolvedValueOnce(PAYWALL_RESULT.ERROR);
    await renderScreen();
    await user.press(button());
    expect(screen.getByTestId('import-pro-error-text')).toBeOnTheScreen();

    await user.press(button());

    expect(screen.queryByTestId('import-pro-error-text')).not.toBeOnTheScreen();
    expect(launcher()).toHaveBeenCalledTimes(1);
  });
});

describe('ImportScreen with Pro gating, typing it yourself', () => {
  it('opens the empty form without showing the paywall', async () => {
    const user = userEvent.setup();
    mockedPresentPaywall.mockResolvedValue(PAYWALL_RESULT.CANCELLED);
    const navigation = await renderScreen();

    await user.press(screen.getByRole('button', { name: 'Type it yourself' }));

    expect(navigation.navigate).toHaveBeenCalledWith(Screens.RecipeForm);
    expect(mockedPresentPaywall).not.toHaveBeenCalled();
  });
});
