import { Injectable } from '@angular/core';
import { DBSchema, IDBPDatabase, openDB } from 'idb';
import { Card, ReviewLog } from './models';

const DB_NAME = 'recallo';
const DB_VERSION = 1;

interface RecalloDb extends DBSchema {
  cards: {
    key: string;
    value: Card;
    indexes: { noteId: string; deck: string; due: string };
  };
  reviews: {
    key: string;
    value: ReviewLog;
    indexes: { cardId: string; t: number };
  };
  kv: {
    key: string;
    value: unknown;
  };
}

/**
 * Thin wrapper around IndexedDB (via the `idb` helper). This is the only
 * place in the app that talks to IndexedDB directly.
 */
@Injectable({ providedIn: 'root' })
export class DbService {
  private dbPromise: Promise<IDBPDatabase<RecalloDb>> | null = null;

  private db(): Promise<IDBPDatabase<RecalloDb>> {
    if (!this.dbPromise) {
      this.dbPromise = openDB<RecalloDb>(DB_NAME, DB_VERSION, {
        upgrade(db) {
          const cards = db.createObjectStore('cards', { keyPath: 'id' });
          cards.createIndex('noteId', 'noteId');
          cards.createIndex('deck', 'deck');
          cards.createIndex('due', 'due');

          const reviews = db.createObjectStore('reviews', { keyPath: 'rid' });
          reviews.createIndex('cardId', 'cardId');
          reviews.createIndex('t', 't');

          db.createObjectStore('kv');
        },
      });
    }
    return this.dbPromise;
  }

  async getAllCards(): Promise<Card[]> {
    return (await this.db()).getAll('cards');
  }

  async getCard(id: string): Promise<Card | undefined> {
    return (await this.db()).get('cards', id);
  }

  async putCard(card: Card): Promise<void> {
    await (await this.db()).put('cards', card);
  }

  async putCards(cards: Card[]): Promise<void> {
    const db = await this.db();
    const tx = db.transaction('cards', 'readwrite');
    await Promise.all([...cards.map((c) => tx.store.put(c)), tx.done]);
  }

  async deleteCard(id: string): Promise<void> {
    await (await this.db()).delete('cards', id);
  }

  async getAllReviews(): Promise<ReviewLog[]> {
    return (await this.db()).getAll('reviews');
  }

  async putReview(review: ReviewLog): Promise<void> {
    await (await this.db()).put('reviews', review);
  }

  async putReviews(reviews: ReviewLog[]): Promise<void> {
    const db = await this.db();
    const tx = db.transaction('reviews', 'readwrite');
    await Promise.all([...reviews.map((r) => tx.store.put(r)), tx.done]);
  }

  async getKv<T>(key: string): Promise<T | undefined> {
    return (await this.db()).get('kv', key) as Promise<T | undefined>;
  }

  async setKv<T>(key: string, value: T): Promise<void> {
    await (await this.db()).put('kv', value, key);
  }

  /** Wipes everything. Used only by the backup-restore "merge" preview tests. */
  async clearAll(): Promise<void> {
    const db = await this.db();
    await Promise.all([db.clear('cards'), db.clear('reviews'), db.clear('kv')]);
  }
}
