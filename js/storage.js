// IndexedDB。問題・採点基準・解答履歴はすべてこの端末の中だけに保存する。
// （サーバーに送るのは採点のためのAPIリクエストのみ）

const DB_NAME = 'yoyaku-trainer';
const DB_VERSION = 1;

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('problems')) {
        const s = db.createObjectStore('problems', { keyPath: 'id' });
        s.createIndex('createdAt', 'createdAt');
      }
      if (!db.objectStoreNames.contains('attempts')) {
        const s = db.createObjectStore('attempts', { keyPath: 'id' });
        s.createIndex('problemId', 'problemId');
        s.createIndex('createdAt', 'createdAt');
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  return dbPromise;
}

function tx(store, mode, fn) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.onerror = () => reject(t.error);
    if (req) {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    } else {
      t.oncomplete = () => resolve();
    }
  }));
}

export function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/* ────────────── 問題 ────────────── */

export function saveProblem(problem) {
  return tx('problems', 'readwrite', (s) => s.put(problem));
}

export function getProblem(id) {
  return tx('problems', 'readonly', (s) => s.get(id));
}

export async function listProblems() {
  const all = await tx('problems', 'readonly', (s) => s.getAll());
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export function deleteProblem(id) {
  return tx('problems', 'readwrite', (s) => s.delete(id));
}

/* ────────────── 解答・採点結果 ────────────── */

export function saveAttempt(attempt) {
  return tx('attempts', 'readwrite', (s) => s.put(attempt));
}

export function getAttempt(id) {
  return tx('attempts', 'readonly', (s) => s.get(id));
}

export async function listAttempts(problemId = null) {
  const all = await tx('attempts', 'readonly', (s) => s.getAll());
  const filtered = problemId ? all.filter((a) => a.problemId === problemId) : all;
  return filtered.sort((a, b) => b.createdAt - a.createdAt);
}

/* ────────────── 全消去 ────────────── */

export async function wipeAll() {
  await tx('problems', 'readwrite', (s) => s.clear());
  await tx('attempts', 'readwrite', (s) => s.clear());
}
