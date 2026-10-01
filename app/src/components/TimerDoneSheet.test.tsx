import React from 'react';
import {
  fireEvent,
  render,
  screen,
  userEvent,
} from '@testing-library/react-native';
import TimerDoneSheet from './TimerDoneSheet';

function renderSheet(
  props: Partial<React.ComponentProps<typeof TimerDoneSheet>> = {},
) {
  const handlers = {
    onAddTime: jest.fn(),
    onDismiss: jest.fn(),
  };
  return render(
    <TimerDoneSheet title="Step 2 done" {...handlers} {...props} />,
  ).then(() => handlers);
}

describe('TimerDoneSheet', () => {
  it('shows the title, the step text and a Check step button for a step timer', async () => {
    const user = userEvent.setup();
    const onCheckStep = jest.fn();
    await renderSheet({ stepText: 'Simmer for 10 minutes.', onCheckStep });

    expect(screen.getByRole('header', { name: 'Step 2 done' })).toBe(
      screen.getByTestId('timer-done-title'),
    );
    expect(screen.getByText('Simmer for 10 minutes.')).toBeOnTheScreen();
    expect(screen.getByText('Need more time?')).toBeOnTheScreen();

    await user.press(screen.getByRole('button', { name: 'Check step' }));

    expect(onCheckStep).toHaveBeenCalledTimes(1);
  });

  it('has no Check step button and no step text without onCheckStep and stepText', async () => {
    await renderSheet({ title: 'Timer 1 done' });

    expect(screen.getByTestId('timer-done-title')).toHaveTextContent(
      'Timer 1 done',
    );
    expect(
      screen.queryByRole('button', { name: 'Check step' }),
    ).not.toBeOnTheScreen();
    expect(
      screen.queryByTestId('timer-done-check-step-button'),
    ).not.toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeOnTheScreen();
  });

  it('adds the minutes picked in the stepper, starting at 5', async () => {
    const user = userEvent.setup();
    const { onAddTime } = await renderSheet();

    expect(screen.getByTestId('timer-done-minutes-text')).toHaveTextContent(
      '5 min',
    );
    await user.press(screen.getByRole('button', { name: 'Add 5 min' }));
    expect(onAddTime).toHaveBeenLastCalledWith(5);

    await user.press(screen.getByTestId('timer-done-minus-button'));
    await user.press(screen.getByTestId('timer-done-minus-button'));

    expect(screen.getByTestId('timer-done-minutes-text')).toHaveTextContent(
      '3 min',
    );
    await user.press(screen.getByRole('button', { name: 'Add 3 min' }));
    expect(onAddTime).toHaveBeenLastCalledWith(3);
    expect(onAddTime).toHaveBeenCalledTimes(2);
  });

  it('calls onDismiss from Dismiss and from the Android back button', async () => {
    const user = userEvent.setup();
    const { onDismiss, onAddTime } = await renderSheet();

    await user.press(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);

    // The Modal is the host element around the card.
    let modal = screen.getByTestId('timer-done-title').parent;
    while (modal && modal.type !== 'Modal') modal = modal.parent;
    if (!modal) throw new Error('No Modal around the sheet');
    await fireEvent(modal, 'requestClose');

    expect(onDismiss).toHaveBeenCalledTimes(2);
    expect(onAddTime).not.toHaveBeenCalled();
  });
});
