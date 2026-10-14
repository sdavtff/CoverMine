// Servidor multiplayer do VoxelCraft (Node.js + WebSocket).
// Uso: node server.js [porta]   (padrão 8765). Também é embutido no app de PC ("Hospedar sala").
//
// Papel do servidor (autoritativo para o mundo compartilhado):
//  - salas com nome e senha opcional; o mundo da sala (semente, gerador, modo, edições, tempo, clima)
//    fica no servidor e é salvo em disco (pasta data/);
//  - valida cada edição de bloco (coordenadas, id, alcance a partir da última posição conhecida,
//    limite de taxa, permissão de construir) e recusa as inválidas (mensagem "deny");
//  - repassa posições, perfis (nome/skin), chat e criaturas; guarda inventário/posição por nome
//    do jogador para a reconexão;
//  - um cliente da sala é o "anfitrião" da simulação (criaturas, hora e clima); se ele sair,
//    outro jogador assume.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { WebSocketServer } = require('ws');

const BLOCK_COUNT = 82;
const REACH = 10; // blocos (o jogo usa 5–6; folga para latência)
const RATE = 40; // edições por segundo
const MAX_MSG = 4 * 1024 * 1024;

function lanAddresses(port) {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(`${a.address}:${port}`);
  return out.length ? out : [`localhost:${port}`];
}
const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f]/g, '').trim().slice(0, n);

function startServer(opts = {}) {
  const port = opts.port || 8765;
  const dataDir = opts.dataDir || path.join(__dirname, 'data');
  const log = opts.log || ((...a) => console.log(new Date().toISOString().slice(11, 19), ...a));
  fs.mkdirSync(dataDir, { recursive: true });
  const rooms = new Map();
  let nextId = 1;

  const roomFile = (name) => path.join(dataDir, 'sala-' + name.replace(/[^a-z0-9_-]/gi, '_') + '.json');
  function loadRoom(name) {
    for (const f of [roomFile(name), roomFile(name) + '.bak']) {
      try { const d = JSON.parse(fs.readFileSync(f, 'utf8')); if (d && d.world) return d; } catch (e) { /* tenta o backup */ }
    }
    return null;
  }
  function saveRoom(room) {
    if (!room.dirty) return;
    const f = roomFile(room.name);
    const data = JSON.stringify({ name: room.name, pass: room.pass, canBuild: room.canBuild, world: room.world, players: room.saved });
    try {
      if (fs.existsSync(f)) fs.copyFileSync(f, f + '.bak');
      fs.writeFileSync(f + '.tmp', data);
      fs.renameSync(f + '.tmp', f);
      room.dirty = false;
    } catch (e) { log('erro ao salvar sala', room.name, e.message); }
  }
  function getRoom(name, pass, upload) {
    let room = rooms.get(name);
    if (room) return room;
    const disk = loadRoom(name);
    room = {
      name, pass: pass || '', canBuild: true, clients: new Map(), host: null, dirty: true,
      world: { seed: Math.floor(Math.random() * 2147483647), gen: 3, mode: 'survival', edits: {}, time: 0.3, weather: 'clear' },
      saved: {},
    };
    if (disk) { Object.assign(room, { pass: disk.pass || '', canBuild: disk.canBuild !== false, world: disk.world, saved: disk.players || {} }); room.dirty = false; }
    if (upload && !disk) setWorld(room, upload);
    rooms.set(name, room);
    return room;
  }
  function setWorld(room, up) {
    room.world = {
      seed: Number.isFinite(up.seed) ? up.seed | 0 : room.world.seed,
      gen: [1, 2, 3].includes(up.gen) ? up.gen : 3,
      mode: ['survival', 'creative', 'peaceful', 'challenge'].includes(up.mode) ? up.mode : 'survival',
      edits: {}, time: Number.isFinite(up.time) ? up.time : 0.3, weather: up.weather || 'clear',
    };
    for (const k in up.edits || {}) {
      if (!/^-?\d+,-?\d+$/.test(k) || !Array.isArray(up.edits[k])) continue;
      room.world.edits[k] = up.edits[k].filter((e) => Array.isArray(e) && Number.isInteger(e[0]) && e[0] >= 0 && e[0] < 32768 && Number.isInteger(e[1]));
    }
    room.dirty = true;
  }
  function setEdit(room, x, y, z, v) {
    const cx = Math.floor(x / 16), cz = Math.floor(z / 16);
    const idx = (x - cx * 16) + (z - cz * 16) * 16 + y * 256;
    const k = cx + ',' + cz;
    const list = room.world.edits[k] || (room.world.edits[k] = []);
    const i = list.findIndex((e) => e[0] === idx);
    if (i >= 0) list[i][1] = v; else list.push([idx, v]);
    room.dirty = true;
  }
  function getEdit(room, x, y, z) {
    const cx = Math.floor(x / 16), cz = Math.floor(z / 16);
    const idx = (x - cx * 16) + (z - cz * 16) * 16 + y * 256;
    const e = (room.world.edits[cx + ',' + cz] || []).find((q) => q[0] === idx);
    return e ? e[1] : null;
  }
  const send = (c, o) => { if (c.ws.readyState === 1) c.ws.send(JSON.stringify(o)); };
  const broadcast = (room, o, except) => { const s = JSON.stringify(o); for (const c of room.clients.values()) if (c !== except && c.ws.readyState === 1) c.ws.send(s); };
  const pub = (c) => ({ id: c.id, name: c.name, skin: c.skin, x: c.pos.x, y: c.pos.y, z: c.pos.z });

  function setHost(room, c) {
    room.host = c;
    if (c) { c.isHost = true; send(c, { t: 'host' }); log(`[${room.name}] anfitrião da simulação: ${c.name}`); }
  }

  function onHello(c, m) {
    const name = clean(m.room, 32) || 'principal';
    let pname = clean(m.name, 16) || 'Jogador';
    const upload = m.upload && typeof m.upload === 'object' ? m.upload : null;
    const room = getRoom(name, m.pass, upload);
    if (room.pass && room.pass !== String(m.pass || '')) { send(c, { t: 'error', msg: 'Senha incorreta.' }); c.ws.close(); return; }
    if (room.clients.size >= 16) { send(c, { t: 'error', msg: 'Sala cheia (máximo 16 jogadores).' }); c.ws.close(); return; }
    // nomes únicos na sala
    const taken = new Set([...room.clients.values()].map((o) => o.name));
    let n = 2; const base = pname; while (taken.has(pname)) pname = base.slice(0, 13) + ' ' + n++;
    c.name = pname; c.skin = m.skin && typeof m.skin === 'object' ? m.skin : null; c.room = room;
    // quem envia o mundo (PC "Hospedar sala") vira dono da sala e anfitrião
    if (upload) {
      if (room.owner && room.clients.size) { send(c, { t: 'error', msg: 'Esta sala já está aberta por outro anfitrião.' }); c.ws.close(); return; }
      setWorld(room, upload);
      room.owner = pname; room.pass = String(m.pass || '');
      c.owner = true;
    } else if (room.owner === pname) c.owner = true;
    const you = room.saved[pname] || null;
    if (you) c.pos = { x: you.x, y: you.y, z: you.z };
    const others = [...room.clients.values()].map(pub);
    room.clients.set(c.id, c);
    const isHost = !room.host;
    send(c, { t: 'welcome', id: c.id, room: name, host: isHost, canBuild: room.canBuild || c.owner, world: room.world, players: others, you: upload ? null : you });
    if (isHost) { room.host = c; c.isHost = true; }
    broadcast(room, { t: 'join', p: pub(c) }, c);
    log(`[${name}] ${pname} entrou (${room.clients.size} jogador(es))${isHost ? ' — anfitrião' : ''}`);
  }

  function onBlock(c, m) {
    const room = c.room;
    const { x, y, z, id } = m;
    const meta = m.m || 0;
    const deny = (reason) => {
      const v = getEdit(room, x, y, z);
      // devolve o valor que o servidor conhece (ou pede ao cliente para regenerar com id -1)
      send(c, { t: 'deny', x, y, z, id: v == null ? -1 : v & 255, m: v == null ? 0 : v >> 8, reason });
    };
    if (![x, y, z, id, meta].every(Number.isInteger) || y < 0 || y > 127 || id < 0 || id >= BLOCK_COUNT || meta < 0 || meta > 255 || Math.abs(x) > 3e7 || Math.abs(z) > 3e7) return deny('Edição inválida.');
    if (!room.canBuild && !c.owner) return deny('Você não tem permissão para construir nesta sala.');
    const now = Date.now();
    if (now - c.rateT > 1000) { c.rateT = now; c.rateN = 0; }
    if (++c.rateN > RATE) return deny('Muitas edições por segundo.');
    // o anfitrião também aplica efeitos automáticos (água, mecanismos, árvores), então fica sem limite de alcance
    if (!c.isHost && c.pos) {
      const d = Math.hypot(x + 0.5 - c.pos.x, y + 0.5 - (c.pos.y + 1.6), z + 0.5 - c.pos.z);
      if (d > REACH) return deny('Bloco fora de alcance.');
    }
    setEdit(room, x, y, z, id | (meta << 8));
    broadcast(room, { t: 'block', x, y, z, id, m: meta, by: c.id });
  }

  function onCommand(c, text) {
    const room = c.room;
    const [cmd, ...args] = text.slice(1).split(/\s+/);
    const reply = (msg) => send(c, { t: 'chat', from: 'Servidor', text: msg });
    if (cmd === 'jogadores' || cmd === 'players') return reply([...room.clients.values()].map((o) => o.name + (o.isHost ? ' (anfitrião)' : '')).join(', '));
    if (!c.owner) return reply('Apenas o dono da sala pode usar este comando.');
    if (cmd === 'construir' || cmd === 'build') {
      room.canBuild = !/^(off|nao|não|0)$/i.test(args[0] || '');
      room.dirty = true;
      for (const o of room.clients.values()) if (!o.owner) send(o, { t: 'perm', canBuild: room.canBuild });
      return reply('Construção dos visitantes: ' + (room.canBuild ? 'liberada' : 'bloqueada'));
    }
    if (cmd === 'expulsar' || cmd === 'kick') {
      const t = [...room.clients.values()].find((o) => o.name === args.join(' '));
      if (!t || t === c) return reply('Jogador não encontrado.');
      send(t, { t: 'error', msg: 'Você foi removido da sala.' }); t.kicked = true; t.ws.close();
      return reply(t.name + ' foi removido.');
    }
    if (cmd === 'senha') { room.pass = args.join(' '); room.dirty = true; return reply(room.pass ? 'Senha alterada.' : 'Sala aberta (sem senha).'); }
    reply('Comandos: /jogadores, /construir on|off, /expulsar <nome>, /senha <nova>');
  }

  function onMessage(c, m) {
    if (!c.room) { if (m.t === 'hello') onHello(c, m); return; }
    const room = c.room;
    switch (m.t) {
      case 'pos':
        if (![m.x, m.y, m.z].every(Number.isFinite)) return;
        c.pos = { x: m.x, y: m.y, z: m.z };
        broadcast(room, { t: 'pos', id: c.id, x: m.x, y: m.y, z: m.z, yaw: +m.yaw || 0, pitch: +m.pitch || 0, held: typeof m.held === 'string' ? m.held.slice(0, 32) : null, swing: m.swing ? 1 : 0 }, c);
        break;
      case 'block': onBlock(c, m); break;
      case 'chat': {
        const text = clean(m.text, 200);
        if (!text) return;
        if (text[0] === '/') return onCommand(c, text);
        broadcast(room, { t: 'chat', from: c.name, text }, c);
        break;
      }
      case 'profile':
        c.skin = m.skin && typeof m.skin === 'object' ? m.skin : c.skin;
        broadcast(room, { t: 'profile', id: c.id, name: c.name, skin: c.skin }, c);
        break;
      case 'inv':
        // inventário e estado guardados por nome (volta igual ao reconectar)
        room.saved[c.name] = { x: c.pos.x, y: c.pos.y, z: c.pos.z, inv: m.inv, armor: m.armor, health: +m.health || 20, hunger: +m.hunger || 20 };
        room.dirty = true;
        break;
      case 'env':
        if (c !== room.host) return;
        if (Number.isFinite(m.time)) room.world.time = m.time;
        if (['clear', 'rain', 'storm'].includes(m.weather)) room.world.weather = m.weather;
        broadcast(room, { t: 'env', time: room.world.time, weather: room.world.weather }, c);
        break;
      case 'mobs':
        if (c !== room.host || !Array.isArray(m.list)) return;
        broadcast(room, { t: 'mobs', list: m.list.slice(0, 80) }, c);
        break;
      case 'hitmob':
        if (!room.host || c === room.host) return;
        send(room.host, { t: 'hitmob', id: m.id, dmg: Math.min(10, Math.max(0, +m.dmg || 0)), from: c.pos });
        break;
    }
  }

  function onClose(c) {
    const room = c.room;
    if (!room) return;
    room.clients.delete(c.id);
    broadcast(room, { t: 'leave', id: c.id });
    log(`[${room.name}] ${c.name} saiu`);
    if (room.host === c) { room.host = null; const next = room.clients.values().next().value; if (next) setHost(room, next); }
    if (!room.clients.size) { saveRoom(room); rooms.delete(room.name); }
  }

  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    res.end(`Servidor VoxelCraft ativo. Salas abertas: ${rooms.size}\n`);
  });
  const wss = new WebSocketServer({ server, maxPayload: MAX_MSG });
  wss.on('connection', (ws, req) => {
    const c = { id: nextId++, ws, name: '?', pos: { x: 0, y: 80, z: 0 }, rateT: 0, rateN: 0, alive: true };
    ws.on('pong', () => { c.alive = true; });
    ws.on('message', (data) => {
      let m;
      try { m = JSON.parse(data); } catch (e) { return; }
      if (!m || typeof m.t !== 'string') return;
      try { onMessage(c, m); } catch (e) { log('erro', e.message); }
    });
    ws.on('close', () => onClose(c));
    ws.on('error', () => {});
  });
  // conexões mortas (celular que perdeu o Wi‑Fi) e salvamento periódico
  const iv = setInterval(() => {
    for (const ws of wss.clients) { const c = [...rooms.values()].flatMap((r) => [...r.clients.values()]).find((q) => q.ws === ws); if (c && !c.alive) { ws.terminate(); continue; } if (c) c.alive = false; ws.ping(); }
    for (const room of rooms.values()) saveRoom(room);
  }, 15000);

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, () => {
      const addresses = lanAddresses(port);
      log('Servidor VoxelCraft na porta ' + port + ' — endereços: ' + addresses.join(', '));
      resolve({
        port, addresses,
        close() { clearInterval(iv); for (const r of rooms.values()) saveRoom(r); for (const ws of wss.clients) ws.terminate(); wss.close(); server.close(); },
        rooms,
      });
    });
  });
}

module.exports = { startServer };
if (require.main === module) {
  startServer({ port: parseInt(process.argv[2], 10) || 8765 }).then((s) => {
    const stop = () => { s.close(); process.exit(0); }; // salva as salas antes de sair
    process.on('SIGINT', stop); process.on('SIGTERM', stop);
  }).catch((e) => { console.error('Não foi possível iniciar:', e.message); process.exit(1); });
}
