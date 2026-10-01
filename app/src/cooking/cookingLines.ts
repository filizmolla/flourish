import { isHeadingLine } from '../recipes/recipeForm';
import { alignLines, LineOpType } from './lineDiff';

// Ingredient and step lines as changed for one attempt. The saved recipe is
// never touched: each line keeps the base recipe's text next to this
// attempt's text, so the screen can show "was: …" and undo it.
//
// Lines are never taken out of the list, only marked removed, and new lines
// are appended. That keeps every index stable, so checkmarks and step timers
// can refer to lines by index.
// Which list a line belongs to. The values are part of testIDs
// (cooking-step-3, attempt-detail-line-ingredient-0).
export enum LineKind {
  Ingredient = 'ingredient',
  Step = 'step',
}

export type CookingLine = {
  original: string | null; // null = added during this attempt
  text: string | null; // null = removed during this attempt
};

// How a line changed during this attempt.
export enum LineStatus {
  Unchanged = 'unchanged',
  Edited = 'edited',
  Added = 'added',
  Removed = 'removed',
}

export function linesFromBase(texts: string[]): CookingLine[] {
  return texts.map(text => ({ original: text, text }));
}

// Lines are single-line text; a pasted line break becomes a space.
export function cleanLineText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function lineStatus(line: CookingLine): LineStatus {
  if (line.text === null) return LineStatus.Removed;
  if (line.original === null) return LineStatus.Added;
  return line.text === line.original ? LineStatus.Unchanged : LineStatus.Edited;
}

// A line added and then removed again is left out of the screen entirely.
export function isShown(line: CookingLine): boolean {
  return line.original !== null || line.text !== null;
}

// Counts, numbering and "next step" only look at lines still in use.
export function isActive(line: CookingLine): boolean {
  return line.text !== null;
}

// A section heading still in use ("# For the cream"): a divider row.
export function isHeading(line: CookingLine): boolean {
  return line.text !== null && isHeadingLine(line.text);
}

// Lines you actually cook with: in use and not a heading. Only these can be
// checked, get a step number, count in "x of y" or be the next step.
export function isCountable(line: CookingLine): boolean {
  return isActive(line) && !isHeading(line);
}

export function countCountable(lines: CookingLine[]): number {
  return lines.filter(isCountable).length;
}

export function editLine(
  lines: CookingLine[],
  index: number,
  text: string,
): CookingLine[] {
  return lines.map((line, i) => (i === index ? { ...line, text } : line));
}

export function removeLine(lines: CookingLine[], index: number): CookingLine[] {
  return lines.map((line, i) => (i === index ? { ...line, text: null } : line));
}

export function undoLine(lines: CookingLine[], index: number): CookingLine[] {
  return lines.map((line, i) =>
    i === index ? { ...line, text: line.original } : line,
  );
}

export function addLine(lines: CookingLine[], text: string): CookingLine[] {
  return [...lines, { original: null, text }];
}

export function activeTexts(lines: CookingLine[]): string[] {
  return lines.flatMap(line => (line.text === null ? [] : [line.text]));
}

// What the attempt saves: null when the result matches the base recipe
// (even if lines were edited and changed back), else the full list.
export function changedTexts(lines: CookingLine[]): string[] | null {
  const base = lines.flatMap(line =>
    line.original === null ? [] : [line.original],
  );
  const current = activeTexts(lines);
  const same =
    base.length === current.length &&
    base.every((text, index) => text === current[index]);
  return same ? null : current;
}

// Lines edited, added or removed this time ("You changed 2 steps").
export function countChanged(lines: CookingLine[]): number {
  return lines.filter(
    line => isShown(line) && lineStatus(line) !== LineStatus.Unchanged,
  ).length;
}

// Starting lines for "Cook this version again": an old attempt's lines laid
// over today's recipe as this attempt's edits, so each shows "was: …" and can
// be undone. Side-by-side removed and added lines pair up as edits; the rest
// stay removed or added. null when the version matches the recipe.
export function linesFromVersion(
  base: string[],
  version: string[] | null,
): CookingLine[] | null {
  if (version === null) return null;
  const lines: CookingLine[] = [];
  let removed: string[] = [];
  let added: string[] = [];
  const pairUp = () => {
    for (let i = 0; i < Math.max(removed.length, added.length); i++) {
      lines.push({ original: removed[i] ?? null, text: added[i] ?? null });
    }
    removed = [];
    added = [];
  };
  for (const op of alignLines(base, version)) {
    if (op.type === LineOpType.Removed) removed.push(op.text);
    else if (op.type === LineOpType.Added) added.push(op.text);
    else {
      pairUp();
      lines.push({ original: op.text, text: op.text });
    }
  }
  pairUp();
  return lines.some(line => lineStatus(line) !== LineStatus.Unchanged)
    ? lines
    : null;
}
