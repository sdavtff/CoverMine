// Gerador procedural de texturas em alta resolução para o VoxelCraft.
// Cada tile gera albedo (sRGB + alfa), mapa de altura e rugosidade; a partir da altura
// são derivados o mapa de normais e a oclusão de cavidades (AO). Todas as texturas são
// periódicas (sem emendas) e ficam num atlas com margem ("gutter") para permitir mipmaps
// sem vazamento de cor entre tiles.

import { TILE, ATLAS_COLS, ATLAS_ROWS, CLAMP_TILES } from './tiles.js';
export { TILE, ATLAS_COLS, ATLAS_ROWS };
const PLANT_TILES = CLAMP_TILES;

// ---------------- noise helpers (periódicos) ----------------
function ihash(x, y, s) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (v) => v < 0 ? 0 : v > 1 ? 1 : v;
const smooth = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const mod = (a, n) => ((a % n) + n) % n;

// value noise periódico: u,v em [0,1), px/py = número de células por tile
function vnoise(u, v, px, py, s) {
  const x = u * px, y = v * py;
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = fade(x - xi), fy = fade(y - yi);
  const x0 = mod(xi, px), x1 = mod(xi + 1, px), y0 = mod(yi, py), y1 = mod(yi + 1, py);
  const a = ihash(x0, y0, s), b = ihash(x1, y0, s), c = ihash(x0, y1, s), d = ihash(x1, y1, s);
  return lerp(lerp(a, b, fx), lerp(c, d, fx), fy);
}
function fbm(u, v, px, py, oct, s) {
  let sum = 0, amp = 1, norm = 0;
  for (let i = 0; i < oct; i++) {
    sum += vnoise(u, v, px, py, s + i * 17) * amp;
    norm += amp; amp *= 0.5; px *= 2; py *= 2;
  }
  return sum / norm;
}
// Worley (celular) periódico: retorna [F1, F2, id da célula mais próxima]
function worley(u, v, n, s, jitter = 0.85) {
  const x = u * n, y = v * n;
  const xi = Math.floor(x), yi = Math.floor(y);
  let d1 = 9, d2 = 9, id = 0;
  for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
    const cx = xi + ox, cy = yi + oy;
    const wx = mod(cx, n), wy = mod(cy, n);
    const px = cx + 0.5 + (ihash(wx, wy, s) - 0.5) * jitter;
    const py = cy + 0.5 + (ihash(wx, wy, s + 1) - 0.5) * jitter;
    const d = Math.hypot(x - px, y - py);
    if (d < d1) { d2 = d1; d1 = d; id = wx + wy * n; } else if (d < d2) d2 = d;
  }
  return [d1, d2, id];
}
const mixc = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const mulc = (a, f) => [a[0] * f, a[1] * f, a[2] * f];

// ---------------- definições dos tiles ----------------
// Cada gerador recebe (u, v, px, py, T) e retorna [r, g, b, alpha(0..1), altura(0..1)].
// Rugosidade base por tile em ROUGH; o mapa ORM recebe pequenas variações pela altura.
const ROUGH = {
  [TILE.GRASS_TOP]: 0.88, [TILE.GRASS_SIDE]: 0.92, [TILE.DIRT]: 0.96, [TILE.STONE]: 0.78, [TILE.LOG_SIDE]: 0.9,
  [TILE.LOG_TOP]: 0.8, [TILE.LEAVES]: 0.62, [TILE.SAND]: 0.95, [TILE.WATER]: 0.1, [TILE.PLANKS]: 0.7,
  [TILE.BRICK]: 0.86, [TILE.GLASS]: 0.08, [TILE.COBBLE]: 0.84, [TILE.SNOW]: 0.55, [TILE.SNOW_SIDE]: 0.8,
  [TILE.BEDROCK]: 0.9, [TILE.GRAVEL]: 0.9, [TILE.LAMP]: 0.45, [TILE.BIRCH_SIDE]: 0.75, [TILE.BIRCH_TOP]: 0.8,
  [TILE.PINE_LEAVES]: 0.7, [TILE.TALLGRASS]: 0.7, [TILE.FLOWER_RED]: 0.6, [TILE.FLOWER_YELLOW]: 0.6,
};
// intensidade do relevo (normal map) por tile
const BUMP = {
  [TILE.GRASS_TOP]: 2.2, [TILE.GRASS_SIDE]: 2.6, [TILE.DIRT]: 3.0, [TILE.STONE]: 3.2, [TILE.LOG_SIDE]: 4.0,
  [TILE.LOG_TOP]: 2.0, [TILE.LEAVES]: 3.0, [TILE.SAND]: 1.6, [TILE.WATER]: 0.5, [TILE.PLANKS]: 2.4,
  [TILE.BRICK]: 4.0, [TILE.GLASS]: 1.0, [TILE.COBBLE]: 4.5, [TILE.SNOW]: 1.2, [TILE.SNOW_SIDE]: 2.4,
  [TILE.BEDROCK]: 4.5, [TILE.GRAVEL]: 4.0, [TILE.LAMP]: 2.5, [TILE.BIRCH_SIDE]: 2.5, [TILE.BIRCH_TOP]: 2.0,
  [TILE.PINE_LEAVES]: 3.0, [TILE.TALLGRASS]: 1.0, [TILE.FLOWER_RED]: 1.0, [TILE.FLOWER_YELLOW]: 1.0,
};

const DIRT_A = [96, 66, 44], DIRT_B = [138, 99, 68];
function dirtPx(u, v, px, py, s = 11) {
  const n = fbm(u, v, 4, 4, 4, s);
  const [d1, , id] = worley(u, v, 7, s + 3);
  const grain = ihash(px, py, s + 9);
  let c = mixc(DIRT_A, DIRT_B, n * 0.8 + grain * 0.35);
  let h = n * 0.5 + grain * 0.15;
  const pebR = 0.2 + ihash(id, 3, s) * 0.12;
  if (d1 < pebR && ihash(id, 7, s) < 0.55) {
    const t = 1 - d1 / pebR;
    const pc = ihash(id, 5, s);
    c = mixc(c, pc < 0.5 ? [112, 96, 82] : [86, 70, 56], 0.75);
    c = mulc(c, 0.85 + 0.3 * t);
    h += 0.45 * Math.sqrt(t);
  }
  if (grain > 0.965) { c = mulc(c, 0.6); h -= 0.15; }
  return [c[0], c[1], c[2], 1, h];
}
function stonePx(u, v, px, py, s = 21, base = [124, 124, 122]) {
  const n = fbm(u, v, 3, 3, 5, s);
  const crack = 1 - Math.abs(fbm(u, v, 4, 4, 4, s + 40) * 2 - 1);
  const strata = vnoise(u, v, 1, 6, s + 70);
  const grain = ihash(px, py, s + 5);
  let c = mulc(base, 0.72 + n * 0.5 + (strata - 0.5) * 0.12 + (grain - 0.5) * 0.1);
  let h = n * 0.7 + grain * 0.08;
  if (crack > 0.93) { const k = smooth(0.93, 0.99, crack); c = mulc(c, 1 - 0.45 * k); h -= 0.35 * k; }
  if (grain > 0.985) c = mixc(c, [190, 186, 180], 0.6);
  else if (grain < 0.012) c = mixc(c, [62, 60, 64], 0.7);
  return [c[0], c[1], c[2], 1, h];
}
function grassCol(u, v, px, py, s) {
  const n = fbm(u, v, 3, 3, 4, s);
  const [d1, d2, id] = worley(u, v, 11, s + 2, 1);
  const g = ihash(px, py, s + 1);
  const clump = 1 - smooth(0, 0.7, d1);
  let c = mixc([62, 112, 36], [112, 162, 58], n * 0.6 + clump * 0.35 + (ihash(id, 1, s) - 0.5) * 0.25);
  c = mulc(c, 0.86 + g * 0.24);
  if (ihash(id, 9, s) < 0.07) c = mixc(c, [150, 160, 70], 0.4); // tufos mais secos
  let h = clump * 0.6 + g * 0.25 + n * 0.2;
  if (d2 - d1 < 0.06) { c = mulc(c, 0.8); h -= 0.15; }
  return [c, h];
}
function sideOverhang(u, v, px, py, s, topFn, depthBase) {
  // borda superior irregular (grama/neve escorrendo pela lateral)
  const col = Math.floor(u * 64);
  const dep = depthBase + vnoise(u, 0, 8, 1, s) * 0.08 + (ihash(col, 0, s) < 0.3 ? ihash(col, 1, s) * 0.12 : 0);
  if (v < dep) {
    const [r, g, b, , h] = topFn(u, v);
    const edge = smooth(dep - 0.05, dep, v);
    return [r * (1 - 0.3 * edge), g * (1 - 0.3 * edge), b * (1 - 0.3 * edge), 1, 0.7 + h * 0.3 - edge * 0.2];
  }
  const d = dirtPx(u, v, px, py, s + 50);
  const sh = 1 - 0.25 * (1 - smooth(dep, dep + 0.1, v)); // sombra logo abaixo da borda
  return [d[0] * sh, d[1] * sh, d[2] * sh, 1, d[4] * 0.8];
}
function woodRings(u, v, s, light, dark, rimCol, rimW) {
  const dx = u - 0.5, dy = v - 0.5;
  const cheb = Math.max(Math.abs(dx), Math.abs(dy));
  if (cheb > 0.5 - rimW) {
    const n = fbm(u, v, 6, 6, 3, s + 9);
    const c = mulc(rimCol, 0.75 + n * 0.45);
    return [c[0], c[1], c[2], 1, 0.6 + n * 0.4];
  }
  const r = Math.hypot(dx, dy) * (1 + (fbm(u, v, 3, 3, 3, s) - 0.5) * 0.25);
  const ring = 0.5 + 0.5 * Math.sin(r * Math.PI * 2 * 7.5);
  let c = mixc(dark, light, smooth(0.15, 0.85, ring));
  c = mulc(c, 0.92 + fbm(u, v, 8, 8, 2, s + 4) * 0.16);
  const crack = Math.abs(Math.atan2(dy, dx) - 0.7) < 0.03 && r > 0.08;
  if (crack) c = mulc(c, 0.6);
  return [c[0], c[1], c[2], 1, 0.4 + ring * 0.25 - (crack ? 0.3 : 0)];
}
function plant(u, v, px, py, s, flower) {
  // canvas: v=0 topo, v=1 base. Lâminas de grama que crescem a partir da base.
  let best = null;
  const blades = flower ? 5 : 16;
  for (let i = 0; i < blades; i++) {
    const bx = 0.12 + ihash(i, 1, s) * 0.76;
    const top = flower ? 0.45 + ihash(i, 2, s) * 0.3 : 0.05 + ihash(i, 2, s) * 0.45;
    if (v < top) continue;
    const t = (v - top) / (1 - top); // 0 no topo, 1 na base
    const lean = (ihash(i, 3, s) - 0.5) * 0.35;
    const cx = bx + lean * (1 - t) * (1 - t);
    const w = 0.012 + 0.035 * t;
    if (Math.abs(u - cx) < w) {
      const shade = 0.55 + 0.45 * (1 - t) + (Math.abs(u - cx) / w) * -0.15;
      const base = flower ? [58, 110, 40] : mixc([84, 140, 46], [132, 182, 72], ihash(i, 4, s));
      best = [base[0] * shade, base[1] * shade, base[2] * shade, 1, 1 - t * 0.5];
    }
  }
  if (flower) {
    const fx = 0.5, fy = 0.3;
    const dx = u - fx, dy = v - fy;
    const r = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
    const petal = 0.17 + 0.06 * Math.cos(a * 5);
    if (r < 0.05) return [flower === 1 ? 60 : 150, flower === 1 ? 40 : 100, 20, 1, 1];
    if (r < petal) {
      const k = 0.75 + 0.25 * (1 - r / petal);
      const pc = flower === 1 ? [200, 30, 36] : [246, 206, 40];
      return [pc[0] * k, pc[1] * k, pc[2] * k, 1, 0.9 - r];
    }
    if (Math.abs(u - 0.5) < 0.025 && v > fy) return [52, 104, 36, 1, 0.6];
  }
  return best || [80, 120, 50, 0, 0];
}

const GEN = {
  [TILE.GRASS_TOP]: (u, v, px, py) => { const [c, h] = grassCol(u, v, px, py, 101); return [c[0], c[1], c[2], 1, h]; },
  [TILE.GRASS_SIDE]: (u, v, px, py) => sideOverhang(u, v, px, py, 111, (uu, vv) => {
    const [c, h] = grassCol(uu, vv, px, py, 101); return [c[0], c[1], c[2], 1, h];
  }, 0.2),
  [TILE.DIRT]: (u, v, px, py) => dirtPx(u, v, px, py, 11),
  [TILE.STONE]: (u, v, px, py) => stonePx(u, v, px, py, 21),
  [TILE.LOG_SIDE]: (u, v, px, py) => {
    const n = fbm(u, v, 6, 1, 4, 41);
    const ridge = 1 - Math.abs(fbm(u, v, 10, 2, 3, 47) * 2 - 1);
    const g = ihash(px, py, 43);
    let c = mixc([62, 44, 26], [124, 92, 58], smooth(0.3, 0.95, ridge) * 0.8 + n * 0.3);
    c = mulc(c, 0.9 + g * 0.18);
    return [c[0], c[1], c[2], 1, ridge * 0.8 + n * 0.2];
  },
  [TILE.LOG_TOP]: (u, v) => woodRings(u, v, 51, [184, 146, 92], [146, 108, 62], [92, 66, 40], 0.07),
  [TILE.LEAVES]: (u, v, px, py) => {
    const [d1, d2, id] = worley(u, v, 9, 61, 1);
    const size = 0.47 + ihash(id, 2, 61) * 0.2;
    const g = ihash(px, py, 63);
    if (d1 > size && d2 - d1 > 0.07 && g < 0.85) return [44, 82, 30, 0, 0];
    let c = mixc([40, 92, 28], [92, 150, 52], ihash(id, 1, 61) * 0.8 + g * 0.2);
    const vein = Math.abs((u * 9 % 1) - (v * 9 % 1));
    if (vein < 0.06) c = mulc(c, 1.12);
    c = mulc(c, 0.8 + 0.35 * (1 - d1 / size));
    return [c[0], c[1], c[2], 1, 1 - d1];
  },
  [TILE.SAND]: (u, v, px, py) => {
    const n = fbm(u, v, 4, 4, 4, 71);
    const rip = 0.5 + 0.5 * Math.sin((v + (fbm(u, v, 2, 2, 2, 73) - 0.5) * 0.25) * Math.PI * 2 * 5);
    const g = ihash(px, py, 75);
    let c = mulc([222, 206, 156], 0.88 + n * 0.12 + rip * 0.05 + (g - 0.5) * 0.12);
    if (g > 0.975) c = mixc(c, [150, 130, 100], 0.6);
    else if (g < 0.02) c = mixc(c, [250, 245, 230], 0.6);
    return [c[0], c[1], c[2], 1, rip * 0.4 + g * 0.25 + n * 0.3];
  },
  [TILE.WATER]: (u, v) => {
    const n = fbm(u, v, 3, 3, 3, 81);
    const c = mixc([24, 72, 150], [52, 122, 196], n);
    return [c[0], c[1], c[2], 1, n];
  },
  [TILE.PLANKS]: (u, v, px, py) => {
    const board = Math.floor(v * 4), bv = v * 4 - board;
    const seam = ihash(board, 1, 91);
    const grain = fbm(u + board * 0.31, v, 1, 16, 4, 93 + board);
    const lines = 0.5 + 0.5 * Math.sin((v * 4 * 6 + grain * 4) * Math.PI);
    let c = mixc([132, 98, 56], [182, 142, 88], 0.4 + (ihash(board, 2, 91) - 0.5) * 0.5 + lines * 0.25);
    c = mulc(c, 0.9 + ihash(px, py, 95) * 0.12);
    let h = 0.6 + lines * 0.15;
    const gap = bv < 0.06 || bv > 0.96;
    const vseam = Math.abs(u - seam) < 0.012;
    if (gap || vseam) { c = mulc(c, 0.48); h = 0.1; }
    const nail = Math.abs(u - (seam + 0.05) % 1) < 0.014 && Math.abs(bv - 0.5) < 0.07;
    if (nail) { c = [118, 112, 104]; h = 0.85; }
    return [c[0], c[1], c[2], 1, h];
  },
  [TILE.BRICK]: (u, v, px, py) => {
    const row = Math.floor(v * 4), rv = v * 4 - row;
    const off = row % 2 ? 0.25 : 0;
    const cu = (u + off) * 2, col = Math.floor(cu), bu = cu - col;
    const mw = 0.07;
    const mortar = rv < mw || bu < mw * 0.5;
    const g = ihash(px, py, 101);
    if (mortar) {
      const c = mulc([186, 180, 168], 0.85 + g * 0.2);
      return [c[0], c[1], c[2], 1, 0.15 + g * 0.1];
    }
    const id = mod(col, 2) + row * 2;
    const n = fbm(u, v, 6, 6, 3, 103);
    let c = mixc([132, 54, 40], [178, 86, 62], ihash(id, 1, 105) * 0.7 + n * 0.3);
    c = mulc(c, 0.88 + g * 0.2);
    const edge = Math.min(rv - mw, 1 - rv, (bu - mw * 0.5) * 2, (1 - bu) * 2);
    if (g > 0.97) c = mulc(c, 0.7);
    return [c[0], c[1], c[2], 1, 0.6 + smooth(0, 0.12, edge) * 0.3 + n * 0.1];
  },
  [TILE.GLASS]: (u, v) => {
    const b = Math.min(u, v, 1 - u, 1 - v);
    if (b < 0.055) { const k = 0.92 + 0.08 * (b / 0.055); return [210 * k, 232 * k, 242 * k, 1, 1]; }
    const d = u - v;
    if ((Math.abs(d - 0.18) < 0.035 || Math.abs(d - 0.3) < 0.018) && u > 0.15 && u < 0.75) return [240, 250, 255, 0.75, 0.6];
    return [200, 228, 240, 0, 0.5];
  },
  [TILE.COBBLE]: (u, v, px, py) => {
    const [d1, d2, id] = worley(u, v, 5, 121, 0.9);
    const e = d2 - d1;
    const n = fbm(u, v, 6, 6, 3, 123);
    const g = ihash(px, py, 125);
    if (e < 0.07) { const c = mulc([72, 70, 68], 0.8 + g * 0.3); return [c[0], c[1], c[2], 1, e * 2]; }
    let c = mulc([132, 130, 126], 0.72 + ihash(id, 1, 121) * 0.38 + n * 0.18 + (g - 0.5) * 0.08);
    if (ihash(id, 2, 121) < 0.25) c = mixc(c, [124, 116, 104], 0.4);
    const dome = smooth(0.07, 0.35, e);
    c = mulc(c, 0.8 + 0.25 * dome);
    return [c[0], c[1], c[2], 1, 0.3 + dome * 0.6 + n * 0.1];
  },
  [TILE.SNOW]: (u, v, px, py) => {
    const n = fbm(u, v, 3, 3, 4, 131);
    const g = ihash(px, py, 133);
    let c = mixc([214, 226, 242], [250, 252, 255], n * 0.8 + 0.2);
    if (g > 0.99) c = [255, 255, 255];
    return [c[0], c[1], c[2], 1, n * 0.8 + g * 0.1];
  },
  [TILE.SNOW_SIDE]: (u, v, px, py) => sideOverhang(u, v, px, py, 141, (uu, vv) => {
    const n = fbm(uu, vv, 3, 3, 3, 131);
    const c = mixc([214, 226, 242], [250, 252, 255], n);
    return [c[0], c[1], c[2], 1, n];
  }, 0.24),
  [TILE.BEDROCK]: (u, v, px, py) => {
    const [d1, d2, id] = worley(u, v, 6, 151, 1);
    const n = fbm(u, v, 4, 4, 4, 153);
    const g = ihash(px, py, 155);
    const k = ihash(id, 1, 151);
    let c = mulc([96, 96, 98], 0.35 + k * 0.6 + (n - 0.5) * 0.3 + (g - 0.5) * 0.15);
    if (d2 - d1 < 0.06) c = mulc(c, 0.45);
    return [c[0], c[1], c[2], 1, k * 0.6 + n * 0.3 + (d2 - d1)];
  },
  [TILE.GRAVEL]: (u, v, px, py) => {
    const [d1, d2, id] = worley(u, v, 10, 161, 1);
    const g = ihash(px, py, 163);
    const e = d2 - d1;
    if (e < 0.08) { const c = mulc([82, 76, 72], 0.7 + g * 0.3); return [c[0], c[1], c[2], 1, 0.05]; }
    const k = ihash(id, 1, 161);
    let c = k < 0.33 ? [150, 146, 140] : k < 0.66 ? [118, 110, 104] : [136, 118, 98];
    c = mulc(c, 0.75 + ihash(id, 2, 161) * 0.35 + (g - 0.5) * 0.1);
    const dome = smooth(0.08, 0.4, e);
    c = mulc(c, 0.78 + 0.3 * dome);
    return [c[0], c[1], c[2], 1, 0.2 + dome * 0.8];
  },
  [TILE.LAMP]: (u, v, px, py) => {
    const b = Math.min(u, v, 1 - u, 1 - v);
    const g = ihash(px, py, 173);
    if (b < 0.07) { const c = mulc([150, 112, 60], 0.75 + g * 0.3); return [c[0], c[1], c[2], 1, 1]; }
    const [d1, d2] = worley(u, v, 4, 171, 0.9);
    const glow = smooth(0, 0.5, d2 - d1);
    const c = mixc([214, 140, 52], [255, 236, 160], glow * 0.85 + g * 0.15);
    return [c[0], c[1], c[2], 1, 0.4 + glow * 0.4];
  },
  [TILE.BIRCH_SIDE]: (u, v, px, py) => {
    const n = fbm(u, v, 4, 2, 3, 181);
    const g = ihash(px, py, 183);
    let c = mulc([224, 222, 212], 0.86 + n * 0.16 + (g - 0.5) * 0.06);
    let h = 0.6 + n * 0.2;
    // lenticelas: traços escuros horizontais típicos da bétula
    const band = Math.floor(v * 10), bv = v * 10 - band;
    for (let k = 0; k < 2; k++) {
      if (ihash(band, k, 185) > 0.65) continue;
      const u0 = ihash(band, k + 4, 185), len = 0.08 + ihash(band, k + 8, 185) * 0.22;
      const du = Math.abs(((u - u0 + 1.5) % 1) - 0.5);
      const th = 0.22 + 0.2 * ihash(band, k + 12, 185);
      if (du < len * 0.5 && Math.abs(bv - 0.5) < th * (1 - (du / (len * 0.5)) ** 2)) { c = mixc(c, [38, 36, 32], 0.9); h -= 0.45; }
    }
    return [c[0], c[1], c[2], 1, h];
  },
  [TILE.BIRCH_TOP]: (u, v) => woodRings(u, v, 191, [214, 196, 146], [180, 158, 108], [218, 216, 204], 0.07),
  [TILE.PINE_LEAVES]: (u, v, px, py) => {
    const g = ihash(px, py, 201);
    const w = fbm(u, v, 6, 6, 2, 203);
    const s1 = Math.abs(Math.sin((u * 8 + v * 8 + w * 2.5) * Math.PI));
    const s2 = Math.abs(Math.sin((u * 8 - v * 8 + w * 2.5) * Math.PI));
    const needle = Math.max(1 - s1, 1 - s2);
    const cluster = fbm(u, v, 4, 4, 3, 207);
    if (needle < 0.4 && cluster < 0.45 && g < 0.9) return [30, 60, 34, 0, 0];
    const c = mixc([20, 50, 30], [62, 108, 62], needle * 0.6 + cluster * 0.3 + g * 0.15);
    return [c[0], c[1], c[2], 1, needle * 0.7 + cluster * 0.3];
  },
  [TILE.TALLGRASS]: (u, v, px, py) => plant(u, v, px, py, 211, 0),
  [TILE.FLOWER_RED]: (u, v, px, py) => plant(u, v, px, py, 221, 1),
  [TILE.FLOWER_YELLOW]: (u, v, px, py) => plant(u, v, px, py, 231, 2),
};

import { EXTRA_GEN, EXTRA_ROUGH, EXTRA_BUMP } from './textures2.js';
Object.assign(GEN, EXTRA_GEN(GEN_HELPERS()));
Object.assign(ROUGH, EXTRA_ROUGH);
Object.assign(BUMP, EXTRA_BUMP);
function GEN_HELPERS() { return { ihash, vnoise, fbm, worley, mixc, mulc, smooth, clamp01, mod, dirtPx, stonePx, grassCol, sideOverhang, woodRings, plant, GEN }; }

// ---------------- atlas ----------------
// tileSize: 32 / 64 / 128 pixels. Cada célula tem 1,5×tileSize (margem de tileSize/4 em cada lado).
export function buildAtlas(tileSize, onlyTiles) {
  const T = tileSize, G = T / 4, C = T + G * 2;
  const W = ATLAS_COLS * C, H = ATLAS_ROWS * C;
  const albedo = new Uint8Array(W * H * 4);
  const normal = new Uint8Array(W * H * 4);
  const orm = new Uint8Array(W * H * 4);
  const avg = [];
  const tA = new Float32Array(T * T * 4), tH = new Float32Array(T * T);
  for (const key in GEN) {
    const tile = +key, gen = GEN[tile];
    if (onlyTiles && !onlyTiles.has(tile)) continue;
    const plantTile = PLANT_TILES.has(tile);
    // gera em espaço normalizado; px/py inteiros em resolução fixa de 128 para estabilidade do grão
    const gs = 128 / T;
    let ar = 0, ag = 0, ab = 0, an = 0;
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
      const u = (x + 0.5) / T, v = (y + 0.5) / T;
      const r = gen(u, v, Math.floor(x * gs), Math.floor(y * gs), T);
      const i = (y * T + x) * 4;
      tA[i] = r[0]; tA[i + 1] = r[1]; tA[i + 2] = r[2]; tA[i + 3] = r[3];
      tH[y * T + x] = r[4];
      if (r[3] > 0.5) { ar += r[0]; ag += r[1]; ab += r[2]; an++; }
    }
    const mean = an ? [ar / an, ag / an, ab / an] : [128, 128, 128];
    avg[tile] = [mean[0] / 255, mean[1] / 255, mean[2] / 255];
    // pixels transparentes recebem a cor média (evita bordas escuras com mipmaps)
    for (let i = 0; i < T * T; i++) if (tA[i * 4 + 3] < 0.5) { tA[i * 4] = mean[0]; tA[i * 4 + 1] = mean[1]; tA[i * 4 + 2] = mean[2]; }
    const hAt = plantTile
      ? (x, y) => tH[Math.min(T - 1, Math.max(0, y)) * T + Math.min(T - 1, Math.max(0, x))]
      : (x, y) => tH[mod(y, T) * T + mod(x, T)];
    const bump = (BUMP[tile] ?? 2.5) * (T / 64);
    const rough = ROUGH[tile] ?? 0.85;
    const col = tile % ATLAS_COLS, row = Math.floor(tile / ATLAS_COLS);
    const ox = col * C + G, oy = row * C + G;
    // escreve tile + margem (repetição periódica; plantas usam extensão da borda)
    for (let y = -G; y < T + G; y++) for (let x = -G; x < T + G; x++) {
      const sx = plantTile ? Math.min(T - 1, Math.max(0, x)) : mod(x, T);
      const sy = plantTile ? Math.min(T - 1, Math.max(0, y)) : mod(y, T);
      const si = sy * T + sx;
      const di = ((oy + y) * W + ox + x) * 4;
      albedo[di] = tA[si * 4]; albedo[di + 1] = tA[si * 4 + 1]; albedo[di + 2] = tA[si * 4 + 2];
      albedo[di + 3] = plantTile && (x < 0 || y < 0 || x >= T || y >= T) && y < T ? 0 : Math.round(tA[si * 4 + 3] * 255);
      // normal a partir da altura (Sobel)
      const hl = hAt(sx - 1, sy), hr = hAt(sx + 1, sy), hu = hAt(sx, sy - 1), hd = hAt(sx, sy + 1);
      const hul = hAt(sx - 1, sy - 1), hur = hAt(sx + 1, sy - 1), hdl = hAt(sx - 1, sy + 1), hdr = hAt(sx + 1, sy + 1);
      const dx = ((hur + 2 * hr + hdr) - (hul + 2 * hl + hdl)) / 8;
      const dy = ((hdl + 2 * hd + hdr) - (hul + 2 * hu + hur)) / 8;
      let nx = -dx * bump, ny = -dy * bump, nz = 1;
      const inv = 1 / Math.hypot(nx, ny, nz);
      nx *= inv; ny *= inv; nz *= inv;
      normal[di] = Math.round((nx * 0.5 + 0.5) * 255);
      normal[di + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      normal[di + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      normal[di + 3] = 255;
      // AO de cavidade: altura local vs. média da vizinhança
      const h0 = tH[si];
      const avgN = (hl + hr + hu + hd + hul + hur + hdl + hdr) / 8;
      const ao = clamp01(1 - Math.max(0, avgN - h0) * 3.2);
      orm[di] = Math.round(ao * 255);
      orm[di + 1] = Math.round(clamp01(rough + (0.5 - h0) * 0.12) * 255);
      orm[di + 2] = 0;
      orm[di + 3] = 255;
    }
  }
  return { albedo, normal, orm, width: W, height: H, tileSize: T, cell: C, gutter: G, avg };
}

// UV (u0, v0, u1, v1) do tile no atlas. v cresce para baixo (texturas com flipY = false).
export function tileUV(tile, atlas) {
  const col = tile % ATLAS_COLS, row = Math.floor(tile / ATLAS_COLS);
  const x0 = col * atlas.cell + atlas.gutter, y0 = row * atlas.cell + atlas.gutter;
  return [x0 / atlas.width, y0 / atlas.height, (x0 + atlas.tileSize) / atlas.width, (y0 + atlas.tileSize) / atlas.height];
}

// canvas 2D do albedo (ícones da barra de blocos)
export function atlasToCanvas(atlas) {
  const cv = document.createElement('canvas');
  cv.width = atlas.width; cv.height = atlas.height;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(atlas.width, atlas.height);
  img.data.set(atlas.albedo);
  ctx.putImageData(img, 0, 0);
  return cv;
}
