import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Enjoyment, Fullness } from '../api/recipesClient';
import { strings } from '../strings';
import { colors } from '../theme';

// Equal chips for an optional one-of question, none framed as the right
// answer; tapping the chosen one again clears it.
function ChoiceChips<T extends string>({
  options,
  label,
  value,
  onChange,
  testIDPrefix,
  disabled,
}: {
  options: readonly { value: T; id: string; text: string }[];
  label: string;
  value: T | null;
  onChange: (value: T | null) => void;
  testIDPrefix: string;
  disabled: boolean;
}) {
  return (
    <View
      style={styles.row}
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
    >
      {options.map(option => {
        const selected = value === option.value;
        return (
          <Pressable
            key={option.value}
            testID={`${testIDPrefix}-${option.id}`}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected, disabled }}
            disabled={disabled}
            style={[styles.chip, selected && styles.chipSelected]}
            onPress={() => onChange(selected ? null : option.value)}
          >
            <Text style={[styles.text, selected && styles.textSelected]}>
              {option.text}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

type PickerProps<T> = {
  value: T | null;
  onChange: (value: T | null) => void;
  testIDPrefix: string; // "finish-fullness" → finish-fullness-satisfied
  disabled?: boolean;
};

const FULLNESS_OPTIONS = [
  { value: Fullness.StillHungry, id: 'still-hungry' },
  { value: Fullness.Satisfied, id: 'satisfied' },
  { value: Fullness.VeryFull, id: 'very-full' },
].map(option => ({ ...option, text: strings.fullness[option.value] }));

// "How did you feel after?"
export function FullnessPicker({
  disabled = false,
  ...props
}: PickerProps<Fullness>) {
  return (
    <ChoiceChips
      {...props}
      disabled={disabled}
      options={FULLNESS_OPTIONS}
      label={strings.fullness.question}
    />
  );
}

const ENJOYMENT_OPTIONS = [
  { value: Enjoyment.Loved, id: 'loved' },
  { value: Enjoyment.Fine, id: 'fine' },
  { value: Enjoyment.NotWorthIt, id: 'not-worth-it' },
].map(option => ({ ...option, text: strings.enjoyment[option.value] }));

// "Was it enjoyable to make?"
export function EnjoymentPicker({
  disabled = false,
  ...props
}: PickerProps<Enjoyment>) {
  return (
    <ChoiceChips
      {...props}
      disabled={disabled}
      options={ENJOYMENT_OPTIONS}
      label={strings.enjoyment.question}
    />
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    flexGrow: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.card,
  },
  chipSelected: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  text: {
    color: colors.ink,
    fontSize: 15,
  },
  textSelected: {
    color: colors.card,
    fontWeight: '700',
  },
});
