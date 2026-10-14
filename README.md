# VoxelCraft HD 3.0

Jogo sandbox de blocos para **Android** (WebView) e **PC** (Electron), feito em JavaScript com Three.js r160
(a mesma versão do original). A versão 3.0 transforma o VoxelCraft num sandbox completo: mundo procedural
com 14 biomas, cavernas, minérios e estruturas, sobrevivência com fome e armaduras, fabricação, fornalha e
baús, animais, monstros e aldeões com trocas e missões, mecanismos (alavancas, fios, pistões, trilhos),
clima com chuva, neve e raios, mapa, saves em IndexedDB, personalização de skin com braço em 1ª pessoa,
multiplayer em rede local e atualização automática.

**Downloads (gerados por esta versão):**
- Android: [`dist/VoxelCraft-HD.apk`](dist/VoxelCraft-HD.apk)
- Windows: `VoxelCraft-HD.exe`. Ele foi enviado diretamente no chat por ter 71 MB, e pode ser gerado de novo
  com `npm run dist` (veja abaixo). O `.exe` não fica mais no repositório porque a CDN da atualização
  automática tem limite de tamanho.

| | |
|---|---|
| ![1ª pessoa](docs/screenshots/v3-primeira-pessoa.jpg) | ![3ª pessoa](docs/screenshots/v3-terceira-pessoa.jpg) |
| ![Celular](docs/screenshots/v3-celular.jpg) | ![Chuva](docs/screenshots/v3-chuva.jpg) |
| ![Noite](docs/screenshots/v3-noite.jpg) | ![Mapa](docs/screenshots/v3-mapa.jpg) |
| ![Inventário](docs/screenshots/v3-inventario.jpg) | ![Criativo](docs/screenshots/v3-criativo.jpg) |

## O que foi implementado (e está funcionando)

**Renderização**
- Chunks de 16×128×16. A geração e a malha de cada chunk rodam em Web Workers, e as edições do jogador
  são remalhadas na hora na thread principal. Frustum culling do Three.js, fila de prioridade por
  distância e limite de malhas por quadro.
- Iluminação voxel com luz do céu e luz de blocos (tochas, lâmpadas, lava, cristal) por flood fill,
  iluminação suave e oclusão de ambiente por vértice.
- Formas de bloco reais: degraus, lajes, cercas, portões, portas, painéis de vidro, tochas, escadas de
  mão, camas, mesas, cadeiras, alavancas, botões, placas de pressão, fios, trilhos (inclusive curvas e
  rampas), pistões e cactos. A colisão e a seleção usam a forma exata.
- Sombras PCF estabilizadas, água com reflexo planar, ondas, espuma e cáusticas, céu atmosférico,
  nuvens volumétricas, neblina e vegetação com vento (tudo da v2 foi mantido).
- Pós-processamento modular: render HDR, bloom, tone mapping ACES, correção de cor, vinheta e FXAA.
- Perda de contexto WebGL é tratada (o jogo pausa e recarrega as texturas).

**Mundo**
- Gerador novo com continentes, colinas, montanhas, rios e lagos e 14 biomas: oceano, praia, planície,
  floresta, floresta densa, bétulas, deserto, savana, pântano, taiga, montanha, montanha nevada,
  terreno rochoso e rio.
- Cavernas 3D com lagos de lava no fundo. Minérios por profundidade: carvão, cobre, ferro, ouro,
  diamante e cristal.
- Estruturas: aldeias com casas, poço, plantações, postes de luz e caminhos; ruínas; templos no
  deserto; masmorras com baús de tesouro.
- Semente configurável. Mundos antigos mantêm o gerador original, e as construções continuam intactas.

**Sobrevivência e itens**
- Vida, fome, saciedade, ar debaixo d'água, regeneração, dano de queda, afogamento, lava e cactos.
  Armadura reduz o dano e gasta durabilidade. Ao morrer você deixa os itens no chão e renasce na cama
  ou no ponto inicial.
- 82 blocos, 164 itens e 109 receitas: grade 2×2 no inventário, mesa de trabalho 3×3, livro de receitas,
  fornalha com combustível e baús.
- Ferramentas de madeira, pedra, ferro, ouro e diamante com velocidade, nível de mineração e
  durabilidade. Também há espadas, arco e flechas, tesoura, enxada, baldes, armaduras de 4 materiais e
  comidas.
- Inventário com pilhas, barra rápida, dividir pilha (segurar), modo rápido, descartar (lixeira ou Q) e
  equipar armadura. Funciona no toque e no mouse.
- Plantações (trigo em 4 estágios), mudas que viram árvores, farinha de osso, grama que se espalha,
  areia e cascalho que caem.

**Criaturas**
- Animais: vaca, porco, galinha, ovelha (com lã tosquiável e cores), coelho, cavalo (3 pelagens,
  montável com sela) e peixes. Eles vagam, fogem quando apanham, seguem você quando está com a comida
  certa, se reproduzem e soltam itens.
- Monstros: zumbi (corpo a corpo) e esqueleto (arqueiro). Surgem no escuro e à noite e queimam ao sol.
  O modo Pacífico desliga os monstros.
- Aldeões com 5 profissões, nomes, rotina de dia e noite (voltam para casa e abrem portas), trocas por
  moedas e missões: coletar, derrotar e explorar.

**Mecanismos e veículos**
- Alavanca, botão, placa de pressão, fio com nível de energia, lâmpada que acende, portas e portões
  automáticos, pistão que empurra até 12 blocos, elevador.
- Barco, carrinho de mina em trilhos (com curvas) e cavalo.

**Modos de jogo:** Sobrevivência, Criativo (voo, itens infinitos, quebra instantânea), Pacífico (sem
monstros, a fome não mata) e Desafio (17 objetivos em sequência, com dano maior).

**Saves:** vários mundos no IndexedDB, com criar, abrir, renomear, duplicar, exportar/importar (arquivo
.json) e apagar (com confirmação). Cada mundo guarda nome, semente, modo, posição, inventário, edições,
baús, fornalhas, criaturas, hora, clima, mapa e progresso. Há salvamento automático a cada 30 s e ao
sair. São usados dois slots alternados com checksum: se um estiver corrompido, o jogo usa o outro e
avisa. O mundo da versão anterior é migrado automaticamente.

**Mapa:** coordenadas, bússola, minimapa, mapa do mundo com zoom e arraste (pinça no celular), regiões
exploradas, marcadores próprios, aldeias e local da morte.

**Personalização:** nome, 6 skins prontas, cores de pele, cabelo, olhos, camisa, calça e sapatos,
estilo de cabelo e prévia. O **braço do personagem aparece em 1ª pessoa** com a skin escolhida e o
item na mão, e a 3ª pessoa mostra o modelo completo (V/F5 ou botão 👁 alterna 1ª, 3ª por trás e 3ª pela
frente). Também há sensibilidade, FOV, inverter eixo, tamanho da interface, alto contraste e redução
de flashes.

**Clima:** céu limpo, chuva e tempestade com raios e trovões (atraso pela distância). Neve nos biomas
frios. Chuva e neve não atravessam telhados.

**Multiplayer (rede local):** servidor autoritativo em Node.js (`server/`), também embutido no app de PC
(botão **Hospedar sala**). Tem salas com senha, sincronização de posição, blocos, criaturas, hora e
clima, chat, nomes e skins, e reconexão automática (até 5 tentativas). O inventário e a posição de cada
jogador ficam guardados no servidor. O servidor valida coordenadas, ids, alcance, taxa de edições e
permissões (`/construir off`, `/expulsar <nome>`, `/senha`, `/jogadores`). Se o anfitrião sair, outro
jogador assume a simulação.

**Atualização automática (PC e celular):** ao abrir com internet, o jogo consulta `update.json` neste
repositório. Se houver versão mais nova, carrega o código novo direto da CDN (jsDelivr, com Statically e
GitHack como reserva). Sem internet, abre a versão embutida. Dá para desligar em Configurações →
Geral → "Atualizar o jogo automaticamente".

## Controles

| PC | Celular | Ação |
|---|---|---|
| WASD + mouse | joystick (lado esquerdo) + arrastar | andar / olhar |
| Espaço / Shift | ▲ / ▼ | pular (subir voando) / agachar (descer) |
| Ctrl | » (liga/desliga) ou joystick no máximo | correr |
| Clique esquerdo (segurar) | tocar e segurar | quebrar / atacar |
| Clique direito | toque rápido | colocar / usar / comer / interagir |
| 1–9, roda do mouse | barra rápida | escolher item |
| E ou I | 🎒 | inventário |
| F | botão "voar" (criativo) | voar |
| V ou F5 | 👁 | câmera 1ª/3ª pessoa |
| M | 🗺 | mapa |
| T | 💬 (no multiplayer) | chat |
| Q | lixeira no inventário | descartar |
| Esc | ⏸ | pausa / menu |

## Configurações Gráficas

Presets **Baixa / Média / Alta / Ultra** (ou Personalizada), aplicados na hora e salvos:

| Opção | Efeito real |
|---|---|
| Texturas | Atlas de 32/64/128 px com relevo (normal map) e filtro anisotrópico |
| Distância de renderização | 2 a 12 chunks |
| Sombras | Desligadas ou mapa de 1024 a 4096 px |
| Água | Simples → ondas → espuma e cáusticas → reflexos planares |
| Vegetação, nuvens, iluminação, neblina | Densidade, tipo e intensidade |
| Pós-processamento | Desligado / tone mapping + cor / + bloom / + FXAA, com bloom, vinheta e correção de cor individuais |
| Partículas | Densidade de 0 a 150% |
| Antialiasing, resolução | MSAA; escala de 50% a 200% |
| Limite de FPS, modo economia, ajuste automático | Para celulares mais fracos |

## Estrutura do código

```
app/src/main/assets/               o jogo (mesmos arquivos no APK, no EXE e na CDN)
  boot.js / version.js / update.json   inicialização + atualização automática
  main.js        orquestração: menus → mundo → loop, ações, morte, cama, multiplayer
  state.js       estado global e "hooks" entre módulos
  noise.js, worldgen.js, worldgen-worker.js   ruído, biomas, cavernas, minérios, estruturas
  blocks.js, tiles.js       definições de blocos (propriedades, formas, colisão) e texturas
  world.js, mesher.js       chunks, edições, luz voxel e geração de malha (também usado no worker)
  textures.js, textures2.js, atlas-worker.js   texturas procedurais (albedo, normal, rugosidade/AO)
  render.js, shaders.js, postfx.js   renderizador, céu, água, sombras, pós-processamento
  physics.js, player.js     colisão por caixas, raycast, jogador e sobrevivência
  items.js, crafting.js, icons.js   itens, inventário, receitas, fornalha, ícones
  gameplay.js     quebrar/colocar/usar blocos, baús, fornalhas, plantas, ticks
  entities.js, mobs.js, models.js, villagers.js   criaturas, IA, veículos, modelos, trocas e missões
  mechanics.js    energia (alavanca, fio, lâmpada, pistão, portas)
  hand.js         braço em 1ª pessoa e modelo em 3ª pessoa
  weather.js, particles.js, audio.js   clima, partículas, sons sintetizados
  ui.js, menus.js, input.js, mapview.js, challenge.js   HUD, telas, controles, mapa, modo desafio
  saves.js, idb.js          saves em IndexedDB com recuperação
  net.js         cliente multiplayer
server/            servidor multiplayer (Node.js + ws) e teste automático do protocolo
desktop/           app de PC (Electron): main.js, preload.js (Hospedar sala), copy-assets.js
app/src/main/java/.../MainActivity.java   wrapper WebView (Android)
tools/build_apk.py         gera o APK assinado sem Android SDK
tools/publish_update.py    publica uma atualização automática
tools/base/VoxelCraft-wrapper.apk   wrapper Android compilado (com permissão de internet)
```

## Como gerar e testar

### APK (sem Android SDK)
Requer Python 3 e Java 11+:
```bash
python3 tools/build_apk.py        # → dist/VoxelCraft-HD.apk (assinado, esquemas v2+v3)
adb install -r dist/VoxelCraft-HD.apk
```
O APK original não tinha a permissão de **internet**, então a atualização automática e o multiplayer não
funcionariam no celular. O wrapper foi refeito com o [apktool](https://github.com/iBotPeaches/Apktool)
(`tools/base/VoxelCraft-wrapper.apk`). Ele adiciona `INTERNET`, `ACCESS_NETWORK_STATE` e
`usesCleartextTraffic`, libera conteúdo misto na WebView (para `ws://` na rede local), sobe a versão
para 3.0.0 (versionCode 3) e remove `debuggable`. O código-fonte Java e o manifesto do projeto foram
atualizados do mesmo jeito para quem compila com Gradle (`./gradlew assembleRelease`).

> É **preciso instalar este APK novo uma vez** (por cima da v2, com a mesma assinatura). A partir daí, as
> próximas versões chegam sozinhas.

### EXE (Windows)
```bash
cd desktop && npm install
npm start          # roda no PC atual
npm run dist       # → desktop/dist/VoxelCraft-HD.exe (portátil, x64)
```

### Servidor multiplayer dedicado
```bash
cd server && npm install
node server.js 8765          # salas salvas em server/data/
npm test                     # teste automático do protocolo (19 verificações)
```
No celular ou no PC, abra **Multiplayer** e digite o endereço mostrado pelo servidor (ex.: `192.168.0.10:8765`),
a sala e a senha. No app de PC, use **Multiplayer → Hospedar sala com um mundo...**. Todos precisam
estar no mesmo Wi-Fi (o Windows pode pedir para liberar o app no firewall).

### Publicar uma atualização automática
```bash
python3 tools/publish_update.py 3.0.1 "o que mudou"
git push
```
O script grava a versão, faz commit do código e aponta `update.json` para esse commit. Os aparelhos com
a 3.0.0 ou mais nova baixam a versão nova na próxima abertura com internet. O manifesto é lido do branch
`ccr-57277497-q2k9gm`. Se o projeto mudar de branch, ajuste `BRANCH` em `boot.js` antes de gerar o
próximo APK/EXE.

### Testar no navegador
```bash
python3 -m http.server 8000 --directory app/src/main/assets   # abra http://localhost:8000
```

## Testes realizados (Chromium headless com renderização por software)

Todos passaram sem erros no console:
- **Gameplay:** iniciar sobrevivência; quebrar terra (o item cai e é recolhido); cadeia de fabricação
  (tábuas, gravetos, mesa, tocha, fornalha); tempos de mineração (pedra: 7,5 s na mão, 1,1 s com
  picareta de madeira); minério de ferro só sai com picareta de pedra; fornalha (3 ferros brutos viram
  3 lingotes, 6 s cada).
- **Mecanismos:** alavanca → fio (energia 14) → lâmpada liga e desliga; alavanca abre a porta; pistão
  estende e empurra.
- **Criaturas e clima:** vaca derrotada solta carne e couro; animais surgem por bioma; zumbi e esqueleto
  aparecem à noite; tempestade com chuva.
- **Saves:** salvar e recarregar mantém edições (18/18), inventário, criaturas e dados de baú/fornalha.
- **Telas:** inventário, criativo, mapa, 1ª/3ª pessoa e layout de celular com toque, conferidos por
  captura de tela.
- **Multiplayer:** teste de protocolo com 19/19 verificações (senha, alcance, ids inválidos, limite de
  taxa, permissões, chat, criaturas, troca de anfitrião, persistência após reiniciar, inventário na
  reconexão). Também foi testado com dois navegadores no servidor real: o convidado recebe o mundo,
  vê o anfitrião e vice-versa, um bloco colocado aparece no outro, uma edição fora de alcance é desfeita,
  as criaturas aparecem nos dois e o convidado vira anfitrião quando o primeiro sai.
- **App de PC (Electron no Linux):** "Hospedar sala" inicia o servidor embutido e um cliente externo
  entra na sala.
- **Atualização automática (simulada):** manifesto e CDN interceptados. A versão 3.0.1 "remota" é
  carregada, inclusive os workers; quando a primeira CDN falha, a reserva assume; sem internet, abre a
  versão local.

## Limitações e pendências

- **Não testado em aparelho real.** Os testes rodaram em navegador desktop com renderização por
  software (10 a 17 FPS). O desempenho no celular depende do aparelho; use Baixa/Média e o ajuste
  automático. Não há garantia de 60 FPS.
- **Atualização automática:** a CDN real não pôde ser acessada daqui (o ambiente bloqueia jsDelivr), então
  o fluxo foi testado só por simulação. Ela depende de o repositório continuar **público**. Mudanças no
  wrapper nativo (Java, manifesto, Electron) exigem instalar um APK/EXE novo.
- **Multiplayer:** funciona em rede local (ou com o servidor exposto na internet com porta liberada;
  não há servidor público hospedado). Itens dropados e projéteis são locais de cada jogador. O
  inventário fica no cliente e o servidor só guarda uma cópia (não há validação de crafting). Baús e
  fornalhas não são sincronizados entre jogadores.
- A água não escorre (é estática como na versão original) e não há redstone com atraso (repetidores).
- Neve só cai nos biomas frios. Não há acúmulo de neve em camadas.
- Sem sons gravados: os efeitos são sintetizados (WebAudio).
- O `.exe` não é assinado digitalmente (o SmartScreen avisa na primeira vez) e não tem ícone próprio.
- A chave do APK é a de `tools/voxelcraft.keystore`. Instalar por cima da versão original da outra
  máquina exige desinstalar antes, e isso apaga os saves dela.
