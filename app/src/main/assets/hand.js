// Braço/mão em primeira pessoa (com item segurado) e modelo do jogador em terceira pessoa.
import * as THREE from './lib/three.module.min.js';
import { G } from './state.js';
import { R } from './render.js';
import { ITEMS } from './items.js';
import { BLOCKS, EMIT, LOPQ } from './blocks.js';
import { HUMANOID, SingleModel, drawHumanoidSkin, makeTexture, partGeometry, SKIN_PRESETS } from './models.js';
import { buildItemSpriteAtlas } from './icons.js';
import { EYE } from './player.js';

export const HAND = {
  scene: new THREE.Scene(), cam: new THREE.PerspectiveCamera(70, 1, 0.01, 10),
  skinTex: null, itemSprites: null, spriteTex: null, heldKey: null, heldMesh: null, light: 1, lightT: 0, equip: 0,
};

export function initHand() {
  const H = HAND;
  H.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1.6);
  H.dir = new THREE.DirectionalLight(0xffffff, 1.4);
  H.dir.position.set(0.4, 1, 0.6);
  H.scene.add(H.hemi, H.dir);
  H.rig = new THREE.Group();
  H.scene.add(H.rig);
  H.itemSprites = buildItemSpriteAtlas();
  H.spriteTex = new THREE.CanvasTexture(H.itemSprites.canvas);
  H.spriteTex.colorSpace = THREE.SRGBColorSpace; H.spriteTex.magFilter = THREE.NearestFilter; H.spriteTex.minFilter = THREE.LinearFilter;
  setSkin(G.settings.skin || SKIN_PRESETS[0]);
}

export function setSkin(opts) {
  const H = HAND;
  const cv = drawHumanoidSkin(opts);
  if (H.skinTex) H.skinTex.dispose();
  H.skinTex = makeTexture(cv);
  // braço em 1ª pessoa
  if (H.arm) { H.rig.remove(H.arm); H.arm.geometry.dispose(); }
  const armPart = Object.assign({}, HUMANOID.parts.find((p) => p.name === 'armR'), { from: [-2, -12, -2] });
  H.arm = new THREE.Mesh(partGeometry(armPart, 64, 64), new THREE.MeshLambertMaterial({ map: H.skinTex }));
  H.rig.add(H.arm);
  // modelo em 3ª pessoa
  if (H.model) { G.scene.remove(H.model.group); }
  H.model = new SingleModel(HUMANOID, H.skinTex);
  H.model.group.visible = false;
  G.scene.add(H.model.group);
  H.heldKey = null;
}

// malha do item segurado
function makeHeldMesh(key) {
  const it = ITEMS[key];
  if (!it) return null;
  const blk = it.block != null && !it.icon ? BLOCKS[it.block] : null;
  if (blk && !['cross', 'crop', 'torch', 'wire', 'rail', 'ladder', 'door'].includes(blk.shape)) {
    const g = new THREE.BoxGeometry(1, blk.shape === 'slab' ? 0.5 : 1, 1);
    const uvA = g.attributes.uv;
    const tiles = [blk.t[1], blk.t[1], blk.t[0], blk.t[2], blk.front ?? blk.t[1], blk.t[1]];
    for (let f = 0; f < 6; f++) {
      const t = R.uv[tiles[f]];
      const i = f * 4;
      uvA.setXY(i, t[0], t[1]); uvA.setXY(i + 1, t[2], t[1]); uvA.setXY(i + 2, t[0], t[3]); uvA.setXY(i + 3, t[2], t[3]);
    }
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: R.tex.albedo, alphaTest: 0.5, emissive: EMIT[it.block] ? 0x332211 : 0 }));
    m.userData.block = true;
    return m;
  }
  // item plano (sprite com espessura simulada por camadas)
  let tex, uv;
  if (blk) { tex = R.tex.albedo; uv = R.uv[blk.t[1]]; uv = [uv[0], uv[1], uv[2], uv[3]]; }
  else { tex = HAND.spriteTex; const r = HAND.itemSprites.map[key]; uv = [r[0], r[1], r[2], r[3]]; }
  const grp = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide });
  for (let l = 0; l < 4; l++) {
    const g = new THREE.PlaneGeometry(1, 1);
    const a = g.attributes.uv;
    const flipY = tex === R.tex.albedo;
    const v0 = flipY ? uv[1] : 1 - uv[1], v1 = flipY ? uv[3] : 1 - uv[3];
    a.setXY(0, uv[0], v0); a.setXY(1, uv[2], v0); a.setXY(2, uv[0], v1); a.setXY(3, uv[2], v1);
    const p = new THREE.Mesh(g, mat);
    p.position.z = (l - 1.5) * 0.015;
    grp.add(p);
  }
  grp.userData.flat = true;
  return grp;
}

function heldChanged(key) {
  const H = HAND;
  if (H.heldMesh) { H.rig.remove(H.heldMesh); H.heldMesh = null; }
  if (H.tpItem) { H.model.extra.remove(H.tpItem); H.tpItem = null; }
  H.heldKey = key;
  H.equip = 1;
  if (!key) return;
  H.heldMesh = makeHeldMesh(key);
  if (H.heldMesh) H.rig.add(H.heldMesh);
  H.tpItem = makeHeldMesh(key);
  if (H.tpItem) { H.tpItem.scale.setScalar(H.tpItem.userData.block ? 0.28 : 0.5); H.model.extra.add(H.tpItem); }
}

// luz local aproximada (céu visível + fontes de luz próximas), atualizada algumas vezes por segundo
function sampleLight() {
  const w = G.world, p = G.player.pos;
  const x = Math.floor(p.x), y = Math.floor(p.y + 1), z = Math.floor(p.z);
  let sky = 1;
  for (let yy = y + 1; yy < Math.min(127, y + 40); yy++) if (LOPQ[w.getBlock(x, yy, z)]) { sky = 0.15; break; }
  let blk = 0;
  for (let dy = -4; dy <= 4; dy++) for (let dz = -6; dz <= 6; dz++) for (let dx = -6; dx <= 6; dx++) {
    const e = EMIT[w.getBlock(x + dx, y + dy, z + dz)];
    if (e) blk = Math.max(blk, (e - Math.abs(dx) - Math.abs(dy) - Math.abs(dz)) / 15);
  }
  const day = R.sky01 ? 0.25 + 0.75 * R.sky01.day : 1;
  return Math.max(0.08, sky * day, blk * 0.9);
}

const _m = new THREE.Matrix4(), _v = new THREE.Vector3();
export function updateHand(dt) {
  const H = HAND, pl = G.player;
  if (!pl || !H.arm) return;
  const s = pl.held();
  const key = s ? s.k : null;
  if (key !== H.heldKey) heldChanged(key);
  H.lightT -= dt;
  if (H.lightT <= 0) { H.lightT = 0.25; H.light = sampleLight(); }
  H.hemi.intensity = 1.5 * H.light; H.dir.intensity = 1.2 * H.light;
  H.equip = Math.max(0, H.equip - dt * 5);
  const sw = pl.swing > 0 ? Math.sin(Math.min(1, 1 - pl.swing) * Math.PI) : 0;
  const bob = pl.onGround ? Math.sin(pl.walkDist * 2.4) : 0;
  const moving = Math.min(1, Math.hypot(pl.vel.x, pl.vel.z) / 4);
  // posição do braço na tela
  H.rig.position.set(0.5 + bob * 0.012 * moving - sw * 0.14, -0.5 + Math.abs(bob) * 0.015 * moving - H.equip * 0.4 + sw * 0.08, -0.72 - sw * 0.12);
  H.rig.rotation.set(-sw * 0.9, -0.25 + sw * 0.4, 0);
  H.rig.scale.setScalar(0.8);
  H.arm.position.set(0.08, -0.05, 0.25);
  H.arm.rotation.set(Math.PI / 2 + 0.35, 0.15, -0.35);
  if (H.heldMesh) {
    if (H.heldMesh.userData.block) { H.heldMesh.scale.setScalar(0.32); H.heldMesh.position.set(-0.02, 0.12, -0.06); H.heldMesh.rotation.set(0.3, 0.8, 0); }
    else { H.heldMesh.scale.setScalar(0.5); H.heldMesh.position.set(-0.06, 0.2, -0.05); H.heldMesh.rotation.set(0, -1.4, 0.4); }
  }
  // 3ª pessoa
  const m = H.model;
  m.group.visible = pl.camMode !== 0 && !pl.dead;
  if (m.group.visible) {
    m.group.position.set(pl.pos.x, pl.pos.y + (pl.sitting ? -0.5 : 0) + (pl.riding ? pl.riding.seatY - 0.6 : 0), pl.pos.z);
    m.group.rotation.set(0, pl.yaw + Math.PI, 0);
    const speed = Math.hypot(pl.vel.x, pl.vel.z);
    m.mat.color.setScalar(H.light);
    m.pose({ walk: pl.walkDist * 2.4, walkAmt: pl.riding ? 0 : Math.min(1, speed / 4), headPitch: -pl.pitch, headYaw: 0, swing: pl.swing > 0 ? 1 - pl.swing : 0, sit: !!(pl.sitting || pl.riding), holding: !!key });
    if (H.tpItem) {
      _m.copy(m.meshes.armR.matrix);
      H.tpItem.matrixAutoUpdate = false;
      H.tpItem.matrix.copy(_m).multiply(new THREE.Matrix4().makeTranslation(0, -0.62, 0.1)).multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2)).multiply(new THREE.Matrix4().makeScale(H.tpItem.userData.block ? 0.28 : 0.5, H.tpItem.userData.block ? 0.28 : 0.5, H.tpItem.userData.block ? 0.28 : 0.5));
      H.tpItem.matrixWorldNeedsUpdate = true;
    }
  }
}

// posição da câmera (1ª ou 3ª pessoa, evitando atravessar blocos)
export function placeCamera(camera) {
  const pl = G.player;
  const e = pl.eyePos();
  let ey = e.y;
  if (pl.sitting) ey -= 0.5;
  if (pl.riding) ey += pl.riding.seatY - 0.6;
  camera.position.set(e.x, ey, e.z);
  camera.rotation.set(pl.pitch, pl.yaw, 0);
  if (pl.camMode === 0) return;
  const back = pl.camMode === 1 ? 1 : -1;
  camera.updateMatrixWorld();
  camera.getWorldDirection(_v);
  let dist = 4;
  const w = G.world;
  for (let d = 0.3; d <= 4; d += 0.2) {
    const x = e.x - _v.x * d * back, y = ey - _v.y * d * back, z = e.z - _v.z * d * back;
    if (LOPQ[w.getBlock(Math.floor(x), Math.floor(y), Math.floor(z))]) { dist = Math.max(0.3, d - 0.3); break; }
  }
  camera.position.set(e.x - _v.x * dist * back, ey - _v.y * dist * back, e.z - _v.z * dist * back);
  if (back < 0) camera.rotation.set(-pl.pitch, pl.yaw + Math.PI, 0);
}

export function renderHand(renderer) {
  if (!G.player || G.player.camMode !== 0 || G.player.dead || G.player.riding) return;
  const H = HAND;
  H.cam.aspect = G.camera.aspect;
  H.cam.updateProjectionMatrix();
  renderer.autoClear = false;
  renderer.clearDepth();
  const sm = renderer.shadowMap.enabled;
  renderer.shadowMap.enabled = false;
  renderer.render(H.scene, H.cam);
  renderer.shadowMap.enabled = sm;
  renderer.autoClear = true;
}
