// Ponte segura entre o jogo (página) e o app de PC: só expõe "hospedar sala".
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('vcDesktop', {
  platform: process.platform,
  host: (port) => ipcRenderer.invoke('vc-host', port),
});
