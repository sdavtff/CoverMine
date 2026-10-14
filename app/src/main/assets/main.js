// VoxelCraft HD — inicialização e ciclo principal. Integra mundo, renderização, jogador, entidades,
// clima, mecanismos, interface, salvamento e multiplayer.
import * as THREE from './lib/three.module.min.js';
import { G, hook } from './state.js';
import { loadSettings, saveSettings as storeSettings, effective, PRESET_ORDER, PRESET_NAMES, applyPreset } from './graphics.js';
import { R, initRenderer, applyGraphics, resize, updateChunks, onBlockEdited, onWorkerMeshed, updateSky, updateShadows, renderReflection, updateEnv, showSelection, disposeChunkMeshes, rebuildAllChunks } from './render.js';
import { U } from './shaders.js';
import { World } from './world.js';
import { B, BLOCKS, LIQUID, SOLID, FACING } from './blocks.js';
import { ITEMS, itemName } from './items.js';
import { Player, EYE } from './player.js';
import { GP, updateTarget, updateMining, primaryDown, primaryUp, secondaryAction, breakBlockAt, setBlock, consumeHeld, damageHeld, updateFurnaces, updateTicks, randomTicks, chestData, furnaceData } from './gameplay.js';
import { initInput, frameInput, IN } from './input.js';
import { UI, initHUD, updateHUD, openInventory, openCraftingTable, openChest, openFurnace, openVillager, closeScreen, showDeath, toast, showBlockName, tickScreen, openScreen, el } from './ui.js';
import { setIconAtlas } from './icons.js';
import { initHand, updateHand, placeCamera, renderHand, setSkin, HAND } from './hand.js';
import { E, initEntities, updateEntities, renderEntities, serializeEntities, loadEntities, clearEntities, throwItem, resetItemMeshes, setEntityShadows, shootArrow } from './entities.js';
import * as PT from './particles.js';
import { initWeather, updateWeather, weatherJSON, loadWeather, weatherMesh, W } from './weather.js';
import * as MECH from './mechanics.js';
import { playSound, footstep, unlockAudio, setVolume, setRain } from './audio.js';
import { MAP, exploreChunk, updateExploredColumn, updateMinimap, mapJSON, loadMap, openMapScreen, addPOI, resetMapColors } from './mapview.js';
import { CH, challengeEvent, challengeJSON, loadChallenge, currentObjective } from './challenge.js';
import { saveWorld, loadWorld, migrateLegacy, listWorlds } from './saves.js';
import { showTitle, showPause, hideMenu, MENU, MODES } from './menus.js';
import { renderFrame } from './postfx.js';
import { Inventory } from './crafting.js';
import { BIOME, BIOME_NAMES } from './worldgen.js';
import { SKIN_PRESETS } from './models.js';
import { NET, joinServer, netTick, hostPick, netHitMob } from './net.js';
G.net = NET;

const $ = (id) => document.getElementById(id);
const DAY_LEN = 600;

// ---------------- inicialização ----------------
G.isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
if (!G.isTouch) document.body.classList.add('desktop');
G.settings = loadSettings(G.isTouch);
if (!G.settings.skin) G.settings.skin = Object.assign({}, SKIN_PRESETS[0]);
G.eff = effective(G.settings);
const saveSettings = () => storeSettings(G.settings);
const canvas = $('c');
initRenderer(canvas);
G.camera.fov = G.settings.fov || 75;
applyUIScale();

function setLoading(t) { const l = $('loading'); if (!l) return; l.textContent = t || ''; l.style.display = t ? 'flex' : 'none'; }

async function boot() {
  setLoading('Preparando texturas...');
  await applyGraphics();
  setIconAtlas(R.atlas, R.atlasCanvas, R.uv);
  initHand();
  PT.initParticles(G.scene);
  PT.setParticleDensity(G.eff.particles ?? 1);
  initWeather(G.scene);
  initEntities();
  initHUD();
  initInput(canvas, actions);
  setVolume(G.settings.volume ?? 0.8);
  resize();
  G.camera.position.set(0, 80, 0);
  wireHooks();
  setLoading('');
  await migrateLegacy().catch(() => null);
  showTitle();
  // retomar após reiniciar o renderizador (troca de antialiasing)
  try {
    const resume = sessionStorage.getItem('vc_resume');
    if (resume) { sessionStorage.removeItem('vc_resume'); const ws = await listWorlds(); const w = ws.find((x) => x.id === resume); if (w) openWorld(w); }
  } catch (e) { }
  requestAnimationFrame(loop);
}

// ---------------- ganchos entre módulos ----------------
function wireHooks() {
  const H = G.hooks;
  H.setBlock = (x, y, z, id, m) => setBlock(x, y, z, id, m);
  H.breakBlock = (x, y, z) => breakBlockAt(x, y, z, false);
  H.sound = (n, a, b) => playSound(n, a, b);
  H.footstep = (id) => footstep(id);
  H.toast = (m) => toast(m);
  H.particles = (x, y, z, id) => { const d = BLOCKS[id]; const c = d && R.atlas ? R.atlas.avg[d.t[1]] : [0.5, 0.5, 0.5]; PT.burstBlock(x, y, z, c); };
  H.openScreen = (type, d) => {
    if (type === 'craft') openCraftingTable();
    else if (type === 'chest') openChest(d.data);
    else if (type === 'furnace') openFurnace(d.data);
    else if (type === 'villager') openVillager(d.mob);
    if (document.pointerLockElement) document.exitPointerLock();
  };
  H.closeScreen = () => { closeScreen(); if (!G.isTouch && G.playing) canvas.requestPointerLock(); };
  H.screenClosed = () => {};
  H.selectSlot = (i) => actions.select(i);
  H.throwItem = (k, n, d) => throwItem(k, n, d);
  H.consumeHeld = () => consumeHeld();
  H.damageHeld = (n) => damageHeld(n);
  H.playerHurt = (dmg, src) => { playSound('hurt'); if (navigator.vibrate && G.isTouch) try { navigator.vibrate(40); } catch (e) { } };
  H.playerDied = (src) => onDeath(src);
  H.challengeEvent = (ev, k, n) => challengeEvent(ev, k, n);
  H.questEvent = (ev, k, n) => questEvent(ev, k, n);
  H.villageFound = (v) => { addPOI({ id: 'v' + v.id, name: 'Aldeia', x: v.x, z: v.z, color: '#6f6' }); toast('Você encontrou uma aldeia!'); challengeEvent('village', 1); };
  H.worldDirty = () => { G.world && (G.world.dirty = true); };
  H.blockChanged = (x, y, z, o, n) => { MECH.onBlockChanged(x, y, z, o, n); updateExploredColumn(x, z); if (n === B.PLAMP_ON) challengeEvent('place', B.PLAMP_ON); };
  H.powerChanged = (x, y, z) => MECH.recompute(x, y, z);
  H.pushEntities = (x, y, z, dx, dy, dz) => { for (const e of [G.player, ...E.list]) if (e.pos && Math.floor(e.pos.x) === x && Math.floor(e.pos.z) === z && Math.abs(Math.floor(e.pos.y) - y) <= 1) { e.pos.x += dx; e.pos.y += dy + (dy > 0 ? 0.1 : 0); e.pos.z += dz; } };
  H.splash = (p) => { PT.splash(p.x, p.y + 0.5, p.z); playSound('splash'); };
  H.bubble = () => { const p = G.player.eyePos(); PT.bubble(p.x, p.y, p.z); };
  H.useBed = (x, y, z, meta) => useBed(x, y, z, meta);
  H.contextLost = () => setLoading('Recuperando gráficos...');
  H.contextRestored = () => { setLoading(''); applyGraphics(); };
  H.texturesChanged = () => { setIconAtlas(R.atlas, R.atlasCanvas, R.uv); if (UI.hot) for (const s of UI.hot) s.key = undefined; resetItemMeshes(); resetMapColors(); if (HAND.arm) HAND.heldKey = null; };
  H.chunkMeshed = (c) => { const p = G.player; if (p && Math.abs(c.cx * 16 + 8 - p.pos.x) < 16 * 5 && Math.abs(c.cz * 16 + 8 - p.pos.z) < 16 * 5) exploreChunk(c); };
  H.netCanEdit = (x, y, z) => NET.canEdit(x, y, z);
  H.netBlock = (x, y, z, id, m) => NET.sendBlock(x, y, z, id, m);
  H.settingsChanged = (key) => onSettingsChanged(key);
  H.settingsClosed = () => { saveSettings(); };
  H.openWorld = (w) => openWorld(w);
  H.joinServer = (addr, room, pass, status) => joinServer(addr, room, pass, status);
  H.hostPick = () => hostPick();
  H.remotePlayers = () => NET.remoteList();
  H.questAccepted = () => { G.world.dirty = true; };
  H.lightning = () => {};
  H.weatherChanged = (s) => { if (s === 'storm') toast('⛈ Uma tempestade se aproxima...'); else if (s === 'rain') toast('🌧 Começou a chover.'); NET.sendWeather(); };
  H.keyInField = () => {};
  H.netHitMob = (e, dmg) => netHitMob(e, dmg);
  H.startNetWorld = async (meta, data) => { await startWorld(meta, data, { net: true }); };
  H.hostPickWorld = () => hostPickWorld();
}

// ---------------- ações do jogador (entrada) ----------------
const actions = {
  look(dx, dy) { const p = G.player; if (!p) return; p.yaw -= dx; p.pitch = Math.max(-1.55, Math.min(1.55, p.pitch - dy)); },
  tap(desktopRight) {
    unlockAudio();
    if (!G.player || G.player.dead) return;
    const s = G.player.held();
    // arco: atira (com flechas no inventário)
    if (s && s.k === 'bow') { shootBow(); return; }
    // toque em criatura hostil/animal sem uso especial = ataque
    if (!desktopRight && GP.entityTarget) {
      const e = GP.entityTarget;
      const special = e.kind !== 'mob' || e.T.npc || (e.T.mount && !s) || (e.T.mount && s && s.k === 'saddle') || (s && (s.k === e.T.food || s.k === 'shears'));
      if (!special) { primaryDown(); setTimeout(primaryUp, 60); return; }
    }
    secondaryAction();
  },
  primaryDown() { unlockAudio(); if (G.player && !G.player.dead) primaryDown(); },
  primaryUp() { primaryUp(); },
  select(i) { if (!G.player) return; G.player.selected = i; const s = G.player.held(); showBlockName(s ? itemName(s.k) : ''); },
  toggleFly() { if (!G.player) return; if (G.mode !== 'creative') { toast('Voo disponível apenas no modo Criativo.'); return; } G.player.fly = !G.player.fly; G.player.vel.y = 0; refreshButtons(); },
  inventory() { if (!G.playing) return; if (UI.screen) { actions.closeScreen(); return; } openInventory(); if (document.pointerLockElement) document.exitPointerLock(); },
  camera() { if (!G.player) return; G.player.camMode = (G.player.camMode + 1) % 3; },
  map() { if (!G.playing) return; if (UI.screen) { actions.closeScreen(); return; } openMapScreen(openScreen, el); if (document.pointerLockElement) document.exitPointerLock(); },
  chat() { if (NET.connected) NET.openChat(); else if (G.isTouch) toast('O chat funciona no multiplayer.'); },
  menu() { if (UI.screen) { actions.closeScreen(); return; } if (G.playing) pauseGame(); },
  closeScreen() { G.hooks.closeScreen(); },
  dropHeld(all) { const p = G.player; const s = p && p.held(); if (!s) return; const n = all ? s.n : 1; throwItem(s.k, n, s.d); s.n -= n; if (!s.n) p.inv.set(p.selected, null); p.inv.changed = true; },
};
function shootBow() {
  const p = G.player;
  if (GP.useCooldown > 0) return;
  if (G.mode !== 'creative' && !p.inv.remove('arrow', 1)) { toast('Você precisa de flechas.'); return; }
  GP.useCooldown = 0.6;
  const e = p.eyePos();
  const d = { x: -Math.sin(p.yaw) * Math.cos(p.pitch), y: Math.sin(p.pitch), z: -Math.cos(p.yaw) * Math.cos(p.pitch) };
  shootArrow({ x: e.x + d.x * 0.5, y: e.y + d.y * 0.5, z: e.z + d.z * 0.5 }, d, p, 32);
  damageHeld(1);
  p.swing = 1;
}
function refreshButtons() {
  const p = G.player;
  $('btn-fly').style.display = G.mode === 'creative' ? 'flex' : 'none';
  $('btn-fly').classList.toggle('on', !!(p && p.fly));
  $('btn-chat').style.display = NET.connected ? 'flex' : 'none';
}

// ---------------- mundos ----------------
let current = null; // { meta }
async function openWorld(meta) {
  unlockAudio();
  setLoading('Carregando mundo...');
  await new Promise((r) => setTimeout(r, 20));
  try {
    const r = await loadWorld(meta.id);
    if (r && r.data && r.data.recovered) toast('O último salvamento estava incompleto: o mundo foi recuperado do backup anterior.');
    await startWorld(r ? r.meta : meta, r ? r.data : null);
  } catch (e) {
    console.error(e);
    setLoading('');
    alert('Não foi possível abrir o mundo: ' + e.message);
  }
}
export async function startWorld(meta, data, opts = {}) {
  stopWorld();
  current = { meta };
  G.meta = meta;
  G.mode = meta.mode || 'survival';
  const edits = new Map();
  if (data && data.edits) for (const k in data.edits) edits.set(k, new Map(data.edits[k]));
  const blockData = new Map();
  if (data && data.blockData) for (const [k, v] of data.blockData) blockData.set(k, reviveBlockData(v));
  const w = new World({ seed: meta.seed, gen: meta.gen || 3, edits, blockData });
  G.world = w;
  w.setUV(R.uv);
  w.villageState = (data && data.villageState) || {};
  w.onMeshed = onWorkerMeshed;
  w.onEdit = (c, lx, y, lz) => onBlockEdited(c, lx, y, lz);
  const sp = w.gen.findSpawn();
  w.spawn = { x: sp[0], y: sp[1] + 1, z: sp[2] };
  const p = new Player();
  G.player = p;
  p.name = G.settings.name || 'Jogador';
  p.camMode = G.settings.camDefault || 0;
  if (data && data.player) p.load(data.player);
  else spawnAt(p, w.spawn);
  if (!data || !data.player || data.player.inv === undefined) giveStarter(p, data);
  G.gameTime = data && data.time != null ? data.time : 0.3;
  G.day = data && data.day || 0;
  loadEntities(data && data.entities);
  loadWeather(data && data.weather);
  loadMap(data && data.map);
  loadChallenge(data && data.challenge);
  G.quests = (data && data.quests) || [];
  addPOI({ id: 'spawn', name: 'Ponto inicial', x: w.spawn.x, z: w.spawn.z, color: '#fff' });
  // carrega a vizinhança imediata (sincrono) para o jogador não cair
  const pcx = Math.floor(p.pos.x / 16), pcz = Math.floor(p.pos.z / 16);
  for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) w.getChunk(pcx + dx, pcz + dz);
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) { const c = w.getChunk(pcx + dx, pcz + dz); R.urgent.add(c); }
  // garante que o jogador não comece dentro de blocos
  if (!data || !data.player) spawnAt(p, w.spawn);
  R.needKey = '';
  R.shadowDirty = true;
  setLoading('');
  hideMenu();
  G.playing = true; G.paused = false;
  refreshButtons();
  updateObjective();
  lastSave = performance.now();
  if (!G.isTouch && !opts.noLock) canvas.requestPointerLock();
  if (!data) toast(`${MODES[G.mode]}: ${G.mode === 'creative' ? 'blocos infinitos e voo (F / VOAR).' : G.mode === 'challenge' ? 'siga os objetivos no canto da tela.' : 'colete madeira para começar!'}`);
  saveNow();
}
function spawnAt(p, s) {
  const w = G.world;
  let y = s.y;
  const x = Math.floor(s.x), z = Math.floor(s.z);
  for (let i = 0; i < 80; i++) { if (!SOLID[w.getBlock(x, y, z)] && !SOLID[w.getBlock(x, y + 1, z)] && SOLID[w.getBlock(x, y - 1, z)]) break; y++; }
  p.pos.x = x + 0.5; p.pos.y = y; p.pos.z = z + 0.5;
  p.vel.x = p.vel.y = p.vel.z = 0;
}
function giveStarter(p, data) {
  if (G.mode === 'creative') {
    const keys = data && data.legacySel != null
      ? ['grass', 'dirt', 'stone', 'cobble', 'planks', 'log', 'birch_log', 'leaves', 'sand']
      : ['grass', 'stone', 'planks', 'log', 'glass', 'brick', 'torch', 'door', 'lamp'];
    keys.forEach((k, i) => p.inv.set(i, { k, n: ITEMS[k].stack, d: 0 }));
    p.fly = data && data.player ? !!data.player.fly : false;
  }
}
function reviveBlockData(v) {
  if (!v) return v;
  const o = Object.assign({}, v);
  for (const k of ['inv']) if (o[k]) o[k] = Inventory.from(o[k], 27);
  for (const k of ['input', 'fuel', 'output']) if (o[k]) o[k] = Inventory.from(o[k], 1);
  return o;
}
function serializeBlockData(w) {
  const out = [];
  for (const [k, v] of w.blockData) {
    const o = {};
    for (const f in v) o[f] = v[f] instanceof Inventory ? v[f].toJSON() : v[f];
    delete o.changed;
    out.push([k, o]);
  }
  return out;
}
let lastSave = 0, saving = false;
async function saveNow() {
  if (!G.world || !current || saving || NET.isClient()) return;
  saving = true;
  try {
    const data = {
      player: G.player.toJSON(), edits: G.world.serializeEdits(), blockData: serializeBlockData(G.world), entities: serializeEntities(),
      time: G.gameTime, day: G.day, weather: weatherJSON(), map: mapJSON(), challenge: challengeJSON(), quests: G.quests, villageState: G.world.villageState,
    };
    await saveWorld(current.meta, data);
    G.world.dirty = false;
  } catch (e) { console.warn('falha ao salvar', e); toast('Não foi possível salvar o mundo (armazenamento cheio?).'); }
  saving = false;
  lastSave = performance.now();
}
window.saveGame = () => { saveNow(); saveSettings(); };
function stopWorld() {
  if (!G.world) return;
  for (const c of G.world.chunks.values()) disposeChunkMeshes(c);
  G.world.dispose();
  clearEntities();
  closeScreen(true);
  G.world = null; G.playing = false;
  setRain(0);
}
async function quitToTitle() {
  await saveNow();
  NET.disconnect();
  stopWorld();
  current = null;
  showTitle();
}
function pauseGame() {
  if (!G.playing) return;
  IN.reset && IN.reset();
  primaryUp();
  G.playing = false;
  saveNow();
  if (document.pointerLockElement) document.exitPointerLock();
  showPause(resumeGame, quitToTitle);
}
function resumeGame() {
  if (applyNeedsReload) { reloadRenderer(); return; }
  hideMenu();
  G.playing = true;
  last = performance.now();
  if (!G.isTouch) canvas.requestPointerLock();
}
window.onAndroidBack = () => {
  if (UI.screen) { closeScreen(); return; }
  if (MENU.back) { MENU.back(); return; }
  if (G.playing) pauseGame(); else if (G.world && MENU.page === 'pause') resumeGame();
};
document.addEventListener('visibilitychange', () => { if (document.hidden) { saveNow(); saveSettings(); if (G.playing) pauseGame(); } });
window.addEventListener('pagehide', () => { saveNow(); saveSettings(); });
window.addEventListener('resize', () => { resize(); applyUIScale(); });

// ---------------- configurações ----------------
let applyNeedsReload = false;
async function onSettingsChanged(key) {
  saveSettings();
  const S = G.settings;
  if (key === 'sens' || key === 'invertY' || key === 'minimap' || key === 'compass' || key === 'viewBob' || key === 'reduceFlash') { applyUIScale(); return; }
  if (key === 'fov') { G.camera.fov = S.fov; G.camera.updateProjectionMatrix(); return; }
  if (key === 'volume') { setVolume(S.volume); return; }
  if (key === 'uiScale' || key === 'showInfo' || key === 'highContrast') { applyUIScale(); return; }
  if (key === 'skin') { setSkin(S.skin); return; }
  if (key === 'name') { if (G.player) G.player.name = S.name; NET.sendProfile(); return; }
  if (key === 'camDefault' || key === 'lastServer') return;
  const needReload = await applyGraphics(key);
  applyNeedsReload = needReload;
  PT.setParticleDensity(G.eff.particles ?? 1);
  setEntityShadows(G.eff.shadows > 0);
  if (needReload) toast('O antialiasing será aplicado ao voltar ao jogo (o renderizador reinicia).');
}
function reloadRenderer() {
  saveNow().then(() => {
    saveSettings();
    try { if (current) sessionStorage.setItem('vc_resume', current.meta.id); } catch (e) { }
    location.reload();
  });
}
function applyUIScale() {
  const S = G.settings;
  document.documentElement.style.setProperty('--ui', S.uiScale || 1);
  document.body.classList.toggle('hc', !!S.highContrast);
  $('info').style.display = S.showInfo === false ? 'none' : '';
  $('compass').style.display = S.compass === false ? 'none' : '';
}

// ---------------- hospedar sala (versão PC) ----------------
async function hostPickWorld() {
  const worlds = await listWorlds();
  if (!worlds.length) { alert('Crie um mundo primeiro.'); return; }
  const names = worlds.map((w, i) => `${i + 1}. ${w.name}`).join('\n');
  const pick = prompt('Qual mundo hospedar? Digite o número:\n' + names, '1');
  const w = worlds[(parseInt(pick, 10) || 0) - 1];
  if (!w) return;
  const room = prompt('Nome da sala:', 'principal') || 'principal';
  const pass = prompt('Senha (deixe vazio para sala aberta):', '') || '';
  const info = await window.vcDesktop.host(8765);
  if (!info || !info.ok) { alert('Não foi possível iniciar o servidor: ' + (info && info.error)); return; }
  await openWorld(w);
  const upload = { seed: G.world.seed, gen: G.world.genVersion, mode: G.mode, edits: G.world.serializeEdits(), time: G.gameTime, weather: W.state };
  joinServer('localhost:8765', room, pass, (m) => m && toast(m), upload);
  toast(`Sala "${room}" aberta. Endereço para os amigos: ${info.addresses.join(' ou ')}`);
}

// ---------------- cama, morte, missões ----------------
function useBed(x, y, z, meta) {
  const p = G.player;
  p.spawn = { x, y: y + 1, z };
  const night = R.sky01 ? R.sky01.night : 0;
  if (night < 0.6 && W.state !== 'storm') { toast('Ponto de renascimento definido. Você só pode dormir à noite.'); return true; }
  const danger = E.list.some((e) => e.kind === 'mob' && !e.dead && e.T.hostile && Math.hypot(e.pos.x - x, e.pos.z - z) < 10);
  if (danger) { toast('Você não pode dormir: há monstros por perto!'); return true; }
  if (NET.connected && !NET.host) { toast('No multiplayer, apenas o anfitrião pode pular a noite.'); return true; }
  const fade = $('fade');
  fade.classList.add('on');
  setTimeout(() => {
    G.gameTime = 0.01; G.day++;
    if (W.state !== 'clear') { W.state = 'clear'; W.timer = 300; }
    fade.classList.remove('on');
    toast('Bom dia! Ponto de renascimento definido.');
    challengeEvent('night', 1);
    NET.sendTime();
  }, 1200);
  return true;
}
function onDeath(src) {
  const p = G.player;
  primaryUp();
  if (G.mode !== 'creative') {
    for (const inv of [p.inv, p.armorInv]) { for (let i = 0; i < inv.size; i++) { const s = inv.get(i); if (s) throwItemAt(p.pos, s); } inv.clear(); }
    addPOI({ id: 'death', name: 'Local da morte', x: p.pos.x, z: p.pos.z, color: '#f44' });
    MAP.pois = MAP.pois.filter((q) => q.id !== 'death' || q.x === p.pos.x);
  }
  if (document.pointerLockElement) document.exitPointerLock();
  showDeath(src, () => { p.respawn(); if (!G.isTouch) canvas.requestPointerLock(); });
}
function throwItemAt(pos, s) { const it = E.list && G.hooks.dropItem(pos.x, pos.y + 1, pos.z, s.k, s.n, s.d); if (it) { it.vel.x = (Math.random() - 0.5) * 5; it.vel.z = (Math.random() - 0.5) * 5; } }

function questEvent(ev, k, n) {
  // missões aceitas dos aldeões: abater criaturas e explorar biomas
  for (const e of E.list) {
    const q = e.quest;
    if (!q || !q.accepted || q.done) continue;
    if (q.type === 'kill' && ev === 'kill' && q.mob === k) { q.progress += n || 1; if (q.progress === q.n) toast(`Missão de ${e.name}: volte para receber a recompensa!`); }
    if (q.type === 'explore' && ev === 'biome' && q.biome === k && !q.progress) { q.progress = 1; toast(`Missão de ${e.name}: local visitado! Volte para contar.`); }
  }
}
function updateObjective() {
  const o = currentObjective();
  const d = $('objective');
  if (!o) { d.style.display = 'none'; return; }
  d.style.display = 'block';
  d.textContent = `🎯 ${o.text} (${CH.progress}/${o.n})`;
}
G.hooks.objectiveChanged = updateObjective;

// ---------------- ciclo principal ----------------
let last = performance.now(), fpsAcc = 0, fpsN = 0, fps = 0, lastFrame = 0, lastBiome = -1, wasNight = false, infoT = 0;
let lowFpsTime = 0, autoCooldown = 0;
function autoQuality(dt) {
  const S = G.settings;
  if (!S.auto || !G.playing) { lowFpsTime = 0; return; }
  autoCooldown -= dt;
  const target = G.eff.fpsCap ? G.eff.fpsCap : 60;
  if (fps > 0 && fps < target * 0.62) lowFpsTime += dt; else lowFpsTime = Math.max(0, lowFpsTime - dt * 2);
  if (lowFpsTime > 5 && autoCooldown <= 0) {
    lowFpsTime = 0; autoCooldown = 12;
    const cur = PRESET_ORDER.indexOf(S.preset);
    const lvl = cur >= 0 ? cur : S.shadows >= 4 ? 3 : S.shadows >= 3 ? 2 : S.shadows >= 1 ? 1 : 0;
    if (lvl > 0) {
      const next = PRESET_ORDER[lvl - 1];
      const keepAA = S.aa;
      applyPreset(S, next); S.aa = keepAA;
      saveSettings(); onSettingsChanged('auto');
      toast(`FPS baixo: qualidade reduzida para ${PRESET_NAMES[next]}`);
    } else if (S.res > 0.5) {
      S.res = Math.max(0.5, S.res - 0.25); S.preset = 'custom';
      saveSettings(); onSettingsChanged('res');
      toast('FPS baixo: resolução reduzida');
    }
  }
}

function loop(now) {
  requestAnimationFrame(loop);
  if (R.lost) return;
  if (G.eff.fpsCap && now - lastFrame < 1000 / G.eff.fpsCap - 2) return;
  lastFrame = now;
  const dt = Math.max(0, Math.min(0.1, (now - last) / 1000));
  last = now;
  G.time = now / 1000;
  fpsAcc += dt; fpsN++;
  if (fpsAcc > 0.5) { fps = Math.round(fpsN / fpsAcc); fpsAcc = 0; fpsN = 0; }
  U.uTime.value = G.time;
  const cam = G.camera;
  if (!G.world) {
    // fundo do menu: céu animado
    G.gameTime = (G.gameTime + dt / 400) % 1;
    cam.position.set(0, 120, 0);
    cam.rotation.set(0.12, now / 50000, 0);
    updateSky({ rain: 0, storm: 0, flash: 0 }, 0);
    renderFrame((t) => { G.renderer.setRenderTarget(t); G.renderer.render(G.scene, cam); });
    return;
  }
  const w = G.world, p = G.player;
  const active = G.playing && !G.paused;
  const input = active ? frameInput() : { mx: 0, mz: 0, jump: false, sneak: false, sprint: false };
  // simulação
  if (G.playing) {
    const tickDt = G.paused && !NET.connected ? 0 : dt;
    if (tickDt > 0) {
      const steps = Math.ceil(tickDt / 0.02);
      for (let i = 0; i < steps; i++) p.update(tickDt / steps, i === 0 ? input : Object.assign({}, input, { jumpPressed: false, sneakPressed: false }));
      if (!NET.isClient()) G.gameTime += tickDt / DAY_LEN;
      if (G.gameTime >= 1) { G.gameTime -= 1; G.day++; }
      updateEntities(tickDt);
      MECH.updatePlates(tickDt, [p, ...E.list.filter((e) => e.kind === 'mob' && !e.dead)]);
      updateFurnaces(tickDt);
      updateTicks(tickDt);
      randomTicks(tickDt * (W.local > 0.3 ? 1.6 : 1));
      tickScreen();
      // noites sobrevividas (para o modo desafio)
      const night = R.sky01 ? R.sky01.night > 0.6 : false;
      if (wasNight && !night && !p.dead) { p.stats.nightsSurvived++; challengeEvent('night', 1); }
      wasNight = night;
    }
  }
  placeCamera(cam);
  if (G.settings.viewBob !== false && p.camMode === 0 && p.onGround && !p.fly) cam.position.y += Math.abs(Math.sin(p.walkDist * 2.4)) * 0.04 * Math.min(1, Math.hypot(p.vel.x, p.vel.z) / 4);
  cam.updateMatrixWorld();
  if (active) { updateTarget(); updateMining(dt); }
  else { GP.target = null; GP.entityTarget = null; }
  showSelection(active && !p.dead ? GP.target : null, GP.mining ? GP.mining.p : 0);
  const headLiq = LIQUID[w.getBlock(Math.floor(cam.position.x), Math.floor(cam.position.y), Math.floor(cam.position.z))];
  $('water-overlay').style.display = headLiq === 1 ? 'block' : 'none';
  $('lava-overlay').style.display = headLiq === 2 ? 'block' : 'none';
  updateChunks(G.playing ? 5 : 10, p.pos);
  PT.updateParticles(dt);
  const wx = updateWeather(dt);
  if (G.settings.reduceFlash) wx.flash *= 0.25;
  const qa = updateSky(wx, headLiq);
  updateShadows(false);
  updateEnv(qa);
  renderEntities();
  updateHand(dt);
  NET.render(dt);
  // bioma atual (missões de exploração)
  if ((R.frameNo & 31) === 0) {
    const bm = w.biomeAt(Math.floor(p.pos.x), Math.floor(p.pos.z));
    if (bm !== lastBiome) { lastBiome = bm; questEvent('biome', bm); }
  }
  // quadro
  renderFrame((target) => {
    const r = G.renderer;
    r.setRenderTarget(target);
    renderReflection([weatherMesh(), PT.particleMesh()]);
    r.setRenderTarget(target);
    r.render(G.scene, cam);
    renderHand(r);
  }, { flash: wx.flash * 0.15, vignette: p.health <= 4 && G.mode !== 'creative' ? 0.4 : 0 });
  // HUD
  updateHUD();
  updateMinimap(dt);
  infoT -= dt;
  if (infoT <= 0) {
    infoT = 0.25;
    const bm = BIOME_NAMES[w.biomeAt(Math.floor(p.pos.x), Math.floor(p.pos.z))] || '';
    const hh = Math.floor(((G.gameTime + 0.25) % 1) * 24), mm = Math.floor((((G.gameTime + 0.25) % 1) * 24 % 1) * 60);
    $('info').textContent = `${fps} FPS · X ${Math.floor(p.pos.x)} Y ${Math.floor(p.pos.y)} Z ${Math.floor(p.pos.z)} · ${bm} · Dia ${G.day + 1} ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')} · ${PRESET_NAMES[G.settings.preset]}${G.settings.eco ? ' (eco)' : ''}${NET.connected ? ' · ' + NET.statusShort() : ''}`;
    updateObjective();
  }
  autoQuality(dt);
  netTick(dt);
  // salvamento automático a cada 30 s
  if (G.playing && now - lastSave > 30000) saveNow();
}

// depuração / testes automatizados
window.__vc = {
  get world() { return G.world; }, get player() { return G.player; }, get settings() { return G.settings; }, get eff() { return G.eff; },
  G, B, E, R, W, MAP, CH, setBlock, breakBlockAt, secondaryAction, startWorld, saveNow, openWorld, actions, openInventory,
  get renderer() { return G.renderer; }, setTime: (t) => { G.gameTime = t; }, NET,
};

boot();
