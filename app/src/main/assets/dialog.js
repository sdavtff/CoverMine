// Diálogos próprios (substituem prompt/alert/confirm, que não aparecem na WebView do Android).
const el = (tag, cls, parent, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; if (parent) parent.appendChild(e); return e; };

function open(title, msg, build) {
  return new Promise((resolve) => {
    const back = el('div', 'vc-dialog', document.body);
    const box = el('div', 'vc-dialog-box', back);
    if (title) el('h3', '', box, title);
    if (msg) el('p', '', box, msg);
    const done = (v) => { back.remove(); document.removeEventListener('keydown', key, true); resolve(v); };
    const key = (e) => { e.stopPropagation(); if (e.key === 'Escape') done(null); };
    document.addEventListener('keydown', key, true);
    build(box, done);
  });
}
function buttons(box, list) {
  const row = el('div', 'vc-dialog-btns', box);
  return list.map(([t, cls, fn]) => { const b = el('button', cls || '', row, t); b.onclick = fn; return b; });
}

// pergunta um texto; devolve a string ou null se cancelar
export function askText(title, def = '', opts = {}) {
  return open(title, opts.msg, (box, done) => {
    const i = el('input', '', box); i.value = def; i.maxLength = opts.max || 60;
    if (opts.password) i.type = 'password';
    if (opts.placeholder) i.placeholder = opts.placeholder;
    const ok = () => done(i.value);
    i.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ok(); } });
    buttons(box, [['Cancelar', '', () => done(null)], [opts.okText || 'OK', 'primary', ok]]);
    setTimeout(() => { i.focus(); i.select(); }, 30);
  });
}
// confirmação sim/não
export function askConfirm(msg, okText = 'Confirmar', danger = true) {
  return open('Confirmar', msg, (box, done) => buttons(box, [['Cancelar', '', () => done(false)], [okText, danger ? 'danger' : 'primary', () => done(true)]]))
    .then((v) => !!v);
}
// aviso simples
export function showMessage(msg, title = 'Aviso') {
  return open(title, msg, (box, done) => buttons(box, [['OK', 'primary', () => done(true)]]));
}
// escolha numa lista; devolve o índice ou null
export function askChoice(title, items, msg) {
  return open(title, msg, (box, done) => {
    const list = el('div', 'vc-dialog-list', box);
    items.forEach((t, i) => { el('button', '', list, t).onclick = () => done(i); });
    buttons(box, [['Cancelar', '', () => done(null)]]);
  });
}
