// Física do mundo (etapa 8): líquidos que escorrem com níveis, água + lava, fogo que se espalha
// e explosões com destruição, destroços e empurrão. Só o anfitrião (ou o jogo solo) simula;
// as mudanças viram edições normais de blocos (salvas e enviadas aos outros jogadores).
import { G, hook } from './state.js';
import { B, BLOCKS, SOLID, LIQUID } from './blocks.js';
import * as PT from './particles.js';

// meta dos líquidos: 0 = fonte; 1..7 = corrente (7 = mais fraca); +8 = caindo
const FLUID = {
  [B.WATER]: { step: 1, max: 7, delay: 0.3 },
  [B.LAVA]: { step: 2, max: 6, delay: 1.4 },
};
const flowQ = new Map();
const fireQ = new Map();
const DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const key = (x, y, z) => x + ',' + y + ',' + z;
const simulating = () => !(G.net && G.net.connected && !G.net.host);

const isFlammable = (id) => { const d = BLOCKS[id]; return !!d && (d.flammable || d.leaves || d.sound === 'wood' || d.sound === 'cloth') && !d.fire; };
// blocos que o líquido destrói ao passar (plantas, tochas, fios...)
function washable(id) {
  if (id === B.AIR) return true;
  const d = BLOCKS[id];
  return !!d && ['cross', 'crop', 'torch', 'wire', 'rail'].includes(d.shape) && !d.liquid;
}

export function scheduleFlow(x, y, z, delay) {
  const k = key(x, y, z);
  const id = G.world.getBlock(x, y, z);
  const F = FLUID[id];
  if (!F) return;
  if (!flowQ.has(k)) flowQ.set(k, { x, y, z, t: delay ?? F.delay });
}
// chamado a cada bloco alterado pelo jogo: acorda líquidos e fogo vizinhos
export function wakeAround(x, y, z) {
  if (!G.world) return;
  scheduleFlow(x, y, z);
  scheduleFlow(x, y + 1, z);
  for (const [dx, dz] of DIRS4) scheduleFlow(x + dx, y, z + dz);
  scheduleFlow(x, y - 1, z);
  const id = G.world.getBlock(x, y, z);
  if (id === B.FIRE) scheduleFire(x, y, z, 1 + Math.random() * 2);
}
function scheduleFire(x, y, z, t) { const k = key(x, y, z); if (!fireQ.has(k)) fireQ.set(k, { x, y, z, t }); }

function set(x, y, z, id, meta) { hook('setBlock', x, y, z, id, meta || 0); }

// ---------------- líquidos ----------------
function flowTick(x, y, z) {
  const w = G.world;
  const id = w.getBlock(x, y, z);
  const F = FLUID[id];
  if (!F) return;
  let m = w.getMeta(x, y, z);
  // lava encostando em água: fonte vira pedra; corrente vira pedregulho
  if (id === B.LAVA) {
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]]) {
      if (w.getBlock(x + dx, y + dy, z + dz) === B.WATER) {
        set(x, y, z, m === 0 ? B.STONE : B.COBBLE, 0);
        PT.smoke(x + 0.5, y + 1, z + 0.5, 8, [0.8, 0.8, 0.8]); hook('sound', 'fizz', { x: x + 0.5, y: y + 0.5, z: z + 0.5 });
        return;
      }
    }
  }
  const isSource = m === 0;
  if (!isSource) {
    // corrente: precisa ser alimentada por cima ou por um vizinho mais forte
    let want = -1;
    if (w.getBlock(x, y + 1, z) === id) want = 8 | 1;
    else {
      let best = 99, sources = 0;
      for (const [dx, dz] of DIRS4) {
        if (w.getBlock(x + dx, y, z + dz) !== id) continue;
        const nm = w.getMeta(x + dx, y, z + dz);
        if (nm === 0) sources++;
        const nl = nm & 8 ? 0 : nm & 7;
        best = Math.min(best, nl + F.step);
      }
      // água infinita: entre duas fontes, com apoio embaixo, vira fonte
      const below = w.getBlock(x, y - 1, z);
      if (id === B.WATER && sources >= 2 && (SOLID[below] || (below === B.WATER && w.getMeta(x, y - 1, z) === 0))) want = 0;
      else if (best <= F.max) want = best;
    }
    if (want < 0) { set(x, y, z, B.AIR, 0); return; }
    if (want !== m) { set(x, y, z, id, want); m = want; }
  }
  // espalha: primeiro para baixo, depois para os lados
  const below = w.getBlock(x, y - 1, z);
  if (y > 1 && (washable(below) || (below === id && (w.getMeta(x, y - 1, z) & 7) !== 0 && !(w.getMeta(x, y - 1, z) & 8)))) {
    if (below !== id) { if (below !== B.AIR) hook('breakBlock', x, y - 1, z); set(x, y - 1, z, id, 8 | 1); }
    else set(x, y - 1, z, id, 8 | 1);
    return;
  }
  if (below === B.WATER && id === B.LAVA) { set(x, y - 1, z, B.STONE, 0); return; }
  if (below === B.LAVA && id === B.WATER) { set(x, y - 1, z, w.getMeta(x, y - 1, z) === 0 ? B.STONE : B.COBBLE, 0); return; }
  if (below === id) return; // cai num lago: não espalha
  const lvl = m & 8 ? 0 : m & 7;
  const nl = lvl + F.step;
  if (nl > F.max) return;
  for (const [dx, dz] of DIRS4) {
    const nx = x + dx, nz = z + dz;
    const n = w.getBlock(nx, y, nz);
    if (washable(n)) {
      if (n !== B.AIR) hook('breakBlock', nx, y, nz);
      set(nx, y, nz, id, nl);
    } else if (n === id) {
      const nm = w.getMeta(nx, y, nz);
      if (nm !== 0 && !(nm & 8) && (nm & 7) > nl) set(nx, y, nz, id, nl);
    } else if (FLUID[n] && n !== id) scheduleFlow(nx, y, nz, 0.05);
  }
}

// ---------------- fogo ----------------
function fireTick(x, y, z) {
  const w = G.world;
  if (w.getBlock(x, y, z) !== B.FIRE) return;
  const age = w.getMeta(x, y, z);
  // chuva apaga o fogo a céu aberto
  const rain = (G.weatherNow && G.weatherNow.rain) || 0;
  let open = true;
  for (let yy = y + 1; yy < Math.min(127, y + 30); yy++) if (SOLID[w.getBlock(x, yy, z)]) { open = false; break; }
  if (rain > 0.3 && open && Math.random() < 0.6) { set(x, y, z, B.AIR, 0); PT.smoke(x + 0.5, y + 0.3, z + 0.5, 5); return; }
  // precisa de combustível por perto
  let fuel = false;
  const N6 = [[0, -1, 0], [0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];
  for (const [dx, dy, dz] of N6) {
    const nid = w.getBlock(x + dx, y + dy, z + dz);
    if (!isFlammable(nid)) continue;
    fuel = true;
    // queima o bloco vizinho (vira fogo ou some); TNT é acesa
    if (Math.random() < 0.32) {
      if (BLOCKS[nid].tnt) { set(x + dx, y + dy, z + dz, B.AIR, 0); hook('primeTNT', x + dx, y + dy, z + dz, 1.5 + Math.random()); }
      else set(x + dx, y + dy, z + dz, Math.random() < 0.6 ? B.FIRE : B.AIR, 0);
    }
  }
  // espalha para ar ao lado de material inflamável (até 2 blocos)
  if (Math.random() < 0.7) {
    const tx = x + Math.floor(Math.random() * 5) - 2, ty = y + Math.floor(Math.random() * 4) - 1, tz = z + Math.floor(Math.random() * 5) - 2;
    if (w.getBlock(tx, ty, tz) === B.AIR && N6.some(([dx, dy, dz]) => isFlammable(w.getBlock(tx + dx, ty + dy, tz + dz)))) set(tx, ty, tz, B.FIRE, 0);
  }
  if (!fuel && !SOLID[w.getBlock(x, y - 1, z)]) { set(x, y, z, B.AIR, 0); return; }
  if (age >= 10 && (!fuel || Math.random() < 0.3)) { set(x, y, z, B.AIR, 0); PT.smoke(x + 0.5, y + 0.2, z + 0.5, 4); return; }
  w.setMeta ? w.setMeta(x, y, z, Math.min(15, age + 1)) : null;
  scheduleFire(x, y, z, 0.8 + Math.random() * 1.4);
}
// acende fogo (isqueiro, lava, raio)
export function ignite(x, y, z) {
  const w = G.world;
  const id = w.getBlock(x, y, z);
  if (id === B.TNT) { set(x, y, z, B.AIR, 0); hook('primeTNT', x, y, z, 3); return true; }
  if (id !== B.AIR && !washable(id)) return false;
  if (LIQUID[id]) return false;
  set(x, y, z, B.FIRE, 0);
  scheduleFire(x, y, z, 1);
  return true;
}

// ---------------- explosões ----------------
export function explode(cx, cy, cz, power = 3.6) {
  const w = G.world;
  hook('sound', 'explode', { x: cx, y: cy, z: cz });
  hook('cameraShake', Math.max(0, 1.2 - Math.hypot(cx - G.player.pos.x, cy - G.player.pos.y, cz - G.player.pos.z) / 30));
  PT.smoke(cx, cy, cz, 30, [0.55, 0.55, 0.55]);
  PT.sparks(cx, cy, cz, [1, 0.7, 0.3]);
  if (simulating()) {
    const r = Math.ceil(power);
    for (let dy = -r; dy <= r; dy++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      const d = Math.hypot(dx, dy, dz);
      // borda irregular
      if (d > power * (0.75 + Math.random() * 0.35)) continue;
      const x = Math.floor(cx) + dx, y = Math.floor(cy) + dy, z = Math.floor(cz) + dz;
      if (y < 1 || y > 126) continue;
      const id = w.getBlock(x, y, z);
      if (!id) continue;
      const def = BLOCKS[id];
      if (!def || def.hard < 0 || id === B.BEDROCK) continue;
      if (def.liquid) continue;
      // blocos duros resistem perto da borda
      if ((def.hard || 0) > 4 && d > power * 0.5) continue;
      if (def.tnt) { set(x, y, z, B.AIR, 0); hook('primeTNT', x, y, z, 0.4 + Math.random() * 0.6); continue; }
      // destroços: parte vira item, o resto vira poeira
      if (Math.random() < 0.3) hook('breakBlock', x, y, z, true);
      else { set(x, y, z, B.AIR, 0); if (Math.random() < 0.25) hook('particles', x, y, z, id); }
    }
    // fogo em volta (explosões quentes)
    for (let i = 0; i < 4; i++) {
      const x = Math.floor(cx + (Math.random() - 0.5) * power * 2), z = Math.floor(cz + (Math.random() - 0.5) * power * 2);
      let y = Math.floor(cy);
      while (y > 1 && !SOLID[w.getBlock(x, y - 1, z)]) y--;
      if (Math.random() < 0.35) ignite(x, y, z);
    }
  }
  // dano e empurrão nas criaturas e no jogador
  hook('explosionDamage', cx, cy, cz, power);
}

// ---------------- atualização ----------------
let budgetT = 0;
export function updateWorldPhysics(dt) {
  if (!G.world || !simulating()) { flowQ.clear(); return; }
  let n = 0;
  for (const [k, q] of flowQ) {
    q.t -= dt;
    if (q.t > 0) continue;
    flowQ.delete(k);
    flowTick(q.x, q.y, q.z);
    if (++n > 160) break; // limite por quadro (lagos grandes não travam o jogo)
  }
  n = 0;
  for (const [k, q] of fireQ) {
    q.t -= dt;
    if (q.t > 0) continue;
    fireQ.delete(k);
    fireTick(q.x, q.y, q.z);
    if (++n > 40) break;
  }
  // lava acende coisas inflamáveis por perto de vez em quando
  budgetT -= dt;
  if (budgetT <= 0 && G.player) {
    budgetT = 0.5;
    const w = G.world, p = G.player.pos;
    for (let i = 0; i < 6; i++) {
      const x = Math.floor(p.x + (Math.random() - 0.5) * 40), y = Math.floor(p.y + (Math.random() - 0.5) * 20), z = Math.floor(p.z + (Math.random() - 0.5) * 40);
      if (w.peekBlock(x, y, z) !== B.LAVA) continue;
      const tx = x + Math.floor(Math.random() * 3) - 1, ty = y + 1 + Math.floor(Math.random() * 2), tz = z + Math.floor(Math.random() * 3) - 1;
      if (w.getBlock(tx, ty, tz) === B.AIR && [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]].some(([dx, dy, dz]) => isFlammable(w.getBlock(tx + dx, ty + dy, tz + dz))) && Math.random() < 0.3) ignite(tx, ty, tz);
    }
  }
}
export function clearWorldPhysics() { flowQ.clear(); fireQ.clear(); }
export const _debug = { flowQ, fireQ };
