// Regras de jogo: mirar, minerar, colocar, usar blocos/itens, atualizações de blocos e fornalhas.
import { G, hook } from './state.js';
import { B, BLOCKS, SOLID, FULL, LIQUID, SHAPED, FACING, PISTON_DIR } from './blocks.js';
import { ITEMS, blockDrops, blockItemKey } from './items.js';
import { raycast } from './physics.js';
import { Inventory, smeltResult, fuelValue, SMELT_TIME } from './crafting.js';
import { hash3 } from './noise.js';
import { wakeAround, ignite } from './worldphys.js';

export const GP = { target: null, entityTarget: null, mining: null, miningHold: false, useCooldown: 0, breakCooldown: 0 };
const REACH = 5.5;

// ---------------- mira ----------------
const _d = { x: 0, y: 0, z: 0 };
export function updateTarget() {
  const cam = G.camera, pl = G.player;
  const e = pl.eyePos();
  _d.x = -Math.sin(pl.yaw) * Math.cos(pl.pitch); _d.y = Math.sin(pl.pitch); _d.z = -Math.cos(pl.yaw) * Math.cos(pl.pitch);
  const hit = raycast(e, _d, REACH);
  const ent = hook('pickEntity', e, _d, hit ? hit.t : REACH);
  GP.entityTarget = ent || null;
  GP.target = ent ? null : hit;
  GP.eye = e; GP.dir = _d;
  return GP.target;
}

// ---------------- mineração ----------------
export function breakTime(id, held) {
  const d = BLOCKS[id];
  if (!d || d.hard < 0) return Infinity;
  if (G.mode === 'creative') return 0;
  const tool = held && ITEMS[held.k] && ITEMS[held.k].tool;
  const right = tool && d.tool && tool.kind === d.tool;
  const harvest = !d.tier || (right && tool.tier >= d.tier);
  let t = d.hard * (harvest ? 1.5 : 5);
  if (right) t /= tool.speed;
  else if (tool && tool.kind === 'sword' && d.leaves) t /= 3;
  const pl = G.player;
  if (pl.headInWater) t *= 5;
  if (!pl.onGround && !pl.fly && !pl.inWater) t *= 3;
  return t;
}
export function canHarvest(id, held) {
  const d = BLOCKS[id];
  if (!d.tier) return true;
  const tool = held && ITEMS[held.k] && ITEMS[held.k].tool;
  return !!(tool && tool.kind === d.tool && tool.tier >= d.tier);
}

export function primaryDown() { GP.miningHold = true; GP.attackQueued = true; }
export function primaryUp() { GP.miningHold = false; GP.mining = null; hook('miningProgress', null, 0); }

export function updateMining(dt) {
  const pl = G.player;
  GP.breakCooldown = Math.max(0, GP.breakCooldown - dt);
  GP.useCooldown = Math.max(0, GP.useCooldown - dt);
  if (GP.attackQueued && GP.entityTarget) { GP.attackQueued = false; attackEntity(GP.entityTarget); return; }
  GP.attackQueued = false;
  if (!GP.miningHold || pl.dead) { GP.mining = null; return; }
  if (GP.entityTarget) { if (GP.breakCooldown <= 0) attackEntity(GP.entityTarget); return; }
  const h = GP.target;
  if (!h) { GP.mining = null; return; }
  const key = h.x + ',' + h.y + ',' + h.z;
  if (!GP.mining || GP.mining.key !== key) GP.mining = { key, x: h.x, y: h.y, z: h.z, id: h.id, p: 0 };
  if (GP.breakCooldown > 0) return;
  const t = breakTime(h.id, pl.held());
  if (!isFinite(t)) return;
  GP.mining.p += t <= 0 ? 1 : dt / t;
  pl.swing = Math.max(pl.swing, 0.6);
  if (Math.random() < dt * 4) hook('sound', 'dig', BLOCKS[h.id] && BLOCKS[h.id].sound, 0.3);
  if (GP.mining.p >= 1) {
    breakBlockAt(h.x, h.y, h.z, true);
    GP.mining = null;
    GP.breakCooldown = G.mode === 'creative' ? 0.2 : 0.05;
  }
}

// quebra o bloco (com drops); fromPlayer = desgasta ferramenta e conta estatísticas
export function breakBlockAt(x, y, z, fromPlayer) {
  const w = G.world;
  const id = w.getBlock(x, y, z), meta = w.getMeta(x, y, z);
  if (!id || LIQUID[id] || id === B.BEDROCK && G.mode !== 'creative') return false;
  const d = BLOCKS[id];
  const pl = G.player;
  const held = fromPlayer ? pl.held() : null;
  if (fromPlayer && G.net && !hook('netCanEdit', x, y, z)) return false;
  // conteúdo de baús/fornalhas cai no chão
  const bd = w.blockData.get(x + ',' + y + ',' + z);
  if (bd && G.mode !== 'creative') for (const inv of [bd.inv, bd.input, bd.fuel, bd.output]) if (inv) for (const s of (inv.slots || [])) if (s) hook('dropItem', x + 0.5, y + 0.5, z + 0.5, s.k, s.n, s.d);
  hook('blockBroken', x, y, z, id, meta);
  setBlock(x, y, z, B.AIR, 0);
  // partes ligadas: porta (2 blocos), cama (2 blocos), pistão estendido
  if (id === B.DOOR) { const oy = meta & 8 ? -1 : 1; if (w.getBlock(x, y + oy, z) === B.DOOR) setBlock(x, y + oy, z, B.AIR, 0); }
  if (id === B.BED) { const [fx, fz] = FACING[meta & 3]; const s = meta & 4 ? -1 : 1; if (w.getBlock(x + fx * s, y, z + fz * s) === B.BED) setBlock(x + fx * s, y, z + fz * s, B.AIR, 0); }
  if (id === B.PISTON && (meta & 8)) { const [dx, dy, dz] = PISTON_DIR[meta & 7]; if (w.getBlock(x + dx, y + dy, z + dz) === B.PISTON_HEAD) setBlock(x + dx, y + dy, z + dz, B.AIR, 0); }
  if (id === B.PISTON_HEAD) { const [dx, dy, dz] = PISTON_DIR[meta & 7]; if (w.getBlock(x - dx, y - dy, z - dz) === B.PISTON) { const m = w.getMeta(x - dx, y - dy, z - dz); setBlock(x - dx, y - dy, z - dz, B.AIR, 0); if (G.mode !== 'creative') hook('dropItem', x - dx + 0.5, y - dy + 0.5, z - dz + 0.5, 'piston', 1); void m; } }
  if (G.mode !== 'creative' && (canHarvest(id, held) || !fromPlayer)) {
    const tool = held && ITEMS[held.k] ? ITEMS[held.k].tool : null;
    for (const [k, n] of blockDrops(id, meta, tool)) if (n > 0) hook('dropItem', x + 0.5, y + 0.4, z + 0.5, k, n);
  }
  if (fromPlayer) {
    hook('particles', x, y, z, id);
    hook('sound', 'break', d.sound);
    pl.stats.blocksBroken++;
    pl.addExhaustion(0.005);
    damageHeld(1);
    hook('challengeEvent', 'break', id);
    if (G.mode !== 'creative' && d.leaves === undefined && id === B.LOG) hook('challengeEvent', 'wood', 1);
  }
  return true;
}

export function damageHeld(n) {
  const pl = G.player;
  if (G.mode === 'creative') return;
  const s = pl.held();
  if (!s || !ITEMS[s.k] || !ITEMS[s.k].tool) return;
  s.d = (s.d || 0) + n;
  if (s.d >= ITEMS[s.k].tool.dur) { pl.inv.set(pl.selected, null); hook('sound', 'toolbreak'); hook('toast', `${ITEMS[s.k].name} quebrou!`); }
  pl.inv.changed = true;
}

function attackEntity(ent) {
  const pl = G.player;
  if (GP.breakCooldown > 0) return;
  const s = pl.held();
  const tool = s && ITEMS[s.k] ? ITEMS[s.k].tool : null;
  const dmg = tool ? tool.dmg : 1;
  const crit = !pl.onGround && pl.vel.y < 0 ? 1.5 : 1;
  hook('attackEntity', ent, dmg * crit, pl);
  pl.swing = 1;
  pl.addExhaustion(0.1);
  GP.breakCooldown = tool && tool.kind === 'sword' ? 0.45 : 0.6;
  if (tool) damageHeld(tool.kind === 'sword' ? 1 : 2);
}

// ---------------- colocar / usar ----------------
export function setBlock(x, y, z, id, meta) {
  const w = G.world;
  const old = w.getBlock(x, y, z), oldMeta = w.getMeta(x, y, z);
  if (!w.setBlock(x, y, z, id, meta)) return false;
  hook('netBlock', x, y, z, id, meta, old, oldMeta);
  neighborUpdate(x, y, z, old, id);
  return true;
}

function yawFacing() {
  // direção para onde o jogador olha → facing do bloco apontando PARA o jogador
  const yaw = G.player.yaw;
  const dx = -Math.sin(yaw), dz = -Math.cos(yaw);
  let f;
  if (Math.abs(dx) > Math.abs(dz)) f = dx > 0 ? 3 : 1; else f = dz > 0 ? 0 : 2;
  return { look: f, toward: (f + 2) & 3 };
}
function lookFacing6() {
  const pl = G.player;
  if (pl.pitch > 0.8) return 5; // olhando para cima → pistão aponta para baixo... (aponta para o jogador)
  if (pl.pitch < -0.8) return 4;
  return yawFacing().toward;
}

function canPlaceAt(x, y, z, id) {
  const w = G.world;
  const cur = w.getBlock(x, y, z);
  if (cur && !LIQUID[cur] && !(BLOCKS[cur] && BLOCKS[cur].shape === 'cross') && cur !== B.WHEAT) return false;
  if (y < 1 || y > 126) return false;
  if (SOLID[id] && !(BLOCKS[id] && ['torch', 'wire', 'rail', 'button', 'plate', 'cross'].includes(BLOCKS[id].shape))) {
    const p = G.player.pos, hw = G.player.hw;
    if (x + 1 > p.x - hw && x < p.x + hw && y + 1 > p.y && y < p.y + G.player.hh && z + 1 > p.z - hw && z < p.z + hw) return false;
    if (hook('entityBlocks', x, y, z)) return false;
  }
  return true;
}
function needsFloor(id) { return ['torch', 'wire', 'rail', 'plate', 'cross', 'crop', 'button', 'lever'].includes(BLOCKS[id] && BLOCKS[id].shape); }

export function secondaryAction() {
  const pl = G.player;
  if (pl.dead || GP.useCooldown > 0) return;
  GP.useCooldown = 0.22;
  const w = G.world;
  const s = pl.held();
  const item = s ? ITEMS[s.k] : null;
  // entidades (aldeões, montarias, animais)
  if (GP.entityTarget) { if (hook('useEntity', GP.entityTarget, s)) { pl.swing = 1; return; } }
  const h = GP.target;
  // isqueiro: acende TNT ou põe fogo na face apontada
  if (item && item.tool && item.tool.kind === 'igniter' && h) {
    const ok = w.getBlock(h.x, h.y, h.z) === B.TNT ? ignite(h.x, h.y, h.z) : ignite(h.x + h.face[0], h.y + h.face[1], h.z + h.face[2]);
    if (ok) { damageHeld(1); hook('sound', 'ignite', { x: h.x + 0.5, y: h.y + 0.5, z: h.z + 0.5 }); pl.swing = 1; }
    return;
  }
  // blocos com interação (a não ser agachado colocando bloco)
  if (h && !(pl.sneak && item && item.block)) {
    const d = BLOCKS[h.id];
    if (d && d.use && useBlock(h.x, h.y, h.z, h.id, h.meta, d.use)) { pl.swing = 1; return; }
  }
  if (!item) return;
  // comida
  if (item.food) { if (pl.eat(item)) { consumeHeld(); hook('sound', 'eat'); hook('particles', pl.pos.x - 0.5, pl.pos.y + 1, pl.pos.z - 0.5, B.WHEAT); pl.swing = 1; } return; }
  // baldes
  if (item.bucket !== undefined) { useBucket(item); return; }
  // veículos
  if (item.vehicle) { const hh = raycast(GP.eye, GP.dir, REACH, { liquids: true }); if (hh && hook('placeVehicle', item.vehicle, hh)) { consumeHeld(); pl.swing = 1; } return; }
  if (!h) return;
  // ferramentas com uso: enxada, farinha de osso, tesoura
  if (item.tool && item.tool.kind === 'hoe' && (h.id === B.GRASS || h.id === B.DIRT || h.id === B.PATH) && w.getBlock(h.x, h.y + 1, h.z) === B.AIR) {
    setBlock(h.x, h.y, h.z, B.FARMLAND, 0); damageHeld(1); hook('sound', 'place', 'gravel'); pl.swing = 1; return;
  }
  if (item.tool && item.tool.kind === 'shovel' && h.id === B.GRASS && h.face[1] === 1) { setBlock(h.x, h.y, h.z, B.PATH, 0); damageHeld(1); pl.swing = 1; return; }
  if (s.k === 'bone_meal') {
    if (h.id === B.WHEAT && (h.meta & 7) < 7) { setBlock(h.x, h.y, h.z, B.WHEAT, Math.min(7, (h.meta & 7) + 2 + Math.floor(Math.random() * 3))); consumeHeld(); hook('particles', h.x, h.y, h.z, B.LEAVES); return; }
    if (h.id === B.SAPLING) { growTree(h.x, h.y, h.z); consumeHeld(); return; }
    if (h.id === B.GRASS) { for (let i = 0; i < 6; i++) { const x = h.x + Math.floor(Math.random() * 5) - 2, z = h.z + Math.floor(Math.random() * 5) - 2; if (w.getBlock(x, h.y, z) === B.GRASS && w.getBlock(x, h.y + 1, z) === B.AIR && Math.random() < 0.3) setBlock(x, h.y + 1, z, B.SAPLING, 0); } consumeHeld(); return; }
  }
  // sementes
  if (item.places != null) {
    if (h.face[1] === 1 && item.placeOn.includes(h.id) && w.getBlock(h.x, h.y + 1, h.z) === B.AIR) { setBlock(h.x, h.y + 1, h.z, item.places, 0); consumeHeld(); hook('sound', 'place', 'grass'); pl.swing = 1; }
    return;
  }
  if (!item.block) return;
  placeBlockItem(h, item);
}

function placeBlockItem(h, item) {
  const pl = G.player, w = G.world;
  const id = item.block;
  const d = BLOCKS[id];
  // laje sobre laje do mesmo tipo vira bloco cheio
  if ((id === B.SLAB_COBBLE || id === B.SLAB_PLANKS) && h.id === id && ((h.face[1] === 1 && !(h.meta & 1)) || (h.face[1] === -1 && (h.meta & 1)))) {
    if (setBlock(h.x, h.y, h.z, id === B.SLAB_COBBLE ? B.COBBLE : B.PLANKS, 0)) { consumeHeld(); afterPlace(id); }
    return;
  }
  const replace = BLOCKS[h.id] && (BLOCKS[h.id].shape === 'cross') && !SOLID[h.id];
  const x = replace ? h.x : h.x + h.face[0], y = replace ? h.y : h.y + h.face[1], z = replace ? h.z : h.z + h.face[2];
  if (!canPlaceAt(x, y, z, id)) return;
  const below = w.getBlock(x, y - 1, z);
  const { look, toward } = yawFacing();
  let meta = 0;
  if (d.facing) meta = toward;
  if (d.facing6) meta = lookFacing6();
  switch (d.shape) {
    case 'slab': { const hitY = GP.eye.y + GP.dir.y * h.t; meta = h.face[1] === -1 || (h.face[1] === 0 && hitY - Math.floor(hitY) > 0.5) ? 1 : 0; break; }
    case 'stairs': { const hitY = GP.eye.y + GP.dir.y * h.t; meta = look | (h.face[1] === -1 || (h.face[1] === 0 && hitY - Math.floor(hitY) > 0.5) ? 4 : 0); break; }
    case 'torch': {
      if (h.face[1] === 1) { if (!FULL[below] && !SOLID[below]) return; meta = 0; }
      else if (h.face[1] === 0) { const f = h.face[0] === 1 ? 3 : h.face[0] === -1 ? 1 : h.face[2] === 1 ? 0 : 2; meta = 1 + f; }
      else return;
      break;
    }
    case 'ladder': {
      if (h.face[1] !== 0 || !FULL[h.id]) return;
      meta = h.face[0] === 1 ? 3 : h.face[0] === -1 ? 1 : h.face[2] === 1 ? 0 : 2;
      break;
    }
    case 'door': {
      if (!SOLID[below] || !canPlaceAt(x, y + 1, z, id)) return;
      setBlock(x, y, z, B.DOOR, toward);
      setBlock(x, y + 1, z, B.DOOR, toward | 8);
      consumeHeld(); afterPlace(id); return;
    }
    case 'bed': {
      const [fx, fz] = FACING[look];
      if (!SOLID[below] || !canPlaceAt(x + fx, y, z + fz, id) || !SOLID[w.getBlock(x + fx, y - 1, z + fz)]) return;
      setBlock(x, y, z, B.BED, look);
      setBlock(x + fx, y, z + fz, B.BED, look | 4);
      consumeHeld(); afterPlace(id); return;
    }
    case 'rail': meta = railShape(x, y, z, look); break;
  }
  if (needsFloor(id) && d.shape !== 'torch' && !SOLID[below]) return;
  if (id === B.SAPLING && ![B.GRASS, B.DIRT, B.FARMLAND, B.SNOW].includes(below)) return;
  if (id === B.CACTUS && ![B.SAND, B.CACTUS].includes(below)) return;
  if (setBlock(x, y, z, id, meta)) {
    consumeHeld();
    afterPlace(id);
    if (d.shape === 'rail') updateRailNeighbors(x, y, z);
  }
}
function afterPlace(id) {
  const pl = G.player;
  pl.swing = 1;
  pl.stats.blocksPlaced++;
  hook('sound', 'place', BLOCKS[id] && BLOCKS[id].sound);
  hook('challengeEvent', 'place', id);
}
export function consumeHeld(n = 1) {
  const pl = G.player;
  if (G.mode === 'creative') return;
  const s = pl.held();
  if (!s) return;
  s.n -= n;
  if (s.n <= 0) pl.inv.set(pl.selected, null);
  pl.inv.changed = true;
}

function useBucket(item) {
  const pl = G.player, w = G.world;
  const h = raycast(GP.eye, GP.dir, REACH, { liquids: true });
  if (!h) return;
  if (item.bucket === 0) {
    // só a fonte (nível 0) enche o balde
    if (LIQUID[h.id] && w.getMeta(h.x, h.y, h.z) === 0) {
      setBlock(h.x, h.y, h.z, B.AIR, 0);
      const full = h.id === B.WATER ? 'water_bucket' : 'lava_bucket';
      if (G.mode !== 'creative') { consumeHeld(); if (pl.inv.add(full, 1)) hook('dropItem', pl.pos.x, pl.pos.y + 1, pl.pos.z, full, 1); }
      hook('sound', 'bucket'); pl.swing = 1;
    }
    return;
  }
  const x = h.x + h.face[0], y = h.y + h.face[1], z = h.z + h.face[2];
  const cur = w.getBlock(x, y, z);
  if (cur && !LIQUID[cur] && SOLID[cur]) return;
  setBlock(x, y, z, item.bucket, 0);
  if (G.mode !== 'creative') { pl.inv.set(pl.selected, { k: 'bucket', n: 1, d: 0 }); }
  hook('sound', 'bucket'); pl.swing = 1;
}

// interações com blocos
function useBlock(x, y, z, id, meta, use) {
  const w = G.world;
  switch (use) {
    case 'craft': hook('openScreen', 'craft', { x, y, z }); return true;
    case 'furnace': hook('openScreen', 'furnace', { x, y, z, data: furnaceData(x, y, z) }); return true;
    case 'chest': hook('openScreen', 'chest', { x, y, z, data: chestData(x, y, z, meta) }); hook('sound', 'chest'); return true;
    case 'door': {
      const top = meta & 8;
      const by = top ? y - 1 : y;
      const m0 = w.getMeta(x, by, z);
      const open = !(m0 & 4);
      setBlock(x, by, z, B.DOOR, (m0 & ~4) | (open ? 4 : 0));
      if (w.getBlock(x, by + 1, z) === B.DOOR) setBlock(x, by + 1, z, B.DOOR, (w.getMeta(x, by + 1, z) & ~4) | (open ? 4 : 0));
      hook('sound', open ? 'door_open' : 'door_close');
      return true;
    }
    case 'gate': setBlock(x, y, z, id, meta ^ 4); hook('sound', meta & 4 ? 'door_close' : 'door_open'); return true;
    case 'bed': return hook('useBed', x, y, z, meta) !== false;
    case 'sit': if (G.player.riding) return false; G.player.sitting = { x, y, z }; G.player.pos.x = x + 0.5; G.player.pos.z = z + 0.5; G.player.pos.y = y + 0.1; return true;
    case 'lever': setBlock(x, y, z, id, meta ^ 8); hook('sound', 'click'); hook('powerChanged', x, y, z); return true;
    case 'button': if (meta & 8) return true; setBlock(x, y, z, id, meta | 8); hook('sound', 'click'); hook('powerChanged', x, y, z); scheduleTick(x, y, z, 1.0, 'button'); return true;
  }
  return false;
}

// ---------------- dados de blocos: baús e fornalhas ----------------
export function chestData(x, y, z, meta) {
  const w = G.world, key = x + ',' + y + ',' + z;
  let d = w.blockData.get(key);
  if (!d) {
    d = { type: 'chest', inv: new Inventory(27) };
    const loot = (meta >> 4) & 7;
    if (loot) fillLoot(d.inv, loot, x, y, z);
    w.blockData.set(key, d);
    w.setMeta(x, y, z, meta & 15);
  } else if (!(d.inv instanceof Inventory)) d.inv = Inventory.from(d.inv, 27);
  return d;
}
function fillLoot(inv, kind, x, y, z) {
  let s = Math.floor(hash3(x, y, z, 99) * 1e9);
  const rnd = () => { s = (s * 16807 + 11) % 2147483647; return s / 2147483647; };
  const tables = {
    1: [['bread', 1, 3, 0.6], ['apple', 1, 4, 0.5], ['wheat', 2, 6, 0.5], ['seeds', 2, 5, 0.4], ['iron_ingot', 1, 3, 0.25], ['coin', 2, 8, 0.6], ['torch', 2, 8, 0.4], ['leather_boots', 1, 1, 0.15], ['stone_pickaxe', 1, 1, 0.2], ['saddle', 1, 1, 0.1]],
    2: [['bone', 2, 6, 0.7], ['rotten_flesh', 1, 5, 0.6], ['iron_ingot', 1, 4, 0.5], ['gold_ingot', 1, 3, 0.4], ['diamond', 1, 2, 0.15], ['coal', 2, 8, 0.6], ['bucket', 1, 1, 0.2], ['saddle', 1, 1, 0.25], ['iron_sword', 1, 1, 0.15], ['crystal', 1, 4, 0.25], ['coin', 3, 12, 0.5]],
    3: [['gold_ingot', 1, 4, 0.5], ['diamond', 1, 2, 0.2], ['coin', 4, 16, 0.7], ['crystal', 2, 5, 0.3], ['bone', 1, 4, 0.4], ['copper_ingot', 2, 6, 0.5], ['map', 1, 1, 0.3]],
  };
  for (const [k, a, b, p] of tables[kind] || []) if (rnd() < p) {
    const slot = Math.floor(rnd() * 27);
    if (!inv.get(slot)) inv.set(slot, { k, n: a + Math.floor(rnd() * (b - a + 1)), d: 0 });
    else inv.add(k, a);
  }
}
export function furnaceData(x, y, z) {
  const w = G.world, key = x + ',' + y + ',' + z;
  let d = w.blockData.get(key);
  if (!d) { d = { type: 'furnace', input: new Inventory(1), fuel: new Inventory(1), output: new Inventory(1), burn: 0, burnMax: 0, cook: 0 }; w.blockData.set(key, d); }
  for (const k of ['input', 'fuel', 'output']) if (!(d[k] instanceof Inventory)) d[k] = Inventory.from(d[k], 1);
  return d;
}
// fornalhas funcionam mesmo com a interface fechada (enquanto o chunk está carregado)
export function updateFurnaces(dt) {
  const w = G.world;
  for (const [key, d] of w.blockData) {
    if (d.type !== 'furnace') continue;
    const [x, y, z] = key.split(',').map(Number);
    if (!w.chunks.has(Math.floor(x / 16) + ',' + Math.floor(z / 16))) continue;
    for (const k of ['input', 'fuel', 'output']) if (!(d[k] instanceof Inventory)) d[k] = Inventory.from(d[k], 1);
    const inp = d.input.get(0), out = d.output.get(0);
    const res = inp ? smeltResult(inp.k) : null;
    const canSmelt = res && (!out || (out.k === res && out.n < 64));
    if (d.burn <= 0 && canSmelt) {
      const f = d.fuel.get(0);
      const fv = f ? fuelValue(f.k) : 0;
      if (fv > 0) {
        d.burn = d.burnMax = fv / 8 * SMELT_TIME;
        if (f.k === 'lava_bucket') d.fuel.set(0, { k: 'bucket', n: 1, d: 0 });
        else { f.n--; if (!f.n) d.fuel.set(0, null); }
      }
    }
    const lit = d.burn > 0;
    if (lit) {
      d.burn -= dt;
      if (canSmelt) {
        d.cook += dt;
        if (d.cook >= SMELT_TIME) {
          d.cook = 0;
          inp.n--; if (!inp.n) d.input.set(0, null);
          if (out) out.n++; else d.output.set(0, { k: res, n: 1, d: 0 });
          hook('challengeEvent', 'smelt', res);
        }
      } else d.cook = 0;
    } else d.cook = Math.max(0, d.cook - dt * 2);
    const id = w.getBlock(x, y, z);
    if (lit && id === B.FURNACE) w.setBlock(x, y, z, B.FURNACE_LIT, w.getMeta(x, y, z));
    else if (!lit && id === B.FURNACE_LIT) w.setBlock(x, y, z, B.FURNACE, w.getMeta(x, y, z));
    d.changed = true;
  }
}

// ---------------- atualizações de blocos ----------------
const ticks = [];
export function scheduleTick(x, y, z, delay, kind) { ticks.push({ x, y, z, t: delay, kind }); }
export function updateTicks(dt) {
  for (let i = ticks.length - 1; i >= 0; i--) {
    const k = ticks[i];
    k.t -= dt;
    if (k.t > 0) continue;
    ticks.splice(i, 1);
    const w = G.world;
    if (k.kind === 'button' && w.getBlock(k.x, k.y, k.z) === B.BUTTON) { setBlock(k.x, k.y, k.z, B.BUTTON, w.getMeta(k.x, k.y, k.z) & ~8); hook('powerChanged', k.x, k.y, k.z); hook('sound', 'click'); }
    if (k.kind === 'fall') fallBlock(k.x, k.y, k.z);
  }
}

// reação de vizinhos: plantas sem apoio, areia caindo, mecanismos
function neighborUpdate(x, y, z, oldId, newId) {
  const w = G.world;
  const above = w.getBlock(x, y + 1, z);
  if (!SOLID[newId] || newId === B.FARMLAND && false) {
    const d = BLOCKS[above];
    if (d && (['cross', 'crop', 'torch', 'wire', 'rail', 'plate', 'button', 'lever'].includes(d.shape) || above === B.CACTUS) && !(d.shape === 'torch' && w.getMeta(x, y + 1, z) !== 0)) {
      if (!(above === B.DOOR)) breakBlockAt(x, y + 1, z, false);
    }
    if (d && d.falls) scheduleTick(x, y + 1, z, 0.05, 'fall');
    if (above === B.DOOR && !(w.getMeta(x, y + 1, z) & 8)) breakBlockAt(x, y + 1, z, false);
  }
  // tochas e escadas de mão presas na parede removida
  if (!SOLID[newId]) for (let f = 0; f < 4; f++) {
    const [fx, fz] = FACING[f];
    const nx = x + fx, nz = z + fz;
    const nid = w.getBlock(nx, y, nz);
    if (nid === B.TORCH && w.getMeta(nx, y, nz) === 1 + f) breakBlockAt(nx, y, nz, false);
    // escada de mão: a caixa fica do lado da parede (meta 0 = -z, 1 = +x, 2 = +z, 3 = -x)
    if (nid === B.LADDER) { const m = w.getMeta(nx, y, nz) & 3; const side = [[0, -1], [1, 0], [0, 1], [-1, 0]][m]; if (nx + side[0] === x && nz + side[1] === z) breakBlockAt(nx, y, nz, false); }
  }
  const d = BLOCKS[newId];
  if (d && d.falls && !SOLID[w.getBlock(x, y - 1, z)]) scheduleTick(x, y, z, 0.05, 'fall');
  if (newId === B.WHEAT && w.getBlock(x, y - 1, z) !== B.FARMLAND) breakBlockAt(x, y, z, false);
  // líquidos e fogo vizinhos reagem à mudança
  wakeAround(x, y, z);
  hook('blockChanged', x, y, z, oldId, newId);
}
function fallBlock(x, y, z) {
  const w = G.world;
  const id = w.getBlock(x, y, z);
  if (!BLOCKS[id] || !BLOCKS[id].falls) return;
  if (SOLID[w.getBlock(x, y - 1, z)]) return;
  // vira uma entidade que cai de verdade (com aceleração) e volta a ser bloco ao tocar o chão
  const meta = w.getMeta(x, y, z);
  setBlock(x, y, z, B.AIR, 0);
  hook('spawnFalling', x, y, z, id, meta);
}

// ticks aleatórios: cultivos e mudas crescem, grama se espalha
export function randomTicks(dt) {
  const w = G.world, p = G.player.pos;
  const n = Math.floor(dt * 400);
  for (let i = 0; i < n; i++) {
    const x = Math.floor(p.x + (Math.random() - 0.5) * 64), z = Math.floor(p.z + (Math.random() - 0.5) * 64);
    const y = Math.floor(p.y + (Math.random() - 0.5) * 40);
    if (y < 1 || y > 126) continue;
    const id = w.peekBlock(x, y, z);
    if (id === B.WHEAT) { const m = w.getMeta(x, y, z) & 7; if (m < 7 && Math.random() < 0.35) setBlock(x, y, z, B.WHEAT, m + 1); }
    else if (id === B.SAPLING && Math.random() < 0.08) growTree(x, y, z);
    else if (id === B.DIRT && w.getBlock(x, y + 1, z) === B.AIR) {
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (w.peekBlock(x + dx, y, z + dz) === B.GRASS) { setBlock(x, y, z, B.GRASS, 0); break; }
    } else if (id === B.FARMLAND && w.getBlock(x, y + 1, z) === B.AIR && Math.random() < 0.05) setBlock(x, y, z, B.DIRT, 0);
  }
}
export function growTree(x, y, z) {
  const w = G.world;
  const th = 4 + Math.floor(Math.random() * 3);
  for (let i = 1; i <= th + 1; i++) if (SOLID[w.getBlock(x, y + i, z)]) return;
  setBlock(x, y, z, B.LOG, 0);
  for (let i = 1; i < th; i++) setBlock(x, y + i, z, B.LOG, 0);
  const top = y + th;
  for (let yy = top - 2; yy <= top + 1; yy++) {
    const rad = yy >= top ? 1 : 2;
    for (let dz = -rad; dz <= rad; dz++) for (let dx = -rad; dx <= rad; dx++) {
      if (Math.abs(dx) === rad && Math.abs(dz) === rad && (yy === top + 1 || Math.random() < 0.5)) continue;
      if (w.getBlock(x + dx, yy, z + dz) === B.AIR) setBlock(x + dx, yy, z + dz, B.LEAVES, 0);
    }
  }
}

// ---------------- trilhos ----------------
const isRail = (x, y, z) => G.world.getBlock(x, y, z) === B.RAIL;
export function railShape(x, y, z, look) {
  const n = isRail(x, y, z - 1), s = isRail(x, y, z + 1), e = isRail(x + 1, y, z), wst = isRail(x - 1, y, z);
  // curvas: 2 = sul-leste, 3 = sul-oeste, 4 = norte-oeste, 5 = norte-leste
  if (s && e && !n && !wst) return 2;
  if (s && wst && !n && !e) return 3;
  if (n && wst && !s && !e) return 4;
  if (n && e && !s && !wst) return 5;
  if (e || wst) return (n || s) ? 0 : 1;
  if (n || s) return 0;
  return (look === 1 || look === 3) ? 1 : 0;
}
function updateRailNeighbors(x, y, z) {
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (isRail(x + dx, y, z + dz)) {
    const m = railShape(x + dx, y, z + dz, 0);
    if (G.world.getMeta(x + dx, y, z + dz) !== m) G.world.setBlock(x + dx, y, z + dz, B.RAIL, m);
  }
  const m = railShape(x, y, z, 0);
  if (G.world.getMeta(x, y, z) !== m) G.world.setBlock(x, y, z, B.RAIL, m);
}

export function blockItemFor(id) { return blockItemKey(id); }
