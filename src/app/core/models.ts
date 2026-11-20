// Data model for Recallo. Kept as plain interfaces/enums with no Angular
// imports so this file can be used from pure logic (fsrs.ts, csv.ts, tests)
// without pulling in the framework.

/** FSRS card state. */
export enum CardState {
  New = 'new',
  Learning = 'learning',
  Review = 'review',
  Relearning = 'relearning',
}

/** The four review ratings, matching the FSRS grade numbers 1-4. */
export enum Rating {
  Again = 1,
  Hard = 2,
  Good = 3,
  Easy = 4,
}

/** How a card is shown and answered during study. */
export enum CardMode {
  /** Word + audio on the front, tap to reveal the full answer. */
  Flip = 'flip',
  /** Definition on the front, user types the word. */
  Type = 'type',
  /** Sentence with a blank, user types the missing word. */
  Cloze = 'cloze',
  /** Audio of the sentence, user types what they hear. */
  Listen = 'listen',
  /** A saved mistake: wrong sentence on front, user types the fix. */
  Fix = 'fix',
  /** Second-language meaning on the front, user types the English word. */
  Persian = 'persian',
}

/** What kind of English item the card teaches. Stored as a tag too. */
export enum CardKind {
  Word = 'word',
  PhrasalVerb = 'phrasal_verb',
  Idiom = 'idiom',
  Phrase = 'phrase',
}

/** Credit for a picture pulled from a free image source. */
export interface ImageCredit {
  title: string;
  author: string;
  licence: string;
  sourceUrl: string;
}

/** One flashcard. Several modes can share the same noteId and content. */
export interface Card {
  id: string;
  noteId: string;
  deck: string;
  mode: CardMode;
  kind: CardKind;
  word: string;
  phonetic: string;
  definition: string;
  /** Meaning in the second language (field name kept for CSV/backup compatibility). */
  persian: string;
  sentence: string;
  /** Translated example sentence, in the same second language as `persian`. */
  persianSentence: string;
  /** Only used by Fix cards: the corrected sentence the user must type. */
  answer: string;
  note: string;
  synonyms: string[];
  antonyms: string[];
  collocations: string[];
  tags: string[];
  /** JPEG data URL, resized to at most 640px on the longest side. */
  image: string | null;
  imageCredit: ImageCredit | null;
  /** Real dictionary pronunciation audio, if one was found online. */
  audioUrl: string | null;
  /** The same audio downloaded once, so it plays offline. */
  audioBlob: Blob | null;
  created: string;
  suspended: boolean;

  // FSRS scheduling fields
  state: CardState;
  /** Stability, in days. */
  S: number;
  /** Difficulty, 1-10. */
  D: number;
  reps: number;
  lapses: number;
  /** ISO date-time the card is next due. */
  due: string;
  /** ISO date-time of the last review, or '' if never reviewed. */
  lastReview: string;
}

/** One row written every time a card is answered. */
export interface ReviewLog {
  /** `${t}:${cardId}`, unique and sortable by time. */
  rid: string;
  /** Epoch milliseconds when the review happened. */
  t: number;
  cardId: string;
  deck: string;
  rating: Rating;
  prevState: CardState;
  /** How long the user took to answer, in milliseconds. */
  ms: number;
  correct: boolean;
}

/** How a second-language meaning is shown while studying. */
export enum PersianDisplay {
  Off = 'off',
  OnAnswer = 'on_answer',
  OnAnswerAndHint = 'on_answer_and_hint',
}

/** Light/dark theme preference. */
export enum ThemePreference {
  System = 'system',
  Light = 'light',
  Dark = 'dark',
}

/** User-editable app settings, persisted as one row in the `kv` store. */
export interface Settings {
  newCardsPerDay: number;
  reviewsPerDay: number;
  desiredRetention: number;
  theme: ThemePreference;
  /** ISO 639-1 code of the language being studied (the word on the front of a card). Drives Lookup, pronunciation and audio. */
  studyLanguageCode: string;
  /** Whether translation into a second language is used at all. */
  secondLanguageEnabled: boolean;
  /** ISO 639-1 code of the second language (see core/languages.ts). */
  secondLanguageCode: string;
  persianDisplay: PersianDisplay;
  showPictureOnFront: boolean;
  voiceName: string | null;
  speechRate: number;
  autoPlayOnAnswer: boolean;
  dailyGoal: number;
  reminderHour: number;
  reminderMinute: number;
}

export const DEFAULT_SETTINGS: Settings = {
  newCardsPerDay: 10,
  reviewsPerDay: 100,
  desiredRetention: 0.9,
  theme: ThemePreference.System,
  studyLanguageCode: 'en',
  secondLanguageEnabled: true,
  secondLanguageCode: 'fa',
  persianDisplay: PersianDisplay.OnAnswer,
  showPictureOnFront: true,
  voiceName: null,
  speechRate: 1,
  autoPlayOnAnswer: false,
  dailyGoal: 20,
  reminderHour: 20,
  reminderMinute: 0,
};

/** Today's new/review counters, kept in the `kv` store and reset at midnight. */
export interface DailyCounters {
  /** Local date string 'YYYY-MM-DD' these counters apply to. */
  date: string;
  newShown: number;
  reviewsShown: number;
}

/** Last successful backup, kept in the `kv` store. */
export interface LastBackupInfo {
  date: string;
  cardCount: number;
}

/** A free picture search result, normalised across every source. */
export interface PictureResult {
  thumbUrl: string;
  fullUrl: string;
  credit: ImageCredit;
}

/** One dictionary definition the user can tap to fill the card form. */
export interface DictionaryDefinition {
  partOfSpeech: string;
  definition: string;
  example: string;
  synonyms: string[];
  antonyms: string[];
}

/** Result of a dictionaryapi.dev lookup, flattened for the UI. */
export interface DictionaryLookupResult {
  phonetic: string;
  audioUrl: string | null;
  definitions: DictionaryDefinition[];
}

/** One Persian translation choice from MyMemory. */
export interface TranslationChoice {
  text: string;
  quality: number;
}

/** The full contents of a backup JSON file. */
export interface BackupFile {
  app: 'recallo';
  version: 1;
  exportedAt: string;
  cards: SerializedCard[];
  reviews: ReviewLog[];
  settings: Settings;
}

/** A Card with its audioBlob base64-encoded, for JSON export. */
export interface SerializedCard extends Omit<Card, 'audioBlob'> {
  audioBlobBase64: string | null;
  /** The Blob's real MIME type (e.g. "audio/mpeg"), so it decodes back correctly. */
  audioBlobMimeType: string | null;
}
