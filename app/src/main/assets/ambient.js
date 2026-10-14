// Mundo vivo (etapa 4): partículas ambientes (vaga-lumes, poeira/pólen, folhas caindo, brasas)
// e animais só visuais (bandos de pássaros no céu, borboletas perto do chão).
// Tudo é decorativo: não interfere na física, nos saves nem no multiplayer.
import * as THREE from './lib/three.module.min.js';
import { G } from './state.js';
import { B, BLOCKS } from './blocks.js';
import { BIOME } from './worldgen.js';
import { patchEntityMaterial } from './shaders.js';
import { firefly, dust, leaf, ember } from './particles.js';
import { L as LIGHT } from './lighting.js';
import { R } from './render.js';
import { W } from './weather.js';

const A = { t: 0, birds: null, flies: null, flock: [], bflies: [], spawnT: 0, leafT: 0, emberT: 0 };
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const NB = 9, NF = 6;

function wingGeometry(len, width) {
  // triângulo com a "dobradiça" no eixo z (origem), a ponta em +x
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, -width / 2, len, 0, 0, 0, 0, width / 2], 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  return g;
}
export function initAmbient(scene) {
  const bm = patchEntityMaterial(new THREE.MeshLambertMaterial({ color: 0x2a2a2e, side: THREE.DoubleSide }));
  A.birds = new THREE.InstancedMesh(wingGeometry(0.55, 0.32), bm, NB * 2);
  const fm = patchEntityMaterial(new THREE.MeshLambertMaterial({ side: THREE.DoubleSide }));
  A.flies = new THREE.InstancedMesh(wingGeometry(0.13, 0.16), fm, NF * 2);
  for (const m of [A.birds, A.flies]) { m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); for (let i = 0; i < m.count; i++) m.setMatrixAt(i, ZERO); scene.add(m); }
  const cols = [[0.95, 0.55, 0.1], [0.95, 0.95, 0.95], [0.35, 0.55, 0.95], [0.95, 0.85, 0.2], [0.85, 0.3, 0.5], [0.6, 0.35, 0.9]];
  for (let i = 0; i < NF; i++) { const c = cols[i % cols.length]; for (const k of [0, 1]) A.flies.setColorAt(i * 2 + k, _c.setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace)); }
  A.flies.instanceColor.needsUpdate = true;
  for (let i = 0; i < NB; i++) A.flock.push({ ox: (Math.random() - 0.5) * 10, oy: (Math.random() - 0.5) * 3, oz: (Math.random() - 0.5) * 10, ph: Math.random() * 6.28, sp: 0.8 + Math.random() * 0.4 });
  for (let i = 0; i < NF; i++) A.bflies.push({ x: 0, y: -999, z: 0, tx: 0, ty: 0, tz: 0, ph: Math.random() * 6.28, t: 0 });
}
export function ambientMeshes() { return [A.birds, A.flies]; }

const LEAF_COL = { [B.LEAVES]: [0.28, 0.48, 0.14], [B.PINE_LEAVES]: [0.16, 0.32, 0.16] };
function leafColor(id) {
  const c = LEAF_COL[id] || [0.42, 0.5, 0.16];
  const v = 0.8 + Math.random() * 0.4;
  return Math.random() < 0.15 ? [0.75 * v, 0.5 * v, 0.12] : c.map((x) => x * v);
}

export function updateAmbient(dt) {
  if (!A.birds || !G.world || !G.player) return;
  const w = G.world, p = G.player.pos, sky = G.eff ? G.eff : {};
  const dens = Math.max(0, sky.particles ?? 1);
  A.t += dt;
  const night = R.sky01 ? R.sky01.night : 0;
  const day = 1 - night;
  const rain = W.local || 0;
  const bm = w.biomeAt(Math.floor(p.x), Math.floor(p.z));
  const green = bm === BIOME.FOREST || bm === BIOME.DENSE_FOREST || bm === BIOME.PLAINS || bm === BIOME.SWAMP || bm === BIOME.SAVANNA;
  const underground = p.y < w.sea - 6;
  // ----- partículas -----
  if (dens > 0) {
    A.spawnT -= dt;
    if (A.spawnT <= 0) {
      A.spawnT = 0.25 / dens;
      const rx = p.x + (Math.random() - 0.5) * 20, rz = p.z + (Math.random() - 0.5) * 20;
      if (night > 0.6 && rain < 0.2 && green && !underground) {
        // vaga-lumes perto do chão
        const sy = w.surfaceY(Math.floor(rx), Math.floor(rz));
        if (sy > w.sea) firefly(rx, sy + 1 + Math.random() * 2, rz);
      } else if (day > 0.5 && rain < 0.1) {
        // poeira e pólen no ar
        dust(p.x + (Math.random() - 0.5) * 10, p.y + Math.random() * 3, p.z + (Math.random() - 0.5) * 10, green ? [1, 0.95, 0.6] : [0.92, 0.9, 0.85]);
      } else if (underground) dust(p.x + (Math.random() - 0.5) * 8, p.y + Math.random() * 3, p.z + (Math.random() - 0.5) * 8, [0.7, 0.68, 0.62]);
    }
    // folhas caindo das copas próximas
    A.leafT -= dt;
    if (A.leafT <= 0) {
      A.leafT = 0.5 / dens;
      const lx = Math.floor(p.x + (Math.random() - 0.5) * 16), lz = Math.floor(p.z + (Math.random() - 0.5) * 16);
      for (let y = Math.floor(p.y) + 14; y > Math.floor(p.y) - 4; y--) {
        const id = w.getBlock(lx, y, lz);
        if (id && BLOCKS[id] && BLOCKS[id].leaves) { if (!w.getBlock(lx, y - 1, lz)) leaf(lx + Math.random(), y - 0.1, lz + Math.random(), leafColor(id)); break; }
        if (id && !BLOCKS[id]?.leaves) break;
      }
    }
    // brasas perto de lava e fornalhas acesas (usa a lista de luzes próximas)
    A.emberT -= dt;
    if (A.emberT <= 0) {
      A.emberT = 0.35 / dens;
      for (const e of LIGHT.emitters || []) if ((e[3] === B.LAVA || e[3] === B.FURNACE_LIT) && Math.random() < 0.5) ember(e[0], e[1] + 0.5, e[2]);
    }
  }
  // ----- bando de pássaros -----
  const showBirds = day > 0.55 && rain < 0.3 && !underground && dens > 0;
  const cx = p.x + Math.cos(A.t * 0.05) * 45, cz = p.z + Math.sin(A.t * 0.05) * 45, cy = Math.max(w.sea + 34, p.y + 22);
  const head = A.t * 0.05 + Math.PI / 2;
  A.flock.forEach((b, i) => {
    if (!showBirds) { A.birds.setMatrixAt(i * 2, ZERO); A.birds.setMatrixAt(i * 2 + 1, ZERO); return; }
    const x = cx + b.ox + Math.sin(A.t * 0.7 + b.ph) * 1.5, y = cy + b.oy + Math.sin(A.t * 1.1 + b.ph) * 0.8, z = cz + b.oz + Math.cos(A.t * 0.6 + b.ph) * 1.5;
    const flap = Math.sin(A.t * 9 * b.sp + b.ph) * 0.7 + 0.15;
    for (const side of [0, 1]) {
      _e.set(0, -head, side ? Math.PI - flap : flap, 'YXZ');
      _q.setFromEuler(_e);
      A.birds.setMatrixAt(i * 2 + side, _m.compose(_p.set(x, y, z), _q, _s.set(1, 1, 1)));
    }
  });
  A.birds.instanceMatrix.needsUpdate = true;
  // ----- borboletas -----
  const showFlies = day > 0.6 && rain < 0.1 && green && !underground && dens > 0;
  A.bflies.forEach((f, i) => {
    if (!showFlies) { f.y = -999; A.flies.setMatrixAt(i * 2, ZERO); A.flies.setMatrixAt(i * 2 + 1, ZERO); return; }
    f.t -= dt;
    if (f.y < -900 || f.t <= 0 || Math.hypot(f.x - p.x, f.z - p.z) > 14) {
      if (f.y < -900 || Math.hypot(f.x - p.x, f.z - p.z) > 14) { f.x = p.x + (Math.random() - 0.5) * 16; f.z = p.z + (Math.random() - 0.5) * 16; f.y = w.surfaceY(Math.floor(f.x), Math.floor(f.z)) + 1.5; }
      f.tx = f.x + (Math.random() - 0.5) * 6; f.tz = f.z + (Math.random() - 0.5) * 6;
      f.ty = w.surfaceY(Math.floor(f.tx), Math.floor(f.tz)) + 0.8 + Math.random() * 1.8;
      f.t = 2 + Math.random() * 3;
    }
    const k = Math.min(1, dt * 0.9);
    f.x += (f.tx - f.x) * k; f.y += (f.ty - f.y) * k + Math.sin(A.t * 6 + f.ph) * 0.01; f.z += (f.tz - f.z) * k;
    const yaw = Math.atan2(f.tx - f.x, f.tz - f.z);
    const flap = Math.sin(A.t * 22 + f.ph) * 1.1;
    for (const side of [0, 1]) {
      _e.set(0, yaw + Math.PI / 2, side ? Math.PI - flap : flap, 'YXZ');
      _q.setFromEuler(_e);
      A.flies.setMatrixAt(i * 2 + side, _m.compose(_p.set(f.x, f.y, f.z), _q, _s.set(1, 1, 1)));
    }
  });
  A.flies.instanceMatrix.needsUpdate = true;
}
