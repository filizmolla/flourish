import React from 'react';
import { act, render, screen } from '@testing-library/react-native';
import { pauseClock, startClock } from '../cooking/cookingClock';
import CookingClockText from './CookingClockText';

const SECOND = 1000;
const MINUTE = 60 * SECOND;

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

const elapsedText = () => screen.getByTestId('cooking-elapsed-text');

describe('CookingClockText', () => {
  it('starts at 00:00', async () => {
    await render(<CookingClockText clock={startClock(Date.now())} />);

    expect(elapsedText()).toHaveTextContent('Cooking · 00:00');
  });

  it('ticks up on its own while the clock runs', async () => {
    await render(<CookingClockText clock={startClock(Date.now())} />);

    await advance(SECOND);
    expect(elapsedText()).toHaveTextContent('Cooking · 00:01');

    await advance(MINUTE - SECOND);
    expect(elapsedText()).toHaveTextContent('Cooking · 01:00');
  });

  it('stays still while the clock is paused', async () => {
    const started = Date.now();
    const paused = pauseClock(startClock(started), started + 90 * SECOND);
    await render(<CookingClockText clock={paused} />);

    expect(elapsedText()).toHaveTextContent('Cooking · 01:30');

    await advance(5 * MINUTE);

    expect(elapsedText()).toHaveTextContent('Cooking · 01:30');
  });

  it('labels the clock "Cooking time" for screen readers', async () => {
    await render(<CookingClockText clock={startClock(Date.now())} />);

    await advance(MINUTE);

    expect(screen.getByLabelText('Cooking time 01:00')).toBe(elapsedText());
  });
});
