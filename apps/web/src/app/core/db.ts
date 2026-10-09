/**
 * Stockage local hors ligne (IndexedDB) : état de l'application, session de courses en cours,
 * file des modifications à synchroniser et codes-barres connus.
 */
import { Injectable } from '@angular/core';
import { type IDBPDatabase, openDB } from 'idb';

type StoreName = 'kv' | 'barcodes';

@Injectable({ providedIn: 'root' })
export class LocalDb {
  private db: Promise<IDBPDatabase> | null = null;

  private open(): Promise<IDBPDatabase> {
    this.db ??= openDB('bouffe', 1, {
      upgrade(db) {
        db.createObjectStore('kv');
        db.createObjectStore('barcodes');
      },
    });
    return this.db;
  }

  async get<T>(key: string, store: StoreName = 'kv'): Promise<T | undefined> {
    try {
      return (await (await this.open()).get(store, key)) as T | undefined;
    } catch {
      return undefined;
    }
  }

  async set(key: string, value: unknown, store: StoreName = 'kv'): Promise<void> {
    try {
      await (await this.open()).put(store, value, key);
    } catch {
      /* stockage plein ou indisponible (navigation privée) : l'application continue en mémoire */
    }
  }

  async delete(key: string, store: StoreName = 'kv'): Promise<void> {
    try {
      await (await this.open()).delete(store, key);
    } catch {
      /* ignoré */
    }
  }

  async setMany(entries: [string, unknown][], store: StoreName): Promise<void> {
    try {
      const tx = (await this.open()).transaction(store, 'readwrite');
      await Promise.all([...entries.map(([key, value]) => tx.store.put(value, key)), tx.done]);
    } catch {
      /* ignoré */
    }
  }

  async clear(): Promise<void> {
    try {
      const db = await this.open();
      await Promise.all([db.clear('kv'), db.clear('barcodes')]);
    } catch {
      /* ignoré */
    }
  }
}
