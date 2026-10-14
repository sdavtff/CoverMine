// Inicialização com atualização automática: se houver internet e uma versão mais nova publicada,
// o jogo é carregado da CDN; senão, usa a versão embutida no app (funciona offline).
import { VERSION } from './version.js';

const REPO = 'sdavtff/CoverMine';
const BRANCH = 'ccr-57277497-q2k9gm';
const MANIFEST = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/app/src/main/assets/update.json`;
const CDN = (ref) => `https://cdn.jsdelivr.net/gh/${REPO}@${ref}/app/src/main/assets/`;

const cmp = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); } return 0; };
const status = (t) => { const l = document.getElementById('loading'); if (l) { l.textContent = t; l.style.display = 'flex'; } };

async function start() {
  let auto = true;
  try { auto = JSON.parse(localStorage.getItem('vc_settings') || '{}').autoUpdate !== false; } catch (e) { }
  if (auto && navigator.onLine !== false && location.protocol !== 'file:' && !/localhost|127\.0\.0\.1/.test(location.hostname)) {
    try {
      status('Procurando atualizações...');
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 3500);
      const r = await fetch(MANIFEST + '?t=' + Date.now(), { signal: ctl.signal, cache: 'no-store' });
      clearTimeout(t);
      if (r.ok) {
        const m = await r.json();
        if (m.version && m.ref && cmp(m.version, VERSION) > 0) {
          status(`Atualizando para a versão ${m.version}...`);
          // CSS novo + código novo direto da CDN (imutável por commit)
          const base = CDN(m.ref);
          // interface (HTML) da versão nova, sem scripts
          try {
            const html = await (await fetch(base + 'index.html', { cache: 'no-store' })).text();
            const doc = new DOMParser().parseFromString(html, 'text/html');
            doc.querySelectorAll('script').forEach((s) => s.remove());
            if (doc.getElementById('hud')) document.body.innerHTML = doc.body.innerHTML;
          } catch (e) { }
          const css = document.querySelector('link[rel=stylesheet]');
          if (css) css.href = base + 'style.css';
          window.__vcRemoteBase = base;
          await import(base + 'main.js');
          return;
        }
      }
    } catch (e) { /* sem internet ou CDN indisponível: segue com a versão local */ }
  }
  await import('./main.js');
}
start().catch((e) => { console.error(e); status('Erro ao iniciar: ' + e.message); });
