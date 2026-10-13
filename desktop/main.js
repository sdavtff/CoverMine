// VoxelCraft para PC (Windows/Linux/macOS) — roda o mesmo jogo do APK num Chromium embutido.
const { app, BrowserWindow, protocol, net, Menu } = require('electron');
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
    webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
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
