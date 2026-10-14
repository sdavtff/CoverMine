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
  Object.assign(p, { x: o.x, y: o.y, z: o.z, vx: o.vx || 0, vy: o.vy || 0, vz: o.vz || 0, life: o.life || 1, max: o.life || 1, size: o.size || 0.1, grav: o.grav ?? 18, collide: o.collide !== false, grow: o.grow || 0, drag: o.drag || 0,
    wander: o.wander || 0, sway: o.sway || 0, ph: Math.random() * 6.28, fade: !!o.fade });
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
    // vaga-lumes/pólen vagueiam; folhas balançam ao cair
    if (p.wander) { p.vx += (Math.random() - 0.5) * p.wander * dt; p.vy += (Math.random() - 0.5) * p.wander * dt; p.vz += (Math.random() - 0.5) * p.wander * dt; }
    if (p.drag) { p.vx *= 1 - p.drag * dt; p.vz *= 1 - p.drag * dt; if (p.wander) p.vy *= 1 - p.drag * dt; }
    let sx = 0, sz = 0;
    if (p.sway) { p.ph += dt * 2.2; sx = Math.sin(p.ph) * p.sway; sz = Math.cos(p.ph * 0.7) * p.sway * 0.6; }
    p.x += (p.vx + sx) * dt; p.y += p.vy * dt; p.z += (p.vz + sz) * dt;
    if (p.collide && w && SOLID[w.getBlock(Math.floor(p.x), Math.floor(p.y - p.size * 0.5), Math.floor(p.z))]) { p.vx *= 0.5; p.vz *= 0.5; p.vy = 0; p.y = Math.floor(p.y - p.size * 0.5) + 1 + p.size * 0.5; }
    let s = p.size * (1 + p.grow * (p.max - p.life)) * Math.min(1, p.life * 4);
    if (p.fade) s *= Math.min(1, (p.max - p.life) * 2) * (0.75 + 0.25 * Math.sin(p.ph * 3 + p.life * 6));
    _m.compose(_p.set(p.x, p.y, p.z), _q, _s.set(s, s, s));
    mesh.setMatrixAt(i, _m);
  }
  if (any || mesh.userData.dirty) { mesh.instanceMatrix.needsUpdate = true; mesh.userData.dirty = any; }
}

// ---------------- partículas ambientes ----------------
export function firefly(x, y, z) { spawn({ x, y, z, vx: (Math.random() - 0.5) * 0.4, vy: (Math.random() - 0.5) * 0.3, vz: (Math.random() - 0.5) * 0.4, life: 4 + Math.random() * 3, size: 0.06, color: [0.75, 1, 0.3], glow: true, grav: 0, collide: false, wander: 3, drag: 1.2, fade: true }); }
export function dust(x, y, z, color = [0.95, 0.92, 0.8]) { spawn({ x, y, z, vx: (Math.random() - 0.5) * 0.2, vy: (Math.random() - 0.3) * 0.12, vz: (Math.random() - 0.5) * 0.2, life: 5 + Math.random() * 3, size: 0.025, color, grav: 0, collide: false, wander: 0.4, drag: 0.6, fade: true }); }
export function leaf(x, y, z, color) { spawn({ x, y, z, vx: (Math.random() - 0.5) * 0.4, vy: -0.4, vz: (Math.random() - 0.5) * 0.4, life: 6 + Math.random() * 3, size: 0.09, color, grav: 0.15, collide: true, sway: 0.9, drag: 0.8 }); }
export function ember(x, y, z) { spawn({ x: x + (Math.random() - 0.5) * 0.5, y, z: z + (Math.random() - 0.5) * 0.5, vx: (Math.random() - 0.5) * 0.3, vy: 0.9 + Math.random() * 0.8, vz: (Math.random() - 0.5) * 0.3, life: 1.2 + Math.random(), size: 0.035, color: [1, 0.45, 0.1], glow: true, grav: -0.2, collide: false, wander: 1.5, fade: true }); }
