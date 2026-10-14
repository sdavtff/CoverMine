// Registro de blocos do VoxelCraft: propriedades físicas, visuais, ferramentas, drops e formas 3D.
// Sem dependências de THREE/DOM (usado também pelo Web Worker de geração de mundo).
import { TILE } from './tiles.js';

export const B = {
  AIR: 0, GRASS: 1, DIRT: 2, STONE: 3, LOG: 4, LEAVES: 5, SAND: 6, WATER: 7, PLANKS: 8, BRICK: 9, GLASS: 10,
  COBBLE: 11, SNOW: 12, BEDROCK: 13, GRAVEL: 14, LAMP: 15, BIRCH_LOG: 16, PINE_LEAVES: 17,
  COAL_ORE: 18, IRON_ORE: 19, COPPER_ORE: 20, GOLD_ORE: 21, DIAMOND_ORE: 22, CRYSTAL_ORE: 23, LAVA: 24,
  SANDSTONE: 25, CACTUS: 26, DEAD_BUSH: 27, ICE: 28, MUD: 29, SPRUCE_LOG: 30, ACACIA_LOG: 31, ACACIA_LEAVES: 32,
  SPRUCE_PLANKS: 33, BIRCH_PLANKS: 34, CRAFTING_TABLE: 35, FURNACE: 36, FURNACE_LIT: 37, CHEST: 38, TORCH: 39,
  DOOR: 40, LADDER: 41, GLASS_PANE: 42, FENCE: 43, FENCE_GATE: 44, SLAB_COBBLE: 45, SLAB_PLANKS: 46,
  STAIRS_COBBLE: 47, STAIRS_PLANKS: 48, BED: 49, TABLE: 50, CHAIR: 51, BOOKSHELF: 52, WOOL_WHITE: 53,
  WOOL_BLACK: 54, WOOL_BROWN: 55, WOOL_GRAY: 56, COLOR_RED: 57, COLOR_BLUE: 58, COLOR_YELLOW: 59, COLOR_GREEN: 60,
  LEVER: 61, BUTTON: 62, PLATE: 63, WIRE: 64, PLAMP: 65, PLAMP_ON: 66, PISTON: 67, PISTON_HEAD: 68, RAIL: 69,
  ELEVATOR: 70, IRON_BLOCK: 71, GOLD_BLOCK: 72, DIAMOND_BLOCK: 73, COPPER_BLOCK: 74, FARMLAND: 75, WHEAT: 76,
  PATH: 77, MOSSY_COBBLE: 78, STONE_BRICKS: 79, CRYSTAL_BLOCK: 80, SAPLING: 81,
  FIRE: 82, TNT: 83, DRIPSTONE: 84, VINE: 85,
};
export const BLOCK_COUNT = 86;

// direções horizontais (meta "facing"): 0 = +z (sul), 1 = -x (oeste), 2 = -z (norte), 3 = +x (leste)
export const FACING = [[0, 1], [-1, 0], [0, -1], [1, 0]];

const T = TILE;
const cube = (all) => [all, all, all];
// tiers: 0 mão, 1 madeira, 2 pedra, 3 ferro, 4 diamante
const DEF = {
  [B.GRASS]: { name: 'Grama', t: [T.GRASS_TOP, T.GRASS_SIDE, T.DIRT], tint: 'grass', hard: 0.6, tool: 'shovel', drop: 'dirt', sound: 'grass' },
  [B.DIRT]: { name: 'Terra', t: cube(T.DIRT), hard: 0.5, tool: 'shovel', sound: 'gravel' },
  [B.STONE]: { name: 'Pedra', t: cube(T.STONE), hard: 1.5, tool: 'pickaxe', tier: 1, drop: 'cobble', sound: 'stone' },
  [B.LOG]: { name: 'Tronco', t: [T.LOG_TOP, T.LOG_SIDE, T.LOG_TOP], hard: 2, tool: 'axe', sound: 'wood', fuel: 15 },
  [B.LEAVES]: { name: 'Folhas', t: cube(T.LEAVES), tint: 'leaves', hard: 0.2, tool: 'hoe', leaves: 1, sound: 'grass', drop: 'leaves_drop' },
  [B.SAND]: { name: 'Areia', t: cube(T.SAND), hard: 0.5, tool: 'shovel', sound: 'sand', falls: 1 },
  [B.WATER]: { name: 'Água', t: cube(T.WATER), liquid: 1, hard: -1 },
  [B.PLANKS]: { name: 'Tábuas', t: cube(T.PLANKS), hard: 2, tool: 'axe', sound: 'wood', fuel: 15 },
  [B.BRICK]: { name: 'Tijolos', t: cube(T.BRICK), hard: 2, tool: 'pickaxe', tier: 1, sound: 'stone' },
  [B.GLASS]: { name: 'Vidro', t: cube(T.GLASS), glass: 1, hard: 0.3, drop: null, sound: 'glass' },
  [B.COBBLE]: { name: 'Pedregulho', t: cube(T.COBBLE), hard: 2, tool: 'pickaxe', tier: 1, sound: 'stone' },
  [B.SNOW]: { name: 'Neve', t: [T.SNOW, T.SNOW_SIDE, T.DIRT], hard: 0.6, tool: 'shovel', drop: 'dirt', sound: 'snow' },
  [B.BEDROCK]: { name: 'Rocha-mãe', t: cube(T.BEDROCK), hard: -1, sound: 'stone' },
  [B.GRAVEL]: { name: 'Cascalho', t: cube(T.GRAVEL), hard: 0.6, tool: 'shovel', sound: 'gravel', falls: 1, drop: 'gravel_drop' },
  [B.LAMP]: { name: 'Lâmpada', t: cube(T.LAMP), light: 15, hard: 0.3, sound: 'glass' },
  [B.BIRCH_LOG]: { name: 'Tronco de bétula', t: [T.BIRCH_TOP, T.BIRCH_SIDE, T.BIRCH_TOP], hard: 2, tool: 'axe', sound: 'wood', fuel: 15 },
  [B.PINE_LEAVES]: { name: 'Folhas de pinheiro', t: cube(T.PINE_LEAVES), tint: 'pine', hard: 0.2, tool: 'hoe', leaves: 1, sound: 'grass', drop: 'leaves_drop' },
  [B.COAL_ORE]: { name: 'Minério de carvão', t: cube(T.COAL_ORE), hard: 3, tool: 'pickaxe', tier: 1, drop: 'coal', xp: 1, sound: 'stone' },
  [B.IRON_ORE]: { name: 'Minério de ferro', t: cube(T.IRON_ORE), hard: 3, tool: 'pickaxe', tier: 2, drop: 'raw_iron', sound: 'stone' },
  [B.COPPER_ORE]: { name: 'Minério de cobre', t: cube(T.COPPER_ORE), hard: 3, tool: 'pickaxe', tier: 2, drop: 'raw_copper', sound: 'stone' },
  [B.GOLD_ORE]: { name: 'Minério de ouro', t: cube(T.GOLD_ORE), hard: 3, tool: 'pickaxe', tier: 3, drop: 'raw_gold', sound: 'stone' },
  [B.DIAMOND_ORE]: { name: 'Minério de diamante', t: cube(T.DIAMOND_ORE), hard: 3, tool: 'pickaxe', tier: 3, drop: 'diamond', xp: 3, sound: 'stone' },
  [B.CRYSTAL_ORE]: { name: 'Minério de cristal', t: cube(T.CRYSTAL_ORE), light: 6, hard: 3, tool: 'pickaxe', tier: 3, drop: 'crystal', xp: 3, sound: 'glass' },
  [B.LAVA]: { name: 'Lava', t: cube(T.LAVA), liquid: 2, light: 15, hard: -1 },
  [B.SANDSTONE]: { name: 'Arenito', t: [T.SANDSTONE_TOP, T.SANDSTONE_SIDE, T.SANDSTONE_TOP], hard: 0.8, tool: 'pickaxe', tier: 1, sound: 'stone' },
  [B.CACTUS]: { name: 'Cacto', t: [T.CACTUS_TOP, T.CACTUS_SIDE, T.CACTUS_TOP], hard: 0.4, sound: 'wood', shape: 'cactus', damage: 1 },
  [B.DEAD_BUSH]: { name: 'Arbusto seco', t: cube(T.DEAD_BUSH), hard: 0, shape: 'cross', drop: 'stick', sound: 'grass' },
  [B.ICE]: { name: 'Gelo', t: cube(T.ICE), hard: 0.5, tool: 'pickaxe', drop: null, slippery: 1, sound: 'glass' },
  [B.MUD]: { name: 'Lama', t: cube(T.MUD), hard: 0.5, tool: 'shovel', sound: 'gravel', slow: 1 },
  [B.SPRUCE_LOG]: { name: 'Tronco de pinheiro', t: [T.SPRUCE_TOP, T.SPRUCE_SIDE, T.SPRUCE_TOP], hard: 2, tool: 'axe', sound: 'wood', fuel: 15 },
  [B.ACACIA_LOG]: { name: 'Tronco de acácia', t: [T.ACACIA_TOP, T.ACACIA_SIDE, T.ACACIA_TOP], hard: 2, tool: 'axe', sound: 'wood', fuel: 15 },
  [B.ACACIA_LEAVES]: { name: 'Folhas de acácia', t: cube(T.ACACIA_LEAVES), tint: 'leaves', hard: 0.2, tool: 'hoe', leaves: 1, sound: 'grass', drop: 'leaves_drop' },
  [B.SPRUCE_PLANKS]: { name: 'Tábuas de pinheiro', t: cube(T.SPRUCE_PLANKS), hard: 2, tool: 'axe', sound: 'wood', fuel: 15 },
  [B.BIRCH_PLANKS]: { name: 'Tábuas de bétula', t: cube(T.BIRCH_PLANKS), hard: 2, tool: 'axe', sound: 'wood', fuel: 15 },
  [B.CRAFTING_TABLE]: { name: 'Mesa de trabalho', t: [T.TABLE_TOP, T.TABLE_SIDE, T.PLANKS], front: T.TABLE_FRONT, hard: 2.5, tool: 'axe', sound: 'wood', use: 'craft', fuel: 15 },
  [B.FURNACE]: { name: 'Fornalha', t: [T.FURNACE_TOP, T.FURNACE_SIDE, T.FURNACE_TOP], front: T.FURNACE_FRONT, hard: 3.5, tool: 'pickaxe', tier: 1, sound: 'stone', use: 'furnace', facing: 1 },
  [B.FURNACE_LIT]: { name: 'Fornalha acesa', t: [T.FURNACE_TOP, T.FURNACE_SIDE, T.FURNACE_TOP], front: T.FURNACE_FRONT_ON, light: 13, hard: 3.5, tool: 'pickaxe', tier: 1, sound: 'stone', use: 'furnace', facing: 1, drop: 'furnace', hidden: 1 },
  [B.CHEST]: { name: 'Baú', t: [T.CHEST_TOP, T.CHEST, T.CHEST_TOP], hard: 2.5, tool: 'axe', sound: 'wood', use: 'chest', shape: 'chest', facing: 1, fuel: 15 },
  [B.TORCH]: { name: 'Tocha', t: cube(T.TORCH), light: 14, hard: 0, shape: 'torch', sound: 'wood' },
  [B.DOOR]: { name: 'Porta', t: cube(T.DOOR_BOTTOM), hard: 3, tool: 'axe', sound: 'wood', shape: 'door', use: 'door', facing: 1, drop: 'door' },
  [B.LADDER]: { name: 'Escada de mão', t: cube(T.LADDER), hard: 0.4, tool: 'axe', sound: 'wood', shape: 'ladder', climb: 1, facing: 1, fuel: 5 },
  [B.GLASS_PANE]: { name: 'Janela', t: cube(T.GLASS), hard: 0.3, drop: null, sound: 'glass', shape: 'pane', glass: 1 },
  [B.FENCE]: { name: 'Cerca', t: cube(T.PLANKS), hard: 2, tool: 'axe', sound: 'wood', shape: 'fence', fuel: 15 },
  [B.FENCE_GATE]: { name: 'Portão', t: cube(T.PLANKS), hard: 2, tool: 'axe', sound: 'wood', shape: 'gate', use: 'gate', facing: 1, fuel: 15 },
  [B.SLAB_COBBLE]: { name: 'Laje de pedra', t: cube(T.COBBLE), hard: 2, tool: 'pickaxe', tier: 1, sound: 'stone', shape: 'slab' },
  [B.SLAB_PLANKS]: { name: 'Laje de madeira', t: cube(T.PLANKS), hard: 2, tool: 'axe', sound: 'wood', shape: 'slab', fuel: 7 },
  [B.STAIRS_COBBLE]: { name: 'Escada de pedra', t: cube(T.COBBLE), hard: 2, tool: 'pickaxe', tier: 1, sound: 'stone', shape: 'stairs', facing: 1 },
  [B.STAIRS_PLANKS]: { name: 'Escada de madeira', t: cube(T.PLANKS), hard: 2, tool: 'axe', sound: 'wood', shape: 'stairs', facing: 1, fuel: 15 },
  [B.BED]: { name: 'Cama', t: [T.BED_TOP, T.PLANKS, T.PLANKS], hard: 0.4, sound: 'wood', shape: 'bed', use: 'bed', facing: 1, drop: 'bed' },
  [B.TABLE]: { name: 'Mesa', t: cube(T.PLANKS), hard: 2, tool: 'axe', sound: 'wood', shape: 'table', fuel: 15 },
  [B.CHAIR]: { name: 'Cadeira', t: cube(T.PLANKS), hard: 2, tool: 'axe', sound: 'wood', shape: 'chair', facing: 1, use: 'sit', fuel: 15 },
  [B.BOOKSHELF]: { name: 'Estante', t: [T.PLANKS, T.BOOKSHELF, T.PLANKS], hard: 1.5, tool: 'axe', sound: 'wood', fuel: 15 },
  [B.WOOL_WHITE]: { name: 'Lã branca', t: cube(T.WOOL_WHITE), hard: 0.8, sound: 'cloth' },
  [B.WOOL_BLACK]: { name: 'Lã preta', t: cube(T.WOOL_BLACK), hard: 0.8, sound: 'cloth' },
  [B.WOOL_BROWN]: { name: 'Lã marrom', t: cube(T.WOOL_BROWN), hard: 0.8, sound: 'cloth' },
  [B.WOOL_GRAY]: { name: 'Lã cinza', t: cube(T.WOOL_GRAY), hard: 0.8, sound: 'cloth' },
  [B.COLOR_RED]: { name: 'Bloco vermelho', t: cube(T.COLOR_RED), hard: 1.5, tool: 'pickaxe', sound: 'stone' },
  [B.COLOR_BLUE]: { name: 'Bloco azul', t: cube(T.COLOR_BLUE), hard: 1.5, tool: 'pickaxe', sound: 'stone' },
  [B.COLOR_YELLOW]: { name: 'Bloco amarelo', t: cube(T.COLOR_YELLOW), hard: 1.5, tool: 'pickaxe', sound: 'stone' },
  [B.COLOR_GREEN]: { name: 'Bloco verde', t: cube(T.COLOR_GREEN), hard: 1.5, tool: 'pickaxe', sound: 'stone' },
  [B.LEVER]: { name: 'Alavanca', t: cube(T.COBBLE), hard: 0.5, sound: 'wood', shape: 'lever', use: 'lever', facing: 1, power: 'lever' },
  [B.BUTTON]: { name: 'Botão', t: cube(T.STONE), hard: 0.5, sound: 'stone', shape: 'button', use: 'button', power: 'button' },
  [B.PLATE]: { name: 'Placa de pressão', t: cube(T.STONE), hard: 0.5, tool: 'pickaxe', sound: 'stone', shape: 'plate', power: 'plate' },
  [B.WIRE]: { name: 'Fio de energia', t: cube(T.WIRE), hard: 0, sound: 'stone', shape: 'wire', drop: 'wire' },
  [B.PLAMP]: { name: 'Lâmpada elétrica', t: cube(T.PLAMP_OFF), hard: 0.3, sound: 'glass', consumer: 1 },
  [B.PLAMP_ON]: { name: 'Lâmpada elétrica (acesa)', t: cube(T.PLAMP_ON), light: 15, hard: 0.3, sound: 'glass', consumer: 1, drop: 'plamp', hidden: 1 },
  [B.PISTON]: { name: 'Pistão', t: [T.PISTON_TOP, T.PISTON_SIDE, T.PISTON_BOTTOM], hard: 1.5, tool: 'pickaxe', sound: 'stone', shape: 'piston', consumer: 1, facing6: 1 },
  [B.PISTON_HEAD]: { name: 'Cabeça de pistão', t: cube(T.PISTON_TOP), hard: 1.5, sound: 'stone', shape: 'pistonhead', drop: null, hidden: 1 },
  [B.RAIL]: { name: 'Trilho', t: cube(T.RAIL), hard: 0.7, tool: 'pickaxe', sound: 'stone', shape: 'rail' },
  [B.ELEVATOR]: { name: 'Elevador', t: cube(T.ELEVATOR), hard: 2, tool: 'pickaxe', sound: 'stone' },
  [B.IRON_BLOCK]: { name: 'Bloco de ferro', t: cube(T.IRON_BLOCK), hard: 5, tool: 'pickaxe', tier: 2, sound: 'metal' },
  [B.GOLD_BLOCK]: { name: 'Bloco de ouro', t: cube(T.GOLD_BLOCK), hard: 3, tool: 'pickaxe', tier: 3, sound: 'metal' },
  [B.DIAMOND_BLOCK]: { name: 'Bloco de diamante', t: cube(T.DIAMOND_BLOCK), hard: 5, tool: 'pickaxe', tier: 3, sound: 'metal' },
  [B.COPPER_BLOCK]: { name: 'Bloco de cobre', t: cube(T.COPPER_BLOCK), hard: 3, tool: 'pickaxe', tier: 2, sound: 'metal' },
  [B.FARMLAND]: { name: 'Terra arada', t: [T.FARMLAND, T.DIRT, T.DIRT], hard: 0.6, tool: 'shovel', sound: 'gravel', drop: 'dirt', shape: 'farmland' },
  [B.WHEAT]: { name: 'Trigo', t: cube(T.WHEAT3), hard: 0, shape: 'crop', drop: 'wheat_drop', sound: 'grass' },
  [B.PATH]: { name: 'Caminho', t: [T.PATH_TOP, T.GRASS_SIDE, T.DIRT], hard: 0.6, tool: 'shovel', sound: 'gravel', drop: 'dirt', shape: 'farmland' },
  [B.MOSSY_COBBLE]: { name: 'Pedregulho musgoso', t: cube(T.MOSSY_COBBLE), hard: 2, tool: 'pickaxe', tier: 1, sound: 'stone' },
  [B.STONE_BRICKS]: { name: 'Tijolos de pedra', t: cube(T.STONE_BRICKS), hard: 1.5, tool: 'pickaxe', tier: 1, sound: 'stone' },
  [B.CRYSTAL_BLOCK]: { name: 'Bloco de cristal', t: cube(T.CRYSTAL_BLOCK), light: 12, hard: 1.5, tool: 'pickaxe', tier: 1, sound: 'glass' },
  [B.SAPLING]: { name: 'Muda de árvore', t: cube(T.SAPLING), hard: 0, shape: 'cross', sound: 'grass' },
  [B.FIRE]: { name: 'Fogo', t: cube(T.FIRE), hard: 0, shape: 'cross', light: 15, drop: null, sound: 'grass', hidden: 1, fire: 1 },
  [B.TNT]: { name: 'TNT', t: [T.TNT_TOP, T.TNT_SIDE, T.TNT_TOP], hard: 0, sound: 'grass', tnt: 1, flammable: 1 },
  [B.DRIPSTONE]: { name: 'Estalactite', t: cube(T.DRIPSTONE), hard: 1.2, tool: 'pickaxe', shape: 'cross', sound: 'stone' },
  [B.VINE]: { name: 'Cipó', t: cube(T.VINE), hard: 0.2, shape: 'cross', climb: 1, tint: 'leaves', sound: 'grass', flammable: 1 },
};

export const BLOCKS = [];
for (let i = 0; i < BLOCK_COUNT; i++) BLOCKS[i] = DEF[i] ? Object.assign({ id: i }, DEF[i]) : null;
for (const k in B) if (BLOCKS[B[k]]) BLOCKS[B[k]].key = k.toLowerCase();

// tabelas rápidas (indexadas por id)
export const TRANSP = new Uint8Array(256), OCC = new Uint8Array(256), SOLID = new Uint8Array(256), CUTOUT = new Uint8Array(256);
export const LOPQ = new Uint8Array(256), LEXT = new Uint8Array(256), EMIT = new Uint8Array(256), ROT = new Uint8Array(256);
export const SHAPED = new Uint8Array(256), LIQUID = new Uint8Array(256), FULL = new Uint8Array(256);
for (let i = 0; i < BLOCK_COUNT; i++) {
  const d = BLOCKS[i];
  if (i === 0) { TRANSP[0] = 1; continue; }
  if (!d) continue;
  const shaped = !!d.shape;
  SHAPED[i] = shaped ? 1 : 0;
  LIQUID[i] = d.liquid || 0;
  const passable = d.liquid || ['cross', 'torch', 'wire', 'rail', 'crop', 'button', 'plate'].includes(d.shape);
  TRANSP[i] = (d.liquid === 1 || d.leaves || d.glass || shaped) ? 1 : 0;
  FULL[i] = (!shaped && !d.liquid) ? 1 : 0;
  OCC[i] = (FULL[i] && !d.glass) ? 1 : 0;
  SOLID[i] = passable ? 0 : 1;
  CUTOUT[i] = (d.leaves || d.glass) ? 1 : 0;
  LOPQ[i] = TRANSP[i] || d.liquid ? 0 : 1;
  LEXT[i] = (d.leaves || d.liquid === 1) ? 1 : 0;
  EMIT[i] = d.light || 0;
  ROT[i] = [B.GRASS, B.DIRT, B.STONE, B.SAND, B.SNOW, B.GRAVEL, B.BEDROCK, B.LEAVES, B.PINE_LEAVES, B.ACACIA_LEAVES, B.MUD,
    B.COAL_ORE, B.IRON_ORE, B.COPPER_ORE, B.GOLD_ORE, B.DIAMOND_ORE, B.CRYSTAL_ORE, B.COBBLE, B.MOSSY_COBBLE].includes(i) ? 1 : 0;
}
// lava: opaca para luz do céu, mas emite luz
LOPQ[B.LAVA] = 0; TRANSP[B.LAVA] = 1;

// ---------------- formas (modelos de caixas em 1/16) ----------------
// caixa: [x0, y0, z0, x1, y1, z1, tile?] ; tile opcional (índice) substitui as texturas do bloco
function rot(box, f) {
  let [x0, y0, z0, x1, y1, z1] = box;
  for (let i = 0; i < f; i++) { const nx0 = 16 - z1, nx1 = 16 - z0, nz0 = x0, nz1 = x1; x0 = nx0; x1 = nx1; z0 = nz0; z1 = nz1; }
  const out = [x0, y0, z0, x1, y1, z1];
  if (box.length > 6) out.push(box[6]);
  return out;
}
const R = (boxes, f) => boxes.map((b) => rot(b, f));

const connects = (id) => SOLID[id] && (FULL[id] || id === B.FENCE || id === B.FENCE_GATE || id === B.GLASS_PANE);

// nb(dx, dy, dz) → [id, meta]
export function shapeBoxes(id, meta, nb) {
  const d = BLOCKS[id];
  switch (d.shape) {
    case 'slab': return meta & 1 ? [[0, 8, 0, 16, 16, 16]] : [[0, 0, 0, 16, 8, 16]];
    case 'stairs': {
      const f = meta & 3, up = meta & 4;
      const base = up ? [0, 8, 0, 16, 16, 16] : [0, 0, 0, 16, 8, 16];
      const step = up ? [0, 0, 8, 16, 8, 16] : [0, 8, 8, 16, 16, 16];
      return [base, rot(step, f)];
    }
    case 'cactus': return [[1, 0, 1, 15, 16, 15]];
    case 'chest': return [R([[1, 0, 1, 15, 14, 15]], meta & 3)[0]];
    case 'torch': {
      const o = meta & 7;
      if (!o) return [[7, 0, 7, 9, 10, 9, T.TORCH]];
      const [fx, fz] = FACING[(o - 1) & 3];
      return [[7 - fx * 5, 3, 7 - fz * 5, 9 - fx * 5, 13, 9 - fz * 5, T.TORCH]];
    }
    case 'ladder': return [R([[0, 0, 0, 16, 16, 1]], meta & 3)[0]];
    case 'door': {
      const f = meta & 3, open = meta & 4, top = meta & 8;
      const tile = top ? T.DOOR_TOP : T.DOOR_BOTTOM;
      const r = open ? (f + 1) & 3 : f;
      return [rot([0, 0, 0, 16, 16, 3, tile], r)];
    }
    case 'pane': case 'fence': {
      const pane = d.shape === 'pane';
      const c = [nb(0, 0, 1), nb(-1, 0, 0), nb(0, 0, -1), nb(1, 0, 0)].map((n) => connects(n[0]));
      const out = [];
      if (pane) {
        out.push([7, 0, 7, 9, 16, 9]);
        if (c[0]) out.push([7, 0, 9, 9, 16, 16]);
        if (c[2]) out.push([7, 0, 0, 9, 16, 7]);
        if (c[1]) out.push([0, 0, 7, 7, 16, 9]);
        if (c[3]) out.push([9, 0, 7, 16, 16, 9]);
        return out;
      }
      out.push([6, 0, 6, 10, 16, 10]);
      for (let i = 0; i < 4; i++) if (c[i]) for (const y of [6, 12]) out.push(rot([7, y, 10, 9, y + 3, 16], i));
      return out;
    }
    case 'gate': {
      const f = meta & 3, open = meta & 4;
      const out = [rot([0, 5, 7, 2, 16, 9], f), rot([14, 5, 7, 16, 16, 9], f)];
      if (!open) for (const y of [6, 12]) out.push(rot([2, y, 7, 14, y + 3, 9], f));
      else for (const y of [6, 12]) { out.push(rot([0, y, 9, 2, y + 3, 15], f)); out.push(rot([14, y, 9, 16, y + 3, 15], f)); }
      return out;
    }
    case 'bed': {
      const f = meta & 3, head = meta & 4;
      const out = [[0, 3, 0, 16, 9, 16, T.BED_TOP]];
      for (const [x, z] of [[0, 0], [13, 0], [0, 13], [13, 13]]) out.push([x, 0, z, x + 3, 3, z + 3, T.PLANKS]);
      if (head) out.push(rot([2, 9, 9, 14, 11, 15, T.BED_PILLOW], f));
      return out;
    }
    case 'table': return [[0, 13, 0, 16, 16, 16], [1, 0, 1, 3, 13, 3], [13, 0, 1, 15, 13, 3], [1, 0, 13, 3, 13, 15], [13, 0, 13, 15, 13, 15]];
    case 'chair': return R([[3, 7, 3, 13, 9, 13], [3, 0, 3, 5, 7, 5], [11, 0, 3, 13, 7, 5], [3, 0, 11, 5, 7, 13], [11, 0, 11, 13, 7, 13], [3, 9, 3, 13, 20, 5]], meta & 3);
    case 'lever': {
      const on = meta & 8;
      return [[5, 0, 4, 11, 3, 12, T.COBBLE], on ? [7, 3, 9, 9, 11, 11, T.LOG_SIDE] : [7, 3, 5, 9, 11, 7, T.LOG_SIDE]];
    }
    case 'button': { const p = meta & 8; return [[5, 0, 6, 11, p ? 1 : 2, 10]]; }
    case 'plate': return [[1, 0, 1, 15, (meta & 8) ? 0.5 : 1, 15]];
    case 'wire': return [[0, 0, 0, 16, 0.25, 16, T.WIRE]];
    case 'rail': return [[0, 0, 0, 16, 1, 16, (meta & 7) >= 2 ? T.RAIL_CURVE : T.RAIL]];
    case 'piston': {
      const ext = meta & 8;
      if (!ext) return null; // cubo normal com faces orientadas
      return [pistonRot([0, 0, 0, 16, 16, 12], meta & 7)];
    }
    case 'pistonhead': {
      const f = meta & 7;
      return [pistonRot([0, 0, 12, 16, 16, 16, T.PISTON_TOP], f), pistonRot([6, 6, 0, 10, 10, 12, T.PISTON_SIDE], f)];
    }
    case 'farmland': return [[0, 0, 0, 16, 15, 16]];
    case 'crop': return null;
    case 'cross': return null;
  }
  return null;
}
// pistão: facing 0..3 horizontal, 4 = cima, 5 = baixo. Caixa definida apontando para +z.
function pistonRot(b, f) {
  if (f < 4) return rot(b, f);
  const [x0, y0, z0, x1, y1, z1] = b;
  const out = f === 4 ? [x0, z0, y0, x1, z1, y1] : [x0, 16 - z1, y0, x1, 16 - z0, y1];
  if (b.length > 6) out.push(b[6]);
  return out;
}
export const PISTON_DIR = [[0, 0, 1], [-1, 0, 0], [0, 0, -1], [1, 0, 0], [0, 1, 0], [0, -1, 0]];

// faces de cubos orientados (fornalha, mesa, pistão): ordem +x, -x, +y, -y, +z, -z
export function cubeFaces(id, meta) {
  const d = BLOCKS[id];
  const top = d.t[0], side = d.t[1], bot = d.t[2];
  const f = [side, side, top, bot, side, side];
  if (d.front != null) {
    const dir = FACING[meta & 3];
    const idx = dir[0] === 1 ? 0 : dir[0] === -1 ? 1 : dir[1] === 1 ? 4 : 5;
    f[idx] = d.front;
    if (id === B.CRAFTING_TABLE) { f[idx] = d.front; }
  }
  if (d.facing6) {
    const fd = meta & 7;
    const map = [4, 1, 5, 0, 2, 3][fd] ?? 4;
    const opp = [5, 0, 4, 1, 3, 2][fd] ?? 5;
    for (let i = 0; i < 6; i++) f[i] = side;
    f[map] = top; f[opp] = bot;
  }
  return f;
}

// caixas de colisão (em blocos, 0..1; cercas até 1.5). null = sem colisão; undefined = cubo inteiro.
export function collisionBoxes(id, meta, nb) {
  if (!SOLID[id]) return null;
  const d = BLOCKS[id];
  if (!d.shape || d.shape === 'piston' && !(meta & 8)) return undefined;
  if (d.shape === 'fence' || d.shape === 'gate') {
    if (d.shape === 'gate' && (meta & 4)) return null;
    const bx = shapeBoxes(id, meta, nb).map((b) => [b[0] / 16, 0, b[2] / 16, b[3] / 16, 1.5, b[5] / 16]);
    return bx;
  }
  if (d.shape === 'chair') return [[3 / 16, 0, 3 / 16, 13 / 16, 9 / 16, 13 / 16]];
  if (d.shape === 'bed') return [[0, 0, 0, 1, 9 / 16, 1]];
  if (d.shape === 'ladder') return [shapeBoxes(id, meta, nb)[0].slice(0, 6).map((v) => v / 16)];
  const boxes = shapeBoxes(id, meta, nb);
  if (!boxes) return undefined;
  return boxes.map((b) => [b[0] / 16, b[1] / 16, b[2] / 16, b[3] / 16, b[4] / 16, b[5] / 16]);
}

export function isClimbable(id) { return BLOCKS[id] && BLOCKS[id].climb; }
