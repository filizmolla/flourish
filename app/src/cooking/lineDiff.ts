// How a line of `current` relates to `base` in alignLines.
export enum LineOpType {
  Same = 'same',
  Removed = 'removed',
  Added = 'added',
}

export type LineOp = { type: LineOpType; text: string };
export type LineChange = {
  type: LineOpType.Removed | LineOpType.Added;
  text: string;
};

// Walks `base` into `current` line by line, using the longest common
// subsequence: unchanged lines are 'same', a line that only moved shows as
// removed + added, and an edit as a removed line followed by its new version.
export function alignLines(base: string[], current: string[]): LineOp[] {
  // common[i][j] = LCS length of base[i..] and current[j..].
  const common = Array.from({ length: base.length + 1 }, () =>
    new Array<number>(current.length + 1).fill(0),
  );
  for (let i = base.length - 1; i >= 0; i--) {
    for (let j = current.length - 1; j >= 0; j--) {
      common[i][j] =
        base[i] === current[j]
          ? common[i + 1][j + 1] + 1
          : Math.max(common[i + 1][j], common[i][j + 1]);
    }
  }

  const ops: LineOp[] = [];
  let i = 0;
  let j = 0;
  while (i < base.length && j < current.length) {
    if (base[i] === current[j]) {
      ops.push({ type: LineOpType.Same, text: base[i] });
      i++;
      j++;
    } else if (common[i + 1][j] >= common[i][j + 1]) {
      ops.push({ type: LineOpType.Removed, text: base[i++] });
    } else {
      ops.push({ type: LineOpType.Added, text: current[j++] });
    }
  }
  while (i < base.length) ops.push({ type: LineOpType.Removed, text: base[i++] });
  while (j < current.length) ops.push({ type: LineOpType.Added, text: current[j++] });
  return ops;
}

// Only the lines removed from `base` and added in `current`, in reading order.
export function diffLines(base: string[], current: string[]): LineChange[] {
  return alignLines(base, current).filter(
    (op): op is LineChange => op.type !== LineOpType.Same,
  );
}
