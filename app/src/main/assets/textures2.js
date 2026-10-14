// Texturas procedurais adicionais (v3): minérios, lava, madeiras, móveis, mecanismos, metais e plantações.
// Cada gerador retorna [r, g, b, alfa(0..1), altura(0..1)] para (u, v) em [0,1).
import { TILE as T } from './tiles.js';

export const EXTRA_ROUGH = {
  [T.LAVA]: 0.6, [T.ICE]: 0.08, [T.IRON_BLOCK]: 0.35, [T.GOLD_BLOCK]: 0.25, [T.DIAMOND_BLOCK]: 0.2, [T.COPPER_BLOCK]: 0.35,
  [T.CRYSTAL_BLOCK]: 0.15, [T.CRYSTAL_ORE]: 0.5, [T.DIAMOND_ORE]: 0.6, [T.GOLD_ORE]: 0.6, [T.MUD]: 0.5, [T.PLAMP_ON]: 0.3,
  [T.PLAMP_OFF]: 0.3, [T.ELEVATOR]: 0.4, [T.RAIL]: 0.5, [T.RAIL_CURVE]: 0.5, [T.WOOL_WHITE]: 1, [T.WOOL_BLACK]: 1,
  [T.WOOL_BROWN]: 1, [T.WOOL_GRAY]: 1, [T.COLOR_RED]: 0.7, [T.COLOR_BLUE]: 0.7, [T.COLOR_YELLOW]: 0.7, [T.COLOR_GREEN]: 0.7,
};
export const EXTRA_BUMP = {
  [T.LAVA]: 2, [T.ICE]: 0.6, [T.WIRE]: 1, [T.TORCH]: 1, [T.IRON_BLOCK]: 2, [T.GOLD_BLOCK]: 2, [T.DIAMOND_BLOCK]: 2,
  [T.COPPER_BLOCK]: 2, [T.WOOL_WHITE]: 1.5, [T.WOOL_BLACK]: 1.5, [T.WOOL_BROWN]: 1.5, [T.WOOL_GRAY]: 1.5,
  [T.COLOR_RED]: 0.8, [T.COLOR_BLUE]: 0.8, [T.COLOR_YELLOW]: 0.8, [T.COLOR_GREEN]: 0.8, [T.FARMLAND]: 3, [T.MUD]: 2,
};

export function EXTRA_GEN(h) {
  const { ihash, vnoise, fbm, worley, mixc, mulc, smooth, clamp01, mod, dirtPx, stonePx, grassCol, sideOverhang, woodRings, plant, GEN } = h;
  const px4 = (r) => [r[0], r[1], r[2], r[3], r[4]];

  // minério: pedra + aglomerados de cristais/pepitas
  const ore = (seed, colA, colB, glow) => (u, v, px, py) => {
    const st = stonePx(u, v, px, py, 21);
    const [d1, , id] = worley(u, v, 4, seed, 0.9);
    const r = 0.22 + ihash(id, 1, seed) * 0.12;
    const [e1] = worley(u, v, 11, seed + 3, 1);
    if (d1 < r && e1 < 0.45 && ihash(id, 2, seed) < 0.85) {
      const k = 1 - e1 / 0.45;
      const c = mixc(colB, colA, k);
      return [c[0], c[1], c[2], 1, 0.6 + k * 0.4];
    }
    if (glow && d1 < r + 0.06) { const c = mixc(st, colB, 0.25); return [c[0], c[1], c[2], 1, st[4]]; }
    return st;
  };
  const planks = (seed, light, dark) => (u, v, px, py) => {
    const board = Math.floor(v * 4), bv = v * 4 - board;
    const seam = ihash(board, 1, seed);
    const grain = fbm(u + board * 0.31, v, 1, 16, 4, seed + 2 + board);
    const lines = 0.5 + 0.5 * Math.sin((v * 4 * 6 + grain * 4) * Math.PI);
    let c = mixc(dark, light, 0.4 + (ihash(board, 2, seed) - 0.5) * 0.5 + lines * 0.25);
    c = mulc(c, 0.9 + ihash(px, py, seed + 4) * 0.12);
    let hh = 0.6 + lines * 0.15;
    if (bv < 0.06 || bv > 0.96 || Math.abs(u - seam) < 0.012) { c = mulc(c, 0.5); hh = 0.1; }
    return [c[0], c[1], c[2], 1, hh];
  };
  const bark = (seed, a, b) => (u, v, px, py) => {
    const n = fbm(u, v, 6, 1, 4, seed);
    const ridge = 1 - Math.abs(fbm(u, v, 10, 2, 3, seed + 6) * 2 - 1);
    const g = ihash(px, py, seed + 2);
    let c = mixc(a, b, smooth(0.3, 0.95, ridge) * 0.8 + n * 0.3);
    c = mulc(c, 0.9 + g * 0.18);
    return [c[0], c[1], c[2], 1, ridge * 0.8 + n * 0.2];
  };
  const leaves = (seed, a, b) => (u, v, px, py) => {
    const [d1, d2, id] = worley(u, v, 9, seed, 1);
    const size = 0.47 + ihash(id, 2, seed) * 0.2;
    const g = ihash(px, py, seed + 2);
    if (d1 > size && d2 - d1 > 0.07 && g < 0.85) return [a[0], a[1], a[2], 0, 0];
    let c = mixc(a, b, ihash(id, 1, seed) * 0.8 + g * 0.2);
    c = mulc(c, 0.8 + 0.35 * (1 - d1 / size));
    return [c[0], c[1], c[2], 1, 1 - d1];
  };
  const solid = (seed, col, amp = 0.08, bump = 0.3) => (u, v, px, py) => {
    const n = fbm(u, v, 4, 4, 3, seed), g = ihash(px, py, seed + 1);
    const c = mulc(col, 1 - amp + n * amp * 2 + (g - 0.5) * amp * 0.5);
    return [c[0], c[1], c[2], 1, n * bump];
  };
  const wool = (seed, col) => (u, v, px, py) => {
    const w = fbm(u, v, 8, 8, 2, seed), s1 = Math.abs(Math.sin((u * 10 + v * 6 + w) * Math.PI));
    const g = ihash(px, py, seed + 1);
    const c = mulc(col, 0.82 + s1 * 0.14 + w * 0.08 + (g - 0.5) * 0.06);
    return [c[0], c[1], c[2], 1, s1 * 0.5 + w * 0.5];
  };
  const metal = (seed, col, hi) => (u, v, px, py) => {
    const b = Math.min(u, v, 1 - u, 1 - v);
    const g = ihash(px, py, seed);
    const n = fbm(u, v, 2, 8, 3, seed + 1);
    let c = mixc(col, hi, n * 0.5 + (1 - v) * 0.3);
    c = mulc(c, 0.92 + g * 0.08);
    if (b < 0.06) { c = mulc(c, 0.7); return [c[0], c[1], c[2], 1, 0.2]; }
    if (b < 0.1) { c = mixc(c, hi, 0.5); return [c[0], c[1], c[2], 1, 1]; }
    // rebites nos cantos
    if (Math.hypot(Math.min(u, 1 - u) - 0.16, Math.min(v, 1 - v) - 0.16) < 0.035) { c = mixc(c, hi, 0.7); return [c[0], c[1], c[2], 1, 1]; }
    return [c[0], c[1], c[2], 1, 0.7];
  };
  const wheat = (stage) => (u, v, px, py) => {
    const blades = 9;
    const top = [0.75, 0.5, 0.3, 0.1][stage];
    for (let i = 0; i < blades; i++) {
      const bx = 0.1 + ihash(i, 1, 600 + stage) * 0.8;
      const tp = top + ihash(i, 2, 600) * 0.15;
      if (v < tp) continue;
      const t = (v - tp) / (1 - tp);
      if (Math.abs(u - bx - (1 - t) * 0.05) < 0.02 + 0.015 * t) {
        const green = [80, 140, 50], ripe = [196, 168, 76];
        const c = mixc(green, ripe, stage / 3 * (1 - t * 0.6));
        // espigas no topo
        if (stage >= 2 && t < 0.3) return [Math.min(255, c[0] * 1.15), c[1] * 1.05, c[2] * 0.8, 1, 1];
        return [c[0], c[1], c[2], 1, 1 - t];
      }
    }
    return [100, 120, 60, 0, 0];
  };
  const rail = (curve) => (u, v, px, py) => {
    // dormentes de madeira + dois trilhos de ferro
    const tie = (v * 4) % 1;
    let c = null;
    if (!curve) {
      if (Math.abs(u - 0.22) < 0.04 || Math.abs(u - 0.78) < 0.04) return [150, 150, 156, 1, 1];
      if (tie > 0.25 && tie < 0.75 && u > 0.06 && u < 0.94) c = mulc([110, 80, 50], 0.85 + ihash(px, py, 7) * 0.2);
    } else {
      const r = Math.hypot(u - 1, v - 1);
      if (Math.abs(r - 0.78) < 0.04 || Math.abs(r - 0.22) < 0.04) return [150, 150, 156, 1, 1];
      const a = Math.atan2(1 - v, 1 - u) / (Math.PI / 2) * 4 % 1;
      if (r > 0.12 && r < 0.88 && a > 0.25 && a < 0.75) c = mulc([110, 80, 50], 0.85 + ihash(px, py, 7) * 0.2);
    }
    return c ? [c[0], c[1], c[2], 1, 0.5] : [110, 80, 50, 0, 0];
  };

  return {
    [T.COAL_ORE]: ore(301, [40, 40, 44], [20, 20, 22]),
    [T.IRON_ORE]: ore(302, [222, 184, 158], [160, 120, 96]),
    [T.COPPER_ORE]: ore(303, [228, 128, 84], [96, 160, 120]),
    [T.GOLD_ORE]: ore(304, [255, 228, 96], [210, 160, 30]),
    [T.DIAMOND_ORE]: ore(305, [150, 245, 240], [60, 190, 200]),
    [T.CRYSTAL_ORE]: ore(306, [220, 150, 255], [140, 70, 210], true),
    [T.LAVA]: (u, v, px, py) => {
      const [d1, d2] = worley(u, v, 5, 311, 1);
      const n = fbm(u, v, 4, 4, 3, 313);
      const crust = smooth(0.0, 0.18, d2 - d1);
      const c = mixc([255, 220, 90], [190, 50, 10], crust * 0.7 + n * 0.3);
      return [c[0], c[1], c[2], 1, crust];
    },
    [T.SANDSTONE_TOP]: (u, v, px, py) => { const r = GEN[T.SAND](u, v, px, py); const c = mulc(r, 0.95); return [c[0], c[1], c[2], 1, r[4]]; },
    [T.SANDSTONE_SIDE]: (u, v, px, py) => {
      const band = Math.floor(v * 5), bv = v * 5 - band;
      const n = fbm(u, v, 4, 2, 3, 321);
      let c = mulc([214, 196, 142], 0.9 + (ihash(band, 0, 321) - 0.5) * 0.1 + n * 0.08 + (ihash(px, py, 322) - 0.5) * 0.05);
      if (bv < 0.08) c = mulc(c, 0.85);
      return [c[0], c[1], c[2], 1, bv < 0.08 ? 0.2 : 0.6 + n * 0.3];
    },
    [T.CACTUS_TOP]: (u, v, px, py) => {
      const r = Math.hypot(u - 0.5, v - 0.5);
      const c = mulc([70, 130, 50], 0.8 + 0.25 * Math.cos(r * 12) + ihash(px, py, 331) * 0.08);
      return [c[0], c[1], c[2], 1, 0.5 + 0.3 * Math.cos(r * 12)];
    },
    [T.CACTUS_SIDE]: (u, v, px, py) => {
      const rib = 0.5 + 0.5 * Math.cos(u * Math.PI * 2 * 4);
      let c = mixc([40, 96, 36], [92, 154, 64], rib * 0.8 + ihash(px, py, 333) * 0.2);
      const sp = ihash(Math.floor(u * 8), Math.floor(v * 8), 334) < 0.4 && Math.abs((u * 8) % 1 - 0.5) < 0.08 && Math.abs((v * 8) % 1 - 0.5) < 0.08;
      if (sp) c = [230, 220, 170];
      return [c[0], c[1], c[2], 1, rib * 0.7 + (sp ? 0.3 : 0)];
    },
    [T.DEAD_BUSH]: (u, v, px, py) => {
      for (let i = 0; i < 7; i++) {
        const a = -1.2 + i * 0.4 + (ihash(i, 1, 341) - 0.5) * 0.3;
        const len = 0.45 + ihash(i, 2, 341) * 0.4;
        const t = (1 - v) / len;
        if (t < 0 || t > 1) continue;
        const x = 0.5 + Math.sin(a) * t * len * 0.9;
        if (Math.abs(u - x) < 0.025) return [120 + 30 * t, 86 + 20 * t, 50, 1, 1 - t];
      }
      return [120, 86, 50, 0, 0];
    },
    [T.ICE]: (u, v, px, py) => {
      const n = fbm(u, v, 3, 3, 3, 351);
      const crack = 1 - Math.abs(fbm(u, v, 4, 4, 3, 352) * 2 - 1);
      let c = mixc([150, 190, 240], [210, 235, 255], n);
      if (crack > 0.94) c = mixc(c, [255, 255, 255], 0.6);
      return [c[0], c[1], c[2], 1, n * 0.3];
    },
    [T.MUD]: (u, v, px, py) => {
      const n = fbm(u, v, 4, 4, 4, 361);
      const [d1] = worley(u, v, 6, 362, 1);
      let c = mixc([52, 40, 32], [92, 72, 56], n);
      if (d1 < 0.2) c = mixc(c, [110, 96, 80], 0.4);
      return [c[0], c[1], c[2], 1, n * 0.6 + (d1 < 0.2 ? 0.2 : 0)];
    },
    [T.SPRUCE_SIDE]: bark(371, [40, 28, 18], [86, 60, 38]),
    [T.SPRUCE_TOP]: (u, v) => woodRings(u, v, 372, [150, 110, 70], [112, 80, 48], [58, 40, 26], 0.08),
    [T.ACACIA_SIDE]: bark(373, [84, 80, 74], [130, 124, 114]),
    [T.ACACIA_TOP]: (u, v) => woodRings(u, v, 374, [214, 120, 64], [176, 92, 46], [104, 100, 92], 0.08),
    [T.ACACIA_LEAVES]: leaves(375, [70, 96, 30], [128, 150, 52]),
    [T.SPRUCE_PLANKS]: planks(381, [130, 94, 58], [86, 60, 36]),
    [T.BIRCH_PLANKS]: planks(382, [222, 204, 150], [184, 164, 112]),
    [T.TABLE_TOP]: (u, v, px, py) => {
      const p = GEN[T.PLANKS](u, v, px, py);
      const g = Math.min(Math.abs((u * 3) % 1 - 0), Math.abs((v * 3) % 1 - 0));
      if (u > 0.08 && u < 0.92 && v > 0.08 && v < 0.92 && ((u * 3) % 1 < 0.06 || (v * 3) % 1 < 0.06)) return [70, 50, 32, 1, 0.1];
      if (Math.min(u, v, 1 - u, 1 - v) < 0.06) { const c = mulc(p, 0.7); return [c[0], c[1], c[2], 1, 1]; }
      return p;
    },
    [T.TABLE_SIDE]: (u, v, px, py) => {
      const p = GEN[T.PLANKS](u, v, px, py);
      if (v < 0.18) { const c = mulc([150, 112, 66], 0.9 + ihash(px, py, 391) * 0.1); return [c[0], c[1], c[2], 1, 0.9]; }
      // serrote e martelo pendurados
      if (u > 0.2 && u < 0.45 && v > 0.3 && v < 0.8 && Math.abs(u - 0.2 - (v - 0.3) * 0.5) < 0.04) return [170, 170, 176, 1, 1];
      if (u > 0.6 && u < 0.64 && v > 0.35 && v < 0.85) return [100, 72, 44, 1, 1];
      if (u > 0.54 && u < 0.72 && v > 0.32 && v < 0.42) return [120, 120, 128, 1, 1];
      return p;
    },
    [T.TABLE_FRONT]: (u, v, px, py) => {
      const p = GEN[T.PLANKS](u, v, px, py);
      if (v < 0.18) { const c = mulc([150, 112, 66], 0.9 + ihash(px, py, 392) * 0.1); return [c[0], c[1], c[2], 1, 0.9]; }
      if (u > 0.3 && u < 0.7 && v > 0.35 && v < 0.75 && (Math.abs(u - 0.3) < 0.04 || Math.abs(u - 0.7) < 0.04 || Math.abs(v - 0.35) < 0.04 || Math.abs(v - 0.75) < 0.04)) return [80, 60, 40, 1, 0.2];
      return p;
    },
    [T.FURNACE_FRONT]: (u, v, px, py) => {
      const c = GEN[T.COBBLE](u, v, px, py);
      if (u > 0.25 && u < 0.75 && v > 0.5 && v < 0.85) return [28, 26, 26, 1, 0];
      if (u > 0.2 && u < 0.8 && v > 0.45 && v < 0.9) { const k = mulc([90, 88, 86], 0.9); return [k[0], k[1], k[2], 1, 0.9]; }
      return c;
    },
    [T.FURNACE_FRONT_ON]: (u, v, px, py) => {
      const c = GEN[T.COBBLE](u, v, px, py);
      if (u > 0.25 && u < 0.75 && v > 0.5 && v < 0.85) {
        const f = fbm(u, v * 2, 4, 4, 3, 393);
        const k = mixc([255, 230, 120], [220, 80, 20], f + (v - 0.5) * 0.5);
        return [k[0], k[1], k[2], 1, 0.2];
      }
      if (u > 0.2 && u < 0.8 && v > 0.45 && v < 0.9) { const k = mulc([90, 88, 86], 0.9); return [k[0], k[1], k[2], 1, 0.9]; }
      return c;
    },
    [T.FURNACE_SIDE]: (u, v, px, py) => GEN[T.COBBLE](u, v, px, py),
    [T.FURNACE_TOP]: (u, v, px, py) => stonePx(u, v, px, py, 394, [110, 110, 108]),
    [T.CHEST]: (u, v, px, py) => {
      const p = GEN[T.PLANKS](u, v, px, py);
      if (Math.min(u, v, 1 - u, 1 - v) < 0.07) { const c = mulc([110, 76, 40], 0.85); return [c[0], c[1], c[2], 1, 1]; }
      if (Math.abs(v - 0.38) < 0.04) return [70, 50, 28, 1, 0.2];
      if (Math.abs(u - 0.5) < 0.07 && v > 0.3 && v < 0.5) return [190, 190, 196, 1, 1];
      return p;
    },
    [T.CHEST_TOP]: (u, v, px, py) => {
      const p = GEN[T.PLANKS](u, v, px, py);
      if (Math.min(u, v, 1 - u, 1 - v) < 0.07) { const c = mulc([110, 76, 40], 0.85); return [c[0], c[1], c[2], 1, 1]; }
      return p;
    },
    [T.TORCH]: (u, v) => {
      if (Math.abs(u - 0.5) < 0.0625 && v > 0.375) { const k = 0.8 + 0.2 * (u < 0.5 ? 1 : 0); return [130 * k, 96 * k, 56 * k, 1, 1]; }
      if (Math.abs(u - 0.5) < 0.09 && v > 0.19 && v <= 0.375) {
        const t = (v - 0.19) / 0.185;
        const c = mixc([255, 250, 200], [255, 140, 30], t);
        return [c[0], c[1], c[2], 1, 1];
      }
      return [255, 200, 80, 0, 0];
    },
    [T.DOOR_BOTTOM]: (u, v, px, py) => {
      const p = GEN[T.PLANKS](v, u, px, py);
      if (Math.min(u, 1 - u) < 0.08 || v > 0.92) { const c = mulc(p, 0.75); return [c[0], c[1], c[2], 1, 1]; }
      if (u > 0.2 && u < 0.8 && v > 0.15 && v < 0.75 && (Math.abs(u - 0.2) < 0.03 || Math.abs(u - 0.8) < 0.03 || Math.abs(v - 0.15) < 0.03 || Math.abs(v - 0.75) < 0.03)) { const c = mulc(p, 0.6); return [c[0], c[1], c[2], 1, 0.2]; }
      if (u > 0.78 && u < 0.86 && v > 0.02 && v < 0.1) return [180, 170, 120, 1, 1];
      return p;
    },
    [T.DOOR_TOP]: (u, v, px, py) => {
      const p = GEN[T.PLANKS](v, u, px, py);
      if (Math.min(u, 1 - u) < 0.08 || v < 0.08) { const c = mulc(p, 0.75); return [c[0], c[1], c[2], 1, 1]; }
      // janela de vidro
      if (u > 0.18 && u < 0.82 && v > 0.18 && v < 0.7) {
        if (Math.abs(u - 0.5) < 0.03 || Math.abs(v - 0.44) < 0.03) { const c = mulc(p, 0.8); return [c[0], c[1], c[2], 1, 0.8]; }
        return [200, 228, 240, 0, 0.5];
      }
      return p;
    },
    [T.LADDER]: (u, v, px, py) => {
      if (Math.abs(u - 0.2) < 0.06 || Math.abs(u - 0.8) < 0.06) { const c = mulc([130, 96, 56], 0.85 + ihash(px, py, 401) * 0.15); return [c[0], c[1], c[2], 1, 1]; }
      if (u > 0.14 && u < 0.86 && (v * 4) % 1 > 0.4 && (v * 4) % 1 < 0.6) { const c = mulc([150, 112, 66], 0.85 + ihash(px, py, 402) * 0.15); return [c[0], c[1], c[2], 1, 0.8]; }
      return [130, 96, 56, 0, 0];
    },
    [T.BED_TOP]: (u, v, px, py) => {
      const w = wool(411, [176, 40, 40])(u, v, px, py);
      if (Math.abs(u - 0.5) > 0.44) return [210, 210, 210, 1, 0.6];
      return w;
    },
    [T.BED_PILLOW]: wool(412, [236, 236, 236]),
    [T.BOOKSHELF]: (u, v, px, py) => {
      const shelf = Math.floor(v * 2), sv = v * 2 - shelf;
      if (sv < 0.1 || sv > 0.92 || u < 0.06 || u > 0.94) return GEN[T.PLANKS](u, v, px, py);
      const book = Math.floor(u * 9);
      const cols = [[160, 40, 40], [40, 80, 150], [60, 120, 60], [150, 120, 50], [100, 60, 120], [180, 160, 130]];
      const c = cols[Math.floor(ihash(book, shelf, 421) * cols.length)];
      const top = 0.15 + ihash(book, shelf, 422) * 0.25;
      if (sv < top) return [40, 28, 20, 1, 0];
      const k = (u * 9) % 1 < 0.12 ? 0.6 : 0.95;
      return [c[0] * k, c[1] * k, c[2] * k, 1, 0.8];
    },
    [T.WOOL_WHITE]: wool(431, [232, 232, 232]),
    [T.WOOL_BLACK]: wool(432, [36, 34, 38]),
    [T.WOOL_BROWN]: wool(433, [112, 76, 48]),
    [T.WOOL_GRAY]: wool(434, [128, 128, 132]),
    [T.COLOR_RED]: solid(441, [168, 40, 36]),
    [T.COLOR_BLUE]: solid(442, [44, 62, 160]),
    [T.COLOR_YELLOW]: solid(443, [236, 186, 36]),
    [T.COLOR_GREEN]: solid(444, [84, 120, 40]),
    [T.LEVER]: (u, v, px, py) => GEN[T.COBBLE](u, v, px, py),
    [T.WIRE]: (u, v, px, py) => {
      const d = Math.min(Math.abs(u - 0.5), Math.abs(v - 0.5));
      const dot = Math.hypot(u - 0.5, v - 0.5) < 0.16;
      if (d < 0.07 || dot) { const k = 0.8 + ihash(px, py, 451) * 0.2; return [220 * k, 220 * k, 220 * k, 1, 1]; }
      return [200, 30, 20, 0, 0];
    },
    [T.PLAMP_OFF]: (u, v, px, py) => {
      const b = Math.min(u, v, 1 - u, 1 - v);
      if (b < 0.1) { const c = mulc([120, 90, 60], 0.85 + ihash(px, py, 461) * 0.15); return [c[0], c[1], c[2], 1, 1]; }
      const [d1, d2] = worley(u, v, 3, 462, 0.8);
      const c = mixc([90, 70, 50], [150, 110, 70], smooth(0, 0.4, d2 - d1));
      return [c[0], c[1], c[2], 1, 0.5];
    },
    [T.PLAMP_ON]: (u, v, px, py) => {
      const b = Math.min(u, v, 1 - u, 1 - v);
      if (b < 0.1) { const c = mulc([120, 90, 60], 0.85 + ihash(px, py, 461) * 0.15); return [c[0], c[1], c[2], 1, 1]; }
      const [d1, d2] = worley(u, v, 3, 462, 0.8);
      const c = mixc([255, 200, 100], [255, 250, 220], smooth(0, 0.4, d2 - d1));
      return [c[0], c[1], c[2], 1, 0.5];
    },
    [T.PISTON_SIDE]: (u, v, px, py) => {
      if (v < 0.25) return GEN[T.PLANKS](u, v, px, py);
      const c = GEN[T.COBBLE](u, v, px, py);
      if (Math.abs(u - 0.5) < 0.1 && v < 0.6) return [140, 120, 90, 1, 0.8];
      return c;
    },
    [T.PISTON_TOP]: (u, v, px, py) => {
      const p = GEN[T.PLANKS](u, v, px, py);
      if (Math.min(u, v, 1 - u, 1 - v) < 0.08) { const c = mulc(p, 0.7); return [c[0], c[1], c[2], 1, 1]; }
      if (Math.hypot(u - 0.5, v - 0.5) < 0.12) return [150, 150, 156, 1, 0.9];
      return p;
    },
    [T.PISTON_BOTTOM]: (u, v, px, py) => {
      const c = GEN[T.COBBLE](u, v, px, py);
      if (Math.hypot(u - 0.5, v - 0.5) < 0.18) return [60, 58, 56, 1, 0.1];
      return c;
    },
    [T.RAIL]: rail(false),
    [T.RAIL_CURVE]: rail(true),
    [T.ELEVATOR]: (u, v, px, py) => {
      const m = metal(471, [150, 152, 160], [210, 212, 220])(u, v, px, py);
      // setas para cima/baixo
      const au = Math.abs(u - 0.5);
      if ((v > 0.18 && v < 0.42 && au < (v - 0.18) * 0.8) || (v > 0.58 && v < 0.82 && au < (0.82 - v) * 0.8)) return [60, 200, 255, 1, 1];
      return m;
    },
    [T.IRON_BLOCK]: metal(481, [196, 198, 204], [240, 240, 244]),
    [T.GOLD_BLOCK]: metal(482, [236, 184, 40], [255, 236, 120]),
    [T.DIAMOND_BLOCK]: metal(483, [90, 210, 210], [190, 255, 250]),
    [T.COPPER_BLOCK]: metal(484, [196, 106, 70], [236, 156, 110]),
    [T.FARMLAND]: (u, v, px, py) => {
      const fur = 0.5 + 0.5 * Math.cos(v * Math.PI * 2 * 4);
      const n = fbm(u, v, 4, 4, 3, 491);
      const c = mixc([60, 40, 26], [100, 70, 46], fur * 0.6 + n * 0.4);
      return [c[0], c[1], c[2], 1, fur * 0.8 + n * 0.2];
    },
    [T.WHEAT0]: wheat(0), [T.WHEAT1]: wheat(1), [T.WHEAT2]: wheat(2), [T.WHEAT3]: wheat(3),
    [T.PATH_TOP]: (u, v, px, py) => {
      const n = fbm(u, v, 4, 4, 4, 501);
      const g = ihash(px, py, 502);
      let c = mixc([140, 112, 70], [176, 146, 96], n * 0.8 + g * 0.2);
      if (fbm(u, v, 3, 3, 2, 503) > 0.66) c = mixc(c, [100, 130, 60], 0.5);
      return [c[0], c[1], c[2], 1, n * 0.5 + g * 0.2];
    },
    [T.MOSSY_COBBLE]: (u, v, px, py) => {
      const c = GEN[T.COBBLE](u, v, px, py);
      const m = fbm(u, v, 3, 3, 4, 511);
      if (m > 0.55) { const k = mixc(c, [70, 110, 50], smooth(0.55, 0.7, m) * 0.8); return [k[0], k[1], k[2], 1, c[4] + 0.1]; }
      return c;
    },
    [T.STONE_BRICKS]: (u, v, px, py) => {
      const row = Math.floor(v * 2), rv = v * 2 - row;
      const off = row % 2 ? 0.5 : 0;
      const bu = ((u + off) * 2) % 1;
      const st = stonePx(u, v, px, py, 521, [128, 128, 128]);
      if (rv < 0.06 || bu < 0.04) { const c = mulc(st, 0.55); return [c[0], c[1], c[2], 1, 0.1]; }
      return [st[0], st[1], st[2], 1, 0.6 + st[4] * 0.3];
    },
    [T.CRYSTAL_BLOCK]: (u, v, px, py) => {
      const [d1, d2, id] = worley(u, v, 4, 531, 0.9);
      const e = d2 - d1;
      const c = mixc([120, 50, 190], [240, 190, 255], smooth(0, 0.5, e) * 0.7 + ihash(id, 1, 531) * 0.3);
      return [c[0], c[1], c[2], 1, smooth(0, 0.4, e)];
    },
    [T.SAPLING]: (u, v, px, py) => {
      if (Math.abs(u - 0.5) < 0.04 && v > 0.45) return [100, 72, 40, 1, 1];
      const d = Math.hypot((u - 0.5) * 1.1, v - 0.35);
      if (d < 0.28 && ihash(Math.floor(u * 12), Math.floor(v * 12), 541) < 0.8) { const c = mixc([50, 110, 40], [100, 160, 60], ihash(px, py, 542)); return [c[0], c[1], c[2], 1, 1 - d]; }
      return [60, 110, 40, 0, 0];
    },
    [T.SAVANNA_GRASS]: (u, v, px, py) => { const [c, hh] = grassCol(u, v, px, py, 551); const k = mixc(c, [170, 160, 80], 0.45); return [k[0], k[1], k[2], 1, hh]; },
    // fogo: línguas de chama (mais quentes embaixo), recorte por ruído
    [T.FIRE]: (u, v, px, py) => {
      const n = fbm(u, v * 0.7, 5, 3, 4, 561);
      const flame = 1 - v * 0.85 - Math.abs(u - 0.5) * 0.6 + (n - 0.5) * 0.9;
      if (flame < 0.18) return [255, 120, 20, 0, 0];
      const c = mixc([255, 90, 10], [255, 235, 140], smooth(0.18, 0.75, flame));
      return [c[0], c[1], c[2], 1, flame];
    },
    // TNT: lateral com faixa clara e letras escuras; topo com pavio
    [T.TNT_SIDE]: (u, v, px, py) => {
      const g = ihash(px, py, 571);
      if (v > 0.38 && v < 0.62) {
        const lx = Math.floor(u * 16), ly = Math.floor((v - 0.38) * 16 / 0.24 * 0.4);
        const letter = (lx % 5 === 1 || lx % 5 === 3) && lx > 0 && lx < 15 || (lx % 5 === 2 && ly === 0);
        const c = letter ? [40, 30, 30] : mulc([235, 225, 205], 0.92 + g * 0.08);
        return [c[0], c[1], c[2], 1, letter ? 0.3 : 0.6];
      }
      const c = mulc([200, 45, 35], 0.85 + g * 0.2 + (Math.floor(u * 4) % 2) * 0.05);
      return [c[0], c[1], c[2], 1, 0.5 + (Math.floor(u * 4) % 2) * 0.1];
    },
    [T.TNT_TOP]: (u, v, px, py) => {
      const d = Math.hypot(u - 0.5, v - 0.5);
      if (d < 0.12) return [60, 50, 40, 1, 1];
      const c = mulc([210, 60, 45], 0.85 + ihash(px, py, 581) * 0.2);
      return [c[0], c[1], c[2], 1, 0.5];
    },
    // estalactite: ponta de pedra afunilada (para baixo)
    [T.DRIPSTONE]: (u, v, px, py) => {
      const w = 0.42 * (1 - v) + 0.04;
      if (Math.abs(u - 0.5) > w) return [120, 105, 90, 0, 0];
      const c = mulc([150, 128, 108], 0.8 + fbm(u, v, 4, 4, 3, 591) * 0.35);
      return [c[0], c[1], c[2], 1, 1 - Math.abs(u - 0.5) / w];
    },
    // cipó: ramos verticais com folhinhas (tingido pela cor das folhas do bioma)
    [T.VINE]: (u, v, px, py) => {
      const strand = Math.abs(((u * 4) % 1) - 0.5 - Math.sin(v * 9 + Math.floor(u * 4)) * 0.12) < 0.08;
      const [d1, , id] = worley(u, v, 6, 601, 1);
      const leaf = d1 < 0.22 && ihash(id, 3, 601) < 0.6;
      if (!strand && !leaf) return [80, 120, 50, 0, 0];
      const c = mulc([150, 150, 150], 0.75 + ihash(px, py, 602) * 0.3);
      return [c[0], c[1], c[2], 1, leaf ? 0.8 : 0.5];
    },
  };
}
