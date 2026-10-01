import React, { useState } from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  userEvent,
} from '@testing-library/react-native';
import MinutesStepper, { clampMinutes } from './MinutesStepper';

// Keeps the value like a real parent would, and records every change.
function StatefulStepper({
  initial,
  onChange,
}: {
  initial: number;
  onChange: jest.Mock;
}) {
  const [value, setValue] = useState(initial);
  return (
    <MinutesStepper
      testIDPrefix="test"
      value={value}
      onChange={minutes => {
        onChange(minutes);
        setValue(minutes);
      }}
    />
  );
}

async function renderStepper(initial: number) {
  const onChange = jest.fn();
  await render(<StatefulStepper initial={initial} onChange={onChange} />);
  return onChange;
}

const minus = () => screen.getByTestId('test-minus-button');
const plus = () => screen.getByTestId('test-plus-button');
const shown = () => screen.getByTestId('test-minutes-text');
const adjustable = () => screen.getByRole('adjustable', { name: 'Minutes' });

describe('clampMinutes', () => {
  it.each([
    [-3, 1],
    [0, 1],
    [1, 1],
    [30, 30],
    [60, 60],
    [61, 60],
  ])('clamps %i to %i', (input, output) => {
    expect(clampMinutes(input)).toBe(output);
  });
});

describe('MinutesStepper', () => {
  it('shows the value in minutes', async () => {
    await renderStepper(5);
    expect(shown()).toHaveTextContent('5 min');
  });

  it('steps by one minute per press', async () => {
    const user = userEvent.setup();
    const onChange = await renderStepper(5);

    await user.press(plus());
    expect(shown()).toHaveTextContent('6 min');
    await user.press(minus());
    await user.press(minus());
    expect(shown()).toHaveTextContent('4 min');
    expect(onChange.mock.calls).toEqual([[6], [5], [4]]);
  });

  it('disables minus at 1 minute and never goes below it', async () => {
    const user = userEvent.setup();
    const onChange = await renderStepper(2);

    await user.press(minus());
    expect(shown()).toHaveTextContent('1 min');
    expect(minus()).toBeDisabled();
    expect(plus()).toBeEnabled();

    await user.press(minus());
    await fireEvent(adjustable(), 'accessibilityAction', {
      nativeEvent: { actionName: 'decrement' },
    });
    expect(shown()).toHaveTextContent('1 min');
    expect(onChange.mock.calls).toEqual([[1]]);
  });

  it('disables plus at 60 minutes and never goes above it', async () => {
    const user = userEvent.setup();
    const onChange = await renderStepper(59);

    await user.press(plus());
    expect(shown()).toHaveTextContent('60 min');
    expect(plus()).toBeDisabled();
    expect(minus()).toBeEnabled();

    await user.press(plus());
    await fireEvent(adjustable(), 'accessibilityAction', {
      nativeEvent: { actionName: 'increment' },
    });
    expect(shown()).toHaveTextContent('60 min');
    expect(onChange.mock.calls).toEqual([[60]]);
  });

  it('is one adjustable control for screen readers, read as "N minutes"', async () => {
    await renderStepper(5);
    expect(adjustable()).toHaveAccessibilityValue({ text: '5 minutes' });
  });

  it('says "1 minute" in the singular', async () => {
    await renderStepper(1);
    expect(adjustable()).toHaveAccessibilityValue({ text: '1 minute' });
  });

  it('changes by one on the increment and decrement actions', async () => {
    const onChange = await renderStepper(5);

    await fireEvent(adjustable(), 'accessibilityAction', {
      nativeEvent: { actionName: 'increment' },
    });
    expect(adjustable()).toHaveAccessibilityValue({ text: '6 minutes' });

    await fireEvent(adjustable(), 'accessibilityAction', {
      nativeEvent: { actionName: 'decrement' },
    });
    await fireEvent(adjustable(), 'accessibilityAction', {
      nativeEvent: { actionName: 'decrement' },
    });
    expect(adjustable()).toHaveAccessibilityValue({ text: '4 minutes' });
    expect(onChange.mock.calls).toEqual([[6], [5], [4]]);
  });

  describe('holding a button', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('keeps stepping while held and stops on release', async () => {
      const onChange = await renderStepper(5);

      await fireEvent(plus(), 'longPress');
      expect(onChange).not.toHaveBeenCalled();

      // One step every 120 ms.
      await act(() => jest.advanceTimersByTime(120 * 4));
      expect(shown()).toHaveTextContent('9 min');

      await fireEvent(plus(), 'pressOut');
      await act(() => jest.advanceTimersByTime(1000));
      expect(shown()).toHaveTextContent('9 min');
      expect(onChange.mock.calls).toEqual([[6], [7], [8], [9]]);
    });

    it('repeats downwards too and stops at the lower bound', async () => {
      const onChange = await renderStepper(4);

      await fireEvent(minus(), 'longPress');
      await act(() => jest.advanceTimersByTime(2000));

      expect(shown()).toHaveTextContent('1 min');
      expect(onChange.mock.calls).toEqual([[3], [2], [1]]);
      await fireEvent(minus(), 'pressOut');
    });

    it('steps repeatedly during a real long press gesture', async () => {
      const user = userEvent.setup();
      const onChange = await renderStepper(5);

      // Long press fires at 500 ms; the other 500 ms of the hold step every
      // 120 ms. A long press is not also a press, so no extra +1.
      await user.longPress(plus(), { duration: 1000 });
      expect(shown()).toHaveTextContent('9 min');

      // Released: no more steps.
      await act(() => jest.advanceTimersByTime(2000));
      expect(onChange.mock.calls).toEqual([[6], [7], [8], [9]]);
    });

    it('stops repeating when unmounted mid-hold', async () => {
      const onChange = await renderStepper(5);

      await fireEvent(plus(), 'longPress');
      await screen.unmount();
      jest.advanceTimersByTime(1000);

      expect(onChange).not.toHaveBeenCalled();
    });
  });
});
