import {
  alignLines,
  diffLines,
  LineChange,
  LineOp,
  LineOpType,
} from './lineDiff';

const removed = (text: string): LineChange => ({
  type: LineOpType.Removed,
  text,
});
const added = (text: string): LineChange => ({ type: LineOpType.Added, text });
const same = (text: string): LineOp => ({ type: LineOpType.Same, text });

describe('alignLines', () => {
  it('marks every line of identical lists as same, in order', () => {
    expect(
      alignLines(['flour', 'eggs', 'milk'], ['flour', 'eggs', 'milk']),
    ).toEqual([same('flour'), same('eggs'), same('milk')]);
  });

  it('returns nothing for two empty lists', () => {
    expect(alignLines([], [])).toEqual([]);
  });

  it('puts an edit in place: removed old line, then its new version', () => {
    expect(alignLines(['a', 'b', 'c'], ['a', 'B', 'c'])).toEqual([
      same('a'),
      removed('b'),
      added('B'),
      same('c'),
    ]);
  });

  it('puts an added line where it appears in the new list', () => {
    expect(alignLines(['a', 'b'], ['a', 'new', 'b'])).toEqual([
      same('a'),
      added('new'),
      same('b'),
    ]);
    expect(alignLines(['a', 'b'], ['a', 'b', 'new'])).toEqual([
      same('a'),
      same('b'),
      added('new'),
    ]);
  });

  it('puts a removed line where it was in the base', () => {
    expect(alignLines(['a', 'gone', 'b'], ['a', 'b'])).toEqual([
      same('a'),
      removed('gone'),
      same('b'),
    ]);
    expect(alignLines(['gone', 'a'], ['a'])).toEqual([
      removed('gone'),
      same('a'),
    ]);
  });

  it('lists removed lines before added ones when a block is replaced', () => {
    expect(alignLines(['a', 'x', 'y', 'b'], ['a', 'Z', 'b'])).toEqual([
      same('a'),
      removed('x'),
      removed('y'),
      added('Z'),
      same('b'),
    ]);
  });

  it('agrees with diffLines once the same lines are dropped', () => {
    const base = ['a', 'b', 'c', 'd'];
    const current = ['a', 'X', 'c', 'Y', 'e'];

    expect(alignLines(base, current).filter(op => op.type !== 'same')).toEqual(
      diffLines(base, current),
    );
  });
});

describe('diffLines', () => {
  it('returns no changes for identical lists', () => {
    expect(
      diffLines(['flour', 'eggs', 'milk'], ['flour', 'eggs', 'milk']),
    ).toEqual([]);
  });

  it('returns no changes when both lists are empty', () => {
    expect(diffLines([], [])).toEqual([]);
  });

  it('shows an edited line as removed, then its new version, in place', () => {
    expect(
      diffLines(
        ['1 cup flour', '1 can tomatoes', 'salt'],
        ['1 cup flour', '2 cans tomatoes', 'salt'],
      ),
    ).toEqual([removed('1 can tomatoes'), added('2 cans tomatoes')]);
  });

  it.each([
    ['start', ['a', 'b'], ['new', 'a', 'b']],
    ['middle', ['a', 'b'], ['a', 'new', 'b']],
    ['end', ['a', 'b'], ['a', 'b', 'new']],
  ])('shows a line added at the %s as added', (_where, base, current) => {
    expect(diffLines(base, current)).toEqual([added('new')]);
  });

  it.each([
    ['start', ['gone', 'a', 'b']],
    ['middle', ['a', 'gone', 'b']],
    ['end', ['a', 'b', 'gone']],
  ])('shows a line removed from the %s as removed', (_where, base) => {
    expect(diffLines(base, ['a', 'b'])).toEqual([removed('gone')]);
  });

  it('shows several removals in reading order', () => {
    expect(diffLines(['a', 'b', 'c', 'd'], ['b', 'd'])).toEqual([
      removed('a'),
      removed('c'),
    ]);
  });

  it('shows a moved line as removed and added', () => {
    expect(diffLines(['a', 'b', 'c'], ['b', 'c', 'a'])).toEqual([
      removed('a'),
      added('a'),
    ]);
    expect(diffLines(['a', 'b', 'c'], ['c', 'a', 'b'])).toEqual([
      added('c'),
      removed('c'),
    ]);
  });

  it('shows everything as added when the base is empty', () => {
    expect(diffLines([], ['a', 'b'])).toEqual([added('a'), added('b')]);
  });

  it('shows everything as removed when the current list is empty', () => {
    expect(diffLines(['a', 'b'], [])).toEqual([removed('a'), removed('b')]);
  });

  it('counts duplicate lines one by one', () => {
    expect(diffLines(['salt', 'pepper', 'salt'], ['salt', 'pepper'])).toEqual([
      removed('salt'),
    ]);
    expect(diffLines(['salt'], ['salt', 'salt'])).toEqual([added('salt')]);
    expect(diffLines(['a', 'a', 'b'], ['a', 'b', 'b'])).toEqual([
      removed('a'),
      added('b'),
    ]);
  });

  it('compares lines exactly, including case', () => {
    expect(diffLines(['Salt'], ['salt'])).toEqual([
      removed('Salt'),
      added('salt'),
    ]);
  });

  it('keeps changes in reading order across the whole list', () => {
    expect(diffLines(['a', 'b', 'c', 'd'], ['a', 'X', 'c', 'Y'])).toEqual([
      removed('b'),
      added('X'),
      removed('d'),
      added('Y'),
    ]);
  });

  it('does not modify its inputs', () => {
    const base = ['a', 'b'];
    const current = ['b', 'c'];

    diffLines(base, current);

    expect(base).toEqual(['a', 'b']);
    expect(current).toEqual(['b', 'c']);
  });
});
