// Geração de malhas dos chunks com iluminação voxel (luz do céu + luz de blocos por flood fill),
// oclusão de ambiente suave e modelos de caixas para blocos não cúbicos. Sem THREE (buffers tipados).
import { CS, H } from './world.js';
import {
  B, BLOCKS, TRANSP, OCC, CUTOUT, LOPQ, LEXT, EMIT, ROT, SHAPED, LIQUID, FULL, shapeBoxes, cubeFaces,
} from './blocks.js';
import { TILE } from './tiles.js';
import { BIOME, BIOME_GRASS } from './worldgen.js';
import { hash2 } from './noise.js';

const S = CS * CS;
export const LP = 14, LW = CS + LP * 2, LA = LW * LW, LYS = H + 2;
export const VOL = new Uint8Array(LA * LYS), VOLM = new Uint8Array(LA * LYS);
export const SKYL = new Uint8Array(LA * LYS), BLKL = new Uint8Array(LA * LYS);
const QN = 1 << 19, QM = QN - 1, LQ = new Int32Array(QN);
export const vi = (x, y, z) => (x + LP) + (z + LP) * LW + (y + 1) * LA;
const DIR6 = [1, -1, LW, -LW, LA, -LA];

// ---------------- volume + luz ----------------
function fillVolume(world, cx, cz) {
  let top = 0, emit = 0;
  const nbs = [];
  for (let ncz = -1; ncz <= 1; ncz++) for (let ncx = -1; ncx <= 1; ncx++) {
    const ch = world.getChunk(cx + ncx, cz + ncz);
    nbs.push([ch, ncx, ncz]);
    if (ch.maxY > top) top = ch.maxY;
    emit += ch.emit;
  }
  // só copia até onde há blocos (+2 camadas de ar para luz e faces)
  const yLim = Math.min(H - 1, top + 2);
  for (const [ch, ncx, ncz] of nbs) {
    const data = ch.data, meta = ch.meta;
    const xa = Math.max(-LP, ncx * CS), xb = Math.min(CS + LP, ncx * CS + CS);
    const za = Math.max(-LP, ncz * CS), zb = Math.min(CS + LP, ncz * CS + CS);
    const n = xb - xa;
    for (let y = 0; y <= yLim; y++) for (let z = za; z < zb; z++) {
      const d = vi(xa, y, z), s = (xa - ncx * CS) + (z - ncz * CS) * CS + y * S;
      for (let k = 0; k < n; k++) { VOL[d + k] = data[s + k]; VOLM[d + k] = meta[s + k]; }
    }
  }
  VOL.fill(B.BEDROCK, 0, LA);
  VOL.fill(B.AIR, (yLim + 2) * LA, (H + 2) * LA);
  return { top, emit };
}
function bfs(L, qh, qt, yMaxIdx) {
  while (qh !== qt) {
    const i = LQ[qh]; qh = (qh + 1) & QM;
    const l = L[i];
    if (l <= 1) continue;
    const x = i % LW, z = ((i / LW) | 0) % LW, y = (i / LA) | 0;
    for (let d = 0; d < 6; d++) {
      if ((d === 0 && x === LW - 1) || (d === 1 && x === 0) || (d === 2 && z === LW - 1) || (d === 3 && z === 0) || (d === 4 && y >= yMaxIdx) || (d === 5 && y === 0)) continue;
      const n = i + DIR6[d];
      const id = VOL[n];
      if (LOPQ[id]) continue;
      const nl = l - 1 - LEXT[id];
      if (nl > L[n]) { L[n] = nl; LQ[qt] = n; qt = (qt + 1) & QM; }
    }
  }
}
function computeLight(top, emit) {
  const yTop = Math.min(H, top + 2);
  const yMaxIdx = yTop + 1;
  SKYL.fill(15, (yTop + 1) * LA);
  for (let z = 0; z < LW; z++) for (let x = 0; x < LW; x++) {
    let l = 15, i = x + z * LW + yMaxIdx * LA;
    for (let yi = yMaxIdx; yi >= 0; yi--, i -= LA) {
      const id = VOL[i];
      if (LOPQ[id]) l = 0; else if (l && LEXT[id]) l = Math.max(0, l - LEXT[id]);
      SKYL[i] = l;
    }
  }
  let qt = 0;
  for (let yi = 0; yi <= yMaxIdx; yi++) for (let z = 0; z < LW; z++) {
    let i = z * LW + yi * LA;
    for (let x = 0; x < LW; x++, i++) {
      const l = SKYL[i];
      if (l < 2) continue;
      let seed = false;
      if (x > 0 && !LOPQ[VOL[i - 1]] && SKYL[i - 1] < l - 1) seed = true;
      else if (x < LW - 1 && !LOPQ[VOL[i + 1]] && SKYL[i + 1] < l - 1) seed = true;
      else if (z > 0 && !LOPQ[VOL[i - LW]] && SKYL[i - LW] < l - 1) seed = true;
      else if (z < LW - 1 && !LOPQ[VOL[i + LW]] && SKYL[i + LW] < l - 1) seed = true;
      else if (yi > 0 && !LOPQ[VOL[i - LA]] && SKYL[i - LA] < l - 1) seed = true;
      if (seed) { LQ[qt] = i; qt = (qt + 1) & QM; }
    }
  }
  bfs(SKYL, 0, qt, yMaxIdx);
  BLKL.fill(0);
  if (emit > 0) {
    qt = 0;
    const end = (yMaxIdx + 1) * LA;
    for (let i = LA; i < end; i++) {
      const e = EMIT[VOL[i]];
      if (e) { BLKL[i] = e; LQ[qt] = i; qt = (qt + 1) & QM; }
    }
    bfs(BLKL, 0, qt, yMaxIdx);
  }
}

// ---------------- buffers ----------------
export class GeoBuf {
  constructor() { this.cap = 0; this.n = 0; this.ni = 0; this.grow(4096); }
  grow(cap) {
    const P = new Float32Array(cap * 3), N = new Int8Array(cap * 3), UV = new Float32Array(cap * 2), C = new Uint8Array(cap * 3), L = new Uint8Array(cap * 4), I = new Uint32Array(cap * 1.5);
    if (this.cap) { P.set(this.P); N.set(this.N); UV.set(this.UV); C.set(this.C); L.set(this.L); I.set(this.I); }
    Object.assign(this, { P, N, UV, C, L, I, cap });
  }
  reset() { this.n = 0; this.ni = 0; }
  get count() { return this.n; }
  vert(x, y, z, nx, ny, nz, u, v, r, g, b, l0, l1, l2, l3) {
    if (this.n >= this.cap) this.grow(this.cap * 2);
    const i = this.n++;
    this.P[i * 3] = x; this.P[i * 3 + 1] = y; this.P[i * 3 + 2] = z;
    this.N[i * 3] = nx; this.N[i * 3 + 1] = ny; this.N[i * 3 + 2] = nz;
    this.UV[i * 2] = u; this.UV[i * 2 + 1] = v;
    this.C[i * 3] = r; this.C[i * 3 + 1] = g; this.C[i * 3 + 2] = b;
    this.L[i * 4] = l0; this.L[i * 4 + 1] = l1; this.L[i * 4 + 2] = l2; this.L[i * 4 + 3] = l3;
  }
  quad(a, b, c, d, e, f) {
    const I = this.I; const k = this.ni;
    if (k + 6 > I.length) { const n = new Uint32Array(I.length * 2); n.set(I); this.I = n; }
    const J = this.I;
    J[k] = a; J[k + 1] = b; J[k + 2] = c; J[k + 3] = d; J[k + 4] = e; J[k + 5] = f;
    this.ni = k + 6;
  }
  // cópias compactas para enviar à GPU
  export() {
    if (!this.ni) return null;
    const n = this.n;
    return {
      position: this.P.slice(0, n * 3), normal: this.N.slice(0, n * 3), uv: this.UV.slice(0, n * 2),
      color: this.C.slice(0, n * 3), light: this.L.slice(0, n * 4),
      index: n > 65535 ? this.I.slice(0, this.ni) : Uint16Array.from(this.I.subarray(0, this.ni)),
    };
  }
}
const GB_OPQ = new GeoBuf(), GB_CUT = new GeoBuf(), GB_WAT = new GeoBuf();

// ---------------- meshing ----------------
const FACES = [
  { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0], tile: 1 },
  { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0], tile: 1 },
  { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1], tile: 0 },
  { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1], tile: 2 },
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0], tile: 1 },
  { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0], tile: 1 },
];
const CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
const AO_L = [0.42, 0.62, 0.8, 1.0], AO_L255 = AO_L.map((v) => Math.round(v * 255));
const voff = (v) => v[0] + v[2] * LW + v[1] * LA;
const FACE_OFF = FACES.map((f) => voff(f.n));
const AO_OFF = FACES.map((f) => CORNERS.map(([su, sv]) => {
  const a = [f.n[0] + su * f.u[0], f.n[1] + su * f.u[1], f.n[2] + su * f.u[2]];
  const b = [f.n[0] + sv * f.v[0], f.n[1] + sv * f.v[1], f.n[2] + sv * f.v[2]];
  const c = [f.n[0] + su * f.u[0] + sv * f.v[0], f.n[1] + su * f.u[1] + sv * f.v[1], f.n[2] + su * f.u[2] + sv * f.v[2]];
  return [voff(a), voff(b), voff(c)];
}));

const TINT = [1, 1, 1];
function tintFor(world, id, wx, wy, wz, biome) {
  const j = hash2(wx * 7 + wy, wz * 13 - wy, 77) - 0.5;
  const kind = BLOCKS[id] ? BLOCKS[id].tint : 'grass';
  if (kind === 'grass' || kind === 'leaves') {
    const bc = BIOME_GRASS[biome] || BIOME_GRASS[BIOME.PLAINS];
    const n = world.gen.n3.noise(wx / 52 + 0.37, wz / 52 + 0.61);
    const dry = Math.max(-0.5, Math.min(0.5, n * 1.4));
    const tree = kind === 'leaves' ? (hash2(wx >> 2, wz >> 2, 91) - 0.5) * 0.1 : 0;
    TINT[0] = Math.min(1, (0.9 + dry * 0.1 + j * 0.04 + tree) * bc[0]);
    TINT[1] = Math.min(1, (0.93 - Math.abs(dry) * 0.03 + j * 0.05 + tree * 0.5) * bc[1]);
    TINT[2] = Math.min(1, (0.88 - dry * 0.12 + j * 0.03) * bc[2]);
  } else {
    const k = 0.94 + j * 0.08;
    TINT[0] = TINT[1] = TINT[2] = k;
  }
}

function waterDepthAt(i, liq) {
  let d = 0;
  while (d < 15 && VOL[i] === liq) { d++; i -= LA; }
  return d;
}

// constrói as malhas do chunk c; retorna buffers { opaque, cutout, water } (ou null por camada)
export function meshChunk(world, c, ctx) {
  const { cx, cz } = c;
  const { top, emit } = fillVolume(world, cx, cz);
  computeLight(top, emit);
  const opq = GB_OPQ, cut = GB_CUT, wat = GB_WAT;
  opq.reset(); cut.reset(); wat.reset();
  const uvc = ctx.uv;
  const x0 = cx * CS, z0 = cz * CS;
  const vegD = ctx.veg || 0;
  const seed = world.seed;
  const yEnd = Math.min(H - 1, c.maxY);
  const lv = [0, 0, 0, 0], bv = [0, 0, 0, 0], aos = [3, 3, 3, 3];
  const nbIdx = { i: 0 };
  const nb = (dx, dy, dz) => { const j = nbIdx.i + dx + dz * LW + dy * LA; return [VOL[j], VOLM[j]]; };
  for (let y = 0; y <= yEnd; y++) for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
    const i = vi(x, y, z);
    const id = VOL[i];
    if (!id) continue;
    const wx = x0 + x, wz = z0 + z;
    const biome = c.biome[x + z * CS];
    if (LIQUID[id]) { meshLiquid(id === B.WATER ? wat : opq, i, x, y, z, id, uvc); continue; }
    const def = BLOCKS[id];
    if (!def) continue;
    if (SHAPED[id] && !(def.shape === 'piston' && !(VOLM[i] & 8))) {
      nbIdx.i = i;
      meshShape(cut, world, i, x, y, z, id, VOLM[i], nb, uvc, wx, wz, biome);
      continue;
    }
    const G = CUTOUT[id] ? cut : opq;
    let tinted = false;
    const emissive = EMIT[id] > 0;
    const oriented = def.front != null || def.facing6;
    const faces = oriented ? cubeFaces(id, VOLM[i]) : null;
    for (let f = 0; f < 6; f++) {
      const nid = VOL[i + FACE_OFF[f]];
      if (!TRANSP[nid] || (nid === id && !SHAPED[nid])) continue;
      if (!tinted) { tintFor(world, id, wx, y, wz, biome); tinted = true; }
      const F = FACES[f];
      const tile = faces ? faces[f] : def.t[F.tile];
      const t = uvc[tile];
      const ao = AO_OFF[f];
      const a = i + FACE_OFF[f];
      for (let k = 0; k < 4; k++) {
        const s1 = i + ao[k][0], s2 = i + ao[k][1], cc = i + ao[k][2];
        const o1 = OCC[VOL[s1]], o2 = OCC[VOL[s2]], o3 = OCC[VOL[cc]];
        aos[k] = (o1 && o2) ? 0 : 3 - (o1 + o2 + o3);
        let ls = SKYL[a], lb = BLKL[a], n = 1;
        const t1 = !LOPQ[VOL[s1]], t2 = !LOPQ[VOL[s2]];
        if (t1) { ls += SKYL[s1]; lb += BLKL[s1]; n++; }
        if (t2) { ls += SKYL[s2]; lb += BLKL[s2]; n++; }
        if ((t1 || t2) && !LOPQ[VOL[cc]]) { ls += SKYL[cc]; lb += BLKL[cc]; n++; }
        lv[k] = ls / n; bv[k] = lb / n;
      }
      const base = G.count;
      let rot = 0, mir = false;
      if (ROT[id]) {
        const r = hash2(wx * 3 + f, wz * 5 - y, y + 1013);
        if (f === 2 || f === 3) rot = (r * 4) | 0; else mir = r < 0.5;
      }
      const flags = (def.leaves ? 1 : 0) | (emissive ? 4 : 0) | (nid === B.WATER ? 8 : 0);
      const tintK = (def.tint === 'grass' && f !== 2) ? 0.5 : (def.tint ? 1 : 1);
      const cr = Math.round((1 - tintK + TINT[0] * tintK) * 255), cg = Math.round((1 - tintK + TINT[1] * tintK) * 255), cb = Math.round((1 - tintK + TINT[2] * tintK) * 255);
      for (let k = 0; k < 4; k++) {
        const su = CORNERS[k][0], sv = CORNERS[k][1];
        const kc = CORNERS[(k + rot) & 3];
        const cu = mir ? -kc[0] : kc[0], cv = kc[1];
        G.vert(x + 0.5 + 0.5 * (F.n[0] + su * F.u[0] + sv * F.v[0]), y + 0.5 + 0.5 * (F.n[1] + su * F.u[1] + sv * F.v[1]), z + 0.5 + 0.5 * (F.n[2] + su * F.u[2] + sv * F.v[2]),
          F.n[0] * 127, F.n[1] * 127, F.n[2] * 127, cu > 0 ? t[2] : t[0], cv > 0 ? t[1] : t[3], cr, cg, cb,
          AO_L255[aos[k]], Math.round(lv[k] * 17), emissive ? 255 : Math.round(bv[k] * 17), flags);
      }
      if (aos[0] + aos[2] < aos[1] + aos[3]) G.quad(base + 1, base + 2, base + 3, base + 1, base + 3, base);
      else G.quad(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    // vegetação decorativa sobre a grama
    if (id === B.GRASS && vegD > 0 && y + 1 < H && VOL[i + LA] === B.AIR && hash2(wx, wz, seed + 99) < vegD * (biome === BIOME.DESERT ? 0 : 1)) {
      const r = hash2(wz, wx, seed + 55);
      const tile = r < 0.07 ? TILE.FLOWER_RED : r < 0.14 ? TILE.FLOWER_YELLOW : TILE.TALLGRASS;
      tintFor(world, B.GRASS, wx, y, wz, biome);
      addCross(cut, uvc, x, y + 1, z, wx, wz, tile, SKYL[i + LA], BLKL[i + LA], tile === TILE.TALLGRASS, 0.7 + 0.3 * hash2(wx, wz, 11), true);
    }
  }
  return { opaque: opq.export(), cutout: cut.export(), water: wat.export() };
}

function addCross(G, uvc, x, y, z, wx, wz, tile, sky, blk, tinted, ht, offset, extraFlags = 0, hang = false) {
  const t = uvc[tile];
  const ox = offset ? (hash2(wx, wz, 11) - 0.5) * 0.3 : 0, oz = offset ? (hash2(wz, wx, 12) - 0.5) * 0.3 : 0;
  const planes = [[0.15, 0.15, 0.85, 0.85], [0.15, 0.85, 0.85, 0.15]];
  const cr = tinted ? Math.round(TINT[0] * 255) : 240, cg = tinted ? Math.round(TINT[1] * 255) : 240, cb = tinted ? Math.round(TINT[2] * 255) : 240;
  for (const [ax, az, bx, bz] of planes) for (let side = 0; side < 2; side++) {
    const base = G.count;
    // hang: pendurado no teto (estalactite, cipó) — desenhado de cima para baixo, sem balançar na base
    const y0 = hang ? 1 - ht : 0, y1 = hang ? 1 : ht;
    const P = [[ax, y0, az, 0, 1], [bx, y0, bz, 1, 1], [bx, y1, bz, 1, 0], [ax, y1, az, 0, 0]];
    for (const [px, py, pz, pu, pv0] of P) {
      const pv = hang ? 1 - pv0 : pv0;
      G.vert(x + px + ox, y + py, z + pz + oz, 0, 127, 0, pu ? t[2] : t[0], pv ? t[3] : t[1], cr, cg, cb, pv ? 200 : 255, sky * 17, blk * 17, ((hang ? pv0 : pv) ? 0 : 2) | extraFlags);
    }
    if (side) G.quad(base, base + 2, base + 1, base, base + 3, base + 2);
    else G.quad(base, base + 1, base + 2, base, base + 2, base + 3);
  }
}

// face de uma caixa (coordenadas em 1/16) com UV recortado do tile
const BOX_FACES = [
  // normal, 4 vértices (como [x,y,z] seletores min/max), eixos de UV
  { n: [1, 0, 0], v: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], u: 'z', uFlip: true },
  { n: [-1, 0, 0], v: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], u: 'z' },
  { n: [0, 1, 0], v: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], u: 'x', top: true },
  { n: [0, -1, 0], v: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], u: 'x', top: true },
  { n: [0, 0, 1], v: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], u: 'x' },
  { n: [0, 0, -1], v: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], u: 'x', uFlip: true },
];

function meshShape(G, world, i, x, y, z, id, meta, nb, uvc, wx, wz, biome) {
  const def = BLOCKS[id];
  const sky = SKYL[i], blk = BLKL[i];
  // luz própria (modelos são transparentes à luz); usa a vizinhança mais clara para não ficar escuro
  let ls = sky, lb = blk;
  for (let d = 0; d < 6; d++) { const j = i + DIR6[d]; if (!LOPQ[VOL[j]]) { if (SKYL[j] > ls) ls = SKYL[j]; if (BLKL[j] > lb) lb = BLKL[j]; } }
  if (def.shape === 'cross') {
    const em = EMIT[id] > 0;
    // estalactites (meta 1) e cipós ficam pendurados
    const hang = (id === B.DRIPSTONE && meta === 1) || id === B.VINE;
    addCross(G, uvc, x, y, z, wx, wz, def.t[0], ls, em ? 15 : lb, !!def.tint, id === B.VINE ? 1 : 0.9, false, em ? 4 : 0, hang);
    return;
  }
  if (def.shape === 'crop') { addCross(G, uvc, x, y, z, wx, wz, TILE.WHEAT0 + Math.min(3, meta >> 1), ls, lb, false, 0.95, false); return; }
  if (def.shape === 'rail') { meshRail(G, uvc, x, y, z, meta, ls, lb); return; }
  const boxes = shapeBoxes(id, meta, nb);
  if (!boxes) return;
  const emissive = EMIT[id] > 0;
  let cr = 255, cg = 255, cb = 255;
  if (id === B.WIRE) { const p = meta & 15; cr = Math.round(110 + p * 9.6); cg = cb = Math.round(20 + p * 2); }
  const flags = emissive && id === B.TORCH ? 4 : 0;
  const faces = def.facing6 ? cubeFaces(id, meta) : null;
  for (const b of boxes) {
    const bx0 = b[0] / 16, by0 = b[1] / 16, bz0 = b[2] / 16, bx1 = b[3] / 16, by1 = b[4] / 16, bz1 = b[5] / 16;
    for (let f = 0; f < 6; f++) {
      const BF = BOX_FACES[f];
      // face na fronteira do bloco encostada em bloco opaco: oculta
      const onEdge = (f === 0 && b[3] >= 16) || (f === 1 && b[0] <= 0) || (f === 2 && b[4] >= 16) || (f === 3 && b[1] <= 0) || (f === 4 && b[5] >= 16) || (f === 5 && b[2] <= 0);
      if (onEdge && OCC[VOL[i + FACE_OFF[f]]] && FULL[VOL[i + FACE_OFF[f]]]) continue;
      const tile = b.length > 6 ? b[6] : faces ? faces[f] : def.t[FACES[f].tile];
      const t = uvc[tile];
      const du = t[2] - t[0], dv = t[3] - t[1];
      const base = G.count;
      for (const sel of BF.v) {
        const px = sel[0] ? bx1 : bx0, py = sel[1] ? by1 : by0, pz = sel[2] ? bz1 : bz0;
        let uu, vv;
        if (BF.top) { uu = px; vv = pz; }
        else { uu = BF.u === 'z' ? pz : px; vv = 1 - py; }
        if (BF.uFlip) uu = 1 - uu;
        uu = Math.max(0, Math.min(1, uu)); vv = Math.max(0, Math.min(1, vv));
        G.vert(x + px, y + py, z + pz, BF.n[0] * 127, BF.n[1] * 127, BF.n[2] * 127, t[0] + uu * du, t[1] + vv * dv, cr, cg, cb,
          f === 3 ? 200 : 255, ls * 17, emissive ? 255 : lb * 17, flags);
      }
      G.quad(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
}

function meshRail(G, uvc, x, y, z, meta, sky, blk) {
  const shape = meta & 7;
  const t = uvc[shape >= 2 ? TILE.RAIL_CURVE : TILE.RAIL];
  // rotação do UV: reto N-S = 0, L-O = 1; curvas 2..5 = rotações 0..3
  const rot = shape >= 2 ? shape - 2 : shape;
  const uvs = [[t[0], t[3]], [t[2], t[3]], [t[2], t[1]], [t[0], t[1]]];
  const P = [[0, 1], [1, 1], [1, 0], [0, 0]];
  const base = G.count;
  for (let k = 0; k < 4; k++) {
    const uv = uvs[(k + rot) & 3];
    G.vert(x + P[k][0], y + 0.06, z + P[k][1], 0, 127, 0, uv[0], uv[1], 255, 255, 255, 255, sky * 17, blk * 17, 0);
  }
  G.quad(base, base + 1, base + 2, base, base + 2, base + 3);
}

// altura da superfície de um líquido: fonte 0,88; corrente perde altura com o nível (1..7);
// com o mesmo líquido em cima (ou caindo) fica cheio
function liqHeight(i, liq) {
  if (VOL[i] !== liq) return -1;
  if (VOL[i + LA] === liq) return 1;
  const m = VOLM[i], lvl = m & 7;
  if (m & 8 || lvl === 0) return 0.88;
  return Math.max(0.12, 0.88 * (8 - lvl) / 8);
}
// altura num canto do bloco: média das (até 4) colunas de líquido que compartilham o canto
function cornerHeight(i, dx, dz, liq) {
  let s = 0, n = 0, full = false;
  for (const o of [0, dx, dz, dx + dz]) { const h = liqHeight(i + o, liq); if (h >= 1) full = true; if (h >= 0) { s += h; n++; } }
  return full ? 1 : n ? s / n : 0.88;
}
function meshLiquid(G, i, x, y, z, liq, uvc) {
  const lowered = VOL[i + LA] !== liq;
  const lava = liq === B.LAVA;
  for (let f = 0; f < 6; f++) {
    const nid = VOL[i + FACE_OFF[f]];
    if (nid === liq || !TRANSP[nid]) continue;
    if (lava && nid === B.WATER) continue;
    const F = FACES[f];
    const base = G.count;
    const a = i + FACE_OFF[f];
    const sky = Math.max(SKYL[a], SKYL[i]), blk = Math.max(BLKL[a], BLKL[i]);
    for (let k = 0; k < 4; k++) {
      const su = CORNERS[k][0], sv = CORNERS[k][1];
      const vx = x + 0.5 + 0.5 * (F.n[0] + su * F.u[0] + sv * F.v[0]);
      let vy = y + 0.5 + 0.5 * (F.n[1] + su * F.u[1] + sv * F.v[1]);
      const vz = z + 0.5 + 0.5 * (F.n[2] + su * F.u[2] + sv * F.v[2]);
      let top = false;
      if (lowered && vy === y + 1) {
        const cdx = vx > x + 0.5 ? 1 : -1, cdz = vz > z + 0.5 ? LW : -LW;
        vy = y + cornerHeight(i, cdx, cdz, liq); top = true;
      }
      if (lava) {
        // lava: malha opaca emissiva (usa o tile do atlas)
        const t = uvc[TILE.LAVA];
        G.vert(vx, vy, vz, F.n[0] * 127, F.n[1] * 127, F.n[2] * 127, su > 0 ? t[2] : t[0], sv > 0 ? t[1] : t[3], 255, 255, 255, 255, 255, 255, 4);
        continue;
      }
      let depth;
      if (f === 2) {
        const dx = vx > x + 0.5 ? 1 : -1, dz = vz > z + 0.5 ? LW : -LW;
        depth = (waterDepthAt(i, liq) + waterDepthAt(i + dx, liq) + waterDepthAt(i + dz, liq) + waterDepthAt(i + dx + dz, liq)) / 4;
      } else depth = waterDepthAt(i, liq);
      G.vert(vx, vy, vz, F.n[0] * 127, F.n[1] * 127, F.n[2] * 127, 0, 0, 255, 255, 255, Math.round(depth * 17), sky * 17, blk * 17, top ? 16 : 0);
    }
    G.quad(base, base + 1, base + 2, base, base + 2, base + 3);
  }
}

