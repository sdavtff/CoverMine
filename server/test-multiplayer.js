// Teste automático do protocolo do servidor (dois clientes WebSocket simulados).
// Uso: node test-multiplayer.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');
const { startServer } = require('./server.js');

const PORT = 18765;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-srv-'));
let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ok  ', msg); } else { fail++; console.log('  FALHA', msg); } };

function client(hello) {
  return new Promise((resolve) => {
    const ws = new WebSocket('ws://localhost:' + PORT);
    const c = { ws, msgs: [], send: (o) => ws.send(JSON.stringify(o)) };
    c.wait = (pred, ms = 2000) => new Promise((res) => {
      const found = c.msgs.find(pred); if (found) return res(found);
      const t = setTimeout(() => res(null), ms);
      c.waiters.push((m) => { if (pred(m)) { clearTimeout(t); res(m); return true; } return false; });
    });
    c.waiters = [];
    ws.on('message', (d) => { const m = JSON.parse(d); c.msgs.push(m); c.waiters = c.waiters.filter((w) => !w(m)); });
    ws.on('close', () => { c.closed = true; });
    ws.on('open', () => { c.send(Object.assign({ t: 'hello', version: 3 }, hello)); resolve(c); });
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  let srv = await startServer({ port: PORT, dataDir, log: () => {} });
  console.log('Servidor iniciado:', srv.addresses.join(', '));

  const host = await client({ room: 'teste', pass: 'abc', name: 'Davi', upload: { seed: 1234, gen: 3, mode: 'survival', edits: { '0,0': [[5 + 70 * 256, 4]] }, time: 0.4, weather: 'rain' } });
  const w1 = await host.wait((m) => m.t === 'welcome');
  ok(w1 && w1.host === true && w1.world.seed === 1234, 'anfitrião recebe welcome com o mundo enviado');

  const bad = await client({ room: 'teste', pass: 'errada', name: 'Intruso' });
  const e1 = await bad.wait((m) => m.t === 'error');
  ok(e1 && /Senha/.test(e1.msg), 'senha errada é recusada');

  const guest = await client({ room: 'teste', pass: 'abc', name: 'Ana' });
  const w2 = await guest.wait((m) => m.t === 'welcome');
  ok(w2 && w2.host === false && w2.world.seed === 1234 && w2.world.edits['0,0'].length === 1 && w2.players.length === 1, 'convidado recebe semente, edições e lista de jogadores');
  ok(!!(await host.wait((m) => m.t === 'join' && m.p.name === 'Ana')), 'anfitrião é avisado da entrada');

  guest.send({ t: 'pos', x: 3, y: 70, z: 3, yaw: 1, pitch: 0, held: 'stone', swing: 0 });
  const p = await host.wait((m) => m.t === 'pos' && m.x === 3);
  ok(p && p.held === 'stone', 'posição do convidado é repassada');

  guest.send({ t: 'block', x: 4, y: 71, z: 4, id: 1, m: 0 });
  const b = await host.wait((m) => m.t === 'block' && m.x === 4);
  ok(b && b.id === 1, 'edição válida é aplicada e repassada');

  guest.send({ t: 'block', x: 400, y: 71, z: 4, id: 1, m: 0 });
  const d = await guest.wait((m) => m.t === 'deny' && m.x === 400);
  ok(d && /alcance/.test(d.reason), 'edição fora de alcance é recusada');

  guest.send({ t: 'block', x: 4, y: 71, z: 4, id: 999, m: 0 });
  const d2 = await guest.wait((m) => m.t === 'deny' && m.id !== -1 && m.x === 4);
  ok(d2 && d2.id === 1, 'id inválido é recusado e devolve o bloco conhecido');

  guest.send({ t: 'chat', text: 'oi!' });
  const ch = await host.wait((m) => m.t === 'chat' && m.text === 'oi!');
  ok(ch && ch.from === 'Ana', 'chat com nome do jogador');

  host.send({ t: 'chat', text: '/construir off' });
  const pm = await guest.wait((m) => m.t === 'perm');
  ok(pm && pm.canBuild === false, 'dono bloqueia construção de visitantes');
  guest.send({ t: 'block', x: 5, y: 71, z: 4, id: 1, m: 0 });
  const d3 = await guest.wait((m) => m.t === 'deny' && m.x === 5);
  ok(d3 && /permiss/.test(d3.reason), 'visitante sem permissão é recusado');
  guest.send({ t: 'chat', text: '/construir on' });
  const r1 = await guest.wait((m) => m.t === 'chat' && m.from === 'Servidor');
  ok(r1 && /dono/.test(r1.text), 'visitante não pode usar comandos de dono');
  host.send({ t: 'chat', text: '/construir on' });
  await guest.wait((m) => m.t === 'perm' && m.canBuild === true);

  for (let i = 0; i < 60; i++) guest.send({ t: 'block', x: 4, y: 72, z: 4, id: (i % 2) + 1, m: 0 });
  const rl = await guest.wait((m) => m.t === 'deny' && /Muitas/.test(m.reason || ''));
  ok(!!rl, 'limite de edições por segundo');

  host.send({ t: 'mobs', list: [[1, 'cow', 0, 1, 70, 1, 0, 0, 0]] });
  ok(!!(await guest.wait((m) => m.t === 'mobs')), 'criaturas do anfitrião chegam ao convidado');
  guest.send({ t: 'mobs', list: [] });
  guest.send({ t: 'hitmob', id: 1, dmg: 50 });
  const hm = await host.wait((m) => m.t === 'hitmob');
  ok(hm && hm.dmg === 10, 'ataque do convidado vai ao anfitrião (dano limitado)');

  guest.send({ t: 'inv', inv: [{ k: 'stone', n: 7 }], armor: [], health: 15, hunger: 12 });
  await sleep(100);

  // anfitrião sai → convidado assume a simulação
  host.ws.close();
  ok(!!(await guest.wait((m) => m.t === 'host')), 'outro jogador assume como anfitrião');
  ok(!!(await guest.wait((m) => m.t === 'leave')), 'saída é avisada');
  guest.ws.close();
  await sleep(200);

  // reinicia o servidor: sala volta do disco
  srv.close();
  await sleep(200);
  srv = await startServer({ port: PORT, dataDir, log: () => {} });
  const back = await client({ room: 'teste', pass: 'abc', name: 'Ana' });
  const w3 = await back.wait((m) => m.t === 'welcome');
  const edits = w3 && w3.world.edits['0,0'];
  ok(w3 && w3.world.seed === 1234 && edits.some((e) => e[0] === 4 + 4 * 16 + 71 * 256 && e[1] === 1), 'mundo e edições persistem após reiniciar o servidor');
  ok(w3 && w3.you && w3.you.inv[0].k === 'stone' && w3.you.health === 15, 'inventário/vida do jogador voltam ao reconectar');
  back.ws.close();

  srv.close();
  console.log(`\n${pass} passaram, ${fail} falharam`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
