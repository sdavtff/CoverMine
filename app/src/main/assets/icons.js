// Ícones de itens: blocos em isometria (do atlas) e itens desenhados por código (ferramentas, comidas...).
import { ITEMS } from './items.js';
import { BLOCKS } from './blocks.js';

const cache = new Map();
let atlasRef = null;
export function setIconAtlas(atlas, canvas, uv) { atlasRef = { atlas, canvas, uv }; cache.clear(); }

const rgb = (c, k = 1) => `rgb(${Math.round(c[0] * k)},${Math.round(c[1] * k)},${Math.round(c[2] * k)})`;

// desenho de um item não-bloco em um contexto 2D de tamanho s
export function drawItem(ctx, key, s) {
  const it = ITEMS[key];
  const ic = (it && it.icon) || { shape: 'lump', color: [180, 180, 180] };
  const c = ic.color || [180, 180, 180];
  const u = s / 16;
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const line = (pts, w, col) => { ctx.strokeStyle = col; ctx.lineWidth = w * u; ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x * u, y * u) : ctx.moveTo(x * u, y * u))); ctx.stroke(); };
  const poly = (pts, col, stroke) => { ctx.fillStyle = col; ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x * u, y * u) : ctx.moveTo(x * u, y * u))); ctx.closePath(); ctx.fill(); if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 0.8 * u; ctx.stroke(); } };
  const circ = (x, y, r, col, stroke) => { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x * u, y * u, r * u, 0, Math.PI * 2); ctx.fill(); if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 0.8 * u; ctx.stroke(); } };
  const handle = () => { line([[3, 13], [10, 6]], 2.2, '#5a3d20'); line([[3, 13], [10, 6]], 1.1, '#8a6238'); };
  const dark = rgb(c, 0.55), mid = rgb(c), hi = rgb(c.map((v) => Math.min(255, v + 50)));
  switch (ic.shape) {
    case 'pickaxe': handle(); line([[3.5, 4.5], [7, 2.6], [11, 3.2], [13.5, 6.5]], 2.6, dark); line([[3.5, 4.5], [7, 2.6], [11, 3.2], [13.5, 6.5]], 1.4, mid); line([[6, 3.3], [10, 3.2]], 0.7, hi); break;
    case 'axe': handle(); poly([[8, 3], [11, 1.5], [14, 4.5], [12, 8], [9, 7]], mid, dark); line([[11, 2], [13.5, 4.7]], 0.8, hi); break;
    case 'shovel': handle(); poly([[9, 4], [11.5, 1.5], [14.5, 4.5], [12, 7]], mid, dark); line([[11.5, 2.3], [13.6, 4.4]], 0.7, hi); break;
    case 'sword': line([[2.5, 13.5], [5, 11]], 2, '#5a3d20'); line([[3.6, 9.6], [6.4, 12.4]], 1.4, '#7a5530'); poly([[5, 10], [12.5, 2.5], [14, 2], [13.5, 3.5], [6, 11]], mid, dark); line([[6.2, 9.8], [12.8, 3.2]], 0.6, hi); break;
    case 'hoe': handle(); line([[7, 3], [10, 3.3], [13.5, 6]], 2.4, dark); line([[7, 3], [10, 3.3], [13.5, 6]], 1.2, mid); break;
    case 'bow': ctx.strokeStyle = '#7a5530'; ctx.lineWidth = 1.8 * u; ctx.beginPath(); ctx.arc(3 * u, 13 * u, 10.5 * u, -Math.PI / 2 + 0.05, -0.05); ctx.stroke(); line([[3, 2.5], [13.5, 13]], 0.6, '#ddd'); break;
    case 'flintsteel': circ(6, 9, 3.8, 'rgba(0,0,0,0)', '#bbb'); line([[6, 5.2], [6, 12.8]], 0.01, '#bbb'); poly([[9, 3], [13, 4], [12.5, 8], [9.5, 8.5]], '#444', '#222'); break;
    case 'shears': line([[4, 12], [12, 4]], 1.6, '#bbb'); line([[4, 4], [12, 12]], 1.6, '#999'); circ(4, 12, 1.6, '#c33'); circ(12, 12, 1.6, '#c33'); break;
    case 'helmet': poly([[3, 9], [3, 6], [5, 3.5], [11, 3.5], [13, 6], [13, 9], [10.5, 9], [10.5, 7], [5.5, 7], [5.5, 9]], mid, dark); break;
    case 'chest': poly([[2, 3], [6, 3], [8, 5], [10, 3], [14, 3], [14, 7], [12, 7], [12, 14], [4, 14], [4, 7], [2, 7]], mid, dark); line([[5, 9], [11, 9]], 0.6, hi); break;
    case 'legs': poly([[3.5, 2.5], [12.5, 2.5], [12.5, 14], [9.5, 14], [8, 6.5], [6.5, 14], [3.5, 14]], mid, dark); break;
    case 'boots': poly([[3, 6], [6, 6], [6, 11], [7.5, 11], [7.5, 13.5], [2, 13.5]], mid, dark); poly([[9, 6], [12, 6], [12, 11], [14, 11], [14, 13.5], [9, 13.5]], mid, dark); break;
    case 'apple': circ(8, 9.5, 5, mid, dark); circ(6.3, 8, 1.3, hi); line([[8, 4.8], [8.6, 2.6]], 0.9, '#5a3d20'); poly([[8.6, 3.5], [11.5, 2.5], [10, 4.5]], '#4c8a2a'); break;
    case 'bread': poly([[2, 10], [4, 6], [12, 6], [14, 10], [12.5, 12.5], [3.5, 12.5]], mid, rgb(c, 0.6)); line([[5, 7.5], [6, 9.5]], 0.7, rgb(c, 0.7)); line([[8, 7.5], [9, 9.5]], 0.7, rgb(c, 0.7)); line([[11, 7.5], [12, 9.5]], 0.7, rgb(c, 0.7)); break;
    case 'meat': poly([[3, 6], [7, 3.5], [13, 5], [13.5, 10], [9, 13], [4, 11.5]], mid, dark); poly([[9.5, 8.5], [11.5, 8], [11.5, 10], [9.5, 10.5]], '#f2e6dc'); line([[5, 7], [8, 5.5]], 0.8, hi); break;
    case 'drumstick': circ(6.5, 6.5, 4, mid, dark); line([[9, 9], [13, 13]], 1.6, '#f2e6dc'); circ(13.3, 12.4, 1.1, '#f2e6dc'); circ(12.4, 13.3, 1.1, '#f2e6dc'); break;
    case 'fish': poly([[2, 8], [6, 4.5], [11, 5.5], [13, 8], [11, 10.5], [6, 11.5]], mid, dark); poly([[12, 8], [15, 5], [15, 11]], dark); circ(5, 7.3, 0.8, '#111'); break;
    case 'stick': line([[3.5, 12.5], [12.5, 3.5]], 1.8, '#5a3d20'); line([[3.5, 12.5], [12.5, 3.5]], 0.9, '#8a6238'); break;
    case 'lump': poly([[3, 9], [5, 4.5], [10, 3.5], [13, 7], [12, 12], [6, 13]], mid, dark); circ(7, 7, 1.2, hi); circ(10, 9.5, 0.9, rgb(c, 0.75)); break;
    case 'ingot': poly([[2, 10], [5, 6], [14, 6], [11, 10]], hi, dark); poly([[2, 10], [11, 10], [11, 12], [2, 12]], mid, dark); poly([[11, 10], [14, 6], [14, 8], [11, 12]], dark); break;
    case 'gem': poly([[8, 2], [13, 6], [8, 14], [3, 6]], mid, dark); poly([[8, 2], [10.5, 6], [8, 14], [5.5, 6]], hi); line([[3, 6], [13, 6]], 0.6, dark); break;
    case 'coin': circ(8, 8, 5.5, mid, dark); circ(8, 8, 3.6, hi); ctx.fillStyle = rgb(c, 0.6); ctx.font = `bold ${7 * u}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('$', 8 * u, 8.4 * u); break;
    case 'leather': poly([[3, 4], [7, 3], [9, 4], [13, 3], [12.5, 8], [13.5, 12.5], [9, 12], [6, 13.5], [2.5, 12], [3.5, 8]], mid, dark); break;
    case 'feather': poly([[4, 13], [6, 7], [11, 2], [12, 4], [8, 10]], '#f4f4f0', '#999'); line([[4, 13], [10, 4]], 0.6, '#aaa'); break;
    case 'bone': line([[4, 12], [12, 4]], 2, '#eee8dc'); for (const [x, y] of [[3, 11], [5, 13], [11, 3], [13, 5]]) circ(x, y, 1.5, '#eee8dc'); break;
    case 'dust': circ(8, 10, 4.5, mid, dark); circ(6, 8, 2.5, hi); circ(10.5, 7.5, 2, mid); break;
    case 'string': ctx.strokeStyle = '#eee'; ctx.lineWidth = 0.9 * u; ctx.beginPath(); ctx.moveTo(3 * u, 12 * u); ctx.bezierCurveTo(6 * u, 2 * u, 9 * u, 14 * u, 13 * u, 4 * u); ctx.stroke(); break;
    case 'arrow': line([[3, 13], [12, 4]], 1, '#8a6238'); poly([[12, 4], [14, 2], [13.5, 6], [10, 5]], '#bbb', '#666'); poly([[3, 13], [2, 10], [5, 11.5]], '#eee'); poly([[3, 13], [6, 14], [4.5, 11]], '#ddd'); break;
    case 'wheat': for (let i = 0; i < 3; i++) { line([[5 + i * 2.5, 14], [6 + i * 2.5, 6]], 0.8, '#9a8a40'); for (let j = 0; j < 4; j++) circ(6 + i * 2.5 + (j % 2 ? 0.7 : -0.7), 5.5 - j * 1.1 + 2, 0.9, '#d8b84c'); } break;
    case 'seeds': for (const [x, y] of [[5, 6], [9, 5], [7, 9], [11, 9], [6, 12], [10, 12.5]]) circ(x, y, 1.2, '#7aa64a', '#3f6a20'); break;
    case 'bucket': poly([[3.5, 4], [12.5, 4], [11, 13.5], [5, 13.5]], '#cfd0d6', '#666'); if (ic.color) poly([[4, 5], [12, 5], [11.8, 6.5], [4.2, 6.5]], mid); ctx.strokeStyle = '#888'; ctx.lineWidth = 0.8 * u; ctx.beginPath(); ctx.arc(8 * u, 4 * u, 4.5 * u, Math.PI, 0); ctx.stroke(); break;
    case 'boat': poly([[1.5, 8], [14.5, 8], [12.5, 12.5], [3.5, 12.5]], '#a07440', '#5a3d20'); line([[2.5, 9.5], [13.5, 9.5]], 0.6, '#7a5530'); line([[8, 8], [8, 3]], 0.8, '#5a3d20'); break;
    case 'minecart': poly([[2, 5], [14, 5], [12.5, 11], [3.5, 11]], '#9a9aa2', '#555'); circ(5, 12.5, 1.6, '#333'); circ(11, 12.5, 1.6, '#333'); break;
    case 'saddle': poly([[3, 7], [6, 4], [10, 4], [13, 7], [12, 11], [4, 11]], '#8a4a28', '#4a2814'); line([[6, 11], [6, 14]], 0.8, '#aaa'); line([[10, 11], [10, 14]], 0.8, '#aaa'); break;
    case 'rod': line([[3.5, 12.5], [12.5, 3.5]], 2, rgb(c, 0.6)); line([[3.5, 12.5], [12.5, 3.5]], 1, mid); circ(12, 4, 1.2, hi); break;
    case 'pearl': circ(8, 8, 5, mid, dark); circ(8, 8, 2.6, rgb(c, 0.5)); circ(6.3, 6.3, 1.3, hi); break;
    case 'eye': circ(8, 8, 5, mid, dark); poly([[8, 4.5], [9.4, 8], [8, 11.5], [6.6, 8]], '#132'); circ(6.2, 6.2, 1, hi); break;
    case 'map': poly([[2, 3], [14, 3], [14, 13], [2, 13]], '#e8dcb0', '#8a7a50'); line([[4, 10], [7, 6], [10, 9], [12, 5]], 0.7, '#c44'); break;
    case 'door': poly([[4.5, 1.5], [11.5, 1.5], [11.5, 14.5], [4.5, 14.5]], '#a07440', '#5a3d20'); poly([[6, 3], [10, 3], [10, 6.5], [6, 6.5]], '#cde6f0'); circ(10, 9, 0.6, '#ddd'); break;
    case 'bed': poly([[1.5, 7], [14.5, 7], [14.5, 11], [1.5, 11]], '#b02828', '#5a1414'); poly([[11, 5.5], [14.5, 5.5], [14.5, 7.5], [11, 7.5]], '#eee'); line([[2, 11], [2, 13]], 1, '#7a5530'); line([[14, 11], [14, 13]], 1, '#7a5530'); break;
    case 'torch': line([[8, 14], [8, 6]], 1.6, '#7a5530'); circ(8, 5, 1.8, '#ffd060'); circ(8, 4.6, 1, '#fff8d0'); break;
    case 'sapling': line([[8, 14], [8, 8]], 1, '#6a4a28'); circ(8, 6, 3.2, '#4c8a2a', '#2f5a18'); circ(6, 8, 2, '#5aa032'); break;
    case 'deadbush': for (const a of [-0.8, -0.3, 0.3, 0.8]) line([[8, 14], [8 + Math.sin(a) * 6, 14 - Math.cos(a) * 9]], 0.8, '#8a6238'); break;
    case 'wire': line([[2, 8], [14, 8]], 1.4, '#c03020'); line([[8, 2], [8, 14]], 1.4, '#c03020'); circ(8, 8, 2, '#e04030'); break;
    case 'rail': line([[5, 1.5], [5, 14.5]], 1.2, '#aaa'); line([[11, 1.5], [11, 14.5]], 1.2, '#aaa'); for (let y = 3; y < 15; y += 3.5) line([[3, y], [13, y]], 1, '#7a5530'); break;
    case 'lever': poly([[4, 11], [12, 11], [12, 14], [4, 14]], '#888', '#555'); line([[8, 11], [11, 4]], 1.2, '#7a5530'); break;
    case 'ladder': line([[5, 1.5], [5, 14.5]], 1.2, '#8a6238'); line([[11, 1.5], [11, 14.5]], 1.2, '#8a6238'); for (let y = 3; y < 15; y += 3) line([[5, y], [11, y]], 1, '#a07440'); break;
    default: poly([[3, 9], [5, 4.5], [10, 3.5], [13, 7], [12, 12], [6, 13]], mid, dark);
  }
  ctx.restore();
}

// bloco em isometria a partir do atlas
function drawBlock(ctx, id, size) {
  const d = BLOCKS[id];
  if (!atlasRef) return;
  const { atlas, canvas, uv } = atlasRef;
  const T = atlas.tileSize, k = size / 48;
  const src = (i) => [uv[i][0] * atlas.width, uv[i][1] * atlas.height];
  const face = (ti, m, shade) => {
    ctx.save();
    ctx.setTransform(m[0] * k, m[1] * k, m[2] * k, m[3] * k, m[4] * k, m[5] * k);
    const [sx, sy] = src(ti);
    ctx.drawImage(canvas, sx, sy, T, T, 0, 0, 16, 16);
    if (shade) { ctx.globalCompositeOperation = 'source-atop'; ctx.fillStyle = `rgba(0,0,0,${shade})`; ctx.fillRect(0, 0, 16, 16); }
    ctx.restore();
  };
  const flat = ['cross', 'crop', 'torch', 'wire', 'rail', 'ladder', 'door'].includes(d.shape);
  if (flat) { const [sx, sy] = src(d.t[1]); ctx.imageSmoothingEnabled = false; ctx.drawImage(canvas, sx, sy, T, T, size * 0.08, size * 0.08, size * 0.84, size * 0.84); return; }
  const side = d.front != null ? d.front : d.t[1];
  const h = d.shape === 'slab' ? 0.5 : 1;
  face(d.t[0], [20 / 16, -10 / 16, 20 / 16, 10 / 16, 4, 14 + (1 - h) * 22], 0);
  face(side, [20 / 16, 10 / 16, 0, 22 / 16 * h, 4, 14 + (1 - h) * 22], 0.2);
  face(d.t[1], [20 / 16, -10 / 16, 0, 22 / 16 * h, 24, 24 + (1 - h) * 22], 0.4);
}

// canvas (cacheado) com o ícone do item
export function itemIcon(key, size = 48) {
  const ck = key + '@' + size;
  if (cache.has(ck)) return cache.get(ck);
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  const it = ITEMS[key];
  if (it && it.block && !it.icon) drawBlock(ctx, it.block, size);
  else drawItem(ctx, key, size);
  cache.set(ck, cv);
  return cv;
}
// copia o ícone para um canvas da interface
export function paintIcon(target, key) {
  const ctx = target.getContext('2d');
  ctx.clearRect(0, 0, target.width, target.height);
  if (key) ctx.drawImage(itemIcon(key, target.width), 0, 0);
}

// atlas de sprites dos itens não-bloco (itens na mão e no chão)
export function buildItemSpriteAtlas() {
  const keys = Object.keys(ITEMS).filter((k) => !ITEMS[k].block || ITEMS[k].icon);
  const S = 64, cols = 16, rows = Math.ceil(keys.length / cols);
  const cv = document.createElement('canvas');
  cv.width = cols * S; cv.height = rows * S;
  const ctx = cv.getContext('2d');
  const map = {};
  keys.forEach((k, i) => {
    const x = (i % cols) * S, y = Math.floor(i / cols) * S;
    ctx.save(); ctx.translate(x, y); drawItem(ctx, k, S); ctx.restore();
    map[k] = [x / cv.width, y / cv.height, (x + S) / cv.width, (y + S) / cv.height];
  });
  return { canvas: cv, map };
}
