// Renderizador do VoxelCraft: texturas, materiais, céu, nuvens, luzes, sombras, reflexos,
// gerenciamento de malhas de chunks (construídas em Web Workers) e pipeline de quadro.
import * as THREE from './lib/three.module.min.js';
import { G, hook } from './state.js';
import { buildAtlas, tileUV, atlasToCanvas } from './textures.js';
import { TILE_COUNT } from './tiles.js';
import { U, makeSkyMaterial, makeCloudMaterial, makeWaterMaterial, patchTerrainMaterial, makeDepthMaterial } from './shaders.js';
import { SHADOW_LEVELS, VEG_DENSITY, effective } from './graphics.js';
import { L as LIGHT, initLighting, applyLighting, updateCascades, physicalSky, updateProbe, updateGround, updateDynamicLights, resetGroundCache } from './lighting.js';
import { BIOME_GRASS } from './worldgen.js';
import { idbGet, idbSet } from './idb.js';
import { meshChunk } from './mesher.js';
import { CS } from './world.js';

export const R = {
  atlas: null, atlasCanvas: null, uv: [], tex: { albedo: null, normal: null, orm: null },
  mats: { opaque: null, cutout: null, depth: null, water: null },
  reflRT: null, maxAniso: 1, halfFloatRT: false, frameNo: 0,
  stats: { meshMain: 0, meshWorker: 0 },
};
const ATLAS_VERSION = 'atlas-v3.4';

// ---------------- inicialização ----------------
export function initRenderer(canvas) {
  const eff = G.eff;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !!eff.aa, powerPreference: 'high-performance', stencil: false });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.autoUpdate = false;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(75, 1, 0.06, 1100);
  camera.rotation.order = 'YXZ';
  G.renderer = renderer; G.scene = scene; G.camera = camera;
  R.createdAA = !!eff.aa;
  R.maxAniso = renderer.capabilities.getMaxAnisotropy();
  R.halfFloatRT = renderer.capabilities.isWebGL2 && (renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float'));

  R.sky = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), makeSkyMaterial(1));
  R.sky.frustumCulled = false; R.sky.renderOrder = -10;
  scene.add(R.sky);
  R.cloudMat = makeCloudMaterial(Math.max(1, eff.clouds));
  R.clouds = new THREE.Mesh(new THREE.PlaneGeometry(1800, 1800, 1, 1), R.cloudMat);
  R.clouds.rotation.x = -Math.PI / 2; R.clouds.frustumCulled = false; R.clouds.renderOrder = 2;
  scene.add(R.clouds);
  // sol (cascata 0 das sombras) + cascatas extras, sonda de luz ambiente e luzes dinâmicas
  R.sun = initLighting(scene);
  // a luz hemisférica antiga virou uma sonda de harmônicos esféricos (lighting.js); o objeto fica só para cálculos
  R.hemi = new THREE.HemisphereLight(0x9cc4ff, 0x4a3b2a, 0);
  R.pmrem = new THREE.PMREMGenerator(renderer);
  R.envScene = new THREE.Scene();
  R.envScene.add(new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), makeSkyMaterial(0)));
  R.envRT = null; R.envAngle = -99;
  R.selBox = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55 }));
  R.selBox.visible = false;
  scene.add(R.selBox);
  // rachaduras ao minerar (overlay sobre o bloco)
  R.crackTex = makeCrackTexture();
  R.crack = new THREE.Mesh(new THREE.BoxGeometry(1.004, 1.004, 1.004), new THREE.MeshBasicMaterial({ map: R.crackTex[0], transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, toneMapped: false }));
  R.crack.visible = false; R.crack.renderOrder = 4;
  scene.add(R.crack);
  // tratamento de perda de contexto WebGL (comum em Android ao trocar de app)
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); R.lost = true; hook('contextLost'); }, false);
  canvas.addEventListener('webglcontextrestored', () => {
    R.lost = false;
    for (const k in R.tex) if (R.tex[k]) R.tex[k].needsUpdate = true;
    if (G.world) for (const c of G.world.chunks.values()) G.world.markDirty(c);
    R.shadowDirty = true; R.envAngle = -99;
    hook('contextRestored');
  }, false);
  return renderer;
}

function makeCrackTexture() {
  const out = [];
  for (let s = 0; s < 6; s++) {
    const cv = document.createElement('canvas'); cv.width = cv.height = 64;
    const ctx = cv.getContext('2d');
    ctx.strokeStyle = 'rgba(0,0,0,0.75)'; ctx.lineWidth = 2;
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let k = 0; k <= s * 2 + 1; k++) {
      let x = 32, y = 32;
      ctx.beginPath(); ctx.moveTo(x, y);
      const a = rnd() * Math.PI * 2;
      for (let j = 0; j < 4 + s; j++) { x += Math.cos(a + (rnd() - 0.5) * 1.6) * 6; y += Math.sin(a + (rnd() - 0.5) * 1.6) * 6; ctx.lineTo(x, y); }
      ctx.stroke();
    }
    const t = new THREE.CanvasTexture(cv); t.magFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace;
    out.push(t);
  }
  return out;
}

// ---------------- texturas ----------------
function makeDataTex(data) {
  const a = R.atlas;
  const t = new THREE.DataTexture(data, a.width, a.height, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = Math.min(R.maxAniso, G.eff.tex >= 128 ? 8 : G.eff.tex >= 64 ? 4 : 1);
  t.needsUpdate = true;
  return t;
}
// gera (em worker, com cache no IndexedDB) e aplica o atlas
// pacote de texturas em imagem (textures/pack.png): 16×6 células na ordem dos tiles
async function loadPack() {
  try {
    const url = new URL('./textures/pack.png', import.meta.url);
    const blob = await (await fetch(url)).blob();
    const bmp = await createImageBitmap(blob);
    const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height;
    const ctx = cv.getContext('2d'); ctx.drawImage(bmp, 0, 0);
    const d = ctx.getImageData(0, 0, bmp.width, bmp.height);
    return { data: d.data, w: bmp.width, h: bmp.height, cols: 16, rows: 6, cell: bmp.width / 16 };
  } catch (e) { console.warn('pacote de texturas indisponível', e); return null; }
}
export async function loadTextures(T, onStatus) {
  const usePack = (G.eff && G.eff.texPack) !== 'proc';
  const key = ATLAS_VERSION + '-' + T + (usePack ? '-pack2' : '');
  let atlas = null;
  try { atlas = await idbGet('cache', key); } catch (e) { atlas = null; }
  if (!atlas || !atlas.albedo || atlas.albedo.length !== atlas.width * atlas.height * 4) {
    onStatus && onStatus('Gerando texturas...');
    const pack = usePack ? await loadPack() : null;
    atlas = await buildAtlasAsync(T, pack);
    idbSet('cache', key, atlas).catch(() => {});
  }
  R.atlas = atlas;
  for (const k in R.tex) if (R.tex[k]) R.tex[k].dispose();
  R.tex.albedo = makeDataTex(atlas.albedo); R.tex.albedo.colorSpace = THREE.SRGBColorSpace;
  R.tex.normal = makeDataTex(atlas.normal); R.tex.normal.colorSpace = THREE.NoColorSpace;
  R.tex.orm = makeDataTex(atlas.orm); R.tex.orm.colorSpace = THREE.NoColorSpace;
  R.atlasCanvas = atlasToCanvas(atlas);
  R.uv = [];
  for (let t = 0; t < TILE_COUNT; t++) R.uv[t] = tileUV(t, atlas);
  if (G.world) G.world.setUV(R.uv);
  hook('texturesChanged');
}
function buildAtlasAsync(T, pack) {
  return new Promise((resolve) => {
    try {
      const url = new URL('./atlas-worker.js', import.meta.url);
      const w = url.origin !== location.origin
        ? new Worker(URL.createObjectURL(new Blob([`import ${JSON.stringify(url.href)};`], { type: 'text/javascript' })), { type: 'module' })
        : new Worker(url, { type: 'module' });
      const timer = setTimeout(() => { w.terminate(); resolve(buildAtlas(T, null, pack)); }, 60000);
      w.onmessage = (e) => { clearTimeout(timer); w.terminate(); resolve(e.data); };
      w.onerror = () => { clearTimeout(timer); w.terminate(); resolve(buildAtlas(T, null, pack)); };
      w.postMessage({ T, pack });
    } catch (e) { resolve(buildAtlas(T, null, pack)); }
  });
}

export function makeTerrainMaterials() {
  const eff = G.eff, tex = R.tex, mats = R.mats;
  const mk = (cut) => {
    const p = { map: tex.albedo, vertexColors: true };
    if (cut) p.alphaTest = 0.5;
    if (eff.normalMaps) { p.normalMap = tex.normal; p.normalScale = new THREE.Vector2(1, 1); }
    p.aoMap = tex.orm; p.aoMapIntensity = 0.8;
    const m = eff.pbr
      ? new THREE.MeshStandardMaterial(Object.assign(p, { roughnessMap: tex.orm, roughness: 1, metalness: 0, envMapIntensity: 0.6 }))
      : new THREE.MeshLambertMaterial(p);
    m.userData.vcMat = eff.mat | 0;
    return patchTerrainMaterial(m);
  };
  // relevo (parallax): deslocamento máximo de ~4% do bloco, em unidades do atlas
  if (R.uv[1]) U.uPomScale.value = Math.abs(R.uv[1][2] - R.uv[1][0]) * 0.045;
  const old = Object.assign({}, mats);
  mats.opaque = mk(false);
  mats.cutout = mk(true);
  mats.depth = makeDepthMaterial(tex.albedo);
  for (const k of ['opaque', 'cutout', 'depth']) if (old[k]) old[k].dispose();
  if (G.world) for (const c of G.world.chunks.values()) {
    if (c.mesh) c.mesh.material = mats.opaque;
    if (c.cut) { c.cut.material = mats.cutout; c.cut.customDepthMaterial = mats.depth; }
  }
  hook('materialsChanged');
}
function makeWaterMat() {
  const old = R.mats.water;
  R.mats.water = makeWaterMaterial(G.eff.water, R.reflRT ? R.reflRT.texture : null);
  if (old) old.dispose();
  if (G.world) for (const c of G.world.chunks.values()) if (c.water) c.water.material = R.mats.water;
}

// ---------------- configurações ----------------
export function pixelRatio() { return Math.max(0.5, Math.min(window.devicePixelRatio || 1, G.eff.res)); }
export function resize() {
  const { renderer, camera } = G;
  renderer.setPixelRatio(pixelRatio());
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  if (R.reflRT) { const s = new THREE.Vector2(); renderer.getDrawingBufferSize(s); R.reflRT.setSize(Math.max(1, s.x >> 1), Math.max(1, s.y >> 1)); }
  hook('resized');
}

// aplica as configurações; key = opção alterada (undefined = tudo). Retorna true se precisa reiniciar (AA).
export async function applyGraphics(key) {
  const prev = G.eff || {};
  const eff = G.eff = effective(G.settings);
  const all = key === undefined;
  if (all || prev.tex !== eff.tex || prev.texPack !== eff.texPack) await loadTextures(eff.tex);
  if (all || prev.tex !== eff.tex || prev.texPack !== eff.texPack || prev.normalMaps !== eff.normalMaps || prev.pbr !== eff.pbr || prev.mat !== eff.mat) makeTerrainMaterials();
  if (all || prev.water !== eff.water) {
    if (eff.water >= 3 && !R.reflRT) {
      const s = new THREE.Vector2(); G.renderer.getDrawingBufferSize(s);
      R.reflRT = new THREE.WebGLRenderTarget(Math.max(1, s.x >> 1), Math.max(1, s.y >> 1), { type: R.halfFloatRT ? THREE.HalfFloatType : THREE.UnsignedByteType });
    } else if (eff.water < 3 && R.reflRT) { R.reflRT.dispose(); R.reflRT = null; }
    makeWaterMat();
  }
  if (all || prev.clouds !== eff.clouds) {
    R.clouds.visible = eff.clouds > 0 && !(G.world && G.world.dim && G.world.dim !== 'overworld');
    if (eff.clouds > 0) { const old = R.cloudMat; R.cloudMat = makeCloudMaterial(eff.clouds); R.clouds.material = R.cloudMat; old.dispose(); }
  }
  if (!all && prev.veg !== eff.veg) rebuildAllChunks();
  if (all || prev.res !== eff.res) resize();
  if (all || prev.shadows !== eff.shadows || prev.dynLights !== eff.dynLights || prev.torchShadows !== eff.torchShadows) applyLighting();
  if (all || prev.tex !== eff.tex || prev.texPack !== eff.texPack) resetGroundCache();
  if (all || prev.envMap !== eff.envMap) { R.envAngle = -99; if (!eff.envMap) { G.scene.environment = null; if (R.envRT) { R.envRT.dispose(); R.envRT = null; } } }
  if (all || prev.rd !== eff.rd) R.needKey = '';
  U.uCaustics.value = eff.water >= 2 ? 1 : 0;
  hook('graphicsApplied', key, prev, eff);
  return !!eff.aa !== R.createdAA;
}
// ---------------- malhas dos chunks ----------------
function makeGeometry(r) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(r.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(r.normal, 3, true));
  g.setAttribute('uv', new THREE.BufferAttribute(r.uv, 2));
  g.setAttribute('color', new THREE.BufferAttribute(r.color, 3, true));
  g.setAttribute('aLight', new THREE.BufferAttribute(r.light, 4, true));
  g.setIndex(new THREE.BufferAttribute(r.index, 1));
  g.computeBoundingSphere();
  return g;
}
export function disposeChunkMeshes(c) {
  for (const k of ['mesh', 'cut', 'water']) {
    const m = c[k];
    if (m) { G.scene.remove(m); m.geometry.dispose(); c[k] = null; }
  }
  c.built = false;
}
function applyMesh(c, res) {
  disposeChunkMeshes(c);
  const shadows = G.renderer.shadowMap.enabled;
  if (res.opaque) { c.mesh = new THREE.Mesh(makeGeometry(res.opaque), R.mats.opaque); c.mesh.castShadow = c.mesh.receiveShadow = shadows; }
  if (res.cutout) { c.cut = new THREE.Mesh(makeGeometry(res.cutout), R.mats.cutout); c.cut.customDepthMaterial = R.mats.depth; c.cut.castShadow = c.cut.receiveShadow = shadows; }
  if (res.water) { c.water = new THREE.Mesh(makeGeometry(res.water), R.mats.water); c.water.renderOrder = 3; }
  for (const m of [c.mesh, c.cut, c.water]) if (m) {
    m.position.set(c.cx * CS, 0, c.cz * CS);
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    G.scene.add(m);
  }
  c.built = true;
  hook('chunkMeshed', c);
}
// constrói no thread principal (edições do jogador: resposta imediata)
export function meshNow(c) {
  const veg = VEG_DENSITY[G.eff.veg] || 0;
  const res = meshChunk(G.world, c, { uv: R.uv, veg });
  c.meshing = c.version;
  c.dirty = false;
  applyMesh(c, res);
  R.stats.meshMain++;
}
export function onWorkerMeshed(m) {
  const w = G.world;
  if (!w) return;
  const c = w.chunks.get(m.key);
  if (!c) return;
  if (m.version !== c.version) return; // chunk mudou durante a construção: será refeito
  c.dirty = false;
  applyMesh(c, m.res);
  R.stats.meshWorker++;
}
export function rebuildAllChunks() { if (G.world) for (const c of G.world.chunks.values()) G.world.markDirty(c); }

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
R.urgent = new Set();
R.needKey = '';
const neighborsReady = (w, c) => {
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (!w.chunks.has((c.cx + dx) + ',' + (c.cz + dz))) return false;
  return true;
};
// carrega/gera/constrói chunks ao redor do jogador
export function updateChunks(budgetMs, center) {
  const w = G.world;
  const t0 = performance.now();
  const rd = G.eff.rd;
  const key = Math.floor(center.x / CS) + ',' + Math.floor(center.z / CS) + ',' + rd;
  if (key !== R.needKey) { R.need = neededChunks(center.x, center.z, rd + 1); R.needKey = key; }
  // 1) edições do jogador: malha imediata
  for (const c of R.urgent) {
    R.urgent.delete(c);
    if (w.chunks.get(c.key) === c && c.dirty) meshNow(c);
  }
  // 2) pede geração (ordem de distância, poucos de cada vez para manter a prioridade)
  for (const [cx, cz] of R.need) {
    if (w.pending.size >= 10) break;
    if (!w.has(cx, cz)) w.request(cx, cz);
  }
  // 3) malhas: workers (assíncrono) ou thread principal dentro do orçamento
  const rd2 = rd * rd + 1;
  const pcx = Math.floor(center.x / CS), pcz = Math.floor(center.z / CS);
  for (const [cx, cz, d2] of R.need) {
    if (d2 > rd2) continue;
    const c = w.chunks.get(cx + ',' + cz);
    if (!c || !c.dirty || c.meshing === c.version) continue;
    if (!neighborsReady(w, c)) continue;
    if (w.workers.length && w.uv) {
      if ((w.meshBusy || 0) >= 4) break;
      w.requestMesh(c, VEG_DENSITY[G.eff.veg] || 0);
    } else {
      meshNow(c);
      if (performance.now() - t0 > budgetMs) break;
    }
  }
  // 4) descarrega regiões distantes
  if (++R.frameNo % 30 === 0) {
    for (const [k, c] of w.chunks) {
      const d = Math.max(Math.abs(c.cx - pcx), Math.abs(c.cz - pcz));
      if (d > rd + 2 && c.built) disposeChunkMeshes(c);
      if (d > rd + 4) { disposeChunkMeshes(c); w.chunks.delete(k); hook('chunkUnloaded', c); }
    }
  }
}
// reação a edições de blocos: o chunk editado é refeito já; vizinhos (luz) pelos workers
export function onBlockEdited(c, lx, y, lz) {
  const w = G.world;
  w.markDirty(c);
  R.urgent.add(c);
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dz) continue;
    const n = w.chunks.get((c.cx + dx) + ',' + (c.cz + dz));
    if (!n) continue;
    w.markDirty(n);
    const edge = !((dx === -1 && lx !== 0) || (dx === 1 && lx !== CS - 1) || (dz === -1 && lz !== 0) || (dz === 1 && lz !== CS - 1));
    if (edge) R.urgent.add(n);
  }
  R.shadowDirty = true;
}

// ---------------- céu / dia e noite ----------------
const C = (r, g, b) => new THREE.Color(r, g, b);
const PAL = {
  zDay: C(0.05, 0.17, 0.6), hDay: C(0.36, 0.55, 0.86),
  zNight: C(0.003, 0.006, 0.02), hNight: C(0.012, 0.02, 0.045),
  zTwi: C(0.12, 0.14, 0.32), hTwi: C(0.62, 0.4, 0.32),
  zStorm: C(0.1, 0.11, 0.13), hStorm: C(0.32, 0.34, 0.37),
  glowDay: C(0.9, 0.8, 0.6), glowTwi: C(1.3, 0.5, 0.15),
  sunNoon: C(1.0, 0.94, 0.85), sunSet: C(1.0, 0.5, 0.22), moon: C(0.45, 0.55, 0.95),
  under: C(0.02, 0.1, 0.16), underLava: C(0.5, 0.12, 0.02),
};
export const sunDir = new THREE.Vector3(), lightDir = new THREE.Vector3();
const _c1 = new THREE.Color(), _c2 = new THREE.Color(), _c3 = new THREE.Color();
const smoothstep = (a, b, v) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
R.sky01 = { day: 1, night: 0 };
// weather: { rain 0..1, storm 0..1, flash 0..1 } (clima)
export function updateSky(weather = { rain: 0, storm: 0, flash: 0 }, under = 0) {
  const settings = G.settings, eff = G.eff;
  const ang = G.gameTime * Math.PI * 2;
  sunDir.set(Math.cos(ang), Math.sin(ang), 0.25).normalize();
  const sy = sunDir.y;
  const day = smoothstep(-0.12, 0.3, sy);
  const night = 1 - smoothstep(-0.3, 0.02, sy);
  const twi = Math.exp(-Math.pow(sy / 0.2, 2));
  const wet = Math.max(weather.rain * 0.75, weather.storm);
  R.sky01 = { day, night, sunY: sy };
  U.uSunDir.value.copy(sunDir);
  U.uNight.value = night;
  U.uStarRot.value = -ang;
  U.uMoonPhase.value = (((G.day || 0) % 8) + 0.5) / 8;
  const phys = eff.sky ? physSky(ang) : null;
  if (phys) {
    // céu físico (dispersão atmosférica) + céu noturno + tom da "hora azul"
    U.uZenith.value.copy(phys.zenith).add(_c1.copy(PAL.zNight).multiplyScalar(night)).lerp(PAL.zTwi, twi * 0.25 * (1 - day)).lerp(_c3.copy(PAL.zStorm).multiplyScalar(0.2 + 0.8 * day), wet * 0.85);
    U.uHorizon.value.copy(phys.horizon).add(_c1.copy(PAL.hNight).multiplyScalar(night)).lerp(_c3.copy(PAL.hStorm).multiplyScalar(0.15 + 0.85 * day), wet * 0.85);
    U.uSunGlow.value.copy(phys.glow).multiplyScalar(1 - wet * 0.85);
    U.uSunDisc.value.copy(phys.sun).multiplyScalar(16 * smoothstep(-0.06, 0.02, sy) * (1 - wet));
  } else {
    U.uZenith.value.copy(PAL.zNight).lerp(PAL.zDay, day).lerp(PAL.zTwi, twi * 0.45).lerp(_c3.copy(PAL.zStorm).multiplyScalar(0.2 + 0.8 * day), wet * 0.85);
    U.uHorizon.value.copy(PAL.hNight).lerp(PAL.hDay, day).lerp(PAL.hTwi, twi * 0.55 * smoothstep(-0.25, 0.0, sy)).lerp(_c3.copy(PAL.hStorm).multiplyScalar(0.15 + 0.85 * day), wet * 0.85);
    U.uSunGlow.value.copy(PAL.glowDay).lerp(PAL.glowTwi, twi).multiplyScalar(smoothstep(-0.2, 0.05, sy) * (1 - wet * 0.85));
    U.uSunDisc.value.setRGB(14, 11, 7).lerp(_c1.setRGB(14, 5, 1.5), twi).multiplyScalar(smoothstep(-0.06, 0.02, sy) * (1 - wet));
  }
  if (weather.flash > 0) { U.uZenith.value.lerp(_c1.setRGB(1.6, 1.7, 2), weather.flash * 0.6); U.uHorizon.value.lerp(_c1.setRGB(1.4, 1.5, 1.8), weather.flash * 0.6); }
  const qa = Math.round(ang / (Math.PI * 2 / 720)) * (Math.PI * 2 / 720);
  lightDir.set(Math.cos(qa), Math.sin(qa), 0.25).normalize();
  const L = settings.light;
  let li;
  if (lightDir.y >= 0) {
    li = 2.8 * smoothstep(0.0, 0.14, lightDir.y);
    // céu físico: a cor do sol é a luz que atravessou a atmosfera (laranja no fim da tarde)
    if (phys) { _c2.copy(phys.sun); const m = Math.max(_c2.r, _c2.g, _c2.b, 1e-4); _c2.multiplyScalar(1 / m); li *= Math.min(1, m * 1.6); }
    else _c2.copy(PAL.sunNoon).lerp(PAL.sunSet, twi);
  }
  else { lightDir.negate(); li = 0.5 * smoothstep(0.0, 0.14, lightDir.y); _c2.copy(PAL.moon); }
  li *= 1 - wet * 0.8;
  R.sun.color.copy(_c2);
  R.sun.intensity = li * L;
  U.uLightDir.value.copy(lightDir);
  U.uLightCol.value.copy(_c2).multiplyScalar(li * L);
  const envOn = !!G.scene.environment;
  R.hemi.color.copy(U.uHorizon.value).lerp(U.uZenith.value, 0.5);
  R.hemi.groundColor.setRGB(0.28, 0.23, 0.17).multiplyScalar(0.25 + 0.75 * day);
  const ambI = ((envOn ? 1.6 : 2.8) * L * (0.3 + 0.7 * day) + 0.9 * night * L) * (1 + wet * 0.4) + weather.flash * 6;
  U.uAmbient.value.copy(R.hemi.color).multiplyScalar(ambI * 0.5);
  // luz ambiente: sonda SH com o céu atual e o rebote colorido do chão (atualizada algumas vezes por segundo)
  probeT -= 1;
  if (probeT <= 0 || weather.flash > 0.05) {
    probeT = 15;
    const grass = G.world && G.player ? BIOME_GRASS[G.world.biomeAt(Math.floor(G.player.pos.x), Math.floor(G.player.pos.z))] : null;
    updateGround(0.25, R.atlas, R.uv, grass);
    _c1.copy(U.uZenith.value).lerp(U.uHorizon.value, 0.5);
    const norm = Math.max(_c1.r, _c1.g, _c1.b, 1e-3);
    // a cor do céu define o tom; a intensidade segue a calibração antiga da luz hemisférica
    _zn.copy(U.uZenith.value).multiplyScalar(1 / norm * 0.62); _hz.copy(U.uHorizon.value).multiplyScalar(1 / norm * 0.62);
    updateProbe(_zn, _hz, _c2, lightDir, ambI, 0.25 + 0.75 * day);
  }
  U.uMinLight.value = 0.03 + 0.03 * (L - 0.5);
  G.renderer.toneMappingExposure = 0.95 * (1 + 0.9 * night) * (settings.exposure || 1);
  if (R.cloudMat.uniforms.uCloudLit) {
    R.cloudMat.uniforms.uCloudLit.value.copy(_c2).multiplyScalar((0.25 + 1.25 * day) * (1 - wet * 0.6)).add(_c1.setRGB(0.05, 0.06, 0.1).multiplyScalar(night));
    R.cloudMat.uniforms.uCloudShade.value.copy(U.uHorizon.value).lerp(U.uZenith.value, 0.3).multiplyScalar(0.75 - wet * 0.3);
    R.cloudMat.uniforms.uCover.value = 0.52 - wet * 0.42;
  }
  const rdBlocks = (eff.rd - 0.5) * CS;
  U.uFogEnd.value = rdBlocks;
  U.uFogStart.value = rdBlocks * 0.2 * (1 - wet * 0.8);
  U.uFogDensity.value = settings.fog ? (0.75 / rdBlocks) * settings.fogDensity * (1 + wet * 1.6) : wet * 0.01;
  U.uUnderwater.value = under === 2 ? 2 : under ? 1 : 0;
  // neblina de vale: de madrugada/manhã e depois da chuva, nas partes baixas
  const morning = Math.exp(-Math.pow(((G.gameTime + 0.5) % 1 - 0.5 + 0.02) / 0.07, 2));
  U.uFogValley.value = settings.fog ? (0.55 * morning + 0.25 * (weather.wet || 0)) * settings.fogDensity : 0;
  U.uFogHeight.value = (G.world ? G.world.sea : 46) + 3;
  U.uUnderColor.value.copy(under === 2 ? PAL.underLava : PAL.under).multiplyScalar(under === 2 ? 1 : 0.25 + 0.75 * day + 0.15);
  // materiais: chuva/neve/relâmpago/jogador/nuvens
  U.uWet.value = weather.wet || 0;
  U.uSnowCover.value = weather.snowCover || 0;
  U.uFlash.value = weather.flash || 0;
  if (G.player) { U.uPlayerPos.value.set(G.player.pos.x, G.player.pos.y, G.player.pos.z); U.uSnowCenter.value.copy(U.uPlayerPos.value); }
  U.uCloudCover.value = R.clouds.visible && R.cloudMat.uniforms.uCover ? R.cloudMat.uniforms.uCover.value : 2;
  R.sky.position.copy(G.camera.position);
  R.clouds.position.set(G.camera.position.x, 112 + (G.world ? G.world.sea - 22 : 0), G.camera.position.z);
  U.uCloudBase.value = R.clouds.position.y;
  const dim = G.world && G.world.dim !== 'overworld' ? G.world.dim : null;
  if (dim) dimensionSky(dim, eff, settings, rdBlocks);
  else if (R.dimClouds) { R.dimClouds = false; R.clouds.visible = eff.clouds > 0; }
  return qa;
}
// Nether: névoa vermelha densa, sem sol nem céu, luz ambiente quente mínima.
// End: céu escuro arroxeado com estrelas paradas, sem sol, luz ambiente fria.
let dimProbeT = 0;
function dimensionSky(dim, eff, settings, rdBlocks) {
  const neth = dim === 'nether';
  R.sky01 = { day: 0, night: 0, sunY: -1 };
  U.uNight.value = neth ? 0 : 1;
  U.uStarRot.value = 0.4;
  if (neth) { U.uZenith.value.setRGB(0.16, 0.035, 0.025); U.uHorizon.value.setRGB(0.3, 0.07, 0.04); }
  else { U.uZenith.value.setRGB(0.02, 0.012, 0.035); U.uHorizon.value.setRGB(0.09, 0.06, 0.12); }
  U.uSunGlow.value.setRGB(0, 0, 0); U.uSunDisc.value.setRGB(0, 0, 0);
  R.sun.intensity = 0; U.uLightCol.value.setRGB(0, 0, 0);
  const L = settings.light;
  if (neth) { R.hemi.color.setRGB(1, 0.45, 0.32); R.hemi.groundColor.setRGB(0.6, 0.2, 0.1); }
  else { R.hemi.color.setRGB(0.62, 0.55, 0.8); R.hemi.groundColor.setRGB(0.4, 0.38, 0.3); }
  const ambI = (neth ? 2.2 : 1.9) * L;
  U.uAmbient.value.copy(R.hemi.color).multiplyScalar(ambI * 0.5);
  if (--dimProbeT <= 0) {
    dimProbeT = 30;
    _c2.setRGB(0, 0, 0);
    if (neth) { _zn.setRGB(0.62, 0.3, 0.22); _hz.setRGB(0.62, 0.26, 0.16); } else { _zn.setRGB(0.42, 0.36, 0.62); _hz.setRGB(0.5, 0.44, 0.6); }
    updateProbe(_zn, _hz, _c2, lightDir, ambI, 0.6);
  }
  U.uMinLight.value = neth ? 0.34 : 0.2;
  G.renderer.toneMappingExposure = 0.95 * (neth ? 1.15 : 1.35) * (settings.exposure || 1);
  const fogEnd = neth ? Math.min(rdBlocks, 80) : rdBlocks;
  U.uFogEnd.value = fogEnd;
  U.uFogStart.value = neth ? 2 : rdBlocks * 0.35;
  U.uFogDensity.value = neth ? 2.2 / fogEnd * (settings.fogDensity || 1) : 0.5 / rdBlocks;
  U.uFogValley.value = 0;
  U.uWet.value = 0; U.uSnowCover.value = 0; U.uFlash.value = 0;
  if (!R.dimClouds) { R.dimClouds = true; R.clouds.visible = false; }
  U.uCloudCover.value = 2;
}

let probeT = 0, physKey = -1;
const _zn = new THREE.Color(), _hz = new THREE.Color();
const PHYS = { zenith: new THREE.Color(), horizon: new THREE.Color(), glow: new THREE.Color(), sun: new THREE.Color() };
const _sd = new THREE.Vector3();
// céu físico recalculado só quando o sol anda um passo (≈0,5°), não a cada quadro
function physSky(ang) {
  const key = Math.round(ang / (Math.PI * 2 / 720));
  if (key !== physKey) { physKey = key; const a = key * (Math.PI * 2 / 720); physicalSky(_sd.set(Math.cos(a), Math.sin(a), 0.25).normalize(), PHYS); probeT = 0; }
  return PHYS;
}
const _lx = new THREE.Vector3(), _ly = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _ctr = new THREE.Vector3();
export function updateShadows(force, dt = 1 / 60) {
  updateDynamicLights(dt);
  updateCascades(G.camera, lightDir, force || R.shadowDirty, dt);
  R.shadowDirty = false;
}

// reflexos planares da água (qualidade Ultra)
const reflCam = new THREE.PerspectiveCamera();
const _rw = new THREE.Vector3(), _cw = new THREE.Vector3(), _rot = new THREE.Matrix4(), _look = new THREE.Vector3(), _tgt = new THREE.Vector3(), _view = new THREE.Vector3(), _nrm = new THREE.Vector3(0, 1, 0);
const _plane = new THREE.Plane(), _clip = new THREE.Vector4(), _q = new THREE.Vector4();
const reflMat = new THREE.Matrix4();
export function renderReflection(hideList) {
  const wm = R.mats.water, camera = G.camera, renderer = G.renderer;
  if (!R.reflRT || !wm || G.eff.water < 3) { if (wm) wm.uniforms.uUseRefl.value = 0; return; }
  const wl = G.world.sea + 0.88;
  if (camera.position.y < wl + 0.05 || U.uUnderwater.value) { wm.uniforms.uUseRefl.value = 0; return; }
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
  for (const c of G.world.chunks.values()) if (c.water && c.water.visible) { c.water.visible = false; hidden.push(c.water); }
  for (const o of hideList || []) if (o && o.visible) { o.visible = false; hidden.push(o); }
  const sb = R.selBox.visible, ck = R.crack.visible; R.selBox.visible = false; R.crack.visible = false;
  renderer.setRenderTarget(R.reflRT);
  renderer.clear();
  renderer.render(G.scene, reflCam);
  renderer.setRenderTarget(null);
  for (const m of hidden) m.visible = true;
  R.selBox.visible = sb; R.crack.visible = ck;
  wm.uniforms.uReflMat.value.copy(reflMat);
  wm.uniforms.uUseRefl.value = 1;
  wm.uniforms.uWaterLevel.value = wl;
}

export function updateEnv(ang) {
  if (!G.eff.envMap) return;
  if (Math.abs(ang - R.envAngle) < 0.06 && R.envRT) return;
  R.envAngle = ang;
  const rt = R.pmrem.fromScene(R.envScene, 0, 0.1, 1000);
  if (R.envRT) R.envRT.dispose();
  R.envRT = rt;
  G.scene.environment = rt.texture;
}

// seleção e rachaduras
export function showSelection(hit, progress) {
  if (!hit) { R.selBox.visible = false; R.crack.visible = false; return; }
  let x0 = 0, y0 = 0, z0 = 0, x1 = 1, y1 = 1, z1 = 1;
  if (hit.boxes) {
    x0 = y0 = z0 = 16; x1 = y1 = z1 = 0;
    for (const b of hit.boxes) { x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1]); z0 = Math.min(z0, b[2]); x1 = Math.max(x1, b[3]); y1 = Math.max(y1, b[4]); z1 = Math.max(z1, b[5]); }
    x0 /= 16; y0 /= 16; z0 /= 16; x1 /= 16; y1 /= 16; z1 /= 16;
  }
  const e = 0.004;
  R.selBox.visible = true;
  R.selBox.scale.set(x1 - x0 + e, y1 - y0 + e, z1 - z0 + e);
  R.selBox.position.set(hit.x + (x0 + x1) / 2, hit.y + (y0 + y1) / 2, hit.z + (z0 + z1) / 2);
  if (progress > 0) {
    R.crack.visible = true;
    R.crack.material.map = R.crackTex[Math.min(5, Math.floor(progress * 6))];
    R.crack.scale.copy(R.selBox.scale);
    R.crack.position.copy(R.selBox.position);
  } else R.crack.visible = false;
}
