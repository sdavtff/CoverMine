// Inventário, receitas de fabricação (grade 2×2 e 3×3), fundição e combustíveis.
import { ITEMS, maxStack, TIERS, ARMOR_MATS, ARMOR_SLOTS } from './items.js';

// ---------------- inventário ----------------
// slot = { k: chave do item, n: quantidade, d: dano acumulado (ferramentas) } ou null
export class Inventory {
  constructor(size) { this.slots = new Array(size).fill(null); }
  get size() { return this.slots.length; }
  get(i) { return this.slots[i]; }
  set(i, s) { this.slots[i] = s && s.n > 0 ? s : null; this.changed = true; }
  // adiciona itens; retorna a quantidade que não coube
  add(k, n = 1, d = 0, order) {
    if (!ITEMS[k]) return n;
    const max = maxStack(k);
    const idx = order || [...this.slots.keys()];
    if (max > 1) for (const i of idx) {
      const s = this.slots[i];
      if (s && s.k === k && s.n < max) { const put = Math.min(n, max - s.n); s.n += put; n -= put; if (!n) break; }
    }
    for (const i of idx) {
      if (!n) break;
      if (!this.slots[i]) { const put = Math.min(n, max); this.slots[i] = { k, n: put, d }; n -= put; }
    }
    this.changed = true;
    return n;
  }
  count(k) { let c = 0; for (const s of this.slots) if (s && s.k === k) c += s.n; return c; }
  remove(k, n) {
    for (let i = this.slots.length - 1; i >= 0 && n > 0; i--) {
      const s = this.slots[i];
      if (s && s.k === k) { const t = Math.min(n, s.n); s.n -= t; n -= t; if (!s.n) this.slots[i] = null; }
    }
    this.changed = true;
    return n === 0;
  }
  clear() { this.slots.fill(null); this.changed = true; }
  toJSON() { return this.slots.map((s) => s ? [s.k, s.n, s.d || 0] : null); }
  static from(arr, size) {
    const inv = new Inventory(size);
    if (Array.isArray(arr)) arr.forEach((s, i) => { if (s && i < size && ITEMS[s[0]]) inv.slots[i] = { k: s[0], n: s[1], d: s[2] || 0 }; });
    return inv;
  }
}

// ---------------- receitas ----------------
// tags: "#planks" aceita qualquer tábua, "#log" qualquer tronco, "#wool" qualquer lã
const TAGS = {
  '#planks': ['planks', 'spruce_planks', 'birch_planks'],
  '#log': ['log', 'birch_log', 'spruce_log', 'acacia_log'],
  '#wool': ['wool_white', 'wool_black', 'wool_brown', 'wool_gray'],
  '#stone': ['cobble', 'stone', 'mossy_cobble'],
};
const match = (want, have) => want === have || (TAGS[want] && TAGS[want].includes(have));

export const RECIPES = [];
// pattern: linhas; key: letra → item/tag; result: [item, quantidade]
function shaped(pattern, key, result, opts = {}) { RECIPES.push({ type: 'shaped', pattern, key, result, ...opts }); }
function shapeless(ingredients, result, opts = {}) { RECIPES.push({ type: 'shapeless', ingredients, result, ...opts }); }

// madeira
shapeless(['log'], ['planks', 4]);
shapeless(['acacia_log'], ['planks', 4]);
shapeless(['birch_log'], ['birch_planks', 4]);
shapeless(['spruce_log'], ['spruce_planks', 4]);
shaped(['P', 'P'], { P: '#planks' }, ['stick', 4]);
shaped(['PP', 'PP'], { P: '#planks' }, ['crafting_table', 1]);
shaped(['C', 'S'], { C: 'coal', S: 'stick' }, ['torch', 4]);
shaped(['PPP', 'P P', 'PPP'], { P: '#planks' }, ['chest', 1], { big: true });
shaped(['CCC', 'C C', 'CCC'], { C: 'cobble' }, ['furnace', 1], { big: true });
shaped(['PSP', 'PSP'], { P: '#planks', S: 'stick' }, ['fence', 3], { big: true });
shaped(['SPS', 'SPS'], { P: '#planks', S: 'stick' }, ['fence_gate', 1], { big: true });
shaped(['PP', 'PP', 'PP'], { P: '#planks' }, ['door', 3], { big: true });
shaped(['S S', 'SSS', 'S S'], { S: 'stick' }, ['ladder', 3], { big: true });
shaped(['PPP'], { P: '#planks' }, ['slab_planks', 6], { big: true });
shaped(['CCC'], { C: 'cobble' }, ['slab_cobble', 6], { big: true });
shaped(['P  ', 'PP ', 'PPP'], { P: '#planks' }, ['stairs_planks', 4], { big: true });
shaped(['C  ', 'CC ', 'CCC'], { C: 'cobble' }, ['stairs_cobble', 4], { big: true });
shaped(['WWW', 'PPP'], { W: '#wool', P: '#planks' }, ['bed', 1], { big: true });
shaped(['PPP', 'S S', 'S S'], { P: '#planks', S: 'stick' }, ['table', 1], { big: true });
shaped(['S  ', 'PPP', 'S S'], { P: '#planks', S: 'stick' }, ['chair', 2], { big: true });
shaped(['PPP', 'LLL', 'PPP'], { P: '#planks', L: 'leather' }, ['bookshelf', 1], { big: true });
shaped(['P P', 'PPP'], { P: '#planks' }, ['boat', 1], { big: true });
shaped(['S', 'S', 'S'], { S: 'sapling' }, ['stick', 2]);
// pedra e construção
shaped(['SS', 'SS'], { S: 'stone' }, ['stone_bricks', 4]);
shaped(['SS', 'SS'], { S: 'sand' }, ['sandstone', 1]);
shaped(['BB', 'BB'], { B: 'brick_item' }, ['brick', 1]);
shapeless(['cobble', 'leaves'], ['mossy_cobble', 1]);
shaped(['GGG', 'GGG'], { G: 'glass' }, ['glass_pane', 16], { big: true });
shapeless(['cobble', 'cobble', 'cobble', 'cobble', 'red_dye'], ['color_red', 4]);
shapeless(['cobble', 'cobble', 'cobble', 'cobble', 'blue_dye'], ['color_blue', 4]);
shapeless(['cobble', 'cobble', 'cobble', 'cobble', 'yellow_dye'], ['color_yellow', 4]);
shapeless(['cobble', 'cobble', 'cobble', 'cobble', 'green_dye'], ['color_green', 4]);
shaped(['SS', 'SS'], { S: 'string' }, ['wool_white', 1]);
shapeless(['wool_white', 'coal'], ['wool_black', 1]);
shapeless(['wool_white', 'dirt'], ['wool_brown', 1]);
shapeless(['wool_white', 'cobble'], ['wool_gray', 1]);
shapeless(['#wool'], ['string', 4]);
shapeless(['apple'], ['red_dye', 2]);
shapeless(['wheat'], ['yellow_dye', 1]);
shapeless(['crystal'], ['blue_dye', 2]);
shapeless(['bone'], ['bone_meal', 3]);
// luz
shaped(['GGG', 'GCG', 'GGG'], { G: 'glass', C: 'crystal' }, ['lamp', 4], { big: true });
shaped(['CCC', 'CCC', 'CCC'], { C: 'crystal' }, ['crystal_block', 1], { big: true });
shapeless(['crystal_block'], ['crystal', 9]);
// metais
for (const [ingot, block] of [['iron_ingot', 'iron_block'], ['gold_ingot', 'gold_block'], ['copper_ingot', 'copper_block'], ['diamond', 'diamond_block']]) {
  shaped(['III', 'III', 'III'], { I: ingot }, [block, 1], { big: true });
  shapeless([block], [ingot, 9]);
}
shapeless(['gold_ingot'], ['coin', 4]);
shaped(['I I', ' I '], { I: 'iron_ingot' }, ['bucket', 1], { big: true });
shaped(['I I', 'III'], { I: 'iron_ingot' }, ['minecart', 1], { big: true });
shaped([' I', 'I '], { I: 'iron_ingot' }, ['shears', 1]);
shaped(['LLL', 'L L', 'I I'], { L: 'leather', I: 'iron_ingot' }, ['saddle', 1], { big: true });
// mecanismos
shaped(['S', 'C'], { S: 'stick', C: 'cobble' }, ['lever', 1]);
shapeless(['stone'], ['button', 1]);
shaped(['SS'], { S: 'stone' }, ['plate', 1]);
shapeless(['copper_ingot'], ['wire', 6]);
shaped([' W ', 'WLW', ' W '], { W: 'wire', L: 'lamp' }, ['plamp', 1], { big: true });
shaped(['PPP', 'CIC', 'CWC'], { P: '#planks', C: 'cobble', I: 'iron_ingot', W: 'wire' }, ['piston', 1], { big: true });
shaped(['I I', 'ISI', 'I I'], { I: 'iron_ingot', S: 'stick' }, ['rail', 16], { big: true });
shaped(['III', 'ICI', 'III'], { I: 'iron_ingot', C: 'crystal' }, ['elevator', 2], { big: true });
// comida
shaped(['WWW'], { W: 'wheat' }, ['bread', 1], { big: true });
// armas e ferramentas
shaped([' SL', 'S L', ' SL'], { S: 'stick', L: 'string' }, ['bow', 1], { big: true });
shapeless(['stick', 'feather', 'cobble'], ['arrow', 4]);
for (const t in TIERS) {
  const m = t === 'wood' ? '#planks' : t === 'stone' ? '#stone' : TIERS[t].mat;
  shaped(['MMM', ' S ', ' S '], { M: m, S: 'stick' }, [t + '_pickaxe', 1], { big: true });
  shaped(['MM', 'MS', ' S'], { M: m, S: 'stick' }, [t + '_axe', 1], { big: true });
  shaped(['M', 'S', 'S'], { M: m, S: 'stick' }, [t + '_shovel', 1], { big: true });
  shaped(['M', 'M', 'S'], { M: m, S: 'stick' }, [t + '_sword', 1], { big: true });
  shaped(['MM', ' S', ' S'], { M: m, S: 'stick' }, [t + '_hoe', 1], { big: true });
}
for (const m in ARMOR_MATS) {
  const M = ARMOR_MATS[m].mat;
  shaped(['MMM', 'M M'], { M }, [m + '_helmet', 1], { big: true });
  shaped(['M M', 'MMM', 'MMM'], { M }, [m + '_chest', 1], { big: true });
  shaped(['MMM', 'M M', 'M M'], { M }, [m + '_legs', 1], { big: true });
  shaped(['M M', 'M M'], { M }, [m + '_boots', 1], { big: true });
}

// grid: array de chaves (ou null) com largura w (2 ou 3)
export function findRecipe(grid, w) {
  const h = grid.length / w;
  // recorta para o retângulo mínimo
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (grid[y * w + x]) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  if (x1 < 0) return null;
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
  const cell = (x, y) => grid[(y + y0) * w + x + x0];
  const items = grid.filter(Boolean);
  for (const r of RECIPES) {
    if (r.disabled) continue;
    if (r.big && w < 3) continue;
    if (r.type === 'shapeless') {
      if (r.ingredients.length !== items.length) continue;
      const rest = items.slice();
      let ok = true;
      for (const ing of r.ingredients) {
        const j = rest.findIndex((k) => match(ing, k));
        if (j < 0) { ok = false; break; }
        rest.splice(j, 1);
      }
      if (ok) return r;
      continue;
    }
    const pw = Math.max(...r.pattern.map((l) => l.length)), ph = r.pattern.length;
    if (pw !== cw || ph !== ch) continue;
    for (const mirror of [false, true]) {
      let ok = true;
      for (let y = 0; y < ph && ok; y++) for (let x = 0; x < pw; x++) {
        const ch_ = (r.pattern[y][mirror ? pw - 1 - x : x] || ' ');
        const have = cell(x, y);
        if (ch_ === ' ') { if (have) { ok = false; break; } }
        else if (!have || !match(r.key[ch_], have)) { ok = false; break; }
      }
      if (ok) return r;
    }
  }
  return null;
}

// receitas que o jogador consegue fazer com o inventário (livro de receitas)
export function recipeIngredients(r) {
  const need = {};
  if (r.type === 'shapeless') for (const i of r.ingredients) need[i] = (need[i] || 0) + 1;
  else for (const row of r.pattern) for (const c of row) if (c !== ' ') { const k = r.key[c]; need[k] = (need[k] || 0) + 1; }
  return need;
}
export function countWithTag(inv, want) {
  if (!TAGS[want]) return inv.count(want);
  return TAGS[want].reduce((a, k) => a + inv.count(k), 0);
}
export function removeWithTag(inv, want, n) {
  const keys = TAGS[want] || [want];
  for (const k of keys) { const c = inv.count(k); const t = Math.min(c, n); if (t) { inv.remove(k, t); n -= t; } if (!n) break; }
  return n === 0;
}
export function canCraft(inv, r, big) {
  if (r.disabled || (r.big && !big)) return false;
  const need = recipeIngredients(r);
  for (const k in need) if (countWithTag(inv, k) < need[k]) return false;
  return true;
}
export function craftFromInventory(inv, r) {
  const need = recipeIngredients(r);
  for (const k in need) removeWithTag(inv, k, need[k]);
  return inv.add(r.result[0], r.result[1]);
}

// ---------------- fornalha ----------------
export function smeltResult(k) {
  const it = ITEMS[k];
  if (!it) return null;
  if (it.smelt) return it.smelt;
  const SM = { sand: 'glass', cobble: 'stone', log: 'coal', birch_log: 'coal', spruce_log: 'coal', acacia_log: 'coal', mud: 'brick_item', cactus: 'green_dye', iron_ore: 'iron_ingot', gold_ore: 'gold_ingot', copper_ore: 'copper_ingot' };
  return SM[k] || null;
}
export function fuelValue(k) { const it = ITEMS[k]; return it && it.fuel ? it.fuel : 0; }
export const SMELT_TIME = 6;
