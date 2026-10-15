import { app, BrowserWindow, ipcMain, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';

// 600x500 のほぼ静的な常駐ウィンドウに GPU 合成は不要。GPU プロセスのメモリを抑えるため
// ソフトウェア描画にする（app の ready 前に呼ぶ必要がある）
app.disableHardwareAcceleration();

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 600,
    height: 500,
    minWidth: 400,
    minHeight: 300,
    alwaysOnTop: true,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // renderer に Node を載せない。preload は electron の限定 require しか使っていないので sandbox 化できる
      sandbox: true,
      // 入力欄はトークン / リポジトリ名だけなのでスペルチェック辞書を読み込まない
      spellcheck: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // 開発時は DevTools を開く
  if (process.argv.includes('--devtools')) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// メモリ監視。常駐中に 14GB 近くまで膨れてマシン全体に影響した実績があるため、
// 5 分ごとにプロセス別 (browser / GPU / renderer / utility) の使用量を userData/memory.log に記録して
// どのプロセスが太るかを切り分けられるようにし、合計が閾値を超えたら自分を再起動して被害を止める。
// 再起動は原因が特定されるまでの安全弁であり、根本対処ではない
const MEMORY_LOG_INTERVAL_MS = 5 * 60_000;
const MEMORY_LOG_MAX_BYTES = 1024 * 1024;
const MEMORY_RELAUNCH_THRESHOLD_MB = 2048;

function appendMemoryLog(line: string): void {
  const file = path.join(app.getPath('userData'), 'memory.log');
  try {
    if (fs.existsSync(file) && fs.statSync(file).size > MEMORY_LOG_MAX_BYTES) {
      fs.renameSync(file, `${file}.1`);
    }
    fs.appendFileSync(file, `${new Date().toISOString()} ${line}\n`);
  } catch (e) {
    console.warn('memory log failed:', e);
  }
}

async function checkMemory(): Promise<void> {
  let totalMb = 0;
  const parts = app.getAppMetrics().map((m) => {
    const mb = Math.round(m.memory.workingSetSize / 1024);
    totalMb += mb;
    return `${m.name ? `${m.type}(${m.name})` : m.type}=${mb}MB`;
  });

  // renderer の V8 ヒープ。renderer プロセス全体との差が大きければ DOM / 描画側の肥大化と分かる
  let heap = '';
  try {
    const used = await mainWindow?.webContents.executeJavaScript('performance.memory.usedJSHeapSize');
    if (typeof used === 'number') heap = ` jsHeap=${Math.round(used / 1024 / 1024)}MB`;
  } catch {
    // 画面未ロード時などは省く
  }
  appendMemoryLog(`total=${totalMb}MB ${parts.join(' ')}${heap}`);

  if (totalMb > MEMORY_RELAUNCH_THRESHOLD_MB) {
    appendMemoryLog(`total ${totalMb}MB exceeds ${MEMORY_RELAUNCH_THRESHOLD_MB}MB, relaunching`);
    app.relaunch();
    app.exit(0);
  }
}

app.whenReady().then(() => {
  createWindow();
  // 直後だと renderer / GPU の子プロセスがまだ無く Browser しか記録されないため、少し待ってから初回を取る
  setTimeout(checkMemory, 10_000);
  setInterval(checkMemory, MEMORY_LOG_INTERVAL_MS);
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (mainWindow === null) createWindow();
});

// リンクをブラウザで開く
ipcMain.on('open-external', (_event, url: string) => {
  shell.openExternal(url);
});
