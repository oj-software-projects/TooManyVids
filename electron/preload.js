/**
 * TooManyVids - Preload Script
 * Exposes safe IPC methods to the renderer
 */

const { contextBridge, ipcRenderer } = require('electron');

const _log = (level, message, meta) => {
  try {
    ipcRenderer.send('log', { level, message, meta: meta ?? undefined });
  } catch (_) {}
};

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

  getVideoMeta: (videoId) => {
    return ipcRenderer.invoke('get-video-meta', videoId);
  },

  log: (message, meta) => _log('INFO', message, meta),
  warn: (message, meta) => _log('WARN', message, meta),
  error: (message, meta) => _log('ERROR', message, meta),
  debug: (message, meta) => _log('DEBUG', message, meta)
});
