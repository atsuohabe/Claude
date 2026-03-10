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
      preload: path.join(__dirname, 'preload.js'),
    }
  });

  win.setMenuBarVisibility(false);
  win.loadURL('app://localhost/index.html');
  return win;
}

app.whenReady().then(() => {
  // app://localhost/foo → __dirname/foo のローカルファイルにマップ
  protocol.handle('app', (request) => {
    const url = new URL(request.url);
    const filePath = path.join(__dirname, url.pathname);
    return net.fetch('file://' + filePath);
  });

  const win = createWindow();

  // 自動アップデート（パッケージ済みビルドのみ）
  if (app.isPackaged) {
    const { autoUpdater } = require('electron-updater');

    // サイレントチェック：バックグラウンドで確認、利用可能になったらダウンロード
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    // ダウンロード完了 → ウィンドウに通知（ユーザーが再起動を選べる）
    autoUpdater.on('update-downloaded', (info) => {
      win.webContents.executeJavaScript(`
        if (window.__showUpdateToast) {
          window.__showUpdateToast('${info.version}');
        }
      `).catch(() => {});
    });

    autoUpdater.on('error', (err) => {
      console.error('[updater] error:', err.message);
    });

    // 起動から30秒後にチェック（起動直後の負荷を避ける）
    setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 30_000);
  }

  // macOS: Dock アイコンクリックでウィンドウを再表示
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// macOS 以外: 全ウィンドウを閉じたらアプリ終了
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
