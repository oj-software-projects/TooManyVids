/**
 * TooManyVids - Preload Script
 * Exposes safe IPC methods to the renderer
 */

console.log('Preload script loaded');
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('toomanyvids', {
  onConfig: (callback) => {
    ipcRenderer.on('config', (event, data) => callback(data));
  },

  onReshuffle: (callback) => {
    ipcRenderer.on('reshuffle', (event, data) => callback(data));
  },

  onError: (callback) => {
    ipcRenderer.on('error', (event, message) => callback(message));
  },

  reshuffle: () => {
    ipcRenderer.send('reshuffle');
  },

  getScreenInfo: () => {
    return ipcRenderer.invoke('get-screen-info');
  },

  log: (message) => {
    ipcRenderer.send('log', message);
  }
});
