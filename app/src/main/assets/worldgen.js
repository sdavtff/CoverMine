// Geração procedural determinística do mundo (sem THREE/DOM: roda no Web Worker e no thread principal).
// gen 1 = gerador original (v1.0), gen 2 = v2.0 (árvores variadas), gen 3 = biomas, cavernas, minérios e estruturas,
// gen 4 = gen 3 + erosão (vales), falésias, estalactites e cipós (mundos novos; mundos antigos não mudam).
import { Perlin, hash2, hash3, mulberry32 } from './noise.js';
import { B } from './blocks.js';

export const CS = 16, H = 128;
export const SEA_OLD = 22, SEA3 = 46;

export const BIOME = { OCEAN: 0, BEACH: 1, PLAINS: 2, FOREST: 3, DENSE_FOREST: 4, DESERT: 5, SAVANNA: 6, SWAMP: 7, SNOWY: 8, MOUNTAIN: 9, SNOWY_MOUNTAIN: 10, ROCKY: 11, RIVER: 12, LAKE: 13 };
export const BIOME_NAMES = ['Oceano', 'Praia', 'Planície', 'Floresta', 'Floresta densa', 'Deserto', 'Savana', 'Pântano', 'Região nevada', 'Montanhas', 'Montanhas nevadas', 'Região rochosa', 'Rio', 'Lago'];
// cor média do bioma para o mapa e tingimento (grama, folhas)
export const BIOME_GRASS = [
  [0.9, 0.93, 0.88], [0.92, 0.92, 0.85], [0.92, 0.95, 0.8], [0.86, 0.93, 0.82], [0.78, 0.9, 0.78], [1, 0.9, 0.6],
  [1, 0.9, 0.62], [0.72, 0.78, 0.6], [0.85, 0.92, 0.95], [0.82, 0.9, 0.86], [0.85, 0.92, 0.95], [0.86, 0.9, 0.82], [0.9, 0.93, 0.88], [0.9, 0.93, 0.88],
];

const smooth = (a, b, v) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

export class WorldGen {
  constructor(seed, gen) {
    this.seed = seed | 0;
    this.gen = gen || 1;
    this.sea = this.gen >= 3 ? SEA3 : SEA_OLD;
    this.n1 = new Perlin(seed);
    this.n2 = new Perlin(seed + 101);
    this.n3 = new Perlin(seed + 202);
    if (this.gen >= 3) {
      this.nCont = new Perlin(seed + 1001);
      this.nHill = new Perlin(seed + 1002);
      this.nMnt = new Perlin(seed + 1003);
      this.nRiv = new Perlin(seed + 1004);
      this.nTemp = new Perlin(seed + 1005);
      this.nHum = new Perlin(seed + 1006);
      this.nRock = new Perlin(seed + 1007);
      this.nCaveA = new Perlin(seed + 1008);
      this.nCaveB = new Perlin(seed + 1009);
      this.nCaveC = new Perlin(seed + 1010);
      this.nLake = new Perlin(seed + 1011);
      this.nDet = new Perlin(seed + 1012);
    }
    if (this.gen >= 4) { this.nEro = new Perlin(seed + 1013); this.nWarp = new Perlin(seed + 1014); }
    this.colCache = new Map();
  }

  // ---------------- altura e bioma ----------------
  heightAt(x, z) {
    if (this.gen < 3) {
      const cont = this.n1.fbm(x / 220, z / 220, 3);
      const hills = this.n2.fbm(x / 60, z / 60, 4);
      const m = Math.max(0, this.n3.fbm(x / 130, z / 130, 3) - 0.05);
      const h = SEA_OLD + 2 + cont * 16 + hills * 7 + m * m * 140;
      return Math.max(3, Math.min(64 - 9, Math.floor(h)));
    }
    return this.column(x, z).h;
  }
  // coluna (altura + bioma) do gerador v3, com cache
  column(x, z) {
    const key = x * 65536 + z;
    let c = this.colCache.get(key);
    if (c) return c;
    if (this.colCache.size > 60000) this.colCache.clear();
    const S = this.sea;
    const cont = this.nCont.fbm(x / 700, z / 700, 4);
    const hills = this.nHill.fbm(x / 90, z / 90, 4);
    const mnt = Math.max(0, this.nMnt.fbm(x / 300, z / 300, 4) - 0.06);
    const temp0 = this.nTemp.fbm(x / 520, z / 520, 3);
    const hum = this.nHum.fbm(x / 470 + 100, z / 470 + 100, 3);
    let h = S + 5 + cont * 42 + hills * 9 + mnt * mnt * 520 + this.nDet.fbm(x / 22, z / 22, 2) * 1.5;
    // biomas planos: deserto (dunas suaves), pântano (rente à água)
    const dry = temp0 > 0.16 && hum < -0.02;
    const wet = hum > 0.3;
    if (dry && mnt < 0.05) h = lerp(h, S + 6 + hills * 6, 0.5);
    if (wet && h > S - 2 && h < S + 10 && mnt < 0.05) h = lerp(h, S + 1, 0.65);
    // lagos em áreas planas
    const lake = this.nLake.fbm(x / 120, z / 120, 2);
    if (lake < -0.34 && h > S && h < S + 18 && mnt < 0.05) h = lerp(h, S - 4, smooth(-0.34, -0.48, lake));
    // gen 4: erosão aproximada — vales ramificados (ruído "ridged" com domínio distorcido), mais fundos
    // onde o relevo é alto; e falésias em degraus nas encostas de montanha
    if (this.gen >= 4) {
      const wx = x + this.nWarp.fbm(x / 180, z / 180, 2) * 70, wz = z + this.nWarp.fbm(x / 180 + 40, z / 180 + 40, 2) * 70;
      const ridge = 1 - Math.abs(this.nEro.fbm(wx / 260, wz / 260, 3));
      const ridge2 = 1 - Math.abs(this.nEro.fbm(wx / 95 + 50, wz / 95 + 50, 2));
      const relief = Math.max(0, h - S - 4);
      h -= relief * (0.42 * smooth(0.84, 0.985, ridge) + 0.18 * smooth(0.88, 0.99, ridge2));
      if (mnt > 0.07) {
        const step = 7, t = (h - S) / step, f = t - Math.floor(t);
        const terr = S + Math.floor(t) * step + f * f * f * step;
        h = lerp(h, terr, smooth(0.07, 0.2, mnt) * 0.85);
      }
    }
    // rios
    const rv = Math.abs(this.nRiv.fbm(x / 420 + 11.3, z / 420 + 7.1, 3));
    let river = false;
    if (h > S - 3) {
      const rf = smooth(0.006, 0.032, rv);
      if (rf < 1) { const nh = lerp(S - 4, h, rf); if (rf < 0.5) river = true; h = nh; }
    }
    h = Math.max(4, Math.min(H - 10, Math.floor(h)));
    const temp = temp0 - Math.max(0, h - S - 20) * 0.006;
    let biome;
    if (river && h < S) biome = BIOME.RIVER;
    else if (h < S - 1) biome = lake < -0.34 && cont > -0.15 ? BIOME.LAKE : BIOME.OCEAN;
    else if (h <= S + 1 && cont < 0.05 && !wet) biome = temp < -0.25 ? BIOME.SNOWY : BIOME.BEACH;
    else if (h > S + 36) biome = temp0 < -0.12 ? BIOME.SNOWY_MOUNTAIN : BIOME.MOUNTAIN;
    else if (temp < -0.18) biome = BIOME.SNOWY;
    else if (dry) biome = BIOME.DESERT;
    else if (temp > 0.07 && hum < 0.1) biome = BIOME.SAVANNA;
    else if (wet && h < S + 8) biome = BIOME.SWAMP;
    else if (this.nRock.fbm(x / 160, z / 160, 2) > 0.3) biome = BIOME.ROCKY;
    else if (hum > 0.2) biome = BIOME.DENSE_FOREST;
    else if (hum > 0.0) biome = BIOME.FOREST;
    else biome = BIOME.PLAINS;
    c = { h, biome, temp, hum };
    this.colCache.set(key, c);
    return c;
  }
  biomeAt(x, z) { return this.gen >= 3 ? this.column(x, z).biome : (this.heightAt(x, z) <= SEA_OLD + 1 ? BIOME.BEACH : BIOME.PLAINS); }

  // ---------------- geração de chunk ----------------
  generate(cx, cz) {
    const data = new Uint8Array(CS * CS * H), meta = new Uint8Array(CS * CS * H), biome = new Uint8Array(CS * CS);
    if (this.gen < 3) this.generateOld(cx, cz, data, biome);
    else this.generate3(cx, cz, data, meta, biome);
    return { data, meta, biome };
  }

  // ----- gerador v1/v2 (inalterado) -----
  treeAt(x, z, h) {
    if (h <= SEA_OLD + 1 || h >= 40) return 0;
    const r = hash2(x, z, this.seed);
    if (r > 0.014) return 0;
    return 4 + Math.floor(hash2(z, x, this.seed + 7) * 3);
  }
  treeAt2(x, z, h) {
    if (h <= SEA_OLD + 1 || h >= 46) return null;
    const forest = Math.max(0, this.n2.fbm(x / 90 + 50.3, z / 90 + 50.7, 2));
    const p = 0.007 + forest * 0.06;
    if (hash2(x, z, this.seed) > p) return null;
    const r = hash2(z, x, this.seed + 7), k = hash2(x + 3, z - 5, this.seed + 3);
    if (h >= 35) return { type: 2, th: 6 + Math.floor(r * 4) };
    if (k < 0.28) return { type: 1, th: 5 + Math.floor(r * 3) };
    return { type: 0, th: 4 + Math.floor(r * 3) };
  }
  generateOld(cx, cz, data, biome) {
    const S = CS * CS, SEA = SEA_OLD;
    const x0 = cx * CS, z0 = cz * CS;
    const g2 = this.gen >= 2;
    for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
      const h = this.heightAt(x0 + x, z0 + z);
      const col = x + z * CS;
      const beach = h <= SEA + 1, snow = h >= 46, rocky = h >= 40;
      biome[col] = beach ? BIOME.BEACH : rocky ? BIOME.MOUNTAIN : BIOME.PLAINS;
      const gravel = g2 && h < SEA - 2 && this.n2.noise((x0 + x) / 14 + 0.5, (z0 + z) / 14 + 0.5) > 0.22;
      for (let y = 0; y <= h; y++) {
        let id;
        if (y === 0) id = B.BEDROCK;
        else if (y === h) id = gravel ? B.GRAVEL : beach ? B.SAND : snow ? B.SNOW : rocky ? B.STONE : B.GRASS;
        else if (y >= h - 3) id = gravel && y >= h - 1 ? B.GRAVEL : beach ? B.SAND : rocky ? B.STONE : B.DIRT;
        else id = B.STONE;
        data[col + y * S] = id;
      }
      for (let y = h + 1; y <= SEA; y++) data[col + y * S] = B.WATER;
    }
    for (let tz = -2; tz < CS + 2; tz++) for (let tx = -2; tx < CS + 2; tx++) {
      const wx = x0 + tx, wz = z0 + tz;
      const h = this.heightAt(wx, wz);
      if (g2) { const t = this.treeAt2(wx, wz, h); if (t) this.placeTree2(data, tx, tz, wx, wz, h, t); continue; }
      const th = this.treeAt(wx, wz, h);
      if (!th) continue;
      const top = h + th;
      for (let y = top - 2; y <= top + 1; y++) {
        const rad = y >= top ? 1 : 2;
        for (let dz = -rad; dz <= rad; dz++) for (let dx = -rad; dx <= rad; dx++) {
          if (Math.abs(dx) === rad && Math.abs(dz) === rad && (y === top + 1 || hash2(wx + dx * 31, wz + dz * 17 + y, this.seed) < 0.5)) continue;
          const lx = tx + dx, lz = tz + dz;
          if (lx < 0 || lz < 0 || lx >= CS || lz >= CS || y >= H) continue;
          const i = lx + lz * CS + y * S;
          if (data[i] === B.AIR) data[i] = B.LEAVES;
        }
      }
      if (tx >= 0 && tz >= 0 && tx < CS && tz < CS) {
        for (let y = h + 1; y < top; y++) data[tx + tz * CS + y * S] = B.LOG;
        data[tx + tz * CS + h * S] = B.DIRT;
      }
    }
  }
  placeTree2(data, tx, tz, wx, wz, h, t) {
    const S = CS * CS, top = h + t.th;
    const leaf = t.type === 2 ? B.PINE_LEAVES : B.LEAVES;
    const put = (lx, y, lz, id) => {
      if (lx < 0 || lz < 0 || lx >= CS || lz >= CS || y >= H || y < 1) return;
      const i = lx + lz * CS + y * S;
      if (data[i] === B.AIR) data[i] = id;
    };
    if (t.type === 2) {
      put(tx, top + 1, tz, leaf); put(tx, top, tz, leaf);
      let rad = 1;
      for (let y = top - 1; y >= h + 3; y--) {
        for (let dz = -rad; dz <= rad; dz++) for (let dx = -rad; dx <= rad; dx++) {
          if (Math.abs(dx) + Math.abs(dz) > rad + (rad > 1 ? 1 : 0)) continue;
          put(tx + dx, y, tz + dz, leaf);
        }
        rad = rad === 1 ? 2 : 1;
        if (y < top - 4 && rad === 1) rad = 2;
      }
    } else {
      const big = t.type === 0 && hash2(wx, wz, this.seed + 21) < 0.35;
      for (let y = top - (big ? 3 : 2); y <= top + 1; y++) {
        const rad = y >= top ? 1 : 2;
        for (let dz = -rad; dz <= rad; dz++) for (let dx = -rad; dx <= rad; dx++) {
          const corner = Math.abs(dx) === rad && Math.abs(dz) === rad;
          if (corner && (y === top + 1 || hash2(wx + dx * 31, wz + dz * 17 + y, this.seed) < (t.type === 1 ? 0.8 : 0.5))) continue;
          put(tx + dx, y, tz + dz, leaf);
        }
      }
    }
    if (tx >= 0 && tz >= 0 && tx < CS && tz < CS) {
      const log = t.type === 1 ? B.BIRCH_LOG : B.LOG;
      for (let y = h + 1; y < top; y++) data[tx + tz * CS + y * S] = log;
      data[tx + tz * CS + h * S] = B.DIRT;
    }
  }

  // ----- gerador v3 -----
  generate3(cx, cz, data, meta, biome) {
    const S = CS * CS, SEA = this.sea;
    const x0 = cx * CS, z0 = cz * CS;
    const cols = new Array(CS * CS);
    let maxH = 0;
    for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
      const c = this.column(x0 + x, z0 + z);
      cols[x + z * CS] = c;
      biome[x + z * CS] = c.biome;
      if (c.h > maxH) maxH = c.h;
    }
    // terreno + superfície por bioma
    for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
      const col = x + z * CS;
      const { h, biome: bm } = cols[col];
      const wx = x0 + x, wz = z0 + z;
      const r = hash2(wx, wz, this.seed + 31);
      let top = B.GRASS, fill = B.DIRT, depth = 3 + (r < 0.5 ? 1 : 0);
      switch (bm) {
        case BIOME.OCEAN: case BIOME.LAKE: case BIOME.RIVER:
          top = fill = (this.n2.noise(wx / 14 + 0.5, wz / 14 + 0.5) > 0.2) ? B.GRAVEL : (bm === BIOME.OCEAN || r < 0.6 ? B.SAND : B.DIRT); break;
        case BIOME.BEACH: top = fill = B.SAND; break;
        case BIOME.DESERT: top = fill = B.SAND; depth = 4; break;
        case BIOME.SNOWY: top = B.SNOW; break;
        case BIOME.SWAMP: top = r < 0.25 ? B.MUD : B.GRASS; break;
        case BIOME.MOUNTAIN: top = h > SEA + 60 ? B.SNOW : (r < 0.4 ? B.STONE : r < 0.5 ? B.GRAVEL : B.GRASS); fill = top === B.GRASS ? B.DIRT : B.STONE; depth = 2; break;
        case BIOME.SNOWY_MOUNTAIN: top = r < 0.7 ? B.SNOW : B.STONE; fill = B.STONE; depth = 2; break;
        case BIOME.ROCKY: top = r < 0.45 ? B.STONE : r < 0.6 ? B.COBBLE : r < 0.7 ? B.GRAVEL : B.GRASS; fill = top === B.GRASS ? B.DIRT : B.STONE; break;
      }
      const bed = 1 + (hash2(wx, wz, this.seed + 5) < 0.5 ? 1 : 0);
      for (let y = 0; y <= h; y++) {
        let id;
        if (y < bed) id = B.BEDROCK;
        else if (y === h) id = top;
        else if (y >= h - depth) id = fill;
        else if (bm === BIOME.DESERT && y >= h - depth - 4) id = B.SANDSTONE;
        else id = B.STONE;
        data[col + y * S] = id;
      }
      for (let y = h + 1; y <= SEA; y++) data[col + y * S] = B.WATER;
      if (h < SEA && (bm === BIOME.SNOWY || bm === BIOME.SNOWY_MOUNTAIN || cols[col].temp < -0.3)) data[col + SEA * S] = B.ICE;
    }
    this.carveCaves(cx, cz, data, cols);
    this.placeOres(cx, cz, data);
    if (this.gen >= 4) this.decorateCaves(cx, cz, data, meta, cols);
    // árvores e plantas (margem de 3 para copas que cruzam a borda do chunk)
    for (let tz = -3; tz < CS + 3; tz++) for (let tx = -3; tx < CS + 3; tx++) {
      const wx = x0 + tx, wz = z0 + tz;
      const c = this.column(wx, wz);
      if (c.h < SEA) continue;
      const tr = this.tree3(wx, wz, c);
      if (tr) this.placeTree3(data, meta, tx, tz, wx, wz, c.h, tr);
    }
    if (this.gen >= 4) this.placeVines(cx, cz, data, cols);
    this.placeStructures(cx, cz, data, meta);
  }

  // gen 4: estalactites no teto e estalagmites no chão das cavernas
  decorateCaves(cx, cz, data, meta, cols) {
    const S = CS * CS, x0 = cx * CS, z0 = cz * CS;
    for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
      const col = x + z * CS, h = cols[col].h;
      for (let y = 6; y < h - 6; y++) {
        const i = col + y * S;
        if (data[i] !== B.AIR) continue;
        const r = hash3(x0 + x, y, z0 + z, this.seed + 91);
        if (data[i + S] === B.STONE && r < 0.06) { data[i] = B.DRIPSTONE; meta[i] = 1; }
        else if (data[i - S] === B.STONE && r > 0.965) { data[i] = B.DRIPSTONE; meta[i] = 0; }
      }
    }
  }
  // gen 4: cipós pendurados nas copas do pântano e da floresta densa
  placeVines(cx, cz, data, cols) {
    const S = CS * CS, x0 = cx * CS, z0 = cz * CS;
    for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
      const col = x + z * CS, c = cols[col];
      if (c.biome !== BIOME.SWAMP && c.biome !== BIOME.DENSE_FOREST) continue;
      for (let y = Math.min(H - 2, c.h + 18); y > c.h + 2; y--) {
        const i = col + y * S;
        if (data[i] !== B.LEAVES || data[i - S] !== B.AIR) continue;
        const r = hash3(x0 + x, y, z0 + z, this.seed + 93);
        if (r > (c.biome === BIOME.SWAMP ? 0.22 : 0.1)) continue;
        const len = 1 + Math.floor(hash3(x0 + x, y, z0 + z, this.seed + 94) * 5);
        for (let k = 1; k <= len && y - k > c.h && data[i - k * S] === B.AIR; k++) data[i - k * S] = B.VINE;
      }
    }
  }

  tree3(x, z, c) {
    const r = hash2(x, z, this.seed + 77);
    const k = hash2(z, x, this.seed + 78);
    const dens = [0, 0, 0.003, 0.022, 0.06, 0.009, 0.005, 0.016, 0.014, 0.006, 0.003, 0.003, 0, 0][c.biome];
    if (r > dens) {
      if (c.biome === BIOME.DESERT && r < 0.02) return { type: 'bush' };
      return null;
    }
    switch (c.biome) {
      case BIOME.DESERT: return { type: 'cactus', th: 1 + Math.floor(k * 3) };
      case BIOME.SAVANNA: return { type: 'acacia', th: 5 + Math.floor(k * 2) };
      case BIOME.SNOWY: case BIOME.MOUNTAIN: case BIOME.ROCKY: case BIOME.SNOWY_MOUNTAIN:
        return { type: 'pine', th: 6 + Math.floor(k * 5) };
      case BIOME.SWAMP: return { type: 'swamp', th: 4 + Math.floor(k * 2) };
      case BIOME.DENSE_FOREST: return k < 0.3 ? { type: 'birch', th: 5 + Math.floor(k * 9) } : { type: k > 0.85 ? 'bigoak' : 'oak', th: 5 + Math.floor(k * 3) };
      case BIOME.FOREST: return k < 0.35 ? { type: 'birch', th: 5 + Math.floor(k * 6) } : { type: 'oak', th: 4 + Math.floor(k * 3) };
      default: return { type: 'oak', th: 4 + Math.floor(k * 3) };
    }
  }
  placeTree3(data, meta, tx, tz, wx, wz, h, t) {
    const S = CS * CS;
    const ground = (lx, lz) => lx >= 0 && lz >= 0 && lx < CS && lz < CS;
    const put = (lx, y, lz, id, force) => {
      if (!ground(lx, lz) || y >= H || y < 1) return;
      const i = lx + lz * CS + y * S;
      if (force || data[i] === B.AIR) data[i] = id;
    };
    const gi = ground(tx, tz) ? tx + tz * CS + h * S : -1;
    const surface = gi >= 0 ? data[gi] : 0;
    if (gi >= 0 && (surface === B.AIR || surface === B.WATER)) return; // terreno escavado por caverna
    const leafBlob = (cx_, cy, cz_, rad, leaf, skip) => {
      for (let y = cy - rad; y <= cy + rad; y++) for (let dz = -rad; dz <= rad; dz++) for (let dx = -rad; dx <= rad; dx++) {
        const d = dx * dx + dz * dz + (y - cy) * (y - cy) * 1.6;
        if (d > rad * rad + 0.8) continue;
        if (skip && hash3(wx + dx, y, wz + dz, this.seed) < skip) continue;
        put(cx_ + dx, y, cz_ + dz, leaf);
      }
    };
    switch (t.type) {
      case 'bush': put(tx, h + 1, tz, B.DEAD_BUSH); return;
      case 'cactus': for (let y = h + 1; y <= h + t.th; y++) put(tx, y, tz, B.CACTUS); return;
      case 'pine': {
        const top = h + t.th;
        put(tx, top + 1, tz, B.PINE_LEAVES); put(tx, top, tz, B.PINE_LEAVES);
        let rad = 1;
        for (let y = top - 1; y >= h + 3; y--) {
          for (let dz = -rad; dz <= rad; dz++) for (let dx = -rad; dx <= rad; dx++) {
            if (Math.abs(dx) + Math.abs(dz) > rad + (rad > 1 ? 1 : 0)) continue;
            put(tx + dx, y, tz + dz, B.PINE_LEAVES);
          }
          rad = rad === 1 ? 2 : 1;
          if (y < top - 4 && rad === 1) rad = 2;
        }
        for (let y = h + 1; y < top; y++) put(tx, y, tz, B.SPRUCE_LOG, true);
        break;
      }
      case 'acacia': {
        const dir = Math.floor(hash2(wx, wz, this.seed + 9) * 4);
        const ox = [1, -1, 0, 0][dir], oz = [0, 0, 1, -1][dir];
        let x = tx, z = tz;
        for (let y = h + 1; y <= h + t.th; y++) {
          if (y > h + 2) { x += y % 2 ? ox : 0; z += y % 2 ? oz : 0; }
          put(x, y, z, B.ACACIA_LOG, true);
        }
        const cy = h + t.th + 1;
        for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) {
          if (Math.abs(dx) + Math.abs(dz) > 4) continue;
          put(x + dx, cy, z + dz, B.ACACIA_LEAVES);
          if (Math.abs(dx) + Math.abs(dz) <= 2) put(x + dx, cy + 1, z + dz, B.ACACIA_LEAVES);
        }
        break;
      }
      case 'birch': {
        const top = h + t.th;
        for (let y = top - 3; y <= top + 1; y++) {
          const rad = y >= top ? 1 : 2;
          for (let dz = -rad; dz <= rad; dz++) for (let dx = -rad; dx <= rad; dx++) {
            if (Math.abs(dx) === rad && Math.abs(dz) === rad && (y === top + 1 || hash2(wx + dx * 31, wz + dz * 17 + y, this.seed) < 0.8)) continue;
            put(tx + dx, y, tz + dz, B.LEAVES);
          }
        }
        for (let y = h + 1; y < top; y++) put(tx, y, tz, B.BIRCH_LOG, true);
        break;
      }
      case 'bigoak': {
        const top = h + t.th + 2;
        leafBlob(tx, top - 1, tz, 3, B.LEAVES, 0.15);
        leafBlob(tx + 1, top - 3, tz - 1, 2, B.LEAVES, 0.2);
        for (let y = h + 1; y < top; y++) put(tx, y, tz, B.LOG, true);
        break;
      }
      case 'swamp': case 'oak': default: {
        const top = h + t.th;
        const low = t.type === 'swamp' ? 3 : 2;
        for (let y = top - low; y <= top + 1; y++) {
          const rad = y >= top ? 1 : (t.type === 'swamp' && y === top - low ? 3 : 2);
          for (let dz = -rad; dz <= rad; dz++) for (let dx = -rad; dx <= rad; dx++) {
            const corner = Math.abs(dx) === rad && Math.abs(dz) === rad;
            if (corner && (y === top + 1 || hash2(wx + dx * 31, wz + dz * 17 + y, this.seed) < 0.5)) continue;
            put(tx + dx, y, tz + dz, B.LEAVES);
          }
        }
        for (let y = h + 1; y < top; y++) put(tx, y, tz, B.LOG, true);
      }
    }
    if (gi >= 0 && t.type !== 'cactus' && t.type !== 'bush') data[gi] = B.DIRT;
  }

  carveCaves(cx, cz, data, cols) {
    const S = CS * CS, SEA = this.sea;
    const x0 = cx * CS, z0 = cz * CS;
    // amostras de ruído 3D numa grade 4×4×4 com interpolação trilinear
    const GX = 5, GY = H / 4 + 1;
    const A = new Float32Array(GX * GX * GY), Bn = new Float32Array(GX * GX * GY), Cn = new Float32Array(GX * GX * GY);
    for (let gy = 0; gy < GY; gy++) for (let gz = 0; gz < GX; gz++) for (let gx = 0; gx < GX; gx++) {
      const wx = x0 + gx * 4, wy = gy * 4, wz = z0 + gz * 4;
      const i = gx + gz * GX + gy * GX * GX;
      A[i] = this.nCaveA.noise3(wx / 46, wy / 26, wz / 46);
      Bn[i] = this.nCaveB.noise3(wx / 46 + 31.7, wy / 26, wz / 46 + 17.3);
      Cn[i] = wy < SEA ? this.nCaveC.noise3(wx / 80, wy / 44, wz / 80) : -1;
    }
    const sample = (arr, x, y, z) => {
      const fx = x / 4, fy = y / 4, fz = z / 4;
      const ix = Math.min(GX - 2, fx | 0), iy = Math.min(GY - 2, fy | 0), iz = Math.min(GX - 2, fz | 0);
      const tx = fx - ix, ty = fy - iy, tz = fz - iz;
      const i = ix + iz * GX + iy * GX * GX, dz = GX, dy = GX * GX;
      const a = arr[i] + (arr[i + 1] - arr[i]) * tx, b = arr[i + dz] + (arr[i + dz + 1] - arr[i + dz]) * tx;
      const c = arr[i + dy] + (arr[i + dy + 1] - arr[i + dy]) * tx, d = arr[i + dy + dz] + (arr[i + dy + dz + 1] - arr[i + dy + dz]) * tx;
      return lerp(lerp(a, b, tz), lerp(c, d, tz), ty);
    };
    for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
      const col = x + z * CS;
      const { h } = cols[col];
      const wet = h < SEA + 1;
      const yMax = wet ? h - 5 : h;
      for (let y = 3; y <= yMax; y++) {
        const i = col + y * S;
        const id = data[i];
        if (id === B.WATER || id === B.AIR || id === B.BEDROCK) continue;
        const a = sample(A, x, y, z), b = sample(Bn, x, y, z);
        let carve = a * a + b * b < 0.0045 * (y > h - 6 ? 0.7 : 1);
        if (!carve && y < SEA - 6) carve = sample(Cn, x, y, z) > 0.58;
        if (!carve) continue;
        // não abre buracos sob a água nem derruba árvores pela raiz
        if (y >= h - 1 && data[col + (y + 1) * S] === B.WATER) continue;
        data[i] = y <= 10 ? B.LAVA : B.AIR;
      }
    }
  }

  placeOres(cx, cz, data) {
    const S = CS * CS;
    const ORES = [
      [B.COAL_ORE, 20, 5, 110, 9], [B.COPPER_ORE, 9, 16, 80, 8], [B.IRON_ORE, 12, 5, 64, 7],
      [B.GOLD_ORE, 3, 4, 32, 6], [B.DIAMOND_ORE, 2, 2, 16, 5], [B.CRYSTAL_ORE, 2, 2, 26, 4],
      [B.GRAVEL, 5, 5, 70, 14], [B.DIRT, 5, 5, 80, 14],
    ];
    for (let ncz = -1; ncz <= 1; ncz++) for (let ncx = -1; ncx <= 1; ncx++) {
      const ox = (ncx) * CS, oz = (ncz) * CS;
      for (let o = 0; o < ORES.length; o++) {
        const [id, count, y0, y1, size] = ORES[o];
        const rnd = mulberry32((Math.imul(cx + ncx, 73856093) ^ Math.imul(cz + ncz, 19349663) ^ Math.imul(o + 1, 83492791) ^ this.seed) | 0);
        for (let k = 0; k < count; k++) {
          let x = ox + rnd() * CS, y = y0 + rnd() * (y1 - y0), z = oz + rnd() * CS;
          for (let s = 0; s < size; s++) {
            const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
            if (ix >= 0 && iz >= 0 && ix < CS && iz < CS && iy > 0 && iy < H) {
              const i = ix + iz * CS + iy * S;
              if (data[i] === B.STONE) data[i] = id;
            }
            x += rnd() * 2 - 1; y += rnd() * 1.4 - 0.7; z += rnd() * 2 - 1;
          }
        }
      }
    }
  }

  // ---------------- estruturas: aldeias, ruínas e masmorras ----------------
  // Aldeias numa grade de regiões de 160 blocos; layout determinístico pela semente.
  villageAt(rx, rz) {
    const key = 'v' + rx + ',' + rz;
    if (this.colCache.has(key)) return this.colCache.get(key);
    let v = null;
    const VR = 160;
    if (this.gen >= 3 && hash2(rx, rz, this.seed + 500) < 0.4) {
      const cx = rx * VR + 40 + Math.floor(hash2(rx, rz, this.seed + 501) * 80);
      const cz = rz * VR + 40 + Math.floor(hash2(rz, rx, this.seed + 502) * 80);
      const c = this.column(cx, cz);
      const ok = [BIOME.PLAINS, BIOME.SAVANNA, BIOME.DESERT, BIOME.FOREST, BIOME.SNOWY].includes(c.biome) && c.h >= this.sea + 2 && c.h <= this.sea + 30;
      if (ok) v = this.layoutVillage(cx, cz, c.h, c.biome, rx, rz);
    }
    this.colCache.set(key, v);
    return v;
  }
  layoutVillage(cx, cz, cy, biome, rx, rz) {
    const rnd = mulberry32((Math.imul(rx, 92821) ^ Math.imul(rz, 68917) ^ this.seed ^ 0x5bd1e995) | 0);
    const desert = biome === BIOME.DESERT;
    const v = { x: cx, y: cy, z: cz, biome, desert, structs: [], roads: [], id: rx + ':' + rz };
    v.structs.push({ type: 'well', x: cx - 2, z: cz - 2, w: 4, d: 4, f: 0 });
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (let di = 0; di < 4; di++) {
      const [dx, dz] = dirs[di];
      const len = 14 + Math.floor(rnd() * 20);
      v.roads.push({ x0: cx, z0: cz, dx, dz, len });
      for (let d = 8; d < len; d += 10) {
        for (const side of [-1, 1]) {
          if (rnd() < 0.25) continue;
          const kind = rnd();
          const type = kind < 0.45 ? 'house' : kind < 0.65 ? 'bighouse' : kind < 0.85 ? 'farm' : 'lamp';
          const w = type === 'house' ? 5 : type === 'bighouse' ? 7 : type === 'farm' ? 7 : 1;
          const dd = type === 'farm' ? 9 : w;
          // posição ao lado da estrada, de frente para ela
          const px = cx + dx * d + (dz !== 0 ? side * (3 + (dx === 0 ? w : dd) / 2) : 0);
          const pz = cz + dz * d + (dx !== 0 ? side * (3 + (dz === 0 ? w : dd) / 2) : 0);
          // f: direção da frente (porta) → aponta para a estrada
          let f;
          if (dz !== 0) f = side > 0 ? 1 : 3; else f = side > 0 ? 2 : 0;
          const sw = (f === 1 || f === 3) ? dd : w, sd = (f === 1 || f === 3) ? w : dd;
          const sx = Math.round(px - sw / 2), sz = Math.round(pz - sd / 2);
          const g = this.column(sx + (sw >> 1), sz + (sd >> 1));
          if (g.h < this.sea + 1 || Math.abs(g.h - cy) > 6) continue;
          if (v.structs.some((s) => sx < s.x + s.w + 1 && sx + sw + 1 > s.x && sz < s.z + s.d + 1 && sz + sd + 1 > s.z)) continue;
          v.structs.push({ type, x: sx, z: sz, w: sw, d: sd, f, y: g.h });
        }
      }
    }
    for (const s of v.structs) if (s.y == null) s.y = this.column(s.x + (s.w >> 1), s.z + (s.d >> 1)).h;
    v.beds = [];
    for (const s of v.structs) if (s.type === 'house' || s.type === 'bighouse') v.beds.push({ x: s.x + (s.w >> 1), y: s.y + 1, z: s.z + (s.d >> 1) });
    return v;
  }
  villagesNear(x, z, r) {
    const VR = 160, out = [];
    for (let rz = Math.floor((z - r) / VR); rz <= Math.floor((z + r) / VR); rz++)
      for (let rx = Math.floor((x - r) / VR); rx <= Math.floor((x + r) / VR); rx++) {
        const v = this.villageAt(rx, rz);
        if (v) out.push(v);
      }
    return out;
  }
  ruinAt(rx, rz) {
    if (this.gen < 3 || hash2(rx, rz, this.seed + 700) > 0.3) return null;
    const x = rx * 96 + 16 + Math.floor(hash2(rx, rz, this.seed + 701) * 64);
    const z = rz * 96 + 16 + Math.floor(hash2(rz, rx, this.seed + 702) * 64);
    const c = this.column(x, z);
    if (c.h < this.sea + 1 || c.biome === BIOME.OCEAN) return null;
    return { x, z, y: c.h, kind: c.biome === BIOME.DESERT ? 'temple' : 'ruin' };
  }

  placeStructures(cx, cz, data, meta) {
    const x0 = cx * CS, z0 = cz * CS, S = CS * CS;
    const set = (wx, y, wz, id, m = 0) => {
      const lx = wx - x0, lz = wz - z0;
      if (lx < 0 || lz < 0 || lx >= CS || lz >= CS || y < 1 || y >= H) return;
      const i = lx + lz * CS + y * S;
      data[i] = id; meta[i] = m;
    };
    const get = (wx, y, wz) => {
      const lx = wx - x0, lz = wz - z0;
      if (lx < 0 || lz < 0 || lx >= CS || lz >= CS || y < 0 || y >= H) return -1;
      return data[lx + lz * CS + y * S];
    };
    // aldeias
    for (const v of this.villagesNear(x0 + 8, z0 + 8, 120)) {
      const minX = v.x - 50, maxX = v.x + 50;
      if (x0 + CS < minX - 10 || x0 > maxX + 10) continue;
      const wood = v.desert ? B.SANDSTONE : B.PLANKS, base = v.desert ? B.SANDSTONE : B.COBBLE;
      // estradas
      for (const r of v.roads) for (let d = 0; d <= r.len; d++) for (let w = -1; w <= 1; w++) {
        const wx = r.x0 + r.dx * d + (r.dz ? w : 0), wz = r.z0 + r.dz * d + (r.dx ? w : 0);
        if (wx < x0 || wz < z0 || wx >= x0 + CS || wz >= z0 + CS) continue;
        const h = this.column(wx, wz).h;
        const id = get(wx, h, wz);
        if (id === B.GRASS || id === B.DIRT || id === B.SAND || id === B.SNOW) set(wx, h, wz, v.desert ? B.SANDSTONE : B.PATH);
        else if (id === B.WATER) set(wx, h, wz, wood);
        if (get(wx, h + 1, wz) !== B.AIR && get(wx, h + 1, wz) !== -1) set(wx, h + 1, wz, B.AIR);
      }
      for (const s of v.structs) {
        if (s.x > x0 + CS || s.x + s.w < x0 || s.z > z0 + CS || s.z + s.d < z0) continue;
        this.buildStructure(s, set, get, wood, base, v);
      }
    }
    // ruínas / templos
    for (let rz = Math.floor((z0 - 16) / 96); rz <= Math.floor((z0 + 32) / 96); rz++)
      for (let rx = Math.floor((x0 - 16) / 96); rx <= Math.floor((x0 + 32) / 96); rx++) {
        const r = this.ruinAt(rx, rz);
        if (!r || r.x + 8 < x0 || r.x - 8 > x0 + CS || r.z + 8 < z0 || r.z - 8 > z0 + CS) continue;
        if (this.villagesNear(r.x, r.z, 60).length) continue;
        const wall = r.kind === 'temple' ? B.SANDSTONE : B.MOSSY_COBBLE;
        for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) {
          const edge = Math.abs(dx) === 3 || Math.abs(dz) === 3;
          set(r.x + dx, r.y, r.z + dz, r.kind === 'temple' ? B.SANDSTONE : B.STONE_BRICKS);
          for (let y = r.y + 1; y <= r.y + 4; y++) {
            if (edge) { if (hash3(r.x + dx, y, r.z + dz, this.seed) < 0.35 + (y - r.y) * 0.12) continue; set(r.x + dx, y, r.z + dz, (dx + dz + y) % 3 ? wall : B.STONE_BRICKS); }
            else set(r.x + dx, y, r.z + dz, B.AIR);
          }
        }
        set(r.x, r.y + 1, r.z, B.CHEST, 0x30);
        set(r.x + 2, r.y + 1, r.z - 2, B.TORCH);
      }
    // masmorra subterrânea (sala com baús)
    if (hash2(cx, cz, this.seed + 900) < 0.035) {
      const dy = 12 + Math.floor(hash2(cz, cx, this.seed + 901) * 22);
      const ox = x0 + 4, oz = z0 + 4;
      for (let y = dy; y <= dy + 5; y++) for (let dz = 0; dz < 8; dz++) for (let dx = 0; dx < 8; dx++) {
        const edge = dx === 0 || dz === 0 || dx === 7 || dz === 7 || y === dy || y === dy + 5;
        set(ox + dx, y, oz + dz, edge ? (hash3(ox + dx, y, oz + dz, this.seed) < 0.4 ? B.MOSSY_COBBLE : B.COBBLE) : B.AIR);
      }
      set(ox + 1, dy + 1, oz + 1, B.CHEST, 0x20);
      set(ox + 6, dy + 1, oz + 6, B.CHEST, 0x20 | 2);
      set(ox + 3, dy + 3, oz + 1, B.TORCH, 3);
    }
  }

  buildStructure(s, set, get, wood, base, v) {
    const { x, z, w, d, f } = s;
    const y = s.y;
    // fundação até o terreno + limpeza acima
    const foundation = (y0) => {
      for (let dz = 0; dz < d; dz++) for (let dx = 0; dx < w; dx++) {
        for (let yy = y0 - 1; yy > y0 - 8; yy--) { const id = get(x + dx, yy, z + dz); if (id === -1) break; if (id !== B.AIR && id !== B.WATER && id !== B.LEAVES) break; set(x + dx, yy, z + dz, base); }
        for (let yy = y0 + 1; yy < y0 + 9; yy++) set(x + dx, yy, z + dz, B.AIR);
      }
    };
    // coordenadas locais (u ao longo da largura, t da frente para o fundo) → mundo, conforme a orientação
    const L = (u, t) => {
      switch (f) {
        case 0: return [x + u, z + d - 1 - t];      // frente para +z
        case 2: return [x + w - 1 - u, z + t];      // frente para -z
        case 1: return [x + t, z + u];              // frente para -x
        default: return [x + w - 1 - t, z + d - 1 - u]; // frente para +x
      }
    };
    const W = (f === 1 || f === 3) ? d : w, D = (f === 1 || f === 3) ? w : d;
    const put = (u, yy, t, id, m = 0) => { const [wx, wz] = L(u, t); set(wx, yy, wz, id, m); };
    // facing para objetos que olham para frente/fundo
    const toFront = f, toBack = (f + 2) & 3;
    if (s.type === 'well') {
      foundation(y);
      for (let t = 0; t < 4; t++) for (let u = 0; u < 4; u++) {
        const edge = u === 0 || t === 0 || u === 3 || t === 3;
        put(u, y, t, edge ? base : B.WATER);
        put(u, y - 1, t, base);
        if (!edge) put(u, y - 1, t, B.WATER);
        if ((u === 0 || u === 3) && (t === 0 || t === 3)) { put(u, y + 1, t, B.FENCE); put(u, y + 2, t, B.FENCE); }
        put(u, y + 3, t, B.SLAB_COBBLE);
      }
      return;
    }
    if (s.type === 'lamp') {
      foundation(y);
      put(0, y + 1, 0, B.FENCE); put(0, y + 2, 0, B.FENCE); put(0, y + 3, 0, B.LAMP);
      return;
    }
    if (s.type === 'farm') {
      foundation(y);
      for (let t = 0; t < D; t++) for (let u = 0; u < W; u++) {
        const edge = u === 0 || t === 0 || u === W - 1 || t === D - 1;
        if (edge) { put(u, y, t, B.LOG); continue; }
        if (u === (W >> 1)) { put(u, y, t, B.WATER); continue; }
        put(u, y, t, B.FARMLAND);
        put(u, y + 1, t, B.WHEAT, Math.floor(hash3(u, t, x, this.seed) * 8));
      }
      return;
    }
    // casas
    const big = s.type === 'bighouse';
    foundation(y);
    const hgt = big ? 4 : 3;
    for (let t = 0; t < D; t++) for (let u = 0; u < W; u++) {
      put(u, y, t, base);
      const edge = u === 0 || t === 0 || u === W - 1 || t === D - 1;
      const corner = (u === 0 || u === W - 1) && (t === 0 || t === D - 1);
      for (let yy = y + 1; yy <= y + hgt; yy++) {
        if (!edge) { put(u, yy, t, B.AIR); continue; }
        let id = corner ? (v.desert ? B.SANDSTONE : B.LOG) : wood;
        if (!corner && yy === y + 2 && ((u === W >> 1 && t === D - 1) || (t === D >> 1 && (u === 0 || u === W - 1)))) id = B.GLASS_PANE;
        put(u, yy, t, id);
      }
      put(u, y + hgt + 1, t, edge ? (v.desert ? B.SANDSTONE : B.SLAB_PLANKS) : wood);
    }
    if (!v.desert) for (let t = 1; t < D - 1; t++) for (let u = 1; u < W - 1; u++) put(u, y + hgt + 1, t, B.PLANKS);
    // porta na frente (t = 0, centro)
    const du = W >> 1;
    put(du, y + 1, 0, B.DOOR, toBack);
    put(du, y + 2, 0, B.DOOR, toBack | 8);
    put(du, y, -1, base);
    // móveis
    put(1, y + 1, D - 2, B.BED, toFront);
    put(1, y + 1, D - 3, B.BED, toFront | 4);
    put(W - 2, y + 1, D - 2, B.CHEST, 0x10 | toFront);
    put(W - 2, y + 1, 1, B.CRAFTING_TABLE, toFront);
    put(du, y + hgt, 1, B.TORCH, 0);
    put(du, y + 2, D - 2, B.TORCH, 1 + ((toFront) & 3));
    if (big) {
      put(W - 2, y + 1, 2, B.FURNACE, ((toFront + 1) & 3));
      put(W - 2, y + 1, D - 3, B.BOOKSHELF);
      put(du, y + 1, D - 3, B.TABLE);
      put(du - 1, y + 1, D - 3, B.CHAIR, ((toFront + 3) & 3));
    }
  }

  // ponto de surgimento: terra firme perto da origem
  findSpawn() {
    for (let r = 0; r < 1200; r += 8) {
      for (let a = 0; a < 16; a++) {
        const x = Math.round(Math.cos(a * Math.PI / 8) * r), z = Math.round(Math.sin(a * Math.PI / 8) * r);
        const h = this.heightAt(x, z);
        const bm = this.biomeAt(x, z);
        if (h > this.sea + 1 && bm !== BIOME.OCEAN && bm !== BIOME.RIVER && bm !== BIOME.SNOWY_MOUNTAIN) return [x, h, z];
        if (r === 0) break;
      }
    }
    return [0, this.sea + 10, 0];
  }
}
