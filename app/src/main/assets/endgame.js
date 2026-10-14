// Fim de jogo: portais (Nether e End), olho e pérola do ender, a luta contra o Dragão do End e os créditos.
// O caminho para "zerar": obsidiana → portal do Nether → varas de blaze na fortaleza do Nether →
// pérolas dos endermen → olhos do ender → seguir os olhos até a Fortaleza → ativar o portal → derrotar o dragão
// → entrar no portal de saída.
import * as THREE from './lib/three.module.min.js';
import { G, hook } from './state.js';
import { B, SOLID } from './blocks.js';
import { END_ISLAND_Y, endPillars } from './dimgen.js';
import { raycast } from './physics.js';
import { E, spawnMob, shootArrow } from './entities.js';
import { MOBS } from './mobs.js';
import * as PT from './particles.js';

// estado salvo com o mundo
export const END = { dragonDead: false, dragonHp: 200, crystals: null, completed: false, visited: {} };
export function endJSON() { return { egg: !!END.egg, dragonDead: END.dragonDead, dragonHp: Math.round(END.dragonHp), crystals: END.crystals, completed: END.completed, visited: END.visited }; }
export function loadEnd(s) {
  END.dragonDead = !!(s && s.dragonDead); END.dragonHp = s && s.dragonHp > 0 ? s.dragonHp : MOBS.dragon.hp;
  END.crystals = s && Array.isArray(s.crystals) ? s.crystals : null; END.completed = !!(s && s.completed); END.visited = (s && s.visited) || {}; END.egg = !!(s && s.egg);
}

const ST = { portalT: 0, cool: 0, inside: false, eyes: [], beam: null, bar: null, overlay: null, breaking: false, credits: false, roarT: 0 };
const $ = (id) => document.getElementById(id);
const get = (x, y, z) => G.world.getBlock(x, y, z);
const put = (x, y, z, id, m = 0) => G.world.setBlock(x, y, z, id, m);
const isOpen = (id) => id === B.AIR || id === B.FIRE;

export function initEndgame(scene) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 1, 0], 3));
  ST.beam = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xff66ff, transparent: true, opacity: 0.85 }));
  ST.beam.frustumCulled = false; ST.beam.visible = false;
  scene.add(ST.beam);
  ST.eyeGeo = new THREE.SphereGeometry(0.16, 10, 8);
  ST.eyeMat = new THREE.MeshBasicMaterial({ color: 0x55dd99 });
  // barra de vida do chefe e brilho roxo do portal
  ST.bar = document.createElement('div'); ST.bar.id = 'boss-bar';
  ST.bar.innerHTML = '<div class="boss-name">Dragão do End</div><div class="boss-track"><div class="boss-fill"></div></div>';
  ST.overlay = document.createElement('div'); ST.overlay.id = 'portal-overlay';
  document.body.append(ST.bar, ST.overlay);
}

// ---------------- portal do Nether ----------------
// procura uma moldura retangular de obsidiana (interior de 2×3 até 21×21) que contenha (x, y, z)
function findFrame(x, y, z, ax, az) {
  const at = (i, j) => get(x + ax * i, y + j, z + az * i);
  let j0 = 0; while (j0 > -21 && isOpen(at(0, j0 - 1))) j0--;
  if (at(0, j0 - 1) !== B.OBSIDIAN) return null;
  let i0 = 0; while (i0 > -21 && isOpen(at(i0 - 1, j0))) i0--;
  let i1 = 0; while (i1 < 21 && isOpen(at(i1 + 1, j0))) i1++;
  if (at(i0 - 1, j0) !== B.OBSIDIAN || at(i1 + 1, j0) !== B.OBSIDIAN) return null;
  const wdt = i1 - i0 + 1;
  if (wdt < 2 || wdt > 21) return null;
  let h = 0;
  for (; h < 22; h++) {
    let allObs = true, allOpen = true;
    for (let i = i0; i <= i1; i++) { const id = at(i, j0 + h); if (id !== B.OBSIDIAN) allObs = false; if (!isOpen(id)) allOpen = false; }
    if (allObs) break;
    if (!allOpen || at(i0 - 1, j0 + h) !== B.OBSIDIAN || at(i1 + 1, j0 + h) !== B.OBSIDIAN) return null;
  }
  if (h < 3 || h > 21) return null;
  for (let i = i0; i <= i1; i++) if (at(i, j0 - 1) !== B.OBSIDIAN) return null;
  const cells = [];
  for (let j = 0; j < h; j++) for (let i = i0; i <= i1; i++) cells.push([x + ax * i, y + j0 + j, z + az * i]);
  return cells;
}
// isqueiro dentro de uma moldura: acende o portal
export function lightPortal(x, y, z) {
  if (!G.world || !isOpen(get(x, y, z))) return false;
  for (const [ax, az] of [[1, 0], [0, 1]]) {
    const cells = findFrame(x, y, z, ax, az);
    if (!cells) continue;
    for (const [cx, cy, cz] of cells) hook('setBlock', cx, cy, cz, B.NETHER_PORTAL, ax ? 0 : 1);
    hook('sound', 'portal_open');
    PT.sparks(x + 0.5, y + 0.5, z + 0.5, [0.7, 0.3, 1]);
    hook('toast', G.world.dim === 'end' ? 'O portal não funciona no End.' : '🟪 Portal aceso! Fique dentro dele por alguns segundos.');
    return true;
  }
  return false;
}
// quebrar a moldura (ou o próprio portal) apaga o portal inteiro
export function portalBlockChanged(x, y, z, oldId, newId) {
  if (ST.breaking || newId === B.NETHER_PORTAL || (oldId !== B.OBSIDIAN && oldId !== B.NETHER_PORTAL)) return;
  ST.breaking = true;
  const q = [[x, y, z]], seen = new Set();
  let n = 0;
  while (q.length && n < 600) {
    const [cx, cy, cz] = q.pop();
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      const px = cx + dx, py = cy + dy, pz = cz + dz, k = px + ',' + py + ',' + pz;
      if (seen.has(k)) continue;
      seen.add(k);
      if (get(px, py, pz) === B.NETHER_PORTAL) { hook('setBlock', px, py, pz, B.AIR, 0); q.push([px, py, pz]); n++; }
    }
  }
  ST.breaking = false;
}

// ---------------- portal do End ----------------
const RING = [];
for (let i = -1; i <= 1; i++) RING.push([i, -2], [i, 2], [-2, i], [2, i]);
export function useEndFrame(x, y, z) {
  const pl = G.player, s = pl.held();
  if (!s || s.k !== 'eye_of_ender') { hook('toast', 'Coloque um Olho do ender nesta moldura.'); return true; }
  hook('setBlock', x, y, z, B.END_FRAME_EYE, 0);
  if (G.mode !== 'creative') hook('consumeHeld');
  hook('sound', 'eye'); pl.swing = 1;
  PT.sparks(x + 0.5, y + 1, z + 0.5, [0.4, 1, 0.7]);
  // os 12 blocos da moldura com olho: abre o portal no centro
  for (let cz = z - 2; cz <= z + 2; cz++) for (let cx = x - 2; cx <= x + 2; cx++) {
    if (RING.every(([dx, dz]) => get(cx + dx, y, cz + dz) === B.END_FRAME_EYE)) {
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) hook('setBlock', cx + dx, y, cz + dz, B.END_PORTAL, 0);
      hook('sound', 'portal_open');
      hook('toast', '🌌 O portal do End foi ativado! Pule dentro dele quando estiver pronto.');
      return true;
    }
  }
  const left = (() => { let best = 12; for (let cz = z - 2; cz <= z + 2; cz++) for (let cx = x - 2; cx <= x + 2; cx++) { const n = RING.filter(([dx, dz]) => get(cx + dx, y, cz + dz) === B.END_FRAME_EYE).length; const frames = RING.filter(([dx, dz]) => { const id = get(cx + dx, y, cz + dz); return id === B.END_FRAME || id === B.END_FRAME_EYE; }).length; if (frames === 12) best = Math.min(best, 12 - n); } return best; })();
  if (left < 12) hook('toast', `Faltam ${left} olho(s) na moldura.`);
  return true;
}

// ---------------- itens: olho e pérola do ender ----------------
const DIRS = ['leste', 'sudeste', 'sul', 'sudoeste', 'oeste', 'noroeste', 'norte', 'nordeste'];
export function useItem(kind) {
  const pl = G.player, w = G.world;
  const e = pl.eyePos();
  const dir = { x: -Math.sin(pl.yaw) * Math.cos(pl.pitch), y: Math.sin(pl.pitch), z: -Math.cos(pl.yaw) * Math.cos(pl.pitch) };
  if (kind === 'eye') {
    if (w.dim !== 'overworld' || !w.gen.strongholdPos) { hook('toast', 'O olho do ender não reage nesta dimensão.'); return true; }
    const sh = w.gen.strongholdPos();
    const dx = sh.x + 0.5 - e.x, dz = sh.z + 2.5 - e.z, d = Math.hypot(dx, dz);
    const mesh = new THREE.Mesh(ST.eyeGeo, ST.eyeMat);
    mesh.position.set(e.x, e.y, e.z);
    G.scene.add(mesh);
    ST.eyes.push({ mesh, vx: dx / (d || 1), vz: dz / (d || 1), t: 0, near: d < 14, d });
    if (G.mode !== 'creative') hook('consumeHeld');
    hook('sound', 'eye'); pl.swing = 1;
    const ang = Math.atan2(dz, dx);
    const dirName = DIRS[((Math.round(ang / (Math.PI / 4)) % 8) + 8) % 8];
    hook('toast', d < 14 ? '👁 O olho afundou no chão: a Fortaleza está bem embaixo de você (cave para baixo)!' : `👁 O olho voou para o ${dirName}. Siga-o!`);
    return true;
  }
  if (kind === 'pearl') {
    const h = raycast(e, dir, 40);
    if (!h) { hook('toast', 'Longe demais.'); return true; }
    const tx = h.x + h.face[0], ty = h.y + h.face[1], tz = h.z + h.face[2];
    let y = ty;
    while (y < ty + 3 && (SOLID[get(tx, y, tz)] || SOLID[get(tx, y + 1, tz)])) y++;
    if (SOLID[get(tx, y, tz)] || SOLID[get(tx, y + 1, tz)]) { hook('toast', 'Não há espaço lá.'); return true; }
    PT.smoke(pl.pos.x, pl.pos.y + 1, pl.pos.z, 12, [0.4, 0.2, 0.6]);
    pl.pos.x = tx + 0.5; pl.pos.y = y; pl.pos.z = tz + 0.5; pl.vel.x = pl.vel.y = pl.vel.z = 0; pl.fallStartY = null;
    PT.smoke(pl.pos.x, pl.pos.y + 1, pl.pos.z, 12, [0.4, 0.2, 0.6]);
    if (G.mode !== 'creative') { hook('consumeHeld'); pl.damage(2, 'fall'); }
    hook('sound', 'elevator');
    return true;
  }
  return false;
}

// ---------------- viagem entre dimensões ----------------
// procura um portal existente perto do destino (chunks gerados na hora) ou constrói um novo
function findPortal(tx, tz, r) {
  const w = G.world;
  const c0x = Math.floor(tx / 16), c0z = Math.floor(tz / 16), rc = Math.ceil(r / 16);
  let best = null, bd = 1e9;
  for (let cz = c0z - rc; cz <= c0z + rc; cz++) for (let cx = c0x - rc; cx <= c0x + rc; cx++) {
    const c = w.getChunk(cx, cz);
    if (!c.data.includes(B.NETHER_PORTAL)) continue;
    for (let i = 0; i < c.data.length; i++) {
      if (c.data[i] !== B.NETHER_PORTAL) continue;
      const lx = i % 16, lz = ((i / 16) | 0) % 16, y = (i / 256) | 0;
      if (c.data[i - 256] === B.NETHER_PORTAL) continue; // só a base
      const x = cx * 16 + lx, z = cz * 16 + lz, d = Math.hypot(x - tx, z - tz);
      if (d < bd) { bd = d; best = { x, y, z }; }
    }
  }
  return best;
}
function buildPortal(tx, tz, dim) {
  const w = G.world;
  let y = -1;
  if (dim === 'nether') {
    // chão firme com 4 blocos de ar acima (acima do mar de lava)
    for (let yy = 34; yy < 110 && y < 0; yy++) {
      let ok = SOLID[get(tx, yy - 1, tz)] && get(tx, yy - 1, tz) !== B.LAVA;
      for (let k = 0; k < 4 && ok; k++) for (let i = -1; i <= 2 && ok; i++) if (get(tx + i, yy + k, tz) !== B.AIR) ok = false;
      if (ok) y = yy;
    }
    if (y < 0) y = 64;
  } else {
    y = Math.max(w.sea + 1, w.surfaceY(tx, tz) + 1);
    if (y < 2) y = 70;
  }
  // espaço livre, plataforma de obsidiana e moldura 4×5 com o portal 2×3
  for (let k = 0; k < 4; k++) for (let dz = -1; dz <= 1; dz++) for (let i = -1; i <= 2; i++) put(tx + i, y + k, tz + dz, B.AIR, 0);
  for (let dz = -1; dz <= 1; dz++) for (let i = -1; i <= 2; i++) put(tx + i, y - 1, tz + dz, B.OBSIDIAN, 0);
  for (let k = 0; k <= 3; k++) { put(tx - 1, y + k, tz, B.OBSIDIAN, 0); put(tx + 2, y + k, tz, B.OBSIDIAN, 0); }
  for (let i = 0; i <= 1; i++) put(tx + i, y + 3, tz, B.OBSIDIAN, 0);
  for (let k = 0; k < 3; k++) for (let i = 0; i <= 1; i++) put(tx + i, y + k, tz, B.NETHER_PORTAL, 0);
  return { x: tx, y, z: tz };
}
// posição de chegada na nova dimensão (null = ponto de renascimento do mundo normal)
export function arrival(dim, from, pos, how) {
  ST.inside = true; ST.portalT = 0; ST.cool = 2;
  if (dim === 'end') {
    // plataforma de obsidiana fora da ilha (como no original)
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
      put(100 + dx, 48, dz, B.OBSIDIAN, 0);
      for (let k = 1; k <= 3; k++) put(100 + dx, 48 + k, dz, B.AIR, 0);
    }
    return { x: 100.5, y: 49, z: 0.5, yaw: Math.PI / 2 };
  }
  if (how !== 'portal' || from === 'end') return null;
  const k = dim === 'nether' ? 1 / 8 : 8;
  const tx = Math.floor(pos.x * k), tz = Math.floor(pos.z * k);
  const p = findPortal(tx, tz, dim === 'nether' ? 24 : 64) || buildPortal(tx, tz, dim);
  return { x: p.x + 0.5, y: p.y, z: p.z + 0.5 };
}
// a luta: cristais nos pilares e o dragão (só enquanto ele não foi derrotado)
export function onEnterDim(dim) {
  END.visited[dim] = true;
  hook('challengeEvent', 'dimension', dim);
  if (dim === 'nether') hook('toast', '🔥 Você entrou no Nether! Procure uma fortaleza de tijolos escuros: lá vivem os blazes.');
  if (dim !== 'end') return;
  if (END.dragonDead) { hook('toast', 'O End está calmo. O portal de saída fica no centro da ilha.'); placeExit(); return; }
  hook('toast', '🐉 Você entrou no End! Destrua os cristais no topo dos pilares (com flechas) e derrote o dragão.');
  const pillars = endPillars(G.world.seed);
  if (!END.crystals || END.crystals.length !== pillars.length) END.crystals = pillars.map(() => true);
  pillars.forEach((p, i) => {
    if (!END.crystals[i]) return;
    const c = spawnMob('crystal', p.x + 0.5, p.top + 2, p.z + 0.5);
    c.pillar = i; c.baseY = p.top + 2;
  });
  const d = spawnMob('dragon', 0.5, END_ISLAND_Y + 30, 30.5);
  d.health = END.dragonHp;
  hook('sound', 'roar');
}

// ---------------- dragão ----------------
const _v = new THREE.Vector3();
export function bossAI(e, dt) {
  const pl = G.player;
  if (e.type === 'crystal') {
    e.yaw += dt * 1.6;
    e.pos.y = e.baseY + Math.sin(G.time * 2 + (e.pillar || 0)) * 0.25;
    return;
  }
  const s = e.ai || (e.ai = { mode: 'circle', t: 0, a: Math.atan2(e.pos.z, e.pos.x), fireT: 6, hitT: 0 });
  s.t += dt; s.hitT = Math.max(0, s.hitT - dt);
  e.flap = (e.flap || 0) + dt * (s.mode === 'dive' ? 7 : 4.5);
  // cura com o cristal vivo mais próximo
  let healer = null, bd = 64;
  for (const c of E.list) if (c.type === 'crystal' && !c.dead) { const d = Math.hypot(c.pos.x - e.pos.x, c.pos.y - e.pos.y, c.pos.z - e.pos.z); if (d < bd) { bd = d; healer = c; } }
  if (healer && e.health < MOBS.dragon.hp) e.health = Math.min(MOBS.dragon.hp, e.health + dt * 1.2);
  e.healer = healer;
  const fight = !pl.dead && G.mode !== 'creative' && G.mode !== 'peaceful';
  const pd = Math.hypot(pl.pos.x - e.pos.x, pl.pos.y - e.pos.y, pl.pos.z - e.pos.z);
  let tx, ty, tz, speed = 13;
  if (s.mode === 'circle') {
    s.a += dt * 0.3;
    const r = 46 + Math.sin(s.t * 0.25) * 10;
    tx = Math.cos(s.a) * r; tz = Math.sin(s.a) * r; ty = END_ISLAND_Y + 24 + Math.sin(s.t * 0.6) * 6;
    s.fireT -= dt;
    if (fight && s.fireT <= 0 && pd < 70) {
      s.fireT = 4 + Math.random() * 3;
      const from = { x: e.pos.x, y: e.pos.y + 3, z: e.pos.z };
      const ex = pl.pos.x - from.x, ey = pl.pos.y + 1 - from.y, ez = pl.pos.z - from.z, ed = Math.hypot(ex, ey, ez);
      const a = shootArrow(from, { x: ex / ed, y: ey / ed, z: ez / ed }, e, 20);
      a.fire = true; a.dmg = 6;
    }
    if (fight && s.t > 10 + Math.random() * 4 && pd < 100) { s.mode = 'dive'; s.t = 0; hook('sound', 'roar'); }
  } else if (s.mode === 'dive') {
    tx = pl.pos.x; ty = pl.pos.y + 0.5; tz = pl.pos.z; speed = 18;
    if (s.t > 7 || !fight) { s.mode = 'climb'; s.t = 0; }
  } else {
    // sobe e volta a circular
    tx = e.pos.x * 1.2; tz = e.pos.z * 1.2; ty = END_ISLAND_Y + 34; speed = 14;
    if (s.t > 3) { s.mode = 'circle'; s.t = 0; s.a = Math.atan2(e.pos.z, e.pos.x); }
  }
  // voo suave na direção do alvo (atravessa blocos)
  _v.set(tx - e.pos.x, ty - (e.pos.y + 3), tz - e.pos.z);
  const dl = _v.length() || 1;
  _v.multiplyScalar(speed / dl);
  const k = Math.min(1, dt * 1.6);
  e.vel.x += (_v.x - e.vel.x) * k; e.vel.y += (_v.y - e.vel.y) * k; e.vel.z += (_v.z - e.vel.z) * k;
  e.pos.x += e.vel.x * dt; e.pos.y += e.vel.y * dt; e.pos.z += e.vel.z * dt;
  if (e.pos.y < END_ISLAND_Y - 6) e.pos.y = END_ISLAND_Y - 6;
  const hv = Math.hypot(e.vel.x, e.vel.z);
  if (hv > 0.5) e.yaw = Math.atan2(e.vel.x, e.vel.z);
  e.headPitch = Math.max(-0.6, Math.min(0.6, -Math.atan2(e.vel.y, hv) * 0.7));
  e.walkAmt = 0;
  // contato: mordida/empurrão
  const cx = pl.pos.x - e.pos.x, cy = pl.pos.y + 1 - (e.pos.y + 3), cz = pl.pos.z - e.pos.z;
  if (fight && s.hitT <= 0 && Math.hypot(cx, cy, cz) < 4.2) {
    s.hitT = 1.2;
    pl.damage(s.mode === 'dive' ? 7 : 4, 'mob', e);
    const d = Math.hypot(cx, cz) || 1;
    pl.vel.x += cx / d * 14; pl.vel.z += cz / d * 14; pl.vel.y = 9;
    if (s.mode === 'dive') { s.mode = 'climb'; s.t = 0; }
  }
  END.dragonHp = e.health;
  ST.roarT -= dt;
  if (ST.roarT <= 0) { ST.roarT = 14 + Math.random() * 10; if (pd < 90) hook('sound', 'roar'); }
}
export function dragonKilled(e) {
  END.dragonDead = true; END.dragonHp = 0;
  hook('sound', 'explode'); hook('cameraShake', 0.8);
  for (let i = 0; i < 12; i++) PT.sparks(e.pos.x + (Math.random() - 0.5) * 6, e.pos.y + 2 + Math.random() * 4, e.pos.z + (Math.random() - 0.5) * 6, [0.9, 0.5, 1]);
  placeExit();
  hook('toast', '🏆 Você derrotou o Dragão do End! O portal de saída se abriu no centro da ilha.');
  hook('sound', 'levelup');
}
export function crystalKilled(e) {
  if (END.crystals && e.pillar != null) END.crystals[e.pillar] = false;
  hook('explode', Math.floor(e.pos.x), Math.floor(e.pos.y), Math.floor(e.pos.z), 2.4);
}
// portal de saída (bacia de rocha-mãe no centro) e o ovo do dragão no topo da coluna
function placeExit() {
  const y0 = END_ISLAND_Y;
  for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) {
    const r = Math.hypot(dx, dz);
    if (r > 0.5 && r <= 2.6 && get(dx, y0 + 1, dz) !== B.END_PORTAL) put(dx, y0 + 1, dz, B.END_PORTAL, 0);
  }
  if (!END.egg) { put(0, y0 + 5, 0, B.DRAGON_EGG, 0); END.egg = true; }
}

// ---------------- por quadro ----------------
export function updateEndgame(dt) {
  const pl = G.player, w = G.world;
  if (!pl || !w || ST.credits) return;
  ST.cool = Math.max(0, ST.cool - dt);
  const x = Math.floor(pl.pos.x), z = Math.floor(pl.pos.z);
  const feet = get(x, Math.floor(pl.pos.y + 0.2), z), head = get(x, Math.floor(pl.pos.y + 1.2), z);
  const inNether = !pl.dead && (feet === B.NETHER_PORTAL || head === B.NETHER_PORTAL);
  const inEnd = !pl.dead && (feet === B.END_PORTAL || get(x, Math.floor(pl.pos.y - 0.05), z) === B.END_PORTAL);
  if (!inNether && !inEnd) ST.inside = false;
  if (inNether && !ST.inside && ST.cool <= 0) {
    if (ST.portalT === 0) hook('sound', 'portal');
    ST.portalT += dt;
    const need = G.mode === 'creative' ? 1 : 3.5;
    if (ST.portalT >= need) { ST.portalT = 0; ST.inside = true; hook('changeDimension', w.dim === 'nether' ? 'overworld' : 'nether', 'portal'); }
  } else ST.portalT = Math.max(0, ST.portalT - dt * 2);
  if (inEnd && !ST.inside && ST.cool <= 0) {
    ST.inside = true;
    if (w.dim === 'end') showCredits();
    else hook('changeDimension', 'end', 'portal');
  }
  if (ST.overlay) ST.overlay.style.opacity = Math.min(0.85, ST.portalT / 2.5).toFixed(2);
  // olhos do ender voando
  ST.eyes = ST.eyes.filter((o) => {
    o.t += dt;
    const m = o.mesh.position;
    if (o.near) { m.y -= dt * 1.5; }
    else if (o.t < 2.2) { m.x += o.vx * dt * 6; m.z += o.vz * dt * 6; m.y += dt * 1.4; }
    else m.y += Math.sin(o.t * 8) * dt * 0.3;
    if (Math.random() < 0.7) PT.smoke(m.x, m.y, m.z, 1, [0.4, 0.9, 0.6]);
    if (o.t < 3) return true;
    G.scene.remove(o.mesh);
    if (Math.random() < 0.8) hook('dropItem', m.x, m.y, m.z, 'eye_of_ender', 1);
    else { PT.sparks(m.x, m.y, m.z, [0.4, 1, 0.6]); hook('toast', 'O olho do ender se quebrou.'); }
    return false;
  });
  // feixe de cura e barra de vida
  const dragon = w.dim === 'end' ? E.list.find((e) => e.type === 'dragon' && !e.dead) : null;
  if (ST.beam) {
    const hc = dragon && dragon.healer;
    ST.beam.visible = !!hc;
    if (hc) {
      const a = ST.beam.geometry.attributes.position;
      a.setXYZ(0, hc.pos.x, hc.pos.y + 1, hc.pos.z); a.setXYZ(1, dragon.pos.x, dragon.pos.y + 3.5, dragon.pos.z); a.needsUpdate = true;
    }
  }
  if (ST.bar) {
    const show = !!dragon && Math.hypot(dragon.pos.x - pl.pos.x, dragon.pos.z - pl.pos.z) < 200;
    ST.bar.style.display = show ? 'block' : 'none';
    if (show) ST.bar.querySelector('.boss-fill').style.width = (100 * Math.max(0, dragon.health) / MOBS.dragon.hp).toFixed(1) + '%';
  }
}
export function resetEndgameVisuals() {
  for (const o of ST.eyes) G.scene.remove(o.mesh);
  ST.eyes = [];
  if (ST.beam) ST.beam.visible = false;
  if (ST.bar) ST.bar.style.display = 'none';
  if (ST.overlay) ST.overlay.style.opacity = 0;
  ST.portalT = 0;
}

// ---------------- créditos ----------------
function fmtDist(m) { return m >= 1000 ? (m / 1000).toFixed(1) + ' km' : Math.round(m) + ' m'; }
export function showCredits() {
  if (ST.credits) return;
  ST.credits = true;
  const first = !END.completed;
  END.completed = true;
  if (G.meta) G.meta.completed = true;
  hook('creditsOpen');
  const st = G.player.stats;
  const box = document.createElement('div'); box.id = 'credits';
  const roll = document.createElement('div'); roll.className = 'credits-roll';
  roll.innerHTML = `
    <h1>🏆 Você zerou o VoxelCraft HD!</h1>
    <p class="big">O Dragão do End foi derrotado e o portal te leva de volta para casa.</p>
    <h2>Sua jornada</h2>
    <p>Dias vividos: <b>${(G.day || 0) + 1}</b></p>
    <p>Distância percorrida: <b>${fmtDist(st.distance || 0)}</b></p>
    <p>Blocos quebrados: <b>${st.blocksBroken || 0}</b> · colocados: <b>${st.blocksPlaced || 0}</b></p>
    <p>Itens fabricados: <b>${st.crafted || 0}</b></p>
    <p>Criaturas derrotadas: <b>${st.mobsKilled || 0}</b></p>
    <p>Noites sobrevividas: <b>${st.nightsSurvived || 0}</b> · mortes: <b>${st.deaths || 0}</b></p>
    <h2>Créditos</h2>
    <p>Mundo, Nether e End gerados por procedimento</p>
    <p>Gráficos: three.js · sombras em cascata · céu físico</p>
    <p>Feito com Claude Code para você 💜</p>
    <p class="big">O mundo continua: explore, construa e volte ao End quando quiser.</p>`;
  const btn = document.createElement('button'); btn.className = 'primary'; btn.textContent = first ? 'Voltar ao mundo' : 'Continuar';
  btn.onclick = () => { box.remove(); ST.credits = false; hook('creditsClosed'); hook('changeDimension', 'overworld', 'credits'); };
  box.append(roll, btn);
  document.body.appendChild(box);
  hook('sound', 'levelup');
}
