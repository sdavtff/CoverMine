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
  if (canvas.pending) canvas.addEventListener('skinready', () => { t.needsUpdate = true; });
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
  // respiração: braços e cabeça oscilam de leve quando parado
  const idle = st.t != null ? Math.max(0, 1 - (st.walkAmt || 0) * 3) : 0;
  const br = idle ? Math.sin(st.t * 1.7 + (st.ph || 0)) : 0;
  switch (part.anim) {
    case 'head': rx = (st.headPitch || 0) + br * 0.025 * idle; ry = st.headYaw || 0; break;
    case 'legL': rx = st.sit ? -1.4 : a; break;
    case 'legR': rx = st.sit ? -1.4 : -a; break;
    case 'legFL': rx = a; break; case 'legFR': rx = -a; break; case 'legBL': rx = -a; break; case 'legBR': rx = a; break;
    case 'armL': rx = -a * 0.9 + (st.zombie ? -1.45 : 0); rz = 0.05 + br * 0.035 * idle; break;
    case 'armR': rx = a * 0.9 - (st.swing ? Math.sin(st.swing * Math.PI) * 1.4 : 0) + (st.zombie ? -1.45 : 0) - (st.holding ? 0.3 : 0); rz = -0.05 - br * 0.035 * idle; break;
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

// skins prontas. Campos extras (opcionais): outfit (roupa), accent (cor de detalhe), hat (chapéu),
// hatColor, beard (barba), glasses (óculos). Skins importadas usam "png" (data URL 64×64).
const P = (name, skin, hair, eyes, shirt, pants, shoes, hairStyle, extra) => Object.assign({ name, skin, hair, eyes, shirt, pants, shoes, hairStyle }, extra || {});
export const SKIN_PRESETS = [
  P('Explorador', [200, 150, 112], [70, 44, 24], [60, 90, 200], [40, 130, 160], [50, 60, 140], [60, 60, 60], 0),
  P('Aventureira', [236, 192, 160], [170, 70, 30], [40, 140, 70], [170, 40, 60], [60, 50, 40], [90, 60, 30], 1),
  P('Minerador', [150, 100, 70], [20, 20, 20], [70, 50, 30], [200, 160, 40], [70, 70, 90], [40, 40, 40], 2, { hat: 2, hatColor: [230, 190, 40], outfit: 'overalls', accent: [70, 70, 90] }),
  P('Fazendeira', [250, 214, 186], [230, 200, 110], [50, 110, 200], [200, 70, 60], [60, 90, 160], [80, 50, 30], 1, { outfit: 'overalls', accent: [60, 90, 160], hat: 1, hatColor: [220, 190, 120] }),
  P('Ninja', [210, 170, 130], [25, 25, 30], [180, 30, 30], [30, 30, 36], [30, 30, 36], [20, 20, 20], 3, { outfit: 'longsleeve', hat: 5, hatColor: [170, 30, 30] }),
  P('Cientista', [190, 140, 100], [140, 140, 140], [90, 60, 40], [235, 235, 235], [60, 80, 110], [50, 50, 50], 0, { outfit: 'coat', accent: [60, 120, 200], glasses: true }),
  P('Cavaleiro', [220, 180, 150], [90, 60, 30], [60, 90, 150], [170, 175, 185], [150, 155, 165], [90, 95, 105], 0, { outfit: 'armor', accent: [200, 40, 40], hat: 2, hatColor: [170, 175, 185] }),
  P('Astronauta', [230, 190, 160], [60, 40, 20], [40, 80, 160], [240, 240, 245], [240, 240, 245], [120, 120, 130], 0, { outfit: 'suit', accent: [230, 110, 30], hat: 6, hatColor: [240, 240, 245] }),
  P('Pirata', [200, 150, 110], [30, 20, 15], [50, 40, 30], [235, 230, 215], [70, 50, 40], [40, 30, 20], 2, { outfit: 'stripes', accent: [160, 30, 40], hat: 5, hatColor: [160, 30, 40], beard: true }),
  P('Rei', [225, 185, 150], [120, 80, 40], [60, 90, 160], [150, 30, 50], [120, 20, 40], [60, 40, 20], 0, { outfit: 'robe', accent: [235, 200, 60], hat: 3, hatColor: [235, 200, 60], beard: true }),
  P('Rainha', [245, 205, 180], [60, 30, 20], [80, 50, 130], [110, 40, 140], [110, 40, 140], [60, 40, 20], 1, { outfit: 'dress', accent: [235, 200, 60], hat: 3, hatColor: [235, 200, 60] }),
  P('Mago', [215, 175, 140], [210, 210, 215], [60, 90, 180], [50, 50, 140], [50, 50, 140], [40, 30, 30], 0, { outfit: 'robe', accent: [235, 200, 60], hat: 4, hatColor: [50, 50, 140], beard: true }),
  P('Bombeira', [180, 120, 90], [40, 25, 15], [50, 40, 30], [190, 40, 30], [50, 50, 55], [30, 30, 30], 1, { outfit: 'coat', accent: [235, 210, 60], hat: 2, hatColor: [200, 40, 30] }),
  P('Médico', [160, 110, 80], [25, 20, 15], [50, 40, 30], [120, 190, 200], [120, 190, 200], [240, 240, 240], 2, { outfit: 'coat', accent: [250, 250, 250], glasses: true }),
  P('Atleta', [120, 80, 55], [20, 15, 10], [50, 40, 30], [240, 210, 40], [40, 90, 180], [250, 250, 250], 2, { outfit: 'jersey', accent: [40, 140, 70] }),
  P('Mergulhadora', [235, 195, 165], [230, 210, 120], [40, 120, 160], [30, 30, 40], [30, 30, 40], [240, 200, 40], 1, { outfit: 'suit', accent: [240, 200, 40], glasses: true }),
  P('Robô', [150, 155, 165], [110, 115, 125], [60, 220, 255], [120, 125, 135], [100, 105, 115], [70, 75, 85], 2, { outfit: 'armor', accent: [60, 220, 255], hat: 6, hatColor: [130, 135, 145] }),
  P('Policial', [190, 140, 105], [30, 25, 20], [50, 70, 120], [40, 60, 120], [30, 40, 80], [20, 20, 20], 2, { outfit: 'suit', accent: [235, 200, 60], hat: 1, hatColor: [30, 40, 80] }),
  P('Esquiadora', [245, 210, 190], [150, 80, 40], [60, 120, 70], [60, 160, 220], [40, 50, 70], [200, 60, 60], 1, { outfit: 'coat', accent: [250, 250, 250], hat: 4, hatColor: [200, 60, 60], glasses: true }),
  P('Zumbi', [90, 140, 80], [40, 50, 30], [20, 20, 20], [50, 120, 140], [60, 50, 120], [60, 60, 60], 2, { outfit: 'torn' }),
];
export const OUTFITS = { plain: 'Camiseta', longsleeve: 'Manga longa', stripes: 'Listrada', jersey: 'Camisa de time', coat: 'Jaleco / casaco', suit: 'Macacão', overalls: 'Jardineira', armor: 'Armadura', robe: 'Túnica', dress: 'Vestido', torn: 'Rasgada' };
export const HATS = ['Nenhum', 'Boné', 'Capacete', 'Coroa', 'Capuz', 'Faixa', 'Capacete com viseira'];

function drawBaseSkin(o, cv) {
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

// ---------- roupas e acessórios por cima da skin base ----------
const HEAD = net(0, 0, 8, 8, 8), BODY = net(16, 16, 8, 12, 4);
const ARMS = [net(40, 16, 4, 12, 4), net(32, 48, 4, 12, 4)], LEGS = [net(0, 16, 4, 12, 4), net(16, 48, 4, 12, 4)];
const SIDES = ['front', 'back', 'left', 'right'];
function fill(ctx, r, col, amp = 10, seed = 11, dy = 0, hh) { noiseFill(ctx, r[0], r[1] + dy, r[2], hh == null ? r[3] - dy : hh, col, amp, seed); }
function px(ctx, col, x, y, w = 1, h = 1) { ctx.fillStyle = `rgb(${col.map((v) => Math.round(v)).join(',')})`; ctx.fillRect(x, y, w, h); }
const dark = (c, k = 0.7) => c.map((v) => Math.max(0, Math.min(255, v * k)));

function drawOutfit(ctx, o) {
  const sh = o.shirt, ac = o.accent || dark(sh), pa = o.pants;
  const sleeves = (len) => { for (const a of ARMS) for (const k of SIDES) fill(ctx, a[k], sh, 12, 8, 0, len); for (const a of ARMS) fill(ctx, a.top, sh); };
  switch (o.outfit) {
    case 'longsleeve': sleeves(10); break;
    case 'stripes': for (const k of SIDES) for (let y = 1; y < 12; y += 3) fill(ctx, BODY[k], ac, 8, 12, y, 1); for (const a of ARMS) for (const k of SIDES) fill(ctx, a[k], ac, 8, 12, 1, 1); break;
    case 'jersey': { sleeves(4); const f = BODY.front, b = BODY.back; px(ctx, ac, f[0], f[1], 8, 1); for (const a of ARMS) for (const k of SIDES) fill(ctx, a[k], ac, 6, 13, 3, 1);
      // número nas costas
      px(ctx, ac, b[0] + 3, b[1] + 3, 2, 1); px(ctx, ac, b[0] + 4, b[1] + 4, 1, 4); px(ctx, ac, b[0] + 3, b[1] + 8, 3, 1); break; }
    case 'coat': { sleeves(10); for (const k of SIDES) fill(ctx, BODY[k], sh, 10, 14); const f = BODY.front; fill(ctx, [f[0] + 3, f[1], 2, 12], ac, 6, 15); px(ctx, dark(sh, 0.6), f[0] + 3, f[1], 1, 12);
      for (const l of LEGS) for (const k of SIDES) fill(ctx, l[k], sh, 10, 16, 0, 3); break; }
    case 'suit': { sleeves(11); for (const k of SIDES) fill(ctx, BODY[k], sh, 8, 17); for (const l of LEGS) for (const k of SIDES) fill(ctx, l[k], sh, 8, 18, 0, 9);
      const f = BODY.front; px(ctx, ac, f[0], f[1] + 6, 8, 1); px(ctx, ac, f[0] + 1, f[1] + 2, 2, 2); px(ctx, dark(sh, 0.6), f[0] + 4, f[1], 1, 12); break; }
    case 'overalls': { for (const k of SIDES) fill(ctx, BODY[k], ac, 10, 19, 5); const f = BODY.front, b = BODY.back;
      px(ctx, ac, f[0] + 1, f[1], 1, 5); px(ctx, ac, f[0] + 6, f[1], 1, 5); px(ctx, ac, b[0] + 1, b[1], 1, 5); px(ctx, ac, b[0] + 6, b[1], 1, 5); px(ctx, [230, 200, 80], f[0] + 1, f[1] + 4); px(ctx, [230, 200, 80], f[0] + 6, f[1] + 4);
      for (const l of LEGS) for (const k of SIDES) fill(ctx, l[k], ac, 10, 20, 0, 9); break; }
    case 'armor': { sleeves(11); for (const k of SIDES) fill(ctx, BODY[k], sh, 22, 21); for (const l of LEGS) for (const k of SIDES) fill(ctx, l[k], pa, 22, 22, 0, 10);
      const f = BODY.front; px(ctx, dark(sh, 0.6), f[0], f[1] + 5, 8, 1); px(ctx, dark(sh, 0.6), f[0] + 4, f[1], 1, 5); px(ctx, ac, f[0] + 3, f[1] + 7, 2, 2);
      for (const a of ARMS) px(ctx, dark(sh, 0.6), a.front[0], a.front[1] + 4, 4, 1); break; }
    case 'robe': case 'dress': { sleeves(o.outfit === 'robe' ? 11 : 4); for (const k of SIDES) fill(ctx, BODY[k], sh, 10, 23);
      for (const l of LEGS) for (const k of SIDES) fill(ctx, l[k], sh, 10, 24, 0, o.outfit === 'robe' ? 11 : 7);
      const f = BODY.front; px(ctx, ac, f[0], f[1] + 7, 8, 1); if (o.outfit === 'robe') px(ctx, ac, f[0] + 3, f[1], 2, 12);
      for (const l of LEGS) px(ctx, ac, l.front[0], l.front[1] + (o.outfit === 'robe' ? 10 : 6), 4, 1); break; }
    case 'torn': { const f = BODY.front; px(ctx, o.skin, f[0] + 1, f[1] + 8, 2, 4); px(ctx, o.skin, f[0] + 5, f[1] + 9, 2, 3); for (const l of LEGS) px(ctx, o.skin, l.front[0] + 1, l.front[1] + 6, 2, 3); break; }
  }
}
function drawHat(ctx, o) {
  const c = o.hatColor || [60, 60, 60], H = HEAD;
  const band = (rows, col = c) => { for (const k of SIDES) fill(ctx, H[k], col, 10, 30, 0, rows); };
  switch (o.hat | 0) {
    case 1: fill(ctx, H.top, c, 10, 31); band(2); px(ctx, dark(c, 0.75), H.front[0], H.front[1] + 2, 8, 1); break; // boné
    case 2: fill(ctx, H.top, c, 14, 32); band(2); for (const k of ['back', 'left', 'right']) fill(ctx, H[k], c, 14, 33, 0, 5); px(ctx, dark(c, 0.7), H.front[0], H.front[1] + 2, 8, 1); break; // capacete
    case 3: { band(2); const f = H.front; for (const k of SIDES) { const r = H[k]; for (let x = 0; x < 8; x += 3) px(ctx, c, r[0] + x, r[1] - 0, 1, 1); } px(ctx, [200, 30, 40], f[0] + 3, f[1] + 1, 2, 1); px(ctx, [40, 90, 210], f[0] + 1, f[1] + 1); px(ctx, [40, 90, 210], f[0] + 6, f[1] + 1); break; } // coroa
    case 4: { fill(ctx, H.top, c, 10, 34); for (const k of ['back', 'left', 'right']) fill(ctx, H[k], c, 10, 35); const f = H.front; px(ctx, c, f[0], f[1], 8, 2); px(ctx, c, f[0], f[1], 1, 8); px(ctx, c, f[0] + 7, f[1], 1, 8); break; } // capuz
    case 5: band(1, c); for (const k of SIDES) fill(ctx, H[k], c, 8, 36, 2, 1); break; // faixa
    case 6: { fill(ctx, H.top, c, 10, 37); for (const k of SIDES) fill(ctx, H[k], c, 10, 38); const f = H.front; fill(ctx, [f[0] + 1, f[1] + 2, 6, 4], [30, 60, 110], 14, 39); px(ctx, [170, 210, 255], f[0] + 2, f[1] + 3, 2, 1); break; } // viseira
  }
}
function drawFaceExtras(ctx, o) {
  const f = HEAD.front;
  if (o.beard) { px(ctx, o.hair, f[0] + 1, f[1] + 5, 6, 3); px(ctx, o.hair, f[0], f[1] + 4, 1, 4); px(ctx, o.hair, f[0] + 7, f[1] + 4, 1, 4); px(ctx, dark(o.skin, 0.55), f[0] + 3, f[1] + 6, 2, 1); }
  if (o.glasses) { px(ctx, [25, 25, 30], f[0], f[1] + 3, 8, 1); px(ctx, [25, 25, 30], f[0] + 1, f[1] + 4, 2, 1); px(ctx, [25, 25, 30], f[0] + 5, f[1] + 4, 2, 1); }
}

// skins importadas (PNG no formato padrão 64×64 ou antigo 64×32; camadas externas são achatadas)
const pngCache = new Map();
function loadPng(url) {
  let e = pngCache.get(url);
  if (!e) {
    e = { img: new Image(), ok: false, waiters: [] };
    e.img.onload = () => { e.ok = true; for (const w of e.waiters) w(); e.waiters = []; };
    e.img.src = url;
    pngCache.set(url, e);
  }
  return e;
}
function drawPng(cv, img) {
  const ctx = cv.getContext('2d');
  const tmp = document.createElement('canvas'); tmp.width = 64; tmp.height = 64;
  const t = tmp.getContext('2d'); t.imageSmoothingEnabled = false;
  const legacy = img.height * 2 === img.width;
  t.drawImage(img, 0, 0, 64, legacy ? 32 : 64);
  ctx.clearRect(0, 0, 64, 64);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tmp, 0, 0);
  if (legacy) { ctx.drawImage(tmp, 40, 16, 16, 16, 32, 48, 16, 16); ctx.drawImage(tmp, 0, 16, 16, 16, 16, 48, 16, 16); }
  else {
    // camada externa (chapéu/jaqueta) desenhada por cima da camada base
    for (const [sx, sy, dx, dy, w, h] of [[32, 0, 0, 0, 32, 16], [16, 32, 16, 16, 24, 16], [40, 32, 40, 16, 16, 16], [48, 48, 32, 48, 16, 16], [0, 32, 0, 16, 16, 16], [0, 48, 16, 48, 16, 16]]) ctx.drawImage(tmp, sx, sy, w, h, dx, dy, w, h);
  }
  // pele sem transparência na camada base (evita buracos no modelo)
  const d = ctx.getImageData(0, 0, 64, 64);
  for (let i = 3; i < d.data.length; i += 4) if (d.data[i] < 255) { if (d.data[i] === 0) { d.data[i - 3] = 40; d.data[i - 2] = 40; d.data[i - 1] = 40; } d.data[i] = 255; }
  ctx.putImageData(d, 0, 0);
}
// valida um arquivo de imagem como skin; devolve data URL 64×64 ou lança erro
export async function importSkinFile(file) {
  if (file.size > 512 * 1024) throw new Error('arquivo grande demais');
  const url = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(new Error('falha ao ler')); r.readAsDataURL(file); });
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('imagem inválida')); i.src = url; });
  if (!(img.width === img.height || img.width === img.height * 2) || img.width < 64 || img.width % 64) throw new Error('a skin deve ter 64×64 (ou 64×32) pixels');
  const cv = document.createElement('canvas'); cv.width = 64; cv.height = 64;
  drawPng(cv, img);
  return cv.toDataURL('image/png');
}

// desenha a skin completa num canvas 64×64. Para PNG ainda não decodificado, o canvas é
// preenchido depois e dispara o evento "skinready" (as texturas se atualizam sozinhas).
export function drawHumanoidSkin(o) {
  const cv = document.createElement('canvas'); cv.width = 64; cv.height = 64;
  o = o || SKIN_PRESETS[0];
  if (o.png && typeof o.png === 'string' && o.png.startsWith('data:image/')) {
    const e = loadPng(o.png);
    if (e.ok) drawPng(cv, e.img);
    else { drawBaseSkin(SKIN_PRESETS[0], cv); cv.pending = true; e.waiters.push(() => { drawPng(cv, e.img); cv.pending = false; cv.dispatchEvent(new Event('skinready')); }); }
    return cv;
  }
  drawBaseSkin(o, cv);
  const ctx = cv.getContext('2d');
  drawOutfit(ctx, o);
  drawFaceExtras(ctx, o);
  drawHat(ctx, o);
  return cv;
}
