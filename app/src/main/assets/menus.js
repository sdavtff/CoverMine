// Menus: inicial, mundos salvos, criar mundo, configurações, personalização, controles, multiplayer e pausa.
import { G, hook } from './state.js';
import { listWorlds, createWorld, renameWorld, deleteWorld, duplicateWorld, exportWorld, importWorld } from './saves.js';
import { buildPanel } from './graphics.js';
import { SKIN_PRESETS, drawHumanoidSkin, OUTFITS, HATS, importSkinFile } from './models.js';
import { VERSION } from './version.js';
import { askText, askConfirm, showMessage } from './dialog.js';
import { queryRooms } from './net.js';
import { checkUpdates } from './update.js';

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
      f.onchange = async () => { try { await importWorld(await f.files[0].text()); showWorlds(); hook('toast', 'Mundo importado!'); } catch (e) { showMessage('Não foi possível importar: ' + e.message); } };
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
      el('button', 'small', b, 'Renomear').onclick = async () => { const n = await askText('Novo nome do mundo', w.name, { max: 40 }); if (n) { await renameWorld(w.id, n); showWorlds(); } };
      el('button', 'small', b, 'Duplicar').onclick = async () => { await duplicateWorld(w.id); showWorlds(); };
      el('button', 'small', b, 'Exportar').onclick = async () => {
        const txt = await exportWorld(w.id);
        if (!txt) return;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([txt], { type: 'application/json' }));
        a.download = (w.name || 'mundo').replace(/[^\w\- ]+/g, '_') + '.voxelcraft.json';
        a.click();
      };
      el('button', 'small danger', b, 'Excluir').onclick = async () => { if (await askConfirm(`Excluir "${w.name}" definitivamente? Isso não pode ser desfeito.`, 'Excluir')) { await deleteWorld(w.id); showWorlds(); } };
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
    for (const [v, t] of [[4, 'Natural (erosão, falésias, estalactites, cipós)'], [3, 'Biomas (rios, cavernas, minérios, aldeias)'], [2, 'Clássico v2'], [1, 'Original v1']]) { const o = el('option', '', gen, t); o.value = v; }
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
      chk('Som 3D (fones: direção dos sons) e eco do ambiente', 'audio3d');
      chk('Atualizar o jogo automaticamente (com internet)', 'autoUpdate');
      const ub = el('button', '', f, '🔄 Verificar atualizações agora');
      ub.onclick = async () => {
        ub.disabled = true; ub.textContent = 'Verificando...';
        try { const v = await checkUpdates(true); hook('toast', v ? `Nova versão ${v} disponível — toque em "Atualizar agora".` : `Você já está na versão mais nova (${VERSION}).`); }
        catch (e) { hook('toast', 'Sem conexão para verificar atualizações.'); }
        ub.disabled = false; ub.textContent = '🔄 Verificar atualizações agora';
      };
      // benchmark: mede o desempenho do preset atual num trajeto fixo (sem mexer nos mundos salvos)
      const bsec = el('div', 'mp-section', f);
      el('h3', '', bsec, 'Benchmark');
      el('p', 'muted', bsec, 'Voa 20 s num trajeto fixo (mesma semente e hora) e mede o FPS. Rode antes e depois de mudar uma opção para comparar.');
      if (G.world) el('p', 'muted', bsec, 'Saia do mundo atual (Salvar e sair) para rodar o benchmark.');
      else el('button', 'primary', bsec, '⏱ Rodar benchmark (20 s)').onclick = () => hook('runBenchmark');
      const hist = S.benchHistory || [];
      if (hist.length) {
        const tbl = el('table', 'bench-table', bsec);
        const hr = el('tr', '', tbl); for (const h of ['Quando', 'Preset', 'FPS', '1% low', 'GPU ms', 'Opções']) el('th', '', hr, h);
        for (const r of hist) { const tr = el('tr', '', tbl); for (const v of [r.date, r.preset, r.fps.toFixed(1), r.low1.toFixed(1), r.gpu != null ? r.gpu.toFixed(2) : '—', r.opts]) el('td', '', tr, v); }
      }
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
    const left = el('div', 'skin-left', wrap);
    const prev = el('canvas', 'skin-preview', left); prev.width = 340; prev.height = 320;
    el('div', 'muted center', left, 'frente · costas');
    const right = el('div', 'form', wrap);
    const nrow = el('label', 'frow', right); el('span', '', nrow, 'Nome do jogador');
    const name = el('input', '', nrow); name.value = S.name || 'Jogador'; name.maxLength = 16;
    name.oninput = () => { S.name = name.value.trim() || 'Jogador'; hook('settingsChanged', 'name'); };
    // desenha frente e costas (as faces da rede da skin) em escala
    const drawView = (c, skin, ox, back) => {
      const k = 10;
      const blit = (sx, sy, w, h, dx, dy) => c.drawImage(skin, sx, sy, w, h, ox + dx, dy, w * k, h * k);
      if (!back) { blit(8, 8, 8, 8, 40, 0); blit(20, 20, 8, 12, 40, 80); blit(44, 20, 4, 12, 0, 80); blit(36, 52, 4, 12, 120, 80); blit(4, 20, 4, 12, 40, 200); blit(20, 52, 4, 12, 80, 200); }
      else { blit(24, 8, 8, 8, 40, 0); blit(32, 20, 8, 12, 40, 80); blit(44, 52, 4, 12, 0, 80); blit(52, 20, 4, 12, 120, 80); blit(28, 52, 4, 12, 40, 200); blit(12, 20, 4, 12, 80, 200); }
    };
    const draw = () => {
      const skin = drawHumanoidSkin(S.skin);
      const paint = () => { const c = prev.getContext('2d'); c.imageSmoothingEnabled = false; c.clearRect(0, 0, 340, 320); drawView(c, skin, 0, false); drawView(c, skin, 180, true); };
      paint();
      if (skin.pending) skin.addEventListener('skinready', paint);
    };
    const changed = () => { draw(); syncInputs(); hook('settingsChanged', 'skin'); };
    el('div', 'label', right, 'Skins prontas');
    const presets = el('div', 'skin-gallery', right);
    SKIN_PRESETS.forEach((p) => {
      const b = el('button', 'skin-thumb', presets);
      const cv = el('canvas', '', b); cv.width = 32; cv.height = 48;
      const sk = drawHumanoidSkin(p), c = cv.getContext('2d'); c.imageSmoothingEnabled = false;
      c.drawImage(sk, 8, 8, 8, 8, 8, 0, 16, 16); c.drawImage(sk, 20, 20, 8, 12, 8, 16, 16, 24); c.drawImage(sk, 44, 20, 4, 12, 0, 16, 8, 24); c.drawImage(sk, 36, 52, 4, 12, 24, 16, 8, 24); c.drawImage(sk, 4, 20, 4, 4, 8, 40, 8, 8); c.drawImage(sk, 20, 52, 4, 4, 16, 40, 8, 8);
      el('span', '', b, p.name);
      b.onclick = () => { S.skin = JSON.parse(JSON.stringify(p)); changed(); };
    });
    const tools = el('div', 'row', right);
    el('button', 'small', tools, '🎲 Aleatória').onclick = () => {
      const r = () => Math.floor(Math.random() * 256), col = () => [r(), r(), r()];
      const tones = [[250, 214, 186], [236, 192, 160], [200, 150, 112], [160, 110, 80], [120, 80, 55], [90, 60, 40]];
      const ok = Object.keys(OUTFITS);
      S.skin = { name: 'Aleatória', skin: tones[Math.floor(Math.random() * tones.length)], hair: col(), eyes: col(), shirt: col(), pants: col(), shoes: col(), hairStyle: Math.floor(Math.random() * 3),
        outfit: ok[Math.floor(Math.random() * ok.length)], accent: col(), hat: Math.random() < 0.5 ? 0 : 1 + Math.floor(Math.random() * 6), hatColor: col(), beard: Math.random() < 0.2, glasses: Math.random() < 0.2 };
      changed();
    };
    const imp = el('button', 'small', tools, '⤓ Importar PNG');
    imp.onclick = () => {
      const f = document.createElement('input'); f.type = 'file'; f.accept = 'image/png';
      f.onchange = async () => {
        try { const png = await importSkinFile(f.files[0]); S.skin = { name: 'Importada', png }; changed(); hook('toast', 'Skin importada!'); }
        catch (e) { showMessage('Não foi possível usar esta imagem: ' + e.message + '.\nUse uma skin PNG de 64×64 pixels (formato padrão de skins de jogos de blocos).'); }
      };
      f.click();
    };
    el('button', 'small', tools, '⤒ Exportar PNG').onclick = () => {
      const a = document.createElement('a'); a.href = drawHumanoidSkin(S.skin).toDataURL('image/png'); a.download = (S.name || 'skin') + '.png'; a.click();
    };
    const custom = el('div', 'skin-custom', right);
    const pngNote = el('div', 'muted', right, 'Skin importada de imagem. Escolha uma skin pronta para voltar a editar as cores.');
    const colors = el('div', 'colors', custom);
    const inputs = {};
    const hex = (c) => '#' + (c || [0, 0, 0]).map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
    for (const [k, label] of [['skin', 'Pele'], ['hair', 'Cabelo'], ['eyes', 'Olhos'], ['shirt', 'Roupa'], ['pants', 'Calça'], ['shoes', 'Sapatos'], ['accent', 'Detalhes'], ['hatColor', 'Chapéu']]) {
      const r = el('label', 'crow', colors); el('span', '', r, label);
      const i = el('input', '', r); i.type = 'color';
      i.oninput = () => { const v = i.value; S.skin[k] = [parseInt(v.slice(1, 3), 16), parseInt(v.slice(3, 5), 16), parseInt(v.slice(5, 7), 16)]; draw(); hook('settingsChanged', 'skin'); };
      inputs[k] = i;
    }
    const sel = (label, opts, key, num) => {
      const r = el('label', 'frow', custom); el('span', '', r, label);
      const sl = el('select', '', r);
      opts.forEach(([v, t]) => { const o = el('option', '', sl, t); o.value = v; });
      sl.onchange = () => { S.skin[key] = num ? +sl.value : sl.value; changed(); };
      return sl;
    };
    const hsel = sel('Cabelo', [[0, 'Curto'], [1, 'Longo'], [2, 'Raspado'], [3, 'Máscara']], 'hairStyle', true);
    const osel = sel('Roupa', Object.entries(OUTFITS), 'outfit', false);
    const tsel = sel('Chapéu', HATS.map((t, i) => [i, t]), 'hat', true);
    const chk = (label, key) => { const r = el('label', 'frow', custom); el('span', '', r, label); const i = el('input', '', r); i.type = 'checkbox'; i.onchange = () => { S.skin[key] = i.checked; changed(); }; return i; };
    const cBeard = chk('Barba', 'beard'), cGlasses = chk('Óculos', 'glasses');
    const cam = el('label', 'frow', right); el('span', '', cam, 'Câmera inicial');
    const csel = el('select', '', cam);
    ['Primeira pessoa', 'Terceira pessoa (atrás)', 'Terceira pessoa (frente)'].forEach((t, i) => { const o = el('option', '', csel, t); o.value = i; });
    csel.value = S.camDefault || 0;
    csel.onchange = () => { S.camDefault = +csel.value; hook('settingsChanged', 'camDefault'); };
    const syncInputs = () => {
      const png = !!S.skin.png;
      custom.style.display = png ? 'none' : ''; pngNote.style.display = png ? '' : 'none';
      if (png) return;
      for (const k in inputs) inputs[k].value = hex(S.skin[k] || (k === 'accent' ? S.skin.shirt : [60, 60, 60]));
      hsel.value = S.skin.hairStyle || 0; osel.value = S.skin.outfit || 'plain'; tsel.value = S.skin.hat || 0;
      cBeard.checked = !!S.skin.beard; cGlasses.checked = !!S.skin.glasses;
    };
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
  const S = G.settings;
  page('Multiplayer', (box) => {
    el('p', 'muted', box, 'Jogue com amigos na mesma rede Wi‑Fi. Cada sala tem o seu próprio mundo: entre numa sala da lista ou crie uma nova com um mundo novo ou um dos seus mundos salvos.');
    const f = el('div', 'form', box);
    const r1 = el('label', 'frow', f); el('span', '', r1, 'Servidor');
    const addr = el('input', '', r1); addr.placeholder = '192.168.0.10:8765'; addr.value = S.lastServer || '';
    const brow = el('div', 'row', box);
    const refresh = el('button', 'primary', brow, '🔄 Ver salas');
    let hostBtn = null;
    if (window.vcDesktop && window.vcDesktop.host) hostBtn = el('button', '', brow, '🖥 Ligar servidor neste PC');
    const st = el('div', 'status', box);
    const list = el('div', 'room-list', box);
    const setStatus = (m) => { st.textContent = m || ''; };
    const saveAddr = () => { S.lastServer = addr.value.trim(); hook('settingsChanged', 'lastServer'); };
    const load = async () => {
      saveAddr();
      list.innerHTML = ''; setStatus('Procurando salas...');
      let rooms;
      try { rooms = await queryRooms(addr.value.trim()); } catch (e) { setStatus('Erro: ' + e.message); return; }
      setStatus(rooms.length ? `${rooms.length} sala(s) neste servidor.` : 'Nenhuma sala ainda. Crie a primeira abaixo!');
      for (const r of rooms) {
        const row = el('div', 'room', list);
        const info = el('div', 'rinfo', row);
        el('b', '', info, `${r.locked ? '🔒 ' : ''}${r.name}`);
        el('span', 'muted', info, `${r.world} · ${MODES[r.mode] || r.mode || ''} · ${r.players} jogando${r.names && r.names.length ? ' (' + r.names.join(', ') + ')' : ''}${r.owner ? ' · dono: ' + r.owner : ''}`);
        el('button', 'small primary', row, 'Entrar').onclick = async () => {
          let pass = '';
          if (r.locked) { pass = await askText(`Senha da sala "${r.name}"`, '', { password: true }); if (pass === null) return; }
          S.lastRoom = r.name; hook('settingsChanged', 'lastRoom');
          hook('joinServer', addr.value.trim(), r.name, pass, setStatus);
        };
      }
    };
    refresh.onclick = load;
    if (hostBtn) hostBtn.onclick = async () => {
      setStatus('Ligando o servidor...');
      const info = await window.vcDesktop.host(8765);
      if (!info || !info.ok) { setStatus('Não foi possível ligar o servidor: ' + (info && info.error)); return; }
      addr.value = 'localhost:' + (info.port || 8765);
      await load();
      setStatus(`Servidor ligado. Seus amigos usam o endereço: ${info.addresses.join(' ou ')}`);
    };
    // criar sala
    const sec = el('div', 'mp-section', box);
    el('h3', '', sec, 'Criar sala');
    const cf = el('div', 'form', sec);
    const row = (label) => { const r = el('label', 'frow', cf); el('span', '', r, label); return r; };
    const rname = el('input', '', row('Nome da sala')); rname.maxLength = 32; rname.value = (S.name || 'Jogador') + ' - sala';
    const rpass = el('input', '', row('Senha (opcional)')); rpass.type = 'password'; rpass.maxLength = 40;
    const src = el('select', '', row('Mundo'));
    el('option', '', src, '🌱 Mundo novo').value = 'new';
    const newBox = el('div', 'form', cf);
    const nrow = (label) => { const r = el('label', 'frow', newBox); el('span', '', r, label); return r; };
    const wname = el('input', '', nrow('Nome do mundo')); wname.value = 'Mundo compartilhado'; wname.maxLength = 40;
    const wseed = el('input', '', nrow('Semente (opcional)')); wseed.placeholder = 'aleatória';
    const wmode = el('select', '', nrow('Modo de jogo'));
    for (const k in MODES) { const o = el('option', '', wmode, MODES[k]); o.value = k; }
    listWorlds().then((ws) => { for (const w of ws) { const o = el('option', '', src, '💾 ' + w.name); o.value = w.id; } });
    src.onchange = () => { newBox.style.display = src.value === 'new' ? '' : 'none'; };
    const create = el('button', 'big primary', sec, 'Criar sala e jogar');
    create.onclick = async () => {
      saveAddr();
      const name = rname.value.trim();
      if (!name) { setStatus('Dê um nome para a sala.'); return; }
      let source;
      if (src.value === 'new') {
        const t = wseed.value.trim();
        let seed = !t ? (Math.random() * 2147483647) | 0 : /^-?\d+$/.test(t) ? parseInt(t, 10) | 0 : [...t].reduce((h, ch) => (Math.imul(h, 31) + ch.charCodeAt(0)) | 0, 7);
        source = { type: 'new', name: wname.value.trim() || 'Mundo compartilhado', seed, mode: wmode.value, gen: 4 };
      } else source = { type: 'saved', id: src.value };
      hook('createRoom', addr.value.trim(), name, rpass.value, source, setStatus);
    };
    if (addr.value) load();
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
    el('button', '', col, '📷 Modo foto').onclick = () => hook('photoMode');
    if (G.net) el('div', 'muted', col, G.net.statusText ? G.net.statusText() : 'Conectado.');
    el('button', 'danger', col, '💾 Salvar e sair').onclick = onQuit;
  });
}
