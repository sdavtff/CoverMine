// Aldeões: ofertas de comércio, missões e falas por profissão.
import { mulberry32 } from './noise.js';

const TRADES = {
  farmer: [
    { give: ['wheat', 20], get: ['coin', 1] }, { give: ['coin', 1], get: ['bread', 6] }, { give: ['coin', 1], get: ['apple', 4] },
    { give: ['coin', 2], get: ['seeds', 16] }, { give: ['beef', 10], get: ['coin', 1] }, { give: ['coin', 3], get: ['cooked_chicken', 8] },
  ],
  librarian: [
    { give: ['leather', 4], get: ['coin', 1] }, { give: ['coin', 4], get: ['bookshelf', 1] }, { give: ['coin', 5], get: ['map', 1] },
    { give: ['coin', 3], get: ['lamp', 2] }, { give: ['coin', 2], get: ['glass', 8] },
  ],
  smith: [
    { give: ['coal', 16], get: ['coin', 1] }, { give: ['iron_ingot', 4], get: ['coin', 1] }, { give: ['coin', 3], get: ['iron_pickaxe', 1] },
    { give: ['coin', 4], get: ['iron_sword', 1] }, { give: ['coin', 6], get: ['iron_chest', 1] }, { give: ['coin', 10], get: ['diamond_pickaxe', 1] },
    { give: ['coin', 2], get: ['iron_helmet', 1] }, { give: ['coin', 5], get: ['bucket', 1] },
  ],
  cleric: [
    { give: ['rotten_flesh', 16], get: ['coin', 1] }, { give: ['bone', 12], get: ['coin', 1] }, { give: ['coin', 2], get: ['crystal', 3] },
    { give: ['coin', 1], get: ['bone_meal', 10] }, { give: ['coin', 6], get: ['crystal_block', 1] },
  ],
  merchant: [
    { give: ['diamond', 1], get: ['coin', 6] }, { give: ['gold_ingot', 3], get: ['coin', 2] }, { give: ['coin', 6], get: ['saddle', 1] },
    { give: ['coin', 3], get: ['minecart', 1] }, { give: ['coin', 2], get: ['rail', 16] }, { give: ['coin', 2], get: ['boat', 1] },
    { give: ['coin', 4], get: ['elevator', 2] },
  ],
};

export function makeTrades(prof, seed) {
  const rnd = mulberry32(seed | 0);
  const all = TRADES[prof] || TRADES.merchant;
  const pick = all.slice().sort(() => rnd() - 0.5).slice(0, Math.min(all.length, 4 + Math.floor(rnd() * 2)));
  return pick.map((t) => ({ give: t.give.slice(), get: t.get.slice(), uses: 0, max: 6 + Math.floor(rnd() * 6) }));
}

const QUESTS = {
  farmer: [
    { type: 'collect', item: 'wheat', n: 12, text: 'A colheita está atrasada. Pode me trazer {n} de trigo?', reward: ['coin', 3] },
    { type: 'kill', mob: 'zombie', n: 3, text: 'Zumbis pisotearam minha plantação! Derrote {n} deles.', reward: ['coin', 4] },
  ],
  librarian: [
    { type: 'explore', biome: 5, text: 'Dizem que há templos no deserto. Visite um deserto e me conte!', reward: ['map', 1] },
    { type: 'collect', item: 'leather', n: 6, text: 'Preciso de {n} couros para encadernar livros.', reward: ['coin', 3] },
  ],
  smith: [
    { type: 'collect', item: 'iron_ingot', n: 8, text: 'Minha forja está sem ferro. Traga {n} barras de ferro.', reward: ['iron_chest', 1] },
    { type: 'collect', item: 'coal', n: 20, text: 'Preciso de {n} carvões para manter a forja acesa.', reward: ['coin', 3] },
  ],
  cleric: [
    { type: 'kill', mob: 'skeleton', n: 3, text: 'Esqueletos rondam a aldeia à noite. Derrote {n} deles.', reward: ['crystal', 4] },
    { type: 'collect', item: 'crystal', n: 4, text: 'Cristais brilham nas cavernas profundas. Traga {n} para mim.', reward: ['coin', 6] },
  ],
  merchant: [
    { type: 'collect', item: 'diamond', n: 1, text: 'Um diamante! É tudo o que eu peço. Você encontra um?', reward: ['coin', 8] },
    { type: 'explore', biome: 10, text: 'Quero mapear as montanhas nevadas. Vá até lá!', reward: ['coin', 5] },
  ],
};
export function makeQuest(prof, seed) {
  const rnd = mulberry32((seed | 0) + 7);
  const list = QUESTS[prof] || QUESTS.merchant;
  const q = list[Math.floor(rnd() * list.length)];
  return Object.assign({}, q, { progress: 0, accepted: false, done: false });
}

export const GREETINGS = {
  farmer: ['Bom dia! O tempo está ótimo para plantar.', 'Cuidado com os zumbis à noite, viu?', 'Trigo fresco, pão quentinho... quer negociar?'],
  librarian: ['Silêncio, por favor... ah, é você! Bem-vindo.', 'Sabia que existem cristais que brilham no escuro?', 'Os livros guardam os segredos deste mundo.'],
  smith: ['Precisa de ferramentas? Faço as melhores da região.', 'Ferro, carvão e muito suor. É assim que se faz uma boa espada.', 'Uma picareta de diamante dura uma eternidade!'],
  cleric: ['Que a luz das lâmpadas te proteja.', 'Os mortos-vivos temem o sol.', 'Traga-me ossos e eu pago bem.'],
  merchant: ['Tenho de tudo! Bom, quase tudo.', 'Moedas de ouro abrem muitas portas.', 'Já andou de carrinho nos trilhos? É divertido!'],
};
