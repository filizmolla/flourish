import {
  LineStatus,
  activeTexts,
  addLine,
  changedTexts,
  cleanLineText,
  countChanged,
  countCountable,
  editLine,
  isActive,
  isCountable,
  isHeading,
  isShown,
  lineStatus,
  linesFromBase,
  linesFromVersion,
  removeLine,
  undoLine,
} from './cookingLines';

const base = ['1 cup flour', '2 eggs', '1 cup milk'];

describe('linesFromBase', () => {
  it('pairs each base text with an identical current text', () => {
    expect(linesFromBase(base)).toEqual([
      { original: '1 cup flour', text: '1 cup flour' },
      { original: '2 eggs', text: '2 eggs' },
      { original: '1 cup milk', text: '1 cup milk' },
    ]);
  });

  it('returns an empty list for an empty base', () => {
    expect(linesFromBase([])).toEqual([]);
  });
});

describe('lineStatus', () => {
  it('is unchanged for a line straight from the base recipe', () => {
    expect(lineStatus({ original: '2 eggs', text: '2 eggs' })).toBe(
      LineStatus.Unchanged,
    );
  });

  it('is edited when the text differs from the original', () => {
    expect(lineStatus({ original: '2 eggs', text: '3 eggs' })).toBe(
      LineStatus.Edited,
    );
  });

  it('is added when there is no original', () => {
    expect(lineStatus({ original: null, text: 'a pinch of salt' })).toBe(
      LineStatus.Added,
    );
  });

  it('is removed when there is no text, for base and added lines alike', () => {
    expect(lineStatus({ original: '2 eggs', text: null })).toBe(
      LineStatus.Removed,
    );
    expect(lineStatus({ original: null, text: null })).toBe(LineStatus.Removed);
  });

  it('counts editing back to the original as unchanged', () => {
    let lines = editLine(linesFromBase(base), 1, '3 eggs');
    expect(lineStatus(lines[1])).toBe(LineStatus.Edited);

    lines = editLine(lines, 1, '2 eggs');
    expect(lineStatus(lines[1])).toBe(LineStatus.Unchanged);
  });
});

describe('isShown and isActive', () => {
  it('shows and uses base, edited and added lines', () => {
    for (const line of [
      { original: '2 eggs', text: '2 eggs' },
      { original: '2 eggs', text: '3 eggs' },
      { original: null, text: 'salt' },
    ]) {
      expect(isShown(line)).toBe(true);
      expect(isActive(line)).toBe(true);
    }
  });

  it('still shows a removed base line, but it is no longer active', () => {
    const line = { original: '2 eggs', text: null };
    expect(isShown(line)).toBe(true);
    expect(isActive(line)).toBe(false);
  });

  it('hides a line that was added and then removed again', () => {
    const lines = removeLine(addLine(linesFromBase(base), 'salt'), 3);
    expect(lines).toHaveLength(4);
    expect(isShown(lines[3])).toBe(false);
    expect(isActive(lines[3])).toBe(false);
  });
});

describe('isHeading, isCountable and countCountable', () => {
  const sectioned = [
    '# For the cake',
    '2 cups flour',
    '#10 can tomatoes',
    '# For the cream',
    '200 ml cream',
  ];

  it('treats a heading in use as a heading, never countable', () => {
    const line = { original: '# For the cake', text: '# For the cake' };
    expect(isHeading(line)).toBe(true);
    expect(isActive(line)).toBe(true);
    expect(isCountable(line)).toBe(false);
  });

  it('treats an ordinary line in use as countable', () => {
    const line = { original: '2 eggs', text: '2 eggs' };
    expect(isHeading(line)).toBe(false);
    expect(isCountable(line)).toBe(true);
  });

  it('treats a removed line as neither, even if it was a heading', () => {
    const line = { original: '# For the cake', text: null };
    expect(isHeading(line)).toBe(false);
    expect(isCountable(line)).toBe(false);
  });

  it('follows the current text: editing a line into "# …" makes it a heading, and back', () => {
    let lines = editLine(linesFromBase(['2 eggs']), 0, '# Eggs');
    expect(isHeading(lines[0])).toBe(true);
    expect(isCountable(lines[0])).toBe(false);

    lines = editLine(lines, 0, 'Eggs');
    expect(isHeading(lines[0])).toBe(false);
    expect(isCountable(lines[0])).toBe(true);
  });

  it('makes an added "# …" line a heading', () => {
    const lines = addLine(linesFromBase(base), '# For the glaze');
    expect(isHeading(lines[3])).toBe(true);
  });

  it('counts only lines in use that are not headings', () => {
    expect(countCountable(linesFromBase(sectioned))).toBe(3);
  });

  it('leaves out removed lines and headings added during cooking', () => {
    let lines = linesFromBase(sectioned);
    lines = removeLine(lines, 1);
    lines = addLine(lines, '# For the glaze');
    lines = addLine(lines, 'icing sugar');

    expect(countCountable(lines)).toBe(3);
  });

  it('is 0 when there are only headings', () => {
    expect(countCountable(linesFromBase(['# A', '## B']))).toBe(0);
  });
});

describe('line operations', () => {
  it('keeps removed lines in the list so later indexes stay stable', () => {
    const lines = removeLine(linesFromBase(base), 0);

    expect(lines).toHaveLength(3);
    expect(lines[0]).toEqual({ original: '1 cup flour', text: null });
    expect(lines[1]).toEqual({ original: '2 eggs', text: '2 eggs' });
    expect(lines[2]).toEqual({ original: '1 cup milk', text: '1 cup milk' });
  });

  it('appends added lines at the end without shifting existing ones', () => {
    const lines = addLine(removeLine(linesFromBase(base), 1), 'salt');

    expect(lines).toHaveLength(4);
    expect(lines[1]).toEqual({ original: '2 eggs', text: null });
    expect(lines[3]).toEqual({ original: null, text: 'salt' });
  });

  it('undo restores the original text of an edited line', () => {
    const lines = undoLine(editLine(linesFromBase(base), 1, '3 eggs'), 1);
    expect(lines[1]).toEqual({ original: '2 eggs', text: '2 eggs' });
  });

  it('undo brings back a removed line', () => {
    const lines = undoLine(removeLine(linesFromBase(base), 2), 2);
    expect(lines[2]).toEqual({ original: '1 cup milk', text: '1 cup milk' });
  });

  it('never mutates the list it is given', () => {
    const lines = linesFromBase(base);
    const snapshot = lines.map(line => ({ ...line }));

    editLine(lines, 0, 'changed');
    removeLine(lines, 1);
    undoLine(lines, 2);
    addLine(lines, 'salt');

    expect(lines).toEqual(snapshot);
  });
});

describe('cleanLineText', () => {
  it('collapses line breaks, tabs and repeated spaces into single spaces', () => {
    expect(cleanLineText('Whisk\nthe\r\n batter\t\tuntil   smooth')).toBe(
      'Whisk the batter until smooth',
    );
  });

  it('trims surrounding whitespace', () => {
    expect(cleanLineText('  \n 2 eggs \n ')).toBe('2 eggs');
  });

  it('returns an empty string for blank input', () => {
    expect(cleanLineText('')).toBe('');
    expect(cleanLineText(' \n\t ')).toBe('');
  });
});

describe('activeTexts', () => {
  it('returns the current texts in order, skipping removed lines', () => {
    let lines = linesFromBase(base);
    lines = editLine(lines, 0, '2 cups flour');
    lines = removeLine(lines, 1);
    lines = addLine(lines, 'salt');

    expect(activeTexts(lines)).toEqual(['2 cups flour', '1 cup milk', 'salt']);
  });

  it('returns an empty list when every line is removed', () => {
    expect(activeTexts(removeLine(linesFromBase(['2 eggs']), 0))).toEqual([]);
  });
});

describe('changedTexts', () => {
  it('is null when nothing changed', () => {
    expect(changedTexts(linesFromBase(base))).toBeNull();
  });

  it('is null when edits were changed back or undone', () => {
    let lines = linesFromBase(base);
    lines = editLine(lines, 0, '2 cups flour');
    lines = editLine(lines, 0, '1 cup flour');
    lines = removeLine(lines, 1);
    lines = undoLine(lines, 1);

    expect(changedTexts(lines)).toBeNull();
  });

  it('is null when a line was added and removed again', () => {
    const lines = removeLine(addLine(linesFromBase(base), 'salt'), 3);
    expect(changedTexts(lines)).toBeNull();
  });

  it('returns the full list when a line is edited', () => {
    expect(changedTexts(editLine(linesFromBase(base), 1, '3 eggs'))).toEqual([
      '1 cup flour',
      '3 eggs',
      '1 cup milk',
    ]);
  });

  it('returns the full list when a line is removed', () => {
    expect(changedTexts(removeLine(linesFromBase(base), 1))).toEqual([
      '1 cup flour',
      '1 cup milk',
    ]);
  });

  it('returns the full list when a line is added', () => {
    expect(changedTexts(addLine(linesFromBase(base), 'salt'))).toEqual([
      ...base,
      'salt',
    ]);
  });

  it('returns the full list when a line is moved by removing and re-adding it', () => {
    const lines = addLine(removeLine(linesFromBase(base), 0), '1 cup flour');
    expect(changedTexts(lines)).toEqual([
      '2 eggs',
      '1 cup milk',
      '1 cup flour',
    ]);
  });

  it('returns an empty list when every line is removed', () => {
    expect(changedTexts(removeLine(linesFromBase(['2 eggs']), 0))).toEqual([]);
  });
});

describe('countChanged', () => {
  it('is 0 for the recipe as it is, and for an empty list', () => {
    expect(countChanged(linesFromBase(base))).toBe(0);
    expect(countChanged([])).toBe(0);
  });

  it('counts each edited, added and removed line once', () => {
    let lines = linesFromBase(base);
    lines = editLine(lines, 0, '2 cups flour');
    lines = editLine(lines, 0, '3 cups flour');
    lines = removeLine(lines, 1);
    lines = addLine(lines, 'salt');

    expect(countChanged(lines)).toBe(3);
  });

  it('does not count an edit changed back or undone', () => {
    let lines = linesFromBase(base);
    lines = editLine(lines, 0, '2 cups flour');
    lines = editLine(lines, 0, '1 cup flour');
    lines = removeLine(lines, 1);
    lines = undoLine(lines, 1);

    expect(countChanged(lines)).toBe(0);
  });

  it('does not count a line added and then removed again', () => {
    const lines = removeLine(addLine(linesFromBase(base), 'salt'), 3);
    expect(countChanged(lines)).toBe(0);
  });

  it('counts a removed base line that was edited first as one change', () => {
    const lines = removeLine(editLine(linesFromBase(base), 2, 'oat milk'), 2);
    expect(countChanged(lines)).toBe(1);
  });
});

describe('linesFromVersion', () => {
  it('returns null when there is no saved version', () => {
    expect(linesFromVersion(base, null)).toBeNull();
  });

  it('returns null when the version matches the recipe', () => {
    expect(linesFromVersion(base, [...base])).toBeNull();
    expect(linesFromVersion([], [])).toBeNull();
  });

  it('turns one changed line into an edit in place and keeps the rest', () => {
    expect(
      linesFromVersion(base, ['1 cup flour', '3 eggs', '1 cup milk']),
    ).toEqual([
      { original: '1 cup flour', text: '1 cup flour' },
      { original: '2 eggs', text: '3 eggs' },
      { original: '1 cup milk', text: '1 cup milk' },
    ]);
  });

  it('pairs two removed lines and one added line as an edit, then a removal', () => {
    expect(linesFromVersion(base, ['1 cup flour', '1 cup oat milk'])).toEqual([
      { original: '1 cup flour', text: '1 cup flour' },
      { original: '2 eggs', text: '1 cup oat milk' },
      { original: '1 cup milk', text: null },
    ]);
  });

  it('puts a line added in the middle at its position', () => {
    expect(
      linesFromVersion(base, [
        '1 cup flour',
        'pinch of salt',
        '2 eggs',
        '1 cup milk',
      ]),
    ).toEqual([
      { original: '1 cup flour', text: '1 cup flour' },
      { original: null, text: 'pinch of salt' },
      { original: '2 eggs', text: '2 eggs' },
      { original: '1 cup milk', text: '1 cup milk' },
    ]);
  });

  it('marks a line missing from the version as removed', () => {
    expect(linesFromVersion(base, ['1 cup flour', '1 cup milk'])).toEqual([
      { original: '1 cup flour', text: '1 cup flour' },
      { original: '2 eggs', text: null },
      { original: '1 cup milk', text: '1 cup milk' },
    ]);
  });

  it('gives lines whose statuses and saved texts match the version', () => {
    const version = ['1 cup flour', '3 eggs', 'pinch of salt'];

    const lines = linesFromVersion(base, version)!;

    expect(lines.map(lineStatus)).toEqual([
      LineStatus.Unchanged,
      LineStatus.Edited,
      LineStatus.Edited,
    ]);
    expect(changedTexts(lines)).toEqual(version);
  });

  it('saves the version texts with an added and a removed line', () => {
    const version = ['pinch of salt', '1 cup flour', '1 cup milk'];

    const lines = linesFromVersion(base, version)!;

    expect(lines.map(lineStatus)).toEqual([
      LineStatus.Added,
      LineStatus.Unchanged,
      LineStatus.Removed,
      LineStatus.Unchanged,
    ]);
    expect(changedTexts(lines)).toEqual(version);
  });
});
