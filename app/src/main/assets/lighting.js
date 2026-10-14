// Iluminação do VoxelCraft (etapa 1 do plano de realismo):
//  - sombras do sol em cascata (CSM, até 3 mapas) com estabilização por texel e mistura entre cascatas;
//  - céu por dispersão atmosférica (Rayleigh + Mie, integrado na CPU) que também dá a cor do sol;
//  - luz ambiente por sonda de harmônicos esféricos (céu + rebote colorido do chão);
//  - luzes dinâmicas (tochas, lava, lâmpadas) para as fontes mais próximas, com tremulação e sombra opcional.
import * as THREE from './lib/three.module.min.js';
import { G } from './state.js';
import { SHADOW_LEVELS } from './graphics.js';
import { EMIT, BLOCKS, B } from './blocks.js';
import { CS, H } from './world.js';

export const L = {
  csm: [], probe: null, points: [], splits: [], lightDir: new THREE.Vector3(0, 1, 0),
  dirty: true, frame: 0, groundAlbedo: new THREE.Color(0.42, 0.4, 0.3), groundT: 0, emitT: 0, emitters: [],
  tileAvg: null, pointShadowT: 0,
};

// ---------------- criação ----------------
export function initLighting(scene) {
  for (let i = 0; i < 3; i++) {
    const d = new THREE.DirectionalLight(0xffffff, i === 0 ? 3 : 0);
    d.shadow.autoUpdate = false;
    d.shadow.bias = -0.0002;
    scene.add(d, d.target);
    L.csm.push(d);
  }
  L.probe = new THREE.LightProbe();
  scene.add(L.probe);
  for (let i = 0; i < 4; i++) {
    const p = new THREE.PointLight(0xffaa55, 0, 12, 2);
    p.visible = false;
    p.shadow.autoUpdate = false;
    p.shadow.mapSize.set(256, 256);
    p.shadow.camera.near = 0.1; p.shadow.camera.far = 12;
    p.shadow.bias = -0.004;
    scene.add(p);
    L.points.push(p);
  }
  return L.csm[0];
}

// aplica o nível de sombras (número de cascatas, resolução) e de luzes dinâmicas
export function applyLighting() {
  const eff = G.eff, renderer = G.renderer;
  const lvl = SHADOW_LEVELS[eff.shadows];
  const on = !!lvl;
  renderer.shadowMap.enabled = on || !!eff.torchShadows;
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.type = lvl && !lvl.soft ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
  L.splits = on ? lvl.splits.slice() : [];
  L.csm.forEach((d, i) => {
    const use = on && i < lvl.splits.length;
    d.castShadow = use;
    d.visible = i === 0 || use;
    if (use) {
      d.shadow.mapSize.set(lvl.size, lvl.size);
      d.shadow.radius = lvl.soft ? 1 : 1.5;
      if (d.shadow.map) { d.shadow.map.dispose(); d.shadow.map = null; }
      d.userData.r = 0;
    }
  });
  const n = eff.dynLights | 0;
  L.points.forEach((p, i) => { p.visible = i < n; p.intensity = 0; p.castShadow = i === 0 && n > 0 && !!eff.torchShadows; if (p.shadow.map && !p.castShadow) { p.shadow.map.dispose(); p.shadow.map = null; } });
  if (G.world) for (const c of G.world.chunks.values()) for (const m of [c.mesh, c.cut]) if (m) { m.castShadow = m.receiveShadow = renderer.shadowMap.enabled; }
  L.dirty = true;
}

// ---------------- cascatas ----------------
const _lx = new THREE.Vector3(), _ly = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _ctr = new THREE.Vector3(), _fw = new THREE.Vector3();
export function updateCascades(camera, lightDir, force, dt = 1 / 60) {
  const lvl = SHADOW_LEVELS[G.eff.shadows];
  const renderer = G.renderer;
  let any = false;
  if (lvl) {
    if (!L.lightDir.equals(lightDir)) { L.lightDir.copy(lightDir); L.dirty = true; }
    _lx.crossVectors(_up, lightDir);
    if (_lx.lengthSq() < 1e-6) _lx.set(1, 0, 0);
    _lx.normalize();
    _ly.crossVectors(lightDir, _lx);
    camera.getWorldDirection(_fw);
    const tanH = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2), tanW = tanH * camera.aspect;
    const k2 = tanW * tanW + tanH * tanH;
    let near = camera.near;
    L.frame++;
    for (let i = 0; i < lvl.splits.length; i++) {
      const d = L.csm[i], far = lvl.splits[i];
      // esfera que envolve a fatia do frustum: raio constante → sem tremulação ao girar a câmera
      let c = (far + near) * (1 + k2) / 2;
      let r;
      if (c >= far) { c = far; r = far * Math.sqrt(k2); } else r = Math.sqrt((far - c) * (far - c) + far * far * k2);
      r = Math.ceil(r + 1);
      const due = force || L.dirty || (L.frame % lvl.every[i]) === 0;
      if (!due) { near = far; continue; }
      const texel = (2 * r) / lvl.size;
      _ctr.copy(camera.position).addScaledVector(_fw, c);
      // encaixa o centro na grade de texels do mapa (sem "serrilhado andando")
      const ax = Math.round(_ctr.dot(_lx) / texel) * texel, ay = Math.round(_ctr.dot(_ly) / texel) * texel, az = _ctr.dot(lightDir);
      _ctr.copy(_lx).multiplyScalar(ax).addScaledVector(_ly, ay).addScaledVector(lightDir, az);
      const cam = d.shadow.camera;
      if (d.userData.r !== r) {
        d.userData.r = r;
        cam.left = cam.bottom = -r; cam.right = cam.top = r;
        cam.near = 0.5; cam.far = 2 * r + 260;
        cam.updateProjectionMatrix();
        d.shadow.normalBias = texel * 1.1;
      }
      d.target.position.copy(_ctr);
      d.position.copy(_ctr).addScaledVector(lightDir, r + 160);
      d.target.updateMatrixWorld();
      d.updateMatrixWorld();
      d.shadow.needsUpdate = true;
      any = true;
      near = far;
    }
  }
  // sombra da tocha mais próxima (atualiza ~10 vezes por segundo)
  const p0 = L.points[0];
  if (p0.castShadow && p0.intensity > 0) {
    L.pointShadowT -= dt;
    if (L.pointShadowT <= 0 || force) { L.pointShadowT = 0.1; p0.shadow.needsUpdate = true; any = true; }
  }
  L.dirty = false;
  renderer.shadowMap.needsUpdate = any;
}

// ---------------- céu físico (dispersão atmosférica simples) ----------------
// Rayleigh + Mie com 12 amostras na visada e 6 em direção ao sol. Unidades arbitrárias,
// calibradas para a escala de cores que os shaders do jogo já usam.
const RE = 6360e3, RA = 6420e3, HR = 7994, HM = 1200;
const BR = [5.8e-6, 13.5e-6, 33.1e-6], BM = 21e-6, MIE_G = 0.76;
// absorção do ozônio (deixa o crepúsculo e a "hora azul" azulados em vez de cinza-esverdeados)
const BO = [0.65e-6, 1.881e-6, 0.085e-6];
function raySphere(oy, dx, dy, dz, rad) {
  // origem (0, oy, 0); retorna a distância até sair da esfera de raio rad
  const b = oy * dy, c = oy * oy - rad * rad;
  const disc = b * b - c;
  if (disc < 0) return -1;
  return -b + Math.sqrt(disc);
}
export function scatter(dx, dy, dz, sx, sy, sz, out) {
  const oy = RE + 2;
  const tMax = raySphere(oy, dx, dy, dz, RA);
  const N = 12, M = 6, seg = tMax / N;
  const mu = dx * sx + dy * sy + dz * sz;
  const phR = 3 / (16 * Math.PI) * (1 + mu * mu);
  const g2 = MIE_G * MIE_G;
  const phM = 3 / (8 * Math.PI) * ((1 - g2) * (1 + mu * mu)) / ((2 + g2) * Math.pow(1 + g2 - 2 * MIE_G * mu, 1.5));
  let odR = 0, odM = 0, r = 0, g = 0, b = 0;
  for (let i = 0; i < N; i++) {
    const t = seg * (i + 0.5);
    const px = dx * t, py = oy + dy * t, pz = dz * t;
    const hgt = Math.sqrt(px * px + py * py + pz * pz) - RE;
    const hr = Math.exp(-hgt / HR) * seg, hm = Math.exp(-hgt / HM) * seg;
    odR += hr; odM += hm;
    // luz do sol até o ponto
    const pl = Math.sqrt(px * px + py * py + pz * pz);
    const ux = px / pl, uy = py / pl, uz = pz / pl;
    const cosT = ux * sx + uy * sy + uz * sz;
    const bb = pl * cosT, cc = pl * pl - RA * RA;
    const tl = -bb + Math.sqrt(Math.max(0, bb * bb - cc));
    const sl = tl / M;
    let lR = 0, lM = 0, blocked = false;
    for (let j = 0; j < M; j++) {
      const tj = sl * (j + 0.5);
      const qx = px + sx * tj, qy = py + sy * tj, qz = pz + sz * tj;
      const hj = Math.sqrt(qx * qx + qy * qy + qz * qz) - RE;
      if (hj < 0) { blocked = true; break; }
      lR += Math.exp(-hj / HR) * sl; lM += Math.exp(-hj / HM) * sl;
    }
    if (blocked) continue;
    const tr = (k) => Math.exp(-((BR[k] + BO[k]) * (odR + lR) + BM * 1.1 * (odM + lM)));
    r += tr(0) * hr * BR[0] * phR + tr(0) * hm * BM * phM;
    g += tr(1) * hr * BR[1] * phR + tr(1) * hm * BM * phM;
    b += tr(2) * hr * BR[2] * phR + tr(2) * hm * BM * phM;
  }
  return out.setRGB(r * 20, g * 20, b * 20);
}
// cor do sol depois de atravessar a atmosfera (transmitância)
export function sunTransmittance(sy, out) {
  const oy = RE + 2;
  const sx = Math.sqrt(Math.max(0, 1 - sy * sy));
  const t = raySphere(oy, sx, sy, 0, RA);
  if (t < 0 || sy < -0.12) return out.setRGB(0, 0, 0);
  const M = 8, sl = t / M;
  let oR = 0, oM = 0;
  for (let j = 0; j < M; j++) {
    const tj = sl * (j + 0.5);
    const qx = sx * tj, qy = oy + sy * tj;
    const hj = Math.sqrt(qx * qx + qy * qy) - RE;
    oR += Math.exp(-Math.max(hj, 0) / HR) * sl; oM += Math.exp(-Math.max(hj, 0) / HM) * sl;
  }
  return out.setRGB(Math.exp(-((BR[0] + BO[0]) * oR + BM * 1.1 * oM)), Math.exp(-((BR[1] + BO[1]) * oR + BM * 1.1 * oM)), Math.exp(-((BR[2] + BO[2]) * oR + BM * 1.1 * oM)));
}

const _a = new THREE.Color(), _b = new THREE.Color();
const SKY_SCALE = 1.25;
// calcula as cores do céu (zênite, horizonte, brilho perto do sol) e do sol para a direção do sol dada
export function physicalSky(sunDir, out) {
  const sx = sunDir.x, sy = sunDir.y, sz = sunDir.z;
  scatter(0, 1, 0, sx, sy, sz, out.zenith).multiplyScalar(SKY_SCALE);
  // horizonte "médio": média de direções afastadas do sol (perpendicular e oposta)
  const hx = -sz, hz = sx, hl = Math.hypot(hx, hz) || 1;
  const e = 0.15, ce = Math.sqrt(1 - e * e);
  scatter(hx / hl * ce, e, hz / hl * ce, sx, sy, sz, _a);
  scatter(-sx / (Math.hypot(sx, sz) || 1) * ce, e, -sz / (Math.hypot(sx, sz) || 1) * ce, sx, sy, sz, _b);
  out.horizon.copy(_a).add(_b).multiplyScalar(0.5 * SKY_SCALE);
  // aproximação do espalhamento múltiplo: horizonte mais esbranquiçado (o modelo simples o deixa saturado)
  const lum = out.horizon.r * 0.2126 + out.horizon.g * 0.7152 + out.horizon.b * 0.0722;
  out.horizon.lerp(_b.setRGB(lum * 0.92, lum, lum * 1.12), 0.35);
  out.zenith.add(_a.copy(out.horizon).multiplyScalar(0.08));
  // na direção do sol, logo acima do horizonte (crepúsculo laranja)
  const sl = Math.hypot(sx, sz) || 1;
  scatter(sx / sl * ce, e, sz / sl * ce, sx, sy, sz, _a).multiplyScalar(SKY_SCALE);
  out.glow.copy(_a).sub(out.horizon);
  out.glow.r = Math.max(0, out.glow.r); out.glow.g = Math.max(0, out.glow.g); out.glow.b = Math.max(0, out.glow.b);
  // limita o brilho do halo (o bloom e o disco do sol já cuidam do resto)
  const gm = Math.max(out.glow.r, out.glow.g, out.glow.b);
  if (gm > 0.8) out.glow.multiplyScalar(0.8 / gm);
  sunTransmittance(sy, out.sun);
  return out;
}

// ---------------- luz ambiente (sonda SH) ----------------
const SH_DIRS = [];
{
  const n = 48, ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) { const y = 1 - (i + 0.5) / n * 2, r = Math.sqrt(1 - y * y); SH_DIRS.push(new THREE.Vector3(Math.cos(i * ga) * r, y, Math.sin(i * ga) * r)); }
}
const _sh = new THREE.SphericalHarmonics3(), _col = new THREE.Color(), _basis = new Array(9).fill(0);
// sky(d) e ground devolvem a radiância "equivalente" usada antes pela luz hemisférica
export function updateProbe(zenith, horizon, sunCol, sunDir, scale, bounceScale) {
  if (!L.probe) return;
  const co = _sh.coefficients;
  for (const c of co) c.set(0, 0, 0);
  for (const d of SH_DIRS) {
    if (d.y >= 0) {
      _col.copy(horizon).lerp(zenith, Math.sqrt(d.y));
      // céu mais claro do lado do sol
      const s = Math.max(0, d.x * sunDir.x + d.y * sunDir.y + d.z * sunDir.z);
      _col.add(_a.copy(sunCol).multiplyScalar(s * s * 0.08));
    } else {
      // rebote: cor média do chão iluminado pelo sol e pelo céu
      _col.copy(L.groundAlbedo).multiply(_b.copy(sunCol).multiplyScalar(Math.max(sunDir.y, 0) * 0.35).add(_a.copy(zenith).lerp(horizon, 0.5).multiplyScalar(0.6))).multiplyScalar(bounceScale);
    }
    THREE.SphericalHarmonics3.getBasisAt(d, _basis);
    for (let i = 0; i < 9; i++) { co[i].x += _col.r * _basis[i]; co[i].y += _col.g * _basis[i]; co[i].z += _col.b * _basis[i]; }
  }
  const w = (4 * Math.PI / SH_DIRS.length) * scale / Math.PI;
  for (let i = 0; i < 9; i++) co[i].multiplyScalar(w);
  L.probe.sh.copy(_sh);
  L.probe.intensity = 1;
}

// cor média de cada textura (para o rebote de cor do chão)
function tileAverages(atlas, uv) {
  const out = [];
  if (!atlas || !uv) return out;
  const W = atlas.width, data = atlas.albedo;
  for (let t = 0; t < uv.length; t++) {
    const u = uv[t];
    if (!u) { out.push(null); continue; }
    const x0 = Math.floor(u[0] * W), x1 = Math.floor(u[2] * W), y0 = Math.floor((1 - u[3]) * atlas.height), y1 = Math.floor((1 - u[1]) * atlas.height);
    let r = 0, g = 0, b = 0, n = 0;
    for (let y = Math.min(y0, y1); y < Math.max(y0, y1); y += 4) for (let x = x0; x < x1; x += 4) {
      const i = (y * W + x) * 4; if (data[i + 3] < 128) continue;
      r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
    }
    out.push(n ? [Math.pow(r / n / 255, 2.2), Math.pow(g / n / 255, 2.2), Math.pow(b / n / 255, 2.2)] : null);
  }
  return out;
}
export function resetGroundCache() { L.tileAvg = null; }
// amostra o chão em volta do jogador a cada 2 s
export function updateGround(dt, atlas, uv, grassColor) {
  L.groundT -= dt;
  if (L.groundT > 0 || !G.world || !G.player) return;
  L.groundT = 2;
  if (!L.tileAvg) L.tileAvg = tileAverages(atlas, uv);
  const w = G.world, p = G.player.pos;
  let r = 0, g = 0, b = 0, n = 0;
  for (let dz = -8; dz <= 8; dz += 2) for (let dx = -8; dx <= 8; dx += 2) {
    const x = Math.floor(p.x) + dx, z = Math.floor(p.z) + dz;
    let y = Math.min(H - 1, Math.floor(p.y) + 3), id = 0;
    for (; y > Math.floor(p.y) - 12 && y > 0; y--) { id = w.getBlock(x, y, z); if (id && BLOCKS[id] && !BLOCKS[id].shape) break; }
    const blk = BLOCKS[id];
    if (!blk || !blk.t) continue;
    const avg = L.tileAvg[blk.t[0]];
    if (!avg) continue;
    let ar = avg[0], ag = avg[1], ab = avg[2];
    if (blk.tint && grassColor) { ar *= grassColor[0]; ag *= grassColor[1]; ab *= grassColor[2]; }
    r += ar; g += ag; b += ab; n++;
  }
  if (n) L.groundAlbedo.setRGB(r / n, g / n, b / n);
}

// ---------------- luzes dinâmicas ----------------
const EMIT_COLOR = {};
function emitColor(id) {
  if (EMIT_COLOR[id]) return EMIT_COLOR[id];
  let c = [1.0, 0.62, 0.3]; // tocha
  if (id === B.LAVA) c = [1.0, 0.35, 0.08];
  else if (id === B.CRYSTAL_ORE || id === B.CRYSTAL_BLOCK) c = [0.45, 0.7, 1.0];
  else if (id === B.LAMP || id === B.PLAMP_ON) c = [1.0, 0.85, 0.6];
  else if (id === B.FURNACE_LIT) c = [1.0, 0.5, 0.2];
  return (EMIT_COLOR[id] = c);
}
function chunkEmitters(c) {
  if (c.emitCache && c.emitCache.v === c.version) return c.emitCache.list;
  const list = [];
  if (c.emit > 0) {
    const d = c.data, top = Math.min(H, (c.maxY || H) + 1);
    for (let i = 0, n = top * CS * CS; i < n; i++) {
      const id = d[i];
      if (id && EMIT[id] >= 12) {
        const lx = i % CS, lz = ((i / CS) | 0) % CS, y = (i / (CS * CS)) | 0;
        // lava: só a superfície (evita centenas de luzes num lago de lava)
        if (id === B.LAVA && i + CS * CS < d.length && d[i + CS * CS] === B.LAVA) continue;
        list.push([c.cx * CS + lx + 0.5, y + 0.5, c.cz * CS + lz + 0.5, id]);
        if (list.length > 256) break;
      }
    }
  }
  c.emitCache = { v: c.version, list };
  return list;
}
export function updateDynamicLights(dt) {
  const n = G.eff.dynLights | 0;
  if (!n || !G.world || !G.player) { for (const p of L.points) p.intensity = 0; return; }
  const w = G.world, pp = G.player.pos;
  L.emitT -= dt;
  if (L.emitT <= 0) {
    L.emitT = 0.3;
    const cx = Math.floor(pp.x / CS), cz = Math.floor(pp.z / CS), all = [];
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const c = w.chunks.get((cx + dx) + ',' + (cz + dz));
      if (!c || !c.data) continue;
      for (const e of chunkEmitters(c)) {
        const d2 = (e[0] - pp.x) ** 2 + (e[1] - pp.y - 1) ** 2 + (e[2] - pp.z) ** 2;
        if (d2 < 196) all.push([d2, e]);
      }
    }
    all.sort((a, b) => a[0] - b[0]);
    // evita duas luzes quase no mesmo lugar (lago de lava, várias tochas juntas)
    const pick = [];
    for (const [, e] of all) { if (pick.every((q) => Math.abs(q[0] - e[0]) + Math.abs(q[1] - e[1]) + Math.abs(q[2] - e[2]) > 3)) pick.push(e); if (pick.length >= n) break; }
    L.emitters = pick;
  }
  const t = G.time || 0;
  L.points.forEach((p, i) => {
    const e = i < n ? L.emitters[i] : null;
    if (!e) { p.intensity = 0; return; }
    const id = e[3], col = emitColor(id);
    p.position.set(e[0], e[1] + (id === B.TORCH ? 0.2 : id === B.LAVA ? 0.6 : 0), e[2]);
    p.color.setRGB(col[0], col[1], col[2]);
    // tremulação: tochas e lava oscilam; lâmpadas ficam estáveis
    const flick = id === B.TORCH || id === B.LAVA || id === B.FURNACE_LIT
      ? 0.86 + 0.08 * Math.sin(t * 9.3 + i * 1.7) + 0.06 * Math.sin(t * 23.1 + i * 3.1) : 1;
    p.intensity = (id === B.LAVA ? 4 : 2.6) * flick * (G.settings.light || 1);
    p.distance = id === B.LAVA ? 14 : 11;
  });
}
