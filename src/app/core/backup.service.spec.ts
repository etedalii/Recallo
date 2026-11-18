import { describe, expect, it } from 'vitest';
import {
  deserializeCard,
  mergeCardLists,
  mergeReviewLists,
  parseBackupText,
  serializeCard,
  shouldShowBackupReminder,
} from './backup.service';
import { BackupFile, Card, CardKind, CardMode, CardState, DEFAULT_SETTINGS, Rating } from './models';

function makeCard(overrides: Partial<Card> = {}): Card {
  return {
    id: 'c1',
    noteId: 'n1',
    deck: 'Default',
    mode: CardMode.Flip,
    kind: CardKind.Word,
    word: 'apple',
    phonetic: '',
    definition: 'a fruit',
    persian: '',
    sentence: '',
    persianSentence: '',
    answer: '',
    note: '',
    synonyms: [],
    antonyms: [],
    collocations: [],
    tags: [],
    image: null,
    imageCredit: null,
    audioUrl: null,
    audioBlob: null,
    created: new Date().toISOString(),
    suspended: false,
    state: CardState.New,
    S: 0,
    D: 0,
    reps: 0,
    lapses: 0,
    due: new Date().toISOString(),
    lastReview: '',
    ...overrides,
  };
}

describe('serializeCard / deserializeCard', () => {
  it('round-trips a card with no audio and no picture', async () => {
    const card = makeCard();
    const serialized = await serializeCard(card);
    const restored = deserializeCard(serialized);
    expect(restored).toEqual(card);
  });

  it('round-trips a card with a picture (data URL)', async () => {
    const card = makeCard({ image: 'data:image/jpeg;base64,abc123', imageCredit: { title: 't', author: 'a', licence: 'l', sourceUrl: 's' } });
    const serialized = await serializeCard(card);
    const restored = deserializeCard(serialized);
    expect(restored.image).toBe(card.image);
    expect(restored.imageCredit).toEqual(card.imageCredit);
  });

  it('round-trips a card with a recorded audio Blob, including its real MIME type', async () => {
    // Dictionary pronunciation downloads are MP3s, not webm — the restored
    // Blob must keep that real type or audio playback can fail on Safari.
    const bytes = new Uint8Array([1, 2, 3, 4, 250, 251]);
    const blob = new Blob([bytes], { type: 'audio/mpeg' });
    const card = makeCard({ audioBlob: blob });
    const serialized = await serializeCard(card);
    expect(serialized.audioBlobBase64).toBeTruthy();
    expect(serialized.audioBlobMimeType).toBe('audio/mpeg');
    const restored = deserializeCard(serialized);
    expect(restored.audioBlob).not.toBeNull();
    expect(restored.audioBlob!.type).toBe('audio/mpeg');
    const restoredBytes = new Uint8Array(await restored.audioBlob!.arrayBuffer());
    expect([...restoredBytes]).toEqual([...bytes]);
  });
});

describe('parseBackupText', () => {
  it('accepts a well-formed backup file', () => {
    const file: BackupFile = {
      app: 'recallo',
      version: 1,
      exportedAt: new Date().toISOString(),
      cards: [],
      reviews: [],
      settings: { ...DEFAULT_SETTINGS },
    };
    const result = parseBackupText(JSON.stringify(file));
    expect(result.ok).toBe(true);
  });

  it('rejects broken JSON', () => {
    const result = parseBackupText('{not json');
    expect(result.ok).toBe(false);
  });

  it('rejects a file with the wrong app value', () => {
    const result = parseBackupText(JSON.stringify({ app: 'some-other-app', cards: [] }));
    expect(result.ok).toBe(false);
  });

  it('rejects a file with cards but a missing or malformed reviews array', () => {
    expect(parseBackupText(JSON.stringify({ app: 'recallo', cards: [] })).ok).toBe(false);
    expect(parseBackupText(JSON.stringify({ app: 'recallo', cards: [], reviews: null })).ok).toBe(false);
  });
});

describe('mergeCardLists', () => {
  it('keeps the card with the newer lastReview', () => {
    const older = makeCard({ id: 'c1', lastReview: '2024-01-01T00:00:00.000Z', word: 'old-version' });
    const newer = makeCard({ id: 'c1', lastReview: '2024-06-01T00:00:00.000Z', word: 'new-version' });
    expect(mergeCardLists([older], [newer])[0].word).toBe('new-version');
    expect(mergeCardLists([newer], [older])[0].word).toBe('new-version');
  });

  it('keeps cards that only exist on one side', () => {
    const a = makeCard({ id: 'a' });
    const b = makeCard({ id: 'b' });
    const merged = mergeCardLists([a], [b]);
    expect(merged.map((c) => c.id).sort()).toEqual(['a', 'b']);
  });
});

describe('mergeReviewLists', () => {
  it('merges by rid without duplicating', () => {
    const a = { rid: 'r1', t: 1, cardId: 'c1', deck: 'd', rating: Rating.Good, prevState: CardState.New, ms: 100, correct: true };
    const b = { rid: 'r2', t: 2, cardId: 'c1', deck: 'd', rating: Rating.Hard, prevState: CardState.New, ms: 100, correct: false };
    const merged = mergeReviewLists([a], [b]);
    expect(merged.map((r) => r.rid).sort()).toEqual(['r1', 'r2']);
  });
});

describe('shouldShowBackupReminder', () => {
  const now = new Date('2024-06-15T00:00:00.000Z');

  it('is hidden with fewer than 5 cards', () => {
    expect(shouldShowBackupReminder(4, undefined, undefined, now)).toBe(false);
  });

  it('shows for 5+ cards with no backup', () => {
    expect(shouldShowBackupReminder(5, undefined, undefined, now)).toBe(true);
  });

  it('shows when the last backup is older than 7 days', () => {
    const lastBackup = { date: new Date('2024-06-01T00:00:00.000Z').toISOString(), cardCount: 10 };
    expect(shouldShowBackupReminder(10, lastBackup, undefined, now)).toBe(true);
  });

  it('is hidden within 7 days of the last backup', () => {
    const lastBackup = { date: new Date('2024-06-10T00:00:00.000Z').toISOString(), cardCount: 10 };
    expect(shouldShowBackupReminder(10, lastBackup, undefined, now)).toBe(false);
  });

  it('is hidden for 2 days after "Later" is tapped', () => {
    const snoozeUntil = new Date('2024-06-16T00:00:00.000Z').toISOString();
    expect(shouldShowBackupReminder(10, undefined, snoozeUntil, now)).toBe(false);
  });
});
