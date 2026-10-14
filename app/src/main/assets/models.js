// Modelos de caixas com textura em "rede" (estilo skin): jogador, criaturas e NPCs.
// Unidades em pixels (1/16 de bloco). Modelos olham para +z. Criaturas usam InstancedMesh por parte.
import * as THREE from './lib/three.module.min.js';
import { patchEntityMaterial } from './shaders.js';

// ---------- textura ----------
function noiseFill(ctx, x, y, w, h, col, amp = 14, seed = 1) {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const n = Math.sin((x + i) * 12.9898 + (y + j) * 78.233 + seed * 3.1) * 43758.5453;
    const r = (n - Math.floor(n) - 0.5) * amp;
    ctx.fillStyle = `rgb(${Math.max(0, Math.min(255, col[0] + r))},${Math.max(0, Math.min(255, col[1] + r))},${Math.max(0, Math.min(255, col[2] + r))})`;
    ctx.fillRect(x + i, y + j, 1, 1);
  }
}
// regiões da rede de uma caixa (w,h,d) em (u,v)
export function net(u, v, w, h, d) {
  return {
    top: [u + d, v, w, d], bottom: [u + d + w, v, w, d],
    right: [u, v + d, d, h], front: [u + d, v + d, w, h], left: [u + d + w, v + d, d, h], back: [u + 2 * d + w, v + d, w, h],
  };
}
export function paintBox(ctx, u, v, w, h, d, col, amp, seed, faces) {
  const n = net(u, v, w, h, d);
  for (const k in n) { const [x, y, ww, hh] = n[k]; noiseFill(ctx, x, y, ww, hh, (faces && faces[k]) || col, amp, seed); }
  return n;
}

function setBoxUV(geo, u, v, w, h, d, TW, TH, mirror) {
  const n = net(u, v, w, h, d);
  // ordem das faces do BoxGeometry: +x, -x, +y, -y, +z, -z
  const order = [n.left, n.right, n.top, n.bottom, n.front, n.back];
  const uv = geo.attributes.uv;
  for (let f = 0; f < 6; f++) {
    let [x, y, ww, hh] = order[f];
    let u0 = x / TW, u1 = (x + ww) / TW;
    if (mirror) { const t = u0; u0 = u1; u1 = t; }
    const v0 = 1 - y / TH, v1 = 1 - (y + hh) / TH;
    const i = f * 4;
    uv.setXY(i, u0, v0); uv.setXY(i + 1, u1, v0); uv.setXY(i + 2, u0, v1); uv.setXY(i + 3, u1, v1);
  }
  uv.needsUpdate = true;
}

// parte: { name, size:[w,h,d], uv:[u,v], pivot:[x,y,z], from:[x,y,z] (canto mínimo relativo ao pivô), anim, parent }
export function partGeometry(part, TW, TH) {
  const [w, h, d] = part.size;
  const g = new THREE.BoxGeometry(w / 16, h / 16, d / 16);
  setBoxUV(g, part.uv[0], part.uv[1], w, h, d, TW, TH, part.mirror);
  const f = part.from;
  g.translate((f[0] + w / 2) / 16, (f[1] + h / 2) / 16, (f[2] + d / 2) / 16);
  return g;
}

export function makeTexture(canvas) {
  const t = new THREE.CanvasTexture(canvas);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------- animação ----------
// state: { walk (fase), walkAmt (0..1), headYaw, headPitch, swing (0..1), sit, attack }
const _e = new THREE.Euler(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1);
export function partRotation(part, st) {
  const a = Math.sin(st.walk || 0) * 0.8 * (st.walkAmt || 0);
  let rx = 0, ry = 0, rz = 0;
  switch (part.anim) {
    case 'head': rx = st.headPitch || 0; ry = st.headYaw || 0; break;
    case 'legL': rx = st.sit ? -1.4 : a; break;
    case 'legR': rx = st.sit ? -1.4 : -a; break;
    case 'legFL': rx = a; break; case 'legFR': rx = -a; break; case 'legBL': rx = -a; break; case 'legBR': rx = a; break;
    case 'armL': rx = -a * 0.9 + (st.zombie ? -1.45 : 0); rz = 0.05; break;
    case 'armR': rx = a * 0.9 - (st.swing ? Math.sin(st.swing * Math.PI) * 1.4 : 0) + (st.zombie ? -1.45 : 0) - (st.holding ? 0.3 : 0); rz = -0.05; break;
    case 'wingL': rz = st.flap ? Math.sin(st.flap) * 0.6 : 0; break;
    case 'wingR': rz = st.flap ? -Math.sin(st.flap) * 0.6 : 0; break;
    case 'tail': ry = Math.sin((st.walk || 0) * 2) * 0.4 * (st.walkAmt || 0); break;
  }
  return [rx, ry, rz];
}
export function partMatrix(part, st, out) {
  const [rx, ry, rz] = partRotation(part, st);
  _e.set(rx, ry, rz, 'YXZ');
  _q.setFromEuler(_e);
  _p.set(part.pivot[0] / 16, part.pivot[1] / 16, part.pivot[2] / 16);
  return out.compose(_p, _q, _s);
}

// modelo único (jogador local/remoto): Group com uma malha por parte
export class SingleModel {
  constructor(def, texture) {
    this.def = def;
    this.group = new THREE.Group();
    this.mat = patchEntityMaterial(new THREE.MeshLambertMaterial({ map: texture, alphaTest: 0.5 }));
    this.meshes = {};
    for (const p of def.parts) {
      const m = new THREE.Mesh(partGeometry(p, def.tw, def.th), this.mat);
      m.matrixAutoUpdate = false;
      m.castShadow = true;
      this.meshes[p.name] = m;
      this.group.add(m);
    }
    this.extra = new THREE.Group(); // item na mão (3ª pessoa)
    this.group.add(this.extra);
  }
  setTexture(t) { this.mat.map = t; this.mat.needsUpdate = true; }
  pose(st) {
    for (const p of this.def.parts) {
      const m = this.meshes[p.name];
      partMatrix(p, st, m.matrix);
      m.matrixWorldNeedsUpdate = true;
    }
  }
}

// muitas instâncias (criaturas): uma InstancedMesh por parte
export class InstancedModel {
  constructor(def, texture, max, scene) {
    this.def = def; this.max = max; this.count = 0;
    this.mat = patchEntityMaterial(new THREE.MeshLambertMaterial({ map: texture, alphaTest: 0.5 }));
    this.meshes = def.parts.map((p) => {
      const m = new THREE.InstancedMesh(partGeometry(p, def.tw, def.th), this.mat, max);
      m.count = 0; m.frustumCulled = false; m.castShadow = true;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.setColorAt(0, new THREE.Color(1, 1, 1));
      m.instanceColor.setUsage(THREE.DynamicDrawUsage);
      scene.add(m);
      return m;
    });
    this._pm = new THREE.Matrix4();
    this._c = new THREE.Color();
  }
  begin() { this.count = 0; }
  // base: Matrix4 da entidade (posição/rotação/escala); light: brilho 0..1; tint: vermelho ao levar dano
  add(base, st, light, hurt) {
    if (this.count >= this.max) return;
    const i = this.count++;
    this._c.setRGB(light * (1 + hurt * 0.6), light * (1 - hurt * 0.5), light * (1 - hurt * 0.5));
    this.def.parts.forEach((p, k) => {
      partMatrix(p, st, this._pm);
      this._pm.premultiply(base);
      this.meshes[k].setMatrixAt(i, this._pm);
      this.meshes[k].setColorAt(i, this._c);
    });
  }
  end() {
    for (const m of this.meshes) { m.count = this.count; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
  }
  setShadows(on) { for (const m of this.meshes) m.castShadow = on; }
  dispose(scene) { for (const m of this.meshes) { scene.remove(m); m.geometry.dispose(); } this.mat.dispose(); }
}

// ---------- jogador / humanoides ----------
// rede de skin 64×64 (posições no estilo das skins de jogos de blocos)
export const HUMANOID = {
  tw: 64, th: 64,
  parts: [
    { name: 'head', size: [8, 8, 8], uv: [0, 0], pivot: [0, 24, 0], from: [-4, 0, -4], anim: 'head' },
    { name: 'body', size: [8, 12, 4], uv: [16, 16], pivot: [0, 12, 0], from: [-4, 0, -2] },
    { name: 'armR', size: [4, 12, 4], uv: [40, 16], pivot: [-6, 22, 0], from: [-2, -10, -2], anim: 'armR' },
    { name: 'armL', size: [4, 12, 4], uv: [32, 48], pivot: [6, 22, 0], from: [-2, -10, -2], anim: 'armL' },
    { name: 'legR', size: [4, 12, 4], uv: [0, 16], pivot: [-2, 12, 0], from: [-2, -12, -2], anim: 'legR' },
    { name: 'legL', size: [4, 12, 4], uv: [16, 48], pivot: [2, 12, 0], from: [-2, -12, -2], anim: 'legL' },
  ],
};

export const SKIN_PRESETS = [
  { name: 'Explorador', skin: [200, 150, 112], hair: [70, 44, 24], shirt: [40, 130, 160], pants: [50, 60, 140], shoes: [60, 60, 60], eyes: [60, 90, 200], hairStyle: 0 },
  { name: 'Aventureira', skin: [236, 192, 160], hair: [170, 70, 30], shirt: [170, 40, 60], pants: [60, 50, 40], shoes: [90, 60, 30], eyes: [40, 140, 70], hairStyle: 1 },
  { name: 'Minerador', skin: [150, 100, 70], hair: [20, 20, 20], shirt: [200, 160, 40], pants: [70, 70, 90], shoes: [40, 40, 40], eyes: [70, 50, 30], hairStyle: 2 },
  { name: 'Fazendeira', skin: [250, 214, 186], hair: [230, 200, 110], shirt: [90, 150, 60], pants: [110, 80, 50], shoes: [80, 50, 30], eyes: [50, 110, 200], hairStyle: 1 },
  { name: 'Ninja', skin: [210, 170, 130], hair: [25, 25, 30], shirt: [30, 30, 36], pants: [30, 30, 36], shoes: [20, 20, 20], eyes: [180, 30, 30], hairStyle: 3 },
  { name: 'Cientista', skin: [190, 140, 100], hair: [140, 140, 140], shirt: [235, 235, 235], pants: [60, 80, 110], shoes: [50, 50, 50], eyes: [90, 60, 40], hairStyle: 0 },
];

export function drawHumanoidSkin(o) {
  const cv = document.createElement('canvas'); cv.width = 64; cv.height = 64;
  const ctx = cv.getContext('2d');
  const sh = (c, k) => c.map((v) => Math.max(0, Math.min(255, v * k)));
  // cabeça
  const head = paintBox(ctx, 0, 0, 8, 8, 8, o.skin, 8, 1);
  // cabelo (topo, laterais, trás, franja)
  const hairFaces = ['top', 'back', 'right', 'left'];
  for (const k of hairFaces) { const [x, y, w, h] = head[k]; const hh = k === 'top' ? h : o.hairStyle === 1 ? h : k === 'back' ? 6 : 3; noiseFill(ctx, x, y, w, hh, o.hair, 16, 2); }
  { const [x, y] = head.front; noiseFill(ctx, x, y, 8, o.hairStyle === 3 ? 3 : 2, o.hair, 16, 3); if (o.hairStyle === 1) { noiseFill(ctx, x, y + 2, 1, 4, o.hair, 16, 4); noiseFill(ctx, x + 7, y + 2, 1, 4, o.hair, 16, 4); } }
  if (o.hairStyle === 3) { const [x, y] = head.front; noiseFill(ctx, x, y + 5, 8, 3, sh(o.shirt, 1), 8, 9); }
  // rosto
  { const [x, y] = head.front;
    ctx.fillStyle = '#fff'; ctx.fillRect(x + 1, y + 4, 2, 1); ctx.fillRect(x + 5, y + 4, 2, 1);
    ctx.fillStyle = `rgb(${o.eyes})`; ctx.fillRect(x + 2, y + 4, 1, 1); ctx.fillRect(x + 5, y + 4, 1, 1);
    if (o.hairStyle !== 3) { ctx.fillStyle = `rgb(${sh(o.skin, 0.7)})`; ctx.fillRect(x + 3, y + 5, 2, 1); ctx.fillStyle = `rgb(${sh(o.skin, 0.55)})`; ctx.fillRect(x + 3, y + 6, 2, 1); } }
  // corpo: camisa + gola
  const body = paintBox(ctx, 16, 16, 8, 12, 4, o.shirt, 12, 5, { bottom: o.pants });
  { const [x, y] = body.front; noiseFill(ctx, x + 3, y, 2, 1, o.skin, 8, 6); ctx.fillStyle = `rgb(${sh(o.shirt, 0.75)})`; ctx.fillRect(x, y + 11, 8, 1); }
  // braços: manga + pele
  for (const [u, v] of [[40, 16], [32, 48]]) {
    const n = paintBox(ctx, u, v, 4, 12, 4, o.skin, 8, 7, { top: o.shirt });
    for (const k of ['front', 'back', 'left', 'right']) { const [x, y, w] = n[k]; noiseFill(ctx, x, y, w, 4, o.shirt, 12, 8); }
  }
  // pernas: calça + sapato
  for (const [u, v] of [[0, 16], [16, 48]]) {
    const n = paintBox(ctx, u, v, 4, 12, 4, o.pants, 12, 9, { bottom: o.shoes });
    for (const k of ['front', 'back', 'left', 'right']) { const [x, y, w, h] = n[k]; noiseFill(ctx, x, y + h - 3, w, 3, o.shoes, 10, 10); }
  }
  return cv;
}
