// Áudio sintetizado com WebAudio (sem arquivos): efeitos, ambiente (chuva/vento) e trovões.
import { G } from './state.js';
import { BLOCKS } from './blocks.js';

let ctx = null, master = null, noiseBuf = null, rainNode = null, rainGain = null;
export const AUDIO = { volume: 0.8, enabled: true };

function ensure() {
  if (ctx || !AUDIO.enabled) return ctx;
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = AUDIO.volume;
    master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  } catch (e) { ctx = null; }
  return ctx;
}
// navegadores só liberam o áudio após interação
export function unlockAudio() { const c = ensure(); if (c && c.state === 'suspended') c.resume(); }
export function setVolume(v) { AUDIO.volume = v; if (master) master.gain.value = v; }

function noise(dur, freq, q, vol, type = 'bandpass', attack = 0.005, when = 0) {
  if (!ensure()) return;
  const t = ctx.currentTime + when;
  const src = ctx.createBufferSource(); src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t, Math.random() * 1.5); src.stop(t + dur + 0.05);
}
function tone(f0, f1, dur, vol, type = 'sine', when = 0) {
  if (!ensure()) return;
  const t = ctx.currentTime + when;
  const o = ctx.createOscillator(); o.type = type;
  o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + dur + 0.05);
}
const MAT = {
  grass: [1400, 0.8, 0.08], gravel: [900, 0.9, 0.09], sand: [2000, 0.6, 0.07], stone: [600, 1.5, 0.1], wood: [450, 2.5, 0.1],
  glass: [3000, 4, 0.08], cloth: [1200, 0.5, 0.05], snow: [2500, 0.5, 0.06], metal: [1800, 6, 0.09],
};
function matSound(m, vol, dur) { const s = MAT[m] || MAT.stone; noise(dur, s[0] * (0.85 + Math.random() * 0.3), s[1], vol * s[2] * 8); }

// distância → volume para sons posicionais
function distVol(pos) { if (!pos || !G.player) return 1; const p = G.player.pos; const d = Math.hypot(pos.x - p.x, pos.y - p.y, pos.z - p.z); return Math.max(0, 1 - d / 24); }

export function playSound(name, a, b) {
  if (!AUDIO.enabled) return;
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
    case 'shear': noise(0.12, 4000, 3, 0.3); noise(0.12, 4000, 3, 0.3, 'bandpass', 0.005, 0.12); break;
    case 'piston': noise(0.2, 400, 2, 0.5); tone(120, 90, 0.2, 0.15, 'square'); break;
    case 'thunder': {
      const v = 0.9 * (a || 1);
      noise(3.5, 120, 0.5, v, 'lowpass', 0.05);
      noise(2.5, 60, 0.4, v * 0.8, 'lowpass', 0.3, 0.2);
      noise(0.5, 1500, 0.4, v * 0.4, 'lowpass', 0.005);
      break;
    }
    case 'mob': {
      const v = distVol(b) * 0.25;
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
export function footstep(blockId) { const d = BLOCKS[blockId]; playSound('step', d ? d.sound : 'stone'); }

// chuva contínua (volume 0..1)
export function setRain(v) {
  if (!AUDIO.enabled) return;
  if (v <= 0.01) { if (rainGain) rainGain.gain.value = 0; return; }
  if (!ensure()) return;
  if (!rainNode) {
    rainNode = ctx.createBufferSource(); rainNode.buffer = noiseBuf; rainNode.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 2200;
    rainGain = ctx.createGain(); rainGain.gain.value = 0;
    rainNode.connect(f); f.connect(rainGain); rainGain.connect(master);
    rainNode.start();
  }
  rainGain.gain.value = v * 0.18;
}
