// Configurações gráficas do VoxelCraft: presets, persistência e painel de interface.

export const PRESETS = {
  low:    { tex: 32,  rd: 3, shadows: 0, water: 0, veg: 1, aa: false, clouds: 1, res: 0.75, post: 0, particles: 0.5 },
  medium: { tex: 64,  rd: 5, shadows: 1, water: 1, veg: 2, aa: false, clouds: 1, res: 1, post: 1, particles: 0.8 },
  high:   { tex: 64,  rd: 6, shadows: 3, water: 2, veg: 3, aa: true,  clouds: 2, res: 1.25, post: 2, particles: 1 },
  ultra:  { tex: 128, rd: 8, shadows: 4, water: 3, veg: 3, aa: true,  clouds: 2, res: 1.5, post: 3, particles: 1.25 },
};
export const PRESET_ORDER = ['low', 'medium', 'high', 'ultra'];
export const PRESET_NAMES = { low: 'Baixa', medium: 'Média', high: 'Alta', ultra: 'Ultra', custom: 'Personalizada' };

// tamanho do mapa de sombras, alcance (blocos) e intervalo de atualização (quadros)
export const SHADOW_LEVELS = [
  null,
  { size: 1024, range: 36, soft: false, every: 2 },
  { size: 2048, range: 48, soft: true, every: 1 },
  { size: 2048, range: 64, soft: true, every: 1 },
  { size: 4096, range: 80, soft: true, every: 1 },
];
export const VEG_DENSITY = [0, 0.1, 0.22, 0.38];

export function defaultSettings(isTouch) {
  return Object.assign({
    preset: 'high',
    light: 1, fog: true, fogDensity: 1, fpsCap: isTouch ? 60 : 0, eco: false, auto: true,
    sens: 1, fov: 75, volume: 0.8, uiScale: 1, invertY: false, minimap: true, showInfo: true, compass: true, viewBob: true,
    reduceFlash: false, highContrast: false, name: 'Jogador', skin: null, camDefault: 0, autoUpdate: true,
    bloom: true, vignette: true, grading: true,
  }, PRESETS.high);
}

export function loadSettings(isTouch) {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('vc_settings') || '{}') || {}; } catch (e) { saved = {}; }
  const s = defaultSettings(isTouch);
  if (saved.sens != null) s.sens = +saved.sens;
  if (saved.preset) {
    // versão nova: restaura tudo
    for (const k in s) if (saved[k] !== undefined) s[k] = saved[k];
  }
  // migração: a versão antiga só tinha distância de visão e sensibilidade
  else if (saved.rd != null) s.rd = Math.max(2, Math.min(12, +saved.rd));
  return s;
}
export function saveSettings(s) {
  try { localStorage.setItem('vc_settings', JSON.stringify(s)); } catch (e) { /* armazenamento indisponível */ }
}

// configurações efetivas (aplica modo economia)
export function effective(s) {
  const e = Object.assign({}, s);
  if (s.eco) {
    // Modo economia: sobrescreve as opções mais caras sem perder a configuração do jogador.
    e.shadows = 0; e.water = 0; e.tex = 32;
    e.clouds = Math.min(s.clouds, 1); e.veg = Math.min(s.veg, 1);
    e.res = Math.min(s.res, 0.6); e.rd = Math.min(s.rd, 4);
    e.fpsCap = s.fpsCap === 0 ? 30 : Math.min(s.fpsCap, 30);
    e.post = 0; e.particles = Math.min(s.particles, 0.5);
  }
  e.pbr = !s.eco && e.tex >= 64;
  e.normalMaps = e.tex >= 64;
  e.envMap = !s.eco && e.shadows >= 3;
  return e;
}

export function applyPreset(s, name) {
  s.preset = name;
  if (PRESETS[name]) Object.assign(s, PRESETS[name]);
}

// ---------------- painel ----------------
const SCHEMA = [
  { key: 'preset', label: 'Qualidade gráfica', type: 'select', options: [['low', 'Baixa'], ['medium', 'Média'], ['high', 'Alta'], ['ultra', 'Ultra'], ['custom', 'Personalizada']] },
  { key: 'tex', label: 'Qualidade das texturas', type: 'select', num: true, options: [[32, 'Baixa (32 px)'], [64, 'Média (64 px + relevo)'], [128, 'Alta (128 px + relevo)']] },
  { key: 'rd', label: 'Distância de renderização', type: 'range', min: 2, max: 12, step: 1, fmt: (v) => `${v} chunks (${v * 16} blocos)` },
  { key: 'shadows', label: 'Qualidade das sombras', type: 'select', num: true, options: [[0, 'Desligadas'], [1, 'Baixa'], [2, 'Média'], [3, 'Alta'], [4, 'Ultra']] },
  { key: 'light', label: 'Intensidade da iluminação', type: 'range', min: 0.5, max: 1.6, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%`, keepPreset: true },
  { key: 'water', label: 'Qualidade da água', type: 'select', num: true, options: [[0, 'Simples'], [1, 'Média (ondas + reflexo do céu)'], [2, 'Alta (+ brilho do sol, espuma, cáusticas)'], [3, 'Ultra (+ reflexos reais)']] },
  { key: 'veg', label: 'Densidade da vegetação', type: 'select', num: true, options: [[0, 'Nenhuma'], [1, 'Baixa'], [2, 'Média'], [3, 'Alta']] },
  { key: 'clouds', label: 'Nuvens', type: 'select', num: true, options: [[0, 'Desligadas'], [1, 'Simples'], [2, 'Volumétricas']] },
  { key: 'aa', label: 'Antialiasing (MSAA)', type: 'check', note: 'reinicia o renderizador' },
  { key: 'post', label: 'Pós-processamento', type: 'select', num: true, options: [[0, 'Desligado'], [1, 'Leve (cor + vinheta)'], [2, 'Médio (+ brilho/bloom)'], [3, 'Alto (+ FXAA)']] },
  { key: 'bloom', label: '  Brilho (bloom)', type: 'check', keepPreset: true },
  { key: 'vignette', label: '  Vinheta', type: 'check', keepPreset: true },
  { key: 'grading', label: '  Correção de cor', type: 'check', keepPreset: true },
  { key: 'particles', label: 'Densidade de partículas', type: 'range', min: 0, max: 1.5, step: 0.25, fmt: (v) => `${Math.round(v * 100)}%` },
  { key: 'res', label: 'Resolução de renderização', type: 'select', num: true, options: [[0.5, '50%'], [0.6, '60%'], [0.75, '75%'], [1, '100%'], [1.25, '125%'], [1.5, '150%'], [2, '200%']] },
  { key: 'fog', label: 'Neblina e efeitos atmosféricos', type: 'check', keepPreset: true },
  { key: 'fogDensity', label: 'Densidade da neblina', type: 'range', min: 0.3, max: 2, step: 0.1, fmt: (v) => `${Math.round(v * 100)}%`, keepPreset: true },
  { key: 'fpsCap', label: 'Limite de FPS', type: 'select', num: true, keepPreset: true, options: [[30, '30 FPS'], [60, '60 FPS'], [0, 'Sem limite']] },
  { key: 'eco', label: 'Modo economia de desempenho', type: 'check', keepPreset: true },
  { key: 'auto', label: 'Ajuste automático de qualidade', type: 'check', keepPreset: true, note: 'reduz a qualidade se o FPS cair' },
];

export function buildPanel(root, settings, onChange) {
  root.innerHTML = '';
  const title = document.createElement('h2');
  title.textContent = 'Configurações Gráficas';
  root.appendChild(title);
  const list = document.createElement('div');
  list.className = 'gfx-list';
  root.appendChild(list);
  const controls = {};
  for (const item of SCHEMA) {
    const row = document.createElement('label');
    row.className = 'gfx-row';
    const name = document.createElement('span');
    name.className = 'gfx-name';
    name.textContent = item.label;
    if (item.note) { const n = document.createElement('small'); n.textContent = item.note; name.appendChild(n); }
    row.appendChild(name);
    let input, valueEl = null;
    if (item.type === 'select') {
      input = document.createElement('select');
      for (const [v, t] of item.options) { const o = document.createElement('option'); o.value = v; o.textContent = t; input.appendChild(o); }
    } else if (item.type === 'range') {
      const wrap = document.createElement('span');
      wrap.className = 'gfx-range';
      input = document.createElement('input');
      input.type = 'range'; input.min = item.min; input.max = item.max; input.step = item.step;
      valueEl = document.createElement('b');
      wrap.appendChild(input); wrap.appendChild(valueEl);
      row.appendChild(wrap);
    } else {
      input = document.createElement('input');
      input.type = 'checkbox';
    }
    if (item.type !== 'range') row.appendChild(input);
    list.appendChild(row);
    const read = () => item.type === 'check' ? input.checked : (item.num || item.type === 'range') ? +input.value : input.value;
    input.addEventListener(item.type === 'range' ? 'input' : 'change', () => {
      const v = read();
      if (item.key === 'preset') { if (v !== 'custom') applyPreset(settings, v); else settings.preset = 'custom'; }
      else {
        settings[item.key] = v;
        if (!item.keepPreset && settings.preset !== 'custom') settings.preset = 'custom';
      }
      refresh();
      onChange(item.key);
    });
    controls[item.key] = { item, input, valueEl };
  }
  function refresh() {
    for (const k in controls) {
      const { item, input, valueEl } = controls[k];
      if (item.type === 'check') input.checked = !!settings[k];
      else input.value = settings[k];
      if (valueEl) valueEl.textContent = item.fmt(settings[k]);
    }
  }
  refresh();
  return { refresh };
}
