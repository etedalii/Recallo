import { Injectable, inject } from '@angular/core';
import { DbService } from './db.service';
import {
  BackupFile,
  Card,
  DEFAULT_SETTINGS,
  LastBackupInfo,
  ReviewLog,
  SerializedCard,
  Settings,
} from './models';

export const BACKUP_APP_ID = 'recallo';
export const BACKUP_VERSION = 1;

export interface BackupPreview {
  cardCount: number;
  reviewCount: number;
  exportedAt: string;
}

export type RestoreResult =
  | { ok: true; cardCount: number; reviewCount: number }
  | { ok: false; reason: string };

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

// Fallback only: used if an older backup file has no stored MIME type.
const FALLBACK_AUDIO_MIME = 'audio/mpeg';

export async function serializeCard(card: Card): Promise<SerializedCard> {
  const { audioBlob, ...rest } = card;
  return {
    ...rest,
    audioBlobBase64: audioBlob ? await blobToBase64(audioBlob) : null,
    audioBlobMimeType: audioBlob ? audioBlob.type || FALLBACK_AUDIO_MIME : null,
  };
}

export function deserializeCard(card: SerializedCard): Card {
  const { audioBlobBase64, audioBlobMimeType, ...rest } = card;
  return {
    ...rest,
    audioBlob: audioBlobBase64 ? base64ToBlob(audioBlobBase64, audioBlobMimeType || FALLBACK_AUDIO_MIME) : null,
  };
}

/**
 * Pure merge of two card lists by `id`, keeping whichever side has the
 * newer `lastReview`. Extracted from BackupService so it can be unit
 * tested without touching IndexedDB.
 */
export function mergeCardLists(existingCards: Card[], incomingCards: Card[]): Card[] {
  const existingById = new Map(existingCards.map((c) => [c.id, c]));
  const merged: Card[] = [];
  for (const incoming of incomingCards) {
    const existing = existingById.get(incoming.id);
    if (!existing) {
      merged.push(incoming);
      continue;
    }
    const incomingNewer = (incoming.lastReview || '') > (existing.lastReview || '');
    merged.push(incomingNewer ? incoming : existing);
    existingById.delete(incoming.id);
  }
  // Keep cards that were not part of the incoming file at all.
  merged.push(...existingById.values());
  return merged;
}

/** Pure merge of two review-log lists by `rid` (incoming overwrites on a duplicate). */
export function mergeReviewLists(existingReviews: ReviewLog[], incomingReviews: ReviewLog[]): ReviewLog[] {
  const byRid = new Map(existingReviews.map((r) => [r.rid, r]));
  for (const review of incomingReviews) {
    byRid.set(review.rid, review);
  }
  return [...byRid.values()];
}

export function backupFileName(date = new Date()): string {
  const iso = date.toISOString().slice(0, 10);
  return `recallo-backup-${iso}.json`;
}

/** Parses and sanity-checks a backup file's JSON text. Pure, no DI needed. */
export function parseBackupText(text: string): { ok: true; file: BackupFile } | { ok: false; reason: string } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'This file is not valid JSON.' };
  }
  if (
    typeof data !== 'object' ||
    data === null ||
    (data as Partial<BackupFile>).app !== BACKUP_APP_ID ||
    !Array.isArray((data as Partial<BackupFile>).cards) ||
    !Array.isArray((data as Partial<BackupFile>).reviews)
  ) {
    return { ok: false, reason: 'This file is not a Recallo backup.' };
  }
  return { ok: true, file: data as BackupFile };
}

export function previewBackup(file: BackupFile): BackupPreview {
  return {
    cardCount: file.cards.length,
    reviewCount: file.reviews.length,
    exportedAt: file.exportedAt,
  };
}

/**
 * Builds, validates, previews and restores the JSON backup file. Also keeps
 * track of when the last successful backup happened, in the `kv` store.
 */
@Injectable({ providedIn: 'root' })
export class BackupService {
  private readonly db = inject(DbService);

  async buildBackup(settings: Settings): Promise<BackupFile> {
    const cards = await this.db.getAllCards();
    const reviews = await this.db.getAllReviews();
    const serialized = await Promise.all(cards.map(serializeCard));
    return {
      app: BACKUP_APP_ID,
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      cards: serialized,
      reviews,
      settings,
    };
  }

  /**
   * Merges a backup file into the current database. Cards are merged by
   * `id`, keeping whichever has the newer `lastReview`. Reviews are merged
   * by `rid` (duplicates overwrite, since they carry the same content).
   */
  async restoreMerge(file: BackupFile): Promise<RestoreResult> {
    const existingCards = await this.db.getAllCards();
    const incomingCards = file.cards.map(deserializeCard);
    const merged = mergeCardLists(existingCards, incomingCards);
    await this.db.putCards(merged);

    const existingReviews = await this.db.getAllReviews();
    const mergedReviews = mergeReviewLists(existingReviews, file.reviews);
    await this.db.putReviews(mergedReviews);

    return { ok: true, cardCount: merged.length, reviewCount: mergedReviews.length };
  }

  async getLastBackup(): Promise<LastBackupInfo | undefined> {
    return this.db.getKv<LastBackupInfo>('lastBackup');
  }

  async recordBackup(cardCount: number, date = new Date()): Promise<void> {
    await this.db.setKv<LastBackupInfo>('lastBackup', { date: date.toISOString(), cardCount });
  }

  async getBannerSnoozeUntil(): Promise<string | undefined> {
    return this.db.getKv<string>('backupBannerSnoozeUntil');
  }

  async snoozeBanner(days: number, now = new Date()): Promise<void> {
    const until = new Date(now.getTime() + days * 86_400_000);
    await this.db.setKv<string>('backupBannerSnoozeUntil', until.toISOString());
  }

  defaultSettings(): Settings {
    return { ...DEFAULT_SETTINGS };
  }
}

/**
 * Pure rule deciding whether to show the "back up your cards" banner.
 * Kept standalone (no DI) so it is easy to unit test.
 */
export function shouldShowBackupReminder(
  cardCount: number,
  lastBackup: LastBackupInfo | undefined,
  snoozeUntil: string | undefined,
  now: Date,
): boolean {
  if (cardCount < 5) return false;
  if (snoozeUntil && new Date(snoozeUntil).getTime() > now.getTime()) return false;
  if (!lastBackup) return true;
  const ageDays = (now.getTime() - new Date(lastBackup.date).getTime()) / 86_400_000;
  return ageDays > 7;
}
