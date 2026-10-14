// Áudio sintetizado com WebAudio (sem arquivos): efeitos, ambiente (chuva/vento) e trovões.
import { Vector3 } from './lib/three.module.min.js';
import { G } from './state.js';
import { BLOCKS } from './blocks.js';

let ctx = null, master = null, noiseBuf = null, rainNode = null, rainGain = null, rainFilter = null, bus = null;
export const AUDIO = { volume: 0.8, enabled: true, env: { cave: 0, forest: 0, open: 1 }, envT: 0, wind: null };
// reverberação: três salas sintéticas (caverna, floresta, aberto) misturadas conforme o ambiente
const REV = { nodes: {}, gains: {} };
function makeIR(seconds, decay, bright) {
  const len = Math.floor(ctx.sampleRate * seconds), b = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len, n = Math.random() * 2 - 1;
      lp += (n - lp) * bright; // tom mais escuro = filtro passa-baixa simples
      d[i] = lp * Math.pow(1 - t, decay) * (i < ctx.sampleRate * 0.004 ? 0 : 1);
    }
  }
  return b;
}

function ensure() {
  if (ctx || !AUDIO.enabled) return ctx;
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = AUDIO.volume;
    master.connect(ctx.destination);
    // bus: tudo passa por aqui; parte vai para a reverberação do ambiente
    bus = ctx.createGain(); bus.connect(master);
    for (const [k, sec, dec, br, g] of [['cave', 2.2, 2.2, 0.35, 0.55], ['forest', 0.9, 3.5, 0.55, 0.25], ['open', 0.3, 4, 0.8, 0.08]]) {
      const cv = ctx.createConvolver(); cv.buffer = makeIR(sec, dec, br);
      const gn = ctx.createGain(); gn.gain.value = k === 'open' ? g : 0;
      bus.connect(gn); gn.connect(cv); cv.connect(master);
      REV.nodes[k] = cv; REV.gains[k] = { node: gn, max: g };
    }
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  } catch (e) { ctx = null; }
  return ctx;
}
// navegadores só liberam o áudio após interação
export function unlockAudio() { const c = ensure(); if (c && c.state === 'suspended') c.resume(); }
export function setVolume(v) { AUDIO.volume = v; if (master) master.gain.value = v; }

// saída de um som: posicional (PannerNode HRTF + oclusão) ou direto no bus
let OUT = null;
function out() { return OUT || bus; }
function noise(dur, freq, q, vol, type = 'bandpass', attack = 0.005, when = 0) {
  if (!ensure()) return;
  const t = ctx.currentTime + when;
  const src = ctx.createBufferSource(); src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  src.connect(f); f.connect(g); g.connect(out());
  src.start(t, Math.random() * 1.5); src.stop(t + dur + 0.05);
}
function tone(f0, f1, dur, vol, type = 'sine', when = 0) {
  if (!ensure()) return;
  const t = ctx.currentTime + when;
  const o = ctx.createOscillator(); o.type = type;
  o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  o.connect(g); g.connect(out());
  o.start(t); o.stop(t + dur + 0.05);
}
const MAT = {
  grass: [1400, 0.8, 0.08], gravel: [900, 0.9, 0.09], sand: [2000, 0.6, 0.07], stone: [600, 1.5, 0.1], wood: [450, 2.5, 0.1],
  glass: [3000, 4, 0.08], cloth: [1200, 0.5, 0.05], snow: [2500, 0.5, 0.06], metal: [1800, 6, 0.09],
};
function matSound(m, vol, dur) { const s = MAT[m] || MAT.stone; noise(dur, s[0] * (0.85 + Math.random() * 0.3), s[1], vol * s[2] * 8); }

// distância → volume para sons posicionais
function distVol(pos) { if (!pos || !G.player) return 1; const p = G.player.pos; const d = Math.hypot(pos.x - p.x, pos.y - p.y, pos.z - p.z); return Math.max(0, 1 - d / 24); }

// som posicional: cria um PannerNode (HRTF) e um filtro de oclusão (blocos entre a fonte e o ouvinte)
function positional(pos, fn) {
  if (!ensure() || !pos || !G.player) { fn(); return; }
  if (G.settings.audio3d === false) { const v = distVol(pos); if (v <= 0.01) return; const g = ctx.createGain(); g.gain.value = v; g.connect(bus); OUT = g; fn(); OUT = null; setTimeout(() => g.disconnect(), 4000); return; }
  const pn = ctx.createPanner();
  pn.panningModel = 'HRTF'; pn.distanceModel = 'inverse'; pn.refDistance = 2; pn.maxDistance = 48; pn.rolloffFactor = 1.3;
  if (pn.positionX) { pn.positionX.value = pos.x; pn.positionY.value = pos.y; pn.positionZ.value = pos.z; } else pn.setPosition(pos.x, pos.y, pos.z);
  const occ = occlusion(pos);
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 18000 * Math.pow(0.18, occ); lp.Q.value = 0.5;
  const g = ctx.createGain(); g.gain.value = 1 - occ * 0.55;
  pn.connect(lp); lp.connect(g); g.connect(bus);
  OUT = pn; fn(); OUT = null;
  setTimeout(() => { try { g.disconnect(); } catch (e) { } }, 5000);
}
// fração de "parede" entre o ouvinte e a fonte (0 = livre, 1 = muitos blocos)
function occlusion(pos) {
  const w = G.world, p = G.player; if (!w || !p) return 0;
  const ex = p.pos.x, ey = p.pos.y + 1.6, ez = p.pos.z;
  const dx = pos.x - ex, dy = pos.y - ey, dz = pos.z - ez, d = Math.hypot(dx, dy, dz);
  if (d < 1.5) return 0;
  const n = Math.min(40, Math.ceil(d * 2)); let hits = 0;
  for (let i = 1; i < n; i++) { const t = i / n; const id = w.getBlock(Math.floor(ex + dx * t), Math.floor(ey + dy * t), Math.floor(ez + dz * t)); if (id && BLOCKS[id] && !BLOCKS[id].leaves && !BLOCKS[id].glass && !BLOCKS[id].liquid && !BLOCKS[id].shape) hits++; }
  return Math.min(1, hits / 6);
}
// ouvinte acompanha a câmera; ambiente (reverberação e vento) reavaliado a cada 0,5 s
export function updateListener(cam, dt) {
  if (!ctx || !cam) return;
  const L = ctx.listener, f = cam.getWorldDirection(_fwd);
  if (L.positionX) {
    L.positionX.value = cam.position.x; L.positionY.value = cam.position.y; L.positionZ.value = cam.position.z;
    L.forwardX.value = f.x; L.forwardY.value = f.y; L.forwardZ.value = f.z; L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0;
  } else { L.setPosition(cam.position.x, cam.position.y, cam.position.z); L.setOrientation(f.x, f.y, f.z, 0, 1, 0); }
  AUDIO.envT -= dt;
  if (AUDIO.envT <= 0 && G.world) { AUDIO.envT = 0.5; detectEnv(cam.position); }
  const E = AUDIO.env, k = Math.min(1, dt * 1.5);
  for (const n of ['cave', 'forest', 'open']) { const gg = REV.gains[n]; if (gg) gg.node.gain.value += ((E[n] || 0) * gg.max - gg.node.gain.value) * k; }
  updateWind(cam.position, dt);
}
const _fwd = new Vector3();
// raios em 10 direções: quanto fechado (caverna) ou cercado de folhas (floresta) é o lugar
const ENV_DIRS = [[0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0.7, 0.7, 0], [-0.7, 0.7, 0], [0, 0.7, 0.7], [0, 0.7, -0.7], [0, -1, 0]];
function detectEnv(pos) {
  const w = G.world;
  let solid = 0, leaves = 0;
  for (const [dx, dy, dz] of ENV_DIRS) {
    for (let t = 1; t <= 16; t++) {
      const id = w.getBlock(Math.floor(pos.x + dx * t), Math.floor(pos.y + dy * t), Math.floor(pos.z + dz * t));
      if (!id) continue;
      const b = BLOCKS[id];
      if (b && b.leaves) { leaves++; break; }
      if (b && !b.shape && !b.liquid) { solid++; break; }
    }
  }
  const n = ENV_DIRS.length;
  const cave = Math.max(0, (solid / n - 0.5) * 2);
  const forest = Math.min(1, leaves / 3) * (1 - cave);
  AUDIO.env = { cave, forest, open: Math.max(0, 1 - cave - forest) };
  AUDIO.roof = solid + leaves > 0 && !!w.getBlock(Math.floor(pos.x), Math.floor(pos.y) + 2, Math.floor(pos.z));
}
// vento: ruído filtrado, mais forte no alto, em lugares abertos e com tempestade
function updateWind(pos, dt) {
  if (!ensure() || !G.world) return;
  if (!AUDIO.wind) {
    const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 380; f.Q.value = 0.7;
    const g = ctx.createGain(); g.gain.value = 0;
    src.connect(f); f.connect(g); g.connect(bus); src.start();
    AUDIO.wind = { f, g, t: 0 };
  }
  const W = AUDIO.wind; W.t += dt;
  const alt = Math.max(0, Math.min(1, (pos.y - G.world.sea - 8) / 50));
  const storm = (G.weatherNow && G.weatherNow.storm) || 0;
  const gust = 0.6 + 0.4 * Math.sin(W.t * 0.35) * Math.sin(W.t * 0.13 + 1);
  const target = (0.012 + alt * 0.05 + storm * 0.06) * gust * (AUDIO.env.open + AUDIO.env.forest * 0.5);
  W.g.gain.value += (target - W.g.gain.value) * Math.min(1, dt * 2);
  W.f.frequency.value = 300 + gust * 250 + storm * 150;
}

export function playSound(name, a, b) {
  if (!AUDIO.enabled) return;
  // último argumento com x/y/z = som posicional
  const pos = b && typeof b === 'object' && 'x' in b ? b : a && typeof a === 'object' && 'x' in a ? a : null;
  if (pos && name !== 'mob' && !OUT) { positional(pos, () => playSound(name, a === pos ? undefined : a, b === pos ? undefined : b)); return; }
  if (name === 'mob' && pos && !OUT) { positional(pos, () => playSound('mob', a)); return; }
  switch (name) {
    case 'break': matSound(a, 0.9, 0.25); break;
    case 'place': matSound(a, 0.7, 0.12); break;
    case 'dig': matSound(a, 0.35 * (b || 1), 0.08); break;
    case 'step': matSound(a, 0.25, 0.07); break;
    case 'land': noise(0.2, 300, 1, 0.5, 'lowpass'); break;
    case 'hurt': tone(320, 160, 0.18, 0.25, 'square'); noise(0.12, 800, 1, 0.2); break;
    case 'hurt_mob': tone(260, 120, 0.15, 0.18, 'sawtooth'); break;
    case 'death_mob': tone(200, 60, 0.4, 0.2, 'sawtooth'); break;
    case 'eat': for (let i = 0; i < 3; i++) noise(0.08, 1800, 2, 0.25, 'bandpass', 0.005, i * 0.12); break;
    case 'pickup': tone(880, 1320, 0.08, 0.12, 'triangle'); break;
    case 'click': noise(0.03, 3000, 5, 0.3); break;
    case 'ui': noise(0.02, 2500, 4, 0.12); break;
    case 'door_open': noise(0.25, 300, 3, 0.4); tone(180, 140, 0.2, 0.06, 'square'); break;
    case 'door_close': noise(0.15, 220, 2, 0.5); break;
    case 'chest': noise(0.3, 260, 2, 0.4); break;
    case 'craft': noise(0.1, 1200, 2, 0.3); tone(600, 900, 0.1, 0.06, 'triangle', 0.05); break;
    case 'trade': tone(660, 990, 0.12, 0.12, 'triangle'); tone(990, 1320, 0.12, 0.1, 'triangle', 0.1); break;
    case 'levelup': [523, 659, 784, 1046].forEach((f, i) => tone(f, f, 0.18, 0.12, 'triangle', i * 0.09)); break;
    case 'toolbreak': noise(0.3, 2500, 3, 0.4); tone(400, 100, 0.3, 0.1, 'square'); break;
    case 'bucket': noise(0.35, 700, 1, 0.35, 'lowpass'); break;
    case 'splash': noise(0.5, 900, 0.6, 0.6, 'lowpass'); break;
    case 'bow': noise(0.15, 1500, 2, 0.3); tone(300, 150, 0.15, 0.08, 'triangle'); break;
    case 'arrow_hit': noise(0.08, 900, 3, 0.4); break;
    case 'hit': noise(0.1, 600, 2, 0.4); break;
    case 'elevator': tone(400, 900, 0.25, 0.12, 'sine'); break;
    case 'portal': tone(110, 480, 1.8, 0.07, 'sine'); tone(165, 700, 1.8, 0.04, 'triangle'); noise(1.8, 500, 1.5, 0.18, 'bandpass', 0.6); break;
    case 'portal_open': [392, 523, 659, 784, 1046].forEach((f, i) => tone(f, f * 1.01, 0.4, 0.09, 'triangle', i * 0.12)); break;
    case 'roar': noise(1.5, 140, 1.2, 0.7, 'lowpass', 0.12); tone(95, 55, 1.4, 0.16, 'sawtooth'); break;
    case 'eye': tone(700, 1400, 0.35, 0.06, 'sine'); break;
    case 'shear': noise(0.12, 4000, 3, 0.3); noise(0.12, 4000, 3, 0.3, 'bandpass', 0.005, 0.12); break;
    case 'explode': noise(1.6, 90, 0.5, 1.0, 'lowpass', 0.005); noise(0.6, 600, 0.6, 0.6, 'lowpass', 0.003); noise(2.2, 45, 0.4, 0.7, 'lowpass', 0.05, 0.05); break;
    case 'fuse': noise(1.2, 3500, 2, 0.15, 'bandpass', 0.02); break;
    case 'fizz': noise(0.6, 3000, 0.7, 0.3, 'highpass', 0.01); break;
    case 'ignite': noise(0.1, 4000, 3, 0.3); noise(0.4, 900, 0.8, 0.2, 'lowpass', 0.02, 0.05); break;
    case 'piston': noise(0.2, 400, 2, 0.5); tone(120, 90, 0.2, 0.15, 'square'); break;
    case 'thunder': {
      const v = 0.9 * (a || 1);
      noise(3.5, 120, 0.5, v, 'lowpass', 0.05);
      noise(2.5, 60, 0.4, v * 0.8, 'lowpass', 0.3, 0.2);
      noise(0.5, 1500, 0.4, v * 0.4, 'lowpass', 0.005);
      break;
    }
    case 'mob': {
      const v = (OUT ? 1 : distVol(b)) * 0.25;
      if (v <= 0.02) break;
      if (a === 'moo') tone(140, 100, 0.8, v, 'sawtooth');
      else if (a === 'oink') { tone(300, 200, 0.12, v, 'square'); tone(280, 180, 0.12, v, 'square', 0.15); }
      else if (a === 'baa') tone(450, 380, 0.5, v, 'sawtooth');
      else if (a === 'cluck') tone(900, 700, 0.06, v, 'square');
      else if (a === 'neigh') tone(700, 300, 0.6, v, 'sawtooth');
      else if (a === 'groan') tone(110, 80, 0.9, v * 1.2, 'sawtooth');
      else if (a === 'rattle') for (let i = 0; i < 4; i++) noise(0.04, 2500, 6, v * 1.5, 'bandpass', 0.003, i * 0.06);
      break;
    }
  }
}
// passos: som do material embaixo do jogador (água espirra)
export function footstep(blockId, inWater) {
  if (inWater) { noise(0.18, 900, 0.8, 0.22, 'lowpass'); return; }
  const d = BLOCKS[blockId]; playSound('step', d ? d.sound : 'stone');
}

// chuva contínua (volume 0..1); sob telhado fica abafada (passa-baixa)
export function setRain(v, roof) {
  if (!AUDIO.enabled) return;
  if (v <= 0.01) { if (rainGain) rainGain.gain.value = 0; return; }
  if (!ensure()) return;
  if (!rainNode) {
    rainNode = ctx.createBufferSource(); rainNode.buffer = noiseBuf; rainNode.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 2200; rainFilter = f;
    rainGain = ctx.createGain(); rainGain.gain.value = 0;
    rainNode.connect(f); f.connect(rainGain); rainGain.connect(master);
    rainNode.start();
  }
  rainGain.gain.value = v * 0.18;
  if (rainFilter) rainFilter.frequency.value += ((roof || AUDIO.roof ? 650 : 2400) - rainFilter.frequency.value) * 0.1;
}
