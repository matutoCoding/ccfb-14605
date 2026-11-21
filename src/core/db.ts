// ---------- IndexedDB 存取层 ----------
import type { LastRecord, PatternRecord, FittingRecord } from './types';

const DB_NAME = 'last-pattern-studio';
const DB_VERSION = 1;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('lasts')) db.createObjectStore('lasts', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('patterns')) db.createObjectStore('patterns', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('fittings')) db.createObjectStore('fittings', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    t.oncomplete = () => db.close();
  });
}

async function txAll<T>(store: string): Promise<T[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, 'readonly');
    const req = t.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error);
    t.oncomplete = () => db.close();
  });
}

export const db = {
  saveLast: (r: LastRecord) => tx('lasts', 'readwrite', s => s.put(r)),
  getLast: (id: string) => tx<LastRecord | undefined>('lasts', 'readonly', s => s.get(id) as IDBRequest<any>),
  listLasts: () => txAll<LastRecord>('lasts'),
  deleteLast: (id: string) => tx('lasts', 'readwrite', s => s.delete(id)),

  savePattern: (r: PatternRecord) => tx('patterns', 'readwrite', s => s.put(r)),
  getPattern: (id: string) => tx<PatternRecord | undefined>('patterns', 'readonly', s => s.get(id) as IDBRequest<any>),
  listPatterns: () => txAll<PatternRecord>('patterns'),
  deletePattern: (id: string) => tx('patterns', 'readwrite', s => s.delete(id)),

  saveFitting: (r: FittingRecord) => tx('fittings', 'readwrite', s => s.put(r)),
  listFittings: () => txAll<FittingRecord>('fittings'),
  deleteFitting: (id: string) => tx('fittings', 'readwrite', s => s.delete(id)),
};

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
