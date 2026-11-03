const DB_NAME = 'form10-model-archive';
const DB_VERSION = 1;
const STORE = 'slots';

let dbPromise = null;

function openDatabase() {
  if (!('indexedDB' in window)) {
    return Promise.reject(new Error('当前浏览器不支持本地模型存储（IndexedDB）。'));
  }
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'slot' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('无法打开本地数据库。'));
    request.onblocked = () => reject(new Error('数据库被其他标签页占用，请关闭其他页面后重试。'));
  });
  return dbPromise;
}

async function withStore(mode, callback) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const store = transaction.objectStore(STORE);
    let result;
    try {
      result = callback(store);
    } catch (error) {
      reject(error);
      return;
    }
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error || new Error('本地存储操作失败。'));
    transaction.onabort = () => reject(transaction.error || new Error('本地存储操作被中止。'));
  });
}

export async function listLocalWorks() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readonly');
    const request = transaction.objectStore(STORE).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

export async function getLocalWork(slot) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readonly');
    const request = transaction.objectStore(STORE).get(Number(slot));
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

export function saveLocalWork(record) {
  return withStore('readwrite', (store) => store.put(record));
}

export function deleteLocalWork(slot) {
  return withStore('readwrite', (store) => store.delete(Number(slot)));
}

export async function clearLocalWorks() {
  return withStore('readwrite', (store) => store.clear());
}

export async function storageEstimate() {
  if (!navigator.storage?.estimate) return null;
  try {
    return await navigator.storage.estimate();
  } catch {
    return null;
  }
}
