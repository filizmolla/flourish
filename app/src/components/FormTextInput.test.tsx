import React from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Pressable, Text } from 'react-native';
import { render, screen, userEvent } from '@testing-library/react-native';
import { z } from 'zod';
import FormTextInput from './FormTextInput';

const schema = z.object({ name: z.string().min(1, 'Name is required') });
type Values = z.infer<typeof schema>;

// A minimal one-field form, so the component is tested the way screens use it.
function NameForm({ onValid }: { onValid: (values: Values) => void }) {
  const { control, handleSubmit } = useForm<Values>({
    defaultValues: { name: '' },
    resolver: zodResolver(schema),
    mode: 'onChange',
  });
  return (
    <>
      <FormTextInput
        control={control}
        name="name"
        testID="name-input"
        errorTestID="name-error-text"
        placeholder="Your name"
      />
      <Pressable onPress={() => handleSubmit(onValid)()}>
        <Text>Submit</Text>
      </Pressable>
    </>
  );
}

describe('FormTextInput', () => {
  it('shows no error for an untouched, unsubmitted invalid field', async () => {
    await render(<NameForm onValid={jest.fn()} />);

    expect(screen.queryByText('Name is required')).not.toBeOnTheScreen();
  });

  it('shows the error once the field has been touched', async () => {
    const user = userEvent.setup();
    await render(<NameForm onValid={jest.fn()} />);

    const input = screen.getByPlaceholderText('Your name');
    await user.type(input, 'a');
    await user.clear(input);

    expect(await screen.findByText('Name is required')).toBeOnTheScreen();
  });

  it('shows the error after submitting even if the field was never touched', async () => {
    const user = userEvent.setup();
    const onValid = jest.fn();
    await render(<NameForm onValid={onValid} />);

    await user.press(screen.getByText('Submit'));

    expect(await screen.findByText('Name is required')).toBeOnTheScreen();
    expect(onValid).not.toHaveBeenCalled();
  });

  it('hides the error again once the value is valid', async () => {
    const user = userEvent.setup();
    const onValid = jest.fn();
    await render(<NameForm onValid={onValid} />);

    await user.press(screen.getByText('Submit'));
    await screen.findByText('Name is required');
    await user.type(screen.getByPlaceholderText('Your name'), 'Filiz');

    expect(screen.queryByText('Name is required')).not.toBeOnTheScreen();
    await user.press(screen.getByText('Submit'));
    expect(onValid.mock.calls[0][0]).toEqual({ name: 'Filiz' });
  });
});
