import React from 'react';
import {
  render,
  screen,
  userEvent,
  within,
} from '@testing-library/react-native';
import { Attempt, Fullness } from '../api/recipesClient';
import { useAttempts } from '../hooks/useAttempts';
import AttemptHistory from './AttemptHistory';

jest.mock('../hooks/useAttempts', () => ({ useAttempts: jest.fn() }));

const mockedUseAttempts = jest.mocked(useAttempts);
const onOpenAttempt = jest.fn();

type Element = ReturnType<typeof screen.getByTestId>;

function makeAttempt(overrides: Partial<Attempt> = {}): Attempt {
  return {
    id: 'a1',
    recipeId: 'r1',
    durationMinutes: 42,
    madeAt: '2026-09-21T12:00:00.000Z',
    rating: 4,
    fullness: null,
    enjoyment: null,
    hasPhoto: false,
    notes: null,
    ingredients: null,
    instructions: null,
    basedOnAttemptId: null,
    tweaked: false,
    createdAt: '2026-09-21T12:00:00.000Z',
    updatedAt: '2026-09-21T12:00:00.000Z',
    ...overrides,
  };
}

type QueryState = {
  data?: Attempt[];
  isPending?: boolean;
  isError?: boolean;
};

function mockAttemptsQuery({
  data,
  isPending = false,
  isError = false,
}: QueryState) {
  const refetch = jest.fn();
  mockedUseAttempts.mockReturnValue({
    data,
    isPending,
    isError,
    refetch,
  } as unknown as ReturnType<typeof useAttempts>);
  return refetch;
}

async function renderHistory(attempts: Attempt[]) {
  mockAttemptsQuery({ data: attempts });
  await render(<AttemptHistory recipeId="r1" onOpenAttempt={onOpenAttempt} />);
}

const row = (id: string) => screen.getByTestId(`recipe-detail-attempt-${id}`);

// The loading spinner has no role or testID; find it by its host type.
function hasSpinner(): boolean {
  const search = (node: Element): boolean =>
    node.type === 'ActivityIndicator' ||
    node.children.some(child => typeof child !== 'string' && search(child));
  return search(screen.container);
}

const EMPTY_TEXT = "You haven't cooked this yet. Tap Start cooking to begin.";

beforeEach(() => {
  jest.resetAllMocks();
  // Rows leave out the year only for the current year, so pin "now".
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-09-24T12:00:00.000Z'));
});

afterEach(() => {
  jest.useRealTimers();
});

describe('AttemptHistory', () => {
  it('asks for the attempts of the given recipe', async () => {
    await renderHistory([]);

    expect(mockedUseAttempts).toHaveBeenCalledWith('r1');
    expect(screen.getByText('HISTORY')).toBeOnTheScreen();
  });

  describe('states', () => {
    it('shows a spinner and no count while loading', async () => {
      mockAttemptsQuery({ isPending: true });
      await render(
        <AttemptHistory recipeId="r1" onOpenAttempt={onOpenAttempt} />,
      );

      expect(hasSpinner()).toBe(true);
      expect(screen.getByText('HISTORY')).toBeOnTheScreen();
      expect(screen.queryByText(/\d+ times?$/)).not.toBeOnTheScreen();
      expect(screen.queryByText(EMPTY_TEXT)).not.toBeOnTheScreen();
    });

    it('shows the error with a Try again button that refetches', async () => {
      const user = userEvent.setup();
      const refetch = mockAttemptsQuery({ isError: true });
      await render(
        <AttemptHistory recipeId="r1" onOpenAttempt={onOpenAttempt} />,
      );

      expect(
        screen.getByText("Couldn't load your cooking history."),
      ).toBeOnTheScreen();
      expect(hasSpinner()).toBe(false);
      expect(screen.queryByText(EMPTY_TEXT)).not.toBeOnTheScreen();

      await user.press(screen.getByRole('button', { name: 'Try again' }));
      expect(refetch).toHaveBeenCalledTimes(1);
    });

    it('invites a first cook, without a count, when there are no attempts', async () => {
      await renderHistory([]);

      expect(
        screen.getByTestId('recipe-detail-history-empty'),
      ).toHaveTextContent(EMPTY_TEXT);
      expect(screen.queryByText(/\d+ times?$/)).not.toBeOnTheScreen();
      expect(hasSpinner()).toBe(false);
    });
  });

  describe('list', () => {
    it("keeps the server's newest-first order and counts the attempts", async () => {
      await renderHistory([
        makeAttempt({ id: 'newest', madeAt: '2026-09-23T12:00:00.000Z' }),
        makeAttempt({ id: 'middle', madeAt: '2026-09-22T12:00:00.000Z' }),
        makeAttempt({ id: 'oldest', madeAt: '2026-09-21T12:00:00.000Z' }),
      ]);

      const ids = screen
        .getAllByTestId(/^recipe-detail-attempt-/)
        .map(element => element.props.testID);
      expect(ids).toEqual([
        'recipe-detail-attempt-newest',
        'recipe-detail-attempt-middle',
        'recipe-detail-attempt-oldest',
      ]);
      expect(screen.getByText('3 times')).toBeOnTheScreen();
      expect(
        screen.queryByTestId('recipe-detail-history-empty'),
      ).not.toBeOnTheScreen();
    });

    it('uses the singular for one attempt', async () => {
      await renderHistory([makeAttempt()]);

      expect(screen.getByText('1 time')).toBeOnTheScreen();
    });
  });

  describe('row', () => {
    it('shows the short date, stars and duration on one line', async () => {
      await renderHistory([makeAttempt()]);

      expect(
        within(row('a1')).getByText('Sep 21 · ★★★★☆ · 42 min'),
      ).toBeOnTheScreen();
    });

    it.each([
      [1, '★☆☆☆☆'],
      [5, '★★★★★'],
    ])('draws a %i-star rating as %s', async (rating, stars) => {
      await renderHistory([makeAttempt({ rating })]);

      expect(
        within(row('a1')).getByText(`Sep 21 · ${stars} · 42 min`),
      ).toBeOnTheScreen();
    });

    it('says "no rating" when the rating is null', async () => {
      await renderHistory([makeAttempt({ rating: null })]);

      expect(
        within(row('a1')).getByText('Sep 21 · no rating · 42 min'),
      ).toBeOnTheScreen();
    });

    it.each([
      [Fullness.StillHungry, 'Still hungry'],
      [Fullness.Satisfied, 'Satisfied'],
      [Fullness.VeryFull, 'Very full'],
    ])(
      'shows the fullness %s as "%s" after the stars',
      async (fullness, word) => {
        await renderHistory([makeAttempt({ fullness })]);

        expect(
          within(row('a1')).getByText(`Sep 21 · ★★★★☆ · ${word} · 42 min`),
        ).toBeOnTheScreen();
      },
    );

    it('shows the fullness after "no rating", and alone after the date without a duration', async () => {
      await renderHistory([
        makeAttempt({
          id: 'unrated',
          rating: null,
          fullness: Fullness.VeryFull,
        }),
        makeAttempt({
          id: 'untimed',
          durationMinutes: null,
          fullness: Fullness.Satisfied,
        }),
      ]);

      expect(
        within(row('unrated')).getByText(
          'Sep 21 · no rating · Very full · 42 min',
        ),
      ).toBeOnTheScreen();
      expect(
        within(row('untimed')).getByText('Sep 21 · ★★★★☆ · Satisfied'),
      ).toBeOnTheScreen();
    });

    it('leaves the duration out when it is null', async () => {
      await renderHistory([makeAttempt({ durationMinutes: null })]);

      expect(within(row('a1')).getByText('Sep 21 · ★★★★☆')).toBeOnTheScreen();
    });

    it('formats long durations in hours', async () => {
      await renderHistory([makeAttempt({ durationMinutes: 65 })]);

      expect(
        within(row('a1')).getByText('Sep 21 · ★★★★☆ · 1 hr 5 min'),
      ).toBeOnTheScreen();
    });

    it('adds the year for attempts from another year', async () => {
      await renderHistory([
        makeAttempt({ madeAt: '2025-09-21T12:00:00.000Z' }),
      ]);

      expect(
        within(row('a1')).getByText('Sep 21, 2025 · ★★★★☆ · 42 min'),
      ).toBeOnTheScreen();
    });

    // The badge follows `tweaked` (lines changed while cooking), not the
    // snapshots: a recipe edit fills in null snapshots of untweaked attempts.
    it('shows no "changed" badge for an untweaked attempt without snapshots', async () => {
      await renderHistory([makeAttempt()]);

      expect(within(row('a1')).queryByText('changed')).not.toBeOnTheScreen();
    });

    it.each<[string, Partial<Attempt>]>([
      ['ingredients', { ingredients: [{ text: '1 onion' }] }],
      ['instructions', { instructions: 'Chop.\nSimmer.' }],
      [
        'both',
        { ingredients: [{ text: '1 onion' }], instructions: 'Chop.\nSimmer.' },
      ],
    ])(
      'shows no "changed" badge for an untweaked attempt with a backfilled %s snapshot',
      async (_label, snapshots) => {
        await renderHistory([makeAttempt({ ...snapshots, tweaked: false })]);

        expect(within(row('a1')).queryByText('changed')).not.toBeOnTheScreen();
        expect(row('a1')).toHaveAccessibleName(
          'September 21, 2026, 4 of 5 stars, 42 min',
        );
      },
    );

    it.each<[string, Partial<Attempt>]>([
      ['ingredients', { ingredients: [{ text: '3 eggs' }] }],
      ['instructions', { instructions: 'Whisk.\nRest.\nCook.' }],
      [
        'both',
        { ingredients: [{ text: '3 eggs' }], instructions: 'Whisk.\nCook.' },
      ],
    ])(
      'shows the "changed" badge for a tweaked attempt with a %s snapshot',
      async (_label, change) => {
        await renderHistory([makeAttempt({ ...change, tweaked: true })]);

        expect(within(row('a1')).getByText('changed')).toBeOnTheScreen();
      },
    );

    it('shows the "changed" badge for a tweaked attempt even without snapshots', async () => {
      await renderHistory([makeAttempt({ tweaked: true })]);

      expect(within(row('a1')).getByText('changed')).toBeOnTheScreen();
    });

    it('marks only the tweaked rows', async () => {
      await renderHistory([
        makeAttempt({ id: 'changed', instructions: 'Whisk.', tweaked: true }),
        makeAttempt({ id: 'same', instructions: 'Whisk.\nCook.' }),
      ]);

      expect(within(row('changed')).getByText('changed')).toBeOnTheScreen();
      expect(within(row('same')).queryByText('changed')).not.toBeOnTheScreen();
    });

    it('previews the first non-blank line of the notes in quotes', async () => {
      await renderHistory([
        makeAttempt({
          notes: '\n   \n  Step 2: rest it longer  \nMore salt next time',
        }),
      ]);

      expect(
        within(row('a1')).getByText('“Step 2: rest it longer”'),
      ).toBeOnTheScreen();
      expect(
        within(row('a1')).queryByText(/More salt next time/),
      ).not.toBeOnTheScreen();
    });

    it.each([
      ['null', null],
      ['empty', ''],
      ['blank', '  \n \n  '],
    ])(
      'shows no notes preview when the notes are %s',
      async (_label, notes) => {
        await renderHistory([makeAttempt({ notes })]);

        expect(within(row('a1')).queryByText(/[“”]/)).not.toBeOnTheScreen();
      },
    );
  });

  describe('opening an attempt', () => {
    it('makes every row a button with a › chevron', async () => {
      await renderHistory([
        makeAttempt({ id: 'a1' }),
        makeAttempt({ id: 'a2' }),
      ]);

      for (const id of ['a1', 'a2']) {
        expect(row(id)).toHaveProp('accessibilityRole', 'button');
        expect(within(row(id)).getByText('›')).toBeOnTheScreen();
      }
      expect(screen.getAllByRole('button')).toEqual([row('a1'), row('a2')]);
    });

    it('calls onOpenAttempt with the id of the pressed row only', async () => {
      const user = userEvent.setup();
      await renderHistory([
        makeAttempt({ id: 'first' }),
        makeAttempt({ id: 'second' }),
      ]);

      await user.press(row('second'));

      expect(onOpenAttempt).toHaveBeenCalledTimes(1);
      expect(onOpenAttempt).toHaveBeenCalledWith('second');

      await user.press(row('first'));

      expect(onOpenAttempt).toHaveBeenCalledTimes(2);
      expect(onOpenAttempt).toHaveBeenLastCalledWith('first');
    });
  });

  describe('accessibility label', () => {
    it('reads the whole row as one sentence with the stars spelled out', async () => {
      await renderHistory([
        makeAttempt({
          instructions: 'Whisk.\nRest.\nCook.',
          tweaked: true,
          notes: 'Step 2: rest it longer\nMore salt',
        }),
      ]);

      expect(row('a1')).toHaveAccessibleName(
        'September 21, 2026, 4 of 5 stars, 42 min, changed, Step 2: rest it longer',
      );
      expect(
        screen.getByLabelText(
          'September 21, 2026, 4 of 5 stars, 42 min, changed, Step 2: rest it longer',
        ),
      ).toBe(row('a1'));
    });

    it('reads the fullness after the rating', async () => {
      await renderHistory([
        makeAttempt({
          fullness: Fullness.Satisfied,
          tweaked: true,
          notes: 'More salt',
        }),
      ]);

      expect(row('a1')).toHaveAccessibleName(
        'September 21, 2026, 4 of 5 stars, Satisfied, 42 min, changed, More salt',
      );
    });

    it('reads the fullness after "no rating"', async () => {
      await renderHistory([
        makeAttempt({
          rating: null,
          durationMinutes: null,
          fullness: Fullness.StillHungry,
        }),
      ]);

      expect(row('a1')).toHaveAccessibleName(
        'September 21, 2026, no rating, Still hungry',
      );
    });

    it('leaves out what the row leaves out', async () => {
      await renderHistory([
        makeAttempt({ rating: null, durationMinutes: null, notes: '  ' }),
      ]);

      expect(row('a1')).toHaveAccessibleName('September 21, 2026, no rating');
    });

    it('always writes the full date, even for another year', async () => {
      await renderHistory([
        makeAttempt({ madeAt: '2025-03-02T12:00:00.000Z', rating: 1 }),
      ]);

      expect(row('a1')).toHaveAccessibleName(
        'March 2, 2025, 1 of 5 stars, 42 min',
      );
    });
  });
});
