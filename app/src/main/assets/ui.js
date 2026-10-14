// Interface do jogo: HUD e telas (inventário, mesa, fornalha, baú, criativo, aldeão, morte).
import { G, hook } from './state.js';
import { ITEMS, itemName, maxStack, ARMOR_SLOTS } from './items.js';
import { paintIcon, itemIcon } from './icons.js';
import { Inventory, RECIPES, findRecipe, canCraft, craftFromInventory, recipeIngredients, smeltResult, fuelValue, SMELT_TIME } from './crafting.js';
import { BLOCKS } from './blocks.js';
import { GREETINGS, } from './villagers.js';
import { PROFESSIONS } from './mobs.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, parent, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; if (parent) parent.appendChild(e); return e; };

export const UI = { cursor: null, screen: null, quick: false, slotEls: [] };

// ---------------- HUD ----------------
export function initHUD() {
  const hb = $('hotbar');
  hb.innerHTML = '';
  UI.hot = [];
  for (let i = 0; i < 9; i++) {
    const s = makeSlotEl(hb);
    const pick = (e) => { e.preventDefault(); e.stopPropagation(); hook('selectSlot', i); };
    s.root.addEventListener('touchstart', pick, { passive: false });
    s.root.addEventListener('mousedown', pick);
    UI.hot.push(s);
  }
  UI.stats = $('stats');
  UI.hearts = el('div', 'bar hearts', UI.stats);
  UI.food = el('div', 'bar food', UI.stats);
  UI.armor = el('div', 'bar armor', UI.stats);
  UI.air = el('div', 'bar air', UI.stats);
  UI.compass = $('compass');
}
function makeSlotEl(parent) {
  const root = el('div', 'slot', parent);
  const cv = el('canvas', '', root); cv.width = cv.height = 48;
  const cnt = el('span', 'cnt', root);
  const dur = el('i', 'dur', root);
  return { root, cv, cnt, dur, key: undefined, n: -1, d: -1 };
}
function paintSlot(s, st) {
  const key = st ? st.k : null, n = st ? st.n : 0, d = st ? st.d || 0 : 0;
  if (s.key !== key) { paintIcon(s.cv, key); s.key = key; s.root.title = key ? itemName(key) : ''; }
  if (s.n !== n) { s.cnt.textContent = n > 1 ? n : ''; s.n = n; }
  if (s.d !== d) {
    s.d = d;
    const tool = key && ITEMS[key] && (ITEMS[key].tool || ITEMS[key].armor);
    if (tool && d > 0) { const f = 1 - d / tool.dur; s.dur.style.display = 'block'; s.dur.style.width = Math.max(4, f * 80) + '%'; s.dur.style.background = `hsl(${f * 120},80%,45%)`; }
    else s.dur.style.display = 'none';
  }
}
let lastHud = '';
export function updateHUD() {
  const pl = G.player;
  for (let i = 0; i < 9; i++) { paintSlot(UI.hot[i], pl.inv.get(i)); UI.hot[i].root.classList.toggle('sel', i === pl.selected); }
  const surv = G.mode !== 'creative';
  const armor = pl.armorPoints();
  const key = [surv, Math.ceil(pl.health), pl.hunger, armor, Math.ceil(pl.air), pl.headInWater].join('|');
  if (key !== lastHud) {
    lastHud = key;
    UI.stats.style.display = surv ? 'flex' : 'none';
    UI.hearts.innerHTML = icons(Math.ceil(pl.health), '❤', 'h');
    UI.food.innerHTML = icons(pl.hunger, '🍗', 'f');
    UI.armor.innerHTML = armor > 0 ? icons(armor, '🛡', 'a') : '';
    UI.air.innerHTML = pl.headInWater || pl.air < 10 ? icons(Math.ceil(pl.air * 2), '●', 'b') : '';
  }
  $('dmg-flash').style.opacity = pl.hurtTime > 0 ? Math.min(0.5, pl.hurtTime) : (pl.health <= 4 && surv ? 0.12 + Math.sin(G.time * 4) * 0.06 : 0);
  // bússola
  const deg = ((-pl.yaw * 180 / Math.PI) % 360 + 360) % 360;
  UI.compass.style.backgroundPositionX = (-deg * 2) + 'px';
  $('compass-deg').textContent = ['N', 'NE', 'L', 'SE', 'S', 'SO', 'O', 'NO'][Math.round(((deg + 180) % 360) / 45) % 8];
}
function icons(v, ch, cls) {
  let s = '';
  for (let i = 0; i < 10; i++) {
    const f = Math.max(0, Math.min(2, v - i * 2));
    s += `<b class="${cls} ${f === 2 ? 'full' : f === 1 ? 'half' : 'empty'}">${ch}</b>`;
  }
  return s;
}

// ---------------- telas ----------------
function openScreen(title, build, onClose, opts = {}) {
  closeScreen(true);
  const scr = $('screen');
  scr.innerHTML = '';
  scr.classList.add('open');
  const box = el('div', 'panel', scr);
  const head = el('div', 'panel-head', box);
  el('h3', '', head, title);
  UI.cursorEl = el('div', 'slot cursor', head);
  UI.cursorEl.title = 'Item na mão';
  UI.cursorCv = el('canvas', '', UI.cursorEl); UI.cursorCv.width = UI.cursorCv.height = 48;
  UI.cursorCnt = el('span', 'cnt', UI.cursorEl);
  const quick = el('button', 'small' + (UI.quick ? ' on' : ''), head, '⇄ Rápido');
  quick.title = 'Modo rápido: toque move a pilha inteira para o outro inventário';
  quick.onclick = () => { UI.quick = !UI.quick; quick.classList.toggle('on', UI.quick); };
  const trash = el('button', 'small danger', head, '🗑');
  trash.title = 'Descartar item na mão';
  trash.onclick = () => { if (UI.cursor) { if (G.mode !== 'creative') hook('throwItem', UI.cursor.k, UI.cursor.n, UI.cursor.d); UI.cursor = null; refreshCursor(); } };
  // telas sem itens (mapa): esconde mão/rápido/lixeira
  if (opts.noItems) for (const e of [UI.cursorEl, quick, trash]) e.style.display = 'none';
  const close = el('button', 'small', head, '✕');
  close.onclick = () => hook('closeScreen');
  const body = el('div', 'panel-body', box);
  UI.screen = { body, refreshers: [], onClose };
  build(body);
  G.paused = true;
  refreshAll();
}
export function closeScreen(silent) {
  const scr = $('screen');
  if (!UI.screen) return;
  // item na mão volta ao inventário (ou cai no chão)
  if (UI.cursor) { const left = G.player.inv.add(UI.cursor.k, UI.cursor.n, UI.cursor.d); if (left) hook('throwItem', UI.cursor.k, left, UI.cursor.d); UI.cursor = null; }
  if (UI.screen.onClose) UI.screen.onClose();
  UI.screen = null;
  scr.classList.remove('open');
  scr.innerHTML = '';
  G.paused = false;
  if (!silent) hook('screenClosed');
}
function refreshCursor() {
  if (!UI.cursorCv) return;
  paintIcon(UI.cursorCv, UI.cursor ? UI.cursor.k : null);
  UI.cursorCnt.textContent = UI.cursor && UI.cursor.n > 1 ? UI.cursor.n : '';
}
function refreshAll() { if (UI.screen) for (const f of UI.screen.refreshers) f(); refreshCursor(); }
export function tickScreen() { if (UI.screen && UI.screen.tick) UI.screen.tick(); }

// grade de slots ligada a um Inventory; opts: { cols, accept(k, i), takeOnly, onChange, other: () => Inventory }
function slotGrid(parent, inv, from, to, opts = {}) {
  const grid = el('div', 'grid', parent);
  grid.style.gridTemplateColumns = `repeat(${opts.cols || 9}, var(--slot))`;
  const els = [];
  for (let i = from; i < to; i++) {
    const s = makeSlotEl(grid);
    if (opts.labels) s.root.dataset.label = opts.labels[i - from];
    bindSlot(s.root, (btn) => slotClick(inv, i, btn, opts));
    els.push([s, i]);
  }
  UI.screen.refreshers.push(() => { for (const [s, i] of els) paintSlot(s, inv.get(i)); });
  return grid;
}
function bindSlot(node, click) {
  let t = 0, long = false;
  node.addEventListener('touchstart', (e) => { e.preventDefault(); long = false; t = setTimeout(() => { long = true; click('right'); }, 380); }, { passive: false });
  node.addEventListener('touchend', (e) => { e.preventDefault(); clearTimeout(t); if (!long) click('left'); }, { passive: false });
  node.addEventListener('mousedown', (e) => { e.preventDefault(); click(e.button === 2 ? 'right' : e.shiftKey ? 'shift' : 'left'); });
  node.addEventListener('contextmenu', (e) => e.preventDefault());
}
function slotClick(inv, i, btn, opts) {
  const s = inv.get(i);
  const c = UI.cursor;
  if ((btn === 'shift' || (UI.quick && btn === 'left')) && s && opts.other) {
    const dest = opts.other();
    const left = dest.add(s.k, s.n, s.d);
    inv.set(i, left ? { k: s.k, n: left, d: s.d } : null);
    afterChange(opts); return;
  }
  if (opts.takeOnly) {
    if (!s) return;
    if (!c) { UI.cursor = s; inv.set(i, null); }
    else if (c.k === s.k && c.n + s.n <= maxStack(c.k)) { c.n += s.n; inv.set(i, null); }
    afterChange(opts); return;
  }
  if (c && opts.accept && !opts.accept(c.k, i)) return;
  if (btn === 'right') {
    if (!c && s) { const half = Math.ceil(s.n / 2); UI.cursor = { k: s.k, n: half, d: s.d }; s.n -= half; inv.set(i, s.n ? s : null); }
    else if (c && (!s || (s.k === c.k && s.n < maxStack(c.k)))) {
      if (!s) inv.set(i, { k: c.k, n: 1, d: c.d }); else s.n++;
      c.n--; if (!c.n) UI.cursor = null;
    }
  } else {
    if (!c && s) { UI.cursor = s; inv.set(i, null); }
    else if (c && !s) { const lim = opts.limit || maxStack(c.k); if (c.n > lim) { inv.set(i, { k: c.k, n: lim, d: c.d }); c.n -= lim; } else { inv.set(i, c); UI.cursor = null; } }
    else if (c && s && s.k === c.k && maxStack(c.k) > 1) { const room = maxStack(c.k) - s.n; const t = Math.min(room, c.n); s.n += t; c.n -= t; if (!c.n) UI.cursor = null; }
    else if (c && s) { inv.set(i, c); UI.cursor = s; }
  }
  inv.changed = true;
  afterChange(opts);
}
function afterChange(opts) { if (opts.onChange) opts.onChange(); refreshAll(); hook('sound', 'ui'); }

// inventário do jogador (3 linhas + barra)
function playerGrids(parent, other) {
  const pl = G.player;
  const wrap = el('div', 'inv-wrap', parent);
  slotGrid(wrap, pl.inv, 9, 36, { cols: 9, other });
  el('div', 'sep', wrap);
  slotGrid(wrap, pl.inv, 0, 9, { cols: 9, other });
}

// grade de fabricação (2×2 ou 3×3) com resultado
function craftingGrid(parent, size) {
  const grid = new Inventory(size * size);
  const out = new Inventory(1);
  const row = el('div', 'craft-row', parent);
  const update = () => {
    const r = findRecipe(grid.slots.map((s) => s && s.k), size);
    out.slots[0] = r ? { k: r.result[0], n: r.result[1], d: 0 } : null;
    UI.screen.recipe = r;
  };
  slotGrid(row, grid, 0, size * size, { cols: size, onChange: update, other: () => G.player.inv });
  el('div', 'arrow', row, '➜');
  const resGrid = el('div', 'grid', row);
  const s = makeSlotEl(resGrid);
  s.root.classList.add('result');
  bindSlot(s.root, (btn) => {
    const r = UI.screen.recipe, o = out.get(0);
    if (!r || !o) return;
    const takeAll = btn === 'shift' || UI.quick;
    let times = takeAll ? 64 : 1;
    while (times-- > 0) {
      const cur = out.get(0);
      if (!cur) break;
      if (takeAll) { if (G.player.inv.add(cur.k, cur.n) > 0) break; }
      else { const c = UI.cursor; if (c && (c.k !== cur.k || c.n + cur.n > maxStack(c.k))) break; if (c) c.n += cur.n; else UI.cursor = { k: cur.k, n: cur.n, d: 0 }; }
      for (let i = 0; i < grid.size; i++) { const g = grid.get(i); if (g) { g.n--; if (!g.n) grid.set(i, null); } }
      G.player.stats.crafted++;
      hook('challengeEvent', 'craft', cur.k);
      update();
    }
    afterChange({});
  });
  UI.screen.refreshers.push(() => paintSlot(s, out.get(0)));
  update();
  return grid;
}
// livro de receitas: lista o que dá para fazer com o inventário (toque = fabrica 1, segurar = fabrica 5)
function recipeBook(parent, big) {
  const box = el('div', 'recipes', parent);
  el('div', 'label', box, 'Receitas disponíveis');
  const list = el('div', 'recipe-list', box);
  const render = () => {
    list.innerHTML = '';
    const inv = G.player.inv;
    const seen = new Set();
    const avail = RECIPES.filter((r) => !r.disabled && (big || !r.big) && canCraft(inv, r, big) && !seen.has(r.result[0]) && seen.add(r.result[0]));
    if (!avail.length) el('div', 'muted', list, 'Junte materiais para ver receitas (ex.: troncos → tábuas).');
    for (const r of avail.slice(0, 60)) {
      const b = el('div', 'recipe', list);
      const cv = el('canvas', '', b); cv.width = cv.height = 40; paintIcon(cv, r.result[0]);
      el('span', '', b, (r.result[1] > 1 ? r.result[1] + '× ' : '') + itemName(r.result[0]));
      const need = recipeIngredients(r);
      b.title = 'Precisa: ' + Object.entries(need).map(([k, n]) => n + '× ' + (k.startsWith('#') ? { '#planks': 'tábuas', '#log': 'troncos', '#wool': 'lã', '#stone': 'pedra' }[k] : itemName(k))).join(', ');
      bindSlot(b, (btn) => {
        const times = btn === 'right' || btn === 'shift' ? 5 : 1;
        for (let i = 0; i < times && canCraft(G.player.inv, r, big); i++) {
          const left = craftFromInventory(G.player.inv, r);
          if (left) hook('throwItem', r.result[0], left);
          G.player.stats.crafted++;
          hook('challengeEvent', 'craft', r.result[0]);
        }
        hook('sound', 'craft');
        render(); refreshAll();
      });
    }
  };
  UI.screen.refreshers.push(() => { if (G.player.inv.changed) { G.player.inv.changed = false; render(); } });
  render();
}

export function openInventory() {
  if (G.mode === 'creative') { openCreative(); return; }
  openScreen('Inventário', (body) => {
    const top = el('div', 'inv-top', body);
    const armorCol = el('div', 'armor-col', top);
    slotGrid(armorCol, G.player.armorInv, 0, 4, { cols: 1, labels: ['⛑', '👕', '👖', '👢'], accept: (k, i) => ITEMS[k] && ITEMS[k].armor && ITEMS[k].armor.slot === i, limit: 1 });
    const mid = el('div', 'craft-col', top);
    el('div', 'label', mid, 'Fabricação 2×2');
    const grid = craftingGrid(mid, 2);
    recipeBook(top, false);
    playerGrids(body, null);
    UI.screen.onClose = () => returnGrid(grid);
  });
}
function returnGrid(grid) { for (const s of grid.slots) if (s) { const left = G.player.inv.add(s.k, s.n, s.d); if (left) hook('throwItem', s.k, left, s.d); } }
export function openCraftingTable() {
  openScreen('Mesa de trabalho', (body) => {
    const top = el('div', 'inv-top', body);
    const mid = el('div', 'craft-col', top);
    el('div', 'label', mid, 'Fabricação 3×3');
    const grid = craftingGrid(mid, 3);
    recipeBook(top, true);
    playerGrids(body, null);
    UI.screen.onClose = () => returnGrid(grid);
  });
}
export function openChest(d) {
  openScreen('Baú', (body) => {
    slotGrid(body, d.inv, 0, 27, { cols: 9, other: () => G.player.inv, onChange: () => hook('worldDirty') });
    el('div', 'sep', body);
    playerGrids(body, () => d.inv);
  });
}
export function openFurnace(d) {
  openScreen('Fornalha', (body) => {
    const row = el('div', 'furnace', body);
    const left = el('div', 'fcol', row);
    el('div', 'label', left, 'Item');
    slotGrid(left, d.input, 0, 1, { cols: 1, other: () => G.player.inv });
    const flame = el('div', 'flame', left, '🔥');
    el('div', 'label', left, 'Combustível');
    slotGrid(left, d.fuel, 0, 1, { cols: 1, accept: (k) => fuelValue(k) > 0, other: () => G.player.inv });
    const prog = el('div', 'fprog', row);
    const bar = el('i', '', prog);
    const out = el('div', 'fcol', row);
    el('div', 'label', out, 'Resultado');
    slotGrid(out, d.output, 0, 1, { cols: 1, takeOnly: true, other: () => G.player.inv });
    const hint = el('div', 'muted', body, 'Coloque minério, areia, carne ou troncos em "Item" e carvão/madeira em "Combustível".');
    void hint;
    el('div', 'sep', body);
    playerGrids(body, () => (smeltResult(UI.cursor && UI.cursor.k) ? d.input : d.fuel));
    UI.screen.tick = () => {
      bar.style.width = Math.round((d.cook / SMELT_TIME) * 100) + '%';
      flame.style.opacity = d.burn > 0 ? 1 : 0.2;
      refreshAll();
    };
  });
}

// inventário criativo
const CATS = [
  ['Construção', (k, it) => it.block && !BLOCKS[it.block].shape && !BLOCKS[it.block].light && !['grass', 'dirt', 'sand', 'gravel', 'snow', 'leaves', 'pine_leaves', 'acacia_leaves', 'log', 'birch_log', 'spruce_log', 'acacia_log', 'cactus', 'mud', 'ice'].includes(k) && !k.endsWith('_ore')],
  ['Natureza', (k, it) => it.block && (['grass', 'dirt', 'sand', 'gravel', 'snow', 'leaves', 'pine_leaves', 'acacia_leaves', 'log', 'birch_log', 'spruce_log', 'acacia_log', 'cactus', 'mud', 'ice', 'sapling', 'dead_bush', 'bedrock'].includes(k) || k.endsWith('_ore'))],
  ['Decoração e luz', (k, it) => it.block && (BLOCKS[it.block].shape && !BLOCKS[it.block].power && !['rail', 'wire', 'piston', 'cross', 'crop'].includes(BLOCKS[it.block].shape) || BLOCKS[it.block].light) && !['sapling', 'dead_bush'].includes(k)],
  ['Mecanismos e transporte', (k, it) => (it.block && (BLOCKS[it.block].power || BLOCKS[it.block].consumer || ['rail', 'wire', 'piston'].includes(BLOCKS[it.block].shape) || k === 'elevator')) || it.vehicle || k === 'saddle'],
  ['Ferramentas e armas', (k, it) => it.tool || it.armor || k === 'arrow' || it.bucket !== undefined],
  ['Comida e materiais', (k, it) => !it.block && !it.tool && !it.armor && !it.vehicle && it.bucket === undefined && k !== 'saddle' && k !== 'arrow'],
];
function openCreative() {
  openScreen('Inventário criativo', (body) => {
    const tabs = el('div', 'tabs', body);
    const search = el('input', 'search', tabs); search.placeholder = 'Buscar...';
    const pal = el('div', 'palette', body);
    let cat = 0;
    const render = () => {
      pal.innerHTML = '';
      const q = search.value.trim().toLowerCase();
      for (const k in ITEMS) {
        const it = ITEMS[k];
        if (q ? !it.name.toLowerCase().includes(q) : !CATS[cat][1](k, it)) continue;
        const s = makeSlotEl(pal);
        paintSlot(s, { k, n: 1 });
        bindSlot(s.root, (btn) => {
          if (UI.cursor && UI.cursor.k !== k) { UI.cursor = null; refreshCursor(); return; }
          UI.cursor = { k, n: btn === 'right' ? 1 : maxStack(k), d: 0 };
          // sem item na mão: coloca direto na barra (slot selecionado se vazio)
          if (G.isTouch && UI.quick) { G.player.inv.set(G.player.selected, UI.cursor); UI.cursor = null; }
          refreshAll();
        });
      }
    };
    CATS.forEach(([name], i) => { const b = el('button', 'tab' + (i === 0 ? ' on' : ''), tabs, name); b.onclick = () => { cat = i; search.value = ''; for (const t of tabs.querySelectorAll('.tab')) t.classList.remove('on'); b.classList.add('on'); render(); }; });
    search.oninput = render;
    render();
    el('div', 'sep', body);
    const inv = el('div', 'inv-wrap', body);
    slotGrid(inv, G.player.inv, 0, 9, { cols: 9 });
    el('div', 'muted', body, 'Toque num item para pegá-lo e depois toque num espaço da barra. Segure para pegar 1.');
  });
}

// aldeão: comércio e missão
export function openVillager(mob) {
  const prof = PROFESSIONS[mob.profession] || { name: 'Aldeão' };
  mob.talking = 30;
  openScreen(`${mob.name || 'Aldeão'} — ${prof.name}`, (body) => {
    const g = GREETINGS[mob.profession] || ['Olá!'];
    el('div', 'speech', body, '“' + g[Math.floor(Math.random() * g.length)] + '”');
    const row = el('div', 'villager', body);
    const tr = el('div', 'trades', row);
    el('div', 'label', tr, 'Trocas');
    const renderTrades = () => {
      tr.querySelectorAll('.trade').forEach((n) => n.remove());
      for (const t of mob.trades || []) {
        const r = el('div', 'trade', tr);
        const a = el('canvas', '', r); a.width = a.height = 36; paintIcon(a, t.give[0]);
        el('span', '', r, `${t.give[1]}× ${itemName(t.give[0])}`);
        el('b', '', r, '➜');
        const b = el('canvas', '', r); b.width = b.height = 36; paintIcon(b, t.get[0]);
        el('span', '', r, `${t.get[1]}× ${itemName(t.get[0])}`);
        const left = t.max - t.uses;
        const btn = el('button', 'small', r, left > 0 ? `Trocar (${left})` : 'Esgotado');
        btn.disabled = left <= 0 || (G.mode !== 'creative' && G.player.inv.count(t.give[0]) < t.give[1]);
        btn.onclick = () => {
          if (G.mode !== 'creative' && !G.player.inv.remove(t.give[0], t.give[1])) return;
          const lf = G.player.inv.add(t.get[0], t.get[1]);
          if (lf) hook('throwItem', t.get[0], lf);
          t.uses++;
          hook('sound', 'trade');
          hook('challengeEvent', 'trade', t.get[0]);
          renderTrades(); refreshAll();
        };
      }
    };
    renderTrades();
    const qd = el('div', 'quest', row);
    el('div', 'label', qd, 'Missão');
    const renderQuest = () => {
      qd.querySelectorAll('.qbody').forEach((n) => n.remove());
      const q = mob.quest;
      const b = el('div', 'qbody', qd);
      if (!q) { el('div', 'muted', b, 'Sem missões no momento.'); return; }
      el('div', '', b, q.text.replace('{n}', q.n));
      const prog = q.type === 'collect' ? Math.min(q.n, G.player.inv.count(q.item)) : q.progress;
      if (q.done) { el('div', 'ok', b, '✔ Missão concluída. Obrigado!'); return; }
      if (!q.accepted) { const btn = el('button', 'small', b, 'Aceitar'); btn.onclick = () => { q.accepted = true; hook('questAccepted', mob, q); renderQuest(); }; return; }
      el('div', 'muted', b, q.type === 'explore' ? (q.progress ? 'Local visitado!' : 'Ainda não visitado.') : `Progresso: ${prog}/${q.n}`);
      const ready = q.type === 'collect' ? prog >= q.n : q.type === 'explore' ? q.progress >= 1 : q.progress >= q.n;
      const btn = el('button', 'small', b, 'Entregar');
      btn.disabled = !ready;
      btn.onclick = () => {
        if (q.type === 'collect' && !G.player.inv.remove(q.item, q.n)) return;
        q.done = true;
        const lf = G.player.inv.add(q.reward[0], q.reward[1]);
        if (lf) hook('throwItem', q.reward[0], lf);
        hook('toast', `Missão concluída! Recompensa: ${q.reward[1]}× ${itemName(q.reward[0])}`);
        hook('sound', 'levelup');
        hook('challengeEvent', 'quest', 1);
        renderQuest(); refreshAll();
      };
    };
    renderQuest();
    el('div', 'sep', body);
    playerGrids(body, null);
    UI.screen.onClose = () => { mob.talking = 0; };
  });
}

// morte
export function showDeath(source, onRespawn) {
  const msgs = { fall: 'Você caiu de muito alto.', lava: 'Você tentou nadar na lava.', drown: 'Você se afogou.', starve: 'Você morreu de fome.', cactus: 'Você abraçou um cacto.', mob: 'Você foi derrotado por uma criatura.', arrow: 'Você foi atingido por uma flecha.', void: 'Você caiu para fora do mundo.' };
  const d = $('death');
  d.querySelector('p').textContent = msgs[source] || 'Você morreu.';
  d.classList.add('open');
  G.paused = true;
  d.querySelector('button').onclick = () => { d.classList.remove('open'); G.paused = false; onRespawn(); };
}

export function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(UI.toastTimer);
  UI.toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
}
export function showBlockName(name) {
  const bn = $('blockname');
  bn.textContent = name;
  bn.style.opacity = 1;
  clearTimeout(UI.nameTimer);
  UI.nameTimer = setTimeout(() => bn.style.opacity = 0, 1300);
}
export { openScreen, el };
