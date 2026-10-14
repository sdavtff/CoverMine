// Modo Desafio: objetivos em sequência com recompensas (também registra conquistas nos outros modos).
import { G, hook } from './state.js';
import { B } from './blocks.js';

export const OBJECTIVES = [
  { id: 'wood', text: 'Colete 8 troncos', ev: 'collect', match: (k) => /log$/.test(k), n: 8, reward: ['apple', 3] },
  { id: 'table', text: 'Fabrique uma mesa de trabalho', ev: 'craft', match: (k) => k === 'crafting_table', n: 1, reward: ['stick', 8] },
  { id: 'pick', text: 'Fabrique uma picareta de madeira', ev: 'craft', match: (k) => k === 'wood_pickaxe', n: 1, reward: ['torch', 8] },
  { id: 'stone', text: 'Minere 16 pedras', ev: 'collect', match: (k) => k === 'cobble', n: 16, reward: ['bread', 4] },
  { id: 'spick', text: 'Fabrique uma picareta de pedra', ev: 'craft', match: (k) => k === 'stone_pickaxe', n: 1, reward: ['coal', 8] },
  { id: 'furnace', text: 'Construa uma fornalha', ev: 'craft', match: (k) => k === 'furnace', n: 1, reward: ['raw_iron', 3] },
  { id: 'iron', text: 'Funda 5 barras de ferro', ev: 'smelt', match: (k) => k === 'iron_ingot', n: 5, reward: ['leather_chest', 1] },
  { id: 'night', text: 'Sobreviva a uma noite', ev: 'night', match: () => true, n: 1, reward: ['cooked_beef', 6] },
  { id: 'hunt', text: 'Derrote 5 criaturas hostis', ev: 'kill', match: (k) => k === 'zombie' || k === 'skeleton', n: 5, reward: ['iron_sword', 1] },
  { id: 'village', text: 'Encontre uma aldeia', ev: 'village', match: () => true, n: 1, reward: ['coin', 5] },
  { id: 'trade', text: 'Faça 3 trocas com aldeões', ev: 'trade', match: () => true, n: 3, reward: ['saddle', 1] },
  { id: 'farm', text: 'Colha 10 trigos', ev: 'collect', match: (k) => k === 'wheat', n: 10, reward: ['bone_meal', 10] },
  { id: 'breed', text: 'Faça dois animais terem um filhote', ev: 'breed', match: () => true, n: 1, reward: ['coin', 4] },
  { id: 'diamond', text: 'Encontre um diamante', ev: 'collect', match: (k) => k === 'diamond', n: 1, reward: ['diamond', 2] },
  { id: 'dpick', text: 'Fabrique uma picareta de diamante', ev: 'craft', match: (k) => k === 'diamond_pickaxe', n: 1, reward: ['crystal_block', 2] },
  { id: 'quest', text: 'Conclua uma missão de aldeão', ev: 'quest', match: () => true, n: 1, reward: ['coin', 10] },
  { id: 'circuit', text: 'Acenda uma lâmpada elétrica com uma alavanca', ev: 'place', match: (k) => k === B.PLAMP_ON, n: 1, reward: ['wire', 16] },
  // fim de jogo: Nether, Fortaleza e End
  { id: 'obsidian', text: 'Consiga 10 obsidianas (água sobre lava parada)', ev: 'collect', match: (k) => k === 'obsidian', n: 10, reward: ['flint_and_steel', 1] },
  { id: 'nether', text: 'Construa um portal e entre no Nether', ev: 'dimension', match: (k) => k === 'nether', n: 1, reward: ['cooked_beef', 8] },
  { id: 'blaze', text: 'Consiga 6 varas de blaze (fortaleza do Nether)', ev: 'collect', match: (k) => k === 'blaze_rod', n: 6, reward: ['iron_chest', 1] },
  { id: 'pearl', text: 'Consiga 12 pérolas do ender (endermen)', ev: 'collect', match: (k) => k === 'ender_pearl', n: 12, reward: ['arrow', 32] },
  { id: 'eye', text: 'Fabrique 12 olhos do ender', ev: 'craft', match: (k) => k === 'eye_of_ender', n: 12, reward: ['bow', 1] },
  { id: 'end', text: 'Siga os olhos até a Fortaleza e entre no End', ev: 'dimension', match: (k) => k === 'end', n: 1, reward: ['arrow', 32] },
  { id: 'dragon', text: 'Derrote o Dragão do End', ev: 'kill', match: (k) => k === 'dragon', n: 1, reward: ['diamond_block', 3] },
];

export const CH = { index: 0, progress: 0, done: false };
export function challengeJSON() { return { index: CH.index, progress: CH.progress }; }
export function loadChallenge(s) { CH.index = s && s.index || 0; CH.progress = s && s.progress || 0; CH.done = CH.index >= OBJECTIVES.length; }
export function currentObjective() { return G.mode === 'challenge' && !CH.done ? OBJECTIVES[CH.index] : null; }

export function challengeEvent(ev, k, n = 1) {
  // missões de aldeões (matar / explorar)
  hook('questEvent', ev, k, n);
  if (G.mode !== 'challenge' || CH.done) return;
  const o = OBJECTIVES[CH.index];
  if (!o || o.ev !== ev || !o.match(k)) return;
  CH.progress += n;
  if (CH.progress >= o.n) {
    const left = G.player.inv.add(o.reward[0], o.reward[1]);
    if (left) hook('dropItem', G.player.pos.x, G.player.pos.y + 1, G.player.pos.z, o.reward[0], left);
    hook('toast', `✔ Objetivo concluído: ${o.text}!`);
    hook('sound', 'levelup');
    CH.index++; CH.progress = 0;
    if (CH.index >= OBJECTIVES.length) { CH.done = true; hook('toast', '🏆 Você concluiu todos os desafios!'); }
  }
  hook('objectiveChanged');
}
