// Partículas instanciadas (uma draw call): fragmentos de blocos, respingos, bolhas, fumaça, chamas, corações.
import * as THREE from './lib/three.module.min.js';
import { G } from './state.js';
import { SOLID } from './blocks.js';
import { patchEntityMaterial } from './shaders.js';

const MAX = 512;
const P = [];
let mesh = null, next = 0, density = 1;
const _m = new THREE.Matrix4(), _c = new THREE.Color(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

export function initParticles(scene) {
  const mat = patchEntityMaterial(new THREE.MeshLambertMaterial({ emissive: 0x000000 }));
  mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, MAX);
  mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  for (let i = 0; i < MAX; i++) { P.push({ life: 0 }); mesh.setMatrixAt(i, ZERO); mesh.setColorAt(i, _c.setRGB(1, 1, 1)); }
  scene.add(mesh);
}
export function setParticleDensity(d) { density = d; }
export function particleMesh() { return mesh; }

// spawn genérico: o = { x,y,z, vx,vy,vz, life, size, color:[r,g,b] (0..1 sRGB), grav, glow, collide, grow }
export function spawn(o) {
  if (!mesh) return;
  const idx = next; const p = P[idx]; next = (next + 1) % MAX;
  Object.assign(p, { x: o.x, y: o.y, z: o.z, vx: o.vx || 0, vy: o.vy || 0, vz: o.vz || 0, life: o.life || 1, max: o.life || 1, size: o.size || 0.1, grav: o.grav ?? 18, collide: o.collide !== false, grow: o.grow || 0, drag: o.drag || 0 });
  const k = o.glow ? 2.5 : 1;
  mesh.setColorAt(idx, _c.setRGB(o.color[0] * k, o.color[1] * k, o.color[2] * k, THREE.SRGBColorSpace));
  mesh.instanceColor.needsUpdate = true;
}
const n = (base) => Math.max(1, Math.round(base * density));

export function burstBlock(x, y, z, color, count = 14) {
  for (let i = 0; i < n(count); i++) {
    const f = 0.8 + Math.random() * 0.3;
    spawn({ x: x + 0.2 + Math.random() * 0.6, y: y + 0.2 + Math.random() * 0.6, z: z + 0.2 + Math.random() * 0.6, vx: (Math.random() - 0.5) * 4, vy: Math.random() * 4, vz: (Math.random() - 0.5) * 4, life: 0.5 + Math.random() * 0.4, size: 0.1 + Math.random() * 0.05, color: color.map((c) => c * f) });
  }
}
export function splash(x, y, z, count = 16) {
  for (let i = 0; i < n(count); i++) spawn({ x: x + (Math.random() - 0.5), y, z: z + (Math.random() - 0.5), vx: (Math.random() - 0.5) * 3, vy: 3 + Math.random() * 3, vz: (Math.random() - 0.5) * 3, life: 0.6, size: 0.07, color: [0.75, 0.86, 1], grav: 16 });
}
export function bubble(x, y, z) { spawn({ x: x + (Math.random() - 0.5) * 0.6, y, z: z + (Math.random() - 0.5) * 0.6, vy: 1.2, life: 1.2, size: 0.06, color: [0.8, 0.9, 1], grav: -1, collide: false }); }
export function smoke(x, y, z, count = 6, color = [0.35, 0.35, 0.35]) { for (let i = 0; i < n(count); i++) spawn({ x: x + (Math.random() - 0.5) * 0.5, y: y + Math.random() * 0.4, z: z + (Math.random() - 0.5) * 0.5, vx: (Math.random() - 0.5) * 0.6, vy: 0.8 + Math.random(), vz: (Math.random() - 0.5) * 0.6, life: 1 + Math.random(), size: 0.12, color, grav: -0.5, collide: false, grow: 0.15 }); }
export function flame(x, y, z) { spawn({ x: x + (Math.random() - 0.5) * 0.08, y, z: z + (Math.random() - 0.5) * 0.08, vy: 0.5, life: 0.45, size: 0.05, color: [1, 0.7, 0.2], glow: true, grav: -0.3, collide: false }); }
export function hearts(x, y, z) { for (let i = 0; i < n(5); i++) spawn({ x: x + (Math.random() - 0.5), y: y + Math.random() * 0.5, z: z + (Math.random() - 0.5), vy: 1, life: 1.2, size: 0.12, color: [1, 0.25, 0.35], glow: true, grav: -0.5, collide: false }); }
export function sparks(x, y, z, color = [1, 0.9, 0.4]) { for (let i = 0; i < n(8); i++) spawn({ x, y, z, vx: (Math.random() - 0.5) * 5, vy: Math.random() * 4, vz: (Math.random() - 0.5) * 5, life: 0.4, size: 0.05, color, glow: true }); }
export function rainSplash(x, y, z) { spawn({ x, y: y + 0.02, z, vx: (Math.random() - 0.5), vy: 1.5, vz: (Math.random() - 0.5), life: 0.25, size: 0.05, color: [0.7, 0.8, 0.95], grav: 12, collide: false }); }

export function updateParticles(dt) {
  if (!mesh) return;
  const w = G.world;
  let any = false;
  for (let i = 0; i < MAX; i++) {
    const p = P[i];
    if (p.life <= 0) continue;
    any = true;
    p.life -= dt;
    if (p.life <= 0) { mesh.setMatrixAt(i, ZERO); continue; }
    p.vy -= p.grav * dt;
    if (p.drag) { p.vx *= 1 - p.drag * dt; p.vz *= 1 - p.drag * dt; }
    p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    if (p.collide && w && SOLID[w.getBlock(Math.floor(p.x), Math.floor(p.y - p.size * 0.5), Math.floor(p.z))]) { p.vx *= 0.5; p.vz *= 0.5; p.vy = 0; p.y = Math.floor(p.y - p.size * 0.5) + 1 + p.size * 0.5; }
    const s = p.size * (1 + p.grow * (p.max - p.life)) * Math.min(1, p.life * 4);
    _m.compose(_p.set(p.x, p.y, p.z), _q, _s.set(s, s, s));
    mesh.setMatrixAt(i, _m);
  }
  if (any || mesh.userData.dirty) { mesh.instanceMatrix.needsUpdate = true; mesh.userData.dirty = any; }
}
