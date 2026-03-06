const { app, BrowserWindow, protocol, net } = require('electron');
const path = require('path');

// app:// を secure・standard スキームとして登録（fetch API 対応）
// ※ app.whenReady() より前に呼ぶ必要がある
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { secure: true, standard: true, supportFetchAPI: true, stream: true } }
]);

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 375,
    minHeight: 600,
    title: '台湾華語フラッシュカード',
    icon: path.join(__dirname, 'icon-512.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    }
  });

  win.setMenuBarVisibility(false);
  win.loadURL('app://localhost/index.html');
}

app.whenReady().then(() => {
  // app://localhost/foo → __dirname/foo のローカルファイルにマップ
  protocol.handle('app', (request) => {
    const url = new URL(request.url);
    const filePath = path.join(__dirname, url.pathname);
    return net.fetch('file://' + filePath);
  });

  createWindow();

  // macOS: Dock アイコンクリックでウィンドウを再表示
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// macOS 以外: 全ウィンドウを閉じたらアプリ終了
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
