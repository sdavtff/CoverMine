// Mundo: chunks (blocos + metadados + bioma), edições do jogador, dados de blocos (baús, fornalhas)
// e geração em Web Workers. Sem dependência de THREE.
import { WorldGen, CS, H } from './worldgen.js';
import { makeDimGen } from './dimgen.js';
import { B, BLOCKS, EMIT } from './blocks.js';

export { CS, H };
const S = CS * CS;

export class World {
  constructor(opts) {
    this.seed = opts.seed | 0;
    this.genVersion = opts.gen || 3;
    this.gen = makeDimGen(this.seed, this.genVersion) || new WorldGen(this.seed, this.genVersion);
    this.dim = this.gen.dim || 'overworld';
    this.sea = this.gen.sea;
    this.chunks = new Map();
    this.pending = new Map();
    this.edits = opts.edits || new Map();          // "cx,cz" → Map(índice → id | meta << 8)
    this.blockData = opts.blockData || new Map();  // "x,y,z" → dados (inventário de baú, fornalha...)
    this.onChunkLoaded = null;                     // (chunk) → void
    this.onEdit = null;                            // (chunk, lx, y, lz, oldId, newId) → void
    this.onMeshed = null;                          // (mensagem do worker com buffers) → void
    this.uv = null;
    this.workers = [];
    this.nextWorker = 0;
    this.startWorkers(opts.workers ?? 2);
  }
  startWorkers(n) {
    if (typeof Worker === 'undefined' || n <= 0) return;
    try {
      const url = new URL('./worldgen-worker.js', import.meta.url);
      for (let i = 0; i < n; i++) {
        let w;
        if (url.origin !== location.origin) {
          // código carregado de outra origem (atualização via CDN): worker via blob
          const blob = new Blob([`import ${JSON.stringify(url.href)};`], { type: 'text/javascript' });
          w = new Worker(URL.createObjectURL(blob), { type: 'module' });
        } else w = new Worker(url, { type: 'module' });
        w.onmessage = (e) => { if (e.data.type === 'meshed') { this.meshBusy--; if (this.onMeshed) this.onMeshed(e.data); } else this.accept(e.data); };
        w.onerror = () => { this.workers = this.workers.filter((x) => x !== w); this.failPending(); };
        w.postMessage({ type: 'init', seed: this.seed, gen: this.genVersion });
        if (this.uv) w.postMessage({ type: 'uv', uv: this.uv });
        this.workers.push(w);
      }
    } catch (e) { this.workers = []; }
  }
  setUV(uv) { this.uv = uv; for (const w of this.workers) w.postMessage({ type: 'uv', uv }); }
  // malha no worker: envia cópia dos 3×3 chunks; retorna false se não houver worker
  requestMesh(c, veg) {
    if (!this.workers.length || !this.uv) return false;
    const chunks = [];
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const n = this.chunks.get((c.cx + dx) + ',' + (c.cz + dz));
      if (!n) return false;
      const lim = (Math.min(H - 1, n.maxY + 3) + 1) * S;
      const data = new Uint8Array(n.data.length), meta = new Uint8Array(n.meta.length);
      data.set(n.data.subarray(0, lim)); meta.set(n.meta.subarray(0, lim));
      chunks.push({ cx: n.cx, cz: n.cz, data, meta, biome: n.biome, maxY: n.maxY, emit: n.emit });
    }
    const w = this.workers[this.nextWorker++ % this.workers.length];
    this.meshBusy = (this.meshBusy || 0) + 1;
    c.meshing = c.version;
    w.postMessage({ type: 'mesh', key: c.key, version: c.version, cx: c.cx, cz: c.cz, chunks, veg });
    return true;
  }
  markDirty(c) { c.dirty = true; c.version = (c.version || 0) + 1; }
  failPending() { if (!this.workers.length) this.pending.clear(); }
  dispose() { for (const w of this.workers) w.terminate(); this.workers = []; }

  // pede um chunk (assíncrono quando há workers)
  request(cx, cz) {
    const k = cx + ',' + cz;
    if (this.chunks.has(k) || this.pending.has(k)) return;
    if (!this.workers.length) { this.getChunk(cx, cz); return; }
    this.pending.set(k, performance.now());
    const w = this.workers[this.nextWorker++ % this.workers.length];
    w.postMessage({ type: 'gen', cx, cz });
  }
  accept(m) {
    if (m.type !== 'chunk') return;
    const k = m.cx + ',' + m.cz;
    this.pending.delete(k);
    if (this.chunks.has(k)) return; // já gerado de forma síncrona
    this.install(m.cx, m.cz, m.data, m.meta, m.biome);
  }
  install(cx, cz, data, meta, biome) {
    const k = cx + ',' + cz;
    const c = { cx, cz, key: k, data, meta, biome, maxY: 0, emit: 0, mesh: null, cut: null, water: null, dirty: true, built: false, explored: false, version: 1, meshing: -1 };
    const ed = this.edits.get(k);
    if (ed) for (const [i, v] of ed) { data[i] = v & 255; meta[i] = v >> 8; }
    scanChunk(c);
    this.chunks.set(k, c);
    // vizinhos já construídos precisam de nova malha (faces da borda e luz)
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dz) continue;
      const n = this.chunks.get((cx + dx) + ',' + (cz + dz));
      if (n) this.markDirty(n);
    }
    if (this.onChunkLoaded) this.onChunkLoaded(c);
    return c;
  }
  has(cx, cz) { return this.chunks.has(cx + ',' + cz); }
  getChunk(cx, cz) {
    const k = cx + ',' + cz;
    let c = this.chunks.get(k);
    if (!c) {
      const r = this.gen.generate(cx, cz);
      this.pending.delete(k);
      c = this.install(cx, cz, r.data, r.meta, r.biome);
    }
    return c;
  }
  getBlock(x, y, z) {
    if (y < 0) return B.BEDROCK;
    if (y >= H) return B.AIR;
    const cx = Math.floor(x / CS), cz = Math.floor(z / CS);
    return this.getChunk(cx, cz).data[(x - cx * CS) + (z - cz * CS) * CS + y * S];
  }
  getMeta(x, y, z) {
    if (y < 0 || y >= H) return 0;
    const cx = Math.floor(x / CS), cz = Math.floor(z / CS);
    return this.getChunk(cx, cz).meta[(x - cx * CS) + (z - cz * CS) * CS + y * S];
  }
  // leitura sem gerar (null se o chunk não está carregado)
  peekBlock(x, y, z) {
    if (y < 0) return B.BEDROCK;
    if (y >= H) return B.AIR;
    const cx = Math.floor(x / CS), cz = Math.floor(z / CS);
    const c = this.chunks.get(cx + ',' + cz);
    return c ? c.data[(x - cx * CS) + (z - cz * CS) * CS + y * S] : null;
  }
  setBlock(x, y, z, id, meta = 0) {
    if (y < 1 || y >= H) return false;
    const cx = Math.floor(x / CS), cz = Math.floor(z / CS);
    const c = this.getChunk(cx, cz);
    const lx = x - cx * CS, lz = z - cz * CS;
    const i = lx + lz * CS + y * S;
    const prev = c.data[i];
    if (prev === id && c.meta[i] === meta) return false;
    c.data[i] = id; c.meta[i] = meta;
    if (EMIT[prev]) c.emit--;
    if (EMIT[id]) c.emit++;
    if (id && y > c.maxY) c.maxY = y;
    let ed = this.edits.get(c.key);
    if (!ed) { ed = new Map(); this.edits.set(c.key, ed); }
    ed.set(i, id | (meta << 8));
    if (prev !== id && BLOCKS[prev] && (BLOCKS[prev].use === 'chest' || BLOCKS[prev].use === 'furnace') && id !== B.FURNACE && id !== B.FURNACE_LIT) {
      // o conteúdo é devolvido pelo jogo antes de remover o bloco
      this.blockData.delete(x + ',' + y + ',' + z);
    }
    this.dirty = true;
    if (this.onEdit) this.onEdit(c, lx, y, lz, prev, id);
    return true;
  }
  setMeta(x, y, z, meta) { return this.setBlock(x, y, z, this.getBlock(x, y, z), meta); }
  biomeAt(x, z) {
    const cx = Math.floor(x / CS), cz = Math.floor(z / CS);
    const c = this.chunks.get(cx + ',' + cz);
    return c ? c.biome[(x - cx * CS) + (z - cz * CS) * CS] : this.gen.biomeAt(x, z);
  }
  // altura do bloco sólido mais alto (para spawn de entidades)
  surfaceY(x, z) {
    const cx = Math.floor(x / CS), cz = Math.floor(z / CS);
    const c = this.chunks.get(cx + ',' + cz);
    if (!c) return -1;
    const lx = x - cx * CS, lz = z - cz * CS;
    for (let y = Math.min(H - 1, c.maxY); y > 0; y--) {
      const id = c.data[lx + lz * CS + y * S];
      if (id && id !== B.LEAVES && id !== B.PINE_LEAVES && id !== B.ACACIA_LEAVES && BLOCKS[id] && !BLOCKS[id].shape) return y;
    }
    return 0;
  }
  serializeEdits() {
    const out = {};
    for (const [k, m] of this.edits) if (m.size) out[k] = Array.from(m);
    return out;
  }
  serializeBlockData() { return Array.from(this.blockData); }
}

export function scanChunk(c) {
  const d = c.data;
  let maxY = 0, emit = 0;
  for (let i = d.length - 1; i >= 0; i--) {
    const id = d[i];
    if (id) { const y = (i / S) | 0; if (y > maxY) maxY = y; if (EMIT[id]) emit++; }
  }
  c.maxY = maxY; c.emit = emit;
}
