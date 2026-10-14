// Estado global compartilhado entre os módulos do jogo.
export const G = {
  world: null,        // World atual
  player: null,       // jogador local
  settings: null,     // configurações gráficas/gerais salvas
  eff: null,          // configurações efetivas (com modo economia)
  renderer: null, scene: null, camera: null,
  playing: false,     // jogo em andamento (menu fechado)
  paused: false,      // interface aberta (inventário, baú...) sem fechar o mundo
  isTouch: false,
  time: 0,            // segundos desde o início
  gameTime: 0.3,      // hora do dia (0..1)
  mode: 'creative',   // survival | creative | peaceful | challenge
  meta: null,         // metadados do mundo salvo (nome, id...)
  net: null,          // cliente multiplayer (quando conectado)
  hooks: {},          // callbacks entre módulos (evita importações circulares)
};

export function hook(name, ...args) { const f = G.hooks[name]; return f ? f(...args) : undefined; }
