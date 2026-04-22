/**
 * TooManyVids - Electron Main Process
 * Single-window multi-video player
 */

const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { parseArgs } = require('../src/cli/parseArgs');
const { scanDirectories, selectVideos } = require('../src/files/scanDirectories');

// Disable autoplay restrictions
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

let mainWindow = null;
let config = null;
let videos = [];

// HTTP server for serving video files
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
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    
    const filePath = videoPathMap.get(videoId);
    const ext = path.extname(filePath).toLowerCase();
    const mimeType = MIME_TYPES[ext] || 'application/octet-stream';
    
    try {
      const stat = fs.statSync(filePath);
      res.writeHead(200, {
        'Content-Type': mimeType,
        'Content-Length': stat.size,
        'Access-Control-Allow-Origin': '*'
      });
      fs.createReadStream(filePath).pipe(res);
    } catch (err) {
      res.writeHead(404);
      res.end('File not found');
    }
  });
  
  httpServer.listen(HTTP_PORT, '127.0.0.1');
}

function parseCliArgs() {
  try {
    config = parseArgs(process.argv);
    return config;
  } catch (err) {
    console.error(`Error: ${err.message}`);
    console.error('\nUsage: electron . --dirs <dir1> [dir2...] --grid <ROWSxCOLS>');
    return null;
  }
}

async function createWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.size;

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
    videos = await scanDirectories(config.dirs);

    if (videos.length === 0) {
      mainWindow.webContents.send('error', 'No video files found');
      return;
    }

    const cellCount = config.grid.rows * config.grid.cols;
    const selectedVideos = selectVideos(videos, cellCount, config.shuffle, config.seed);
    
    videoPathMap.clear();
    const videoUrls = selectedVideos.map((videoPath, index) => {
      const id = `v${index}`;
      videoPathMap.set(id, videoPath);
      return `http://127.0.0.1:${HTTP_PORT}/video?id=${id}`;
    });

    mainWindow.webContents.send('config', {
      grid: config.grid,
      videos: videoUrls,
      loop: config.loop,
      mute: config.mute,
      screenWidth,
      screenHeight
    });
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  await mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

function handleReshuffle() {
  if (!mainWindow || videos.length === 0) return;

  const cellCount = config.grid.rows * config.grid.cols;
  const selectedVideos = selectVideos(videos, cellCount, true, null);
  
  videoPathMap.clear();
  const videoUrls = selectedVideos.map((videoPath, index) => {
    const id = `v${index}`;
    videoPathMap.set(id, videoPath);
    return `http://127.0.0.1:${HTTP_PORT}/video?id=${id}`;
  });

  mainWindow.webContents.send('reshuffle', {
    videos: videoUrls,
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
  ipcMain.on('log', (event, message) => console.log('[Renderer]', message));
}

app.whenReady().then(async () => {
  const parsedConfig = parseCliArgs();
  if (!parsedConfig) {
    app.quit();
    return;
  }

  startHttpServer();
  setupIpc();
  await createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (httpServer) httpServer.close();
  app.quit();
});
