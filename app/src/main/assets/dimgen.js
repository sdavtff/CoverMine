// Geradores das outras dimensões (sem THREE/DOM: rodam no Web Worker e no thread principal).
// Nether: cavernas enormes de netherrack sobre um mar de lava, pedra luminosa no teto e fortalezas de tijolo
// do Nether (onde aparecem os blazes). End: ilha de pedra do End flutuando no vazio, com pilares de obsidiana
// (os cristais ficam no topo) e a base do portal de saída no centro.
import { Perlin, hash2, hash3 } from './noise.js';
import { B } from './blocks.js';
import { CS, H, BIOME } from './worldgen.js';

const S = CS * CS;
export const GEN_NETHER = 101, GEN_END = 102;
export const NETHER_LAVA = 31;
const FORT_REGION = 160;

// ---------------- Nether ----------------
export class NetherGen {
  constructor(seed) {
    this.seed = seed | 0;
    this.gen = GEN_NETHER;
    this.dim = 'nether';
    this.sea = NETHER_LAVA;
    this.n1 = new Perlin(seed + 3001);
    this.n2 = new Perlin(seed + 3002);
    this.n3 = new Perlin(seed + 3003); // usado pelo mesher (variação de plantas)
    this.n4 = new Perlin(seed + 3004);
  }
  biomeAt() { return BIOME.NETHER; }
  heightAt() { return 64; }
  villagesNear() { return []; }
  // fortaleza da região (uma por região de 160×160 blocos): centro e altura do piso
  fortressAt(rx, rz) {
    const h = (k) => hash2(rx, rz, this.seed + 7100 + k);
    return { x: rx * FORT_REGION + 40 + Math.floor(h(1) * (FORT_REGION - 80)), z: rz * FORT_REGION + 40 + Math.floor(h(2) * (FORT_REGION - 80)), y: 52 + Math.floor(h(3) * 18), len: 34 + Math.floor(h(4) * 14) };
  }
  fortressNear(x, z) {
    const rx = Math.floor(x / FORT_REGION), rz = Math.floor(z / FORT_REGION);
    let best = null, bd = 1e9;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const f = this.fortressAt(rx + dx, rz + dz);
      const d = Math.hypot(f.x - x, f.z - z);
      if (d < bd) { bd = d; best = f; }
    }
    return best;
  }
  // está dentro de uma fortaleza? (para o surgimento de blazes)
  inFortress(x, y, z) {
    const f = this.fortressNear(x, z);
    if (!f || Math.abs(y - f.y) > 8) return false;
    return (Math.abs(x - f.x) <= f.len && Math.abs(z - f.z) <= 4) || (Math.abs(z - f.z) <= f.len && Math.abs(x - f.x) <= 4) || (Math.abs(x - f.x) <= 8 && Math.abs(z - f.z) <= 8);
  }
  generate(cx, cz) {
    const data = new Uint8Array(S * H), meta = new Uint8Array(S * H), biome = new Uint8Array(S).fill(BIOME.NETHER);
    const x0 = cx * CS, z0 = cz * CS;
    // densidade 3D numa grade 4×4×4 com interpolação trilinear
    const GX = 5, GY = H / 4 + 1, D = new Float32Array(GX * GX * GY);
    for (let gy = 0; gy < GY; gy++) for (let gz = 0; gz < GX; gz++) for (let gx = 0; gx < GX; gx++) {
      const wx = x0 + gx * 4, wy = gy * 4, wz = z0 + gz * 4;
      const n = this.n1.noise3(wx / 56, wy / 34, wz / 56) * 0.75 + this.n2.noise3(wx / 22, wy / 18, wz / 22) * 0.3;
      // piso e teto sólidos, meio aberto
      const t = (wy - 62) / 60;
      D[gx + gz * GX + gy * GX * GX] = n + Math.pow(Math.abs(t), 4) * 2.2 - 0.3;
    }
    const sample = (x, y, z) => {
      const fx = x / 4, fy = y / 4, fz = z / 4;
      const ix = Math.min(GX - 2, fx | 0), iy = Math.min(GY - 2, fy | 0), iz = Math.min(GX - 2, fz | 0);
      const tx = fx - ix, ty = fy - iy, tz = fz - iz;
      const i = ix + iz * GX + iy * GX * GX, dz = GX, dy = GX * GX;
      const L = (a, b, t) => a + (b - a) * t;
      const a = L(D[i], D[i + 1], tx), b = L(D[i + dz], D[i + dz + 1], tx), c = L(D[i + dy], D[i + dy + 1], tx), d = L(D[i + dy + dz], D[i + dy + dz + 1], tx);
      return L(L(a, b, tz), L(c, d, tz), ty);
    };
    for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
      const col = x + z * CS, wx = x0 + x, wz = z0 + z;
      const soul = this.n4.noise(wx / 24, wz / 24) > 0.22;
      for (let y = 0; y < H; y++) {
        const i = col + y * S;
        if (y === 0 || y === H - 1 || (y < 4 && hash3(wx, y, wz, this.seed) < 0.6 - y * 0.15) || (y > H - 5 && hash3(wx, y, wz, this.seed + 1) < 0.6 - (H - 1 - y) * 0.15)) { data[i] = B.BEDROCK; continue; }
        if (sample(x, y, z) > 0) {
          data[i] = B.NETHERRACK;
          if (hash3(wx, y, wz, this.seed + 33) < 0.012) data[i] = B.QUARTZ_ORE;
        } else data[i] = y <= NETHER_LAVA ? B.LAVA : B.AIR;
      }
      // superfície: areia das almas no chão; pedra luminosa pendurada no teto
      for (let y = NETHER_LAVA + 1; y < H - 6; y++) {
        const i = col + y * S;
        if (data[i] === B.NETHERRACK && data[i + S] === B.AIR) {
          if (soul) { data[i] = B.SOUL_SAND; if (data[i - S] === B.NETHERRACK) data[i - S] = B.SOUL_SAND; }
        }
        if (data[i] === B.AIR && data[i + S] === B.NETHERRACK && y > 70 && hash2(wx >> 2, wz >> 2, this.seed + y) < 0.035) {
          const n = 1 + Math.floor(hash3(wx, y, wz, this.seed + 9) * 3);
          for (let k = 0; k < n && data[i - k * S] === B.AIR; k++) data[i - k * S] = B.GLOWSTONE;
        }
      }
    }
    this.placeFortress(cx, cz, data);
    return { data, meta, biome };
  }
  // fortaleza: dois corredores cruzados de tijolo do Nether (piso, paredes com janelas e teto) e um salão no centro
  placeFortress(cx, cz, data) {
    const x0 = cx * CS, z0 = cz * CS;
    const f = this.fortressNear(x0 + 8, z0 + 8);
    if (!f) return;
    const set = (x, y, z, id) => {
      const lx = x - x0, lz = z - z0;
      if (lx < 0 || lz < 0 || lx >= CS || lz >= CS || y < 1 || y >= H - 1) return;
      data[lx + lz * CS + y * S] = id;
    };
    const fy = f.y;
    for (let z = z0; z < z0 + CS; z++) for (let x = x0; x < x0 + CS; x++) {
      const dx = x - f.x, dz = z - f.z;
      const hall = Math.abs(dx) <= 8 && Math.abs(dz) <= 8;
      const cx1 = Math.abs(dx) <= f.len && Math.abs(dz) <= 3; // corredor leste-oeste
      const cz1 = Math.abs(dz) <= f.len && Math.abs(dx) <= 3; // corredor norte-sul
      if (!hall && !cx1 && !cz1) continue;
      const wall = hall ? (Math.abs(dx) === 8 || Math.abs(dz) === 8) && !(Math.abs(dx) <= 2 || Math.abs(dz) <= 2)
        : cx1 && !cz1 ? Math.abs(dz) === 3 : cz1 && !cx1 ? Math.abs(dx) === 3 : false;
      const top = hall ? 7 : 4;
      set(x, fy, z, B.NETHER_BRICK);
      for (let y = 1; y < top; y++) {
        const window = !hall && y === 2 && ((cx1 ? dx : dz) % 4 === 0);
        set(x, fy + y, z, wall && !window ? B.NETHER_BRICK : B.AIR);
      }
      set(x, fy + top, z, B.NETHER_BRICK);
      // pilares até a lava a cada 8 blocos nas bordas
      const edge = hall ? (Math.abs(dx) === 8 && Math.abs(dz) === 8) : (cx1 ? Math.abs(dz) === 3 && dx % 8 === 0 : Math.abs(dx) === 3 && dz % 8 === 0);
      if (edge) for (let y = fy - 1; y > NETHER_LAVA - 4; y--) set(x, y, z, B.NETHER_BRICK);
      // pedra luminosa no teto do salão
      if (hall && Math.abs(dx) % 4 === 0 && Math.abs(dz) % 4 === 0 && Math.abs(dx) < 8 && Math.abs(dz) < 8) set(x, fy + top - 1, z, B.GLOWSTONE);
    }
  }
  findSpawn() { return [0, 70, 0]; }
}

// ---------------- End ----------------
export const END_PILLARS = 10, END_ISLAND_Y = 60;
export function endPillars(seed) {
  const out = [];
  for (let i = 0; i < END_PILLARS; i++) {
    const a = i / END_PILLARS * Math.PI * 2;
    const r = 3 + Math.floor(hash2(i, 1, seed + 8800) * 3);
    out.push({ x: Math.round(Math.cos(a) * 42), z: Math.round(Math.sin(a) * 42), r, top: 76 + Math.floor(hash2(i, 2, seed + 8800) * 8) * 3, caged: i % 4 === 1 });
  }
  return out;
}
export class EndGen {
  constructor(seed) {
    this.seed = seed | 0;
    this.gen = GEN_END;
    this.dim = 'end';
    this.sea = 0;
    this.n1 = new Perlin(seed + 4001);
    this.n3 = new Perlin(seed + 4003);
    this.pillars = endPillars(this.seed);
  }
  biomeAt() { return BIOME.END; }
  heightAt() { return END_ISLAND_Y; }
  villagesNear() { return []; }
  islandTop(x, z) {
    const r = Math.hypot(x, z), a = Math.atan2(z, x);
    const R = 66 + this.n1.noise(Math.cos(a) * 2 + 7, Math.sin(a) * 2 + 7) * 14;
    if (r > R) return null;
    const k = r / R;
    return { top: Math.round(END_ISLAND_Y - k * k * 7 + this.n1.noise(x / 18, z / 18) * 2), bottom: Math.round(END_ISLAND_Y - 4 - (1 - k * k) * 30) };
  }
  generate(cx, cz) {
    const data = new Uint8Array(S * H), meta = new Uint8Array(S * H), biome = new Uint8Array(S).fill(BIOME.END);
    const x0 = cx * CS, z0 = cz * CS;
    for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
      const wx = x0 + x, wz = z0 + z, col = x + z * CS;
      const t = this.islandTop(wx, wz);
      if (t) for (let y = Math.max(1, t.bottom); y <= t.top; y++) data[col + y * S] = B.END_STONE;
      // pilares de obsidiana (o cristal fica sobre a rocha-mãe do topo)
      for (const p of this.pillars) {
        const d2 = (wx - p.x) ** 2 + (wz - p.z) ** 2;
        if (d2 > p.r * p.r + p.r) continue;
        for (let y = END_ISLAND_Y - 12; y <= p.top; y++) data[col + y * S] = B.OBSIDIAN;
        if (wx === p.x && wz === p.z) data[col + (p.top + 1) * S] = B.BEDROCK;
      }
      // base do portal de saída: bacia de rocha-mãe com coluna central
      const r = Math.hypot(wx, wz);
      if (r <= 3.6) {
        const y0 = END_ISLAND_Y;
        if (r <= 0.5) for (let y = y0; y <= y0 + 4; y++) data[col + y * S] = B.BEDROCK;
        else if (r <= 2.6) { data[col + y0 * S] = B.BEDROCK; data[col + (y0 + 1) * S] = B.AIR; }
        else { data[col + y0 * S] = B.BEDROCK; data[col + (y0 + 1) * S] = B.BEDROCK; }
        for (let y = y0 + 2; y < y0 + 8; y++) if (r > 0.5) data[col + y * S] = B.AIR;
      }
    }
    return { data, meta, biome };
  }
  findSpawn() { return [100, 50, 0]; }
}

export function makeDimGen(seed, gen) {
  if (gen === GEN_NETHER) return new NetherGen(seed);
  if (gen === GEN_END) return new EndGen(seed);
  return null;
}
