// VoxelCraft para PC (Windows/Linux/macOS) — roda o mesmo jogo do APK num Chromium embutido.
const { app, BrowserWindow, protocol, net, Menu, ipcMain } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');

// Origem fixa e segura (app://voxelcraft) para módulos ES e para o localStorage (saves) persistirem.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);
// GPU: ignora a lista de bloqueio para garantir WebGL em placas de vídeo mais antigas.
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('force_high_performance_gpu');

const GAME_DIR = path.join(__dirname, 'game');

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 760,
    minWidth: 800,
    minHeight: 480,
    backgroundColor: '#000000',
    title: 'VoxelCraft',
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, preload: path.join(__dirname, 'preload.js') },
  });
  win.setMenuBarVisibility(false);
  // F11 / Alt+Enter: tela cheia
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11' || (input.alt && input.key === 'Enter')) {
      win.setFullScreen(!win.isFullScreen());
      e.preventDefault();
    }
  });
  // salva o mundo ao fechar a janela
  win.on('close', () => { win.webContents.executeJavaScript('window.saveGame && window.saveGame()').catch(() => {}); });
  win.loadURL('app://voxelcraft/index.html');
}

// "Hospedar sala": servidor multiplayer embutido (mesmo código de server/server.js)
let hosted = null;
ipcMain.handle('vc-host', async (_e, port) => {
  try {
    if (!hosted) {
      const { startServer } = require('./server.js');
      // se a porta estiver ocupada (outro programa), tenta as próximas
      let last = null;
      for (let p = port || 8765; p < (port || 8765) + 6 && !hosted; p++) {
        try { hosted = await startServer({ port: p, dataDir: path.join(app.getPath('userData'), 'salas') }); } catch (e) { last = e; if (e.code !== 'EADDRINUSE') break; }
      }
      if (!hosted) throw last || new Error('não foi possível abrir o servidor');
    }
    return { ok: true, port: hosted.port, addresses: hosted.addresses };
  } catch (e) {
    return { ok: false, error: e.code === 'EADDRINUSE' ? 'as portas ' + (port || 8765) + ' a ' + ((port || 8765) + 5) + ' já estão em uso' : e.message };
  }
});
app.on('before-quit', () => { if (hosted) hosted.close(); });

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  protocol.handle('app', (req) => {
    const { pathname } = new URL(req.url);
    const file = path.normalize(path.join(GAME_DIR, decodeURIComponent(pathname)));
    if (!file.startsWith(GAME_DIR)) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => app.quit());
