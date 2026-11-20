'use strict';

const path = require('path');
const fs = require('fs');
const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  Notification,
  ipcMain,
  screen,
  globalShortcut,
  nativeImage,
} = require('electron');

const { Engine } = require('./engine');
const { Store } = require('./store');

const ROOT = path.join(__dirname, '..', '..');
const RENDERER = path.join(__dirname, '..', 'renderer');
const PRELOAD = path.join(__dirname, 'preload.js');
const ICON = path.join(ROOT, 'assets', 'icon.png');
const TRAY_ICON = path.join(ROOT, 'assets', 'tray.png');

// Ukuran jendela notch (transparan). Panel yang terlihat lebih kecil dan ada di tengah atas.
const NOTCH_W = 580;
const NOTCH_H = 300;

const MODE_LABEL = { focus: 'Fokus', short: 'Istirahat pendek', long: 'Istirahat panjang' };

let engine = null;
let store = null;
let notchWin = null;
let mainWin = null;
let tray = null;
let quitting = false;
let lastTrayKey = '';

// ---------------------------------------------------------------- util

function fmt(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function windows() {
  return [notchWin, mainWin].filter((w) => w && !w.isDestroyed());
}

function broadcast(channel, payload) {
  for (const w of windows()) w.webContents.send(channel, payload);
}

function notify(title, body) {
  if (!engine.data.settings.notifications) return;
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, icon: ICON, silent: true });
  n.on('click', () => showMain());
  n.show();
}

function sendSound(kind) {
  if (engine.data.settings.sound && notchWin && !notchWin.isDestroyed()) {
    notchWin.webContents.send('sound', kind);
  }
}

// ---------------------------------------------------------------- windows

function positionNotch() {
  if (!notchWin || notchWin.isDestroyed()) return;
  const b = screen.getPrimaryDisplay().bounds;
  notchWin.setBounds({
    x: Math.round(b.x + (b.width - NOTCH_W) / 2),
    y: b.y,
    width: NOTCH_W,
    height: NOTCH_H,
  });
}

function createNotch() {
  notchWin = new BrowserWindow({
    width: NOTCH_W,
    height: NOTCH_H,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  notchWin.setAlwaysOnTop(true, 'screen-saver');
  notchWin.setIgnoreMouseEvents(true, { forward: true });
  notchWin.removeMenu();
  positionNotch();
  notchWin.loadFile(path.join(RENDERER, 'notch.html'));
  notchWin.once('ready-to-show', () => {
    if (engine.data.settings.showNotch) notchWin.showInactive();
  });
  notchWin.on('closed', () => {
    notchWin = null;
  });
}

function createMain({ show = true } = {}) {
  mainWin = new BrowserWindow({
    width: 1000,
    height: 680,
    minWidth: 800,
    minHeight: 560,
    show: false,
    title: 'Kala',
    icon: ICON,
    backgroundColor: '#0e0e11',
    autoHideMenuBar: true,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  mainWin.removeMenu();
  mainWin.loadFile(path.join(RENDERER, 'app.html'));
  mainWin.once('ready-to-show', () => {
    if (show) mainWin.show();
  });

  // Tombol X menyembunyikan ke tray (timer tetap jalan di latar belakang).
  mainWin.on('close', (event) => {
    if (!quitting && engine.data.settings.closeToTray) {
      event.preventDefault();
      mainWin.hide();
    }
  });
  mainWin.on('closed', () => {
    mainWin = null;
  });
}

function showMain(tab) {
  if (!mainWin || mainWin.isDestroyed()) {
    createMain({ show: true });
    if (tab) mainWin.webContents.once('did-finish-load', () => mainWin.webContents.send('nav', tab));
    return;
  }
  if (mainWin.isMinimized()) mainWin.restore();
  mainWin.show();
  mainWin.focus();
  if (tab) mainWin.webContents.send('nav', tab);
}

function setNotchVisible(visible) {
  engine.updateSettings({ showNotch: visible });
}

// ---------------------------------------------------------------- tray

function trayMenu() {
  const t = engine.timerSnapshot();
  return Menu.buildFromTemplate([
    { label: 'Buka Kala', click: () => showMain() },
    { type: 'separator' },
    { label: t.running ? 'Jeda' : 'Mulai', click: () => engine.toggle() },
    { label: 'Lewati sesi', click: () => engine.skip() },
    { label: 'Reset', click: () => engine.reset() },
    { type: 'separator' },
    {
      label: engine.data.settings.showNotch ? 'Sembunyikan notch' : 'Tampilkan notch',
      click: () => setNotchVisible(!engine.data.settings.showNotch),
    },
    { type: 'separator' },
    {
      label: 'Keluar',
      click: () => {
        quitting = true;
        app.quit();
      },
    },
  ]);
}

function createTray() {
  const img = nativeImage.createFromPath(TRAY_ICON).resize({ width: 16, height: 16 });
  tray = new Tray(img);
  tray.setToolTip('Kala');
  tray.on('click', () => showMain());
  refreshTray(true);
}

function refreshTray(force = false) {
  if (!tray) return;
  const t = engine.timerSnapshot();
  tray.setToolTip(`Kala - ${MODE_LABEL[t.mode]} ${fmt(t.remaining)}${t.running ? '' : ' (jeda)'}`);
  const key = `${t.running}|${t.mode}|${engine.data.settings.showNotch}`;
  if (force || key !== lastTrayKey) {
    lastTrayKey = key;
    tray.setContextMenu(trayMenu());
  }
}

// ---------------------------------------------------------------- efek pengaturan

function applySettings() {
  const s = engine.data.settings;

  if (notchWin && !notchWin.isDestroyed()) {
    if (s.showNotch && !notchWin.isVisible()) notchWin.showInactive();
    if (!s.showNotch && notchWin.isVisible()) notchWin.hide();
  }

  if (app.isPackaged) {
    app.setLoginItemSettings({ openAtLogin: s.launchAtStartup, args: ['--hidden'] });
  }
  refreshTray(true);
}

// ---------------------------------------------------------------- engine events

function onEngineEvent(type, payload) {
  switch (type) {
    case 'timer':
      broadcast('timer', payload);
      refreshTray();
      break;

    case 'data':
      store.save(engine.data);
      broadcast('data', {
        settings: engine.data.settings,
        tasks: engine.data.tasks,
        stats: engine.getStats(),
      });
      break;

    case 'session-complete': {
      const { finished, next, nextMinutes, autoStarted, taskTitle } = payload;
      let title;
      let body;
      if (finished === 'focus') {
        title = 'Sesi fokus selesai';
        body =
          (taskTitle ? `Kerja bagus untuk "${taskTitle}". ` : 'Kerja bagus. ') +
          `Saatnya ${MODE_LABEL[next].toLowerCase()} ${nextMinutes} menit.`;
      } else {
        title = 'Istirahat selesai';
        body = `Ayo kembali fokus selama ${nextMinutes} menit.`;
      }
      notify(title, body);
      sendSound(finished === 'focus' ? 'focus-end' : 'break-end');
      if (notchWin && !notchWin.isDestroyed()) {
        notchWin.webContents.send('flash', { title, body, autoStarted });
      }
      break;
    }

    case 'deadline': {
      const { task, kind } = payload;
      const text =
        kind === 'over'
          ? `Deadline terlewat: ${task.title}`
          : kind === 'h1'
            ? `Kurang dari 1 jam lagi: ${task.title}`
            : `Deadline kurang dari 24 jam: ${task.title}`;
      notify('Pengingat deadline', task.course ? `${text} (${task.course})` : text);
      sendSound('deadline');
      if (notchWin && !notchWin.isDestroyed()) {
        notchWin.webContents.send('flash', { title: 'Pengingat deadline', body: text, autoStarted: false });
      }
      break;
    }

    default:
      break;
  }
}

// ---------------------------------------------------------------- IPC

const TIMER_ACTIONS = new Set(['toggle', 'start', 'pause', 'reset', 'skip', 'setMode', 'setTask']);

function registerIpc() {
  ipcMain.handle('state:get', () => engine.snapshot());

  ipcMain.handle('timer:action', (_e, action, arg) => {
    if (!TIMER_ACTIONS.has(action)) return null;
    engine[action](arg);
    return engine.timerSnapshot();
  });

  ipcMain.handle('task:add', (_e, fields) => engine.addTask(fields));
  ipcMain.handle('task:update', (_e, id, patch) => engine.updateTask(String(id), patch));
  ipcMain.handle('task:toggle', (_e, id) => engine.toggleTask(String(id)));
  ipcMain.handle('task:delete', (_e, id) => engine.deleteTask(String(id)));

  ipcMain.handle('settings:update', (_e, patch) => {
    const result = engine.updateSettings(patch);
    applySettings();
    return result;
  });

  ipcMain.on('app:openMain', (_e, tab) => showMain(typeof tab === 'string' ? tab : undefined));

  ipcMain.on('app:quit', () => {
    quitting = true;
    app.quit();
  });

  // Notch transparan: hanya tangkap klik saat kursor berada di atas panel notch.
  ipcMain.on('notch:interactive', (_e, interactive) => {
    if (!notchWin || notchWin.isDestroyed()) return;
    if (interactive) notchWin.setIgnoreMouseEvents(false);
    else notchWin.setIgnoreMouseEvents(true, { forward: true });
  });
}

// ---------------------------------------------------------------- start

function registerShortcuts() {
  try {
    globalShortcut.register('CommandOrControl+Alt+P', () => engine.toggle());
    globalShortcut.register('CommandOrControl+Alt+N', () => setNotchVisible(!engine.data.settings.showNotch));
    globalShortcut.register('CommandOrControl+Alt+O', () => showMain());
  } catch (err) {
    console.error('Gagal mendaftarkan shortcut:', err);
  }
}

/** Salin data dari versi lama (nama NotchFocus) sekali saja, kalau data baru belum ada. */
function migrateOldData(newFile) {
  try {
    if (fs.existsSync(newFile)) return;
    const old = path.join(app.getPath('appData'), 'notchfocus', 'notchfocus-data.json');
    if (!fs.existsSync(old)) return;
    fs.mkdirSync(path.dirname(newFile), { recursive: true });
    fs.copyFileSync(old, newFile);
  } catch (err) {
    console.error('Migrasi data lama gagal:', err);
  }
}

function boot() {
  app.setAppUserModelId('com.kuliah.kala');

  const dataFile = path.join(app.getPath('userData'), 'kala-data.json');
  migrateOldData(dataFile);
  store = new Store(dataFile);
  engine = new Engine(store.load(), { emit: onEngineEvent });

  registerIpc();
  createNotch();
  createMain({ show: !process.argv.includes('--hidden') });
  createTray();
  registerShortcuts();
  applySettings();

  setInterval(() => engine.tick(), 250);
  setInterval(() => engine.checkDeadlines(), 30 * 1000);
  setTimeout(() => engine.checkDeadlines(), 3000);

  screen.on('display-metrics-changed', positionNotch);
  screen.on('display-added', positionNotch);
  screen.on('display-removed', positionNotch);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showMain());
  app.on('before-quit', () => {
    quitting = true;
    if (store) {
      store.save(engine.data);
      store.flush();
    }
  });
  app.on('will-quit', () => globalShortcut.unregisterAll());
  // Aplikasi tetap hidup di tray walau semua jendela tertutup.
  app.on('window-all-closed', () => {});
  app.whenReady().then(boot);
}
