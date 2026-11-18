// FSRS-5 scheduler. Pure functions only, no Angular imports, so this file
// can be unit-tested and reused anywhere.
//
// Spec reference: https://github.com/open-spaced-repetition/fsrs4anki (v5 weights).

import { Card, CardState, Rating } from './models';

/** Default FSRS-5 weights, w[0..18]. */
export const DEFAULT_WEIGHTS: readonly number[] = [
  0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575,
  0.1192, 1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898, 0.51655,
  0.6621,
];

/** -0.5, the exponent used by the power-law forgetting curve. */
export const DECAY = -0.5;
/** 19/81, the scaling factor paired with DECAY. */
export const FACTOR = 19 / 81;

const MIN_INTERVAL_DAYS = 1;
const MAX_INTERVAL_DAYS = 3650;

/** Learning/relearning step lengths, in minutes. */
const LEARNING_STEPS_MIN = [1, 5, 10];
const RELEARNING_AGAIN_MIN = 5;
const RELEARNING_HARD_MIN = 5;

export interface FsrsOptions {
  weights?: readonly number[];
  desiredRetention: number;
}

/** The scheduling fields of a Card, nothing else. */
export interface SchedulingState {
  state: CardState;
  S: number;
  D: number;
  reps: number;
  lapses: number;
  due: string;
  lastReview: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Retrievability after `t` days, given stability `S`. */
export function retrievability(t: number, S: number): number {
  if (S <= 0) {
    return 0;
  }
  return Math.pow(1 + (FACTOR * t) / S, DECAY);
}

/** Interval (in whole days, clamped) that reaches `retention` for stability `S`. */
export function intervalForRetention(S: number, retention: number): number {
  const raw = (S / FACTOR) * (Math.pow(retention, 1 / DECAY) - 1);
  return clamp(Math.round(raw), MIN_INTERVAL_DAYS, MAX_INTERVAL_DAYS);
}

function initialStability(w: readonly number[], rating: Rating): number {
  return Math.max(w[rating - 1], 0.1);
}

function initialDifficulty(w: readonly number[], rating: Rating): number {
  const d = w[4] - Math.exp(w[5] * (rating - 1)) + 1;
  return clamp(d, 1, 10);
}

function nextDifficulty(w: readonly number[], D: number, rating: Rating): number {
  const deltaD = -w[6] * (rating - 3);
  const dPrime = D + deltaD * ((10 - D) / 9);
  const d0Four = initialDifficulty(w, Rating.Easy);
  const dDoublePrime = w[7] * d0Four + (1 - w[7]) * dPrime;
  return clamp(dDoublePrime, 1, 10);
}

function stabilityAfterSuccess(
  w: readonly number[],
  S: number,
  D: number,
  R: number,
  rating: Rating.Hard | Rating.Good | Rating.Easy,
): number {
  const hardPenalty = rating === Rating.Hard ? w[15] : 1;
  const easyBonus = rating === Rating.Easy ? w[16] : 1;
  const factor =
    Math.exp(w[8]) *
    (11 - D) *
    Math.pow(S, -w[9]) *
    (Math.exp(w[10] * (1 - R)) - 1) *
    hardPenalty *
    easyBonus;
  return S * (1 + factor);
}

function stabilityAfterForgetting(w: readonly number[], S: number, D: number, R: number): number {
  const forgotten = w[11] * Math.pow(D, -w[12]) * (Math.pow(S + 1, w[13]) - 1) * Math.exp(w[14] * (1 - R));
  return Math.min(S, forgotten);
}

function sameDayStability(w: readonly number[], S: number, rating: Rating): number {
  return S * Math.exp(w[17] * (rating - 3 + w[18]));
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

/** Due date for a card graduating into Review state, at local midnight. */
function dueAtMidnightInDays(now: Date, days: number): string {
  const midnightToday = startOfLocalDay(now);
  return addDays(midnightToday, days).toISOString();
}

/**
 * Apply one FSRS-5 review. Returns a NEW scheduling state and never
 * mutates `card`.
 */
export function schedule(card: Card, rating: Rating, now: Date, options: FsrsOptions): SchedulingState {
  const w = options.weights ?? DEFAULT_WEIGHTS;
  const retention = options.desiredRetention;
  const reps = card.reps + 1;
  const lapses = card.lapses + (card.state === CardState.Review && rating === Rating.Again ? 1 : 0);

  if (card.state === CardState.New) {
    const S = initialStability(w, rating);
    const D = initialDifficulty(w, rating);
    return gradeNewOrLearning(card, rating, now, S, D, reps, lapses, retention);
  }

  if (card.state === CardState.Learning || card.state === CardState.Relearning) {
    // Same-day (short-term) stability update: applies to every rating while
    // the card is still in Learning/Relearning, per the FSRS-5 spec.
    const raw = sameDayStability(w, card.S, rating);
    const S = rating >= Rating.Good ? Math.max(raw, card.S) : raw;
    const D = nextDifficulty(w, card.D, rating);
    return gradeNewOrLearning(card, rating, now, S, D, reps, lapses, retention);
  }

  // Review state.
  const elapsedDays = card.lastReview
    ? Math.max(0, (startOfLocalDay(now).getTime() - startOfLocalDay(new Date(card.lastReview)).getTime()) / 86_400_000)
    : 0;
  const R = retrievability(elapsedDays, card.S);
  const D = nextDifficulty(w, card.D, rating);

  if (rating === Rating.Again) {
    const S = stabilityAfterForgetting(w, card.S, card.D, R);
    return {
      state: CardState.Relearning,
      S,
      D,
      reps,
      lapses,
      due: addMinutes(now, RELEARNING_AGAIN_MIN).toISOString(),
      lastReview: now.toISOString(),
    };
  }

  const S = stabilityAfterSuccess(w, card.S, card.D, R, rating);
  const days = intervalForRetention(S, retention);
  return {
    state: CardState.Review,
    S,
    D,
    reps,
    lapses,
    due: dueAtMidnightInDays(now, days),
    lastReview: now.toISOString(),
  };
}

/** Shared handling for New/Learning/Relearning cards (the "pre-graduation" steps). */
function gradeNewOrLearning(
  card: Card,
  rating: Rating,
  now: Date,
  S: number,
  D: number,
  reps: number,
  lapses: number,
  retention: number,
): SchedulingState {
  if (rating === Rating.Again) {
    return {
      state: CardState.Learning,
      S,
      D,
      reps,
      lapses,
      due: addMinutes(now, LEARNING_STEPS_MIN[0]).toISOString(),
      lastReview: now.toISOString(),
    };
  }
  if (rating === Rating.Hard) {
    return {
      state: CardState.Learning,
      S,
      D,
      reps,
      lapses,
      due: addMinutes(now, LEARNING_STEPS_MIN[1]).toISOString(),
      lastReview: now.toISOString(),
    };
  }
  if (rating === Rating.Good) {
    return {
      state: CardState.Learning,
      S,
      D,
      reps,
      lapses,
      due: addMinutes(now, LEARNING_STEPS_MIN[2]).toISOString(),
      lastReview: now.toISOString(),
    };
  }
  // Easy graduates straight to Review, at least 4 days out.
  const days = Math.max(4, intervalForRetention(S, retention));
  return {
    state: CardState.Review,
    S,
    D,
    reps,
    lapses,
    due: dueAtMidnightInDays(now, days),
    lastReview: now.toISOString(),
  };
}

/** Human-friendly "next interval" label used on the four rating buttons. */
export function formatInterval(due: string, now: Date): string {
  const diffMs = new Date(due).getTime() - now.getTime();
  const minutes = diffMs / 60_000;
  if (minutes < 60) {
    return `${Math.max(1, Math.round(minutes))}m`;
  }
  const hours = minutes / 60;
  if (hours < 24) {
    return `${Math.round(hours)}h`;
  }
  const days = hours / 24;
  if (days < 30) {
    return `${Math.round(days)}d`;
  }
  const months = days / 30;
  if (months < 12) {
    return `${Math.round(months)}mo`;
  }
  const years = days / 365;
  return `${years.toFixed(1)}y`;
}

export interface RatingPreview {
  rating: Rating;
  due: string;
  label: string;
}

/**
 * Preview what each of the 4 ratings would do, without mutating the card.
 * Also enforces "Hard < Good < Easy" by nudging ties forward by a day.
 */
export function previewRatings(card: Card, now: Date, options: FsrsOptions): RatingPreview[] {
  const previews = [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy].map((rating) => {
    const result = schedule(card, rating, now, options);
    return { rating, due: result.due, state: result.state };
  });

  // Keep Hard < Good < Easy by at least a day once in Review state. Walk
  // forward (Hard -> Good -> Easy) so each nudge carries into the next.
  for (let i = 1; i <= 2; i++) {
    const current = previews[i];
    const next = previews[i + 1];
    if (!next) continue;
    const currentDate = new Date(current.due);
    const nextDate = new Date(next.due);
    const minNext = addDays(currentDate, 1);
    if (nextDate.getTime() < minNext.getTime() && current.state === CardState.Review && next.state === CardState.Review) {
      previews[i + 1] = { ...next, due: minNext.toISOString() };
    }
  }

  return previews.map((p) => ({ rating: p.rating, due: p.due, label: formatInterval(p.due, now) }));
}
