import { describe, expect, it } from 'vitest';
import { DEFAULT_WEIGHTS, intervalForRetention, previewRatings, retrievability, schedule } from './fsrs';
import { Card, CardKind, CardMode, CardState, Rating } from './models';

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

const OPTIONS = { desiredRetention: 0.9 };

describe('retrievability / intervalForRetention', () => {
  it('is close to the desired retention when elapsed days equal the interval', () => {
    const S = 20;
    const retention = 0.9;
    const interval = intervalForRetention(S, retention);
    const r = retrievability(interval, S);
    expect(r).toBeCloseTo(retention, 1);
  });
});

describe('schedule', () => {
  it('does not mutate its input', () => {
    const card = makeCard();
    const snapshot = JSON.stringify(card);
    schedule(card, Rating.Good, new Date(), OPTIONS);
    expect(JSON.stringify(card)).toBe(snapshot);
  });

  it('sends a new card rated Good into Learning', () => {
    const card = makeCard({ state: CardState.New });
    const result = schedule(card, Rating.Good, new Date(), OPTIONS);
    expect(result.state).toBe(CardState.Learning);
  });

  it('graduates a new card rated Easy straight to Review, at least 4 days out', () => {
    const now = new Date('2024-01-01T00:00:00Z');
    const card = makeCard({ state: CardState.New });
    const result = schedule(card, Rating.Easy, now, OPTIONS);
    expect(result.state).toBe(CardState.Review);
    const days = (new Date(result.due).getTime() - now.getTime()) / 86_400_000;
    expect(days).toBeGreaterThanOrEqual(4);
  });

  it('uses the configured desired retention, not a hardcoded value, when graduating on Easy', () => {
    const now = new Date('2024-01-01T00:00:00Z');
    const card = makeCard({ state: CardState.New });
    const lowRetention = schedule(card, Rating.Easy, now, { desiredRetention: 0.8 });
    const highRetention = schedule(card, Rating.Easy, now, { desiredRetention: 0.95 });
    // Lower desired retention means longer intervals are acceptable.
    expect(new Date(lowRetention.due).getTime()).toBeGreaterThan(new Date(highRetention.due).getTime());
  });

  it('orders the previewed intervals Hard < Good < Easy for a mature review card', () => {
    const now = new Date('2024-06-01T00:00:00Z');
    const card = makeCard({
      state: CardState.Review,
      S: 20,
      D: 5,
      lastReview: new Date('2024-05-20T00:00:00Z').toISOString(),
      due: now.toISOString(),
    });
    const [, hard, good, easy] = previewRatings(card, now, OPTIONS);
    expect(new Date(hard.due).getTime()).toBeLessThan(new Date(good.due).getTime());
    expect(new Date(good.due).getTime()).toBeLessThan(new Date(easy.due).getTime());
  });

  it('lowers stability and increases the lapse count on a lapse', () => {
    const now = new Date('2024-06-01T00:00:00Z');
    const card = makeCard({
      state: CardState.Review,
      S: 20,
      D: 5,
      lapses: 0,
      lastReview: new Date('2024-05-01T00:00:00Z').toISOString(),
      due: now.toISOString(),
    });
    const result = schedule(card, Rating.Again, now, OPTIONS);
    expect(result.state).toBe(CardState.Relearning);
    expect(result.S).toBeLessThan(card.S);
    expect(result.lapses).toBe(1);
  });

  it('uses the default FSRS-5 weights', () => {
    expect(DEFAULT_WEIGHTS.length).toBe(19);
    expect(DEFAULT_WEIGHTS[0]).toBeCloseTo(0.40255, 5);
  });
});
