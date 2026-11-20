'use strict';

const { contextBridge, ipcRenderer } = require('electron');

function on(channel, cb) {
  const handler = (_event, payload) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld('api', {
  getState: () => ipcRenderer.invoke('state:get'),

  timer: (action, arg) => ipcRenderer.invoke('timer:action', action, arg),

  addTask: (fields) => ipcRenderer.invoke('task:add', fields),
  updateTask: (id, patch) => ipcRenderer.invoke('task:update', id, patch),
  toggleTask: (id) => ipcRenderer.invoke('task:toggle', id),
  deleteTask: (id) => ipcRenderer.invoke('task:delete', id),

  updateSettings: (patch) => ipcRenderer.invoke('settings:update', patch),

  openMain: (tab) => ipcRenderer.send('app:openMain', tab),
  quit: () => ipcRenderer.send('app:quit'),
  setNotchInteractive: (interactive) => ipcRenderer.send('notch:interactive', Boolean(interactive)),

  onTimer: (cb) => on('timer', cb),
  onData: (cb) => on('data', cb),
  onSound: (cb) => on('sound', cb),
  onFlash: (cb) => on('flash', cb),
  onNav: (cb) => on('nav', cb),
});
