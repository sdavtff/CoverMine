// Ferramentas de comparação: modo foto (câmera livre, sem HUD, qualidade máxima, captura PNG)
// e benchmark (trajeto fixo de câmera, FPS médio, 1% mais lentos e tempo de GPU quando disponível).
import { G, hook } from './state.js';
import { PRESETS } from './graphics.js';
import { idbGet, idbSet } from './idb.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, parent, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; if (parent) parent.appendChild(e); return e; };

// ---------------- modo foto ----------------
export const PHOTO = { on: false, pos: null, yaw: 0, pitch: 0, maxQ: false, saved: null, capture: false, speed: 6 };

export function enterPhoto() {
  if (!G.player || PHOTO.on) return;
  const p = G.player, e = p.eyePos();
  PHOTO.on = true; PHOTO.capture = false;
  PHOTO.pos = { x: e.x, y: e.y, z: e.z };
  PHOTO.camMode = p.camMode; p.camMode = 1; // mostra o personagem
  document.body.classList.add('photo');
  buildToolbar();
  hook('toast', 'Modo foto: mova a câmera (WASD/joystick, Espaço/▲ sobe, Shift/▼ desce). P sai.');
}
export function exitPhoto() {
  if (!PHOTO.on) return;
  if (PHOTO.maxQ) toggleMaxQuality();
  PHOTO.on = false;
  if (G.player) G.player.camMode = PHOTO.camMode || 0;
  document.body.classList.remove('photo');
  const bar = $('photo-bar'); if (bar) bar.remove();
}
function buildToolbar() {
  let bar = $('photo-bar');
  if (bar) bar.remove();
  bar = el('div', '', document.body); bar.id = 'photo-bar';
  el('button', 'primary', bar, '📸 Capturar').onclick = () => { PHOTO.capture = true; };
  const q = el('button', '', bar, '✨ Qualidade máxima');
  q.onclick = () => { toggleMaxQuality(); q.classList.toggle('on', PHOTO.maxQ); };
  el('button', '', bar, '☀ −1h').onclick = () => { G.gameTime = (G.gameTime + 1 - 1 / 24) % 1; };
  el('button', '', bar, '☀ +1h').onclick = () => { G.gameTime = (G.gameTime + 1 / 24) % 1; };
  el('button', '', bar, '👤').onclick = () => { if (G.player) G.player.camMode = G.player.camMode ? 0 : 1; };
  el('button', '', bar, '🖼 Fotos').onclick = () => showGallery();
  el('button', 'danger', bar, '✕ Sair').onclick = () => exitPhoto();
}
// qualidade máxima temporária (não é salva; o antialiasing fica como está porque exige reiniciar)
function toggleMaxQuality() {
  const S = G.settings;
  if (!PHOTO.maxQ) {
    PHOTO.saved = JSON.stringify(S);
    const keepAA = S.aa;
    Object.assign(S, PRESETS.ultra, { aa: keepAA, eco: false, auto: false, rd: Math.max(S.rd, 8) });
    PHOTO.maxQ = true;
  } else {
    const old = JSON.parse(PHOTO.saved || '{}');
    for (const k in old) S[k] = old[k];
    PHOTO.maxQ = false;
  }
  hook('settingsChanged', 'photo', true);
}
// câmera livre: chamada pelo loop no lugar de placeCamera
export function photoCamera(cam, input, dt) {
  const p = G.player;
  const sp = PHOTO.speed * dt * (input.sprint ? 3 : 1);
  // anda para onde a câmera olha (inclusive para cima/baixo) e de lado
  const cy = Math.cos(p.yaw), sy = Math.sin(p.yaw), cp = Math.cos(p.pitch), spch = Math.sin(p.pitch);
  PHOTO.pos.x += (-sy * cp * input.mz + cy * input.mx) * sp;
  PHOTO.pos.y += spch * input.mz * sp;
  PHOTO.pos.z += (-cy * cp * input.mz - sy * input.mx) * sp;
  if (input.jump) PHOTO.pos.y += sp;
  if (input.sneak) PHOTO.pos.y -= sp;
  cam.position.set(PHOTO.pos.x, PHOTO.pos.y, PHOTO.pos.z);
  cam.rotation.set(p.pitch, p.yaw, 0);
}
// depois do quadro desenhado: captura (o buffer ainda está válido nesta mesma tarefa)
export function photoAfterRender(canvas) {
  if (!PHOTO.on || !PHOTO.capture) return;
  PHOTO.capture = false;
  let url;
  try { url = canvas.toDataURL('image/png'); } catch (e) { hook('toast', 'Não foi possível capturar.'); return; }
  const name = 'voxelcraft-' + new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19) + '.png';
  savePhoto(name, url);
  // PC: baixa o arquivo; celular: a foto fica na galeria do modo foto
  if (!G.isTouch || window.vcDesktop) { const a = document.createElement('a'); a.href = url; a.download = name; a.click(); }
  flash();
  hook('toast', G.isTouch ? 'Foto salva na galeria do modo foto (🖼 Fotos).' : 'Foto salva: ' + name);
}
function flash() {
  const f = el('div', '', document.body); f.id = 'photo-flash';
  setTimeout(() => f.remove(), 260);
}
async function savePhoto(name, url) {
  try {
    const list = (await idbGet('kv', 'photos')) || [];
    list.unshift({ name, url, t: Date.now() });
    while (list.length > 12) list.pop();
    await idbSet('kv', 'photos', list);
  } catch (e) { /* armazenamento indisponível */ }
}
async function showGallery() {
  const list = (await idbGet('kv', 'photos').catch(() => null)) || [];
  const back = el('div', 'vc-dialog', document.body);
  const box = el('div', 'vc-dialog-box photo-gallery', back);
  el('h3', '', box, `Fotos (${list.length})`);
  if (!list.length) el('p', '', box, 'Nenhuma foto ainda.');
  el('p', '', box, G.isTouch ? 'Toque e segure numa foto para salvar ou compartilhar (se o seu aparelho permitir).' : 'Clique numa foto para baixá-la.');
  const grid = el('div', 'photo-grid', box);
  list.forEach((ph, i) => {
    const cell = el('div', 'photo-cell', grid);
    const img = el('img', '', cell); img.src = ph.url; img.alt = ph.name;
    img.onclick = () => { const a = document.createElement('a'); a.href = ph.url; a.download = ph.name; a.click(); };
    el('button', 'danger', cell, 'Apagar').onclick = async () => { list.splice(i, 1); await idbSet('kv', 'photos', list); back.remove(); showGallery(); };
  });
  const row = el('div', 'vc-dialog-btns', box);
  el('button', 'primary', row, 'Fechar').onclick = () => back.remove();
}

// ---------------- benchmark ----------------
export const BENCH = { on: false, t: 0, warm: 4, dur: 20, times: [], gpu: [], center: null, query: null, ext: null, pending: [] };

export function startBenchmark(center) {
  Object.assign(BENCH, { on: true, t: 0, times: [], gpu: [], center, pending: [] });
  const gl = G.renderer.getContext();
  BENCH.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  hook('toast', 'Benchmark: 4 s de preparo + 20 s de medição. Não toque na tela.');
}
// câmera do trajeto fixo: círculo de 40 blocos a 14 blocos do chão, meio-dia
export function benchCamera(cam, dt) {
  BENCH.t += dt;
  G.gameTime = 0.32;
  const c = BENCH.center, a = BENCH.t * 0.18;
  cam.position.set(c.x + Math.cos(a) * 40, c.y + 14, c.z + Math.sin(a) * 40);
  cam.rotation.set(-0.22, -a + Math.PI, 0);
  return BENCH.t > BENCH.warm + BENCH.dur;
}
// medição: tempo entre quadros (CPU+GPU) e, quando o aparelho oferece, tempo de GPU por consulta
export function benchBegin() {
  if (!BENCH.on || !BENCH.ext || BENCH.t < BENCH.warm) return;
  const gl = G.renderer.getContext();
  BENCH.query = gl.createQuery();
  gl.beginQuery(BENCH.ext.TIME_ELAPSED_EXT, BENCH.query);
}
export function benchEnd(frameMs) {
  if (!BENCH.on) return;
  const gl = G.renderer.getContext();
  if (BENCH.query) { gl.endQuery(BENCH.ext.TIME_ELAPSED_EXT); BENCH.pending.push(BENCH.query); BENCH.query = null; }
  BENCH.pending = BENCH.pending.filter((q) => {
    if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) return true;
    if (!gl.getParameter(BENCH.ext.GPU_DISJOINT_EXT)) BENCH.gpu.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
    gl.deleteQuery(q);
    return false;
  });
  if (BENCH.t >= BENCH.warm) BENCH.times.push(frameMs);
}
export function benchResult() {
  BENCH.on = false;
  const t = BENCH.times.slice().sort((a, b) => a - b);
  if (!t.length) return null;
  const avg = t.reduce((a, b) => a + b, 0) / t.length;
  const worst = t.slice(Math.floor(t.length * 0.99));
  const low1 = worst.reduce((a, b) => a + b, 0) / Math.max(1, worst.length);
  const gpu = BENCH.gpu.length ? BENCH.gpu.reduce((a, b) => a + b, 0) / BENCH.gpu.length : null;
  const S = G.settings, r = G.renderer;
  const res = {
    date: new Date().toLocaleString('pt-BR'), preset: S.preset, fps: 1000 / avg, low1: 1000 / low1, ms: avg, gpu,
    frames: t.length, w: r.domElement.width, h: r.domElement.height,
    opts: `sombras ${S.shadows} · SSAO ${G.eff.ssao} · luzes ${G.eff.dynLights} · raios ${G.eff.godrays ? 'sim' : 'não'} · pós ${G.eff.post} · água ${S.water} · dist. ${S.rd}`,
  };
  S.benchHistory = [res, ...(S.benchHistory || [])].slice(0, 8);
  hook('settingsChanged', 'benchHistory');
  return res;
}
export function benchText(r) {
  return `Preset: ${r.preset} · ${r.w}×${r.h}\nFPS médio: ${r.fps.toFixed(1)} (${r.ms.toFixed(1)} ms por quadro)\n1% mais lentos: ${r.low1.toFixed(1)} FPS\nTempo de GPU: ${r.gpu != null ? r.gpu.toFixed(2) + ' ms' : 'não disponível neste aparelho'}\n${r.opts}`;
}
