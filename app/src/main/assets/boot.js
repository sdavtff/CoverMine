// Inicialização com atualização automática: se houver internet e uma versão mais nova publicada,
// o jogo é carregado da CDN; senão, usa a versão embutida no app (funciona offline).
import { VERSION } from './version.js';

const REPO = 'sdavtff/CoverMine';
const BRANCH = 'ccr-57277497-q2k9gm';
const MANIFEST = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/app/src/main/assets/update.json`;
// CDNs que servem arquivos do GitHub com tipo MIME correto e CORS (tentadas em ordem)
const CDNS = [
  (ref) => `https://cdn.jsdelivr.net/gh/${REPO}@${ref}/app/src/main/assets/`,
  (ref) => `https://cdn.statically.io/gh/${REPO}/${ref}/app/src/main/assets/`,
  (ref) => `https://rawcdn.githack.com/${REPO}/${ref}/app/src/main/assets/`,
];
const timed = (url, ms) => { const c = new AbortController(); const t = setTimeout(() => c.abort(), ms); return fetch(url, { signal: c.signal, cache: 'no-store' }).finally(() => clearTimeout(t)); };
// escolhe a primeira CDN que responde com a versão anunciada
async function pickCDN(ref, version) {
  for (const mk of CDNS) {
    const base = mk(ref);
    try { const r = await timed(base + 'version.js', 5000); if (r.ok && (await r.text()).includes(version)) return base; } catch (e) { /* próxima */ }
  }
  return null;
}

const cmp = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); } return 0; };
const status = (t) => { const l = document.getElementById('loading'); if (l) { l.textContent = t; l.style.display = 'flex'; } };

async function start() {
  let auto = true;
  try { auto = JSON.parse(localStorage.getItem('vc_settings') || '{}').autoUpdate !== false; } catch (e) { }
  if (auto && navigator.onLine !== false && location.protocol !== 'file:' && !/localhost|127\.0\.0\.1/.test(location.hostname)) {
    try {
      status('Procurando atualizações...');
      const r = await timed(MANIFEST + '?t=' + Date.now(), 3500);
      const m = r.ok ? await r.json() : null;
      const base = m && m.version && m.ref && cmp(m.version, VERSION) > 0 ? await pickCDN(m.ref, m.version) : null;
      if (base) {
        status(`Atualizando para a versão ${m.version}...`);
        // CSS novo + código novo direto da CDN (imutável por commit)
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
    } catch (e) { /* sem internet ou CDN indisponível: segue com a versão local */ }
  }
  await import('./main.js');
}
start().catch((e) => { console.error(e); status('Erro ao iniciar: ' + e.message); });
