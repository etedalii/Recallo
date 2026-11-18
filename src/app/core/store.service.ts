import { Injectable, computed, inject, signal } from '@angular/core';
import { DbService } from './db.service';
import { previewRatings, schedule } from './fsrs';
import {
  Card,
  CardKind,
  CardMode,
  CardState,
  DEFAULT_SETTINGS,
  DailyCounters,
  Rating,
  ReviewLog,
  Settings,
} from './models';

/** Fields every sibling card of a note shares (everything except mode and scheduling). */
export type SharedNoteFields = Pick<
  Card,
  | 'deck'
  | 'kind'
  | 'word'
  | 'phonetic'
  | 'definition'
  | 'persian'
  | 'sentence'
  | 'persianSentence'
  | 'note'
  | 'synonyms'
  | 'antonyms'
  | 'collocations'
  | 'tags'
  | 'image'
  | 'imageCredit'
  | 'audioUrl'
  | 'audioBlob'
>;

export interface NewNoteInput extends SharedNoteFields {
  modes: CardMode[];
  /** Only used when `modes` includes Fix: the corrected sentence. */
  answer?: string;
}

function todayLocalIso(now = new Date()): string {
  const y = now.getFullYear();
  const m = (now.getMonth() + 1).toString().padStart(2, '0');
  const d = now.getDate().toString().padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function makeId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function newCardDefaults(now: Date): Pick<Card, 'state' | 'S' | 'D' | 'reps' | 'lapses' | 'due' | 'lastReview'> {
  return {
    state: CardState.New,
    S: 0,
    D: 0,
    reps: 0,
    lapses: 0,
    due: now.toISOString(),
    lastReview: '',
  };
}

/**
 * Signal-based application state: the full card list, settings, and
 * today's new/review counters. Every mutation goes through here so the UI
 * never talks to IndexedDB directly.
 */
@Injectable({ providedIn: 'root' })
export class StoreService {
  private readonly db = inject(DbService);

  readonly cards = signal<Card[]>([]);
  readonly settings = signal<Settings>({ ...DEFAULT_SETTINGS });
  readonly counters = signal<DailyCounters>({ date: todayLocalIso(), newShown: 0, reviewsShown: 0 });
  readonly loaded = signal(false);

  readonly decks = computed(() => {
    const names = new Set(this.cards().map((c) => c.deck).filter((d) => d.length > 0));
    return [...names].sort((a, b) => a.localeCompare(b));
  });

  readonly allTags = computed(() => {
    const tags = new Set<string>();
    for (const card of this.cards()) {
      for (const tag of card.tags) tags.add(tag);
    }
    return [...tags].sort((a, b) => a.localeCompare(b));
  });

  async init(): Promise<void> {
    const [cards, settings, counters] = await Promise.all([
      this.db.getAllCards(),
      this.db.getKv<Settings>('settings'),
      this.db.getKv<DailyCounters>('counters'),
    ]);
    this.cards.set(cards);
    this.settings.set({ ...DEFAULT_SETTINGS, ...settings });

    const today = todayLocalIso();
    if (counters && counters.date === today) {
      this.counters.set(counters);
    } else {
      const reset: DailyCounters = { date: today, newShown: 0, reviewsShown: 0 };
      this.counters.set(reset);
      await this.db.setKv('counters', reset);
    }
    this.loaded.set(true);
  }

  async saveSettings(partial: Partial<Settings>): Promise<void> {
    const next = { ...this.settings(), ...partial };
    this.settings.set(next);
    await this.db.setKv('settings', next);
  }

  /** Creates one Card per requested mode, all sharing a new noteId. */
  async addNote(input: NewNoteInput, now = new Date()): Promise<Card[]> {
    const noteId = makeId();
    const created = now.toISOString();
    const cards = input.modes.map((mode) => {
      const card: Card = {
        id: makeId(),
        noteId,
        deck: input.deck,
        mode,
        kind: input.kind,
        word: input.word,
        phonetic: input.phonetic,
        definition: input.definition,
        persian: input.persian,
        sentence: input.sentence,
        persianSentence: input.persianSentence,
        answer: mode === CardMode.Fix ? input.answer ?? '' : '',
        note: input.note,
        synonyms: input.synonyms,
        antonyms: input.antonyms,
        collocations: input.collocations,
        tags: input.tags,
        image: input.image,
        imageCredit: input.imageCredit,
        audioUrl: input.audioUrl,
        audioBlob: input.audioBlob,
        created,
        suspended: false,
        ...newCardDefaults(now),
      };
      return card;
    });

    await this.db.putCards(cards);
    this.cards.set([...this.cards(), ...cards]);
    return cards;
  }

  /**
   * Saves edits to one card. By default also copies the shared fields
   * (everything but mode and scheduling) onto its note siblings.
   */
  async updateCard(updated: Card, propagateToSiblings = true): Promise<void> {
    const all = this.cards();
    const siblings = propagateToSiblings ? all.filter((c) => c.noteId === updated.noteId && c.id !== updated.id) : [];

    const sharedFields: SharedNoteFields = {
      deck: updated.deck,
      kind: updated.kind,
      word: updated.word,
      phonetic: updated.phonetic,
      definition: updated.definition,
      persian: updated.persian,
      sentence: updated.sentence,
      persianSentence: updated.persianSentence,
      note: updated.note,
      synonyms: updated.synonyms,
      antonyms: updated.antonyms,
      collocations: updated.collocations,
      tags: updated.tags,
      image: updated.image,
      imageCredit: updated.imageCredit,
      audioUrl: updated.audioUrl,
      audioBlob: updated.audioBlob,
    };

    const updatedSiblings = siblings.map((s) => ({ ...s, ...sharedFields }));
    const toPersist = [updated, ...updatedSiblings];
    await this.db.putCards(toPersist);

    const byId = new Map(toPersist.map((c) => [c.id, c]));
    this.cards.set(all.map((c) => byId.get(c.id) ?? c));
  }

  async deleteCard(id: string): Promise<void> {
    await this.db.deleteCard(id);
    this.cards.set(this.cards().filter((c) => c.id !== id));
  }

  async setSuspended(id: string, suspended: boolean): Promise<void> {
    const card = this.cards().find((c) => c.id === id);
    if (!card) return;
    const updated = { ...card, suspended };
    await this.db.putCard(updated);
    this.cards.set(this.cards().map((c) => (c.id === id ? updated : c)));
  }

  /**
   * Today's new/review counters, as of `now` — resetting to zero (without
   * persisting) if the stored counters are from a previous day. The app
   * can sit open since before local midnight with no rating made yet, so
   * any read of `counters` that drives a daily limit or progress display
   * must go through this instead of the raw signal.
   */
  effectiveCounters(now: Date): DailyCounters {
    const today = todayLocalIso(now);
    const current = this.counters();
    return current.date === today ? current : { date: today, newShown: 0, reviewsShown: 0 };
  }

  /** Cards due for study right now, respecting deck filter and suspension. */
  dueCards(now: Date, deck?: string): Card[] {
    const nowMs = now.getTime();
    return this.cards().filter(
      (c) => !c.suspended && (!deck || c.deck === deck) && new Date(c.due).getTime() <= nowMs,
    );
  }

  newCardsWaiting(now: Date, deck?: string): Card[] {
    return this.dueCards(now, deck).filter((c) => c.state === CardState.New);
  }

  /** Cards flagged as "hard": difficulty >= 7 or 2+ lapses, ignoring due dates. */
  hardCards(deck?: string): Card[] {
    return this.cards()
      .filter((c) => !c.suspended && (!deck || c.deck === deck) && (c.D >= 7 || c.lapses >= 2))
      .sort((a, b) => b.lapses - a.lapses || b.D - a.D);
  }

  /**
   * Builds today's study queue: due learning/relearning cards always
   * included, plus new and review cards up to the daily limits.
   */
  buildStudyQueue(now: Date, deck?: string): Card[] {
    const settings = this.settings();
    const counters = this.effectiveCounters(now);
    const due = this.dueCards(now, deck);

    const learning = due.filter((c) => c.state === CardState.Learning || c.state === CardState.Relearning);
    const review = due.filter((c) => c.state === CardState.Review);
    const fresh = due.filter((c) => c.state === CardState.New);

    const newBudget = Math.max(0, settings.newCardsPerDay - counters.newShown);
    const reviewBudget = Math.max(0, settings.reviewsPerDay - counters.reviewsShown);

    return [...learning, ...review.slice(0, reviewBudget), ...fresh.slice(0, newBudget)];
  }

  previewForCard(card: Card, now: Date) {
    return previewRatings(card, now, { desiredRetention: this.settings().desiredRetention });
  }

  /** Applies a rating: schedules the card, logs the review, and bumps today's counters. */
  async rateCard(card: Card, rating: Rating, startedAt: number, now = new Date()): Promise<Card> {
    const wasNew = card.state === CardState.New;
    const wasReview = card.state === CardState.Review;
    const result = schedule(card, rating, now, { desiredRetention: this.settings().desiredRetention });
    const updated: Card = { ...card, ...result };

    await this.db.putCard(updated);
    this.cards.set(this.cards().map((c) => (c.id === updated.id ? updated : c)));

    const log: ReviewLog = {
      rid: `${now.getTime()}:${card.id}`,
      t: now.getTime(),
      cardId: card.id,
      deck: card.deck,
      rating,
      prevState: card.state,
      ms: Math.max(0, now.getTime() - startedAt),
      correct: rating !== Rating.Again,
    };
    await this.db.putReview(log);

    const today = todayLocalIso(now);
    const base = this.effectiveCounters(now);
    const next: DailyCounters = {
      date: today,
      newShown: base.newShown + (wasNew ? 1 : 0),
      reviewsShown: base.reviewsShown + (wasReview ? 1 : 0),
    };
    this.counters.set(next);
    await this.db.setKv('counters', next);

    return updated;
  }

  async importCards(cards: Card[]): Promise<void> {
    await this.db.putCards(cards);
    const byId = new Map(this.cards().map((c) => [c.id, c]));
    for (const card of cards) byId.set(card.id, card);
    this.cards.set([...byId.values()]);
  }

  async replaceAll(cards: Card[], reviews: ReviewLog[]): Promise<void> {
    await this.db.putCards(cards);
    await this.db.putReviews(reviews);
    this.cards.set(cards);
  }
}

export function defaultCardKindFromTags(tags: string[]): CardKind {
  if (tags.includes(CardKind.PhrasalVerb)) return CardKind.PhrasalVerb;
  if (tags.includes(CardKind.Idiom)) return CardKind.Idiom;
  if (tags.includes(CardKind.Phrase)) return CardKind.Phrase;
  return CardKind.Word;
}
