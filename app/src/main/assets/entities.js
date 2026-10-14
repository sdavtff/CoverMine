// Entidades: itens no chão, criaturas (IA), aldeões, flechas e veículos (barco, carrinho, cavalo).
import * as THREE from './lib/three.module.min.js';
import { G, hook } from './state.js';
import { MOBS, PROFESSIONS, PROFESSION_LIST } from './mobs.js';
import { InstancedModel, makeTexture } from './models.js';
import { stepEntity, collides, liquidAt } from './physics.js';
import { B, BLOCKS, SOLID, LOPQ, EMIT, LIQUID, FULL } from './blocks.js';
import { ITEMS } from './items.js';
import { R } from './render.js';
import { HAND, blockCubeMesh } from './hand.js';
import * as PT from './particles.js';
import { BIOME } from './worldgen.js';
import { patchEntityMaterial } from './shaders.js';
import { makeTrades, makeQuest } from './villagers.js';

export const E = { list: [], models: {}, nextId: 1, spawnT: 0, hostileT: 0, villages: new Set(), corpses: [] };
const CAP_PASSIVE = 30, CAP_HOSTILE = 12, CAP_FISH = 8;

// ---------------- base ----------------
class Ent {
  constructor(kind, x, y, z) {
    this.id = E.nextId++;
    this.kind = kind;
    this.pos = { x, y, z };
    this.vel = { x: 0, y: 0, z: 0 };
    this.yaw = Math.random() * Math.PI * 2;
    this.hw = 0.3; this.hh = 0.6;
    this.onGround = false;
    this.dead = false;
    this.age = 0;
    this.light = 1; this.lightT = 0;
  }
  distTo(p) { return Math.hypot(this.pos.x - p.x, this.pos.y - p.y, this.pos.z - p.z); }
}

// ---------------- luz local (para escurecer criaturas em cavernas e permitir spawn hostil) ----------------
function skyVisible(x, y, z) {
  const w = G.world;
  for (let yy = Math.floor(y) + 1; yy < 127; yy++) {
    const id = w.peekBlock(Math.floor(x), yy, Math.floor(z));
    if (id === null) return true;
    if (LOPQ[id]) return false;
  }
  return true;
}
function nearLight(x, y, z, r) {
  const w = G.world;
  for (let dy = -3; dy <= 3; dy++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
    const id = w.peekBlock(Math.floor(x) + dx, Math.floor(y) + dy, Math.floor(z) + dz);
    if (id && EMIT[id] >= 10) return Math.max(0, 1 - (Math.abs(dx) + Math.abs(dz) + Math.abs(dy)) / 14);
  }
  return 0;
}
function lightAt(e) {
  const day = R.sky01 ? 0.25 + 0.75 * R.sky01.day : 1;
  const sky = skyVisible(e.pos.x, e.pos.y + e.hh, e.pos.z) ? day : 0.12;
  return Math.max(0.1, sky, nearLight(e.pos.x, e.pos.y, e.pos.z, 4) * 0.9);
}

// ---------------- criaturas ----------------
export class Mob extends Ent {
  constructor(type, x, y, z, variant) {
    super('mob', x, y, z);
    const t = MOBS[type];
    this.type = type;
    this.variant = variant || (t.variants ? t.variants[Math.floor(Math.random() * t.variants.length)] : null);
    this.hw = t.hw; this.hh = t.hh;
    this.health = t.hp;
    this.walk = 0; this.walkAmt = 0; this.headYaw = 0;
    this.target = null; this.wanderT = Math.random() * 4; this.flee = 0; this.love = 0; this.cool = 0; this.hurt = 0;
    this.baby = 0; // segundos restantes como filhote
    this.burnT = 0;
    if (t.npc) { this.profession = this.variant; this.trades = null; this.quest = null; this.home = null; this.village = null; }
  }
  get T() { return MOBS[this.type]; }
  get scale() { return (this.baby > 0 ? 0.55 : 1) * (this.T.scale || 1); }
}

// ---------------- itens no chão ----------------
class ItemEnt extends Ent {
  constructor(x, y, z, k, n, d) {
    super('item', x, y, z);
    this.k = k; this.n = n; this.d = d || 0;
    this.hw = 0.15; this.hh = 0.3;
    this.vel.x = (Math.random() - 0.5) * 2; this.vel.y = 3; this.vel.z = (Math.random() - 0.5) * 2;
    this.pickup = 0.6;
    this.spin = Math.random() * 6;
  }
}
class Arrow extends Ent {
  constructor(x, y, z, vx, vy, vz, owner, dmg) {
    super('arrow', x, y, z);
    this.vel = { x: vx, y: vy, z: vz };
    this.owner = owner; this.dmg = dmg; this.stuck = false; this.hw = 0.05; this.hh = 0.1;
  }
}

// ---------------- veículos ----------------
class Vehicle extends Ent {
  constructor(kind, x, y, z) {
    super(kind, x, y, z);
    this.hw = kind === 'boat' ? 0.65 : 0.45; this.hh = kind === 'boat' ? 0.55 : 0.7;
    this.seatY = kind === 'boat' ? 0.25 : 0.45;
    this.rider = null; this.health = 6; this.speed = 0;
  }
  controlBy(pl, dt, input) {
    if (input.sneakPressed || pl.dead) { dismount(pl); return; }
    if (this.kind === 'boat') {
      const inW = liquidAt(this.pos.x, this.pos.y + 0.1, this.pos.z) === B.WATER || liquidAt(this.pos.x, this.pos.y - 0.2, this.pos.z) === B.WATER;
      const sp = inW ? 7 : 1.2;
      const fx = -Math.sin(pl.yaw), fz = -Math.cos(pl.yaw), rx = Math.cos(pl.yaw), rz = -Math.sin(pl.yaw);
      const tx = (fx * input.mz + rx * input.mx) * sp, tz = (fz * input.mz + rz * input.mx) * sp;
      this.vel.x += (tx - this.vel.x) * Math.min(1, dt * 2);
      this.vel.z += (tz - this.vel.z) * Math.min(1, dt * 2);
      if (Math.hypot(this.vel.x, this.vel.z) > 0.3) this.yaw = lerpAngle(this.yaw, Math.atan2(-this.vel.x, -this.vel.z), dt * 3);
    } else if (this.kind === 'minecart') {
      const dir = railDir(this);
      if (dir) {
        const fx = -Math.sin(pl.yaw), fz = -Math.cos(pl.yaw);
        const along = fx * dir[0] + fz * dir[1];
        this.speed += input.mz * Math.sign(along || 1) * dt * 6;
      }
    }
    pl.pos.x = this.pos.x; pl.pos.y = this.pos.y; pl.pos.z = this.pos.z;
    pl.vel.x = pl.vel.y = pl.vel.z = 0;
    pl.fallStartY = null;
  }
}
function lerpAngle(a, b, t) { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return a + d * Math.min(1, t); }
function dismount(pl) {
  const v = pl.riding;
  pl.riding = null;
  if (v) { v.rider = null; pl.pos.y = v.pos.y + 1.1; pl.pos.x += 0.8; }
}
// direção do trilho sob o carrinho (x, z) ou null
const RAIL_DIRS = [[0, 1], [1, 0], null, null, null, null];
function railDir(c) {
  const w = G.world;
  const x = Math.floor(c.pos.x), y = Math.floor(c.pos.y + 0.1), z = Math.floor(c.pos.z);
  if (w.getBlock(x, y, z) !== B.RAIL) return null;
  const m = w.getMeta(x, y, z) & 7;
  if (m < 2) return RAIL_DIRS[m];
  // curvas: escolhe o eixo conforme a direção atual
  const v = c.lastDir || [0, 1];
  return Math.abs(v[0]) > Math.abs(v[1]) ? [1, 0] : [0, 1];
}

// ---------------- API ----------------
export function initEntities() {
  for (const type in MOBS) {
    const t = MOBS[type];
    const vars = t.variants || [null];
    E.models[type] = {};
    for (const v of vars) E.models[type][v] = new InstancedModel(t.def, makeTexture(t.tex(v)), type === 'fish' ? 16 : 40, G.scene);
  }
  // itens no chão: malhas reaproveitadas por chave
  E.itemGeo = new Map();
  E.itemGroup = new THREE.Group();
  G.scene.add(E.itemGroup);
  E.arrowGeo = new THREE.BoxGeometry(0.04, 0.04, 0.5);
  E.arrowMat = patchEntityMaterial(new THREE.MeshLambertMaterial({ color: 0x8a6238 }));
  E.vehicleMats = {};
  hookUp();
}
export function clearEntities() {
  E.corpses = [];
  for (const e of E.list) removeVisual(e);
  E.list = [];
  E.villages.clear();
}
function removeVisual(e) { if (e.mesh) { (e.mesh.parent || G.scene).remove(e.mesh); e.mesh = null; } }

export function spawnMob(type, x, y, z, variant) {
  const m = new Mob(type, x, y, z, variant);
  E.list.push(m);
  return m;
}
export function dropItem(x, y, z, k, n, d) {
  if (!ITEMS[k] || n <= 0) return;
  // funde com item igual próximo
  for (const e of E.list) if (e.kind === 'item' && !e.dead && e.k === k && ITEMS[k].stack > 1 && e.n + n <= ITEMS[k].stack && Math.abs(e.pos.x - x) < 1 && Math.abs(e.pos.y - y) < 1 && Math.abs(e.pos.z - z) < 1) { e.n += n; return; }
  const it = new ItemEnt(x, y, z, k, n, d);
  E.list.push(it);
  return it;
}
export function throwItem(k, n, d) {
  const pl = G.player;
  const e = pl.eyePos();
  const it = dropItem(e.x, e.y - 0.3, e.z, k, n, d);
  if (it) { it.vel.x = -Math.sin(pl.yaw) * 5; it.vel.z = -Math.cos(pl.yaw) * 5; it.vel.y = 2 + Math.sin(pl.pitch) * 4; it.pickup = 1.5; }
}
export function shootArrow(from, dir, owner, power) {
  const a = new Arrow(from.x, from.y, from.z, dir.x * power, dir.y * power, dir.z * power, owner, 2 + power / 8);
  E.list.push(a);
  hook('sound', 'bow');
  return a;
}

// ---------------- ganchos usados pela jogabilidade ----------------
function hookUp() {
  G.hooks.dropItem = (x, y, z, k, n, d) => dropItem(x, y, z, k, n, d);
  G.hooks.pickEntity = pickEntity;
  G.hooks.attackEntity = attackEntity;
  G.hooks.useEntity = useEntity;
  G.hooks.placeVehicle = placeVehicle;
  G.hooks.entityBlocks = (x, y, z) => E.list.some((e) => (e.kind === 'mob' || e.kind === 'boat' || e.kind === 'minecart') && !e.dead && e.pos.x + e.hw > x && e.pos.x - e.hw < x + 1 && e.pos.y + e.hh > y && e.pos.y < y + 1 && e.pos.z + e.hw > z && e.pos.z - e.hw < z + 1);
}

function rayAABB(o, d, e, maxT) {
  const s = e.kind === 'mob' ? e.scale : 1;
  const b = [e.pos.x - e.hw * s, e.pos.y, e.pos.z - e.hw * s, e.pos.x + e.hw * s, e.pos.y + e.hh * s, e.pos.z + e.hw * s];
  let tmin = 0, tmax = maxT;
  const O = [o.x, o.y, o.z], D = [d.x, d.y, d.z];
  for (let a = 0; a < 3; a++) {
    if (Math.abs(D[a]) < 1e-9) { if (O[a] < b[a] || O[a] > b[a + 3]) return null; continue; }
    let t1 = (b[a] - O[a]) / D[a], t2 = (b[a + 3] - O[a]) / D[a];
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  return tmin;
}
function pickEntity(o, d, maxT) {
  let best = null, bt = maxT;
  for (const e of E.list) {
    if (e.dead || !(e.kind === 'mob' || e.kind === 'boat' || e.kind === 'minecart') || e === G.player.riding) continue;
    if (Math.abs(e.pos.x - o.x) > 8 + e.hw || Math.abs(e.pos.z - o.z) > 8 + e.hw) continue;
    const t = rayAABB(o, d, e, bt);
    if (t !== null && t < bt) { bt = t; best = e; }
  }
  return best;
}

export function attackEntity(e, dmg, attacker) {
  if (e.dead) return;
  if (e.kind === 'boat' || e.kind === 'minecart') {
    e.health -= dmg;
    hook('sound', 'hit');
    if (e.health <= 0) { e.dead = true; if (e.rider) dismount(e.rider); if (G.mode !== 'creative') dropItem(e.pos.x, e.pos.y + 0.3, e.pos.z, e.kind, 1); }
    return;
  }
  const t = e.T;
  if (e.proxy) { if (hook('netHitMob', e, dmg)) { e.hurt = 0.3; hook('sound', 'hurt_mob', e.type); } return; }
  if (e.hurt > 0.15) return;
  e.health -= dmg;
  e.hurt = 0.4;
  if (attacker) {
    const dx = e.pos.x - attacker.pos.x, dz = e.pos.z - attacker.pos.z, dd = Math.hypot(dx, dz) || 1;
    e.vel.x += dx / dd * 6; e.vel.z += dz / dd * 6; e.vel.y = 5;
    if (t.passive || t.npc) e.flee = 5;
    if (t.hostile || t.neutral) e.target = attacker;
    if (t.boss) { e.vel.x = e.vel.y = e.vel.z = 0; }
    e.attacker = attacker;
  }
  // enderman: some ao ser atingido e reaparece perto
  if (t.teleports && e.health > 0 && Math.random() < 0.55) teleportMob(e);
  hook('sound', 'hurt_mob', e.type);
  PT.sparks(e.pos.x, e.pos.y + e.hh * 0.6, e.pos.z, [0.8, 0.1, 0.1]);
  if (e.health <= 0) killMob(e, attacker);
}
function teleportMob(e) {
  const w = G.world;
  for (let i = 0; i < 12; i++) {
    const x = Math.floor(e.pos.x + (Math.random() - 0.5) * 16), z = Math.floor(e.pos.z + (Math.random() - 0.5) * 16);
    for (let y = Math.floor(e.pos.y) + 6; y > Math.floor(e.pos.y) - 8; y--) {
      if (SOLID[w.getBlock(x, y - 1, z)] && !w.getBlock(x, y, z) && !w.getBlock(x, y + 1, z) && !w.getBlock(x, y + 2, z)) {
        PT.smoke(e.pos.x, e.pos.y + 1.5, e.pos.z, 14, [0.6, 0.2, 0.8]);
        e.pos.x = x + 0.5; e.pos.y = y; e.pos.z = z + 0.5; e.vel.x = e.vel.z = 0;
        PT.smoke(e.pos.x, e.pos.y + 1.5, e.pos.z, 14, [0.6, 0.2, 0.8]);
        hook('sound', 'elevator');
        return;
      }
    }
  }
}
function killMob(e, attacker) {
  e.dead = true;
  const t = e.T;
  if (t.onDeath) hook(t.onDeath, e, attacker);
  if (attacker === G.player && t.noCorpse) { G.player.stats.mobsKilled++; hook('challengeEvent', 'kill', e.type); return; }
  if (t.noCorpse) return;
  // corpo tomba de lado (com o empurrão do golpe) e some numa nuvem de fumaça
  E.corpses.push({ type: e.type, variant: e.variant, x: e.pos.x, y: e.pos.y, z: e.pos.z, yaw: e.yaw, scale: e.scale, t: 0, vx: e.vel.x * 0.4, vz: e.vel.z * 0.4, light: e.light || 1, side: Math.random() < 0.5 ? 1 : -1, hh: e.hh });
  hook('sound', 'death_mob', e.type);
  if (e.baby > 0) return;
  for (const [k, a, b] of t.drops) {
    const n = b < 1 ? (Math.random() < b ? 1 : 0) : a + Math.floor(Math.random() * (b - a + 1));
    if (n > 0) dropItem(e.pos.x, e.pos.y + 0.5, e.pos.z, e.burnT > 0 && ITEMS['cooked_' + k] ? 'cooked_' + k : k, n);
  }
  if (t.wool && e.variant !== 'sheared') dropItem(e.pos.x, e.pos.y + 0.5, e.pos.z, 'wool_' + e.variant, 1);
  if (e.saddled) dropItem(e.pos.x, e.pos.y + 0.5, e.pos.z, 'saddle', 1);
  if (attacker === G.player) { G.player.stats.mobsKilled++; hook('challengeEvent', 'kill', e.type); }
}

function useEntity(e, held) {
  const pl = G.player;
  if (e.kind === 'boat' || e.kind === 'minecart') { if (!e.rider) { pl.riding = e; e.rider = pl; hook('toast', 'Use o botão ▼ (ou Shift) para descer.'); } return true; }
  const t = e.T;
  if (t.npc) { hook('openScreen', 'villager', { mob: e }); return true; }
  // tosquiar ovelha
  if (t.wool && held && held.k === 'shears' && e.variant !== 'sheared' && e.baby <= 0) {
    dropItem(e.pos.x, e.pos.y + 1, e.pos.z, 'wool_' + e.variant, 1 + Math.floor(Math.random() * 3));
    e.variant = 'sheared'; e.woolT = 120;
    hook('damageHeld', 1);
    hook('sound', 'shear');
    return true;
  }
  // alimentar → reprodução
  if (held && t.food && held.k === t.food) {
    if (e.baby > 0) { e.baby = Math.max(0, e.baby - 60); }
    else if (e.love <= 0) { e.love = 20; PT.hearts(e.pos.x, e.pos.y + e.hh, e.pos.z); }
    else return false;
    hook('consumeHeld');
    if (e.type === 'horse') e.tame = true;
    return true;
  }
  // montar cavalo (com sela no modo sobrevivência)
  if (t.mount && e.baby <= 0) {
    if (!e.saddled) {
      if (G.mode === 'creative' || (held && held.k === 'saddle')) { e.saddled = true; if (G.mode !== 'creative') hook('consumeHeld'); hook('toast', 'Cavalo selado! Toque nele de novo para montar.'); }
      else hook('toast', 'Você precisa de uma sela para montar o cavalo.');
      return true;
    }
    pl.riding = e; e.rider = pl;
    e.seatY = 1.25; e.controlBy = horseControl;
    hook('toast', 'Use o botão ▼ (ou Shift) para descer.');
    return true;
  }
  return false;
}
function horseControl(pl, dt, input) {
  const e = this;
  if (input.sneakPressed || pl.dead) { dismount(pl); return; }
  const fx = -Math.sin(pl.yaw), fz = -Math.cos(pl.yaw), rx = Math.cos(pl.yaw), rz = -Math.sin(pl.yaw);
  const sp = 8.5;
  const tx = (fx * input.mz + rx * input.mx) * sp, tz = (fz * input.mz + rz * input.mx) * sp;
  e.vel.x += (tx - e.vel.x) * Math.min(1, dt * 4);
  e.vel.z += (tz - e.vel.z) * Math.min(1, dt * 4);
  if (input.jump && e.onGround) e.vel.y = 10;
  e.ridden = true;
  pl.pos.x = e.pos.x; pl.pos.y = e.pos.y; pl.pos.z = e.pos.z;
  pl.vel.x = pl.vel.y = pl.vel.z = 0;
  pl.fallStartY = null;
}

function placeVehicle(kind, h) {
  const w = G.world;
  if (kind === 'boat') {
    const onWater = LIQUID[h.id] === 1;
    const x = onWater ? h.x : h.x + h.face[0], y = onWater ? h.y + 0.6 : h.y + h.face[1], z = onWater ? h.z : h.z + h.face[2];
    const v = new Vehicle('boat', x + 0.5, y, z + 0.5);
    v.yaw = G.player.yaw;
    E.list.push(v);
    return true;
  }
  if (kind === 'minecart') {
    if (h.id !== B.RAIL) { hook('toast', 'Coloque o carrinho sobre um trilho.'); return false; }
    const v = new Vehicle('minecart', h.x + 0.5, h.y + 0.05, h.z + 0.5);
    E.list.push(v);
    return true;
  }
  return false;
}

// ---------------- atualização ----------------
export function updateEntities(dt) {
  const pl = G.player, w = G.world;
  const pp = pl.pos;
  E.spawnT -= dt; E.hostileT -= dt;
  if (E.spawnT <= 0) { E.spawnT = 2.5; trySpawnPassive(); trySpawnVillagers(); }
  if (E.hostileT <= 0) { E.hostileT = 1.2; trySpawnHostile(); }
  for (const e of E.list) {
    if (e.dead) continue;
    const dx = e.pos.x - pp.x, dz = e.pos.z - pp.z;
    const far = dx * dx + dz * dz;
    // entidades em chunks não carregados ficam congeladas
    // (o dragão voa por toda a ilha: nunca congela)
    if (!w.chunks.has(Math.floor(e.pos.x / 16) + ',' + Math.floor(e.pos.z / 16)) && e.type !== 'dragon') { e.frozen = true; continue; }
    e.frozen = false;
    e.age += dt;
    e.lightT -= dt;
    if (e.lightT <= 0) { e.lightT = 0.5 + Math.random() * 0.3; e.light = lightAt(e); }
    if (e.kind === 'item') updateItem(e, dt);
    else if (e.kind === 'arrow') updateArrow(e, dt);
    else if (e.kind === 'mob') updateMob(e, dt, far);
    else if (e.kind === 'falling' || e.kind === 'tnt') updateBlockEnt(e, dt);
    else updateVehicle(e, dt);
  }
  // remove mortos
  if (E.list.some((e) => e.dead)) {
    for (const e of E.list) if (e.dead) removeVisual(e);
    E.list = E.list.filter((e) => !e.dead);
  }
}

function updateItem(e, dt) {
  const pl = G.player;
  e.pickup -= dt;
  e.spin += dt * 2;
  e.vel.x *= 1 - dt * 2; e.vel.z *= 1 - dt * 2;
  stepEntity(e, dt, { autoStep: false });
  if (e.inWater) e.vel.y = Math.max(e.vel.y, 0.5);
  if (e.age > 300) e.dead = true;
  if (e.pickup <= 0 && !pl.dead) {
    const d = Math.hypot(e.pos.x - pl.pos.x, e.pos.y + 0.2 - (pl.pos.y + 0.9), e.pos.z - pl.pos.z);
    if (d < 1.6) {
      const left = pl.inv.add(e.k, e.n, e.d, [0, 1, 2, 3, 4, 5, 6, 7, 8, ...Array.from({ length: 27 }, (_, i) => i + 9)]);
      if (left < e.n) { hook('sound', 'pickup'); hook('challengeEvent', 'collect', e.k, e.n - left); }
      e.n = left;
      if (!e.n) e.dead = true;
    } else if (d < 3) {
      // atração suave
      e.vel.x += (pl.pos.x - e.pos.x) * dt * 6; e.vel.z += (pl.pos.z - e.pos.z) * dt * 6;
    }
  }
}
function updateArrow(e, dt) {
  if (e.stuck) { if (e.age > 30) e.dead = true; if (e.owner === G.player && Math.hypot(e.pos.x - G.player.pos.x, e.pos.y - G.player.pos.y - 0.5, e.pos.z - G.player.pos.z) < 1.3) { if (G.mode !== 'creative') G.player.inv.add('arrow', 1); e.dead = true; hook('sound', 'pickup'); } return; }
  if (e.fire) { if (Math.random() < 0.6) PT.smoke(e.pos.x, e.pos.y, e.pos.z, 1, [1, 0.5, 0.1]); } else e.vel.y -= 20 * dt;
  const steps = 4;
  for (let s = 0; s < steps; s++) {
    e.pos.x += e.vel.x * dt / steps; e.pos.y += e.vel.y * dt / steps; e.pos.z += e.vel.z * dt / steps;
    if (SOLID[G.world.getBlock(Math.floor(e.pos.x), Math.floor(e.pos.y), Math.floor(e.pos.z))]) { if (e.fire) { e.dead = true; hook('ignite', Math.floor(e.pos.x - e.vel.x * 0.02), Math.floor(e.pos.y - e.vel.y * 0.02), Math.floor(e.pos.z - e.vel.z * 0.02)); return; } e.stuck = true; e.age = 0; hook('sound', 'arrow_hit'); return; }
    // acerta jogador ou criaturas
    const pl = G.player;
    if (e.owner !== pl && !pl.dead && Math.abs(e.pos.x - pl.pos.x) < pl.hw + 0.1 && Math.abs(e.pos.z - pl.pos.z) < pl.hw + 0.1 && e.pos.y > pl.pos.y && e.pos.y < pl.pos.y + pl.hh) { pl.damage(e.dmg, e.fire ? 'fire' : 'arrow', e.owner); if (e.fire) pl.burnT = 3; e.dead = true; return; }
    for (const m of E.list) if (m.kind === 'mob' && m !== e.owner && !m.dead && !(e.fire && m.T.fireImmune) && Math.abs(e.pos.x - m.pos.x) < m.hw + 0.1 && Math.abs(e.pos.z - m.pos.z) < m.hw + 0.1 && e.pos.y > m.pos.y && e.pos.y < m.pos.y + m.hh) { attackEntity(m, e.dmg, e.owner && e.owner.pos ? e.owner : null); e.dead = true; return; }
  }
  if (e.age > 20) e.dead = true;
}

// ---------------- blocos caindo e TNT acesa ----------------
class BlockEnt extends Ent {
  constructor(kind, x, y, z, id, meta, fuse) {
    super(kind, x, y, z);
    this.block = id; this.meta = meta || 0; this.fuse = fuse || 0;
    this.hw = 0.49; this.hh = 0.98; this.yaw = 0;
  }
}
export function spawnFallingBlock(x, y, z, id, meta) { const e = new BlockEnt('falling', x + 0.5, y, z + 0.5, id, meta); E.list.push(e); return e; }
export function spawnPrimedTNT(x, y, z, fuse = 3) {
  const e = new BlockEnt('tnt', x + 0.5, y, z + 0.5, B.TNT, 0, fuse);
  e.vel.y = 2.5; e.vel.x = (Math.random() - 0.5) * 0.6; e.vel.z = (Math.random() - 0.5) * 0.6;
  E.list.push(e); hook('sound', 'fuse', e.pos);
  return e;
}
function updateBlockEnt(e, dt) {
  e.vel.y -= 25 * dt;
  e.vel.x *= 1 - dt * 2; e.vel.z *= 1 - dt * 2;
  stepEntity(e, dt, { autoStep: false });
  if (e.kind === 'tnt') {
    e.fuse -= dt;
    if (Math.random() < dt * 20) PT.smoke(e.pos.x, e.pos.y + 1.05, e.pos.z, 1, [0.6, 0.6, 0.6]);
    if (e.fuse <= 0) { e.dead = true; hook('explode', e.pos.x, e.pos.y + 0.5, e.pos.z, 3.6); }
    return;
  }
  // bloco caindo: ao tocar o chão vira bloco de novo (ou item, se o lugar estiver ocupado)
  if (e.onGround || e.age > 12) {
    e.dead = true;
    const x = Math.floor(e.pos.x), y = Math.floor(e.pos.y + 0.1), z = Math.floor(e.pos.z);
    const cur = G.world.getBlock(x, y, z);
    const d = BLOCKS[cur];
    if (!cur || (d && (d.shape === 'cross' || d.liquid))) hook('setBlock', x, y, z, e.block, e.meta);
    else dropItem(e.pos.x, e.pos.y + 0.3, e.pos.z, BLOCKS[e.block].key, 1);
    hook('sound', 'place', BLOCKS[e.block] && BLOCKS[e.block].sound);
  }
}
// dano e empurrão de uma explosão (criaturas, itens, veículos, jogador)
export function explosionDamage(cx, cy, cz, power) {
  const R2 = power * 2;
  for (const e of E.list) {
    if (e.dead) continue;
    const dx = e.pos.x - cx, dy = e.pos.y + (e.hh || 0.5) / 2 - cy, dz = e.pos.z - cz, d = Math.hypot(dx, dy, dz) || 0.1;
    if (d > R2) continue;
    const k = 1 - d / R2;
    e.vel.x += dx / d * 14 * k; e.vel.y += 6 + 8 * k; e.vel.z += dz / d * 14 * k;
    if (e.kind === 'mob') { e.hurt = 0; attackEntity(e, 16 * k, null); }
    else if (e.kind === 'boat' || e.kind === 'minecart') attackEntity(e, 10 * k, null);
    else if (e.kind === 'item' && k > 0.7) e.dead = true;
  }
  const pl = G.player;
  if (pl && !pl.dead) {
    const dx = pl.pos.x - cx, dy = pl.pos.y + 0.9 - cy, dz = pl.pos.z - cz, d = Math.hypot(dx, dy, dz) || 0.1;
    if (d < R2) {
      const k = 1 - d / R2;
      pl.vel.x += dx / d * 16 * k; pl.vel.y += 7 * k + 3; pl.vel.z += dz / d * 16 * k;
      if (G.mode !== 'creative') pl.damage(Math.round(18 * k * k + 2 * k), 'explosion');
    }
  }
}

function updateVehicle(v, dt) {
  const w = G.world;
  if (v.kind === 'boat') {
    const inW = liquidAt(v.pos.x, v.pos.y + 0.2, v.pos.z) === B.WATER;
    if (inW) { v.vel.y = Math.min(v.vel.y + 18 * dt, 2); }
    if (!v.rider) { v.vel.x *= 1 - dt * 1.5; v.vel.z *= 1 - dt * 1.5; }
    if (!inW && v.onGround) { v.vel.x *= 1 - dt * 6; v.vel.z *= 1 - dt * 6; }
    stepEntity(v, dt, { autoStep: false });
    if (inW && liquidAt(v.pos.x, v.pos.y + 0.45, v.pos.z) !== B.WATER) v.vel.y *= 0.5;
  } else if (v.kind === 'minecart') {
    const dir = railDir(v);
    if (dir) {
      const x = Math.floor(v.pos.x), z = Math.floor(v.pos.z), y = Math.floor(v.pos.y + 0.1);
      const m = w.getMeta(x, y, z) & 7;
      // curvas: troca de eixo ao passar pelo centro do bloco
      if (m >= 2) {
        const cx = x + 0.5, cz = z + 0.5;
        const ends = { 2: [[0, 1], [1, 0]], 3: [[0, 1], [-1, 0]], 4: [[0, -1], [-1, 0]], 5: [[0, -1], [1, 0]] }[m];
        const cur = v.lastDir || dir;
        const s = Math.sign(v.speed) || 1;
        const moving = [cur[0] * s, cur[1] * s];
        // entra por uma ponta e sai pela outra
        const inEnd = ends.findIndex((e) => e[0] === -moving[0] && e[1] === -moving[1]);
        if (inEnd >= 0 && Math.hypot(v.pos.x - cx, v.pos.z - cz) < 0.15) {
          const out = ends[1 - inEnd];
          v.lastDir = [Math.abs(out[0]), Math.abs(out[1])];
          v.speed = Math.abs(v.speed) * (out[0] + out[1]);
          v.pos.x = cx; v.pos.z = cz;
        }
      } else v.lastDir = dir;
      const d = v.lastDir || dir;
      v.speed *= 1 - dt * 0.15;
      v.speed = Math.max(-12, Math.min(12, v.speed));
      v.vel.x = d[0] * v.speed; v.vel.z = d[1] * v.speed;
      // centraliza no trilho
      if (d[0]) v.pos.z += (z + 0.5 - v.pos.z) * Math.min(1, dt * 10); else v.pos.x += (x + 0.5 - v.pos.x) * Math.min(1, dt * 10);
      v.yaw = d[0] ? Math.PI / 2 : 0;
    } else { v.speed *= 1 - dt * 3; v.vel.x *= 1 - dt * 3; v.vel.z *= 1 - dt * 3; }
    const vx0 = v.vel.x, vz0 = v.vel.z;
    stepEntity(v, dt, { autoStep: false });
    if ((vx0 && !v.vel.x) || (vz0 && !v.vel.z)) v.speed = 0;
  }
}

// ---------------- IA ----------------
function canSeePlayer(e) {
  const pl = G.player, w = G.world;
  const ax = e.pos.x, ay = e.pos.y + e.hh * 0.85, az = e.pos.z;
  const bx = pl.pos.x, by = pl.pos.y + 1.5, bz = pl.pos.z;
  const d = Math.hypot(bx - ax, by - ay, bz - az);
  for (let t = 0.5; t < d; t += 0.5) {
    const k = t / d;
    if (LOPQ[w.getBlock(Math.floor(ax + (bx - ax) * k), Math.floor(ay + (by - ay) * k), Math.floor(az + (bz - az) * k))]) return false;
  }
  return true;
}
function updateMob(e, dt, far2) {
  const t = e.T, pl = G.player, w = G.world;
  e.hurt = Math.max(0, e.hurt - dt);
  if (e.proxy) return; // criatura simulada pelo anfitrião (multiplayer)
  e.cool = Math.max(0, e.cool - dt);
  e.flee = Math.max(0, e.flee - dt);
  e.love = Math.max(0, e.love - dt);
  if (e.baby > 0) e.baby -= dt;
  if (e.woolT > 0) { e.woolT -= dt; if (e.woolT <= 0) e.variant = ['white', 'white', 'gray', 'black', 'brown'][Math.floor(Math.random() * 5)]; }
  // despawn de hostis distantes ou no modo pacífico
  if (t.boss) { hook('bossAI', e, dt); return; }
  if ((t.hostile || t.neutral) && (far2 > 96 * 96 || G.mode === 'peaceful')) { e.dead = true; return; }
  if (t.flies) { flyAI(e, dt); return; }
  const night = R.sky01 ? R.sky01.night : 0;
  let mx = 0, mz = 0, speed = t.speed, jumpWanted = false;
  if (e.ridden) { e.ridden = false; e.walkAmt = Math.min(1, Math.hypot(e.vel.x, e.vel.z) / 4); e.walk += Math.hypot(e.vel.x, e.vel.z) * dt * 1.6; stepEntity(e, dt); if (Math.hypot(e.vel.x, e.vel.z) > 0.2) e.yaw = Math.atan2(e.vel.x, e.vel.z); return; }
  if (e.rider) { if (e.rider.riding !== e) e.rider = null; }
  // queimar ao sol
  if (t.burns && R.sky01 && R.sky01.day > 0.6 && !e.inWater && skyVisible(e.pos.x, e.pos.y + e.hh, e.pos.z)) {
    e.burnT += dt;
    if (Math.random() < dt * 6) PT.smoke(e.pos.x, e.pos.y + e.hh, e.pos.z, 1, [0.2, 0.2, 0.2]);
    if (e.burnT > 1) { e.burnT = 0.01; attackEntity(e, 1, null); }
  }
  const dpx = pl.pos.x - e.pos.x, dpz = pl.pos.z - e.pos.z, dpl = Math.hypot(dpx, dpz);
  if (t.aquatic) { updateFish(e, dt); return; }
  if (t.npc) { const r = npcAI(e, dt); mx = r[0]; mz = r[1]; speed = r[2]; }
  else if ((t.hostile || (t.neutral && e.target === pl)) && !pl.dead && G.mode !== 'creative' && G.mode !== 'peaceful' && dpl < 20 && Math.abs(pl.pos.y - e.pos.y) < 10 && (e.target === pl || canSeePlayer(e))) {
    e.target = pl;
    if (t.ranged) {
      // esqueleto: mantém distância e atira
      const want = dpl < 6 ? -1 : dpl > 11 ? 1 : 0;
      mx = dpx / dpl * want; mz = dpz / dpl * want;
      e.headYaw = 0;
      e.faceYaw = Math.atan2(dpx, dpz);
      if (e.cool <= 0 && dpl < 16 && canSeePlayer(e)) {
        e.cool = 2 + Math.random();
        const from = { x: e.pos.x, y: e.pos.y + 1.5, z: e.pos.z };
        const ty = pl.pos.y + 1.2 + dpl * 0.08;
        const dx = pl.pos.x - from.x, dy = ty - from.y, dz = pl.pos.z - from.z, d = Math.hypot(dx, dy, dz);
        shootArrow(from, { x: dx / d + (Math.random() - 0.5) * 0.05, y: dy / d, z: dz / d + (Math.random() - 0.5) * 0.05 }, e, 22);
      }
    } else {
      mx = dpx / (dpl || 1); mz = dpz / (dpl || 1);
      speed *= 1.25;
      if (dpl < 1.3 && Math.abs(pl.pos.y - e.pos.y) < 1.5 && e.cool <= 0) {
        e.cool = 1;
        e.swing = 1;
        pl.damage(t.attack, 'mob', e);
      }
    }
  } else if (e.flee > 0 && e.attacker) {
    const ax = e.pos.x - e.attacker.pos.x, az = e.pos.z - e.attacker.pos.z, d = Math.hypot(ax, az) || 1;
    mx = ax / d; mz = az / d; speed *= 1.8;
  } else if (t.food && !pl.dead && dpl < 9 && dpl > 2 && pl.held() && pl.held().k === t.food) {
    mx = dpx / dpl; mz = dpz / dpl;
  } else if (e.love > 0) {
    // procura parceiro
    let mate = null, md = 9;
    for (const o of E.list) if (o !== e && o.kind === 'mob' && o.type === e.type && o.love > 0 && !o.dead) { const d = Math.hypot(o.pos.x - e.pos.x, o.pos.z - e.pos.z); if (d < md) { md = d; mate = o; } }
    if (mate) {
      if (md < 1.5) { e.love = 0; mate.love = 0; const b = spawnMob(e.type, e.pos.x, e.pos.y + 0.2, e.pos.z, e.variant === 'sheared' ? 'white' : e.variant); b.baby = 300; PT.hearts(e.pos.x, e.pos.y + 1, e.pos.z); hook('challengeEvent', 'breed', e.type); }
      else { mx = (mate.pos.x - e.pos.x) / md; mz = (mate.pos.z - e.pos.z) / md; }
    }
  } else {
    // vagar
    e.wanderT -= dt;
    if (e.wanderT <= 0) {
      e.wanderT = 3 + Math.random() * 6;
      e.target = null;
      e.goal = Math.random() < 0.6 ? { x: e.pos.x + (Math.random() - 0.5) * 16, z: e.pos.z + (Math.random() - 0.5) * 16 } : null;
    }
    if (e.goal) {
      const gx = e.goal.x - e.pos.x, gz = e.goal.z - e.pos.z, gd = Math.hypot(gx, gz);
      if (gd < 0.8) e.goal = null; else { mx = gx / gd; mz = gz / gd; speed *= 0.6; }
    }
    if (t.hostile && night < 0.3 && !e.target && Math.random() < dt * 0.01 && far2 > 40 * 40) e.dead = true;
  }
  moveMob(e, dt, mx, mz, speed, t);
}
// blaze: flutua perto do jogador (acima e a alguns blocos) e atira bolas de fogo
function flyAI(e, dt) {
  const pl = G.player;
  const dx = pl.pos.x - e.pos.x, dy = pl.pos.y + 2.5 - e.pos.y, dz = pl.pos.z - e.pos.z, d = Math.hypot(dx, dz);
  const angry = !pl.dead && G.mode !== 'creative' && G.mode !== 'peaceful' && d < 24 && (e.target === pl || canSeePlayer(e));
  let tx = 0, ty = Math.sin(e.age * 1.3 + e.id) * 0.8, tz = 0;
  if (angry) {
    e.target = pl;
    const want = d < 6 ? -1 : d > 10 ? 1 : 0;
    tx = dx / (d || 1) * want * 3; tz = dz / (d || 1) * want * 3; ty += Math.max(-3, Math.min(3, dy)) * 1.2;
    e.faceYaw = Math.atan2(dx, dz);
    if (e.cool <= 0 && d < 18 && canSeePlayer(e)) {
      e.burst = (e.burst || 0) + 1;
      e.cool = e.burst % 3 ? 0.35 : 3;
      const from = { x: e.pos.x, y: e.pos.y + 1.4, z: e.pos.z };
      const ex = pl.pos.x - from.x, ey = pl.pos.y + 1.2 - from.y, ez = pl.pos.z - from.z, ed = Math.hypot(ex, ey, ez);
      const a = shootArrow(from, { x: ex / ed + (Math.random() - 0.5) * 0.08, y: ey / ed + 0.04, z: ez / ed + (Math.random() - 0.5) * 0.08 }, e, 16);
      a.fire = true; a.dmg = t5(e);
      hook('sound', 'ignite', from);
    }
  } else { e.wanderT -= dt; if (e.wanderT <= 0) { e.wanderT = 3; e.wx = (Math.random() - 0.5) * 2; e.wz = (Math.random() - 0.5) * 2; } tx = e.wx || 0; tz = e.wz || 0; }
  const k = Math.min(1, dt * 3);
  e.vel.x += (tx - e.vel.x) * k; e.vel.y += (ty - e.vel.y) * k; e.vel.z += (tz - e.vel.z) * k;
  stepEntity(e, dt, { noGravity: true, autoStep: false });
  e.walk += dt * 4; e.walkAmt = 1;
  const yawT = e.faceYaw != null ? e.faceYaw : e.yaw; e.faceYaw = null;
  e.yaw = lerpAngle(e.yaw, yawT, dt * 6);
  if (Math.random() < dt * 4) PT.smoke(e.pos.x + (Math.random() - 0.5) * 0.6, e.pos.y + Math.random() * 1.4, e.pos.z + (Math.random() - 0.5) * 0.6, 1, [0.9, 0.5, 0.1]);
}
const t5 = (e) => e.T.attack || 5;
function moveMob(e, dt, mx, mz, speed, t) {
  const w = G.world;
  // evita penhascos e lava
  if (mx || mz) {
    const nx = e.pos.x + mx * (e.hw + 0.6), nz = e.pos.z + mz * (e.hw + 0.6);
    let drop = 0;
    for (let y = Math.floor(e.pos.y) - 1; y > Math.floor(e.pos.y) - 5; y--) { const id = w.getBlock(Math.floor(nx), y, Math.floor(nz)); if (SOLID[id] || id === B.WATER) break; drop++; }
    const lava = w.getBlock(Math.floor(nx), Math.floor(e.pos.y), Math.floor(nz)) === B.LAVA || w.getBlock(Math.floor(nx), Math.floor(e.pos.y) - 1, Math.floor(nz)) === B.LAVA;
    if ((drop >= 3 && !t.hostile) || lava) { mx = mz = 0; e.goal = null; e.wanderT = 0.5; }
  }
  const acc = e.onGround ? 10 : 2;
  e.vel.x += (mx * speed * 2.6 - e.vel.x) * Math.min(1, acc * dt);
  e.vel.z += (mz * speed * 2.6 - e.vel.z) * Math.min(1, acc * dt);
  if (e.inWater) { e.vel.y = Math.min(e.vel.y + 22 * dt, 2.2); }
  const wasWall = e.hitWall;
  stepEntity(e, dt);
  if ((e.hitWall || (t.hop && (mx || mz) && Math.random() < dt * 2)) && e.onGround) {
    // porta fechada no caminho: aldeões abrem
    if (t.npc && tryOpenDoor(e, mx, mz)) { /* abriu */ } else e.vel.y = t.hop ? 6 : 8.4;
  }
  void wasWall;
  const sp = Math.hypot(e.vel.x, e.vel.z);
  e.walk += sp * dt * (t.hop ? 1 : 1.6);
  e.walkAmt += ((sp > 0.3 ? 1 : 0) - e.walkAmt) * Math.min(1, dt * 6);
  const yawTarget = e.faceYaw != null ? e.faceYaw : (sp > 0.3 ? Math.atan2(e.vel.x, e.vel.z) : e.yaw);
  e.faceYaw = null;
  e.yaw = lerpAngle(e.yaw, yawTarget, dt * 6);
  if (e.swing > 0) e.swing = Math.max(0, e.swing - dt * 3);
  if (t.flap) e.flap = e.onGround ? 0 : (e.flap || 0) + dt * 30;
  // galinhas planam
  if (t.flap && !e.onGround && e.vel.y < -2) e.vel.y = -2;
  if (Math.random() < dt * 0.05 && t.sound) hook('sound', 'mob', t.sound, e.pos);
}
function updateFish(e, dt) {
  const w = G.world;
  const inW = liquidAt(e.pos.x, e.pos.y + 0.15, e.pos.z) === B.WATER;
  if (!inW) {
    // fora d'água: debate e perde vida
    e.vel.y -= 20 * dt;
    if (e.onGround && Math.random() < dt * 3) { e.vel.y = 4; e.vel.x = (Math.random() - 0.5) * 3; e.vel.z = (Math.random() - 0.5) * 3; }
    if (Math.random() < dt * 0.5) attackEntity(e, 1, null);
    stepEntity(e, dt, { noGravity: true, autoStep: false });
    return;
  }
  e.wanderT -= dt;
  if (e.wanderT <= 0) { e.wanderT = 2 + Math.random() * 3; e.swim = { x: (Math.random() - 0.5) * 2, y: (Math.random() - 0.5) * 0.8, z: (Math.random() - 0.5) * 2 }; }
  const s = e.swim || { x: 0, y: 0, z: 0 };
  e.vel.x += (s.x * 2 - e.vel.x) * dt * 2; e.vel.y += (s.y - e.vel.y) * dt * 2; e.vel.z += (s.z * 2 - e.vel.z) * dt * 2;
  if (liquidAt(e.pos.x + e.vel.x * 0.3, e.pos.y + e.vel.y * 0.3 + 0.15, e.pos.z + e.vel.z * 0.3) !== B.WATER) { e.vel.x *= -1; e.vel.z *= -1; e.vel.y = -Math.abs(e.vel.y); }
  stepEntity(e, dt, { noGravity: true, autoStep: false });
  const sp = Math.hypot(e.vel.x, e.vel.z);
  e.walk += dt * 8; e.walkAmt = 0.6;
  if (sp > 0.1) e.yaw = lerpAngle(e.yaw, Math.atan2(e.vel.x, e.vel.z), dt * 5);
}

// aldeões: andam pela aldeia de dia, voltam para a cama à noite, fogem de zumbis, abrem portas
function npcAI(e, dt) {
  const night = R.sky01 ? R.sky01.night : 0;
  // perigo próximo
  for (const o of E.list) if (o.kind === 'mob' && o.T.hostile && !o.dead && Math.abs(o.pos.x - e.pos.x) < 8 && Math.abs(o.pos.z - e.pos.z) < 8) {
    const dx = e.pos.x - o.pos.x, dz = e.pos.z - o.pos.z, d = Math.hypot(dx, dz) || 1;
    return [dx / d, dz / d, 1.6];
  }
  if (e.talking > 0) { e.talking -= dt; e.faceYaw = Math.atan2(G.player.pos.x - e.pos.x, G.player.pos.z - e.pos.z); return [0, 0, 0]; }
  if (night > 0.6 && e.home) {
    const gx = e.home.x + 0.5 - e.pos.x, gz = e.home.z + 0.5 - e.pos.z, gd = Math.hypot(gx, gz);
    if (gd > 1) return [gx / gd, gz / gd, 1];
    return [0, 0, 0];
  }
  e.wanderT -= dt;
  if (e.wanderT <= 0) {
    e.wanderT = 4 + Math.random() * 6;
    const c = e.village || e.pos;
    e.goal = Math.random() < 0.7 ? { x: c.x + (Math.random() - 0.5) * 30, z: c.z + (Math.random() - 0.5) * 30 } : null;
  }
  if (e.goal) {
    const gx = e.goal.x - e.pos.x, gz = e.goal.z - e.pos.z, gd = Math.hypot(gx, gz);
    if (gd < 1) e.goal = null; else return [gx / gd, gz / gd, 0.7];
  }
  return [0, 0, 0];
}
function tryOpenDoor(e, mx, mz) {
  const w = G.world;
  const x = Math.floor(e.pos.x + mx * 0.8), z = Math.floor(e.pos.z + mz * 0.8);
  for (const y of [Math.floor(e.pos.y), Math.floor(e.pos.y) + 1]) {
    if (w.getBlock(x, y, z) === B.DOOR) {
      const by = w.getMeta(x, y, z) & 8 ? y - 1 : y;
      const m = w.getMeta(x, by, z);
      if (!(m & 4)) {
        hook('setBlock', x, by, z, B.DOOR, m | 4);
        if (w.getBlock(x, by + 1, z) === B.DOOR) hook('setBlock', x, by + 1, z, B.DOOR, w.getMeta(x, by + 1, z) | 4);
        hook('sound', 'door_open');
        setTimeout(() => {
          if (G.world !== w || w.getBlock(x, by, z) !== B.DOOR) return;
          hook('setBlock', x, by, z, B.DOOR, w.getMeta(x, by, z) & ~4);
          if (w.getBlock(x, by + 1, z) === B.DOOR) hook('setBlock', x, by + 1, z, B.DOOR, w.getMeta(x, by + 1, z) & ~4);
        }, 2500);
        return true;
      }
    }
  }
  return false;
}

// ---------------- geração de criaturas ----------------
function countNear(pred, r) { const p = G.player.pos; let n = 0; for (const e of E.list) if (!e.dead && pred(e) && Math.abs(e.pos.x - p.x) < r && Math.abs(e.pos.z - p.z) < r) n++; return n; }
function randomSurface(minR, maxR) {
  const p = G.player.pos, w = G.world;
  const a = Math.random() * Math.PI * 2, r = minR + Math.random() * (maxR - minR);
  const x = Math.floor(p.x + Math.cos(a) * r), z = Math.floor(p.z + Math.sin(a) * r);
  const y = w.surfaceY(x, z);
  if (y < 0) return null;
  return { x, y: y + 1, z, ground: w.getBlock(x, y, z) };
}
const netGuest = () => G.net && G.net.connected && !G.net.host;
function trySpawnPassive() {
  if (netGuest()) return;
  const w = G.world;
  if (countNear((e) => e.kind === 'mob' && e.T.passive && !e.T.aquatic, 64) < CAP_PASSIVE) {
    const s = randomSurface(24, 56);
    if (s && (s.ground === B.GRASS || s.ground === B.SAND || s.ground === B.SNOW) && R.sky01.day > 0.3) {
      const biome = w.biomeAt(s.x, s.z);
      const opts = Object.keys(MOBS).filter((k) => MOBS[k].passive && !MOBS[k].aquatic && MOBS[k].biomes && MOBS[k].biomes.includes(biome));
      if (opts.length) {
        const type = opts[Math.floor(Math.random() * opts.length)];
        const n = type === 'horse' ? 1 + Math.floor(Math.random() * 2) : 2 + Math.floor(Math.random() * 3);
        const variant = MOBS[type].variants ? MOBS[type].variants.filter((v) => v !== 'sheared')[Math.floor(Math.random() * (MOBS[type].variants.length - (type === 'sheep' ? 1 : 0)))] : null;
        for (let i = 0; i < n; i++) {
          const x = s.x + 0.5 + (Math.random() - 0.5) * 3, z = s.z + 0.5 + (Math.random() - 0.5) * 3;
          const y = w.surfaceY(Math.floor(x), Math.floor(z));
          if (y > 0 && !LIQUID[w.getBlock(Math.floor(x), y, Math.floor(z))]) spawnMob(type, x, y + 1, z, type === 'sheep' && Math.random() < 0.7 ? 'white' : variant);
        }
      }
    }
  }
  if (countNear((e) => e.kind === 'mob' && e.T.aquatic, 48) < CAP_FISH) {
    const p = G.player.pos;
    const x = Math.floor(p.x + (Math.random() - 0.5) * 60), z = Math.floor(p.z + (Math.random() - 0.5) * 60);
    const y = w.sea - 1 - Math.floor(Math.random() * 3);
    if (w.peekBlock(x, y, z) === B.WATER && w.peekBlock(x, y - 1, z) === B.WATER) spawnMob('fish', x + 0.5, y, z + 0.5);
  }
}
// Nether: blazes nas fortalezas; End: endermen sobre a pedra do End
function spawnOtherDim(w, p) {
  if (w.dim === 'nether') {
    if (countNear((e) => e.kind === 'mob' && e.type === 'blaze', 64) >= 5) return;
    const f = w.gen.fortressNear(p.x, p.z);
    if (!f || Math.hypot(f.x - p.x, f.z - p.z) > 70) return;
    for (let i = 0; i < 4; i++) {
      const along = (Math.random() - 0.5) * 2 * f.len, side = (Math.random() - 0.5) * 4;
      const [x, z] = Math.random() < 0.5 ? [f.x + along, f.z + side] : [f.x + side, f.z + along];
      const y = f.y + 1;
      if (Math.hypot(x - p.x, z - p.z) < 10) continue;
      if (w.peekBlock(Math.floor(x), y, Math.floor(z)) === B.AIR && w.peekBlock(Math.floor(x), y + 1, Math.floor(z)) === B.AIR) { spawnMob('blaze', x, y + 0.5, z); return; }
    }
  } else if (w.dim === 'end') {
    if (countNear((e) => e.kind === 'mob' && e.type === 'enderman', 64) >= 6) return;
    const s = randomSurface(14, 40);
    if (s && s.ground === B.END_STONE && w.getBlock(s.x, s.y + 1, s.z) === B.AIR && w.getBlock(s.x, s.y + 2, s.z) === B.AIR) spawnMob('enderman', s.x + 0.5, s.y, s.z + 0.5);
  }
}
function trySpawnHostile() {
  if (G.mode === 'peaceful' || G.mode === 'creative' || netGuest()) return;
  const w = G.world, p = G.player.pos;
  if (w.dim && w.dim !== 'overworld') { spawnOtherDim(w, p); return; }
  if (countNear((e) => e.kind === 'mob' && e.T.hostile, 64) >= CAP_HOSTILE) return;
  const night = R.sky01 ? R.sky01.night : 0;
  for (let attempt = 0; attempt < 4; attempt++) {
    const a = Math.random() * Math.PI * 2, r = 18 + Math.random() * 22;
    const x = Math.floor(p.x + Math.cos(a) * r), z = Math.floor(p.z + Math.sin(a) * r);
    // tenta superfície (à noite) ou cavernas (escuro)
    let y;
    if (night > 0.6 && Math.random() < 0.6) y = w.surfaceY(x, z) + 1;
    else y = Math.floor(p.y + (Math.random() - 0.5) * 16);
    if (y < 2 || y > 120) continue;
    if (w.peekBlock(x, y, z) !== B.AIR || w.peekBlock(x, y + 1, z) !== B.AIR || !SOLID[w.peekBlock(x, y - 1, z) ?? 0]) continue;
    const sky = skyVisible(x, y + 1, z);
    if (sky && night < 0.6) continue;
    if (nearLight(x, y, z, 6) > 0.2) continue;
    // não nasce em aldeias iluminadas nem sobre folhas
    if (w.peekBlock(x, y - 1, z) === B.LEAVES) continue;
    // endermen são raros (à noite, na superfície): fonte de pérolas antes de ir ao End
    if (sky && Math.random() < 0.12) { if (w.peekBlock(x, y + 2, z) === B.AIR) spawnMob('enderman', x + 0.5, y, z + 0.5); return; }
    spawnMob(Math.random() < 0.6 ? 'zombie' : 'skeleton', x + 0.5, y, z + 0.5);
    return;
  }
}
function trySpawnVillagers() {
  if (netGuest()) return;
  const w = G.world, p = G.player.pos;
  for (const v of w.gen.villagesNear(p.x, p.z, 80)) {
    if (E.villages.has(v.id) || (w.villageState && w.villageState[v.id])) continue;
    if (Math.hypot(v.x - p.x, v.z - p.z) > 70) continue;
    if (!w.chunks.has(Math.floor(v.x / 16) + ',' + Math.floor(v.z / 16))) continue;
    E.villages.add(v.id);
    w.villageState = w.villageState || {};
    w.villageState[v.id] = { spawned: true };
    hook('villageFound', v);
    v.beds.forEach((b, i) => {
      const prof = PROFESSION_LIST[(i + Math.abs(v.x)) % PROFESSION_LIST.length];
      const y = w.surfaceY(b.x, b.z) + 1;
      const m = spawnMob('villager', b.x + 0.5, Math.max(y, b.y), b.z + 0.5, prof);
      m.home = { x: b.x, y: b.y, z: b.z };
      m.village = { x: v.x, z: v.z, id: v.id };
      m.trades = makeTrades(prof, m.id + Math.abs(v.x * 31 + v.z));
      m.quest = makeQuest(prof, m.id + Math.abs(v.z * 17 + v.x));
      m.name = randomName(m.id + v.x);
    });
  }
}
const NAMES = ['Ana', 'Bento', 'Clara', 'Davi', 'Elisa', 'Fábio', 'Gabi', 'Heitor', 'Iara', 'João', 'Lara', 'Miguel', 'Nina', 'Otávio', 'Paula', 'Rafael', 'Sofia', 'Tiago', 'Vera', 'Zeca'];
function randomName(s) { return NAMES[Math.abs(Math.floor(s)) % NAMES.length]; }

// ---------------- renderização ----------------
const _base = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
function itemMesh(k) {
  let g = E.itemGeo.get(k);
  if (!g) {
    const it = ITEMS[k];
    const blk = it.block != null && !it.icon ? BLOCKS[it.block] : null;
    if (blk) {
      const geo = new THREE.BoxGeometry(0.25, blk.shape === 'slab' ? 0.125 : 0.25, 0.25);
      const uvA = geo.attributes.uv;
      const tiles = [blk.t[1], blk.t[1], blk.t[0], blk.t[2], blk.front ?? blk.t[1], blk.t[1]];
      for (let f = 0; f < 6; f++) { const t = R.uv[tiles[f]]; const i = f * 4; uvA.setXY(i, t[0], t[1]); uvA.setXY(i + 1, t[2], t[1]); uvA.setXY(i + 2, t[0], t[3]); uvA.setXY(i + 3, t[2], t[3]); }
      g = { geo, mat: E.blockItemMat || (E.blockItemMat = patchEntityMaterial(new THREE.MeshLambertMaterial({ map: R.tex.albedo, alphaTest: 0.5 }))) };
    } else {
      const geo = new THREE.PlaneGeometry(0.4, 0.4);
      const r = HAND.itemSprites.map[k];
      const a = geo.attributes.uv;
      a.setXY(0, r[0], 1 - r[1]); a.setXY(1, r[2], 1 - r[1]); a.setXY(2, r[0], 1 - r[3]); a.setXY(3, r[2], 1 - r[3]);
      g = { geo, mat: E.spriteItemMat || (E.spriteItemMat = patchEntityMaterial(new THREE.MeshLambertMaterial({ map: HAND.spriteTex, alphaTest: 0.5, side: THREE.DoubleSide }))), sprite: true };
    }
    E.itemGeo.set(k, g);
  }
  const m = new THREE.Mesh(g.geo, g.mat);
  m.userData.sprite = g.sprite;
  return m;
}
export function resetItemMeshes() { E.itemGeo.clear(); E.blockItemMat = null; for (const e of E.list) if (e.kind === 'item') removeVisual(e); }
function vehicleMesh(kind) {
  const grp = new THREE.Group();
  const mat = patchEntityMaterial(new THREE.MeshLambertMaterial({ color: kind === 'boat' ? 0x9a6a3a : 0x8a8a92 }));
  if (kind === 'boat') {
    const add = (w, h, d, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.castShadow = true; grp.add(m); };
    add(1.2, 0.08, 1.9, 0, 0.1, 0); add(0.08, 0.4, 1.9, 0.6, 0.3, 0); add(0.08, 0.4, 1.9, -0.6, 0.3, 0); add(1.2, 0.4, 0.08, 0, 0.3, 0.95); add(1.2, 0.4, 0.08, 0, 0.3, -0.95);
  } else {
    const add = (w, h, d, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.castShadow = true; grp.add(m); };
    add(0.9, 0.08, 1.2, 0, 0.2, 0); add(0.06, 0.5, 1.2, 0.45, 0.45, 0); add(0.06, 0.5, 1.2, -0.45, 0.45, 0); add(0.9, 0.5, 0.06, 0, 0.45, 0.6); add(0.9, 0.5, 0.06, 0, 0.45, -0.6);
  }
  return grp;
}

export function renderEntities() {
  for (const type in E.models) for (const v in E.models[type]) E.models[type][v].begin();
  const t = G.time;
  const now = performance.now(), rdt = Math.min(0.1, (now - (E.lastRender || now)) / 1000); E.lastRender = now;
  // corpos caindo (animação de morte)
  E.corpses = E.corpses.filter((c) => {
    c.t += rdt;
    if (c.t > 0.9) { PT.smoke(c.x, c.y + 0.3, c.z, 10, [0.9, 0.9, 0.9]); return false; }
    c.x += c.vx * rdt; c.z += c.vz * rdt; c.vx *= 0.9; c.vz *= 0.9;
    const mdl = E.models[c.type] && (E.models[c.type][c.variant ?? 'null'] || E.models[c.type][Object.keys(E.models[c.type])[0]]);
    if (!mdl) return true;
    const fall = Math.min(1, c.t / 0.45);
    _e.set(0, c.yaw, c.side * fall * fall * Math.PI / 2, 'YXZ');
    _q.setFromEuler(_e);
    _base.compose(_p.set(c.x, c.y + Math.sin(fall * Math.PI) * 0.15, c.z), _q, _s.set(c.scale, c.scale, c.scale));
    mdl.add(_base, { walk: 0, walkAmt: 0 }, c.light, 1);
    return true;
  });
  for (const e of E.list) {
    if (e.dead) continue;
    const hidden = e.frozen;
    if (e.kind === 'mob') {
      if (hidden) continue;
      const mdl = E.models[e.type][e.variant ?? 'null'] || E.models[e.type][Object.keys(E.models[e.type])[0]];
      const s = e.scale;
      // degraus suaves: a altura desenhada persegue a física em vez de "pular" um bloco
      if (e.ry == null || Math.abs(e.ry - e.pos.y) > 1.6) e.ry = e.pos.y;
      e.ry += (e.pos.y - e.ry) * Math.min(1, rdt * 14);
      // inclina para frente ao correr
      const lean = Math.min(1, Math.max(0, (e.walkAmt || 0) - 0.5) * 2) * 0.12;
      _e.set(lean, e.yaw, 0, 'YXZ');
      _q.setFromEuler(_e);
      _base.compose(_p.set(e.pos.x, e.ry, e.pos.z), _q, _s.set(s, s, s));
      const T = e.T;
      // olha para o jogador quando ele está perto (animais e aldeões)
      let headYaw = 0;
      const pl = G.player;
      if (pl && !T.hostile) {
        const dx = pl.pos.x - e.pos.x, dz = pl.pos.z - e.pos.z, d2 = dx * dx + dz * dz;
        if (d2 < 36 && d2 > 0.5) { let a = Math.atan2(dx, dz) - e.yaw; while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; if (Math.abs(a) < 1.3) headYaw = a; }
      }
      e.hy = (e.hy || 0) + (headYaw - (e.hy || 0)) * Math.min(1, rdt * 6);
      const st = { walk: e.walk, walkAmt: e.walkAmt, headYaw: T.boss ? (e.headYaw || 0) : e.hy, headPitch: T.boss ? (e.headPitch || 0) : 0, swing: e.swing || 0, zombie: T.zombie, flap: e.flap || 0, holding: T.ranged, t, ph: e.id };
      mdl.add(_base, st, Math.max(e.light, T.glow || 0) * (e.burnT > 0 && T.burns ? 1.3 : 1), e.hurt > 0 ? 1 : 0);
      continue;
    }
    if (!e.mesh) {
      if (e.kind === 'item') e.mesh = itemMesh(e.k);
      else if (e.kind === 'arrow') e.mesh = new THREE.Mesh(E.arrowGeo, E.arrowMat);
      else if (e.kind === 'falling' || e.kind === 'tnt') e.mesh = blockCubeMesh(e.block);
      else e.mesh = vehicleMesh(e.kind);
      G.scene.add(e.mesh);
    }
    e.mesh.visible = !hidden;
    if (hidden) continue;
    if (e.kind === 'item') {
      e.mesh.position.set(e.pos.x, e.pos.y + 0.18 + Math.sin(t * 2 + e.id) * 0.06, e.pos.z);
      e.mesh.rotation.set(0, e.spin, 0);
      const sc = e.n > 16 ? 1.3 : e.n > 1 ? 1.15 : 1;
      e.mesh.scale.setScalar(sc);
    } else if (e.kind === 'arrow') {
      e.mesh.position.set(e.pos.x, e.pos.y, e.pos.z);
      if (!e.stuck) e.mesh.lookAt(e.pos.x + e.vel.x, e.pos.y + e.vel.y, e.pos.z + e.vel.z);
    } else if (e.kind === 'falling' || e.kind === 'tnt') {
      e.mesh.position.set(e.pos.x, e.pos.y, e.pos.z);
      // TNT pisca (cada vez mais rápido) e incha um pouco antes de explodir
      if (e.kind === 'tnt') {
        const f = Math.max(0, e.fuse);
        e.mesh.material.emissiveIntensity = Math.sin(t * (f < 1 ? 30 : 12)) > 0.2 ? 0.55 : 0;
        e.mesh.scale.setScalar(1 + (f < 0.4 ? (0.4 - f) * 0.4 : 0));
      }
    } else {
      // barco balança na água
      const bob = e.kind === 'boat' && e.inWater ? Math.sin(t * 1.8 + e.id) : 0;
      e.mesh.position.set(e.pos.x, e.pos.y + bob * 0.04, e.pos.z);
      e.mesh.rotation.set(bob * 0.03, e.yaw, Math.cos(t * 1.3 + e.id) * (e.kind === 'boat' && e.inWater ? 0.04 : 0));
    }
  }
  for (const type in E.models) for (const v in E.models[type]) E.models[type][v].end();
}

// ---------------- salvar/carregar ----------------
export function serializeEntities() {
  const out = [];
  for (const e of E.list) {
    if (e.dead) continue;
    const base = { k: e.kind, x: +e.pos.x.toFixed(2), y: +e.pos.y.toFixed(2), z: +e.pos.z.toFixed(2), yaw: +e.yaw.toFixed(2) };
    if (e.kind === 'mob') {
      if (e.T.hostile || e.T.neutral || e.T.boss) continue;
      Object.assign(base, { t: e.type, v: e.variant, hp: e.health, baby: e.baby > 0 ? Math.round(e.baby) : 0, saddled: e.saddled || 0, home: e.home, village: e.village, trades: e.trades, quest: e.quest, name: e.name });
    } else if (e.kind === 'item') Object.assign(base, { item: e.k, n: e.n, d: e.d, age: Math.round(e.age) });
    else if (e.kind === 'arrow' || e.kind === 'falling' || e.kind === 'tnt') continue;
    out.push(base);
  }
  return out;
}
export function loadEntities(arr) {
  clearEntities();
  if (!Array.isArray(arr)) return;
  for (const s of arr) {
    if (s.k === 'mob' && MOBS[s.t]) {
      const m = spawnMob(s.t, s.x, s.y, s.z, s.v);
      m.yaw = s.yaw || 0; m.health = s.hp || m.health; m.baby = s.baby || 0; m.saddled = !!s.saddled;
      if (s.home) m.home = s.home;
      if (s.village) { m.village = s.village; E.villages.add(s.village.id); }
      if (s.trades) m.trades = s.trades;
      if (s.quest) m.quest = s.quest;
      if (s.name) m.name = s.name;
    } else if (s.k === 'item' && ITEMS[s.item]) { const it = dropItem(s.x, s.y, s.z, s.item, s.n, s.d); if (it) { it.vel.x = it.vel.y = it.vel.z = 0; it.age = s.age || 0; } }
    else if (s.k === 'boat' || s.k === 'minecart') { const v = new Vehicle(s.k, s.x, s.y, s.z); v.yaw = s.yaw || 0; E.list.push(v); }
  }
}
export function setEntityShadows(on) { for (const type in E.models) for (const v in E.models[type]) E.models[type][v].setShadows(on); }
