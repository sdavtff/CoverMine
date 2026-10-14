// Menus: inicial, mundos salvos, criar mundo, configurações, personalização, controles, multiplayer e pausa.
import { G, hook } from './state.js';
import { listWorlds, createWorld, renameWorld, deleteWorld, duplicateWorld, exportWorld, importWorld } from './saves.js';
import { buildPanel } from './graphics.js';
import { SKIN_PRESETS, drawHumanoidSkin } from './models.js';
import { VERSION } from './version.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, parent, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; if (parent) parent.appendChild(e); return e; };
const MODES = { survival: 'Sobrevivência', creative: 'Criativo', peaceful: 'Pacífico', challenge: 'Desafio' };
const MODE_DESC = {
  survival: 'Colete recursos, fabrique ferramentas, cuide da vida e da fome e sobreviva às noites.',
  creative: 'Blocos infinitos, voo e construção livre. Sem dano.',
  peaceful: 'Exploração e construção sem criaturas hostis. A fome não diminui.',
  challenge: 'Sobrevivência com uma sequência de objetivos e recompensas.',
};
export { MODES };

export const MENU = { page: null, back: null };
function page(title, build, back) {
  const m = $('menu');
  m.innerHTML = '';
  m.classList.remove('hidden');
  const box = el('div', 'menu-page', m);
  if (title) el('h2', '', box, title);
  build(box);
  if (back) { const b = el('button', 'back', box, '← Voltar'); b.onclick = back; }
  MENU.back = back || null;
  m.scrollTop = 0;
}
export function hideMenu() { $('menu').classList.add('hidden'); MENU.page = null; }

export function showTitle() {
  MENU.page = 'title';
  page(null, (box) => {
    const t = el('h1', 'logo', box, 'VoxelCraft');
    el('span', 'tag', t, 'HD');
    el('div', 'version', box, 'Versão ' + VERSION);
    const st = el('div', 'status', box); st.id = 'menu-status';
    const col = el('div', 'menu-col', box);
    el('button', 'big', col, '▶ Jogar').onclick = () => showWorlds();
    el('button', '', col, '🌐 Multiplayer').onclick = () => showMultiplayer();
    el('button', '', col, '⚙ Configurações').onclick = () => showSettings(showTitle);
    el('button', '', col, '🎨 Personalização').onclick = () => showPersonalize(showTitle);
    el('button', '', col, '🎮 Controles').onclick = () => showControls(showTitle);
    el('button', '', col, 'ℹ Sobre o jogo').onclick = () => showAbout(showTitle);
  });
}

export async function showWorlds() {
  MENU.page = 'worlds';
  const worlds = await listWorlds();
  page('Mundos salvos', (box) => {
    const top = el('div', 'row', box);
    el('button', 'big', top, '＋ Criar mundo').onclick = () => showCreate();
    const imp = el('button', '', top, '⤓ Importar');
    imp.onclick = () => {
      const f = document.createElement('input'); f.type = 'file'; f.accept = '.json,application/json';
      f.onchange = async () => { try { await importWorld(await f.files[0].text()); showWorlds(); hook('toast', 'Mundo importado!'); } catch (e) { alert('Não foi possível importar: ' + e.message); } };
      f.click();
    };
    const list = el('div', 'world-list', box);
    if (!worlds.length) el('div', 'muted', list, 'Nenhum mundo ainda. Crie o primeiro!');
    for (const w of worlds) {
      const r = el('div', 'world', list);
      const info = el('div', 'winfo', r);
      el('b', '', info, w.name);
      el('span', 'muted', info, `${MODES[w.mode] || w.mode} · semente ${w.seed} · ${new Date(w.played).toLocaleString('pt-BR')}${w.gen < 3 ? ' · gerador clássico' : ''}`);
      const b = el('div', 'wbtns', r);
      el('button', 'small primary', b, 'Abrir').onclick = () => hook('openWorld', w);
      el('button', 'small', b, 'Renomear').onclick = async () => { const n = prompt('Novo nome:', w.name); if (n) { await renameWorld(w.id, n); showWorlds(); } };
      el('button', 'small', b, 'Duplicar').onclick = async () => { await duplicateWorld(w.id); showWorlds(); };
      el('button', 'small', b, 'Exportar').onclick = async () => {
        const txt = await exportWorld(w.id);
        if (!txt) return;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([txt], { type: 'application/json' }));
        a.download = (w.name || 'mundo').replace(/[^\w\- ]+/g, '_') + '.voxelcraft.json';
        a.click();
      };
      el('button', 'small danger', b, 'Excluir').onclick = async () => { if (confirm(`Excluir "${w.name}" definitivamente?`)) { await deleteWorld(w.id); showWorlds(); } };
    }
  }, showTitle);
}

function showCreate() {
  MENU.page = 'create';
  page('Criar mundo', (box) => {
    const f = el('div', 'form', box);
    const row = (label) => { const r = el('label', 'frow', f); el('span', '', r, label); return r; };
    const name = el('input', '', row('Nome')); name.value = 'Novo mundo';
    const seed = el('input', '', row('Semente (opcional)')); seed.placeholder = 'aleatória';
    const mode = el('select', '', row('Modo de jogo'));
    for (const k in MODES) { const o = el('option', '', mode, MODES[k]); o.value = k; }
    const desc = el('div', 'muted', f, MODE_DESC.survival);
    mode.onchange = () => desc.textContent = MODE_DESC[mode.value];
    const gen = el('select', '', row('Gerador de terreno'));
    for (const [v, t] of [[3, 'Biomas (rios, cavernas, minérios, aldeias)'], [2, 'Clássico v2'], [1, 'Original v1']]) { const o = el('option', '', gen, t); o.value = v; }
    const go = el('button', 'big primary', box, 'Criar e jogar');
    go.onclick = async () => {
      let s = seed.value.trim();
      let sv;
      if (!s) sv = (Math.random() * 2147483647) | 0;
      else if (/^-?\d+$/.test(s)) sv = parseInt(s, 10) | 0;
      else { sv = 0; for (const ch of s) sv = (Math.imul(sv, 31) + ch.charCodeAt(0)) | 0; }
      const meta = await createWorld({ name: name.value.trim() || 'Novo mundo', seed: sv, mode: mode.value, gen: +gen.value });
      hook('openWorld', meta);
    };
  }, showWorlds);
}

// ---------------- configurações ----------------
export function showSettings(back) {
  MENU.page = 'settings';
  page('Configurações', (box) => {
    const tabs = el('div', 'tabs', box);
    const area = el('div', '', box);
    const showGfx = () => { area.innerHTML = ''; const p = el('div', 'gfx', area); MENU.gfx = buildPanel(p, G.settings, (key) => hook('settingsChanged', key)); };
    const showGen = () => {
      area.innerHTML = '';
      const f = el('div', 'form', area);
      const S = G.settings;
      const rng = (label, key, min, max, step, fmt) => {
        const r = el('label', 'frow', f); el('span', '', r, label);
        const i = el('input', '', r); i.type = 'range'; i.min = min; i.max = max; i.step = step; i.value = S[key];
        const v = el('b', '', r, fmt(S[key]));
        i.oninput = () => { S[key] = +i.value; v.textContent = fmt(S[key]); hook('settingsChanged', key); };
      };
      const chk = (label, key) => { const r = el('label', 'frow', f); el('span', '', r, label); const i = el('input', '', r); i.type = 'checkbox'; i.checked = !!S[key]; i.onchange = () => { S[key] = i.checked; hook('settingsChanged', key); }; };
      rng('Sensibilidade', 'sens', 0.3, 3, 0.1, (v) => (+v).toFixed(1));
      rng('Campo de visão (FOV)', 'fov', 55, 100, 1, (v) => v + '°');
      rng('Volume', 'volume', 0, 1, 0.05, (v) => Math.round(v * 100) + '%');
      rng('Tamanho da interface', 'uiScale', 0.8, 1.4, 0.05, (v) => Math.round(v * 100) + '%');
      chk('Inverter eixo vertical', 'invertY');
      chk('Mostrar minimapa', 'minimap');
      chk('Mostrar FPS e coordenadas', 'showInfo');
      chk('Mostrar bússola', 'compass');
      chk('Balanço da câmera ao andar', 'viewBob');
      chk('Reduzir flashes (raios)', 'reduceFlash');
      chk('Textos grandes / alto contraste', 'highContrast');
      chk('Atualizar o jogo automaticamente (com internet)', 'autoUpdate');
    };
    const tg = el('button', 'tab on', tabs, 'Configurações Gráficas'), tgen = el('button', 'tab', tabs, 'Geral e acessibilidade');
    tg.onclick = () => { tg.classList.add('on'); tgen.classList.remove('on'); showGfx(); };
    tgen.onclick = () => { tgen.classList.add('on'); tg.classList.remove('on'); showGen(); };
    showGfx();
  }, () => { hook('settingsClosed'); back(); });
}

// ---------------- personalização ----------------
export function showPersonalize(back) {
  MENU.page = 'personalize';
  const S = G.settings;
  S.skin = S.skin || Object.assign({}, SKIN_PRESETS[0]);
  page('Personalização', (box) => {
    const wrap = el('div', 'skin-wrap', box);
    const prev = el('canvas', 'skin-preview', wrap); prev.width = 160; prev.height = 320;
    const right = el('div', 'form', wrap);
    const nrow = el('label', 'frow', right); el('span', '', nrow, 'Nome do jogador');
    const name = el('input', '', nrow); name.value = S.name || 'Jogador'; name.maxLength = 16;
    name.oninput = () => { S.name = name.value.trim() || 'Jogador'; hook('settingsChanged', 'name'); };
    el('div', 'label', right, 'Skins prontas');
    const presets = el('div', 'presets', right);
    const draw = () => {
      const skin = drawHumanoidSkin(S.skin);
      const c = prev.getContext('2d');
      c.imageSmoothingEnabled = false;
      c.clearRect(0, 0, 160, 320);
      const k = 10;
      const blit = (sx, sy, w, h, dx, dy) => c.drawImage(skin, sx, sy, w, h, dx, dy, w * k, h * k);
      blit(8, 8, 8, 8, 40, 0);       // rosto
      blit(20, 20, 8, 12, 40, 80);   // tronco
      blit(44, 20, 4, 12, 0, 80);    // braço direito
      blit(36, 52, 4, 12, 120, 80);  // braço esquerdo
      blit(4, 20, 4, 12, 40, 200);   // perna direita
      blit(20, 52, 4, 12, 80, 200);  // perna esquerda
    };
    SKIN_PRESETS.forEach((p) => {
      const b = el('button', 'small', presets, p.name);
      b.onclick = () => { S.skin = Object.assign({}, p); syncInputs(); draw(); hook('settingsChanged', 'skin'); };
    });
    const colors = el('div', 'colors', right);
    const inputs = {};
    const hex = (c) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
    for (const [k, label] of [['skin', 'Pele'], ['hair', 'Cabelo'], ['eyes', 'Olhos'], ['shirt', 'Camisa'], ['pants', 'Calça'], ['shoes', 'Sapatos']]) {
      const r = el('label', 'crow', colors); el('span', '', r, label);
      const i = el('input', '', r); i.type = 'color';
      i.oninput = () => { const v = i.value; S.skin[k] = [parseInt(v.slice(1, 3), 16), parseInt(v.slice(3, 5), 16), parseInt(v.slice(5, 7), 16)]; draw(); hook('settingsChanged', 'skin'); };
      inputs[k] = i;
    }
    const hs = el('label', 'frow', right); el('span', '', hs, 'Cabelo');
    const hsel = el('select', '', hs);
    ['Curto', 'Longo', 'Raspado', 'Máscara'].forEach((t, i) => { const o = el('option', '', hsel, t); o.value = i; });
    hsel.onchange = () => { S.skin.hairStyle = +hsel.value; draw(); hook('settingsChanged', 'skin'); };
    const cam = el('label', 'frow', right); el('span', '', cam, 'Câmera inicial');
    const csel = el('select', '', cam);
    ['Primeira pessoa', 'Terceira pessoa (atrás)', 'Terceira pessoa (frente)'].forEach((t, i) => { const o = el('option', '', csel, t); o.value = i; });
    csel.value = S.camDefault || 0;
    csel.onchange = () => { S.camDefault = +csel.value; hook('settingsChanged', 'camDefault'); };
    const syncInputs = () => { for (const k in inputs) inputs[k].value = hex(S.skin[k]); hsel.value = S.skin.hairStyle || 0; };
    syncInputs(); draw();
  }, back);
}

export function showControls(back) {
  page('Controles', (box) => {
    const t = el('div', 'controls', box);
    t.innerHTML = `
      <h3>Celular (toque)</h3>
      <ul>
        <li><b>Joystick</b> (lado esquerdo): andar · empurrar até a borda: correr</li>
        <li><b>Arrastar</b> (lado direito): olhar</li>
        <li><b>Toque rápido</b>: colocar bloco / usar (portas, baús, mesa, fornalha, cama, alavancas) / comer / atacar criatura / conversar com aldeão</li>
        <li><b>Segurar</b>: minerar (a rachadura mostra o progresso) ou atacar continuamente</li>
        <li><b>▲</b> pular / nadar / subir (voo) · <b>▼</b> agachar / descer / sair do veículo</li>
        <li><b>🎒</b> inventário e fabricação · <b>👁</b> câmera 1ª/3ª pessoa · <b>🗺</b> mapa · <b>II</b> pausa</li>
        <li>No inventário: toque pega/solta a pilha, segurar divide ao meio, ⇄ Rápido move direto, 🗑 descarta</li>
      </ul>
      <h3>PC (teclado e mouse)</h3>
      <ul>
        <li><b>WASD</b> andar · <b>Mouse</b> olhar · <b>Espaço</b> pular · <b>Shift</b> agachar/descer/sair · <b>Ctrl</b> correr</li>
        <li><b>Clique esquerdo</b> (segurar) minerar/atacar · <b>Clique direito</b> colocar/usar</li>
        <li><b>1–9</b> / roda do mouse: barra de atalhos · <b>E</b> inventário · <b>Q</b> soltar item · <b>F</b> voar (criativo)</li>
        <li><b>V</b> ou <b>F5</b> câmera · <b>M</b> mapa · <b>T</b> chat (multiplayer) · <b>Esc</b> pausa/fechar · <b>F11</b> tela cheia (versão PC)</li>
      </ul>
      <h3>Dicas</h3>
      <ul>
        <li>Comece pegando madeira: troncos → tábuas → mesa de trabalho → picareta.</li>
        <li>Cama: dorme à noite (pula para a manhã) e define o ponto de renascimento.</li>
        <li>Elevador: pule em cima para subir até o próximo elevador; agache para descer.</li>
        <li>Fios de energia ligam alavancas, botões e placas a lâmpadas elétricas, portas e pistões.</li>
      </ul>`;
  }, back);
}
export function showAbout(back) {
  page('Sobre o VoxelCraft HD', (box) => {
    el('p', '', box, `Versão ${VERSION}. Jogo sandbox de blocos com renderização em WebGL (Three.js r160), mundo procedural com biomas, sobrevivência, fabricação, criaturas, aldeias, clima, mecanismos e multiplayer em rede local.`);
    el('p', 'muted', box, 'Texturas, sons e modelos são gerados por código. As atualizações do jogo são baixadas automaticamente quando houver internet.');
    el('p', 'muted', box, 'Desempenho: o jogo ajusta a qualidade automaticamente se o FPS cair. Em celulares mais simples, use a qualidade Baixa ou o Modo economia.');
  }, back);
}

export function showMultiplayer() {
  MENU.page = 'mp';
  page('Multiplayer', (box) => {
    el('p', 'muted', box, 'Jogue com amigos na mesma rede (Wi‑Fi). Um computador hospeda a sala (versão PC: botão "Hospedar sala", ou o servidor em server/). Os outros entram com o endereço mostrado na tela do anfitrião.');
    const f = el('div', 'form', box);
    const r1 = el('label', 'frow', f); el('span', '', r1, 'Endereço do servidor');
    const addr = el('input', '', r1); addr.placeholder = '192.168.0.10:8765'; addr.value = G.settings.lastServer || '';
    const r2 = el('label', 'frow', f); el('span', '', r2, 'Sala');
    const room = el('input', '', r2); room.value = G.settings.lastRoom || 'principal';
    const r3 = el('label', 'frow', f); el('span', '', r3, 'Senha (opcional)');
    const pass = el('input', '', r3); pass.type = 'password';
    const st = el('div', 'status', box);
    const join = el('button', 'big primary', box, 'Entrar na sala');
    join.onclick = () => { G.settings.lastServer = addr.value.trim(); G.settings.lastRoom = room.value.trim(); hook('settingsChanged', 'lastServer'); hook('joinServer', addr.value.trim(), room.value.trim() || 'principal', pass.value, (msg) => st.textContent = msg); };
    if (window.vcDesktop && window.vcDesktop.host) {
      el('div', 'sep', box);
      el('p', 'muted', box, 'Este computador pode hospedar uma sala usando um dos seus mundos salvos.');
      const host = el('button', '', box, '🖥 Hospedar sala com um mundo...');
      host.onclick = () => hook('hostPick');
    }
  }, showTitle);
}

export function showPause(onResume, onQuit) {
  MENU.page = 'pause';
  page('Jogo pausado', (box) => {
    const col = el('div', 'menu-col', box);
    el('button', 'big primary', col, '▶ Continuar').onclick = onResume;
    el('button', '', col, '⚙ Configurações').onclick = () => showSettings(() => showPause(onResume, onQuit));
    el('button', '', col, '🎨 Personalização').onclick = () => showPersonalize(() => showPause(onResume, onQuit));
    el('button', '', col, '🎮 Controles').onclick = () => showControls(() => showPause(onResume, onQuit));
    if (G.net) el('div', 'muted', col, G.net.statusText ? G.net.statusText() : 'Conectado.');
    el('button', 'danger', col, '💾 Salvar e sair').onclick = onQuit;
  });
}
