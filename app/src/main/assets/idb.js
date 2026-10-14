// Armazenamento persistente (IndexedDB) com API chave/valor simples. Cai para memória se indisponível.
const DB_NAME = 'voxelcraft', DB_VER = 1, STORES = ['worlds', 'chunks', 'cache', 'kv'];
let dbp = null;
const mem = new Map();

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = () => { const db = req.result; for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch (e) { resolve(null); }
  });
  return dbp;
}
function tx(store, mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    if (!db) { resolve(fn(null)); return; }
    let out;
    try {
      const t = db.transaction(store, mode);
      const s = t.objectStore(store);
      const r = fn(s);
      if (r && 'onsuccess' in r) r.onsuccess = () => { out = r.result; };
      t.oncomplete = () => resolve(out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    } catch (e) { reject(e); }
  }));
}
const mk = (store, key) => store + '/' + key;
export const idbAvailable = () => open().then((db) => !!db);
export function idbGet(store, key) { return tx(store, 'readonly', (s) => s ? s.get(key) : null).then((v) => v === undefined || v === null ? (mem.has(mk(store, key)) ? mem.get(mk(store, key)) : undefined) : v).catch(() => mem.get(mk(store, key))); }
export function idbSet(store, key, val) { return tx(store, 'readwrite', (s) => { if (!s) { mem.set(mk(store, key), val); return null; } return s.put(val, key); }).catch(() => { mem.set(mk(store, key), val); }); }
export function idbDel(store, key) { mem.delete(mk(store, key)); return tx(store, 'readwrite', (s) => s ? s.delete(key) : null).catch(() => {}); }
export function idbKeys(store) {
  return tx(store, 'readonly', (s) => s ? s.getAllKeys() : null).then((k) => {
    const out = k || [];
    for (const m of mem.keys()) if (m.startsWith(store + '/')) out.push(m.slice(store.length + 1));
    return out;
  }).catch(() => []);
}
// pede ao navegador para não apagar os dados em caso de pouco espaço
export function requestPersistence() { try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { } }
