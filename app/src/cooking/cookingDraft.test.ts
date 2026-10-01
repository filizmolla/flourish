import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  clearDraft,
  clockFromDraft,
  CookingDraft,
  draftKey,
  loadDraft,
  parseDraft,
  saveDraft,
} from './cookingDraft';

const MINUTE = 60_000;
const SAVED_AT = Date.parse('2026-09-21T12:00:00.000Z');

function makeDraft(overrides: Partial<CookingDraft> = {}): CookingDraft {
  return {
    version: 1,
    recipeId: 'r1',
    startedAt: SAVED_AT - 30 * MINUTE,
    savedAt: SAVED_AT,
    elapsedMs: 12 * MINUTE,
    ingredients: null,
    instructions: [
      { original: 'Whisk the batter.', text: 'Whisk well.' },
      { original: null, text: 'Serve warm.' },
    ],
    checkedIngredients: [1],
    checkedSteps: [0],
    notes: 'Step 1: lumpy',
    timers: [{ id: 'step-0', stepIndex: 0, label: 'Step 1', endsAt: SAVED_AT }],
    ...overrides,
  };
}

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('draftKey', () => {
  it('is namespaced by recipe id', () => {
    expect(draftKey('r1')).toBe('cooking-draft:r1');
  });
});

describe('parseDraft', () => {
  it('returns the draft for a saved draft of the same recipe', () => {
    const draft = makeDraft();

    expect(parseDraft(JSON.stringify(draft), 'r1')).toEqual(draft);
  });

  it.each([
    ['null', null],
    ['an empty string', ''],
    ['broken JSON', '{"version":1,'],
    ['JSON null', 'null'],
    ['a non-object', '42'],
    ['a wrong version', JSON.stringify({ ...makeDraft(), version: 2 })],
    [
      'a missing version',
      JSON.stringify({ ...makeDraft(), version: undefined }),
    ],
    ['another recipe', JSON.stringify(makeDraft({ recipeId: 'r2' }))],
  ])('returns null for %s', (_label, json) => {
    expect(parseDraft(json, 'r1')).toBeNull();
  });
});

describe('clockFromDraft', () => {
  const now = SAVED_AT + 10 * MINUTE;

  it('continues a paused draft from elapsedMs and runs from now', () => {
    const draft = makeDraft({ elapsedMs: 12 * MINUTE, activeSince: undefined });

    expect(clockFromDraft(draft, now)).toEqual({
      elapsedMs: 12 * MINUTE,
      activeSince: now,
    });
  });

  it('counts a running draft only up to savedAt, never the time away', () => {
    const draft = makeDraft({
      elapsedMs: 12 * MINUTE,
      activeSince: SAVED_AT - 3 * MINUTE,
      savedAt: SAVED_AT,
    });

    // 12 banked + 3 running until the save; the 10 minutes away don't count.
    expect(clockFromDraft(draft, now)).toEqual({
      elapsedMs: 15 * MINUTE,
      activeSince: now,
    });
  });

  it('never goes negative when activeSince is after savedAt', () => {
    const draft = makeDraft({
      elapsedMs: 0,
      activeSince: SAVED_AT + MINUTE,
      savedAt: SAVED_AT,
    });

    expect(clockFromDraft(draft, now)).toEqual({
      elapsedMs: 0,
      activeSince: now,
    });
  });
});

describe('saveDraft / loadDraft / clearDraft', () => {
  it('loads what was saved, stored under cooking-draft:{recipeId}', async () => {
    const draft = makeDraft();

    await saveDraft(draft);

    expect(await loadDraft('r1')).toEqual(draft);
    expect(await AsyncStorage.getItem('cooking-draft:r1')).toBe(
      JSON.stringify(draft),
    );
  });

  it('round-trips section headings as ordinary lines, keeping every index', async () => {
    const draft = makeDraft({
      ingredients: [
        { original: '# For the cake', text: '# For the cake' },
        { original: '2 cups flour', text: '2 cups flour' },
        { original: '# For the cream', text: '# For the whipped cream' },
        { original: '200 ml cream', text: null },
        { original: null, text: '# For the glaze' },
      ],
      instructions: [
        { original: '# For the cake', text: '# For the cake' },
        { original: 'Bake 30 min.', text: 'Bake 30 min.' },
      ],
      checkedIngredients: [1],
      checkedSteps: [1],
      timers: [
        { id: 'step-1', stepIndex: 1, label: 'Step 1', endsAt: SAVED_AT },
      ],
    });

    await saveDraft(draft);

    expect(await loadDraft('r1')).toEqual(draft);
  });

  it('loads null when there is no draft', async () => {
    expect(await loadDraft('r1')).toBeNull();
  });

  it('loads null after the draft is cleared', async () => {
    await saveDraft(makeDraft());

    await clearDraft('r1');

    expect(await loadDraft('r1')).toBeNull();
    expect(await AsyncStorage.getItem('cooking-draft:r1')).toBeNull();
  });

  it('keeps drafts of different recipes apart', async () => {
    const first = makeDraft({ recipeId: 'r1', notes: 'first' });
    const second = makeDraft({ recipeId: 'r2', notes: 'second' });

    await saveDraft(first);
    await saveDraft(second);

    expect(await loadDraft('r1')).toEqual(first);
    expect(await loadDraft('r2')).toEqual(second);

    await clearDraft('r1');

    expect(await loadDraft('r1')).toBeNull();
    expect(await loadDraft('r2')).toEqual(second);
  });
});
