// Registro de itens: blocos, ferramentas, armas, armaduras, comidas, materiais e veículos.
import { B, BLOCKS, BLOCK_COUNT } from './blocks.js';

export const ITEMS = {};
const add = (key, def) => { ITEMS[key] = Object.assign({ key, stack: 64 }, def); };

// ---- blocos como itens ----
for (let id = 1; id < BLOCK_COUNT; id++) {
  const d = BLOCKS[id];
  if (!d || d.hidden || d.liquid) continue;
  add(d.key, { name: d.name, block: id, fuel: d.fuel });
}
ITEMS.bedrock.creativeOnly = true;

// ---- ferramentas ----
export const TIERS = {
  wood: { name: 'madeira', tier: 1, speed: 2, dur: 60, dmg: 0, color: [150, 110, 62], mat: 'planks' },
  stone: { name: 'pedra', tier: 2, speed: 4, dur: 132, dmg: 1, color: [128, 128, 128], mat: 'cobble' },
  copper: { name: 'cobre', tier: 2, speed: 5, dur: 190, dmg: 1.5, color: [214, 122, 80], mat: 'copper_ingot' },
  iron: { name: 'ferro', tier: 3, speed: 6, dur: 250, dmg: 2, color: [222, 222, 228], mat: 'iron_ingot' },
  diamond: { name: 'diamante', tier: 4, speed: 8, dur: 1560, dmg: 3, color: [92, 232, 222], mat: 'diamond' },
};
const TOOL_KINDS = {
  pickaxe: { name: 'Picareta', dmg: 2 }, axe: { name: 'Machado', dmg: 4 }, shovel: { name: 'Pá', dmg: 1.5 },
  sword: { name: 'Espada', dmg: 4 }, hoe: { name: 'Enxada', dmg: 1 },
};
for (const t in TIERS) for (const k in TOOL_KINDS) {
  const T = TIERS[t], K = TOOL_KINDS[k];
  add(t + '_' + k, {
    name: `${K.name} de ${T.name}`, stack: 1, tool: { kind: k, tier: T.tier, speed: T.speed, dur: T.dur, dmg: K.dmg + T.dmg + (k === 'sword' ? 1 : 0) },
    icon: { shape: k, color: T.color }, fuel: t === 'wood' ? 10 : 0,
  });
}
add('bow', { name: 'Arco', stack: 1, tool: { kind: 'bow', tier: 0, speed: 1, dur: 384, dmg: 1 }, icon: { shape: 'bow' }, fuel: 10 });
add('flint_and_steel', { name: 'Isqueiro de pederneira', stack: 1, tool: { kind: 'igniter', tier: 0, speed: 1, dur: 64, dmg: 1 }, icon: { shape: 'flintsteel' } });
add('flint', { name: 'Pederneira', icon: { shape: 'lump', color: [70, 70, 75] } });
add('shears', { name: 'Tesoura', stack: 1, tool: { kind: 'shears', tier: 0, speed: 1, dur: 238, dmg: 1 }, icon: { shape: 'shears' } });

// ---- armaduras ----
const ARMOR = {
  leather: { name: 'couro', def: [1, 3, 2, 1], dur: 80, color: [140, 86, 50], mat: 'leather' },
  copper: { name: 'cobre', def: [2, 4, 3, 1], dur: 150, color: [214, 122, 80], mat: 'copper_ingot' },
  iron: { name: 'ferro', def: [2, 6, 5, 2], dur: 240, color: [222, 222, 228], mat: 'iron_ingot' },
  diamond: { name: 'diamante', def: [3, 8, 6, 3], dur: 500, color: [92, 232, 222], mat: 'diamond' },
};
export const ARMOR_SLOTS = ['helmet', 'chest', 'legs', 'boots'];
const ARMOR_NAMES = { helmet: 'Capacete', chest: 'Peitoral', legs: 'Calças', boots: 'Botas' };
for (const m in ARMOR) ARMOR_SLOTS.forEach((s, i) => {
  add(m + '_' + s, { name: `${ARMOR_NAMES[s]} de ${ARMOR[m].name}`, stack: 1, armor: { slot: i, def: ARMOR[m].def[i], dur: ARMOR[m].dur }, icon: { shape: s, color: ARMOR[m].color } });
});
export const ARMOR_MATS = ARMOR;

// ---- comidas ----
const food = (key, name, hunger, sat, icon, extra = {}) => add(key, Object.assign({ name, food: { hunger, sat }, icon }, extra));
food('apple', 'Maçã', 4, 2.4, { shape: 'apple', color: [210, 30, 30] });
food('bread', 'Pão', 5, 6, { shape: 'bread', color: [196, 140, 70] });
food('beef', 'Carne crua', 3, 1.8, { shape: 'meat', color: [200, 60, 60] }, { smelt: 'cooked_beef' });
food('cooked_beef', 'Bife', 8, 12.8, { shape: 'meat', color: [140, 80, 44] });
food('porkchop', 'Costeleta crua', 3, 1.8, { shape: 'meat', color: [240, 140, 140] }, { smelt: 'cooked_porkchop' });
food('cooked_porkchop', 'Costeleta assada', 8, 12.8, { shape: 'meat', color: [190, 120, 70] });
food('chicken', 'Frango cru', 2, 1.2, { shape: 'drumstick', color: [240, 190, 170] }, { smelt: 'cooked_chicken' });
food('cooked_chicken', 'Frango assado', 6, 7.2, { shape: 'drumstick', color: [190, 120, 60] });
food('mutton', 'Carneiro cru', 2, 1.2, { shape: 'meat', color: [220, 80, 80] }, { smelt: 'cooked_mutton' });
food('cooked_mutton', 'Carneiro assado', 6, 9.6, { shape: 'meat', color: [150, 90, 50] });
food('rabbit', 'Coelho cru', 3, 1.8, { shape: 'drumstick', color: [230, 160, 150] }, { smelt: 'cooked_rabbit' });
food('cooked_rabbit', 'Coelho assado', 5, 6, { shape: 'drumstick', color: [180, 110, 60] });
food('fish', 'Peixe cru', 2, 0.4, { shape: 'fish', color: [120, 160, 200] }, { smelt: 'cooked_fish' });
food('cooked_fish', 'Peixe assado', 5, 6, { shape: 'fish', color: [200, 150, 90] });
food('rotten_flesh', 'Carne podre', 4, 0.8, { shape: 'meat', color: [120, 130, 60] }, { poison: 0.8 });

// ---- materiais ----
const mat = (key, name, icon, extra = {}) => add(key, Object.assign({ name, icon }, extra));
mat('stick', 'Graveto', { shape: 'stick' }, { fuel: 5 });
mat('coal', 'Carvão', { shape: 'lump', color: [40, 40, 44] }, { fuel: 80 });
mat('raw_iron', 'Ferro bruto', { shape: 'lump', color: [210, 170, 140] }, { smelt: 'iron_ingot' });
mat('raw_copper', 'Cobre bruto', { shape: 'lump', color: [220, 120, 80] }, { smelt: 'copper_ingot' });
mat('raw_gold', 'Ouro bruto', { shape: 'lump', color: [250, 214, 80] }, { smelt: 'gold_ingot' });
mat('iron_ingot', 'Barra de ferro', { shape: 'ingot', color: [226, 226, 232] });
mat('copper_ingot', 'Barra de cobre', { shape: 'ingot', color: [222, 126, 82] });
mat('gold_ingot', 'Barra de ouro', { shape: 'ingot', color: [252, 214, 60] });
mat('diamond', 'Diamante', { shape: 'gem', color: [100, 236, 228] });
mat('crystal', 'Cristal', { shape: 'gem', color: [200, 130, 250] });
mat('coin', 'Moeda de ouro', { shape: 'coin', color: [250, 210, 60] });
mat('leather', 'Couro', { shape: 'leather', color: [140, 86, 50] });
mat('feather', 'Pena', { shape: 'feather' });
mat('bone', 'Osso', { shape: 'bone' });
mat('bone_meal', 'Farinha de osso', { shape: 'dust', color: [236, 236, 228] });
mat('string', 'Linha', { shape: 'string' });
mat('arrow', 'Flecha', { shape: 'arrow' });
mat('wheat', 'Trigo', { shape: 'wheat' });
mat('seeds', 'Sementes', { shape: 'seeds' }, { places: B.WHEAT, placeOn: [B.FARMLAND] });
mat('brick_item', 'Tijolo', { shape: 'ingot', color: [170, 80, 56] });
mat('red_dye', 'Corante vermelho', { shape: 'dust', color: [200, 40, 40] });
mat('yellow_dye', 'Corante amarelo', { shape: 'dust', color: [240, 200, 40] });
mat('green_dye', 'Corante verde', { shape: 'dust', color: [80, 140, 40] });
mat('blue_dye', 'Corante azul', { shape: 'dust', color: [50, 70, 200] });
mat('bucket', 'Balde', { shape: 'bucket' }, { stack: 16, bucket: 0 });
mat('water_bucket', 'Balde de água', { shape: 'bucket', color: [50, 110, 220] }, { stack: 1, bucket: B.WATER });
mat('lava_bucket', 'Balde de lava', { shape: 'bucket', color: [250, 120, 20] }, { stack: 1, bucket: B.LAVA, fuel: 1000 });
mat('boat', 'Barco', { shape: 'boat' }, { stack: 1, vehicle: 'boat', fuel: 20 });
mat('minecart', 'Carrinho', { shape: 'minecart' }, { stack: 1, vehicle: 'minecart' });
mat('saddle', 'Sela', { shape: 'saddle' }, { stack: 1 });
mat('map', 'Mapa', { shape: 'map' }, { stack: 1 });

// itens que colocam blocos diferentes do próprio nome
ITEMS.door.icon = { shape: 'door' };
ITEMS.bed.icon = { shape: 'bed' };
ITEMS.torch.icon = { shape: 'torch' };
ITEMS.sapling.icon = { shape: 'sapling' };
ITEMS.dead_bush.icon = { shape: 'deadbush' };
ITEMS.wire.icon = { shape: 'wire' };
ITEMS.rail.icon = { shape: 'rail' };
ITEMS.lever.icon = { shape: 'lever' };
ITEMS.ladder.icon = { shape: 'ladder' };

export const itemName = (k) => (ITEMS[k] ? ITEMS[k].name : k);
export const maxStack = (k) => (ITEMS[k] ? ITEMS[k].stack : 64);
export function blockItemKey(id) { const d = BLOCKS[id]; return d && ITEMS[d.key] ? d.key : null; }

// drops de bloco: [[item, quantidade]] (rnd = Math.random)
export function blockDrops(id, meta, toolDef, rnd = Math.random) {
  const d = BLOCKS[id];
  if (!d) return [];
  if (toolDef && toolDef.kind === 'shears' && d.leaves) return [[d.key, 1]];
  const drop = d.drop === undefined ? d.key : d.drop;
  if (drop === null) return [];
  switch (drop) {
    case 'leaves_drop': {
      const out = [];
      if (rnd() < 0.05) out.push(['sapling', 1]);
      if (id === B.LEAVES && rnd() < 0.02) out.push(['apple', 1]);
      if (rnd() < 0.04) out.push(['stick', 1]);
      return out;
    }
    case 'gravel_drop': return rnd() < 0.12 ? [['flint', 1]] : [['gravel', 1]];
    case 'wheat_drop': return (meta & 7) >= 7 ? [['wheat', 1], ['seeds', 1 + Math.floor(rnd() * 3)]] : [['seeds', 1]];
    case 'dirt': return [['dirt', 1], ...(id === B.GRASS && rnd() < 0.08 ? [['seeds', 1]] : [])];
    case 'raw_iron': case 'raw_copper': case 'raw_gold': case 'coal': case 'diamond':
      return [[drop, drop === 'raw_copper' ? 2 + Math.floor(rnd() * 3) : 1]];
    case 'crystal': return [['crystal', 2 + Math.floor(rnd() * 3)]];
  }
  return ITEMS[drop] ? [[drop, 1]] : [];
}
