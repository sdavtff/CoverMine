import * as THREE from './lib/three.module.min.js';
import { TILE, buildAtlas, tileUV, atlasToCanvas } from './textures.js';
import { U, makeSkyMaterial, makeCloudMaterial, makeWaterMaterial, patchTerrainMaterial, makeDepthMaterial } from './shaders.js';
import { loadSettings, saveSettings as storeSettings, effective, buildPanel, PRESET_ORDER, PRESET_NAMES, applyPreset, SHADOW_LEVELS, VEG_DENSITY } from './graphics.js';

// ---------------- constants & blocks ----------------
const CS = 16, H = 64, SEA = 22;
const B = {
  AIR: 0, GRASS: 1, DIRT: 2, STONE: 3, LOG: 4, LEAVES: 5, SAND: 6, WATER: 7, PLANKS: 8, BRICK: 9, GLASS: 10, COBBLE: 11, SNOW: 12, BEDROCK: 13,
  GRAVEL: 14, LAMP: 15, BIRCH_LOG: 16, PINE_LEAVES: 17,
};
// t = [topo, lados, base]
const BLOCKS = [
  null,
  { name: 'Grama', t: [TILE.GRASS_TOP, TILE.GRASS_SIDE, TILE.DIRT], tint: 'grass' },
  { name: 'Terra', t: [TILE.DIRT, TILE.DIRT, TILE.DIRT] },
  { name: 'Pedra', t: [TILE.STONE, TILE.STONE, TILE.STONE] },
  { name: 'Tronco', t: [TILE.LOG_TOP, TILE.LOG_SIDE, TILE.LOG_TOP] },
  { name: 'Folhas', t: [TILE.LEAVES, TILE.LEAVES, TILE.LEAVES], tint: 'leaves' },
  { name: 'Areia', t: [TILE.SAND, TILE.SAND, TILE.SAND] },
  { name: 'Água', t: [TILE.WATER, TILE.WATER, TILE.WATER] },
  { name: 'Tábuas', t: [TILE.PLANKS, TILE.PLANKS, TILE.PLANKS] },
  { name: 'Tijolos', t: [TILE.BRICK, TILE.BRICK, TILE.BRICK] },
  { name: 'Vidro', t: [TILE.GLASS, TILE.GLASS, TILE.GLASS] },
  { name: 'Pedregulho', t: [TILE.COBBLE, TILE.COBBLE, TILE.COBBLE] },
  { name: 'Neve', t: [TILE.SNOW, TILE.SNOW_SIDE, TILE.DIRT] },
  { name: 'Rocha-mãe', t: [TILE.BEDROCK, TILE.BEDROCK, TILE.BEDROCK] },
  { name: 'Cascalho', t: [TILE.GRAVEL, TILE.GRAVEL, TILE.GRAVEL] },
  { name: 'Lâmpada', t: [TILE.LAMP, TILE.LAMP, TILE.LAMP], light: 15 },
  { name: 'Tronco de bétula', t: [TILE.BIRCH_TOP, TILE.BIRCH_SIDE, TILE.BIRCH_TOP] },
  { name: 'Folhas de pinheiro', t: [TILE.PINE_LEAVES, TILE.PINE_LEAVES, TILE.PINE_LEAVES], tint: 'pine' },
];
const TRANSP = new Uint8Array(32), OCC = new Uint8Array(32), SOLID = new Uint8Array(32), CUTOUT = new Uint8Array(32);
const LOPQ = new Uint8Array(256), LEXT = new Uint8Array(256), EMIT = new Uint8Array(256), ROT = new Uint8Array(32);
for (let i = 0; i < BLOCKS.length; i++) {
  const leaves = i === B.LEAVES || i === B.PINE_LEAVES;
  TRANSP[i] = (i === B.AIR || i === B.WATER || leaves || i === B.GLASS) ? 1 : 0;
  OCC[i] = (i !== B.AIR && i !== B.WATER && i !== B.GLASS) ? 1 : 0;
  SOLID[i] = (i !== B.AIR && i !== B.WATER) ? 1 : 0;
  CUTOUT[i] = (leaves || i === B.GLASS) ? 1 : 0;
  LOPQ[i] = TRANSP[i] ? 0 : 1;
  LEXT[i] = (leaves || i === B.WATER) ? 1 : 0;
  EMIT[i] = BLOCKS[i] && BLOCKS[i].light || 0;
  ROT[i] = [B.GRASS, B.DIRT, B.STONE, B.SAND, B.SNOW, B.GRAVEL, B.BEDROCK, B.LEAVES, B.PINE_LEAVES].includes(i) ? 1 : 0;
}
const HOTBAR = [B.GRASS, B.DIRT, B.STONE, B.COBBLE, B.PLANKS, B.LOG, B.BIRCH_LOG, B.LEAVES, B.SAND, B.GRAVEL, B.GLASS, B.BRICK, B.SNOW, B.LAMP, B.WATER];

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

// ---------------- settings & renderer ----------------
const isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
if (!isTouch) document.body.classList.add('desktop');

const settings = loadSettings(isTouch);
let eff = effective(settings);
const saveSettings = () => storeSettings(settings);

const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !!eff.aa, powerPreference: 'high-performance', stencil: false });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.autoUpdate = false;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, 1, 0.08, 1100);
camera.rotation.order = 'YXZ';
const maxAniso = renderer.capabilities.getMaxAnisotropy();
const halfFloatRT = renderer.capabilities.isWebGL2 && (renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float'));

function pixelRatio() { return Math.max(0.5, Math.min(window.devicePixelRatio || 1, eff.res)); }
function resize() {
  renderer.setPixelRatio(pixelRatio());
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  if (reflRT) { const s = new THREE.Vector2(); renderer.getDrawingBufferSize(s); reflRT.setSize(Math.max(1, s.x >> 1), Math.max(1, s.y >> 1)); }
}
window.addEventListener('resize', () => resize());

// ---------------- textures & materials ----------------
let atlas = null, atlasCanvas = null, uvCache = [];
const tex = { albedo: null, normal: null, orm: null };
function makeDataTex(data, srgb) {
  const t = new THREE.DataTexture(data, atlas.width, atlas.height, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = Math.min(maxAniso, eff.tex >= 128 ? 8 : eff.tex >= 64 ? 4 : 1);
  t.needsUpdate = true;
  return t;
}
function buildTextures() {
  atlas = buildAtlas(eff.tex);
  for (const k in tex) if (tex[k]) tex[k].dispose();
  tex.albedo = makeDataTex(atlas.albedo, true);
  tex.normal = makeDataTex(atlas.normal, false);
  tex.orm = makeDataTex(atlas.orm, false);
  atlasCanvas = atlasToCanvas(atlas);
  uvCache = [];
  for (let t = 0; t < 32; t++) uvCache[t] = tileUV(t, atlas);
}

const mats = { opaque: null, cutout: null, depth: null, water: null };
function makeTerrainMaterials() {
  const mk = (cut) => {
    const p = { map: tex.albedo, vertexColors: true };
    if (cut) p.alphaTest = 0.5;
    if (eff.normalMaps) { p.normalMap = tex.normal; p.normalScale = new THREE.Vector2(1, 1); }
    p.aoMap = tex.orm; p.aoMapIntensity = 0.8;
    let m;
    if (eff.pbr) {
      m = new THREE.MeshStandardMaterial(Object.assign(p, { roughnessMap: tex.orm, roughness: 1, metalness: 0, envMapIntensity: 0.6 }));
    } else {
      m = new THREE.MeshLambertMaterial(p);
    }
    return patchTerrainMaterial(m);
  };
  const old = Object.assign({}, mats);
  mats.opaque = mk(false);
  mats.cutout = mk(true);
  mats.depth = makeDepthMaterial(tex.albedo);
  for (const k of ['opaque', 'cutout', 'depth']) if (old[k]) old[k].dispose();
  if (world) for (const c of world.chunks.values()) {
    if (c.mesh) c.mesh.material = mats.opaque;
    if (c.cut) { c.cut.material = mats.cutout; c.cut.customDepthMaterial = mats.depth; }
  }
}
let reflRT = null;
function makeWaterMat() {
  const old = mats.water;
  mats.water = makeWaterMaterial(eff.water, reflRT ? reflRT.texture : null);
  if (old) old.dispose();
  if (world) for (const c of world.chunks.values()) if (c.water) c.water.material = mats.water;
}

// ---------------- sky, clouds, lights ----------------
const skyMat = makeSkyMaterial(1);
const sky = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), skyMat);
sky.frustumCulled = false;
sky.renderOrder = -10;
scene.add(sky);

let cloudMat = makeCloudMaterial(Math.max(1, eff.clouds));
const clouds = new THREE.Mesh(new THREE.PlaneGeometry(1800, 1800, 1, 1), cloudMat);
clouds.rotation.x = -Math.PI / 2;
clouds.frustumCulled = false;
clouds.renderOrder = 2;
scene.add(clouds);

const sunLight = new THREE.DirectionalLight(0xffffff, 3);
sunLight.shadow.bias = -0.0004;
sunLight.shadow.normalBias = 0.03;
sunLight.shadow.camera.near = 1;
sunLight.shadow.camera.far = 420;
scene.add(sunLight, sunLight.target);
const hemi = new THREE.HemisphereLight(0x9cc4ff, 0x4a3b2a, 1.4);
scene.add(hemi);

// ambiente (reflexos do céu em materiais PBR)
const pmrem = new THREE.PMREMGenerator(renderer);
const envScene = new THREE.Scene();
envScene.add(new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), makeSkyMaterial(0)));
let envRT = null, envAngle = -99;

const selBox = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004)),
  new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55 }));
selBox.visible = false;
scene.add(selBox);

// ---------------- world ----------------
class World {
  constructor(seed, edits, gen) {
    this.seed = seed;
    this.gen = gen || 1;
    this.n1 = new Perlin(seed);
    this.n2 = new Perlin(seed + 101);
    this.n3 = new Perlin(seed + 202);
    this.nT = new Perlin(seed + 303); // apenas variação de cor (não altera o terreno)
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
  // gerador v2: florestas com densidade variável, bétulas e pinheiros
  treeAt2(x, z, h) {
    if (h <= SEA + 1 || h >= 46) return null;
    const forest = Math.max(0, this.n2.fbm(x / 90 + 50.3, z / 90 + 50.7, 2));
    const p = 0.007 + forest * 0.06;
    if (hash2(x, z, this.seed) > p) return null;
    const r = hash2(z, x, this.seed + 7), k = hash2(x + 3, z - 5, this.seed + 3);
    if (h >= 35) return { type: 2, th: 6 + Math.floor(r * 4) };
    if (k < 0.28) return { type: 1, th: 5 + Math.floor(r * 3) };
    return { type: 0, th: 4 + Math.floor(r * 3) };
  }
  generate(cx, cz) {
    const data = new Uint8Array(CS * CS * H);
    const S = CS * CS;
    const x0 = cx * CS, z0 = cz * CS;
    const g2 = this.gen >= 2;
    for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
      const h = this.heightAt(x0 + x, z0 + z);
      const col = x + z * CS;
      const beach = h <= SEA + 1, snow = h >= 46, rocky = h >= 40;
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
    const ed = this.edits.get(cx + ',' + cz);
    if (ed) for (const [i, id] of ed) data[i] = id;
    return data;
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
      // pinheiro: cone em camadas alternadas
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
  getChunk(cx, cz) {
    const k = cx + ',' + cz;
    let c = this.chunks.get(k);
    if (!c) {
      const data = this.generate(cx, cz);
      c = { cx, cz, key: k, data, maxY: 0, emit: 0, mesh: null, cut: null, water: null, dirty: true, built: false };
      scanChunk(c);
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
    const prev = c.data[i];
    c.data[i] = id;
    if (EMIT[prev]) c.emit--;
    if (EMIT[id]) c.emit++;
    if (id && y > c.maxY) c.maxY = y;
    let ed = this.edits.get(c.key);
    if (!ed) { ed = new Map(); this.edits.set(c.key, ed); }
    ed.set(i, id);
    // geometria: o chunk e os vizinhos de borda são refeitos já; a luz pode alcançar
    // os 8 vizinhos, que são refeitos nos próximos quadros
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dz) continue;
      const n = this.chunks.get((cx + dx) + ',' + (cz + dz));
      if (!n) continue;
      n.dirty = true;
      const edge = !((dx === -1 && lx !== 0) || (dx === 1 && lx !== CS - 1) || (dz === -1 && lz !== 0) || (dz === 1 && lz !== CS - 1));
      if (edge && n.built) urgent.add(n);
    }
    c.dirty = true;
    buildChunk(c);
    dirtySave = true;
    return true;
  }
}
function scanChunk(c) {
  const d = c.data, S = CS * CS;
  let maxY = 0, emit = 0;
  for (let i = 0; i < d.length; i++) {
    const id = d[i];
    if (id) { const y = (i / S) | 0; if (y > maxY) maxY = y; if (EMIT[id]) emit++; }
  }
  c.maxY = maxY; c.emit = emit;
}

// ---------------- light volume ----------------
// Volume com margem LP ao redor do chunk para propagar luz do céu e de blocos (flood fill estilo voxel).
const LP = 14, LW = CS + LP * 2, LA = LW * LW, LYS = H + 2;
const VOL = new Uint8Array(LA * LYS), SKYL = new Uint8Array(LA * LYS), BLKL = new Uint8Array(LA * LYS);
const QN = 1 << 18, QM = QN - 1, LQ = new Int32Array(QN);
const vi = (x, y, z) => (x + LP) + (z + LP) * LW + (y + 1) * LA;
const DIR6 = [1, -1, LW, -LW, LA, -LA];

function fillVolume(cx, cz) {
  let top = 0, emit = 0;
  const S = CS * CS;
  for (let ncz = -1; ncz <= 1; ncz++) for (let ncx = -1; ncx <= 1; ncx++) {
    const ch = world.getChunk(cx + ncx, cz + ncz);
    const data = ch.data;
    const xa = Math.max(-LP, ncx * CS), xb = Math.min(CS + LP, ncx * CS + CS);
    const za = Math.max(-LP, ncz * CS), zb = Math.min(CS + LP, ncz * CS + CS);
    if (ch.maxY > top) top = ch.maxY;
    emit += ch.emit;
    const n = xb - xa;
    for (let y = 0; y < H; y++) for (let z = za; z < zb; z++) {
      const d = vi(xa, y, z), s = (xa - ncx * CS) + (z - ncz * CS) * CS + y * S;
      for (let k = 0; k < n; k++) VOL[d + k] = data[s + k];
    }
  }
  VOL.fill(B.BEDROCK, 0, LA);
  VOL.fill(B.AIR, (H + 1) * LA, (H + 2) * LA);
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
  const yMaxIdx = yTop + 1; // índice de camada (y + 1)
  SKYL.fill(15, (yTop + 1) * LA);
  // luz direta do céu (coluna a coluna)
  for (let z = 0; z < LW; z++) for (let x = 0; x < LW; x++) {
    let l = 15, i = x + z * LW + yMaxIdx * LA;
    for (let yi = yMaxIdx; yi >= 0; yi--, i -= LA) {
      const id = VOL[i];
      if (LOPQ[id]) l = 0; else if (l && LEXT[id]) l = Math.max(0, l - LEXT[id]);
      SKYL[i] = l;
    }
  }
  // sementes: células iluminadas com vizinho transparente mais escuro
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
  // luz de blocos (lâmpadas)
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
const FACE_OFF = FACES.map(f => voff(f.n));
const AO_OFF = FACES.map(f => CORNERS.map(([su, sv]) => {
  const a = [f.n[0] + su * f.u[0], f.n[1] + su * f.u[1], f.n[2] + su * f.u[2]];
  const b = [f.n[0] + sv * f.v[0], f.n[1] + sv * f.v[1], f.n[2] + sv * f.v[2]];
  const c = [f.n[0] + su * f.u[0] + sv * f.v[0], f.n[1] + su * f.u[1] + sv * f.v[1], f.n[2] + su * f.u[2] + sv * f.v[2]];
  return [voff(a), voff(b), voff(c)];
}));

// Buffers tipados reutilizáveis (evita alocar arrays JS a cada reconstrução de chunk).
class GeoBuf {
  constructor() { this.cap = 0; this.n = 0; this.ni = 0; this.grow(4096); }
  grow(cap) {
    const o = this;
    const P = new Float32Array(cap * 3), N = new Int8Array(cap * 3), UV = new Float32Array(cap * 2), C = new Uint8Array(cap * 3), L = new Uint8Array(cap * 4), I = new Uint32Array(cap * 1.5);
    if (o.cap) { P.set(o.P); N.set(o.N); UV.set(o.UV); C.set(o.C); L.set(o.L); I.set(o.I); }
    Object.assign(o, { P, N, UV, C, L, I, cap });
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
    const I = this.I; let k = this.ni;
    I[k] = a; I[k + 1] = b; I[k + 2] = c; I[k + 3] = d; I[k + 4] = e; I[k + 5] = f;
    this.ni = k + 6;
  }
  build() {
    if (!this.ni) return null;
    const n = this.n, g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.P.slice(0, n * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.N.slice(0, n * 3), 3, true));
    g.setAttribute('uv', new THREE.BufferAttribute(this.UV.slice(0, n * 2), 2));
    g.setAttribute('color', new THREE.BufferAttribute(this.C.slice(0, n * 3), 3, true));
    g.setAttribute('aLight', new THREE.BufferAttribute(this.L.slice(0, n * 4), 4, true));
    g.setIndex(new THREE.BufferAttribute(n > 65535 ? this.I.slice(0, this.ni) : Uint16Array.from(this.I.subarray(0, this.ni)), 1));
    g.computeBoundingSphere();
    return g;
  }
}
const GB_OPQ = new GeoBuf(), GB_CUT = new GeoBuf(), GB_WAT = new GeoBuf();

const TINT = [1, 1, 1];
function tintFor(id, wx, wy, wz) {
  const j = hash2(wx * 7 + wy, wz * 13 - wy, 77) - 0.5;
  const kind = BLOCKS[id].tint;
  if (kind === 'grass' || kind === 'leaves') {
    const n = world.nT.noise(wx / 52 + 0.37, wz / 52 + 0.61);
    const dry = Math.max(-0.5, Math.min(0.5, n * 1.4));
    const tree = kind === 'leaves' ? (hash2(wx >> 2, wz >> 2, 91) - 0.5) * 0.1 : 0;
    TINT[0] = 0.9 + dry * 0.1 + j * 0.04 + tree;
    TINT[1] = 0.93 - Math.abs(dry) * 0.03 + j * 0.05 + tree * 0.5;
    TINT[2] = 0.88 - dry * 0.12 + j * 0.03;
  } else {
    const k = 0.94 + j * 0.08;
    TINT[0] = TINT[1] = TINT[2] = k;
  }
}

function waterDepthAt(i) {
  // células de água consecutivas a partir de i para baixo (máx. 15)
  let d = 0;
  while (d < 15 && VOL[i] === B.WATER) { d++; i -= LA; }
  return d;
}

function buildChunk(c) {
  const { cx, cz } = c;
  const { top, emit } = fillVolume(cx, cz);
  computeLight(top, emit);
  const opq = GB_OPQ, cut = GB_CUT, wat = GB_WAT;
  opq.reset(); cut.reset(); wat.reset();
  const x0 = cx * CS, z0 = cz * CS;
  const vegD = VEG_DENSITY[eff.veg] || 0;
  const seed = world.seed;
  const yEnd = Math.min(H - 1, c.maxY);
  const lv = [0, 0, 0, 0], bv = [0, 0, 0, 0], aos = [3, 3, 3, 3];
  for (let y = 0; y <= yEnd; y++) for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
    const i = vi(x, y, z);
    const id = VOL[i];
    if (!id) continue;
    const wx = x0 + x, wz = z0 + z;
    if (id === B.WATER) { meshWater(wat, i, x, y, z); continue; }
    const def = BLOCKS[id];
    const G = CUTOUT[id] ? cut : opq;
    let tinted = false;
    const emissive = EMIT[id] > 0;
    for (let f = 0; f < 6; f++) {
      const nid = VOL[i + FACE_OFF[f]];
      if (!TRANSP[nid] || nid === id) continue;
      if (!tinted) { tintFor(id, wx, y, wz); tinted = true; }
      const F = FACES[f];
      const tile = def.t[F.tile];
      const t = uvCache[tile];
      const ao = AO_OFF[f];
      const a = i + FACE_OFF[f]; // célula em frente à face
      for (let k = 0; k < 4; k++) {
        const s1 = i + ao[k][0], s2 = i + ao[k][1], cc = i + ao[k][2];
        const o1 = OCC[VOL[s1]], o2 = OCC[VOL[s2]], o3 = OCC[VOL[cc]];
        aos[k] = (o1 && o2) ? 0 : 3 - (o1 + o2 + o3);
        // luz suave: média das células transparentes ao redor do vértice
        let ls = SKYL[a], lb = BLKL[a], n = 1;
        const t1 = !LOPQ[VOL[s1]], t2 = !LOPQ[VOL[s2]];
        if (t1) { ls += SKYL[s1]; lb += BLKL[s1]; n++; }
        if (t2) { ls += SKYL[s2]; lb += BLKL[s2]; n++; }
        if ((t1 || t2) && !LOPQ[VOL[cc]]) { ls += SKYL[cc]; lb += BLKL[cc]; n++; }
        lv[k] = ls / n; bv[k] = lb / n;
      }
      const base = G.count;
      // rotação/espelhamento aleatório da textura para reduzir repetição
      let rot = 0, mir = false;
      if (ROT[id]) {
        const r = hash2(wx * 3 + f, wz * 5 - y, y + 1013);
        if (f === 2 || f === 3) rot = (r * 4) | 0; else mir = r < 0.5;
      }
      const flags = (CUTOUT[id] && id !== B.GLASS ? 1 : 0) | (emissive ? 4 : 0) | (nid === B.WATER ? 8 : 0);
      const tintK = (def.tint === 'grass' && f !== 2) ? 0.5 : 1;
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
    if (id === B.GRASS && vegD > 0 && y + 1 < H && VOL[i + LA] === B.AIR && hash2(wx, wz, seed + 99) < vegD) {
      const r = hash2(wz, wx, seed + 55);
      const tile = r < 0.07 ? TILE.FLOWER_RED : r < 0.14 ? TILE.FLOWER_YELLOW : TILE.TALLGRASS;
      tintFor(B.GRASS, wx, y, wz);
      addPlant(cut, x, y + 1, z, wx, wz, tile, SKYL[i + LA], BLKL[i + LA]);
    }
  }
  disposeChunkMeshes(c);
  const go = opq.build(), gc = cut.build(), gw = wat.build();
  const shadows = eff.shadows > 0;
  if (go) {
    c.mesh = new THREE.Mesh(go, mats.opaque);
    c.mesh.castShadow = c.mesh.receiveShadow = shadows;
  }
  if (gc) {
    c.cut = new THREE.Mesh(gc, mats.cutout);
    c.cut.customDepthMaterial = mats.depth;
    c.cut.castShadow = c.cut.receiveShadow = shadows;
  }
  if (gw) {
    c.water = new THREE.Mesh(gw, mats.water);
    c.water.renderOrder = 3;
  }
  for (const m of [c.mesh, c.cut, c.water]) if (m) {
    m.position.set(cx * CS, 0, cz * CS);
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    scene.add(m);
  }
  c.dirty = false;
  c.built = true;
}

function addPlant(G, x, y, z, wx, wz, tile, sky, blk) {
  const t = uvCache[tile];
  const h0 = hash2(wx, wz, 11);
  const ox = (h0 - 0.5) * 0.3, oz = (hash2(wz, wx, 12) - 0.5) * 0.3;
  const ht = tile === TILE.TALLGRASS ? 0.7 + 0.3 * h0 : 0.85;
  const grass = tile === TILE.TALLGRASS;
  const planes = [[0.15, 0.15, 0.85, 0.85], [0.15, 0.85, 0.85, 0.15]];
  for (const [ax, az, bx, bz] of planes) for (let side = 0; side < 2; side++) {
    const base = G.count;
    const P = [[ax, 0, az, 0, 1], [bx, 0, bz, 1, 1], [bx, ht, bz, 1, 0], [ax, ht, az, 0, 0]];
    const cr = grass ? Math.round(TINT[0] * 255) : 240, cg = grass ? Math.round(TINT[1] * 255) : 240, cb = grass ? Math.round(TINT[2] * 255) : 240;
    for (const [px, py, pz, pu, pv] of P) {
      G.vert(x + px + ox, y + py, z + pz + oz, 0, 127, 0, pu ? t[2] : t[0], pv ? t[3] : t[1], cr, cg, cb, pv ? 200 : 255, sky * 17, blk * 17, pv ? 0 : 2);
    }
    if (side) G.quad(base, base + 2, base + 1, base, base + 3, base + 2);
    else G.quad(base, base + 1, base + 2, base, base + 2, base + 3);
  }
}

function meshWater(G, i, x, y, z) {
  const lowered = VOL[i + LA] !== B.WATER;
  for (let f = 0; f < 6; f++) {
    const nid = VOL[i + FACE_OFF[f]];
    if (!TRANSP[nid] || nid === B.WATER) continue;
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
      if (lowered && vy === y + 1) { vy -= 0.12; top = true; }
      // profundidade suavizada no vértice (média das 4 colunas vizinhas) → margens claras
      let depth;
      if (f === 2) {
        const dx = vx > x + 0.5 ? 1 : -1, dz = vz > z + 0.5 ? LW : -LW;
        depth = (waterDepthAt(i) + waterDepthAt(i + dx) + waterDepthAt(i + dz) + waterDepthAt(i + dx + dz)) / 4;
      } else depth = waterDepthAt(i);
      G.vert(vx, vy, vz, F.n[0] * 127, F.n[1] * 127, F.n[2] * 127, 0, 0, 255, 255, 255, Math.round(depth * 17), sky * 17, blk * 17, top ? 16 : 0);
    }
    G.quad(base, base + 1, base + 2, base, base + 2, base + 3);
  }
}

function disposeChunkMeshes(c) {
  for (const k of ['mesh', 'cut', 'water']) {
    const m = c[k];
    if (m) { scene.remove(m); m.geometry.dispose(); c[k] = null; }
  }
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
let needCache = null, needKey = '';
// vizinhos de um bloco editado na borda: refeitos primeiro nos quadros seguintes
const urgent = new Set();
function updateChunks(budgetMs) {
  const t0 = performance.now();
  for (const c of urgent) {
    urgent.delete(c);
    if (world.chunks.get(c.key) === c && c.dirty) buildChunk(c);
    if (performance.now() - t0 > budgetMs) break;
  }
  const p = player.pos;
  const rd = eff.rd;
  const key = Math.floor(p.x / CS) + ',' + Math.floor(p.z / CS) + ',' + rd;
  if (key !== needKey) { needCache = neededChunks(p.x, p.z, rd); needKey = key; }
  for (const [cx, cz] of needCache) {
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
function rebuildAllChunks() {
  if (!world) return;
  for (const c of world.chunks.values()) c.dirty = true;
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

// ---------------- particles (instanciadas: 1 draw call) ----------------
const P_COUNT = 64;
const particles = [];
const pMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.13, 0.13, 0.13), new THREE.MeshLambertMaterial(), P_COUNT);
pMesh.frustumCulled = false;
const _m4 = new THREE.Matrix4(), _zero = new THREE.Matrix4().makeScale(0, 0, 0), _pc = new THREE.Color();
for (let i = 0; i < P_COUNT; i++) {
  particles.push({ pos: new THREE.Vector3(), v: new THREE.Vector3(), life: 0 });
  pMesh.setMatrixAt(i, _zero);
  pMesh.setColorAt(i, _pc.setRGB(1, 1, 1));
}
scene.add(pMesh);
let pNext = 0;
function burst(x, y, z, id) {
  const c = atlas.avg[BLOCKS[id].t[1]];
  for (let i = 0; i < 12; i++) {
    const idx = pNext; pNext = (pNext + 1) % P_COUNT;
    const p = particles[idx];
    const f = 0.8 + Math.random() * 0.3;
    pMesh.setColorAt(idx, _pc.setRGB(c[0] * f, c[1] * f, c[2] * f, THREE.SRGBColorSpace));
    p.pos.set(x + 0.2 + Math.random() * 0.6, y + 0.2 + Math.random() * 0.6, z + 0.2 + Math.random() * 0.6);
    p.v.set((Math.random() - 0.5) * 4, Math.random() * 4, (Math.random() - 0.5) * 4);
    p.life = 0.5 + Math.random() * 0.4;
  }
  pMesh.instanceColor.needsUpdate = true;
}
function updateParticles(dt) {
  let any = false;
  for (let i = 0; i < P_COUNT; i++) {
    const p = particles[i];
    if (p.life <= 0) continue;
    any = true;
    p.life -= dt;
    if (p.life <= 0) { pMesh.setMatrixAt(i, _zero); continue; }
    p.v.y -= 18 * dt;
    p.pos.addScaledVector(p.v, dt);
    const q = p.pos;
    if (SOLID[world.getBlock(Math.floor(q.x), Math.floor(q.y - 0.07), Math.floor(q.z))]) { p.v.set(0, 0, 0); q.y = Math.floor(q.y - 0.07) + 1.07; }
    pMesh.setMatrixAt(i, _m4.makeTranslation(q.x, q.y, q.z));
  }
  if (any || pDirty) { pMesh.instanceMatrix.needsUpdate = true; pDirty = any; }
}
let pDirty = false;

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

function makeIcon(id, size = 48) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const t = BLOCKS[id].t, k = size / 48;
  const T = atlas.tileSize;
  const tile = (i) => { const r = uvCache[i]; return [r[0] * atlas.width, r[1] * atlas.height]; };
  const face = (ti, m, shade) => {
    ctx.save();
    ctx.setTransform(m[0] * k, m[1] * k, m[2] * k, m[3] * k, m[4] * k, m[5] * k);
    const [sx, sy] = tile(ti);
    ctx.drawImage(atlasCanvas, sx, sy, T, T, 0, 0, 16, 16);
    if (shade) { ctx.globalCompositeOperation = 'source-atop'; ctx.fillStyle = `rgba(0,0,0,${shade})`; ctx.fillRect(0, 0, 16, 16); }
    ctx.restore();
  };
  face(t[0], [20 / 16, -10 / 16, 20 / 16, 10 / 16, 4, 14], 0);
  face(t[1], [20 / 16, 10 / 16, 0, 22 / 16, 4, 14], 0.2);
  face(t[1], [20 / 16, -10 / 16, 0, 22 / 16, 24, 24], 0.4);
  return cv;
}
function buildHotbar() {
  hotbarEl.innerHTML = '';
  HOTBAR.forEach((id, i) => {
    const s = document.createElement('div');
    s.className = 'slot' + (i === selected ? ' sel' : '');
    s.appendChild(makeIcon(id));
    const pick = (e) => { e.preventDefault(); e.stopPropagation(); selectSlot(i); };
    s.addEventListener('touchstart', pick, { passive: false });
    s.addEventListener('mousedown', pick);
    hotbarEl.appendChild(s);
  });
}
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
let toastTimer = 0;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
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
const showSettings = () => { rdInput.value = settings.rd; $('rdv').textContent = settings.rd; $('sensv').textContent = (+settings.sens).toFixed(1); };
showSettings();
rdInput.addEventListener('input', () => {
  settings.rd = +rdInput.value;
  if (settings.preset !== 'custom') settings.preset = 'custom';
  showSettings(); saveSettings(); applyGraphics('rd'); gfxPanel.refresh();
});
sensInput.addEventListener('input', () => { settings.sens = +sensInput.value; showSettings(); saveSettings(); });

function saveGame() {
  if (!world) return;
  const edits = {};
  for (const [k, m] of world.edits) edits[k] = Array.from(m);
  const p = player.pos;
  try {
    localStorage.setItem('vc_world', JSON.stringify({
      v: 1, gen: world.gen, seed: world.seed, edits, time: gameTime, sel: selected,
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
        const top = world.getBlock(x, y, z);
        if (top !== B.LEAVES && top !== B.PINE_LEAVES) {
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
  // mundos antigos mantêm o gerador original (gen 1); mundos novos usam o gerador v2
  const gen = save ? (save.gen || 1) : 2;
  world = new World(seed, edits, gen);
  player.fly = false;
  if (save && save.player) {
    const s = save.player;
    player.pos.set(s.x, s.y, s.z); player.yaw = s.yaw; player.pitch = s.pitch; player.fly = !!s.fly;
    gameTime = save.time ?? 0.3;
    selectSlot(Math.min(save.sel || 0, HOTBAR.length - 1));
  } else {
    spawnPlayer(); player.yaw = 0; player.pitch = 0; gameTime = 0.3; selectSlot(0);
  }
  needKey = '';
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
  showGfx(false);
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
  const near = neededChunks(player.pos.x, player.pos.z, Math.min(2, eff.rd));
  for (let i = 0; i < near.length; i++) {
    const c = world.getChunk(near[i][0], near[i][1]);
    if (c.dirty || !c.built) buildChunk(c);
    if (i % 4 === 3) { setStatus(`Gerando mundo... ${Math.round(i / near.length * 100)}%`); await new Promise(r => setTimeout(r, 0)); }
  }
  setStatus('');
  $('play').disabled = $('newworld').disabled = false;
  if (pendingReload) {
    saveGame();
    try { sessionStorage.setItem('vc_resume', '1'); } catch (e) { }
    location.reload();
    return;
  }
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
window.onAndroidBack = () => {
  if (gfxEl.classList.contains('open')) { showGfx(false); return; }
  if (playing) openMenu(); else if (world) closeMenu();
};
document.addEventListener('visibilitychange', () => { if (document.hidden) { saveGame(); if (playing) openMenu(); } });
window.addEventListener('pagehide', saveGame);
setInterval(() => { if (dirtySave || playing) saveGame(); }, 8000);
updateMenu();

// ---------------- configurações gráficas ----------------
const gfxEl = $('gfx');
let pendingReload = false;
const gfxPanel = buildPanel($('gfx-body'), settings, (key) => {
  saveSettings();
  showSettings();
  applyGraphics(key);
});
function showGfx(on) {
  gfxEl.classList.toggle('open', on);
  menu.classList.toggle('gfx-mode', on);
  if (on) gfxPanel.refresh();
}
$('btn-gfx').addEventListener('click', () => showGfx(true));
$('gfx-close').addEventListener('click', () => {
  showGfx(false);
  if (pendingReload) setStatus('O antialiasing será aplicado ao continuar (o renderizador reinicia).');
});

let appliedShadowLevel = -1, lastAA = !!eff.aa;
function applyGraphics(key) {
  const prev = eff;
  eff = effective(settings);
  const all = key === undefined;
  if (all || prev.tex !== eff.tex || prev.normalMaps !== eff.normalMaps || prev.pbr !== eff.pbr) {
    if (all || prev.tex !== eff.tex) {
      // o layout do atlas é proporcional ao tamanho do tile: as UVs das malhas continuam válidas
      buildTextures();
      buildHotbar();
    }
    makeTerrainMaterials();
  }
  if (all || prev.water !== eff.water) {
    if (eff.water >= 3 && !reflRT) {
      const s = new THREE.Vector2(); renderer.getDrawingBufferSize(s);
      reflRT = new THREE.WebGLRenderTarget(Math.max(1, s.x >> 1), Math.max(1, s.y >> 1), { type: halfFloatRT ? THREE.HalfFloatType : THREE.UnsignedByteType });
    } else if (eff.water < 3 && reflRT) { reflRT.dispose(); reflRT = null; }
    makeWaterMat();
  }
  if (all || prev.clouds !== eff.clouds) {
    clouds.visible = eff.clouds > 0;
    if (eff.clouds > 0) { const old = cloudMat; cloudMat = makeCloudMaterial(eff.clouds); clouds.material = cloudMat; old.dispose(); }
  }
  if (all || prev.veg !== eff.veg) { if (!all) rebuildAllChunks(); }
  if (all || prev.res !== eff.res) resize();
  if (all || prev.shadows !== eff.shadows) applyShadows();
  if (all || prev.envMap !== eff.envMap) { envAngle = -99; if (!eff.envMap) { scene.environment = null; if (envRT) { envRT.dispose(); envRT = null; } } }
  if (all || prev.rd !== eff.rd) needKey = '';
  U.uCaustics.value = eff.water >= 2 ? 1 : 0;
  if (!!eff.aa !== lastAA) pendingReload = true;
  else pendingReload = false;
}
function applyShadows() {
  const lvl = SHADOW_LEVELS[eff.shadows];
  const on = !!lvl;
  const was = renderer.shadowMap.enabled;
  renderer.shadowMap.enabled = on;
  sunLight.castShadow = on;
  if (on) {
    renderer.shadowMap.type = lvl.soft ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    sunLight.shadow.mapSize.set(lvl.size, lvl.size);
    sunLight.shadow.radius = lvl.soft ? 1 : 1.5;
    const cam = sunLight.shadow.camera;
    cam.left = cam.bottom = -lvl.range; cam.right = cam.top = lvl.range;
    cam.updateProjectionMatrix();
    if (sunLight.shadow.map) { sunLight.shadow.map.dispose(); sunLight.shadow.map = null; }
    U.uShadowRange.value = lvl.range;
  } else U.uShadowRange.value = 1e6;
  if (world) for (const c of world.chunks.values()) for (const m of [c.mesh, c.cut]) if (m) { m.castShadow = m.receiveShadow = on; }
  if (was !== on || appliedShadowLevel !== eff.shadows) {
    for (const m of [mats.opaque, mats.cutout]) if (m) m.needsUpdate = true;
  }
  appliedShadowLevel = eff.shadows;
  shadowDirty = true;
}

// ---------------- céu / dia e noite ----------------
const C = (r, g, b) => new THREE.Color(r, g, b);
const PAL = {
  zDay: C(0.05, 0.17, 0.6), hDay: C(0.36, 0.55, 0.86),
  zNight: C(0.003, 0.006, 0.02), hNight: C(0.012, 0.02, 0.045),
  zTwi: C(0.12, 0.14, 0.32), hTwi: C(0.62, 0.4, 0.32),
  glowDay: C(0.9, 0.8, 0.6), glowTwi: C(1.3, 0.5, 0.15),
  sunNoon: C(1.0, 0.94, 0.85), sunSet: C(1.0, 0.5, 0.22), moon: C(0.45, 0.55, 0.95),
  under: C(0.02, 0.1, 0.16),
};
const sunDir = new THREE.Vector3(), lightDir = new THREE.Vector3(), _c1 = new THREE.Color(), _c2 = new THREE.Color();
const smoothstep = (a, b, v) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
let skyInfo = { day: 1, night: 0 };
function updateSky(dt) {
  if (playing) gameTime = (gameTime + dt / DAY_LEN) % 1;
  const ang = gameTime * Math.PI * 2;
  sunDir.set(Math.cos(ang), Math.sin(ang), 0.25).normalize();
  const sy = sunDir.y;
  const day = smoothstep(-0.12, 0.3, sy);
  const night = 1 - smoothstep(-0.3, 0.02, sy);
  const twi = Math.exp(-Math.pow(sy / 0.2, 2));
  skyInfo = { day, night };
  U.uSunDir.value.copy(sunDir);
  U.uNight.value = night;
  U.uZenith.value.copy(PAL.zNight).lerp(PAL.zDay, day).lerp(PAL.zTwi, twi * 0.45);
  U.uHorizon.value.copy(PAL.hNight).lerp(PAL.hDay, day).lerp(PAL.hTwi, twi * 0.55 * smoothstep(-0.25, 0.0, sy));
  U.uSunGlow.value.copy(PAL.glowDay).lerp(PAL.glowTwi, twi).multiplyScalar(smoothstep(-0.2, 0.05, sy));
  U.uSunDisc.value.setRGB(14, 11, 7).lerp(_c1.setRGB(14, 5, 1.5), twi).multiplyScalar(smoothstep(-0.06, 0.02, sy));
  // luz direcional: sol de dia, lua à noite (direção quantizada para estabilizar sombras)
  const qa = Math.round(ang / (Math.PI * 2 / 720)) * (Math.PI * 2 / 720);
  lightDir.set(Math.cos(qa), Math.sin(qa), 0.25).normalize();
  const L = settings.light;
  let li;
  if (lightDir.y >= 0) {
    li = 2.8 * smoothstep(0.0, 0.14, lightDir.y);
    _c2.copy(PAL.sunNoon).lerp(PAL.sunSet, twi);
  } else {
    lightDir.negate();
    li = 0.5 * smoothstep(0.0, 0.14, lightDir.y);
    _c2.copy(PAL.moon);
  }
  sunLight.color.copy(_c2);
  sunLight.intensity = li * L;
  U.uLightDir.value.copy(lightDir);
  U.uLightCol.value.copy(_c2).multiplyScalar(li * L);
  // luz ambiente (hemisfério) acompanha a cor do céu
  const envOn = !!scene.environment;
  hemi.color.copy(U.uHorizon.value).lerp(U.uZenith.value, 0.5);
  hemi.groundColor.setRGB(0.28, 0.23, 0.17).multiplyScalar(0.25 + 0.75 * day);
  hemi.intensity = (envOn ? 1.6 : 2.8) * L * (0.3 + 0.7 * day) + 0.9 * night * L;
  U.uAmbient.value.copy(hemi.color).multiplyScalar(hemi.intensity * 0.5);
  U.uMinLight.value = 0.03 + 0.03 * (L - 0.5);
  renderer.toneMappingExposure = 0.95 * (1 + 0.9 * night);
  // nuvens
  if (cloudMat.uniforms.uCloudLit) {
    cloudMat.uniforms.uCloudLit.value.copy(_c2).multiplyScalar(0.25 + 1.25 * day).add(_c1.setRGB(0.05, 0.06, 0.1).multiplyScalar(night));
    cloudMat.uniforms.uCloudShade.value.copy(U.uHorizon.value).lerp(U.uZenith.value, 0.3).multiplyScalar(0.75);
  }
  // neblina / água subaquática
  const rdBlocks = (eff.rd - 0.5) * CS;
  U.uFogEnd.value = rdBlocks;
  U.uFogStart.value = rdBlocks * 0.2;
  U.uFogDensity.value = settings.fog ? (0.75 / rdBlocks) * settings.fogDensity : 0;
  U.uUnderwater.value = player.headInWater ? 1 : 0;
  U.uUnderColor.value.copy(PAL.under).multiplyScalar(0.25 + 0.75 * day + 0.15);
  sky.position.copy(camera.position);
  clouds.position.set(camera.position.x, 112, camera.position.z);
  return qa;
}

// sombras estáveis: centro alinhado aos texels do mapa de sombras
let shadowDirty = true, lastShadowKey = '';
const _lx = new THREE.Vector3(), _ly = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _ctr = new THREE.Vector3();
function updateShadows(force) {
  const lvl = SHADOW_LEVELS[eff.shadows];
  if (!lvl || !renderer.shadowMap.enabled) { renderer.shadowMap.needsUpdate = false; return; }
  const due = force || shadowDirty || frameNo % lvl.every === 0;
  if (!due) return;
  const texel = (lvl.range * 2) / lvl.size;
  _lx.crossVectors(_up, lightDir).normalize();
  _ly.crossVectors(lightDir, _lx);
  const p = camera.position;
  const ax = Math.round(p.dot(_lx) / texel) * texel, ay = Math.round(p.dot(_ly) / texel) * texel, az = p.dot(lightDir);
  _ctr.copy(_lx).multiplyScalar(ax).addScaledVector(_ly, ay).addScaledVector(lightDir, az);
  sunLight.target.position.copy(_ctr);
  sunLight.position.copy(_ctr).addScaledVector(lightDir, 200);
  sunLight.target.updateMatrixWorld();
  sunLight.updateMatrixWorld();
  U.uShadowCenter.value.copy(_ctr);
  renderer.shadowMap.needsUpdate = true;
  shadowDirty = false;
}

// reflexos planares da água (qualidade Ultra)
const reflCam = new THREE.PerspectiveCamera();
const _rw = new THREE.Vector3(), _cw = new THREE.Vector3(), _rot = new THREE.Matrix4(), _look = new THREE.Vector3(), _tgt = new THREE.Vector3(), _view = new THREE.Vector3(), _nrm = new THREE.Vector3(0, 1, 0);
const _plane = new THREE.Plane(), _clip = new THREE.Vector4(), _q = new THREE.Vector4();
const reflMat = new THREE.Matrix4();
function renderReflection() {
  const wm = mats.water;
  if (!reflRT || !wm || eff.water < 3) { if (wm) wm.uniforms.uUseRefl.value = 0; return; }
  const wl = SEA + 0.88;
  if (camera.position.y < wl + 0.05 || player.headInWater) { wm.uniforms.uUseRefl.value = 0; return; }
  _rw.set(camera.position.x, wl, camera.position.z);
  _cw.setFromMatrixPosition(camera.matrixWorld);
  _rot.extractRotation(camera.matrixWorld);
  _look.set(0, 0, -1).applyMatrix4(_rot).add(_cw);
  _view.subVectors(_rw, _cw).reflect(_nrm).negate().add(_rw);
  _tgt.subVectors(_rw, _look).reflect(_nrm).negate().add(_rw);
  reflCam.position.copy(_view);
  reflCam.up.set(0, 1, 0).applyMatrix4(_rot).reflect(_nrm);
  reflCam.lookAt(_tgt);
  reflCam.far = camera.far;
  reflCam.updateMatrixWorld();
  reflCam.projectionMatrix.copy(camera.projectionMatrix);
  reflMat.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
  reflMat.multiply(reflCam.projectionMatrix).multiply(reflCam.matrixWorldInverse);
  // plano de corte oblíquo (não desenha o que está abaixo da água)
  _plane.setFromNormalAndCoplanarPoint(_nrm, _rw).applyMatrix4(reflCam.matrixWorldInverse);
  _clip.set(_plane.normal.x, _plane.normal.y, _plane.normal.z, _plane.constant);
  const pm = reflCam.projectionMatrix.elements;
  _q.x = (Math.sign(_clip.x) + pm[8]) / pm[0];
  _q.y = (Math.sign(_clip.y) + pm[9]) / pm[5];
  _q.z = -1.0;
  _q.w = (1.0 + pm[10]) / pm[14];
  _clip.multiplyScalar(2.0 / _clip.dot(_q));
  pm[2] = _clip.x; pm[6] = _clip.y; pm[10] = _clip.z + 1.0 - 0.003; pm[14] = _clip.w;
  const hidden = [];
  for (const c of world.chunks.values()) if (c.water && c.water.visible) { c.water.visible = false; hidden.push(c.water); }
  const sb = selBox.visible; selBox.visible = false; pMesh.visible = false;
  renderer.setRenderTarget(reflRT);
  renderer.clear();
  renderer.render(scene, reflCam);
  renderer.setRenderTarget(null);
  for (const m of hidden) m.visible = true;
  selBox.visible = sb; pMesh.visible = true;
  wm.uniforms.uReflMat.value.copy(reflMat);
  wm.uniforms.uUseRefl.value = 1;
  wm.uniforms.uWaterLevel.value = wl;
}

function updateEnv(ang) {
  if (!eff.envMap) return;
  if (Math.abs(ang - envAngle) < 0.06 && envRT) return;
  envAngle = ang;
  const rt = pmrem.fromScene(envScene, 0, 0.1, 1000);
  if (envRT) envRT.dispose();
  envRT = rt;
  scene.environment = rt.texture;
}

// ---------------- main loop ----------------
const infoEl = $('info'), waterOverlay = $('water-overlay');
let last = performance.now(), fpsAcc = 0, fpsN = 0, fps = 0, lastFrame = 0;
let lowFpsTime = 0, autoCooldown = 0;
function autoQuality(dt) {
  if (!settings.auto || !playing) { lowFpsTime = 0; return; }
  autoCooldown -= dt;
  const target = eff.fpsCap ? eff.fpsCap : 60;
  if (fps > 0 && fps < target * 0.62) lowFpsTime += dt; else lowFpsTime = Math.max(0, lowFpsTime - dt * 2);
  if (lowFpsTime > 5 && autoCooldown <= 0) {
    lowFpsTime = 0; autoCooldown = 12;
    const cur = PRESET_ORDER.indexOf(settings.preset);
    const lvl = cur >= 0 ? cur : settings.shadows >= 4 ? 3 : settings.shadows >= 3 ? 2 : settings.shadows >= 1 ? 1 : 0;
    if (lvl > 0) {
      const next = PRESET_ORDER[lvl - 1];
      const keepAA = settings.aa;
      applyPreset(settings, next);
      settings.aa = keepAA; // evita reiniciar o renderizador no meio do jogo
      saveSettings(); applyGraphics('auto'); gfxPanel.refresh(); showSettings();
      toast(`FPS baixo: qualidade reduzida para ${PRESET_NAMES[next]}`);
    } else if (settings.res > 0.5) {
      settings.res = Math.max(0.5, settings.res - 0.25);
      settings.preset = 'custom';
      saveSettings(); applyGraphics('res'); gfxPanel.refresh();
      toast('FPS baixo: resolução reduzida');
    }
  }
}

function loop(now) {
  requestAnimationFrame(loop);
// retoma o jogo após reiniciar o renderizador (troca de antialiasing)
try {
  if (sessionStorage.getItem('vc_resume')) { sessionStorage.removeItem('vc_resume'); if (loadSave()) prepareAndPlay(loadSave(), true); }
} catch (e) { }
  if (eff.fpsCap && now - lastFrame < 1000 / eff.fpsCap - 2) return;
  lastFrame = now;
  const dt = Math.max(0, Math.min(0.1, (now - last) / 1000));
  last = now;
  fpsAcc += dt; fpsN++;
  if (fpsAcc > 0.5) { fps = Math.round(fpsN / fpsAcc); fpsAcc = 0; fpsN = 0; }
  U.uTime.value = now / 1000;
  if (!world) {
    camera.rotation.set(0.25, now / 60000, 0);
    updateSky(0);
    renderer.render(scene, camera);
    return;
  }
  if (playing) {
    const steps = Math.ceil(dt / 0.02);
    for (let i = 0; i < steps; i++) physics(dt / steps);
  }
  const p = player.pos;
  camera.position.set(p.x, p.y + EYE, p.z);
  camera.rotation.set(player.pitch, player.yaw, 0);
  camera.updateMatrixWorld();
  player.headInWater = world.getBlock(Math.floor(p.x), Math.floor(p.y + EYE), Math.floor(p.z)) === B.WATER;
  waterOverlay.style.display = player.headInWater ? 'block' : 'none';
  updateChunks(playing ? 6 : 12);
  updateParticles(dt);
  const qa = updateSky(dt);
  updateShadows(false);
  updateEnv(qa);
  const h = playing ? raycast(6) : null;
  if (h) { selBox.visible = true; selBox.position.set(h.x + 0.5, h.y + 0.5, h.z + 0.5); } else selBox.visible = false;
  if (frameNo % 10 === 0) infoEl.textContent = `${fps} FPS  ·  X ${Math.floor(p.x)}  Y ${Math.floor(p.y)}  Z ${Math.floor(p.z)}  ·  ${PRESET_NAMES[settings.preset]}${settings.eco ? ' (economia)' : ''}`;
  renderReflection();
  renderer.render(scene, camera);
  autoQuality(dt);
}

// ---------------- init ----------------
applyGraphics();
buildHotbar();
resize();
camera.position.set(0, 40, 0);
// depuração/testes automatizados
window.__vc = { get world() { return world; }, buildChunk, player, settings, get eff() { return eff; }, B, placeBlock, breakBlock, selectSlot, renderer, scene, camera, applyGraphics, setTime: (t) => { gameTime = t; } };
requestAnimationFrame(loop);
// retoma o jogo após reiniciar o renderizador (troca de antialiasing)
try {
  if (sessionStorage.getItem('vc_resume')) { sessionStorage.removeItem('vc_resume'); if (loadSave()) prepareAndPlay(loadSave(), true); }
} catch (e) { }
