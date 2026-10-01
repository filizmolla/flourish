import React from 'react';
import {
  render,
  screen,
  userEvent,
  within,
} from '@testing-library/react-native';
import { Enjoyment, Fullness } from '../api/recipesClient';
import { EnjoymentPicker, FullnessPicker } from './FullnessPicker';

type Props = React.ComponentProps<typeof FullnessPicker>;

async function renderPicker(props: Partial<Props> = {}) {
  const onChange = jest.fn();
  await render(
    <FullnessPicker
      testIDPrefix="test-fullness"
      value={null}
      onChange={onChange}
      {...props}
    />,
  );
  return onChange;
}

// The group View isn't an accessibility element itself (its chips are), so
// find it by its label rather than by role.
const group = () => screen.getByLabelText('How did you feel after?');
const option = (name: string) => screen.getByRole('radio', { name });

const OPTIONS: [string, Fullness, string][] = [
  ['Still hungry', Fullness.StillHungry, 'test-fullness-still-hungry'],
  ['Satisfied', Fullness.Satisfied, 'test-fullness-satisfied'],
  ['Very full', Fullness.VeryFull, 'test-fullness-very-full'],
];

describe('FullnessPicker', () => {
  it('shows three answers in order in a labelled radio group', async () => {
    await renderPicker();

    expect(group()).toHaveProp('accessibilityRole', 'radiogroup');
    const radios = within(group()).getAllByRole('radio');
    expect(radios.map(radio => radio.props.testID)).toEqual(
      OPTIONS.map(([, , testID]) => testID),
    );
    OPTIONS.forEach(([label], index) => {
      expect(radios[index]).toHaveTextContent(label, { exact: true });
    });
  });

  it('checks none when the value is null', async () => {
    await renderPicker({ value: null });

    for (const [label] of OPTIONS) {
      expect(option(label)).not.toBeChecked();
      expect(option(label)).toBeEnabled();
    }
  });

  it.each(OPTIONS)('checks only "%s" for its value', async (label, value) => {
    await renderPicker({ value });

    for (const [other] of OPTIONS) {
      if (other === label) {
        expect(option(other)).toBeChecked();
      } else {
        expect(option(other)).not.toBeChecked();
      }
    }
  });

  it.each(OPTIONS)(
    'passes the value of "%s" when it is tapped with nothing chosen',
    async (label, value) => {
      const user = userEvent.setup();
      const onChange = await renderPicker({ value: null });

      await user.press(option(label));

      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith(value);
    },
  );

  it('passes the tapped value when another answer is chosen', async () => {
    const user = userEvent.setup();
    const onChange = await renderPicker({ value: Fullness.Satisfied });

    await user.press(option('Very full'));

    expect(onChange).toHaveBeenCalledWith(Fullness.VeryFull);
  });

  it('passes null when the chosen answer is tapped again', async () => {
    const user = userEvent.setup();
    const onChange = await renderPicker({ value: Fullness.StillHungry });

    await user.press(option('Still hungry'));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('disables every answer and ignores taps when disabled', async () => {
    const user = userEvent.setup();
    const onChange = await renderPicker({
      value: Fullness.Satisfied,
      disabled: true,
    });

    for (const [label] of OPTIONS) {
      expect(option(label)).toBeDisabled();
      await user.press(option(label));
    }
    expect(option('Satisfied')).toBeChecked();
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('EnjoymentPicker', () => {
  type EnjoymentProps = React.ComponentProps<typeof EnjoymentPicker>;

  async function renderEnjoyment(props: Partial<EnjoymentProps> = {}) {
    const onChange = jest.fn();
    await render(
      <EnjoymentPicker
        testIDPrefix="test-enjoyment"
        value={null}
        onChange={onChange}
        {...props}
      />,
    );
    return onChange;
  }

  const enjoymentGroup = () =>
    screen.getByLabelText('Was it enjoyable to make?');

  const ENJOYMENT: [string, Enjoyment, string][] = [
    ['Loved making it', Enjoyment.Loved, 'test-enjoyment-loved'],
    ['It was fine', Enjoyment.Fine, 'test-enjoyment-fine'],
    [
      'Not worth the effort',
      Enjoyment.NotWorthIt,
      'test-enjoyment-not-worth-it',
    ],
  ];

  it('shows three answers in order in its own labelled radio group', async () => {
    await renderEnjoyment();

    expect(enjoymentGroup()).toHaveProp('accessibilityRole', 'radiogroup');
    expect(
      screen.queryByLabelText('How did you feel after?'),
    ).not.toBeOnTheScreen();
    const radios = within(enjoymentGroup()).getAllByRole('radio');
    expect(radios.map(radio => radio.props.testID)).toEqual(
      ENJOYMENT.map(([, , testID]) => testID),
    );
    ENJOYMENT.forEach(([label], index) => {
      expect(radios[index]).toHaveTextContent(label, { exact: true });
      expect(radios[index]).not.toBeChecked();
    });
  });

  it.each(ENJOYMENT)('checks only "%s" for its value', async (label, value) => {
    await renderEnjoyment({ value });

    for (const [other] of ENJOYMENT) {
      if (other === label) {
        expect(option(other)).toBeChecked();
      } else {
        expect(option(other)).not.toBeChecked();
      }
    }
  });

  it.each(ENJOYMENT)(
    'passes the value of "%s" when it is tapped with nothing chosen',
    async (label, value) => {
      const user = userEvent.setup();
      const onChange = await renderEnjoyment();

      await user.press(option(label));

      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith(value);
    },
  );

  it('passes null when the chosen answer is tapped again', async () => {
    const user = userEvent.setup();
    const onChange = await renderEnjoyment({ value: Enjoyment.NotWorthIt });

    await user.press(option('Not worth the effort'));

    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('is enabled by default, and ignores taps when disabled', async () => {
    const user = userEvent.setup();
    const onChange = await renderEnjoyment({
      value: Enjoyment.Fine,
      disabled: true,
    });

    for (const [label] of ENJOYMENT) {
      expect(option(label)).toBeDisabled();
      await user.press(option(label));
    }
    expect(onChange).not.toHaveBeenCalled();

    await screen.rerender(
      <EnjoymentPicker
        testIDPrefix="test-enjoyment"
        value={Enjoyment.Fine}
        onChange={onChange}
      />,
    );
    for (const [label] of ENJOYMENT) {
      expect(option(label)).toBeEnabled();
    }
  });
});
