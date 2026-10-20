/**
 * TooManyVids - Electron Main Process
 * Single-window multi-video player
 */

const { app, BrowserWindow, ipcMain, screen, dialog } = require('electron');
const { pathToFileURL } = require('url');
const path = require('path');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const { parseArgs } = require('../src/cli/parseArgs');
const { scanDirectories, selectVideos } = require('../src/files/scanDirectories');
const { pickMode, TRANSCODE_FALLBACK_EXTENSIONS } = require('../src/media/mode');
const { getLogger } = require('../src/logger');

const log = getLogger('main');

const RENDERER_URL = pathToFileURL(path.join(__dirname, 'renderer', 'index.html')).href;

function isTrustedSender(event) {
  return Boolean(event?.senderFrame && event.senderFrame.url === RENDERER_URL);
}

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('enable-features', 'PlatformHEVCDecoderSupport,Vulkan');
app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling,UseChromeOSDirectVideoDecoder');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('num-raster-threads', '4');

// GUI apps on macOS/Windows often miss the shell PATH, so probe common install locations.
function resolveBinary(name) {
  const envPath = process.env[`${name.toUpperCase()}_PATH`];
  const candidates = [envPath, name];

  if (process.platform === 'darwin') {
    candidates.push(`/opt/homebrew/bin/${name}`, `/usr/local/bin/${name}`);
  } else if (process.platform === 'win32') {
    candidates.push(
      `C:\\ffmpeg\\bin\\${name}.exe`,
      path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Links', `${name}.exe`)
    );
  }

  for (const candidate of candidates.filter(Boolean)) {
    try {
      if (spawnSync(candidate, ['-version'], { timeout: 3000, stdio: 'ignore' }).status === 0) {
        return candidate;
      }
    } catch (_) {}
  }
  return null;
}

const FFMPEG_PATH = resolveBinary('ffmpeg');
const FFPROBE_PATH = resolveBinary('ffprobe');
const ffmpegAvailable = Boolean(FFMPEG_PATH);

if (ffmpegAvailable) {
  log.info('ffmpeg detected', { ffmpeg: FFMPEG_PATH, ffprobe: FFPROBE_PATH });
} else {
  log.warn('ffmpeg not found - transcoding disabled');
}

log.info('App starting', { platform: process.platform, arch: process.arch, electronVersion: process.versions.electron, ffmpegAvailable });

let mainWindow = null;
let config = null;
let videos = [];

let httpPort = 0;
let httpServer = null;
let videoPathMap = new Map();
// Loopback URLs are only reachable with this token, so other local pages cannot read the videos.
const sessionToken = crypto.randomBytes(16).toString('hex');

const MIME_TYPES = {
  '.mp4': 'video/mp4',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.mov': 'video/mp4',
  '.webm': 'video/webm',
  '.flv': 'video/x-flv',
  '.wmv': 'video/x-ms-wmv',
  '.m4v': 'video/mp4',
  '.mpg': 'video/mpeg',
  '.mpeg': 'video/mpeg',
  '.3gp': 'video/3gpp',
  '.ogv': 'video/ogg'
};

const TRANSCODE_MIME = 'video/mp4';

const MAX_CHUNK = 2 * 1024 * 1024;

function streamFile(filePath, start, end, res) {
  const stream = fs.createReadStream(filePath, { start, end });
  stream.on('error', (err) => {
    log.error('File stream error', { filePath, start, end, error: err.message });
    res.destroy(err);
  });
  stream.pipe(res);
}

function serveDirect(filePath, range, res) {
  const fileSize = fs.statSync(filePath).size;
  const ext = path.extname(filePath).toLowerCase();
  const mimeType = MIME_TYPES[ext] || 'application/octet-stream';

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Range');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range');
  res.setHeader('Accept-Ranges', 'bytes');

  if (!range) {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': mimeType
    });
    streamFile(filePath, 0, fileSize - 1, res);
    return;
  }

  const parts = range.replace(/bytes=/, '').split('-');
  const start = parseInt(parts[0], 10);
  let end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

  if (!Number.isFinite(start) || start < 0 || start >= fileSize) {
    res.writeHead(416, { 'Content-Range': `bytes */${fileSize}` });
    res.end();
    return;
  }

  end = Math.min(Number.isFinite(end) ? end : fileSize - 1, fileSize - 1);
  if (end < start) end = fileSize - 1;
  end = Math.min(end, start + MAX_CHUNK - 1);

  res.writeHead(206, {
    'Content-Range': `bytes ${start}-${end}/${fileSize}`,
    'Content-Length': end - start + 1,
    'Content-Type': mimeType
  });

  streamFile(filePath, start, end, res);
}

const MAX_CONCURRENT_TRANSCODES = 2;
let activeTranscodes = 0;
const transcodeQueue = [];

function processTranscodeQueue() {
  while (activeTranscodes < MAX_CONCURRENT_TRANSCODES && transcodeQueue.length > 0) {
    const next = transcodeQueue.shift();
    activeTranscodes++;
    log.info('Starting queued transcode', { filePath: next.filePath, active: activeTranscodes, queued: transcodeQueue.length });
    next.run().finally(() => {
      activeTranscodes--;
      processTranscodeQueue();
    });
  }
}

function serveRemuxedPipe(filePath, res, reencode, seekTime) {
  const seekArgs = seekTime > 0
    ? ['-ss', String(seekTime), '-noaccurate_seek', '-i', filePath]
    : ['-i', filePath];

  const args = reencode
    ? [...seekArgs, '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28',
       '-c:a', 'aac', '-b:a', '128k',
       '-f', 'mp4', '-movflags', 'frag_keyframe+empty_moov', '-']
    : [...seekArgs, '-c', 'copy', '-metadata:s:v', 'rotate=0',
       '-f', 'mp4', '-movflags', 'frag_keyframe+empty_moov', '-'];

  log.info('Serving ffmpeg pipe', { filePath, mode: reencode ? 'transcode' : 'remux', seekTime, cmd: args.join(' ') });

  const startTranscode = () => {
    return new Promise((resolve) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Content-Type', TRANSCODE_MIME);
      res.setHeader('Cache-Control', 'no-cache');

      const proc = spawn(FFMPEG_PATH, args, { stdio: ['ignore', 'pipe', 'pipe'] });

      proc.stdout.pipe(res);

      let stderrBuf = '';
      proc.stderr.on('data', (data) => {
        stderrBuf += data.toString();
        if (stderrBuf.length > 4096) stderrBuf = stderrBuf.slice(-2048);
      });

      proc.on('error', (err) => {
        log.error('ffmpeg spawn error', { filePath, error: err.message });
        if (!res.headersSent) {
          res.writeHead(500);
          res.end('ffmpeg error: ' + err.message);
        } else {
          res.end();
        }
        resolve();
      });

      proc.on('close', (code) => {
        if (code !== null && code !== 0 && code !== 255) {
          log.error('ffmpeg exited with error', { filePath, code, stderr: stderrBuf.slice(-500) });
        }
        if (!res.writableEnded) res.end();
        resolve();
      });

      res.on('close', () => {
        proc.kill('SIGKILL');
      });
    });
  };

  if (reencode && activeTranscodes >= MAX_CONCURRENT_TRANSCODES) {
    log.info('Transcode queued', { filePath, active: activeTranscodes, queued: transcodeQueue.length });
    transcodeQueue.push({ filePath, run: startTranscode });
  } else if (reencode) {
    activeTranscodes++;
    startTranscode().finally(() => {
      activeTranscodes--;
      processTranscodeQueue();
    });
  } else {
    startTranscode();
  }
}

function startHttpServer() {
  httpServer = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const videoId = url.searchParams.get('id');
    const requestedMode = url.searchParams.get('mode');
    const seekTime = parseFloat(url.searchParams.get('t') || '0') || 0;

    if (url.searchParams.get('token') !== sessionToken) {
      log.warn('HTTP 403 - bad token', { pathname: url.pathname });
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    if (!videoId || !videoPathMap.has(videoId)) {
      log.warn('HTTP 404 - unknown video id', { videoId, pathname: url.pathname });
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    const filePath = videoPathMap.get(videoId);
    const ext = path.extname(filePath).toLowerCase();
    const useExplicitMode = ffmpegAvailable && (requestedMode === 'remux' || requestedMode === 'transcode');
    const mode = useExplicitMode ? requestedMode : pickMode(ext, ffmpegAvailable);

    try {
      if (mode !== 'direct') {
        log.info('Serving via ffmpeg pipe', { videoId, ext, mode, seekTime });
        serveRemuxedPipe(filePath, res, mode === 'transcode', seekTime);
      } else {
        log.debug('Serving direct', { videoId, ext });
        serveDirect(filePath, req.headers.range, res);
      }
    } catch (err) {
      log.error('HTTP serve error', { videoId, filePath, error: err.message });
      if (!res.headersSent) {
        res.writeHead(500);
        res.end('Server error');
      }
    }
  });

  return new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(0, '127.0.0.1', () => {
      httpPort = httpServer.address().port;
      log.info('HTTP server started', { port: httpPort });
      resolve();
    });
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

function toVideoEntry(videoPath, idPrefix, index) {
  const id = `${idPrefix}${index}`;
  videoPathMap.set(id, videoPath);

  let size = 0;
  try {
    size = fs.statSync(videoPath).size;
  } catch (err) {
    log.warn('Cannot stat video file', { path: videoPath, error: err.message });
  }

  const ext = path.extname(videoPath).toLowerCase();
  const mode = pickMode(ext, ffmpegAvailable);
  const url = `http://127.0.0.1:${httpPort}/video?id=${id}&token=${sessionToken}`;
  const fallbackUrl = ffmpegAvailable && mode !== 'transcode' && TRANSCODE_FALLBACK_EXTENSIONS.has(ext)
    ? `${url}&mode=transcode`
    : null;

  return { id, url, fallbackUrl, path: videoPath, size, ext, mode };
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

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());

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
    const selectedVideos = selectVideos(videos, cellCount, config.shuffle);

    const selectedData = selectedVideos.map((vp, i) => toVideoEntry(vp, 'v', i));
    const poolData = videos.map((vp, i) => toVideoEntry(vp, 'p', i));

    log.info('Sending config to renderer', { cellCount, selectedCount: selectedData.length, poolCount: poolData.length, ffmpegAvailable });

    mainWindow.webContents.send('config', {
      grid: config.grid,
      videos: selectedData,
      pool: poolData,
      loop: config.loop,
      mute: config.mute,
      ffmpegAvailable
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
  const selectedVideos = selectVideos(videos, cellCount, true);

  const selectedData = selectedVideos.map((vp, i) => toVideoEntry(vp, 'v', i));
  const poolData = videos.map((vp, i) => toVideoEntry(vp, 'p', i));

  mainWindow.webContents.send('reshuffle', {
    videos: selectedData,
    pool: poolData,
    loop: config.loop,
    mute: config.mute
  });
}

function setupIpc() {
  ipcMain.handle('get-video-meta', (event, videoId) => {
    if (!isTrustedSender(event)) return { error: 'Forbidden' };
    if (!videoId || !videoPathMap.has(videoId)) {
      return { error: 'Unknown video id' };
    }
    const filePath = videoPathMap.get(videoId);
    return new Promise((resolve) => {
      if (!FFPROBE_PATH) {
        resolve({ error: 'ffprobe not available' });
        return;
      }
      const args = [
        '-v', 'quiet', '-print_format', 'json',
        '-show_format', '-show_streams', filePath
      ];
      const proc = spawn(FFPROBE_PATH, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      proc.stdout.on('data', (d) => { stdout += d.toString(); });
      proc.on('error', () => resolve({ error: 'ffprobe not available' }));
      proc.on('close', (code) => {
        if (code !== 0) {
          resolve({ error: `ffprobe exited with code ${code}` });
          return;
        }
        try {
          const data = JSON.parse(stdout);
          const info = { path: filePath };
          const vs = (data.streams || []).find(s => s.codec_type === 'video');
          const as = (data.streams || []).find(s => s.codec_type === 'audio');
          if (vs) {
            info.videoCodec = vs.codec_name || '';
            info.videoCodecLong = vs.codec_long_name || '';
            info.width = vs.width;
            info.height = vs.height;
            info.fps = vs.r_frame_rate || '';
            info.pixelFormat = vs.pix_fmt || '';
            info.profile = vs.profile || '';
            if (vs.tags && vs.tags.rotate) info.rotation = vs.tags.rotate;
            if (vs.side_data_list) {
              for (const sd of vs.side_data_list) {
                if (sd.side_data_type === 'Display Matrix' && sd.rotation !== undefined) {
                  info.rotation = sd.rotation;
                }
              }
            }
          }
          if (as) {
            info.audioCodec = as.codec_name || '';
            info.audioCodecLong = as.codec_long_name || '';
            info.audioSampleRate = as.sample_rate;
            info.audioChannels = as.channels;
          }
          if (data.format) {
            info.container = data.format.format_long_name || data.format.format_name || '';
            info.duration = data.format.duration;
            info.size = data.format.size;
            info.bitrate = data.format.bit_rate;
          }
          resolve(info);
        } catch (e) {
          resolve({ error: 'Failed to parse ffprobe output' });
        }
      });
    });
  });

  ipcMain.handle('delete-video', async (event, videoId) => {
    if (!isTrustedSender(event)) return { error: 'Forbidden' };
    if (!videoId || !videoPathMap.has(videoId)) {
      return { error: 'Unknown video id' };
    }

    const filePath = videoPathMap.get(videoId);
    if (!mainWindow) return { cancelled: true };

    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      buttons: ['Cancel', 'Delete'],
      defaultId: 0,
      cancelId: 0,
      message: 'Delete video from disk?',
      detail: `${filePath}\n\nThis cannot be undone.`
    });
    if (response !== 1) return { cancelled: true };

    try {
      await fs.promises.unlink(filePath);
    } catch (err) {
      log.error('Delete video failed', { videoId, path: filePath, error: err.message });
      return { error: err.message };
    }

    videos = videos.filter(v => v !== filePath);
    for (const [id, mappedPath] of videoPathMap) {
      if (mappedPath === filePath) videoPathMap.delete(id);
    }

    log.info('Video deleted', { videoId, path: filePath, remaining: videos.length });
    return { deleted: true, path: filePath };
  });

  ipcMain.on('reshuffle', (event) => {
    if (isTrustedSender(event)) handleReshuffle();
  });

  ipcMain.on('log', (event, data) => {
    if (!isTrustedSender(event)) return;
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

  try {
    await startHttpServer();
  } catch (err) {
    log.error('HTTP server failed', { error: err.message });
    app.quit();
    return;
  }
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
