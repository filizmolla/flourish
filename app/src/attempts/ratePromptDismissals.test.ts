import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  dismissAttempt,
  DISMISSED_KEY,
  loadDismissed,
  parseDismissed,
} from './ratePromptDismissals';

const stored = async () =>
  JSON.parse((await AsyncStorage.getItem(DISMISSED_KEY)) ?? 'null');

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('parseDismissed', () => {
  it('returns the stored ids in order', () => {
    expect(parseDismissed('["a2","a1"]')).toEqual(['a2', 'a1']);
  });

  it.each([
    ['null (nothing stored)', null],
    ['an empty string', ''],
    ['broken JSON', '["a1",'],
    ['JSON null', 'null'],
    ['an object', '{"a1":true}'],
    ['a plain string', '"a1"'],
    ['a number', '42'],
  ])('returns an empty list for %s', (_label, raw) => {
    expect(parseDismissed(raw)).toEqual([]);
  });

  it('drops entries that are not strings', () => {
    expect(parseDismissed('["a1",2,null,{"id":"x"},"a3"]')).toEqual([
      'a1',
      'a3',
    ]);
  });
});

describe('loadDismissed', () => {
  it('returns an empty list when nothing was dismissed', async () => {
    await expect(loadDismissed()).resolves.toEqual([]);
  });

  it('reads the ids saved under the dismissed key', async () => {
    await AsyncStorage.setItem(DISMISSED_KEY, '["a2","a1"]');
    await expect(loadDismissed()).resolves.toEqual(['a2', 'a1']);
  });

  it('survives a corrupt stored value', async () => {
    await AsyncStorage.setItem(DISMISSED_KEY, 'not json');
    await expect(loadDismissed()).resolves.toEqual([]);
  });
});

describe('dismissAttempt', () => {
  it('persists the first dismissed id', async () => {
    await expect(dismissAttempt('a1')).resolves.toEqual(['a1']);
    expect(await stored()).toEqual(['a1']);
    await expect(loadDismissed()).resolves.toEqual(['a1']);
  });

  it('puts the newest id first', async () => {
    await dismissAttempt('a1');
    await dismissAttempt('a2');

    expect(await stored()).toEqual(['a2', 'a1']);
  });

  it('moves an id dismissed again to the front instead of repeating it', async () => {
    await dismissAttempt('a1');
    await dismissAttempt('a2');
    await expect(dismissAttempt('a1')).resolves.toEqual(['a1', 'a2']);

    expect(await stored()).toEqual(['a1', 'a2']);
  });

  it('starts over from a corrupt stored value', async () => {
    await AsyncStorage.setItem(DISMISSED_KEY, '{broken');

    await dismissAttempt('a1');

    expect(await stored()).toEqual(['a1']);
  });

  it('keeps 20 ids at most, dropping the oldest', async () => {
    const existing = Array.from({ length: 20 }, (_, i) => `old-${i}`);
    await AsyncStorage.setItem(DISMISSED_KEY, JSON.stringify(existing));

    const next = await dismissAttempt('new');

    expect(next).toHaveLength(20);
    expect(next[0]).toBe('new');
    expect(next).toEqual(['new', ...existing.slice(0, 19)]);
    expect(next).not.toContain('old-19');
    expect(await stored()).toEqual(next);
  });

  it('keeps all 20 when re-dismissing an id already in a full list', async () => {
    const existing = Array.from({ length: 20 }, (_, i) => `old-${i}`);
    await AsyncStorage.setItem(DISMISSED_KEY, JSON.stringify(existing));

    const next = await dismissAttempt('old-19');

    expect(next).toEqual(['old-19', ...existing.slice(0, 19)]);
  });
});
