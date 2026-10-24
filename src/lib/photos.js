// Full-size report photos, kept in IndexedDB (localStorage is too small for them).
// Keyed by report id; the value is a JPEG data URL.

const DB_NAME = 'civiclens';
const STORE = 'photos';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
  });
}

/** Best-effort: a failure here only means the photo can't be attached later. */
export async function savePhoto(id, dataUrl) {
  try {
    await run('readwrite', (s) => s.put(dataUrl, id));
  } catch {
    // Private mode or storage blocked — sending falls back to the thumbnail.
  }
}

export async function loadPhoto(id) {
  try {
    return (await run('readonly', (s) => s.get(id))) ?? null;
  } catch {
    return null;
  }
}

export async function deletePhoto(id) {
  try {
    await run('readwrite', (s) => s.delete(id));
  } catch {
    // Nothing to clean up.
  }
}
