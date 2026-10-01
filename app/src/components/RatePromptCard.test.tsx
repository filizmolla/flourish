import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  render,
  screen,
  userEvent,
  waitFor,
} from '@testing-library/react-native';
import * as client from '../api/recipesClient';
import { AttemptDetail, UnratedAttempt } from '../api/recipesClient';
import { DISMISSED_KEY, loadDismissed } from '../attempts/ratePromptDismissals';
import { useAuth } from '../auth/AuthContext';
import { AuthStatus } from '../auth/authStatus';
import { attemptKeys } from '../hooks/useAttempts';
import { RatePromptCard, SAVED_VISIBLE_MS } from './RatePromptCard';

jest.mock('../api/recipesClient', () => ({
  ...jest.requireActual('../api/recipesClient'),
  fetchUnratedAttempt: jest.fn(),
  updateAttempt: jest.fn(),
}));
jest.mock('../auth/AuthContext', () => ({ useAuth: jest.fn() }));

const mockedClient = jest.mocked(client);
const mockedUseAuth = jest.mocked(useAuth);

// Local time, so "Yesterday" doesn't depend on the machine's timezone.
// Month 8 = September.
const NOW = new Date(2026, 8, 24, 12, 0);
const YESTERDAY_EVENING = new Date(2026, 8, 23, 19, 0).toISOString();

function makeUnrated(overrides: Partial<UnratedAttempt> = {}): UnratedAttempt {
  return {
    id: 'a1',
    recipeId: 'r1',
    madeAt: YESTERDAY_EVENING,
    durationMinutes: 42,
    rating: null,
    fullness: null,
    enjoyment: null,
    hasPhoto: false,
    notes: null,
    ingredients: null,
    instructions: null,
    basedOnAttemptId: null,
    tweaked: false,
    createdAt: YESTERDAY_EVENING,
    updatedAt: YESTERDAY_EVENING,
    recipe: { id: 'r1', title: 'Shakshuka' },
    ...overrides,
  };
}

function savedDetail(rating: number): AttemptDetail {
  const { id, recipeId, madeAt, durationMinutes, createdAt, updatedAt } =
    makeUnrated();
  return {
    id,
    recipeId,
    madeAt,
    durationMinutes,
    createdAt,
    updatedAt,
    rating,
    fullness: null,
    enjoyment: null,
    hasPhoto: false,
    notes: null,
    ingredients: null,
    instructions: null,
    basedOnAttemptId: null,
    tweaked: false,
    basedOnAttempt: null,
    fork: null,
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

async function renderCard() {
  const onOpen = jest.fn();
  await render(<RatePromptCard onOpen={onOpen} />, {
    wrapper: SignedInQueryProvider,
  });
  return { onOpen };
}

const card = () => screen.queryByTestId('rate-prompt-card');
const star = (count: number) =>
  screen.getByRole('radio', { name: `${count} star${count === 1 ? '' : 's'}` });

// Waits until the unrated query has settled, so a card that stays hidden
// is hidden for the right reason.
async function waitForUnratedQuery() {
  await waitFor(() =>
    expect(queryClient.getQueryState(attemptKeys.unrated)?.status).toBe(
      'success',
    ),
  );
}

beforeEach(async () => {
  // Not resetAllMocks: that would also wipe the AsyncStorage jest mock's
  // in-memory implementation.
  mockedClient.fetchUnratedAttempt.mockReset();
  mockedClient.updateAttempt.mockReset();
  mockedUseAuth.mockReset();
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  await AsyncStorage.clear();
  queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
  mockedUseAuth.mockReturnValue({
    status: AuthStatus.SignedIn,
    user: null,
    token: 'tok',
    signIn: jest.fn(),
    signUp: jest.fn(),
    signOut: jest.fn(),
  });
});

afterEach(() => {
  queryClient.clear();
  jest.useRealTimers();
});

describe('RatePromptCard', () => {
  describe('when it shows', () => {
    it('asks about the recipe and shows the day and time cooked', async () => {
      mockedClient.fetchUnratedAttempt.mockResolvedValue(makeUnrated());
      await renderCard();

      expect(
        await screen.findByRole('header', { name: 'How was the Shakshuka?' }),
      ).toBeOnTheScreen();
      expect(screen.getByText('Yesterday · 42 min')).toBeOnTheScreen();
      for (const count of [1, 2, 3, 4, 5]) {
        expect(star(count)).not.toBeChecked();
        expect(star(count)).toBeEnabled();
      }
      expect(mockedClient.fetchUnratedAttempt).toHaveBeenCalledWith('tok');
    });

    it('shows only the day when the attempt has no duration', async () => {
      mockedClient.fetchUnratedAttempt.mockResolvedValue(
        makeUnrated({
          durationMinutes: null,
          madeAt: new Date(2026, 8, 24, 9, 0).toISOString(),
        }),
      );
      await renderCard();

      expect(await screen.findByText('Today')).toBeOnTheScreen();
      expect(screen.queryByText(/·/)).not.toBeOnTheScreen();
    });

    it('stays hidden when there is no unrated attempt', async () => {
      mockedClient.fetchUnratedAttempt.mockResolvedValue(null);
      await renderCard();

      await waitForUnratedQuery();
      expect(card()).not.toBeOnTheScreen();
    });

    it('stays hidden until the dismissed ids have loaded, so a dismissed card never flashes', async () => {
      const storage = deferred<string | null>();
      const getItem = jest
        .spyOn(AsyncStorage, 'getItem')
        .mockReturnValue(storage.promise);
      mockedClient.fetchUnratedAttempt.mockResolvedValue(makeUnrated());
      try {
        await renderCard();

        await waitForUnratedQuery();
        expect(card()).not.toBeOnTheScreen();

        await act(async () => {
          storage.resolve(JSON.stringify(['other']));
        });

        expect(await screen.findByTestId('rate-prompt-card')).toBeOnTheScreen();
      } finally {
        getItem.mockRestore();
      }
    });

    it('stays hidden for an attempt dismissed earlier on this phone', async () => {
      await AsyncStorage.setItem(DISMISSED_KEY, JSON.stringify(['x', 'a1']));
      mockedClient.fetchUnratedAttempt.mockResolvedValue(makeUnrated());
      await renderCard();

      await waitForUnratedQuery();
      await act(async () => {});
      expect(card()).not.toBeOnTheScreen();
    });

    it('still shows when only other attempts were dismissed', async () => {
      await AsyncStorage.setItem(DISMISSED_KEY, JSON.stringify(['a0']));
      mockedClient.fetchUnratedAttempt.mockResolvedValue(makeUnrated());
      await renderCard();

      expect(await screen.findByTestId('rate-prompt-card')).toBeOnTheScreen();
    });
  });

  describe('rating', () => {
    it('saves the tapped star once, shows "Saved ✓", then asks for the next unrated attempt', async () => {
      const user = userEvent.setup();
      mockedClient.fetchUnratedAttempt
        .mockResolvedValueOnce(makeUnrated())
        .mockResolvedValueOnce(null);
      mockedClient.updateAttempt.mockResolvedValue(savedDetail(4));
      await renderCard();
      await screen.findByTestId('rate-prompt-card');

      await user.press(star(4));

      expect(
        await screen.findByTestId('rate-prompt-saved-text'),
      ).toHaveTextContent('Saved ✓');
      expect(mockedClient.updateAttempt).toHaveBeenCalledTimes(1);
      expect(mockedClient.updateAttempt).toHaveBeenCalledWith('tok', 'a1', {
        rating: 4,
      });
      expect(star(4)).toBeChecked();
      expect(star(4)).toBeDisabled();
      // The card stays up with "Saved ✓" for a moment before refreshing.
      expect(mockedClient.fetchUnratedAttempt).toHaveBeenCalledTimes(1);
      expect(
        queryClient.getQueryState(attemptKeys.unrated)?.isInvalidated,
      ).toBe(false);

      // A second tap after saving does nothing.
      await user.press(star(2));
      expect(mockedClient.updateAttempt).toHaveBeenCalledTimes(1);

      await act(async () => {
        jest.advanceTimersByTime(SAVED_VISIBLE_MS);
      });

      await waitFor(() =>
        expect(mockedClient.fetchUnratedAttempt).toHaveBeenCalledTimes(2),
      );
      await waitFor(() => expect(card()).not.toBeOnTheScreen());
    });

    it('shows the next unrated attempt as a fresh card after saving', async () => {
      const user = userEvent.setup();
      mockedClient.fetchUnratedAttempt
        .mockResolvedValueOnce(makeUnrated())
        .mockResolvedValueOnce(
          makeUnrated({ id: 'a0', recipe: { id: 'r2', title: 'Dal' } }),
        );
      mockedClient.updateAttempt.mockResolvedValue(savedDetail(5));
      await renderCard();
      await screen.findByTestId('rate-prompt-card');

      await user.press(star(5));
      await screen.findByTestId('rate-prompt-saved-text');
      await act(async () => {
        jest.advanceTimersByTime(SAVED_VISIBLE_MS);
      });

      expect(
        await screen.findByRole('header', { name: 'How was the Dal?' }),
      ).toBeOnTheScreen();
      expect(
        screen.queryByTestId('rate-prompt-saved-text'),
      ).not.toBeOnTheScreen();
      expect(star(5)).not.toBeChecked();
      expect(star(5)).toBeEnabled();
    });

    it('disables the stars while saving', async () => {
      const user = userEvent.setup();
      const save = deferred<AttemptDetail>();
      mockedClient.fetchUnratedAttempt.mockResolvedValue(makeUnrated());
      mockedClient.updateAttempt.mockReturnValue(save.promise);
      await renderCard();
      await screen.findByTestId('rate-prompt-card');

      await user.press(star(3));

      expect(star(3)).toBeChecked();
      expect(star(1)).toBeDisabled();
      expect(star(5)).toBeDisabled();
      await user.press(star(5));
      expect(mockedClient.updateAttempt).toHaveBeenCalledTimes(1);

      await act(async () => {
        save.resolve(savedDetail(3));
      });
      expect(
        await screen.findByTestId('rate-prompt-saved-text'),
      ).toBeOnTheScreen();
    });

    it('shows an error and lets you try again when saving fails', async () => {
      const user = userEvent.setup();
      mockedClient.fetchUnratedAttempt.mockResolvedValue(makeUnrated());
      mockedClient.updateAttempt
        .mockRejectedValueOnce(new TypeError('Network request failed'))
        .mockResolvedValueOnce(savedDetail(2));
      await renderCard();
      await screen.findByTestId('rate-prompt-card');

      await user.press(star(4));

      expect(
        await screen.findByTestId('rate-prompt-error-text'),
      ).toHaveTextContent("Couldn't save the rating. Try again.");
      expect(
        screen.queryByTestId('rate-prompt-saved-text'),
      ).not.toBeOnTheScreen();
      expect(star(2)).toBeEnabled();

      // Nothing refreshes the card after a failure.
      await act(async () => {
        jest.advanceTimersByTime(SAVED_VISIBLE_MS);
      });
      expect(mockedClient.fetchUnratedAttempt).toHaveBeenCalledTimes(1);
      expect(card()).toBeOnTheScreen();

      await user.press(star(2));

      expect(
        await screen.findByTestId('rate-prompt-saved-text'),
      ).toBeOnTheScreen();
      expect(
        screen.queryByTestId('rate-prompt-error-text'),
      ).not.toBeOnTheScreen();
      expect(mockedClient.updateAttempt).toHaveBeenLastCalledWith('tok', 'a1', {
        rating: 2,
      });
    });
  });

  describe('dismissing', () => {
    it('hides the card, remembers the attempt and keeps it hidden next time', async () => {
      const user = userEvent.setup();
      mockedClient.fetchUnratedAttempt.mockResolvedValue(makeUnrated());
      const { onOpen } = await renderCard();
      await screen.findByTestId('rate-prompt-card');

      await user.press(screen.getByRole('button', { name: 'Hide this' }));

      expect(card()).not.toBeOnTheScreen();
      expect(onOpen).not.toHaveBeenCalled();
      expect(mockedClient.updateAttempt).not.toHaveBeenCalled();
      await waitFor(async () => expect(await loadDismissed()).toEqual(['a1']));

      // A fresh mount (e.g. the next app start) reads the stored id.
      await screen.unmount();
      await renderCard();
      await waitForUnratedQuery();
      await act(async () => {});
      expect(card()).not.toBeOnTheScreen();
    });
  });

  describe('opening', () => {
    it('passes the attempt to onOpen when the card is tapped', async () => {
      const user = userEvent.setup();
      const attempt = makeUnrated();
      mockedClient.fetchUnratedAttempt.mockResolvedValue(attempt);
      const { onOpen } = await renderCard();

      await user.press(
        await screen.findByRole('button', {
          name: 'Open your Shakshuka attempt',
        }),
      );

      expect(onOpen).toHaveBeenCalledTimes(1);
      expect(onOpen).toHaveBeenCalledWith(attempt);
      expect(mockedClient.updateAttempt).not.toHaveBeenCalled();
    });
  });
});
