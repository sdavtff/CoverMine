// Copia o jogo (mesmos arquivos do APK) para desktop/game antes de rodar/empacotar.
const fs = require('fs');
const path = require('path');
const src = path.join(__dirname, '..', 'app', 'src', 'main', 'assets');
const dst = path.join(__dirname, 'game');
fs.rmSync(dst, { recursive: true, force: true });
fs.cpSync(src, dst, { recursive: true });
console.log('assets copiados para', dst);
// servidor multiplayer embutido ("Hospedar sala")
fs.copyFileSync(path.join(__dirname, '..', 'server', 'server.js'), path.join(__dirname, 'server.js'));
