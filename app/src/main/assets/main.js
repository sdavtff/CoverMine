import * as THREE from './lib/three.module.min.js';

THREE.ColorManagement.enabled = false;

// ---------------- constants & blocks ----------------
const CS = 16, H = 64, SEA = 22;
const B = { AIR: 0, GRASS: 1, DIRT: 2, STONE: 3, LOG: 4, LEAVES: 5, SAND: 6, WATER: 7, PLANKS: 8, BRICK: 9, GLASS: 10, COBBLE: 11, SNOW: 12, BEDROCK: 13 };
const BLOCKS = [
  null,
  { name: 'Grama', t: [0, 1, 2] },
  { name: 'Terra', t: [2, 2, 2] },
  { name: 'Pedra', t: [3, 3, 3] },
  { name: 'Tronco', t: [5, 4, 5] },
  { name: 'Folhas', t: [6, 6, 6] },
  { name: 'Areia', t: [7, 7, 7] },
  { name: 'Água', t: [8, 8, 8] },
  { name: 'Tábuas', t: [9, 9, 9] },
  { name: 'Tijolos', t: [10, 10, 10] },
  { name: 'Vidro', t: [11, 11, 11] },
  { name: 'Pedregulho', t: [12, 12, 12] },
  { name: 'Neve', t: [13, 14, 2] },
  { name: 'Rocha-mãe', t: [15, 15, 15] },
];
const TRANSP = new Uint8Array(32), OCC = new Uint8Array(32), SOLID = new Uint8Array(32);
for (let i = 0; i < BLOCKS.length; i++) {
  TRANSP[i] = (i === B.AIR || i === B.WATER || i === B.LEAVES || i === B.GLASS) ? 1 : 0;
  OCC[i] = (i !== B.AIR && i !== B.WATER && i !== B.GLASS) ? 1 : 0;
  SOLID[i] = (i !== B.AIR && i !== B.WATER) ? 1 : 0;
}
const HOTBAR = [B.GRASS, B.DIRT, B.STONE, B.COBBLE, B.PLANKS, B.LOG, B.LEAVES, B.SAND, B.GLASS, B.BRICK, B.SNOW, B.WATER];

// ---------------- random & noise ----------------
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function hash2(x, z, s) {
  let h = Math.imul(x, 374761393) + Math.imul(z, 668265263) + Math.imul(s, 982451653) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
class Perlin {
  constructor(seed) {
    const r = mulberry32(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
    this.perm = new Uint8Array(512);
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }
  noise(x, y) {
    let X = Math.floor(x), Y = Math.floor(y);
    x -= X; y -= Y; X &= 255; Y &= 255;
    const u = x * x * x * (x * (x * 6 - 15) + 10), v = y * y * y * (y * (y * 6 - 15) + 10);
    const p = this.perm;
    const g = (h, x, y) => {
      switch (h & 7) {
        case 0: return x + y; case 1: return -x + y; case 2: return x - y; case 3: return -x - y;
        case 4: return x; case 5: return -x; case 6: return y; default: return -y;
      }
    };
    const aa = p[p[X] + Y], ab = p[p[X] + Y + 1], ba = p[p[X + 1] + Y], bb = p[p[X + 1] + Y + 1];
    const l1 = g(aa, x, y) + u * (g(ba, x - 1, y) - g(aa, x, y));
    const l2 = g(ab, x, y - 1) + u * (g(bb, x - 1, y - 1) - g(ab, x, y - 1));
    return l1 + v * (l2 - l1);
  }
  fbm(x, y, oct) {
    let s = 0, a = 1, f = 1, n = 0;
    for (let i = 0; i < oct; i++) { s += this.noise(x * f, y * f) * a; n += a; a *= 0.5; f *= 2; }
    return s / n;
  }
}

// ---------------- texture atlas ----------------
const tileAvg = [];
function makeAtlas() {
  const T = 16, N = 4, W = T * N;
  const cv = document.createElement('canvas');
  cv.width = cv.height = W;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(W, W);
  const d = img.data;
  const rnd = mulberry32(1234);
  const put = (tile, x, y, c, a = 255) => {
    const px = (tile % N) * T + x, py = Math.floor(tile / N) * T + y;
    const i = (py * W + px) * 4;
    d[i] = Math.max(0, Math.min(255, c[0])); d[i + 1] = Math.max(0, Math.min(255, c[1])); d[i + 2] = Math.max(0, Math.min(255, c[2])); d[i + 3] = a;
  };
  const sh = (c, f) => [c[0] * f, c[1] * f, c[2] * f];
  const each = (tile, fn) => { for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) fn(x, y); };
  const GRASS = [96, 160, 56], DIRT = [134, 96, 67], STONE = [128, 128, 128];
  each(0, (x, y) => put(0, x, y, sh(GRASS, 0.82 + 0.3 * rnd())));
  each(2, (x, y) => put(2, x, y, sh(DIRT, rnd() < 0.08 ? 0.65 : 0.82 + 0.3 * rnd())));
  for (const [tile, top] of [[1, GRASS], [14, [238, 244, 250]]]) {
    const depth = []; for (let x = 0; x < T; x++) depth[x] = 3 + (rnd() < 0.5 ? 1 : 0) + (rnd() < 0.3 ? 1 : 0);
    each(tile, (x, y) => put(tile, x, y, y < depth[x] ? sh(top, 0.85 + 0.2 * rnd()) : sh(DIRT, rnd() < 0.08 ? 0.65 : 0.82 + 0.3 * rnd())));
  }
  each(3, (x, y) => put(3, x, y, sh(STONE, rnd() < 0.1 ? 0.7 : 0.85 + 0.25 * rnd())));
  each(4, (x, y) => put(4, x, y, sh([104, 82, 50], (x % 4 === 0 ? 0.72 : 1) * (0.8 + 0.3 * rnd()))));
  each(5, (x, y) => {
    const dd = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
    if (dd > 6.5) put(5, x, y, sh([104, 82, 50], 0.8 + 0.3 * rnd()));
    else put(5, x, y, sh([176, 140, 86], (Math.floor(dd) % 2 ? 0.85 : 1) * (0.92 + 0.12 * rnd())));
  });
  each(6, (x, y) => { const r = rnd(); put(6, x, y, sh([58, 128, 38], 0.7 + 0.45 * rnd()), r < 0.16 ? 0 : 255); });
  each(7, (x, y) => put(7, x, y, sh([220, 208, 160], 0.9 + 0.14 * rnd())));
  each(8, (x, y) => put(8, x, y, sh([46, 98, 210], 0.85 + 0.18 * rnd())));
  each(9, (x, y) => {
    const row = Math.floor(y / 4);
    const seam = (row * 7 + 3) % 16;
    const dark = y % 4 === 3 || x === seam;
    put(9, x, y, sh([164, 130, 80], dark ? 0.62 : 0.86 + 0.18 * rnd()));
  });
  each(10, (x, y) => {
    const row = Math.floor(y / 4), off = row % 2 ? 4 : 0;
    const mortar = y % 4 === 3 || (x + off) % 8 === 7;
    put(10, x, y, mortar ? sh([190, 186, 176], 0.9 + 0.1 * rnd()) : sh([156, 68, 52], 0.85 + 0.25 * rnd()));
  });
  each(11, (x, y) => {
    const edge = x === 0 || y === 0 || x === 15 || y === 15;
    const glint = (x - y === 3 || x - y === 4) && x > 3 && x < 10;
    if (edge) put(11, x, y, [210, 235, 245]); else if (glint) put(11, x, y, [235, 250, 255], 200); else put(11, x, y, [200, 230, 240], 0);
  });
  {
    const pts = []; for (let i = 0; i < 10; i++) pts.push([rnd() * 16, rnd() * 16, 0.75 + 0.35 * rnd()]);
    each(12, (x, y) => {
      let d1 = 1e9, d2 = 1e9, c = 1;
      for (const p of pts) for (let ox = -16; ox <= 16; ox += 16) for (let oy = -16; oy <= 16; oy += 16) {
        const dd = Math.hypot(x + 0.5 - p[0] - ox, y + 0.5 - p[1] - oy);
        if (dd < d1) { d2 = d1; d1 = dd; c = p[2]; } else if (dd < d2) d2 = dd;
      }
      put(12, x, y, sh(STONE, d2 - d1 < 1.1 ? 0.5 : c * (0.92 + 0.12 * rnd())));
    });
  }
  each(13, (x, y) => put(13, x, y, sh([240, 245, 252], 0.94 + 0.06 * rnd())));
  each(15, (x, y) => put(15, x, y, sh([110, 110, 110], rnd() < 0.5 ? 0.4 : 0.8 + 0.3 * rnd())));
  ctx.putImageData(img, 0, 0);
  for (let t = 0; t < 16; t++) {
    let r = 0, g = 0, b = 0, n = 0;
    each(t, (x, y) => { const i = (((Math.floor(t / N) * T + y) * W) + (t % N) * T + x) * 4; if (d[i + 3] > 0) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; } });
    tileAvg[t] = n ? [r / n / 255, g / n / 255, b / n / 255] : [1, 1, 1];
  }
  return cv;
}
const atlasCanvas = makeAtlas();

function makeIcon(id, size = 48) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const t = BLOCKS[id].t, k = size / 48;
  const tile = (i) => [(i % 4) * 16, Math.floor(i / 4) * 16];
  const face = (ti, m, shade) => {
    ctx.save();
    ctx.setTransform(m[0] * k, m[1] * k, m[2] * k, m[3] * k, m[4] * k, m[5] * k);
    const [sx, sy] = tile(ti);
    ctx.drawImage(atlasCanvas, sx, sy, 16, 16, 0, 0, 16, 16);
    if (shade) { ctx.globalCompositeOperation = 'source-atop'; ctx.fillStyle = `rgba(0,0,0,${shade})`; ctx.fillRect(0, 0, 16, 16); }
    ctx.restore();
  };
  face(t[0], [20 / 16, -10 / 16, 20 / 16, 10 / 16, 4, 14], 0);
  face(t[1], [20 / 16, 10 / 16, 0, 22 / 16, 4, 14], 0.2);
  face(t[1], [20 / 16, -10 / 16, 0, 22 / 16, 24, 24], 0.4);
  return cv;
}

// ---------------- renderer ----------------
const isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
if (!isTouch) document.body.classList.add('desktop');

const settings = Object.assign({ rd: isTouch ? 4 : 6, sens: 1 }, JSON.parse(localStorage.getItem('vc_settings') || '{}'));
const saveSettings = () => localStorage.setItem('vc_settings', JSON.stringify(settings));

const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isTouch ? 1.5 : 2));
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, 1, 0.08, 1000);
camera.rotation.order = 'YXZ';
scene.fog = new THREE.Fog(0x87ceeb, 20, 60);
scene.background = new THREE.Color(0x87ceeb);
function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

const atlasTex = new THREE.CanvasTexture(atlasCanvas);
atlasTex.magFilter = THREE.NearestFilter;
atlasTex.minFilter = THREE.NearestFilter;
atlasTex.generateMipmaps = false;
const opaqueMat = new THREE.MeshBasicMaterial({ map: atlasTex, vertexColors: true, alphaTest: 0.5 });
const waterMat = new THREE.MeshBasicMaterial({ map: atlasTex, vertexColors: true, transparent: true, opacity: 0.72, side: THREE.DoubleSide, depthWrite: false });

const sun = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshBasicMaterial({ color: 0xfff3a0, fog: false, depthWrite: false }));
const moon = new THREE.Mesh(new THREE.PlaneGeometry(28, 28), new THREE.MeshBasicMaterial({ color: 0xe8ecff, fog: false, depthWrite: false }));
sun.renderOrder = moon.renderOrder = -1;
scene.add(sun, moon);

const selBox = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004)),
  new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.6 }));
selBox.visible = false;
scene.add(selBox);

// ---------------- world ----------------
class World {
  constructor(seed, edits) {
    this.seed = seed;
    this.n1 = new Perlin(seed);
    this.n2 = new Perlin(seed + 101);
    this.n3 = new Perlin(seed + 202);
    this.chunks = new Map();
    this.edits = edits;
  }
  heightAt(x, z) {
    const cont = this.n1.fbm(x / 220, z / 220, 3);
    const hills = this.n2.fbm(x / 60, z / 60, 4);
    const m = Math.max(0, this.n3.fbm(x / 130, z / 130, 3) - 0.05);
    const h = SEA + 2 + cont * 16 + hills * 7 + m * m * 140;
    return Math.max(3, Math.min(H - 9, Math.floor(h)));
  }
  treeAt(x, z, h) {
    if (h <= SEA + 1 || h >= 40) return 0;
    const r = hash2(x, z, this.seed);
    if (r > 0.014) return 0;
    return 4 + Math.floor(hash2(z, x, this.seed + 7) * 3);
  }
  generate(cx, cz) {
    const data = new Uint8Array(CS * CS * H);
    const S = CS * CS;
    const x0 = cx * CS, z0 = cz * CS;
    for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
      const h = this.heightAt(x0 + x, z0 + z);
      const col = x + z * CS;
      const beach = h <= SEA + 1, snow = h >= 46, rocky = h >= 40;
      for (let y = 0; y <= h; y++) {
        let id;
        if (y === 0) id = B.BEDROCK;
        else if (y === h) id = beach ? B.SAND : snow ? B.SNOW : rocky ? B.STONE : B.GRASS;
        else if (y >= h - 3) id = beach ? B.SAND : rocky ? B.STONE : B.DIRT;
        else id = B.STONE;
        data[col + y * S] = id;
      }
      for (let y = h + 1; y <= SEA; y++) data[col + y * S] = B.WATER;
    }
    for (let tz = -2; tz < CS + 2; tz++) for (let tx = -2; tx < CS + 2; tx++) {
      const wx = x0 + tx, wz = z0 + tz;
      const h = this.heightAt(wx, wz);
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
    const ed = this.edits.get(cx + ',' + cz);
    if (ed) for (const [i, id] of ed) data[i] = id;
    return data;
  }
  getChunk(cx, cz) {
    const k = cx + ',' + cz;
    let c = this.chunks.get(k);
    if (!c) {
      c = { cx, cz, key: k, data: this.generate(cx, cz), mesh: null, water: null, dirty: true, built: false };
      this.chunks.set(k, c);
    }
    return c;
  }
  getBlock(x, y, z) {
    if (y < 0) return B.BEDROCK;
    if (y >= H) return B.AIR;
    const cx = Math.floor(x / CS), cz = Math.floor(z / CS);
    return this.getChunk(cx, cz).data[(x - cx * CS) + (z - cz * CS) * CS + y * CS * CS];
  }
  setBlock(x, y, z, id) {
    if (y < 1 || y >= H) return false;
    const cx = Math.floor(x / CS), cz = Math.floor(z / CS);
    const c = this.getChunk(cx, cz);
    const lx = x - cx * CS, lz = z - cz * CS;
    const i = lx + lz * CS + y * CS * CS;
    c.data[i] = id;
    let ed = this.edits.get(c.key);
    if (!ed) { ed = new Map(); this.edits.set(c.key, ed); }
    ed.set(i, id);
    const touched = [];
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if ((dx === -1 && lx !== 0) || (dx === 1 && lx !== CS - 1) || (dz === -1 && lz !== 0) || (dz === 1 && lz !== CS - 1)) continue;
      const n = this.chunks.get((cx + dx) + ',' + (cz + dz));
      if (n) { n.dirty = true; touched.push(n); }
    }
    for (const n of touched) if (n.built || n === c) buildChunk(n);
    dirtySave = true;
    return true;
  }
}

// ---------------- meshing ----------------
const FACES = [
  { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0], shade: 0.8, tile: 1 },
  { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0], shade: 0.8, tile: 1 },
  { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1], shade: 1.0, tile: 0 },
  { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1], shade: 0.55, tile: 2 },
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0], shade: 0.7, tile: 1 },
  { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0], shade: 0.7, tile: 1 },
];
const CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
const AO_L = [0.45, 0.65, 0.82, 1.0];
const P = CS + 2, PL = P * P;
const PAD = new Uint8Array(PL * (H + 2));
const off = (v) => v[0] + v[2] * P + v[1] * PL;
const FACE_OFF = FACES.map(f => off(f.n));
const AO_OFF = FACES.map(f => CORNERS.map(([su, sv]) => {
  const a = [f.n[0] + su * f.u[0], f.n[1] + su * f.u[1], f.n[2] + su * f.u[2]];
  const b = [f.n[0] + sv * f.v[0], f.n[1] + sv * f.v[1], f.n[2] + sv * f.v[2]];
  const c = [f.n[0] + su * f.u[0] + sv * f.v[0], f.n[1] + su * f.u[1] + sv * f.v[1], f.n[2] + su * f.u[2] + sv * f.v[2]];
  return [off(a), off(b), off(c)];
}));
const TS = 0.25, EPS = 0.0005;

function makeGeometry(pos, uv, col, idx) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(new THREE.BufferAttribute(pos.length / 3 > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), 1));
  g.computeBoundingSphere();
  return g;
}

function buildChunk(c) {
  const { cx, cz, data } = c;
  const nb = [];
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) nb.push(dx === 0 && dz === 0 ? data : world.getChunk(cx + dx, cz + dz).data);
  const S = CS * CS;
  for (let y = -1; y <= H; y++) for (let z = -1; z <= CS; z++) for (let x = -1; x <= CS; x++) {
    let id;
    if (y < 0) id = B.BEDROCK;
    else if (y >= H) id = B.AIR;
    else {
      const ncx = x < 0 ? -1 : x >= CS ? 1 : 0, ncz = z < 0 ? -1 : z >= CS ? 1 : 0;
      id = nb[(ncz + 1) * 3 + ncx + 1][(x - ncx * CS) + (z - ncz * CS) * CS + y * S];
    }
    PAD[(x + 1) + (z + 1) * P + (y + 1) * PL] = id;
  }
  const pos = [], uv = [], col = [], idx = [];
  const wpos = [], wuv = [], wcol = [], widx = [];
  const aos = [3, 3, 3, 3];
  for (let y = 0; y < H; y++) for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
    const i = (x + 1) + (z + 1) * P + (y + 1) * PL;
    const id = PAD[i];
    if (!id) continue;
    const liquid = id === B.WATER;
    const def = BLOCKS[id];
    const lowered = liquid && PAD[i + PL] !== B.WATER;
    for (let f = 0; f < 6; f++) {
      const nid = PAD[i + FACE_OFF[f]];
      if (!TRANSP[nid] || nid === id) continue;
      if (liquid && nid === B.WATER) continue;
      const F = FACES[f];
      const tile = def.t[F.tile];
      const tu = (tile % 4) * TS, tv = 1 - (Math.floor(tile / 4) + 1) * TS;
      const Pp = liquid ? wpos : pos, Pu = liquid ? wuv : uv, Pc = liquid ? wcol : col, Pi = liquid ? widx : idx;
      const base = Pp.length / 3;
      if (liquid) { aos[0] = aos[1] = aos[2] = aos[3] = 3; }
      else {
        const ao = AO_OFF[f];
        for (let k = 0; k < 4; k++) {
          const s1 = OCC[PAD[i + ao[k][0]]], s2 = OCC[PAD[i + ao[k][1]]], cc = OCC[PAD[i + ao[k][2]]];
          aos[k] = (s1 && s2) ? 0 : 3 - (s1 + s2 + cc);
        }
      }
      for (let k = 0; k < 4; k++) {
        const su = CORNERS[k][0], sv = CORNERS[k][1];
        const vx = x + 0.5 + 0.5 * (F.n[0] + su * F.u[0] + sv * F.v[0]);
        let vy = y + 0.5 + 0.5 * (F.n[1] + su * F.u[1] + sv * F.v[1]);
        const vz = z + 0.5 + 0.5 * (F.n[2] + su * F.u[2] + sv * F.v[2]);
        if (lowered && vy === y + 1) vy -= 0.12;
        Pp.push(vx, vy, vz);
        Pu.push(tu + (su > 0 ? TS - EPS : EPS), tv + (sv > 0 ? TS - EPS : EPS));
        const l = F.shade * AO_L[aos[k]];
        Pc.push(l, l, l);
      }
      if (aos[0] + aos[2] < aos[1] + aos[3]) Pi.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);
      else Pi.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  disposeChunkMeshes(c);
  if (idx.length) {
    c.mesh = new THREE.Mesh(makeGeometry(pos, uv, col, idx), opaqueMat);
    c.mesh.position.set(cx * CS, 0, cz * CS);
    scene.add(c.mesh);
  }
  if (widx.length) {
    c.water = new THREE.Mesh(makeGeometry(wpos, wuv, wcol, widx), waterMat);
    c.water.position.set(cx * CS, 0, cz * CS);
    c.water.renderOrder = 1;
    scene.add(c.water);
  }
  c.dirty = false;
  c.built = true;
}
function disposeChunkMeshes(c) {
  if (c.mesh) { scene.remove(c.mesh); c.mesh.geometry.dispose(); c.mesh = null; }
  if (c.water) { scene.remove(c.water); c.water.geometry.dispose(); c.water = null; }
  c.built = false;
}

let frameNo = 0;
function neededChunks(px, pz, rd) {
  const pcx = Math.floor(px / CS), pcz = Math.floor(pz / CS);
  const list = [];
  for (let dz = -rd; dz <= rd; dz++) for (let dx = -rd; dx <= rd; dx++) {
    const d2 = dx * dx + dz * dz;
    if (d2 > rd * rd + 1) continue;
    list.push([pcx + dx, pcz + dz, d2]);
  }
  list.sort((a, b) => a[2] - b[2]);
  return list;
}
function updateChunks(budgetMs) {
  const t0 = performance.now();
  const p = player.pos;
  const rd = settings.rd;
  for (const [cx, cz] of neededChunks(p.x, p.z, rd)) {
    const c = world.getChunk(cx, cz);
    if (c.dirty || !c.built) {
      buildChunk(c);
      if (performance.now() - t0 > budgetMs) break;
    }
  }
  if (++frameNo % 30 === 0) {
    const pcx = Math.floor(p.x / CS), pcz = Math.floor(p.z / CS);
    for (const [k, c] of world.chunks) {
      const d = Math.max(Math.abs(c.cx - pcx), Math.abs(c.cz - pcz));
      if (d > rd + 1 && c.built) disposeChunkMeshes(c);
      if (d > rd + 3) { disposeChunkMeshes(c); world.chunks.delete(k); }
    }
  }
}

// ---------------- player ----------------
const PW = 0.3, PHt = 1.8, EYE = 1.62;
const player = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), yaw: 0, pitch: 0, onGround: false, fly: false, inWater: false, headInWater: false };
const input = { jx: 0, jy: 0, jump: false, down: false, keys: {} };
let hitH = null;

function collides(minX, minY, minZ, maxX, maxY, maxZ) {
  for (let y = Math.floor(minY); y <= Math.floor(maxY - 1e-6); y++)
    for (let z = Math.floor(minZ); z <= Math.floor(maxZ - 1e-6); z++)
      for (let x = Math.floor(minX); x <= Math.floor(maxX - 1e-6); x++)
        if (SOLID[world.getBlock(x, y, z)]) return [x, y, z];
  return null;
}
function moveAxis(axis, d) {
  const p = player.pos;
  p[axis] += d;
  const hit = collides(p.x - PW, p.y, p.z - PW, p.x + PW, p.y + PHt, p.z + PW);
  if (!hit) return;
  const [bx, by, bz] = hit;
  if (axis === 'x') { p.x = d > 0 ? bx - PW - 1e-4 : bx + 1 + PW + 1e-4; player.vel.x = 0; hitH = hit; }
  else if (axis === 'z') { p.z = d > 0 ? bz - PW - 1e-4 : bz + 1 + PW + 1e-4; player.vel.z = 0; hitH = hit; }
  else {
    if (d > 0) p.y = by - PHt - 1e-4;
    else { p.y = by + 1; player.onGround = true; }
    player.vel.y = 0;
  }
}
function physics(dt) {
  const p = player.pos, v = player.vel;
  let jx = input.jx, jy = input.jy;
  const k = input.keys;
  if (k.KeyW || k.ArrowUp) jy += 1;
  if (k.KeyS || k.ArrowDown) jy -= 1;
  if (k.KeyD || k.ArrowRight) jx += 1;
  if (k.KeyA || k.ArrowLeft) jx -= 1;
  const raw = Math.hypot(jx, jy), mag = Math.min(1, raw);
  if (raw > 0) { jx = jx / raw * mag; jy = jy / raw * mag; }
  const sy = Math.sin(player.yaw), cy = Math.cos(player.yaw);
  const wx = -sy * jy + cy * jx, wz = -cy * jy - sy * jx;
  const jump = input.jump || k.Space, down = input.down || k.ShiftLeft || k.ShiftRight;
  const sprint = (!isTouch && (k.ShiftLeft || k.ControlLeft)) || (isTouch && mag > 0.97);
  player.inWater = world.getBlock(Math.floor(p.x), Math.floor(p.y + 0.4), Math.floor(p.z)) === B.WATER;
  if (player.fly) {
    const sp = 11;
    v.x = wx * sp; v.z = wz * sp;
    v.y = ((jump ? 1 : 0) - (down ? 1 : 0)) * sp;
  } else {
    const sp = player.inWater ? 2.6 : sprint ? 5.8 : 4.3;
    const acc = player.onGround ? 18 : player.inWater ? 6 : 5;
    v.x += (wx * sp - v.x) * Math.min(1, acc * dt);
    v.z += (wz * sp - v.z) * Math.min(1, acc * dt);
    if (player.inWater) {
      v.y -= 9 * dt; if (v.y < -3) v.y = -3;
      if (jump) v.y = Math.min(v.y + 30 * dt, 3.6);
    } else {
      v.y -= 28 * dt; if (v.y < -50) v.y = -50;
      if (jump && player.onGround) v.y = 8.6;
    }
  }
  const wasGround = player.onGround;
  hitH = null;
  moveAxis('x', v.x * dt);
  moveAxis('z', v.z * dt);
  player.onGround = false;
  moveAxis('y', v.y * dt);
  if (hitH && wasGround && !player.fly && mag > 0.1 && hitH[1] === Math.floor(p.y + 0.01)) {
    const [bx, by, bz] = hitH;
    if (!SOLID[world.getBlock(bx, by + 1, bz)] && !SOLID[world.getBlock(bx, by + 2, bz)] &&
      !collides(p.x - PW, p.y + 1, p.z - PW, p.x + PW, p.y + 1 + PHt, p.z + PW)) v.y = 8.6;
  }
  if (p.y < -20) spawnPlayer();
}

const _dir = new THREE.Vector3();
function raycast(maxD) {
  const o = camera.position, dir = _dir;
  camera.getWorldDirection(dir);
  let x = Math.floor(o.x), y = Math.floor(o.y), z = Math.floor(o.z);
  const sx = Math.sign(dir.x), sy = Math.sign(dir.y), sz = Math.sign(dir.z);
  const tdx = Math.abs(1 / dir.x), tdy = Math.abs(1 / dir.y), tdz = Math.abs(1 / dir.z);
  let tmx = sx > 0 ? (x + 1 - o.x) * tdx : sx < 0 ? (o.x - x) * tdx : Infinity;
  let tmy = sy > 0 ? (y + 1 - o.y) * tdy : sy < 0 ? (o.y - y) * tdy : Infinity;
  let tmz = sz > 0 ? (z + 1 - o.z) * tdz : sz < 0 ? (o.z - z) * tdz : Infinity;
  let face = [0, 0, 0], t = 0;
  while (t <= maxD) {
    const id = world.getBlock(x, y, z);
    if (id && id !== B.WATER) return { x, y, z, face, id };
    if (tmx < tmy && tmx < tmz) { x += sx; t = tmx; tmx += tdx; face = [-sx, 0, 0]; }
    else if (tmy < tmz) { y += sy; t = tmy; tmy += tdy; face = [0, -sy, 0]; }
    else { z += sz; t = tmz; tmz += tdz; face = [0, 0, -sz]; }
  }
  return null;
}

// ---------------- particles ----------------
const particles = [];
const pGeo = new THREE.BoxGeometry(0.13, 0.13, 0.13);
for (let i = 0; i < 48; i++) {
  const m = new THREE.Mesh(pGeo, new THREE.MeshBasicMaterial());
  m.visible = false; scene.add(m);
  particles.push({ m, v: new THREE.Vector3(), life: 0 });
}
let pNext = 0;
function burst(x, y, z, id) {
  const c = tileAvg[BLOCKS[id].t[1]];
  for (let i = 0; i < 12; i++) {
    const p = particles[pNext]; pNext = (pNext + 1) % particles.length;
    const f = 0.8 + Math.random() * 0.3;
    p.m.material.color.setRGB(c[0] * f, c[1] * f, c[2] * f);
    p.m.position.set(x + 0.2 + Math.random() * 0.6, y + 0.2 + Math.random() * 0.6, z + 0.2 + Math.random() * 0.6);
    p.v.set((Math.random() - 0.5) * 4, Math.random() * 4, (Math.random() - 0.5) * 4);
    p.life = 0.5 + Math.random() * 0.4; p.m.visible = true;
  }
}
function updateParticles(dt) {
  for (const p of particles) {
    if (p.life <= 0) continue;
    p.life -= dt;
    if (p.life <= 0) { p.m.visible = false; continue; }
    p.v.y -= 18 * dt;
    p.m.position.addScaledVector(p.v, dt);
    const q = p.m.position;
    if (SOLID[world.getBlock(Math.floor(q.x), Math.floor(q.y - 0.07), Math.floor(q.z))]) { p.v.set(0, 0, 0); q.y = Math.floor(q.y - 0.07) + 1.07; }
  }
}

// ---------------- actions ----------------
let selected = 0;
function breakBlock() {
  const h = raycast(6);
  if (!h || h.id === B.BEDROCK) return;
  burst(h.x, h.y, h.z, h.id);
  world.setBlock(h.x, h.y, h.z, B.AIR);
  vibrate(15);
}
function placeBlock() {
  const h = raycast(6);
  if (!h) return;
  const x = h.x + h.face[0], y = h.y + h.face[1], z = h.z + h.face[2];
  const cur = world.getBlock(x, y, z);
  if (cur !== B.AIR && cur !== B.WATER) return;
  const id = HOTBAR[selected];
  if (SOLID[id]) {
    const p = player.pos;
    if (x + 1 > p.x - PW && x < p.x + PW && y + 1 > p.y && y < p.y + PHt && z + 1 > p.z - PW && z < p.z + PW) return;
  }
  world.setBlock(x, y, z, id);
  vibrate(8);
}
function vibrate(ms) { try { if (isTouch && navigator.vibrate) navigator.vibrate(ms); } catch (e) { } }

// ---------------- UI ----------------
const $ = (id) => document.getElementById(id);
const hotbarEl = $('hotbar');
HOTBAR.forEach((id, i) => {
  const s = document.createElement('div');
  s.className = 'slot';
  s.appendChild(makeIcon(id));
  const pick = (e) => { e.preventDefault(); e.stopPropagation(); selectSlot(i); };
  s.addEventListener('touchstart', pick, { passive: false });
  s.addEventListener('mousedown', pick);
  hotbarEl.appendChild(s);
});
let nameTimer = 0;
function selectSlot(i) {
  selected = (i + HOTBAR.length) % HOTBAR.length;
  [...hotbarEl.children].forEach((el, j) => el.classList.toggle('sel', j === selected));
  const bn = $('blockname');
  bn.textContent = BLOCKS[HOTBAR[selected]].name;
  bn.style.opacity = 1;
  clearTimeout(nameTimer);
  nameTimer = setTimeout(() => bn.style.opacity = 0, 1200);
}

function holdButton(el, onDown, onUp) {
  el.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); el.classList.add('active'); onDown(); }, { passive: false });
  const up = (e) => { e.preventDefault(); el.classList.remove('active'); onUp && onUp(); };
  el.addEventListener('touchend', up, { passive: false });
  el.addEventListener('touchcancel', up, { passive: false });
}
holdButton($('btn-jump'), () => input.jump = true, () => input.jump = false);
holdButton($('btn-down'), () => input.down = true, () => input.down = false);
holdButton($('btn-fly'), () => toggleFly());
holdButton($('btn-menu'), () => openMenu());
function refreshFlyUi() {
  $('btn-fly').style.background = player.fly ? 'rgba(120,200,255,0.5)' : '';
  $('btn-down').style.display = player.fly ? 'flex' : 'none';
}
function toggleFly() {
  player.fly = !player.fly;
  player.vel.set(0, 0, 0);
  refreshFlyUi();
}

// touch: joystick on the left, look/tap/hold on the right
const joyBase = $('joy-base'), joyKnob = $('joy-knob');
let joyId = null, joyX = 0, joyY = 0, lookId = null, lookLast = null, lookStart = null, holdTimer = 0, breakTimer = 0, breaking = false, lookMoved = false;
const JOY_R = 60;
function stopBreaking() { clearTimeout(holdTimer); clearInterval(breakTimer); breaking = false; }
canvas.addEventListener('touchstart', (e) => {
  e.preventDefault();
  if (!playing) return;
  for (const t of e.changedTouches) {
    if (joyId === null && t.clientX < window.innerWidth * 0.4) {
      joyId = t.identifier; joyX = t.clientX; joyY = t.clientY;
      joyBase.style.left = joyX + 'px'; joyBase.style.top = joyY + 'px'; joyBase.style.display = 'block';
      joyKnob.style.transform = '';
    } else if (lookId === null) {
      lookId = t.identifier; lookLast = [t.clientX, t.clientY]; lookStart = [t.clientX, t.clientY, performance.now()]; lookMoved = false;
      stopBreaking();
      holdTimer = setTimeout(() => {
        breaking = true; breakBlock();
        breakTimer = setInterval(breakBlock, 280);
      }, 320);
    }
  }
}, { passive: false });
canvas.addEventListener('touchmove', (e) => {
  e.preventDefault();
  for (const t of e.changedTouches) {
    if (t.identifier === joyId) {
      let dx = t.clientX - joyX, dy = t.clientY - joyY;
      const d = Math.hypot(dx, dy);
      if (d > JOY_R) { dx *= JOY_R / d; dy *= JOY_R / d; }
      joyKnob.style.transform = `translate(${dx}px, ${dy}px)`;
      input.jx = dx / JOY_R; input.jy = -dy / JOY_R;
    } else if (t.identifier === lookId) {
      const dx = t.clientX - lookLast[0], dy = t.clientY - lookLast[1];
      lookLast = [t.clientX, t.clientY];
      if (!lookMoved && Math.hypot(t.clientX - lookStart[0], t.clientY - lookStart[1]) > 12) {
        lookMoved = true;
        if (!breaking) clearTimeout(holdTimer);
      }
      const s = 0.0055 * settings.sens;
      player.yaw -= dx * s;
      player.pitch = Math.max(-1.55, Math.min(1.55, player.pitch - dy * s));
    }
  }
}, { passive: false });
const touchEnd = (e) => {
  e.preventDefault();
  for (const t of e.changedTouches) {
    if (t.identifier === joyId) { joyId = null; input.jx = input.jy = 0; joyBase.style.display = 'none'; }
    else if (t.identifier === lookId) {
      lookId = null;
      const quick = performance.now() - lookStart[2] < 300;
      if (!breaking && !lookMoved && quick && playing) placeBlock();
      stopBreaking();
    }
  }
};
canvas.addEventListener('touchend', touchEnd, { passive: false });
canvas.addEventListener('touchcancel', touchEnd, { passive: false });

// desktop: pointer lock
canvas.addEventListener('mousedown', (e) => {
  if (isTouch || !playing) return;
  if (document.pointerLockElement !== canvas) { canvas.requestPointerLock(); return; }
  if (e.button === 0) breakBlock();
  else if (e.button === 2) placeBlock();
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== canvas) return;
  const s = 0.0024 * settings.sens;
  player.yaw -= e.movementX * s;
  player.pitch = Math.max(-1.55, Math.min(1.55, player.pitch - e.movementY * s));
});
document.addEventListener('pointerlockchange', () => {
  if (!isTouch && document.pointerLockElement !== canvas && playing) openMenu();
});
window.addEventListener('keydown', (e) => {
  input.keys[e.code] = true;
  if (!playing) return;
  if (e.code === 'KeyF') toggleFly();
  if (e.code.startsWith('Digit')) { const n = parseInt(e.code.slice(5)); if (n >= 1) selectSlot(n - 1); }
  if (e.code === 'KeyQ') selectSlot(selected - 1);
  if (e.code === 'KeyE') selectSlot(selected + 1);
});
window.addEventListener('keyup', (e) => { input.keys[e.code] = false; });
window.addEventListener('wheel', (e) => { if (playing) selectSlot(selected + (e.deltaY > 0 ? 1 : -1)); });

// ---------------- menu & save ----------------
let world = null, playing = false, dirtySave = false, gameTime = 0.3;
const DAY_LEN = 600;
const menu = $('menu');
const rdInput = $('rd'), sensInput = $('sens');
rdInput.value = settings.rd; sensInput.value = settings.sens;
const showSettings = () => { $('rdv').textContent = settings.rd; $('sensv').textContent = (+settings.sens).toFixed(1); };
showSettings();
rdInput.addEventListener('input', () => { settings.rd = +rdInput.value; showSettings(); saveSettings(); });
sensInput.addEventListener('input', () => { settings.sens = +sensInput.value; showSettings(); saveSettings(); });

function saveGame() {
  if (!world) return;
  const edits = {};
  for (const [k, m] of world.edits) edits[k] = Array.from(m);
  const p = player.pos;
  try {
    localStorage.setItem('vc_world', JSON.stringify({
      v: 1, seed: world.seed, edits, time: gameTime, sel: selected,
      player: { x: p.x, y: p.y, z: p.z, yaw: player.yaw, pitch: player.pitch, fly: player.fly },
    }));
  } catch (e) { console.warn('save failed', e); }
  dirtySave = false;
}
window.saveGame = saveGame;
function loadSave() { try { return JSON.parse(localStorage.getItem('vc_world')); } catch (e) { return null; } }

function spawnPlayer() {
  for (let r = 0; r < 600; r += 4) {
    for (let a = 0; a < 8; a++) {
      const x = Math.round(Math.cos(a * Math.PI / 4) * r), z = Math.round(Math.sin(a * Math.PI / 4) * r);
      if (world.heightAt(x, z) > SEA + 1) {
        let y = H - 1;
        while (y > 0 && !SOLID[world.getBlock(x, y, z)]) y--;
        if (world.getBlock(x, y, z) !== B.LEAVES) {
          player.pos.set(x + 0.5, y + 1, z + 0.5);
          player.vel.set(0, 0, 0);
          return;
        }
      }
      if (r === 0) break;
    }
  }
  player.pos.set(0.5, H - 2, 0.5);
}

function startWorld(save) {
  if (world) for (const c of world.chunks.values()) disposeChunkMeshes(c);
  const edits = new Map();
  if (save && save.edits) for (const k in save.edits) edits.set(k, new Map(save.edits[k]));
  const seed = save ? save.seed : (Math.random() * 2147483647) | 0;
  world = new World(seed, edits);
  player.fly = false;
  if (save && save.player) {
    const s = save.player;
    player.pos.set(s.x, s.y, s.z); player.yaw = s.yaw; player.pitch = s.pitch; player.fly = !!s.fly;
    gameTime = save.time ?? 0.3;
    selectSlot(save.sel || 0);
  } else {
    spawnPlayer(); player.yaw = 0; player.pitch = 0; gameTime = 0.3; selectSlot(0);
  }
  refreshFlyUi();
  saveGame();
}

function setStatus(s) { $('menu-status').textContent = s; }
function updateMenu() { $('play').textContent = (world || loadSave()) ? 'Continuar' : 'Jogar'; }
function openMenu() {
  playing = false;
  input.jump = input.down = false; input.jx = input.jy = 0; joyId = lookId = null; joyBase.style.display = 'none';
  stopBreaking();
  saveGame();
  updateMenu();
  menu.classList.remove('hidden');
  if (document.pointerLockElement) document.exitPointerLock();
}
function closeMenu() {
  menu.classList.add('hidden');
  playing = true;
  last = performance.now();
  if (!isTouch) canvas.requestPointerLock();
}
async function prepareAndPlay(save, fresh) {
  $('play').disabled = $('newworld').disabled = true;
  setStatus('Gerando mundo...');
  await new Promise(r => setTimeout(r, 30));
  if (fresh || !world) startWorld(save);
  const near = neededChunks(player.pos.x, player.pos.z, Math.min(2, settings.rd));
  for (let i = 0; i < near.length; i++) {
    const c = world.getChunk(near[i][0], near[i][1]);
    if (c.dirty || !c.built) buildChunk(c);
    if (i % 4 === 3) { setStatus(`Gerando mundo... ${Math.round(i / near.length * 100)}%`); await new Promise(r => setTimeout(r, 0)); }
  }
  setStatus('');
  $('play').disabled = $('newworld').disabled = false;
  closeMenu();
}
$('play').addEventListener('click', () => prepareAndPlay(world ? null : loadSave(), !world));
$('newworld').addEventListener('click', () => {
  if ((world || loadSave()) && !confirm('Criar um novo mundo? O mundo atual será apagado.')) return;
  localStorage.removeItem('vc_world');
  if (world) for (const c of world.chunks.values()) disposeChunkMeshes(c);
  world = null;
  prepareAndPlay(null, true);
});
window.onAndroidBack = () => { if (playing) openMenu(); else if (world) closeMenu(); };
document.addEventListener('visibilitychange', () => { if (document.hidden) { saveGame(); if (playing) openMenu(); } });
window.addEventListener('pagehide', saveGame);
setInterval(() => { if (dirtySave || playing) saveGame(); }, 8000);
updateMenu();

// ---------------- sky / day-night ----------------
const DAY = new THREE.Color(0x87ceeb), NIGHT = new THREE.Color(0x070b1c), SUNSET = new THREE.Color(0xf08a4b), UNDER = new THREE.Color(0x1d3f8a);
const skyCol = new THREE.Color(), sunDir = new THREE.Vector3();
function updateSky(dt) {
  if (playing) gameTime = (gameTime + dt / DAY_LEN) % 1;
  const ang = gameTime * Math.PI * 2;
  const sh = Math.sin(ang);
  const day = Math.min(1, Math.max(0, (sh + 0.2) / 0.45));
  const light = 0.2 + 0.8 * day;
  skyCol.copy(NIGHT).lerp(DAY, day);
  skyCol.lerp(SUNSET, Math.max(0, 1 - Math.abs(sh) * 5) * 0.55);
  const rdBlocks = settings.rd * CS;
  if (player.headInWater) {
    scene.fog.color.copy(UNDER).multiplyScalar(light);
    scene.fog.near = 0.5; scene.fog.far = 14;
  } else {
    scene.fog.color.copy(skyCol);
    scene.fog.near = rdBlocks * 0.45; scene.fog.far = rdBlocks * 0.95;
  }
  scene.background.copy(scene.fog.color);
  opaqueMat.color.setScalar(light);
  waterMat.color.setScalar(light);
  sunDir.set(Math.cos(ang), sh, 0.25).normalize();
  sun.position.copy(camera.position).addScaledVector(sunDir, 400);
  sun.lookAt(camera.position);
  moon.position.copy(camera.position).addScaledVector(sunDir, -400);
  moon.lookAt(camera.position);
}

// ---------------- main loop ----------------
const infoEl = $('info'), waterOverlay = $('water-overlay');
let last = performance.now(), fpsAcc = 0, fpsN = 0, fps = 0;
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.max(0, Math.min(0.1, (now - last) / 1000));
  last = now;
  fpsAcc += dt; fpsN++;
  if (fpsAcc > 0.5) { fps = Math.round(fpsN / fpsAcc); fpsAcc = 0; fpsN = 0; }
  if (!world) { renderer.render(scene, camera); return; }
  if (playing) {
    const steps = Math.ceil(dt / 0.02);
    for (let i = 0; i < steps; i++) physics(dt / steps);
  }
  const p = player.pos;
  camera.position.set(p.x, p.y + EYE, p.z);
  camera.rotation.set(player.pitch, player.yaw, 0);
  player.headInWater = world.getBlock(Math.floor(p.x), Math.floor(p.y + EYE), Math.floor(p.z)) === B.WATER;
  waterOverlay.style.display = player.headInWater ? 'block' : 'none';
  updateChunks(playing ? 6 : 12);
  updateParticles(dt);
  updateSky(dt);
  const h = playing ? raycast(6) : null;
  if (h) { selBox.visible = true; selBox.position.set(h.x + 0.5, h.y + 0.5, h.z + 0.5); } else selBox.visible = false;
  if (frameNo % 10 === 0) infoEl.textContent = `${fps} FPS  ·  X ${Math.floor(p.x)}  Y ${Math.floor(p.y)}  Z ${Math.floor(p.z)}`;
  renderer.render(scene, camera);
}
camera.position.set(0, 40, 0);
requestAnimationFrame(loop);
