import { addStepNotePrefix } from './cookingNotes';

describe('addStepNotePrefix', () => {
  it.each([
    ['empty', ''],
    ['whitespace-only', '   '],
    ['blank-lines-only', '\n \n\t'],
  ])('starts with just the prefix when the notes are %s', (_label, notes) => {
    expect(addStepNotePrefix(notes, 3)).toBe('Step 3: ');
  });

  it('puts the prefix on a new line after text without a trailing newline', () => {
    expect(addStepNotePrefix('Too salty', 2)).toBe('Too salty\nStep 2: ');
  });

  it('adds no extra newline when the text already ends with one', () => {
    expect(addStepNotePrefix('Too salty\n', 2)).toBe('Too salty\nStep 2: ');
  });

  it('does not repeat the prefix when the same step is tapped twice', () => {
    const once = addStepNotePrefix('', 1);
    expect(addStepNotePrefix(once, 1)).toBe('Step 1: ');

    const afterText = addStepNotePrefix('Too salty', 2);
    expect(addStepNotePrefix(afterText, 2)).toBe('Too salty\nStep 2: ');
  });

  it('adds the prefix again once something was typed after it', () => {
    expect(addStepNotePrefix('Step 1: burnt', 1)).toBe(
      'Step 1: burnt\nStep 1: ',
    );
  });

  // Current behaviour: an untouched prefix for another step is kept, and the
  // new one goes on the next line instead of replacing it.
  it('adds a new line for a different step after an untouched prefix', () => {
    expect(addStepNotePrefix('Step 2: ', 1)).toBe('Step 2: \nStep 1: ');
  });

  it('only looks at the last line of multi-line notes', () => {
    // The prefix on an earlier line doesn't count as "already there".
    expect(addStepNotePrefix('Step 1: \nToo salty', 1)).toBe(
      'Step 1: \nToo salty\nStep 1: ',
    );
    // An untouched prefix on the last line does.
    expect(addStepNotePrefix('Too salty\nStep 1: ', 1)).toBe(
      'Too salty\nStep 1: ',
    );
  });

  it('uses two-digit step numbers as-is', () => {
    expect(addStepNotePrefix('', 10)).toBe('Step 10: ');
  });
});
