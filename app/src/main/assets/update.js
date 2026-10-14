// Atualização automática durante o jogo: verifica o manifesto ao abrir e a cada 20 minutos.
// Se houver versão nova, mostra um aviso com "Atualizar agora" (recarrega e o boot.js baixa a versão nova).
import { VERSION } from './version.js';

const REPO = 'sdavtff/CoverMine';
const BRANCH = 'ccr-57277497-q2k9gm';
const MANIFEST = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/app/src/main/assets/update.json`;
const EVERY = 20 * 60 * 1000;

export const UPD = { latest: null, checking: false, lastCheck: 0, notes: '' };
let toastFn = () => {};

export const cmpVersion = (a, b) => { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); } return 0; };
const enabled = () => { try { return JSON.parse(localStorage.getItem('vc_settings') || '{}').autoUpdate !== false; } catch (e) { return true; } };
const local = () => location.protocol === 'file:' || /localhost|127\.0\.0\.1/.test(location.hostname);

// consulta o manifesto; devolve a versão nova ou null
export async function checkUpdates(manual) {
  if (UPD.checking) return UPD.latest;
  if (!manual && (!enabled() || local() || navigator.onLine === false)) return null;
  UPD.checking = true;
  try {
    const c = new AbortController(), t = setTimeout(() => c.abort(), 6000);
    const r = await fetch(MANIFEST + '?t=' + Date.now(), { cache: 'no-store', signal: c.signal }).finally(() => clearTimeout(t));
    const m = r.ok ? await r.json() : null;
    UPD.lastCheck = Date.now();
    if (m && m.version && m.ref && cmpVersion(m.version, VERSION) > 0) {
      UPD.latest = m.version; UPD.notes = m.notes || '';
      showBanner();
    }
    return UPD.latest;
  } catch (e) {
    if (manual) throw e;
    return null;
  } finally { UPD.checking = false; }
}

function showBanner() {
  let b = document.getElementById('update-banner');
  if (!b) {
    b = document.createElement('div'); b.id = 'update-banner';
    const txt = document.createElement('span'); b.appendChild(txt);
    const go = document.createElement('button'); go.className = 'primary'; go.textContent = 'Atualizar agora';
    // o jogo é salvo automaticamente antes (gancho opcional do main.js)
    go.onclick = async () => { go.disabled = true; go.textContent = 'Salvando...'; try { await (window.__vcBeforeUpdate?.()); } catch (e) { } location.reload(); };
    const later = document.createElement('button'); later.textContent = 'Depois';
    later.onclick = () => b.classList.add('hidden');
    b.append(go, later);
    document.body.appendChild(b);
  }
  b.classList.remove('hidden');
  b.firstChild.textContent = `⬆ Nova versão ${UPD.latest} disponível${UPD.notes ? ': ' + UPD.notes : ''}`;
}

// chamada uma vez ao iniciar o jogo
export function initUpdates(toast) {
  toastFn = toast || toastFn;
  // aviso de "atualizado" na primeira abertura de uma versão nova
  try {
    const prev = localStorage.getItem('vc_lastVersion');
    if (prev && cmpVersion(VERSION, prev) > 0) setTimeout(() => toastFn(`✅ Jogo atualizado para a versão ${VERSION}`), 1500);
    localStorage.setItem('vc_lastVersion', VERSION);
  } catch (e) { }
  setTimeout(() => checkUpdates(false), 8000);
  setInterval(() => checkUpdates(false), EVERY);
  // ao voltar para o app depois de muito tempo em segundo plano
  document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - UPD.lastCheck > EVERY) checkUpdates(false); });
}
