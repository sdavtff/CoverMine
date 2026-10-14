// Renderizador do VoxelCraft: texturas, materiais, céu, nuvens, luzes, sombras, reflexos,
// gerenciamento de malhas de chunks (construídas em Web Workers) e pipeline de quadro.
import * as THREE from './lib/three.module.min.js';
import { G, hook } from './state.js';
import { buildAtlas, tileUV, atlasToCanvas } from './textures.js';
import { TILE_COUNT } from './tiles.js';
import { U, makeSkyMaterial, makeCloudMaterial, makeWaterMaterial, patchTerrainMaterial, makeDepthMaterial } from './shaders.js';
import { SHADOW_LEVELS, VEG_DENSITY, effective } from './graphics.js';
import { idbGet, idbSet } from './idb.js';
import { meshChunk } from './mesher.js';
import { CS } from './world.js';

export const R = {
  atlas: null, atlasCanvas: null, uv: [], tex: { albedo: null, normal: null, orm: null },
  mats: { opaque: null, cutout: null, depth: null, water: null },
  reflRT: null, maxAniso: 1, halfFloatRT: false, frameNo: 0,
  stats: { meshMain: 0, meshWorker: 0 },
};
const ATLAS_VERSION = 'atlas-v3.0';

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
  R.sun = new THREE.DirectionalLight(0xffffff, 3);
  R.sun.shadow.bias = -0.0004; R.sun.shadow.normalBias = 0.03;
  R.sun.shadow.camera.near = 1; R.sun.shadow.camera.far = 420;
  scene.add(R.sun, R.sun.target);
  R.hemi = new THREE.HemisphereLight(0x9cc4ff, 0x4a3b2a, 1.4);
  scene.add(R.hemi);
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
export async function loadTextures(T, onStatus) {
  const key = ATLAS_VERSION + '-' + T;
  let atlas = null;
  try { atlas = await idbGet('cache', key); } catch (e) { atlas = null; }
  if (!atlas || !atlas.albedo || atlas.albedo.length !== atlas.width * atlas.height * 4) {
    onStatus && onStatus('Gerando texturas...');
    atlas = await buildAtlasAsync(T);
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
function buildAtlasAsync(T) {
  return new Promise((resolve) => {
    try {
      const url = new URL('./atlas-worker.js', import.meta.url);
      const w = url.origin !== location.origin
        ? new Worker(URL.createObjectURL(new Blob([`import ${JSON.stringify(url.href)};`], { type: 'text/javascript' })), { type: 'module' })
        : new Worker(url, { type: 'module' });
      const timer = setTimeout(() => { w.terminate(); resolve(buildAtlas(T)); }, 60000);
      w.onmessage = (e) => { clearTimeout(timer); w.terminate(); resolve(e.data); };
      w.onerror = () => { clearTimeout(timer); w.terminate(); resolve(buildAtlas(T)); };
      w.postMessage({ T });
    } catch (e) { resolve(buildAtlas(T)); }
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
    return patchTerrainMaterial(m);
  };
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
  if (all || prev.tex !== eff.tex) await loadTextures(eff.tex);
  if (all || prev.tex !== eff.tex || prev.normalMaps !== eff.normalMaps || prev.pbr !== eff.pbr) makeTerrainMaterials();
  if (all || prev.water !== eff.water) {
    if (eff.water >= 3 && !R.reflRT) {
      const s = new THREE.Vector2(); G.renderer.getDrawingBufferSize(s);
      R.reflRT = new THREE.WebGLRenderTarget(Math.max(1, s.x >> 1), Math.max(1, s.y >> 1), { type: R.halfFloatRT ? THREE.HalfFloatType : THREE.UnsignedByteType });
    } else if (eff.water < 3 && R.reflRT) { R.reflRT.dispose(); R.reflRT = null; }
    makeWaterMat();
  }
  if (all || prev.clouds !== eff.clouds) {
    R.clouds.visible = eff.clouds > 0;
    if (eff.clouds > 0) { const old = R.cloudMat; R.cloudMat = makeCloudMaterial(eff.clouds); R.clouds.material = R.cloudMat; old.dispose(); }
  }
  if (!all && prev.veg !== eff.veg) rebuildAllChunks();
  if (all || prev.res !== eff.res) resize();
  if (all || prev.shadows !== eff.shadows) applyShadows();
  if (all || prev.envMap !== eff.envMap) { R.envAngle = -99; if (!eff.envMap) { G.scene.environment = null; if (R.envRT) { R.envRT.dispose(); R.envRT = null; } } }
  if (all || prev.rd !== eff.rd) R.needKey = '';
  U.uCaustics.value = eff.water >= 2 ? 1 : 0;
  hook('graphicsApplied', key, prev, eff);
  return !!eff.aa !== R.createdAA;
}
let appliedShadowLevel = -1;
function applyShadows() {
  const eff = G.eff, renderer = G.renderer;
  const lvl = SHADOW_LEVELS[eff.shadows];
  const on = !!lvl;
  const was = renderer.shadowMap.enabled;
  renderer.shadowMap.enabled = on;
  R.sun.castShadow = on;
  if (on) {
    renderer.shadowMap.type = lvl.soft ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    R.sun.shadow.mapSize.set(lvl.size, lvl.size);
    R.sun.shadow.radius = lvl.soft ? 1 : 1.5;
    const cam = R.sun.shadow.camera;
    cam.left = cam.bottom = -lvl.range; cam.right = cam.top = lvl.range;
    cam.updateProjectionMatrix();
    if (R.sun.shadow.map) { R.sun.shadow.map.dispose(); R.sun.shadow.map = null; }
    U.uShadowRange.value = lvl.range;
  } else U.uShadowRange.value = 1e6;
  if (G.world) for (const c of G.world.chunks.values()) for (const m of [c.mesh, c.cut]) if (m) { m.castShadow = m.receiveShadow = on; }
  if (was !== on || appliedShadowLevel !== eff.shadows) for (const m of [R.mats.opaque, R.mats.cutout]) if (m) m.needsUpdate = true;
  appliedShadowLevel = eff.shadows;
  R.shadowDirty = true;
  hook('shadowsApplied', on);
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
  const shadows = G.eff.shadows > 0;
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
  U.uZenith.value.copy(PAL.zNight).lerp(PAL.zDay, day).lerp(PAL.zTwi, twi * 0.45).lerp(_c3.copy(PAL.zStorm).multiplyScalar(0.2 + 0.8 * day), wet * 0.85);
  U.uHorizon.value.copy(PAL.hNight).lerp(PAL.hDay, day).lerp(PAL.hTwi, twi * 0.55 * smoothstep(-0.25, 0.0, sy)).lerp(_c3.copy(PAL.hStorm).multiplyScalar(0.15 + 0.85 * day), wet * 0.85);
  U.uSunGlow.value.copy(PAL.glowDay).lerp(PAL.glowTwi, twi).multiplyScalar(smoothstep(-0.2, 0.05, sy) * (1 - wet * 0.85));
  U.uSunDisc.value.setRGB(14, 11, 7).lerp(_c1.setRGB(14, 5, 1.5), twi).multiplyScalar(smoothstep(-0.06, 0.02, sy) * (1 - wet));
  if (weather.flash > 0) { U.uZenith.value.lerp(_c1.setRGB(1.6, 1.7, 2), weather.flash * 0.6); U.uHorizon.value.lerp(_c1.setRGB(1.4, 1.5, 1.8), weather.flash * 0.6); }
  const qa = Math.round(ang / (Math.PI * 2 / 720)) * (Math.PI * 2 / 720);
  lightDir.set(Math.cos(qa), Math.sin(qa), 0.25).normalize();
  const L = settings.light;
  let li;
  if (lightDir.y >= 0) { li = 2.8 * smoothstep(0.0, 0.14, lightDir.y); _c2.copy(PAL.sunNoon).lerp(PAL.sunSet, twi); }
  else { lightDir.negate(); li = 0.5 * smoothstep(0.0, 0.14, lightDir.y); _c2.copy(PAL.moon); }
  li *= 1 - wet * 0.8;
  R.sun.color.copy(_c2);
  R.sun.intensity = li * L;
  U.uLightDir.value.copy(lightDir);
  U.uLightCol.value.copy(_c2).multiplyScalar(li * L);
  const envOn = !!G.scene.environment;
  R.hemi.color.copy(U.uHorizon.value).lerp(U.uZenith.value, 0.5);
  R.hemi.groundColor.setRGB(0.28, 0.23, 0.17).multiplyScalar(0.25 + 0.75 * day);
  R.hemi.intensity = ((envOn ? 1.6 : 2.8) * L * (0.3 + 0.7 * day) + 0.9 * night * L) * (1 + wet * 0.4) + weather.flash * 6;
  U.uAmbient.value.copy(R.hemi.color).multiplyScalar(R.hemi.intensity * 0.5);
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
  U.uUnderwater.value = under ? 1 : 0;
  U.uUnderColor.value.copy(under === 2 ? PAL.underLava : PAL.under).multiplyScalar(under === 2 ? 1 : 0.25 + 0.75 * day + 0.15);
  R.sky.position.copy(G.camera.position);
  R.clouds.position.set(G.camera.position.x, 112 + (G.world ? G.world.sea - 22 : 0), G.camera.position.z);
  return qa;
}

const _lx = new THREE.Vector3(), _ly = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _ctr = new THREE.Vector3();
export function updateShadows(force) {
  const lvl = SHADOW_LEVELS[G.eff.shadows];
  const renderer = G.renderer;
  if (!lvl || !renderer.shadowMap.enabled) { renderer.shadowMap.needsUpdate = false; return; }
  if (!(force || R.shadowDirty || R.frameNo % lvl.every === 0)) return;
  const texel = (lvl.range * 2) / lvl.size;
  _lx.crossVectors(_up, lightDir).normalize();
  _ly.crossVectors(lightDir, _lx);
  const p = G.camera.position;
  const ax = Math.round(p.dot(_lx) / texel) * texel, ay = Math.round(p.dot(_ly) / texel) * texel, az = p.dot(lightDir);
  _ctr.copy(_lx).multiplyScalar(ax).addScaledVector(_ly, ay).addScaledVector(lightDir, az);
  R.sun.target.position.copy(_ctr);
  R.sun.position.copy(_ctr).addScaledVector(lightDir, 200);
  R.sun.target.updateMatrixWorld();
  R.sun.updateMatrixWorld();
  U.uShadowCenter.value.copy(_ctr);
  renderer.shadowMap.needsUpdate = true;
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
