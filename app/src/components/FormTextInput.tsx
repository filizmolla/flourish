import React from 'react';
import { Control, Controller, FieldValues, Path } from 'react-hook-form';
import {
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  TextStyle,
} from 'react-native';
import { colors } from '../theme';

type FormTextInputProps<T extends FieldValues> = Omit<
  TextInputProps,
  'value' | 'onChangeText' | 'onBlur' | 'style' | 'testID'
> & {
  control: Control<T>;
  name: Path<T>;
  testID: string;
  errorTestID: string;
  inputStyle?: StyleProp<TextStyle>;
};

// A react-hook-form bound text input. Once the field has been touched (or the
// form submitted), an invalid value gets a red border and its validation
// message underneath.
export default function FormTextInput<T extends FieldValues>({
  control,
  name,
  testID,
  errorTestID,
  inputStyle,
  ...inputProps
}: FormTextInputProps<T>) {
  return (
    <Controller
      control={control}
      name={name}
      render={({
        field: { value, onChange, onBlur },
        fieldState,
        formState,
      }) => {
        const error =
          fieldState.isTouched || formState.isSubmitted
            ? fieldState.error
            : undefined;
        return (
          <>
            <TextInput
              placeholderTextColor={colors.placeholderText}
              {...inputProps}
              testID={testID}
              style={[styles.input, inputStyle, error && styles.inputInvalid]}
              value={value}
              onChangeText={onChange}
              onBlur={onBlur}
            />
            {error ? (
              <Text testID={errorTestID} style={styles.error}>
                {error.message}
              </Text>
            ) : null}
          </>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: colors.card,
    color: colors.ink,
    fontSize: 16,
  },
  inputInvalid: {
    borderColor: colors.danger,
  },
  error: {
    color: colors.danger,
  },
});
