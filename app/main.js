const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

function createWindow() {
  const win = new BrowserWindow({
    width: 1400, height: 900, minWidth: 960, minHeight: 640,
    backgroundColor: '#1b1c20',
    title: 'IllustBlend',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

ipcMain.handle('save-png', async (e, { dataUrl, suggested }) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: '결과 이미지 저장', defaultPath: suggested || 'result.png',
    filters: [{ name: 'PNG 이미지', extensions: ['png'] }]
  });
  if (canceled || !filePath) return { ok: false };
  const buf = Buffer.from(dataUrl.split(',')[1], 'base64');
  fs.writeFileSync(filePath, buf);
  return { ok: true, filePath };
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
