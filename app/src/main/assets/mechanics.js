// Mecanismos: rede de energia (alavanca, botão, placa de pressão, fio) e consumidores
// (lâmpada elétrica, porta, portão, pistão). Recalculado por eventos, não a cada quadro.
import { G, hook } from './state.js';
import { B, BLOCKS, SOLID, PISTON_DIR } from './blocks.js';

const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const key = (x, y, z) => x + ',' + y + ',' + z;
let busy = false;
const pressedPlates = new Map(); // chave → tempo restante

function isSourceOn(id, meta) {
  if (id === B.LEVER || id === B.BUTTON || id === B.PLATE) return !!(meta & 8);
  return false;
}
function isConsumer(id) { return id === B.PLAMP || id === B.PLAMP_ON || id === B.DOOR || id === B.FENCE_GATE || id === B.PISTON; }

// recalcula a rede de energia ao redor de (x, y, z)
export function recompute(x, y, z) {
  if (busy) return;
  busy = true;
  try { doRecompute(x, y, z); } finally { busy = false; }
}
function doRecompute(x0, y0, z0) {
  const w = G.world, set = (x, y, z, id, m) => hook('setBlock', x, y, z, id, m);
  // 1) coleta fios conectados (até 512) a partir das células vizinhas
  const wires = new Map(), queue = [];
  const seeds = [[x0, y0, z0], ...DIRS.map(([dx, dy, dz]) => [x0 + dx, y0 + dy, z0 + dz])];
  for (const [x, y, z] of seeds) if (w.getBlock(x, y, z) === B.WIRE && !wires.has(key(x, y, z))) { wires.set(key(x, y, z), [x, y, z, 0]); queue.push([x, y, z]); }
  while (queue.length && wires.size < 512) {
    const [x, y, z] = queue.shift();
    for (const [dx, dy, dz] of DIRS) {
      const nx = x + dx, ny = y + dy, nz = z + dz, k = key(nx, ny, nz);
      if (!wires.has(k) && w.getBlock(nx, ny, nz) === B.WIRE) { wires.set(k, [nx, ny, nz, 0]); queue.push([nx, ny, nz]); }
    }
    // fios sobem/descem degraus (diagonais verticais)
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (const dy of [1, -1]) {
      const nx = x + dx, ny = y + dy, nz = z + dz, k = key(nx, ny, nz);
      if (!wires.has(k) && w.getBlock(nx, ny, nz) === B.WIRE) { wires.set(k, [nx, ny, nz, 0]); queue.push([nx, ny, nz]); }
    }
  }
  // 2) fontes ligadas adjacentes aos fios → nível 15, propaga decaindo 1 por fio
  const pq = [];
  for (const [k, wv] of wires) {
    for (const [dx, dy, dz] of DIRS) {
      const id = w.getBlock(wv[0] + dx, wv[1] + dy, wv[2] + dz);
      if (isSourceOn(id, w.getMeta(wv[0] + dx, wv[1] + dy, wv[2] + dz))) { wv[3] = 15; }
    }
    if (wv[3]) pq.push(wv);
  }
  while (pq.length) {
    const [x, y, z, p] = pq.shift();
    if (p <= 1) continue;
    for (const [k, wv] of wires) {
      if (Math.abs(wv[0] - x) + Math.abs(wv[2] - z) === 1 && Math.abs(wv[1] - y) <= 1 && wv[3] < p - 1) { wv[3] = p - 1; pq.push(wv); }
      void k;
    }
  }
  for (const wv of wires.values()) if ((w.getMeta(wv[0], wv[1], wv[2]) & 15) !== wv[3]) set(wv[0], wv[1], wv[2], B.WIRE, wv[3]);
  // 3) consumidores ao redor dos fios e da origem
  const cand = new Map();
  const addAround = (x, y, z) => { for (const [dx, dy, dz] of [[0, 0, 0], ...DIRS]) { const id = w.getBlock(x + dx, y + dy, z + dz); if (isConsumer(id)) cand.set(key(x + dx, y + dy, z + dz), [x + dx, y + dy, z + dz]); } };
  addAround(x0, y0, z0);
  for (const wv of wires.values()) addAround(wv[0], wv[1], wv[2]);
  for (const [, [x, y, z]] of cand) updateConsumer(x, y, z, poweredAt(x, y, z, wires));
}
function poweredAt(x, y, z, wires) {
  const w = G.world;
  for (const [dx, dy, dz] of DIRS) {
    const nx = x + dx, ny = y + dy, nz = z + dz;
    const id = w.getBlock(nx, ny, nz);
    if (isSourceOn(id, w.getMeta(nx, ny, nz))) return true;
    if (id === B.WIRE) { const wv = wires && wires.get(key(nx, ny, nz)); const p = wv ? wv[3] : (w.getMeta(nx, ny, nz) & 15); if (p > 0) return true; }
  }
  // porta: a metade de cima conta como a de baixo
  if (w.getBlock(x, y, z) === B.DOOR && !(w.getMeta(x, y, z) & 8) && w.getBlock(x, y + 1, z) === B.DOOR) return poweredUpper(x, y + 1, z, wires);
  return false;
}
function poweredUpper(x, y, z, wires) {
  const w = G.world;
  for (const [dx, dy, dz] of DIRS) {
    if (dy === -1) continue;
    const id = w.getBlock(x + dx, y + dy, z + dz);
    if (isSourceOn(id, w.getMeta(x + dx, y + dy, z + dz))) return true;
    if (id === B.WIRE && (w.getMeta(x + dx, y + dy, z + dz) & 15) > 0) return true;
  }
  return false;
}
function updateConsumer(x, y, z, on) {
  const w = G.world, set = (x_, y_, z_, id, m) => hook('setBlock', x_, y_, z_, id, m);
  const id = w.getBlock(x, y, z), m = w.getMeta(x, y, z);
  if (id === B.PLAMP && on) set(x, y, z, B.PLAMP_ON, m);
  else if (id === B.PLAMP_ON && !on) set(x, y, z, B.PLAMP, m);
  else if (id === B.DOOR) {
    const by = m & 8 ? y - 1 : y;
    const bm = w.getMeta(x, by, z);
    const open = !!(bm & 4);
    if (open !== on) {
      set(x, by, z, B.DOOR, on ? bm | 4 : bm & ~4);
      if (w.getBlock(x, by + 1, z) === B.DOOR) set(x, by + 1, z, B.DOOR, on ? w.getMeta(x, by + 1, z) | 4 : w.getMeta(x, by + 1, z) & ~4);
      hook('sound', on ? 'door_open' : 'door_close');
    }
  } else if (id === B.FENCE_GATE) { if (!!(m & 4) !== on) set(x, y, z, B.FENCE_GATE, on ? m | 4 : m & ~4); }
  else if (id === B.PISTON) {
    const ext = !!(m & 8);
    if (on && !ext) extendPiston(x, y, z, m);
    else if (!on && ext) retractPiston(x, y, z, m);
  }
}
const IMMOVABLE = new Set([B.BEDROCK, B.CHEST, B.FURNACE, B.FURNACE_LIT, B.PISTON_HEAD, B.LAVA]);
function extendPiston(x, y, z, m) {
  const w = G.world, set = (x_, y_, z_, id, mm) => hook('setBlock', x_, y_, z_, id, mm);
  const [dx, dy, dz] = PISTON_DIR[m & 7];
  // encontra a fila de blocos a empurrar (máx. 12)
  const line = [];
  let cx = x + dx, cy = y + dy, cz = z + dz;
  for (let i = 0; i <= 12; i++) {
    const id = w.getBlock(cx, cy, cz);
    if (id === B.AIR || id === B.WATER) break;
    if (IMMOVABLE.has(id) || (id === B.PISTON && (w.getMeta(cx, cy, cz) & 8))) return;
    if (i === 12) return;
    if (BLOCKS[id] && BLOCKS[id].shape && !SOLID[id]) { line.push([cx, cy, cz, -1]); break; } // tochas, plantas: quebram
    line.push([cx, cy, cz, id, w.getMeta(cx, cy, cz)]);
    cx += dx; cy += dy; cz += dz;
  }
  if (cy < 1 || cy > 126) return;
  for (let i = line.length - 1; i >= 0; i--) {
    const [bx, by, bz, id, bm] = line[i];
    if (id === -1) { hook('breakBlock', bx, by, bz); continue; }
    set(bx + dx, by + dy, bz + dz, id, bm);
  }
  set(x, y, z, B.PISTON, m | 8);
  set(x + dx, y + dy, z + dz, B.PISTON_HEAD, m & 7);
  hook('sound', 'piston');
  // empurra entidades
  hook('pushEntities', x + dx, y + dy, z + dz, dx, dy, dz);
}
function retractPiston(x, y, z, m) {
  const w = G.world, set = (x_, y_, z_, id, mm) => hook('setBlock', x_, y_, z_, id, mm);
  const [dx, dy, dz] = PISTON_DIR[m & 7];
  if (w.getBlock(x + dx, y + dy, z + dz) === B.PISTON_HEAD) set(x + dx, y + dy, z + dz, B.AIR, 0);
  set(x, y, z, B.PISTON, m & 7);
  hook('sound', 'piston');
}

// placas de pressão: pressionadas por jogador/criaturas
export function updatePlates(dt, ents) {
  const w = G.world;
  const now = new Set();
  for (const e of ents) {
    const x = Math.floor(e.pos.x), y = Math.floor(e.pos.y + 0.05), z = Math.floor(e.pos.z);
    if (w.peekBlock(x, y, z) === B.PLATE) now.add(key(x, y, z));
  }
  for (const k of now) {
    if (!pressedPlates.has(k)) {
      const [x, y, z] = k.split(',').map(Number);
      hook('setBlock', x, y, z, B.PLATE, w.getMeta(x, y, z) | 8);
      hook('sound', 'click');
      recompute(x, y, z);
    }
    pressedPlates.set(k, 0.6);
  }
  for (const [k, t] of pressedPlates) {
    if (now.has(k)) continue;
    const nt = t - dt;
    if (nt > 0) { pressedPlates.set(k, nt); continue; }
    pressedPlates.delete(k);
    const [x, y, z] = k.split(',').map(Number);
    if (w.getBlock(x, y, z) === B.PLATE) { hook('setBlock', x, y, z, B.PLATE, w.getMeta(x, y, z) & ~8); hook('sound', 'click'); recompute(x, y, z); }
  }
}

// chamado quando um bloco muda (colocado/removido)
export function onBlockChanged(x, y, z, oldId, newId) {
  const rel = (id) => id === B.WIRE || id === B.LEVER || id === B.BUTTON || id === B.PLATE || isConsumer(id);
  if (rel(oldId) || rel(newId)) recompute(x, y, z);
}
