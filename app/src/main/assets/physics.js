// Colisão AABB contra o mundo voxel (com caixas de blocos não cúbicos) e raycast de seleção.
import { G } from './state.js';
import { B, BLOCKS, SOLID, SHAPED, LIQUID, collisionBoxes, shapeBoxes } from './blocks.js';

const nbFor = (x, y, z) => (dx, dy, dz) => { const w = G.world; return [w.getBlock(x + dx, y + dy, z + dz), w.getMeta(x + dx, y + dy, z + dz)]; };

// caixas de colisão do bloco em coordenadas do mundo (null = sem colisão)
export function blockBoxes(x, y, z) {
  const w = G.world;
  const id = w.getBlock(x, y, z);
  if (!SOLID[id]) return null;
  if (!SHAPED[id]) return [[x, y, z, x + 1, y + 1, z + 1]];
  const bx = collisionBoxes(id, w.getMeta(x, y, z), nbFor(x, y, z));
  if (bx === null) return null;
  if (bx === undefined) return [[x, y, z, x + 1, y + 1, z + 1]];
  return bx.map((b) => [x + b[0], y + b[1], z + b[2], x + b[3], y + b[4], z + b[5]]);
}

// testa se a AABB colide; retorna a caixa que colidiu (ou null)
export function collides(minX, minY, minZ, maxX, maxY, maxZ) {
  for (let y = Math.floor(minY) - 1; y <= Math.floor(maxY - 1e-6); y++)
    for (let z = Math.floor(minZ); z <= Math.floor(maxZ - 1e-6); z++)
      for (let x = Math.floor(minX); x <= Math.floor(maxX - 1e-6); x++) {
        const boxes = blockBoxes(x, y, z);
        if (!boxes) continue;
        for (const b of boxes) if (b[0] < maxX && b[3] > minX && b[1] < maxY && b[4] > minY && b[2] < maxZ && b[5] > minZ) return b;
      }
  return null;
}

// move uma entidade (pos = pé no centro, largura 2*hw, altura hh) por d no eixo; retorna true se colidiu
export function moveAxis(ent, axis, d) {
  const p = ent.pos, hw = ent.hw, hh = ent.hh;
  p[axis] += d;
  const b = collides(p.x - hw, p.y, p.z - hw, p.x + hw, p.y + hh, p.z + hw);
  if (!b) return false;
  if (axis === 'x') p.x = d > 0 ? b[0] - hw - 1e-4 : b[3] + hw + 1e-4;
  else if (axis === 'z') p.z = d > 0 ? b[2] - hw - 1e-4 : b[5] + hw + 1e-4;
  else p.y = d > 0 ? b[1] - hh - 1e-4 : b[4];
  return true;
}

// física genérica de entidade (gravidade, colisão, subida de degraus baixos)
export function stepEntity(ent, dt, opts = {}) {
  const v = ent.vel, p = ent.pos;
  const inLiquid = liquidAt(p.x, p.y + 0.3, p.z);
  ent.inWater = inLiquid === B.WATER; ent.inLava = inLiquid === B.LAVA;
  if (!opts.noGravity) {
    if (ent.inWater || ent.inLava) { v.y -= 6 * dt; if (v.y < -2.5) v.y = -2.5; }
    else { v.y -= 28 * dt; if (v.y < -50) v.y = -50; }
  }
  const wasGround = ent.onGround;
  const hitX = moveAxis(ent, 'x', v.x * dt);
  const hitZ = moveAxis(ent, 'z', v.z * dt);
  if (hitX) v.x = 0;
  if (hitZ) v.z = 0;
  ent.onGround = false;
  const vy0 = v.y;
  if (moveAxis(ent, 'y', v.y * dt)) { if (v.y < 0) ent.onGround = true; v.y = 0; }
  ent.hitWall = hitX || hitZ;
  // degrau de meio bloco (lajes/escadas) sem pular
  if (ent.hitWall && wasGround && opts.autoStep !== false) {
    const hw = ent.hw;
    const top = collides(p.x - hw - 0.3, p.y, p.z - hw - 0.3, p.x + hw + 0.3, p.y + 0.55, p.z + hw + 0.3);
    if (top && top[4] - p.y <= 0.55 && !collides(p.x - hw, top[4] + 0.01, p.z - hw, p.x + hw, top[4] + 0.01 + ent.hh, p.z + hw)) p.y = top[4] + 0.01;
  }
  return vy0;
}

export function liquidAt(x, y, z) {
  const id = G.world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z));
  return LIQUID[id] ? id : 0;
}

// interseção raio × caixa (método dos slabs); retorna [t, face] ou null
function rayBox(o, d, b) {
  let tmin = -Infinity, tmax = Infinity, face = null;
  for (let a = 0; a < 3; a++) {
    const lo = b[a], hi = b[a + 3], oa = o[a], da = d[a];
    if (Math.abs(da) < 1e-9) { if (oa < lo || oa > hi) return null; continue; }
    let t1 = (lo - oa) / da, t2 = (hi - oa) / da;
    let n1 = -1;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; n1 = 1; }
    if (t1 > tmin) { tmin = t1; face = [0, 0, 0]; face[a] = n1; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (tmax < 0) return null;
  return [Math.max(0, tmin), face];
}

// caixas de seleção (para mirar em lajes, tochas, plantas...)
export function selectBoxes(x, y, z, id, meta) {
  const d = BLOCKS[id];
  if (!d) return null;
  if (!d.shape) return [[0, 0, 0, 16, 16, 16]];
  if (d.shape === 'cross' || d.shape === 'crop') return [[2, 0, 2, 14, 13, 14]];
  if (d.shape === 'rail' || d.shape === 'wire') return [[0, 0, 0, 16, 2, 16]];
  if (d.shape === 'piston' && !(meta & 8)) return [[0, 0, 0, 16, 16, 16]];
  return shapeBoxes(id, meta, nbFor(x, y, z)) || [[0, 0, 0, 16, 16, 16]];
}

// raycast do olho: primeiro bloco atingido (ignora ar e líquidos)
export function raycast(o, dir, maxD, opts = {}) {
  const w = G.world;
  let x = Math.floor(o.x), y = Math.floor(o.y), z = Math.floor(o.z);
  const sx = Math.sign(dir.x), sy = Math.sign(dir.y), sz = Math.sign(dir.z);
  const tdx = Math.abs(1 / dir.x), tdy = Math.abs(1 / dir.y), tdz = Math.abs(1 / dir.z);
  let tmx = sx > 0 ? (x + 1 - o.x) * tdx : sx < 0 ? (o.x - x) * tdx : Infinity;
  let tmy = sy > 0 ? (y + 1 - o.y) * tdy : sy < 0 ? (o.y - y) * tdy : Infinity;
  let tmz = sz > 0 ? (z + 1 - o.z) * tdz : sz < 0 ? (o.z - z) * tdz : Infinity;
  let face = [0, 0, 0], t = 0;
  const O = [o.x, o.y, o.z], D = [dir.x, dir.y, dir.z];
  for (let steps = 0; steps < 64 && t <= maxD; steps++) {
    const id = w.getBlock(x, y, z);
    if (id && (!LIQUID[id] || opts.liquids)) {
      if (!SHAPED[id] || LIQUID[id]) return { x, y, z, face, id, meta: w.getMeta(x, y, z), t };
      const meta = w.getMeta(x, y, z);
      const boxes = selectBoxes(x, y, z, id, meta);
      let best = null;
      for (const b of boxes) {
        const r = rayBox(O, D, [x + b[0] / 16, y + b[1] / 16, z + b[2] / 16, x + b[3] / 16, y + b[4] / 16, z + b[5] / 16]);
        if (r && (!best || r[0] < best[0])) best = r;
      }
      if (best && best[0] <= maxD) return { x, y, z, face: best[1] || face, id, meta, t: best[0], boxes };
    }
    if (tmx < tmy && tmx < tmz) { x += sx; t = tmx; tmx += tdx; face = [-sx, 0, 0]; }
    else if (tmy < tmz) { y += sy; t = tmy; tmy += tdy; face = [0, -sy, 0]; }
    else { z += sz; t = tmz; tmz += tdz; face = [0, 0, -sz]; }
  }
  return null;
}
