// Definições das criaturas: modelos de caixas, texturas procedurais, atributos e drops.
import { HUMANOID, net } from './models.js';
import { BIOME } from './worldgen.js';

// empacota as redes das partes numa textura e preenche uv
function pack(parts, tw) {
  let x = 0, y = 0, rowH = 0;
  for (const p of parts) {
    const [w, h, d] = p.size;
    const nw = 2 * (w + d), nh = d + h;
    if (x + nw > tw) { x = 0; y += rowH; rowH = 0; }
    p.uv = [x, y];
    x += nw; rowH = Math.max(rowH, nh);
  }
  return Math.max(16, Math.pow(2, Math.ceil(Math.log2(y + rowH))));
}
function quadruped(o) {
  const { bw, bh, bd, legH, lw, hw, hh, hd } = o;
  const parts = [
    { name: 'body', size: [bw, bh, bd], pivot: [0, legH + bh / 2, 0], from: [-bw / 2, -bh / 2, -bd / 2] },
    { name: 'head', size: [hw, hh, hd], pivot: [0, legH + bh * (o.headUp || 0.8), bd / 2 - 1], from: [-hw / 2, -hh / 2, 0], anim: 'head' },
  ];
  const lx = bw / 2 - lw / 2, lz = bd / 2 - lw / 2;
  for (const [n, sx, sz, a] of [['legFL', 1, 1, 'legFL'], ['legFR', -1, 1, 'legFR'], ['legBL', 1, -1, 'legBL'], ['legBR', -1, -1, 'legBR']]) parts.push({ name: n, size: [lw, legH, lw], pivot: [sx * lx, legH, sz * lz], from: [-lw / 2, -legH, -lw / 2], anim: a });
  if (o.extra) parts.push(...o.extra);
  const th = pack(parts, 64);
  return { tw: 64, th, parts };
}
function drawParts(def, paint) {
  const cv = document.createElement('canvas'); cv.width = def.tw; cv.height = def.th;
  const ctx = cv.getContext('2d');
  for (const p of def.parts) {
    const [w, h, d] = p.size;
    const n = net(p.uv[0], p.uv[1], w, h, d);
    paint(ctx, p, n, w, h, d);
  }
  return cv;
}
const dot = (ctx, x, y, c, w = 1, h = 1) => { ctx.fillStyle = `rgb(${c})`; ctx.fillRect(x, y, w, h); };

// ---------------- definições ----------------
const cowDef = quadruped({ bw: 12, bh: 10, bd: 18, legH: 12, lw: 4, hw: 8, hh: 8, hd: 6, extra: [] });
const pigDef = quadruped({ bw: 10, bh: 8, bd: 16, legH: 6, lw: 4, hw: 8, hh: 8, hd: 8, headUp: 0.6 });
const sheepDef = quadruped({ bw: 10, bh: 10, bd: 16, legH: 12, lw: 4, hw: 6, hh: 6, hd: 8 });
const horseDef = quadruped({ bw: 10, bh: 10, bd: 22, legH: 14, lw: 4, hw: 6, hh: 10, hd: 12, headUp: 1.4, extra: [{ name: 'tail', size: [2, 10, 2], pivot: [0, 26, -11], from: [-1, -10, -2], anim: 'tail' }] });
const rabbitDef = quadruped({ bw: 6, bh: 6, bd: 8, legH: 3, lw: 2, hw: 5, hh: 5, hd: 5, headUp: 1, extra: [
  { name: 'earL', size: [1, 5, 2], pivot: [1.5, 11, 3], from: [-0.5, 0, -1] }, { name: 'earR', size: [1, 5, 2], pivot: [-1.5, 11, 3], from: [-0.5, 0, -1] }] });
const chickenDef = (() => {
  const parts = [
    { name: 'body', size: [6, 6, 8], pivot: [0, 8, 0], from: [-3, -3, -4] },
    { name: 'head', size: [4, 6, 3], pivot: [0, 10, 4], from: [-2, 0, -1], anim: 'head' },
    { name: 'beak', size: [4, 2, 2], pivot: [0, 10, 4], from: [-2, 2, 2], anim: 'head' },
    { name: 'legL', size: [1, 5, 1], pivot: [1.5, 5, 0], from: [-0.5, -5, -0.5], anim: 'legL' },
    { name: 'legR', size: [1, 5, 1], pivot: [-1.5, 5, 0], from: [-0.5, -5, -0.5], anim: 'legR' },
    { name: 'wingL', size: [1, 4, 6], pivot: [3, 10, 0], from: [0, -4, -3], anim: 'wingL' },
    { name: 'wingR', size: [1, 4, 6], pivot: [-3, 10, 0], from: [-1, -4, -3], anim: 'wingR' },
  ];
  const th = pack(parts, 64);
  return { tw: 64, th, parts };
})();
const fishDef = (() => {
  const parts = [
    { name: 'body', size: [2, 4, 8], pivot: [0, 2, 0], from: [-1, -2, -4] },
    { name: 'tail', size: [0.5, 4, 3], pivot: [0, 2, -4], from: [-0.25, -2, -3], anim: 'tail' },
  ];
  const th = pack(parts, 32);
  return { tw: 32, th, parts };
})();
const humanoidDef = { tw: 64, th: 64, parts: HUMANOID.parts.map((p) => Object.assign({}, p)) };
const villagerDef = { tw: 64, th: 64, parts: [...HUMANOID.parts.map((p) => Object.assign({}, p)), { name: 'nose', size: [2, 4, 2], uv: [24, 0], pivot: [0, 24, 0], from: [-1, 0, 4], anim: 'head' }] };

// ---------------- texturas ----------------
function fillNet(ctx, r, col, seed) {
  const [x, y, w, h] = r;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const nn = Math.sin((x + i) * 12.9898 + (y + j) * 78.233 + seed) * 43758.5453;
    const v = (nn - Math.floor(nn) - 0.5) * 16;
    ctx.fillStyle = `rgb(${Math.max(0, Math.min(255, col[0] + v))},${Math.max(0, Math.min(255, col[1] + v))},${Math.max(0, Math.min(255, col[2] + v))})`;
    ctx.fillRect(x + i, y + j, 1, 1);
  }
}
function face(ctx, n, eyes, extra) {
  const [x, y, w, h] = n.front;
  dot(ctx, x + 1, y + Math.floor(h / 2) - 1, [20, 20, 20]); dot(ctx, x + w - 2, y + Math.floor(h / 2) - 1, [20, 20, 20]);
  if (eyes) { dot(ctx, x, y + Math.floor(h / 2) - 1, eyes); dot(ctx, x + w - 1, y + Math.floor(h / 2) - 1, eyes); }
  if (extra) extra(ctx, x, y, w, h);
}
function quadTexture(def, body, opts = {}) {
  return drawParts(def, (ctx, p, n) => {
    const col = p.name.startsWith('leg') ? (opts.leg || body) : p.name === 'head' ? (opts.head || body) : p.name === 'tail' ? (opts.tail || body) : p.name.startsWith('ear') ? (opts.head || body) : body;
    for (const k in n) fillNet(ctx, n[k], col, p.name.length);
    if (opts.spots && (p.name === 'body' || p.name === 'head')) for (const k in n) { const [x, y, w, h] = n[k]; for (let i = 0; i < w * h / 14; i++) { const sx = x + Math.floor(Math.abs(Math.sin(i * 12.9 + x * 3.1) * 999) % Math.max(1, w - 2)), sy = y + Math.floor(Math.abs(Math.cos(i * 78.2 + y * 1.7) * 999) % Math.max(1, h - 2)); dot(ctx, sx, sy, opts.spots, 3, 2); } }
    if (p.name.startsWith('leg') && opts.hoof) { for (const k of ['front', 'back', 'left', 'right']) { const [x, y, w, h] = n[k]; dot(ctx, x, y + h - 2, opts.hoof, w, 2); } }
    if (p.name === 'head') face(ctx, n, opts.eyes, opts.snout);
    if (p.name === 'head' && opts.mane) { const [x, y, w] = n.top; dot(ctx, x + Math.floor(w / 2) - 1, y, opts.mane, 2, n.top[3]); }
  });
}
function humanTexture(o) {
  return drawParts(o.def, (ctx, p, n) => {
    const nm = p.name;
    let col = o.skin;
    if (nm === 'body') col = o.shirt;
    if (nm.startsWith('leg')) col = o.pants;
    if (nm === 'nose') col = o.skin;
    for (const k in n) fillNet(ctx, n[k], col, nm.length * 3);
    if (nm.startsWith('arm') && o.sleeve) for (const k of ['front', 'back', 'left', 'right', 'top']) { const r = n[k]; fillNet(ctx, [r[0], r[1], r[2], k === 'top' ? r[3] : (o.robe ? 12 : 4)], o.sleeve, 5); }
    if (nm.startsWith('leg') && o.robe) for (const k of ['front', 'back', 'left', 'right']) fillNet(ctx, n[k], o.shirt, 7);
    if (nm === 'head') {
      fillNet(ctx, n.top, o.hair, 9);
      for (const k of ['back', 'left', 'right']) { const [x, y, w] = n[k]; fillNet(ctx, [x, y, w, 3], o.hair, 9); }
      const [x, y] = n.front;
      fillNet(ctx, [x, y, 8, 2], o.hair, 9);
      dot(ctx, x + 1, y + 4, [240, 240, 240], 2, 1); dot(ctx, x + 5, y + 4, [240, 240, 240], 2, 1);
      dot(ctx, x + 2, y + 4, o.eyes); dot(ctx, x + 5, y + 4, o.eyes);
      if (o.mouth) dot(ctx, x + 2, y + 6, o.mouth, 4, 1);
    }
    if (nm === 'body' && o.apron) { const [x, y, w, h] = n.front; fillNet(ctx, [x + 1, y + 3, w - 2, h - 3], o.apron, 11); }
    if (o.ribs && nm === 'body') { const [x, y, w, h] = n.front; for (let r = 2; r < h; r += 3) dot(ctx, x + 1, y + r, [70, 70, 70], w - 2, 1); }
  });
}

const SHEEP_WOOL = { white: [236, 236, 236], gray: [130, 130, 134], black: [40, 38, 42], brown: [110, 74, 48] };
const HORSE_COAT = { brown: [120, 78, 44], white: [220, 214, 200], black: [40, 34, 32] };
const PROFESSIONS = {
  farmer: { name: 'Fazendeiro', shirt: [140, 100, 50], apron: [190, 170, 120] },
  librarian: { name: 'Bibliotecário', shirt: [230, 230, 230], apron: [120, 40, 40] },
  smith: { name: 'Ferreiro', shirt: [70, 70, 76], apron: [30, 30, 32] },
  cleric: { name: 'Clérigo', shirt: [120, 60, 150], apron: [210, 180, 60] },
  merchant: { name: 'Mercador', shirt: [60, 130, 60], apron: [200, 170, 90] },
};
export const PROFESSION_LIST = Object.keys(PROFESSIONS);
export { PROFESSIONS };

// tipos de criatura
export const MOBS = {
  cow: { name: 'Vaca', hp: 10, speed: 1.2, hw: 0.45, hh: 1.4, def: cowDef, tex: () => quadTexture(cowDef, [70, 50, 36], { spots: [235, 235, 230], hoof: [40, 40, 40], snout: (c, x, y, w, h) => dot(c, x + 2, y + h - 3, [220, 170, 160], w - 4, 3) }), drops: [['beef', 1, 3], ['leather', 0, 2]], food: 'wheat', passive: true, biomes: [BIOME.PLAINS, BIOME.FOREST, BIOME.SAVANNA, BIOME.SWAMP], sound: 'moo' },
  pig: { name: 'Porco', hp: 10, speed: 1.2, hw: 0.45, hh: 0.9, def: pigDef, tex: () => quadTexture(pigDef, [236, 160, 160], { snout: (c, x, y, w, h) => { dot(c, x + 2, y + h - 4, [210, 120, 120], w - 4, 3); dot(c, x + 3, y + h - 3, [120, 60, 60]); dot(c, x + w - 4, y + h - 3, [120, 60, 60]); } }), drops: [['porkchop', 1, 3]], food: 'wheat', passive: true, biomes: [BIOME.PLAINS, BIOME.FOREST, BIOME.SWAMP, BIOME.DENSE_FOREST], sound: 'oink' },
  chicken: { name: 'Galinha', hp: 4, speed: 1.1, hw: 0.25, hh: 0.7, def: chickenDef, tex: () => drawParts(chickenDef, (ctx, p, n) => { const col = p.name === 'beak' ? [240, 170, 40] : p.name.startsWith('leg') ? [230, 160, 40] : [240, 240, 236]; for (const k in n) fillNet(ctx, n[k], col, 3); if (p.name === 'head') { face(ctx, n); const [x, y, w, h] = n.front; dot(ctx, x + 1, y + h - 2, [200, 30, 30], 2, 2); } }), drops: [['chicken', 1, 1], ['feather', 0, 2]], food: 'seeds', passive: true, biomes: [BIOME.PLAINS, BIOME.FOREST, BIOME.SAVANNA], sound: 'cluck', flap: true },
  rabbit: { name: 'Coelho', hp: 3, speed: 1.8, hw: 0.2, hh: 0.5, def: rabbitDef, tex: () => quadTexture(rabbitDef, [170, 136, 100], { head: [180, 146, 110] }), drops: [['rabbit', 1, 1], ['leather', 0, 1]], food: 'wheat', passive: true, biomes: [BIOME.DESERT, BIOME.SNOWY, BIOME.PLAINS], hop: true },
  horse: { name: 'Cavalo', hp: 20, speed: 1.6, hw: 0.6, hh: 1.6, def: horseDef, variants: Object.keys(HORSE_COAT), tex: (v) => quadTexture(horseDef, HORSE_COAT[v], { mane: [30, 24, 20], tail: [40, 30, 24], hoof: [50, 50, 50] }), drops: [['leather', 0, 2]], food: 'apple', passive: true, mount: true, biomes: [BIOME.SAVANNA, BIOME.PLAINS], sound: 'neigh' },
  sheep: { name: 'Ovelha', hp: 8, speed: 1.1, hw: 0.45, hh: 1.3, def: sheepDef, variants: [...Object.keys(SHEEP_WOOL), 'sheared'], tex: (v) => quadTexture(sheepDef, v === 'sheared' ? [230, 190, 180] : SHEEP_WOOL[v], { head: [220, 200, 190], leg: [220, 200, 190] }), drops: [['mutton', 1, 2]], wool: true, food: 'wheat', passive: true, biomes: [BIOME.PLAINS, BIOME.MOUNTAIN, BIOME.SNOWY, BIOME.FOREST], sound: 'baa' },
  fish: { name: 'Peixe', hp: 3, speed: 1.5, hw: 0.2, hh: 0.3, def: fishDef, variants: ['orange', 'blue'], tex: (v) => drawParts(fishDef, (ctx, p, n) => { for (const k in n) fillNet(ctx, n[k], v === 'orange' ? [240, 140, 40] : [70, 120, 200], 2); }), drops: [['fish', 1, 1]], passive: true, aquatic: true },
  zombie: { name: 'Zumbi', hp: 20, speed: 1.6, hw: 0.3, hh: 1.8, def: humanoidDef, tex: () => humanTexture({ def: humanoidDef, skin: [90, 140, 80], shirt: [50, 130, 160], pants: [60, 60, 140], hair: [40, 70, 40], eyes: [20, 20, 20], mouth: [40, 60, 40], sleeve: [50, 130, 160] }), drops: [['rotten_flesh', 0, 2], ['iron_ingot', 0, 0.06]], hostile: true, attack: 3, burns: true, sound: 'groan', zombie: true },
  skeleton: { name: 'Esqueleto', hp: 20, speed: 1.4, hw: 0.3, hh: 1.8, def: humanoidDef, tex: () => humanTexture({ def: humanoidDef, skin: [200, 200, 196], shirt: [190, 190, 186], pants: [180, 180, 176], hair: [200, 200, 196], eyes: [30, 30, 30], mouth: [60, 60, 60], ribs: true }), drops: [['bone', 0, 2], ['arrow', 0, 2]], hostile: true, attack: 2, ranged: true, burns: true, sound: 'rattle' },
  villager: { name: 'Aldeão', hp: 20, speed: 1.0, hw: 0.3, hh: 1.9, def: villagerDef, variants: PROFESSION_LIST, tex: (v) => humanTexture({ def: villagerDef, skin: [190, 140, 110], shirt: PROFESSIONS[v].shirt, pants: PROFESSIONS[v].shirt, hair: [70, 50, 40], eyes: [40, 120, 60], robe: true, sleeve: PROFESSIONS[v].shirt, apron: PROFESSIONS[v].apron }), drops: [], npc: true },
};
