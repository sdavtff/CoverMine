// Mundos salvos (IndexedDB): lista, criar, abrir, renomear, duplicar, excluir, exportar/importar.
// Cada mundo é gravado alternando entre dois slots: se a gravação for interrompida, o slot anterior continua válido.
import { idbGet, idbSet, idbDel, idbKeys, requestPersistence } from './idb.js';

export const SAVE_VERSION = 3;
const metaKey = (id) => 'meta:' + id;
const dataKey = (id, slot) => 'data:' + id + ':' + slot;

export async function listWorlds() {
  const keys = (await idbKeys('worlds')).filter((k) => String(k).startsWith('meta:'));
  const out = [];
  for (const k of keys) { const m = await idbGet('worlds', k); if (m && m.id) out.push(m); }
  out.sort((a, b) => (b.played || 0) - (a.played || 0));
  return out;
}
export function newWorldId() { return 'w' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36); }

export async function createWorld({ name, seed, mode, gen }) {
  requestPersistence();
  const id = newWorldId();
  const meta = { id, name: name || 'Novo mundo', seed: seed | 0, mode: mode || 'survival', gen: gen || 3, created: Date.now(), played: Date.now(), slot: -1, version: SAVE_VERSION };
  await idbSet('worlds', metaKey(id), meta);
  return meta;
}
export async function loadWorld(id) {
  const meta = await idbGet('worlds', metaKey(id));
  if (!meta) return null;
  const order = meta.slot >= 0 ? [meta.slot, 1 - meta.slot] : [0, 1];
  for (const s of order) {
    try {
      const d = await idbGet('worlds', dataKey(id, s));
      if (d && d.check === checksum(d) && d.seed === meta.seed) { if (s !== meta.slot) d.recovered = true; return { meta, data: d }; }
    } catch (e) { /* slot corrompido: tenta o outro */ }
  }
  return { meta, data: null };
}
export async function saveWorld(meta, data) {
  data.seed = meta.seed;
  data.version = SAVE_VERSION;
  data.savedAt = Date.now();
  data.check = checksum(data);
  const slot = meta.slot === 0 ? 1 : 0;
  await idbSet('worlds', dataKey(meta.id, slot), data);
  meta.slot = slot;
  meta.played = Date.now();
  await idbSet('worlds', metaKey(meta.id), meta);
}
export async function renameWorld(id, name) { const m = await idbGet('worlds', metaKey(id)); if (m) { m.name = name; await idbSet('worlds', metaKey(id), m); } }
export async function deleteWorld(id) { await idbDel('worlds', metaKey(id)); await idbDel('worlds', dataKey(id, 0)); await idbDel('worlds', dataKey(id, 1)); }
export async function duplicateWorld(id) {
  const r = await loadWorld(id);
  if (!r) return null;
  const meta = Object.assign({}, r.meta, { id: newWorldId(), name: r.meta.name + ' (cópia)', slot: -1, created: Date.now(), played: Date.now() });
  await idbSet('worlds', metaKey(meta.id), meta);
  if (r.data) await saveWorld(meta, JSON.parse(JSON.stringify(r.data)));
  return meta;
}
export async function exportWorld(id) {
  const r = await loadWorld(id);
  if (!r) return null;
  return JSON.stringify({ format: 'voxelcraft-world', version: SAVE_VERSION, meta: r.meta, data: r.data });
}
export async function importWorld(text) {
  const o = JSON.parse(text);
  if (!o || o.format !== 'voxelcraft-world' || !o.meta) throw new Error('Arquivo inválido');
  const meta = Object.assign({}, o.meta, { id: newWorldId(), slot: -1, played: Date.now() });
  await idbSet('worlds', metaKey(meta.id), meta);
  if (o.data) await saveWorld(meta, o.data);
  return meta;
}

// soma de verificação simples (detecta dados truncados/corrompidos)
function checksum(d) {
  const s = JSON.stringify([d.seed, d.version, d.savedAt, d.player && [d.player.x, d.player.y, d.player.z], d.edits && Object.keys(d.edits).length, d.time]);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// migração do formato antigo (v1/v2 usavam localStorage com um único mundo)
export async function migrateLegacy() {
  let old;
  try { old = JSON.parse(localStorage.getItem('vc_world') || 'null'); } catch (e) { old = null; }
  if (!old || !old.seed && old.seed !== 0) return null;
  const meta = await createWorld({ name: 'Meu mundo (versão anterior)', seed: old.seed, mode: 'creative', gen: old.gen || 1 });
  const data = {
    player: old.player ? { x: old.player.x, y: old.player.y, z: old.player.z, yaw: old.player.yaw, pitch: old.player.pitch, fly: old.player.fly } : null,
    edits: old.edits || {}, time: old.time ?? 0.3, legacySel: old.sel,
  };
  await saveWorld(meta, data);
  try { localStorage.setItem('vc_world_migrated', localStorage.getItem('vc_world')); localStorage.removeItem('vc_world'); } catch (e) { }
  return meta;
}
