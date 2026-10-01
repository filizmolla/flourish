import { strings } from '../strings';

// Starts a new "Step N: " line at the end of the notes, ready to type.
// Tapping the same step twice in a row doesn't add the prefix twice.
export function addStepNotePrefix(notes: string, stepNumber: number): string {
  const prefix = strings.cooking.stepNotePrefix(stepNumber);
  if (notes.trim().length === 0) return prefix;
  const lastLine = notes.slice(notes.lastIndexOf('\n') + 1);
  if (lastLine === prefix) return notes;
  return notes.endsWith('\n') ? notes + prefix : `${notes}\n${prefix}`;
}
