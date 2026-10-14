// Mapa do mundo: áreas exploradas (por chunk), marcadores, pontos de interesse, minimapa e tela de mapa.
import { G, hook } from './state.js';
import { askText } from './dialog.js';
import { B, BLOCKS } from './blocks.js';
import { R } from './render.js';
import { CS, H } from './world.js';

export const MAP = { explored: new Map(), markers: [], pois: [], colors: null, dirty: true };
const S = CS * CS;

function colorTable() {
  if (MAP.colors) return MAP.colors;
  const t = [];
  for (let id = 0; id < 256; id++) {
    const d = BLOCKS[id];
    if (!d || !R.atlas) { t[id] = [0, 0, 0]; continue; }
    const a = R.atlas.avg[d.t[0]] || [0.5, 0.5, 0.5];
    t[id] = [a[0] * 255, a[1] * 255, a[2] * 255];
  }
  t[B.WATER] = [40, 90, 170]; t[B.LAVA] = [240, 100, 20];
  t[B.GRASS] = [92, 150, 60]; t[B.LEAVES] = [56, 110, 40]; t[B.PINE_LEAVES] = [40, 80, 46]; t[B.ACACIA_LEAVES] = [110, 130, 50];
  MAP.colors = t;
  return t;
}
export function resetMapColors() { MAP.colors = null; MAP.dirty = true; }

// registra o topo de cada coluna do chunk
export function exploreChunk(c) {
  if (MAP.explored.has(c.key)) return;
  const top = new Uint8Array(256), hh = new Uint8Array(256);
  for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
    for (let y = Math.min(H - 1, c.maxY); y >= 0; y--) {
      const id = c.data[x + z * CS + y * S];
      if (id && BLOCKS[id] && BLOCKS[id].shape !== 'cross') { top[x + z * CS] = id; hh[x + z * CS] = y; break; }
    }
  }
  MAP.explored.set(c.key, { top, h: hh });
  MAP.dirty = true;
}
export function updateExploredColumn(x, z) {
  const cx = Math.floor(x / CS), cz = Math.floor(z / CS);
  const e = MAP.explored.get(cx + ',' + cz);
  const c = G.world.chunks.get(cx + ',' + cz);
  if (!e || !c) return;
  const lx = x - cx * CS, lz = z - cz * CS;
  for (let y = Math.min(H - 1, c.maxY); y >= 0; y--) { const id = c.data[lx + lz * CS + y * S]; if (id && BLOCKS[id] && BLOCKS[id].shape !== 'cross') { e.top[lx + lz * CS] = id; e.h[lx + lz * CS] = y; break; } }
  MAP.dirty = true;
}

function pix(id, h, hN, sea) {
  const c = colorTable()[id] || [0, 0, 0];
  let k = 1 + (h - hN) * 0.08;
  if (id === B.WATER) k = 0.85 + Math.min(0.15, (h - sea + 8) * 0.02);
  return [c[0] * k, c[1] * k, c[2] * k];
}
// desenha a área (wx0, wz0) com escala px/bloco num canvas
export function drawMap(ctx, w, h, cx, cz, scale) {
  const img = ctx.createImageData(w, h);
  const d = img.data;
  const sea = G.world ? G.world.sea : 46;
  const bw = w / scale, bh = h / scale;
  const x0 = Math.floor(cx - bw / 2), z0 = Math.floor(cz - bh / 2);
  for (let py = 0; py < h; py++) {
    const wz = z0 + Math.floor(py / scale);
    for (let px = 0; px < w; px++) {
      const wx = x0 + Math.floor(px / scale);
      const ccx = Math.floor(wx / CS), ccz = Math.floor(wz / CS);
      const e = MAP.explored.get(ccx + ',' + ccz);
      const i = (py * w + px) * 4;
      if (!e) { d[i] = 26; d[i + 1] = 24; d[i + 2] = 30; d[i + 3] = 255; continue; }
      const lx = wx - ccx * CS, lz = wz - ccz * CS, k = lx + lz * CS;
      const hN = lz > 0 ? e.h[k - CS] : e.h[k];
      const c = pix(e.top[k], e.h[k], hN, sea);
      d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // marcadores e pontos de interesse
  const toScreen = (x, z) => [(x - x0) * scale, (z - z0) * scale];
  ctx.font = `${Math.max(10, Math.min(14, scale * 5))}px sans-serif`;
  for (const p of [...MAP.pois, ...MAP.markers]) {
    const [sx, sy] = toScreen(p.x, p.z);
    if (sx < -20 || sy < -20 || sx > w + 20 || sy > h + 20) continue;
    ctx.fillStyle = p.color || '#fd4'; ctx.strokeStyle = '#000'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(sx, sy, 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    if (p.name && scale >= 1) { ctx.strokeText(p.name, sx + 6, sy + 4); ctx.fillStyle = '#fff'; ctx.fillText(p.name, sx + 6, sy + 4); }
  }
  // jogador (seta)
  const pl = G.player;
  const [px, py] = toScreen(pl.pos.x, pl.pos.z);
  ctx.save(); ctx.translate(px, py); ctx.rotate(-pl.yaw + Math.PI);
  ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(5, 6); ctx.lineTo(0, 3); ctx.lineTo(-5, 6); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.restore();
  for (const r of (G.hooks.remotePlayers ? G.hooks.remotePlayers() : [])) { const [sx, sy] = toScreen(r.x, r.z); ctx.fillStyle = '#4cf'; ctx.beginPath(); ctx.arc(sx, sy, 4, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#fff'; ctx.fillText(r.name, sx + 6, sy + 4); }
}

// minimapa no HUD
let miniT = 0;
export function updateMinimap(dt) {
  const cv = document.getElementById('minimap');
  if (!cv || !G.settings.minimap) { if (cv) cv.style.display = 'none'; return; }
  cv.style.display = 'block';
  miniT -= dt;
  if (miniT > 0) return;
  miniT = 0.4;
  drawMap(cv.getContext('2d'), cv.width, cv.height, G.player.pos.x, G.player.pos.z, 1.5);
}

export function addPOI(p) { if (!MAP.pois.some((q) => q.id === p.id)) { MAP.pois.push(p); MAP.dirty = true; } }

export function mapJSON() {
  const ex = {};
  for (const [k, e] of MAP.explored) ex[k] = b64(e.top) + '|' + b64(e.h);
  return { explored: ex, markers: MAP.markers, pois: MAP.pois };
}
export function loadMap(s) {
  MAP.explored.clear(); MAP.markers = []; MAP.pois = [];
  if (!s) return;
  for (const k in s.explored || {}) { const [a, b] = s.explored[k].split('|'); MAP.explored.set(k, { top: unb64(a), h: unb64(b) }); }
  MAP.markers = s.markers || []; MAP.pois = s.pois || [];
}
function b64(u8) { let s = ''; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return btoa(s); }
function unb64(s) { const b = atob(s); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }

// ---------------- tela do mapa ----------------
export function openMapScreen(openScreen, el) {
  const pl = G.player;
  let cx = pl.pos.x, cz = pl.pos.z, scale = 2;
  openScreen('Mapa do mundo', (body) => {
    const wrap = el('div', 'map-wrap', body);
    const cv = el('canvas', 'map-canvas', wrap);
    const side = el('div', 'map-side', wrap);
    const info = el('div', 'muted', side);
    const btns = el('div', 'map-btns', side);
    const zin = el('button', 'small', btns, '＋'), zout = el('button', 'small', btns, '－'), ctr = el('button', 'small', btns, '◎ Centralizar');
    const addm = el('button', 'small', btns, '📍 Marcar aqui');
    const list = el('div', 'marker-list', side);
    const resize = () => { const r = wrap.getBoundingClientRect(); cv.width = Math.max(200, Math.floor(r.width - (side.offsetWidth || 0) - 16)); cv.height = Math.max(200, Math.floor(Math.min(window.innerHeight * 0.68, 600))); };
    const draw = () => { drawMap(cv.getContext('2d'), cv.width, cv.height, cx, cz, scale); info.textContent = `Você: X ${Math.floor(pl.pos.x)}  Y ${Math.floor(pl.pos.y)}  Z ${Math.floor(pl.pos.z)} · ${MAP.explored.size} chunks explorados`; };
    const renderList = () => {
      list.innerHTML = '';
      for (const m of [...MAP.pois, ...MAP.markers]) {
        const r = el('div', 'marker', list);
        el('span', '', r, `${m.name} (${Math.floor(m.x)}, ${Math.floor(m.z)})`);
        const go = el('button', 'tiny', r, '👁'); go.onclick = () => { cx = m.x; cz = m.z; draw(); };
        if (MAP.markers.includes(m)) { const del = el('button', 'tiny danger', r, '✕'); del.onclick = () => { MAP.markers.splice(MAP.markers.indexOf(m), 1); renderList(); draw(); }; }
      }
    };
    zin.onclick = () => { scale = Math.min(8, scale * 1.5); draw(); };
    zout.onclick = () => { scale = Math.max(0.25, scale / 1.5); draw(); };
    ctr.onclick = () => { cx = pl.pos.x; cz = pl.pos.z; draw(); };
    addm.onclick = async () => {
      const name = await askText('Nome do marcador', 'Marcador ' + (MAP.markers.length + 1), { max: 24 });
      if (name === null) return;
      MAP.markers.push({ name: name || 'Marcador', x: Math.floor(pl.pos.x), y: Math.floor(pl.pos.y), z: Math.floor(pl.pos.z), color: '#f55' });
      renderList(); draw(); hook('worldDirty');
    };
    // arrastar e pinça
    const pts = new Map();
    let lastDist = 0;
    cv.addEventListener('pointerdown', (e) => { cv.setPointerCapture(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]); });
    cv.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      const [ox, oy] = pts.get(e.pointerId);
      pts.set(e.pointerId, [e.clientX, e.clientY]);
      if (pts.size === 1) { cx -= (e.clientX - ox) / scale; cz -= (e.clientY - oy) / scale; draw(); }
      else if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        if (lastDist) { scale = Math.max(0.25, Math.min(8, scale * d / lastDist)); draw(); }
        lastDist = d;
      }
    });
    const up = (e) => { pts.delete(e.pointerId); if (pts.size < 2) lastDist = 0; };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    cv.addEventListener('wheel', (e) => { e.preventDefault(); scale = Math.max(0.25, Math.min(8, scale * (e.deltaY < 0 ? 1.2 : 1 / 1.2))); draw(); }, { passive: false });
    cv.style.touchAction = 'none';
    setTimeout(() => { resize(); draw(); renderList(); }, 0);
  }, null, { noItems: true });
}
