// Multiplayer (cliente): WebSocket com servidor autoritativo (server/server.js ou hospedado pelo app de PC).
import * as THREE from './lib/three.module.min.js';
import { G, hook } from './state.js';
import { HUMANOID, SingleModel, drawHumanoidSkin, makeTexture } from './models.js';
import { E, spawnMob, attackEntity } from './entities.js';
import { W } from './weather.js';
import { Inventory } from './crafting.js';

export const NET = {
  ws: null, connected: false, host: false, id: null, room: null, players: new Map(), canBuild: true, addr: '',
  posT: 0, mobT: 0, invT: 0, retry: 0, wantClose: false, chatLog: [],
  isClient() { return this.connected && !this.host; },
  canEdit() { if (!this.connected) return true; if (!this.canBuild) { hook('toast', 'Você não tem permissão para construir nesta sala.'); return false; } return true; },
  send(o) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); },
  pending: new Map(),
  sendBlock(x, y, z, id, m, oid, om) {
    if (!this.connected || this.applying) return;
    // guarda o valor anterior para desfazer se o servidor recusar
    const k = x + ',' + y + ',' + z;
    if (!this.pending.has(k)) this.pending.set(k, { id: oid ?? 0, m: om || 0, t: performance.now() });
    if (this.pending.size > 512) for (const [pk, v] of this.pending) if (performance.now() - v.t > 5000) this.pending.delete(pk);
    this.send({ t: 'block', x, y, z, id, m });
  },
  sendWeather() { if (this.connected && this.host) this.send({ t: 'env', time: G.gameTime, weather: W.state, timer: W.timer }); },
  sendTime() { this.sendWeather(); },
  sendProfile() { if (this.connected) this.send({ t: 'profile', name: G.settings.name, skin: G.settings.skin }); },
  remoteList() { return [...this.players.values()].map((p) => ({ name: p.name, x: p.x, z: p.z })); },
  statusShort() { return `${this.players.size + 1} jogador(es) · sala ${this.room}`; },
  statusText() { return `Multiplayer: sala "${this.room}" (${this.worldName || ''}) em ${this.addr} · ${this.players.size + 1} jogador(es)${this.host ? ' · você é o anfitrião' : ''}${this.canBuild ? '' : ' · sem permissão de construir'}`; },
  disconnect() { this.wantClose = true; if (this.ws) this.ws.close(); cleanup(); },
  openChat() { openChat(); },
  render(dt) { renderRemotes(dt); },
};

function wsURL(addr) {
  let a = addr.trim();
  if (!a) a = 'localhost:8765';
  if (/^wss?:\/\//.test(a)) return a;
  if (!/:\d+$/.test(a)) a += ':8765';
  return 'ws://' + a;
}

// chave de dono (identifica quem criou a sala sem precisar de conta)
function ownerKey() {
  if (!G.settings.netKey) { G.settings.netKey = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join(''); hook('settingsChanged', 'netKey'); }
  return G.settings.netKey;
}

// consulta a lista de salas de um servidor (sem entrar em nenhuma)
export function queryRooms(addr) {
  return new Promise((resolve, reject) => {
    let ws;
    try { ws = new WebSocket(wsURL(addr)); } catch (e) { reject(new Error('endereço inválido')); return; }
    const t = setTimeout(() => { try { ws.close(); } catch (e) { } reject(new Error('o servidor não respondeu (confira o endereço e se ele está ligado)')); }, 6000);
    ws.onopen = () => ws.send(JSON.stringify({ t: 'rooms' }));
    ws.onmessage = (ev) => { let m; try { m = JSON.parse(ev.data); } catch (e) { return; } if (m.t === 'rooms') { clearTimeout(t); ws.close(); resolve(m.list || []); } };
    ws.onerror = () => { clearTimeout(t); reject(new Error('não foi possível conectar')); };
  });
}

// entra numa sala; upload = mundo salvo enviado pelo criador; create = mundo novo { name, seed, mode, gen }
export function joinServer(addr, room, pass, status, upload, create) {
  status = status || (() => {});
  NET.wantClose = false;
  NET.addr = addr; NET.room = room;
  let ws;
  try { ws = new WebSocket(wsURL(addr)); } catch (e) { status('Endereço inválido.'); return; }
  NET.ws = ws;
  status('Conectando...');
  const timer = setTimeout(() => { if (ws.readyState !== 1) { status('Não foi possível conectar (verifique o endereço e se o servidor está ligado).'); ws.close(); } }, 7000);
  ws.onopen = () => {
    clearTimeout(timer);
    status('Conectado. Entrando na sala...');
    NET.send({ t: 'hello', room, pass, key: ownerKey(), name: G.settings.name || 'Jogador', skin: G.settings.skin, version: 3, upload: upload || null, create: create || null });
  };
  ws.onmessage = (ev) => { let m; try { m = JSON.parse(ev.data); } catch (e) { return; } onMessage(m, status); };
  ws.onclose = () => {
    clearTimeout(timer);
    const was = NET.connected;
    cleanup();
    if (was && !NET.wantClose) {
      hook('toast', 'Conexão perdida. Tentando reconectar...');
      if (NET.retry < 5) { NET.retry++; setTimeout(() => { if (!NET.wantClose && G.world) joinServer(addr, room, pass, () => {}, null); }, 2000 * NET.retry); }
    }
  };
  ws.onerror = () => status('Erro de conexão.');
}
function cleanup() {
  NET.connected = false; NET.host = false;
  for (const p of NET.players.values()) removeRemote(p);
  NET.players.clear();
  const btn = document.getElementById('btn-chat'); if (btn) btn.style.display = 'none';
}

async function onMessage(m, status) {
  switch (m.t) {
    case 'error': status(m.msg); hook('toast', m.msg); break;
    case 'welcome': {
      NET.connected = true; NET.id = m.id; NET.host = !!m.host; NET.owner = !!m.owner; NET.canBuild = m.canBuild !== false; NET.retry = 0; NET.worldName = m.world.name || ('Sala ' + m.room);
      // convidado: monta o mundo da sala; anfitrião: já está no próprio mundo
      if (!NET.host || !G.world) {
        const edits = {};
        for (const k in m.world.edits || {}) edits[k] = m.world.edits[k];
        const meta = { id: 'net-' + m.room, name: NET.worldName, seed: m.world.seed, gen: m.world.gen, mode: m.world.mode, slot: -1, net: true };
        await hook('startNetWorld', meta, { edits, time: m.world.time, player: m.you || null, weather: m.world.weather ? { state: m.world.weather, timer: 100 } : null });
      }
      for (const p of m.players || []) addRemote(p);
      const btn = document.getElementById('btn-chat'); if (btn) btn.style.display = 'flex';
      hook('toast', `Conectado à sala "${m.room}" (${(m.players || []).length + 1} jogador(es)).`);
      status('');
      break;
    }
    case 'join': addRemote(m.p); chatLine(`* ${m.p.name} entrou.`); break;
    case 'leave': { const p = NET.players.get(m.id); if (p) { chatLine(`* ${p.name} saiu.`); removeRemote(p); NET.players.delete(m.id); } break; }
    case 'pos': { const p = NET.players.get(m.id); if (p) { Object.assign(p.target, { x: m.x, y: m.y, z: m.z, yaw: m.yaw, pitch: m.pitch }); p.held = m.held; p.swing = m.swing; } break; }
    case 'profile': { const p = NET.players.get(m.id); if (p) { p.name = m.name; setRemoteSkin(p, m.skin); } break; }
    case 'block': {
      if (m.by === NET.id) { NET.pending.delete(m.x + ',' + m.y + ',' + m.z); break; }
      NET.applying = true;
      hook('setBlock', m.x, m.y, m.z, m.id, m.m || 0);
      NET.applying = false;
      break;
    }
    case 'deny': {
      // servidor recusou: desfaz a edição local
      const k = m.x + ',' + m.y + ',' + m.z, prev = NET.pending.get(k);
      NET.pending.delete(k);
      NET.applying = true;
      if (m.id >= 0) hook('setBlock', m.x, m.y, m.z, m.id, m.m || 0);
      else if (prev) hook('setBlock', m.x, m.y, m.z, prev.id, prev.m);
      NET.applying = false;
      if (m.reason) hook('toast', m.reason);
      break;
    }
    case 'chat': chatLine(`<${m.from}> ${m.text}`); break;
    case 'env': if (!NET.host) { G.gameTime = m.time; if (m.weather && W.state !== m.weather) { W.state = m.weather; W.timer = 1e9; } } break;
    case 'perm': NET.canBuild = !!m.canBuild; hook('toast', NET.canBuild ? 'Você pode construir nesta sala.' : 'O anfitrião desativou a construção para visitantes.'); break;
    case 'mobs': if (!NET.host) applyMobSnapshot(m.list); break;
    case 'host':
      // o anfitrião anterior saiu: este cliente passa a simular criaturas, hora e clima
      NET.host = true;
      for (const e of E.list) if (e.proxy) { e.proxy = false; e.netPos = null; }
      hook('toast', 'Você agora é o anfitrião da simulação desta sala.');
      break;
    case 'hitmob': if (NET.host) { const e = E.list.find((x) => x.id === m.id); if (e) attackEntity(e, Math.min(10, m.dmg), { pos: m.from }); } break;
  }
}

// ---------------- jogadores remotos ----------------
const nameTex = (name) => {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 64;
  const c = cv.getContext('2d');
  c.fillStyle = 'rgba(0,0,0,0.45)'; c.fillRect(0, 8, 256, 48);
  c.font = 'bold 32px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = '#fff';
  c.fillText(name.slice(0, 16), 128, 33);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
};
function addRemote(p) {
  if (NET.players.has(p.id)) return;
  const r = { id: p.id, name: p.name, x: p.x || 0, y: p.y || 80, z: p.z || 0, yaw: 0, pitch: 0, target: { x: p.x || 0, y: p.y || 80, z: p.z || 0, yaw: 0, pitch: 0 }, walk: 0 };
  r.model = new SingleModel(HUMANOID, makeTexture(drawHumanoidSkin(p.skin || { skin: [200, 150, 112], hair: [60, 40, 20], shirt: [120, 120, 200], pants: [60, 60, 120], shoes: [50, 50, 50], eyes: [40, 80, 160], hairStyle: 0 })));
  r.tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: nameTex(p.name), depthTest: true, transparent: true }));
  r.tag.scale.set(1.6, 0.4, 1); r.tag.position.y = 2.15;
  r.model.group.add(r.tag);
  G.scene.add(r.model.group);
  NET.players.set(p.id, r);
}
function setRemoteSkin(r, skin) { if (skin) r.model.setTexture(makeTexture(drawHumanoidSkin(skin))); if (r.tag) r.tag.material.map = nameTex(r.name); }
function removeRemote(r) { if (r.model) G.scene.remove(r.model.group); }
function renderRemotes(dt) {
  for (const r of NET.players.values()) {
    const t = r.target, k = Math.min(1, dt * 10);
    const ox = r.x, oz = r.z;
    r.x += (t.x - r.x) * k; r.y += (t.y - r.y) * k; r.z += (t.z - r.z) * k;
    let dy = t.yaw - r.yaw; while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
    r.yaw += dy * k; r.pitch += (t.pitch - r.pitch) * k;
    const sp = Math.hypot(r.x - ox, r.z - oz) / Math.max(dt, 1e-3);
    r.walk += sp * dt * 2.4;
    r.model.group.position.set(r.x, r.y, r.z);
    r.model.group.rotation.set(0, r.yaw + Math.PI, 0);
    r.model.pose({ walk: r.walk, walkAmt: Math.min(1, sp / 4), headPitch: -r.pitch, swing: r.swing || 0, holding: !!r.held });
  }
}

// ---------------- criaturas: anfitrião envia, convidados mostram ----------------
function mobSnapshot() {
  const out = [];
  for (const e of E.list) if (e.kind === 'mob' && !e.dead && !e.frozen) out.push([e.id, e.type, e.variant, +e.pos.x.toFixed(2), +e.pos.y.toFixed(2), +e.pos.z.toFixed(2), +e.yaw.toFixed(2), e.baby > 0 ? 1 : 0, e.hurt > 0 ? 1 : 0]);
  return out.slice(0, 80);
}
function applyMobSnapshot(list) {
  const seen = new Set();
  for (const [id, type, variant, x, y, z, yaw, baby, hurt] of list) {
    seen.add(id);
    let e = E.list.find((m) => m.netId === id);
    if (!e) { e = spawnMob(type, x, y, z, variant); e.netId = id; e.proxy = true; }
    e.target = null; e.netPos = { x, y, z }; e.variant = variant; e.yawNet = yaw; e.baby = baby ? 100 : 0; if (hurt) e.hurt = 0.3;
  }
  for (const e of E.list) if (e.proxy && !seen.has(e.netId)) e.dead = true;
}

export function netTick(dt) {
  if (!NET.connected || !G.player) return;
  const p = G.player;
  NET.posT -= dt;
  if (NET.posT <= 0) {
    NET.posT = 0.1;
    const s = p.held();
    NET.send({ t: 'pos', x: +p.pos.x.toFixed(2), y: +p.pos.y.toFixed(2), z: +p.pos.z.toFixed(2), yaw: +p.yaw.toFixed(2), pitch: +p.pitch.toFixed(2), held: s ? s.k : null, swing: p.swing > 0.5 ? 1 : 0 });
  }
  NET.invT -= dt;
  if (NET.invT <= 0) { NET.invT = 5; NET.send({ t: 'inv', inv: p.inv.toJSON(), armor: p.armorInv.toJSON(), health: p.health, hunger: p.hunger }); }
  if (NET.host) {
    NET.mobT -= dt;
    if (NET.mobT <= 0) { NET.mobT = 0.2; NET.send({ t: 'mobs', list: mobSnapshot() }); }
    NET.envT = (NET.envT || 0) - dt;
    if (NET.envT <= 0) { NET.envT = 5; NET.sendWeather(); }
  } else {
    // convidados: proxies seguem as posições do anfitrião; ataques são enviados ao anfitrião
    for (const e of E.list) if (e.proxy && e.netPos) {
      const k = Math.min(1, dt * 8);
      const ox = e.pos.x, oz = e.pos.z;
      e.pos.x += (e.netPos.x - e.pos.x) * k; e.pos.y += (e.netPos.y - e.pos.y) * k; e.pos.z += (e.netPos.z - e.pos.z) * k;
      e.yaw = e.yawNet ?? e.yaw;
      const sp = Math.hypot(e.pos.x - ox, e.pos.z - oz) / Math.max(dt, 1e-3);
      e.walk += sp * dt * 1.6; e.walkAmt = Math.min(1, sp / 2);
    }
  }
}
// convidado atacando criatura do anfitrião
export function netHitMob(e, dmg) { if (NET.connected && !NET.host && e.proxy) { NET.send({ t: 'hitmob', id: e.netId, dmg, from: { x: G.player.pos.x, y: G.player.pos.y, z: G.player.pos.z } }); return true; } return false; }

// ---------------- chat ----------------
function chatLine(text) {
  NET.chatLog.push(text);
  if (NET.chatLog.length > 50) NET.chatLog.shift();
  const box = document.getElementById('chat-log');
  if (!box) return;
  const d = document.createElement('div'); d.textContent = text; box.appendChild(d);
  while (box.children.length > 8) box.removeChild(box.firstChild);
  setTimeout(() => d.classList.add('old'), 10000);
}
function openChat() {
  // caixa de texto na própria tela (prompt() não funciona na WebView do Android)
  let box = document.getElementById('chat-input');
  if (!box) {
    box = document.createElement('input'); box.id = 'chat-input'; box.maxLength = 200; box.placeholder = 'Mensagem (Enter envia, Esc fecha)';
    box.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        const text = box.value.trim();
        if (text) { NET.send({ t: 'chat', text }); if (text[0] !== '/') chatLine(`<${G.settings.name || 'Você'}> ${text}`); }
        close();
      } else if (e.key === 'Escape') close();
    });
    box.addEventListener('blur', () => setTimeout(close, 150));
    document.body.appendChild(box);
  }
  const close = () => { box.value = ''; box.classList.remove('open'); box.blur(); G.chatOpen = false; };
  G.chatOpen = true;
  box.classList.add('open');
  setTimeout(() => box.focus(), 20);
}

export { Inventory };
