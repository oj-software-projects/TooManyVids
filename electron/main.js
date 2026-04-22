/**
 * TooManyVids - Electron Main Process
 * Single-window multi-video player
 */

const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { parseArgs } = require('../src/cli/parseArgs');
const { scanDirectories } = require('../src/files/scanDirectories');
const { getLogger } = require('../src/logger');

const log = getLogger('main');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('enable-features', 'PlatformHEVCDecoderSupport,Vulkan');
app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling,UseChromeOSDirectVideoDecoder');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('num-raster-threads', '4');

log.info('App starting', { platform: process.platform, arch: process.arch, electronVersion: process.versions.electron });

let mainWindow = null;
let config = null;
let videos = [];

const HTTP_PORT = 18923;
let httpServer = null;
let videoPathMap = new Map();

const MIME_TYPES = {
  '.mp4': 'video/mp4',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.flv': 'video/x-flv',
  '.wmv': 'video/x-ms-wmv',
  '.m4v': 'video/x-m4v',
  '.mpg': 'video/mpeg',
  '.mpeg': 'video/mpeg',
  '.3gp': 'video/3gpp',
  '.ogv': 'video/ogg'
};

function startHttpServer() {
  httpServer = http.createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${HTTP_PORT}`);
    const videoId = url.searchParams.get('id');

    if (!videoId || !videoPathMap.has(videoId)) {
      log.warn('HTTP 404 - unknown video id', { videoId, url: req.url });
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    const filePath = videoPathMap.get(videoId);
    const ext = path.extname(filePath).toLowerCase();
    const mimeType = MIME_TYPES[ext] || 'application/octet-stream';

    try {
      const stat = fs.statSync(filePath);
      const fileSize = stat.size;
      const range = req.headers.range;

      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', 'Range');
      res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range');

      if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        let end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const MAX_CHUNK = 2 * 1024 * 1024;
        if (end - start + 1 > MAX_CHUNK) {
          end = start + MAX_CHUNK - 1;
        }
        const chunkSize = end - start + 1;

        log.debug('HTTP range request', { videoId, start, end, chunkSize, mimeType });

        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunkSize,
          'Content-Type': mimeType
        });

        fs.createReadStream(filePath, { start, end }).pipe(res);
      } else {
        const MAX_INITIAL = 2 * 1024 * 1024;
        const end = Math.min(MAX_INITIAL, fileSize) - 1;
        const chunkSize = end + 1;

        log.debug('HTTP initial request', { videoId, chunkSize, fileSize, mimeType });

        res.writeHead(206, {
          'Content-Range': `bytes 0-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunkSize,
          'Content-Type': mimeType
        });

        fs.createReadStream(filePath, { start: 0, end }).pipe(res);
      }
    } catch (err) {
      log.error('HTTP serve error', { videoId, filePath, error: err.message });
      res.writeHead(404);
      res.end('File not found');
    }
  });

  httpServer.listen(HTTP_PORT, '127.0.0.1', () => {
    log.info('HTTP server started', { port: HTTP_PORT });
  });
}

function parseCliArgs() {
  try {
    config = parseArgs(process.argv);
    log.info('CLI args parsed', { dirs: config.dirs, grid: config.grid, shuffle: config.shuffle, loop: config.loop, mute: config.mute });
    return config;
  } catch (err) {
    log.error('CLI parse error', { error: err.message });
    console.error(`Error: ${err.message}`);
    console.error('\nUsage: electron . --dirs <dir1> [dir2...] --grid <ROWSxCOLS>');
    return null;
  }
}

async function createWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.size;

  log.info('Creating window', { screenWidth, screenHeight });

  mainWindow = new BrowserWindow({
    width: Math.floor(screenWidth * 0.9),
    height: Math.floor(screenHeight * 0.9),
    title: 'TooManyVids - Multi-Video Player',
    backgroundColor: '#000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.webContents.on('did-finish-load', async () => {
    log.info('Renderer did-finish-load');

    try {
      videos = await scanDirectories(config.dirs);
    } catch (err) {
      log.error('scanDirectories failed', { error: err.message, stack: err.stack });
      mainWindow.webContents.send('error', 'Failed to scan directories: ' + err.message);
      return;
    }

    log.info('Videos scanned', { count: videos.length });

    if (videos.length === 0) {
      log.warn('No video files found', { dirs: config.dirs });
      mainWindow.webContents.send('error', 'No video files found');
      return;
    }

    const cellCount = config.grid.rows * config.grid.cols;

    let uniqueVideos = [...videos];
    if (config.shuffle) {
      for (let i = uniqueVideos.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [uniqueVideos[i], uniqueVideos[j]] = [uniqueVideos[j], uniqueVideos[i]];
      }
    }

    const selectedVideos = [];
    for (let i = 0; i < cellCount; i++) {
      selectedVideos.push(uniqueVideos[i % uniqueVideos.length]);
    }

    videoPathMap.clear();
    const videoData = selectedVideos.map((videoPath, index) => {
      const id = `v${index}`;
      videoPathMap.set(id, videoPath);

      let fileSize = 0;
      try {
        const stat = fs.statSync(videoPath);
        fileSize = stat.size;
      } catch (err) {
        log.warn('Cannot stat video file', { path: videoPath, error: err.message });
      }

      return {
        url: `http://127.0.0.1:${HTTP_PORT}/video?id=${id}`,
        path: videoPath,
        size: fileSize
      };
    });

    log.info('Sending config to renderer', { cellCount, videoCount: videoData.length });

    mainWindow.webContents.send('config', {
      grid: config.grid,
      videos: videoData,
      loop: config.loop,
      mute: config.mute,
      screenWidth,
      screenHeight
    });
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    log.error('Renderer process gone', { reason: details.reason, exitCode: details.exitCode });
  });

  mainWindow.webContents.on('unresponsive', () => {
    log.warn('Renderer unresponsive');
  });

  mainWindow.on('closed', () => {
    log.info('Window closed');
    mainWindow = null;
  });

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  await mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  log.info('Window loaded');
}

function handleReshuffle() {
  if (!mainWindow || videos.length === 0) return;

  log.info('Reshuffling videos');

  const cellCount = config.grid.rows * config.grid.cols;

  const shuffled = [...videos].sort(() => Math.random() - 0.5);
  const selectedVideos = [];
  for (let i = 0; i < cellCount; i++) {
    selectedVideos.push(shuffled[i % shuffled.length]);
  }

  videoPathMap.clear();
  const videoData = selectedVideos.map((videoPath, index) => {
    const id = `v${index}`;
    videoPathMap.set(id, videoPath);

    let fileSize = 0;
    try {
      const stat = fs.statSync(videoPath);
      fileSize = stat.size;
    } catch (err) {}

    return {
      url: `http://127.0.0.1:${HTTP_PORT}/video?id=${id}`,
      path: videoPath,
      size: fileSize
    };
  });

  mainWindow.webContents.send('reshuffle', {
    videos: videoData,
    loop: config.loop,
    mute: config.mute
  });
}

function setupIpc() {
  ipcMain.handle('get-screen-info', () => {
    const primaryDisplay = screen.getPrimaryDisplay();
    return {
      width: primaryDisplay.size.width,
      height: primaryDisplay.size.height,
      workArea: primaryDisplay.workAreaSize
    };
  });

  ipcMain.on('reshuffle', () => handleReshuffle());

  ipcMain.on('log', (event, data) => {
    const logger = getLogger('renderer');
    if (typeof data === 'object' && data.level) {
      const method = data.level.toLowerCase();
      if (logger[method]) {
        logger[method](data.message, data.meta);
      } else {
        logger.info(data.message, data.meta);
      }
    } else {
      logger.info(String(data));
    }
  });
}

app.whenReady().then(async () => {
  const parsedConfig = parseCliArgs();
  if (!parsedConfig) {
    log.error('No valid config, quitting');
    app.quit();
    return;
  }

  startHttpServer();
  setupIpc();

  try {
    await createWindow();
  } catch (err) {
    log.error('createWindow failed', { error: err.message, stack: err.stack });
    app.quit();
    return;
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  log.info('All windows closed, quitting');
  if (httpServer) httpServer.close();
  app.quit();
});

process.on('uncaughtException', (err) => {
  log.error('Uncaught exception', { error: err.message, stack: err.stack });
});

process.on('unhandledRejection', (reason) => {
  log.error('Unhandled rejection', { reason: String(reason) });
});
