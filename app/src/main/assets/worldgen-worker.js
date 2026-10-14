// Web Worker: gera chunks e constrói malhas fora do thread principal.
import { WorldGen } from './worldgen.js';
import { meshChunk } from './mesher.js';

let gen = null, seed = 0, uv = null;
// mundo mínimo para o mesher: só os 3×3 chunks enviados
const fake = {
  get seed() { return seed; },
  get gen() { return gen; },
  map: new Map(),
  getChunk(cx, cz) { return this.map.get(cx + ',' + cz); },
};
self.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'init') { seed = m.seed; gen = new WorldGen(m.seed, m.gen); return; }
  if (m.type === 'uv') { uv = m.uv; return; }
  if (m.type === 'gen' && gen) {
    const r = gen.generate(m.cx, m.cz);
    self.postMessage({ type: 'chunk', cx: m.cx, cz: m.cz, data: r.data, meta: r.meta, biome: r.biome }, [r.data.buffer, r.meta.buffer, r.biome.buffer]);
    return;
  }
  if (m.type === 'mesh' && gen && uv) {
    fake.map.clear();
    for (const c of m.chunks) fake.map.set(c.cx + ',' + c.cz, c);
    const center = fake.map.get(m.cx + ',' + m.cz);
    const r = meshChunk(fake, center, { uv, veg: m.veg });
    const tr = [];
    for (const k of ['opaque', 'cutout', 'water']) if (r[k]) for (const a of Object.values(r[k])) tr.push(a.buffer);
    self.postMessage({ type: 'meshed', key: m.key, version: m.version, res: r }, tr);
  }
};
