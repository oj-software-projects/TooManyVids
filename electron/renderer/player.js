/**
 * TooManyVids - Video Player Controller
 * Manages the video grid and playback
 */

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${mins}:${secs}`;
}

function bindSeekControls(video, seekBar, timeDisplay, onSeek) {
  let isSeeking = false;
  let seekTarget = null;

  seekBar.addEventListener('pointerdown', (e) => {
    isSeeking = true;
    seekBar.setPointerCapture(e.pointerId);
  });

  seekBar.addEventListener('pointerup', (e) => {
    isSeeking = false;
    seekBar.releasePointerCapture(e.pointerId);
    if (seekTarget !== null) {
      onSeek(seekTarget);
      seekTarget = null;
    }
  });

  seekBar.addEventListener('input', (e) => {
    if (!video.duration) return;
    seekTarget = (e.target.value / 100) * video.duration;
    timeDisplay.textContent = `${formatTime(seekTarget)} / ${formatTime(video.duration)}`;
  });

  video.addEventListener('timeupdate', () => {
    if (isSeeking || !video.duration) return;
    seekBar.value = (video.currentTime / video.duration) * 100;
    timeDisplay.textContent = `${formatTime(video.currentTime)} / ${formatTime(video.duration)}`;
  });
}

class VideoGridPlayer {
  constructor() {
    this.players = [];
    this.config = null;
    this.isPaused = false;
    this.isMuted = false;
    this.fullscreenPlayer = null;
    this.videoPool = [];

    this.gridContainer = document.getElementById('grid-container');
    this.statusEl = document.getElementById('status');
    this.shortcutsEl = document.getElementById('shortcuts');
    this.errorMessage = document.getElementById('error-message');
    this.errorModal = document.getElementById('error-modal');
    this.metaModal = document.getElementById('meta-modal');
    this.metaTextEl = document.getElementById('meta-text');

    this.dirs = [];
    this.folderCounts = new Map();
    this.lobbyStatusEl = document.getElementById('lobby-status');
    this.hudTimer = null;

    this.setupEventListeners();
    this.setupLobby();
    this.setupHud();
    this.setupIpcListeners();
    window.toomanyvids.log('VideoGridPlayer initialized');
  }

  setupEventListeners() {
    document.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLElement && e.target.matches('input, textarea, select')) return;

      switch (e.key.toLowerCase()) {
        case 'tab':
          if (document.body.classList.contains('mode-wall')) {
            e.preventDefault();
            this.showLobby();
          }
          break;
        case 'q':
          if (!this.fullscreenPlayer) window.close();
          break;
        case 'escape':
          if (this.metaModal.classList.contains('visible')) {
            this.hideMeta();
          } else if (this.fullscreenPlayer) {
            this.exitFullscreen();
          } else if (document.body.classList.contains('mode-wall')) {
            this.showLobby();
          }
          break;
        case 'r':
          this.reshuffle();
          break;
        case 'p':
          this.togglePause();
          break;
        case 'm':
          this.toggleMute();
          break;
        case '?':
          this.shortcutsEl.classList.toggle('visible');
          break;
      }
    });

    document.getElementById('error-ok').addEventListener('click', () => {
      this.errorModal.classList.remove('visible');
    });

    document.getElementById('meta-close').addEventListener('click', () => this.hideMeta());
    document.getElementById('meta-copy').addEventListener('click', () => this.copyMeta());
    this.metaModal.addEventListener('click', (e) => {
      if (e.target === this.metaModal) this.hideMeta();
    });

    document.getElementById('btn-setup').addEventListener('click', () => this.showLobby());
    document.getElementById('btn-reshuffle').addEventListener('click', () => this.reshuffle());
    document.getElementById('btn-pause').addEventListener('click', () => this.togglePause());
    document.getElementById('btn-mute').addEventListener('click', () => this.toggleMute());

    let resizeTimeout;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => this.handleResize(), 100);
    });
  }

  handleResize() {
    this.players.forEach(p => this.applyRotationTo(p.video, p.rotation));
    if (this.fullscreenPlayer !== null) {
      const fullscreenVideo = document.querySelector('#fullscreen-container video');
      const player = this.players[this.fullscreenPlayer];
      if (fullscreenVideo && player) this.applyRotationTo(fullscreenVideo, player.rotation);
    }
    this.updateStatus();
  }

  applyRotationTo(videoEl, rotation) {
    let scale = 1;
    if (rotation % 180 !== 0) {
      const boxW = videoEl.clientWidth;
      const boxH = videoEl.clientHeight;
      const videoW = videoEl.videoWidth;
      const videoH = videoEl.videoHeight;
      if (boxW > 0 && boxH > 0 && videoW > 0 && videoH > 0) {
        const fit = Math.min(boxW / videoW, boxH / videoH);
        const shownW = videoW * fit;
        const shownH = videoH * fit;
        scale = Math.min(boxW / shownH, boxH / shownW);
      }
    }
    videoEl.style.transform = rotation === 0 ? '' : `rotate(${rotation}deg) scale(${scale})`;
  }

  setupLobby() {
    this.dirListEl = document.getElementById('dir-list');
    this.rowsInput = document.getElementById('grid-rows');
    this.colsInput = document.getElementById('grid-cols');
    this.gridCellsEl = document.getElementById('grid-cells');
    this.startBtn = document.getElementById('btn-start');

    document.getElementById('btn-add-dir').addEventListener('click', () => this.addDirs());
    this.startBtn.addEventListener('click', () => this.startWall());

    document.querySelectorAll('.preset').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.rowsInput.value = btn.dataset.rows;
        this.colsInput.value = btn.dataset.cols;
        this.updateGridLabel();
      });
    });
    this.rowsInput.addEventListener('input', () => this.updateGridLabel());
    this.colsInput.addEventListener('input', () => this.updateGridLabel());

    this.dirListEl.addEventListener('click', (e) => {
      const btn = e.target.closest('.dir-remove');
      if (!btn) return;
      this.dirs = this.dirs.filter((dir) => dir !== btn.dataset.path);
      this.renderDirs();
    });
  }

  setupHud() {
    const wake = () => {
      if (!document.body.classList.contains('mode-wall')) return;
      document.body.classList.remove('hud-hidden');
      clearTimeout(this.hudTimer);
      this.hudTimer = setTimeout(() => document.body.classList.add('hud-hidden'), 2000);
    };
    this.wakeHud = wake;
    ['mousemove', 'mousedown', 'wheel', 'keydown'].forEach((ev) =>
      window.addEventListener(ev, wake, { passive: true, capture: true })
    );
  }

  setLobbyStatus(message) {
    this.lobbyStatusEl.textContent = message || '';
  }

  folderCountLabel(dir) {
    if (!this.folderCounts.has(dir)) return { text: '\u2026', title: 'Scanning' };
    const entry = this.folderCounts.get(dir);
    if (entry.count === null) return { text: 'not found', bad: true, title: entry.error || 'Folder is not accessible' };
    return { text: entry.count === 1 ? '1 video' : `${entry.count} videos` };
  }

  async refreshCounts(dirs) {
    const targets = [...new Set(dirs)].filter(Boolean);
    if (targets.length === 0) return;

    for (const dir of targets) this.folderCounts.delete(dir);
    this.renderDirs();

    try {
      const { counts } = await window.toomanyvids.countVideos(targets);
      for (const entry of counts || []) this.folderCounts.set(entry.dir, entry);
    } catch (err) {
      window.toomanyvids.warn('Folder count failed', { error: err.message });
    }
    this.renderDirs();
  }

  renderDirs() {
    this.dirListEl.innerHTML = '';
    if (this.dirs.length === 0) {
      const li = document.createElement('li');
      li.className = 'dir-empty';
      li.textContent = 'No folders yet';
      this.dirListEl.appendChild(li);
      return;
    }
    for (const dir of this.dirs) {
      const li = document.createElement('li');
      const pathEl = document.createElement('span');
      pathEl.className = 'dir-path';
      pathEl.textContent = dir;
      pathEl.title = dir;

      const count = this.folderCountLabel(dir);
      const countEl = document.createElement('span');
      countEl.className = count.bad ? 'dir-count bad' : 'dir-count';
      countEl.textContent = count.text;
      if (count.title) countEl.title = count.title;

      const btn = document.createElement('button');
      btn.className = 'dir-remove';
      btn.textContent = '\u00d7';
      btn.title = 'Remove folder';
      btn.dataset.path = dir;
      li.append(pathEl, countEl, btn);
      this.dirListEl.appendChild(li);
    }
  }

  readGridInputs() {
    const clamp = (input) => {
      const n = Math.trunc(Number(input.value));
      if (!Number.isFinite(n)) return 2;
      return Math.min(8, Math.max(1, n));
    };
    return { rows: clamp(this.rowsInput), cols: clamp(this.colsInput) };
  }

  updateGridLabel() {
    const { rows, cols } = this.readGridInputs();
    this.gridCellsEl.textContent = `${rows * cols} videos`;
    document.querySelectorAll('.preset').forEach((btn) => {
      btn.classList.toggle('active', Number(btn.dataset.rows) === rows && Number(btn.dataset.cols) === cols);
    });
  }

  async addDirs() {
    try {
      const result = await window.toomanyvids.pickDirectories();
      const added = [];
      for (const dir of result?.dirs || []) {
        if (!this.dirs.includes(dir)) {
          this.dirs.push(dir);
          added.push(dir);
        }
      }
      this.renderDirs();
      this.setLobbyStatus('');
      await this.refreshCounts(added);
    } catch (err) {
      this.setLobbyStatus('Folder picker failed: ' + err.message);
    }
  }

  async startWall() {
    if (this.dirs.length === 0) {
      this.setLobbyStatus('Add at least one folder');
      return;
    }

    this.startBtn.disabled = true;
    this.startBtn.textContent = 'Starting...';
    this.setLobbyStatus('');

    try {
      const result = await window.toomanyvids.startWall({
        dirs: this.dirs,
        grid: this.readGridInputs(),
        shuffle: document.getElementById('opt-shuffle').checked,
        loop: document.getElementById('opt-loop').checked,
        mute: document.getElementById('opt-mute').checked
      });
      if (result?.error) this.setLobbyStatus(result.error);
    } catch (err) {
      this.setLobbyStatus('Failed to start: ' + err.message);
    } finally {
      this.startBtn.disabled = false;
      this.startBtn.textContent = 'Start Wall';
    }
  }

  applyLobby(data) {
    window.toomanyvids.log('Lobby config received', { dirs: data.dirs?.length, grid: data.grid });
    this.dirs = Array.isArray(data.dirs) ? [...data.dirs] : [];
    this.rowsInput.value = data.grid?.rows ?? 2;
    this.colsInput.value = data.grid?.cols ?? 2;
    document.getElementById('opt-shuffle').checked = Boolean(data.shuffle);
    document.getElementById('opt-loop').checked = Boolean(data.loop);
    document.getElementById('opt-mute').checked = Boolean(data.mute);
    this.renderDirs();
    this.updateGridLabel();
    this.setLobbyStatus('');
    this.showLobby();
    this.refreshCounts(this.dirs);
  }

  showLobby() {
    if (this.fullscreenPlayer !== null) this.exitFullscreen();
    this.players.forEach((p) => p.video.pause());
    clearTimeout(this.hudTimer);
    document.body.classList.remove('mode-wall', 'hud-hidden');
    document.body.classList.add('mode-lobby');
    window.toomanyvids.log('Lobby shown');
  }

  showWall() {
    document.body.classList.remove('mode-lobby');
    document.body.classList.add('mode-wall');
    this.wakeHud();
  }

  setupIpcListeners() {
    window.toomanyvids.onLobby((data) => this.applyLobby(data));

    window.toomanyvids.onConfig((config) => {
      window.toomanyvids.log('Config received', { grid: config.grid?.rows + 'x' + config.grid?.cols, videoCount: config.videos?.length, poolCount: config.pool?.length });
      this.videoPool = config.pool || config.videos || [];
      this.showWall();
      this.initializeGrid(config);
    });

    window.toomanyvids.onReshuffle((data) => {
      window.toomanyvids.log('Reshuffle received', { videoCount: data.videos?.length, poolCount: data.pool?.length });
      this.videoPool = data.pool || data.videos || [];
      this.loadVideos(data.videos, data.loop, data.mute);
    });

    window.toomanyvids.onError((message) => {
      window.toomanyvids.error('IPC error', { message });
      this.showError(message);
    });
  }

  initializeGrid(config) {
    this.config = config;
    const { grid, videos, loop, mute } = config;

    // A fresh wall always starts playing with the configured mute state.
    this.isPaused = false;
    this.isMuted = Boolean(mute);
    document.getElementById('btn-pause').textContent = 'Pause';
    document.getElementById('btn-mute').textContent = this.isMuted ? 'Unmute' : 'Mute';

    this.gridContainer.style.gridTemplateColumns = `repeat(${grid.cols}, 1fr)`;
    this.gridContainer.style.gridTemplateRows = `repeat(${grid.rows}, 1fr)`;

    this.gridContainer.innerHTML = '';
    this.players = [];

    for (let i = 0; i < grid.rows * grid.cols; i++) {
      const cell = this.createVideoCell(i);
      this.gridContainer.appendChild(cell);
      this.players.push({
        element: cell,
        video: cell.querySelector('video'),
        index: i,
        videoUrl: null,
        videoPath: null,
        videoExt: null,
        mode: 'direct',
        fallbackUrl: null,
        usingFallback: false,
        _blackCheckDone: false,
        _blackAttempts: 0,
        _blackTimer: null,
        videoStarted: false,
        _startupStallLogged: false,
        _lastStallWarn: 0,
        rotation: 0
      });
    }

    window.toomanyvids.log('Grid initialized', { cells: this.players.length, poolSize: this.videoPool.length });
    this.loadVideos(videos, loop, mute);
  }

  createVideoCell(index) {
    const cell = document.createElement('div');
    cell.className = 'video-cell';
    cell.innerHTML = `
      <video playsinline autoplay muted preload="metadata"></video>
      <div class="loading">Loading...</div>
      <div class="cell-overlay">
        <div class="cell-title"></div>
        <div class="cell-info"></div>
        <div class="cell-buttons">
          <button class="btn-next" title="Load random video">&#x23e9; Next</button>
          <button class="btn-pick" title="Pick from list">&#x2630; Pick</button>
          <button class="btn-meta" title="Copy metadata to clipboard">Meta</button>
          <button class="btn-delete" title="Delete video from disk">Del</button>
          <div class="btn-rotate-group">
            <button class="btn-rotate-left" title="Rotate left 90°">&#x21b6;</button>
            <button class="btn-rotate-right" title="Rotate right 90°">&#x21b7;</button>
          </div>
        </div>
        <div class="seek-bar-container">
          <input type="range" class="seek-bar" min="0" max="100" value="0">
          <span class="time-display">0:00 / 0:00</span>
        </div>
        <div class="pick-list" style="display:none"></div>
      </div>
    `;

    const video = cell.querySelector('video');
    // Needed so the canvas black-frame check can read pixels from the HTTP stream.
    video.crossOrigin = 'anonymous';
    const getPlayer = () => this.players[index];
    const loading = cell.querySelector('.loading');
    const cellOverlay = cell.querySelector('.cell-overlay');
    const seekBar = cell.querySelector('.seek-bar');
    const timeDisplay = cell.querySelector('.time-display');
    const titleEl = cell.querySelector('.cell-title');
    const infoEl = cell.querySelector('.cell-info');
    const btnNext = cell.querySelector('.btn-next');
    const btnPick = cell.querySelector('.btn-pick');
    const btnMeta = cell.querySelector('.btn-meta');
    const btnDelete = cell.querySelector('.btn-delete');
    const btnRotateLeft = cell.querySelector('.btn-rotate-left');
    const btnRotateRight = cell.querySelector('.btn-rotate-right');
    const pickList = cell.querySelector('.pick-list');

    video.addEventListener('loadeddata', () => {
      loading.style.display = 'none';
      this.updateStatus();
    });

    video.addEventListener('canplay', () => {
      loading.style.display = 'none';
    });

    const attemptBlackDetect = () => {
      const p = getPlayer();
      if (!p || p._blackCheckDone || p.usingFallback || !p.fallbackUrl) return;
      if (video.paused || video.ended) return;
      p._blackAttempts++;
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 4;
        canvas.height = 4;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, 4, 4);
        const data = ctx.getImageData(0, 0, 4, 4).data;
        let nonBlack = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i] > 5 || data[i + 1] > 5 || data[i + 2] > 5) {
            nonBlack++;
          }
        }
        if (nonBlack > 0) {
          p._blackCheckDone = true;
          return;
        }
        if (p._blackAttempts < 4) {
          p._blackTimer = setTimeout(attemptBlackDetect, 1000);
          return;
        }
        window.toomanyvids.warn('Black frame confirmed, switching to transcode', { index, attempts: p._blackAttempts, path: p.videoPath });
        p.usingFallback = true;
        p._blackCheckDone = true;
        const wasMuted = video.muted;
        const wasLoop = video.loop;
        video.src = p.fallbackUrl;
        video.muted = wasMuted;
        video.loop = wasLoop;
        loading.style.display = 'block';
        video.play().catch(() => {
          loading.style.display = 'none';
        });
      } catch (err) {
        window.toomanyvids.warn('Black frame check failed', { index, error: err.message });
        if (p._blackAttempts < 4) {
          p._blackTimer = setTimeout(attemptBlackDetect, 1000);
        } else {
          p._blackCheckDone = true;
        }
      }
    };

    video.addEventListener('timeupdate', () => {
      const p = getPlayer();
      if (!p || p._blackCheckDone || p.usingFallback || !p.fallbackUrl || p._blackTimer) return;
      if (video.currentTime > 0.5) {
        p._blackTimer = setTimeout(attemptBlackDetect, 500);
      }
    });

    video.addEventListener('error', () => {
      const p = getPlayer();
      if (!p) return;
      clearTimeout(p._blackTimer);
      p._blackTimer = null;
      loading.style.display = 'none';
      const ext = (p.videoExt || '').replace('.', '').toLowerCase();
      const videoError = video.error;
      const errCode = videoError ? videoError.code : 'unknown';
      const errMsg = videoError ? videoError.message : 'unknown';
      window.toomanyvids.error('Video error', { index, ext, errCode, errMsg, src: p.videoUrl });

      if (p.fallbackUrl && !p.usingFallback) {
        window.toomanyvids.log('Retrying with transcode', { index, path: p.videoPath });
        p.usingFallback = true;
        p._blackCheckDone = true;
        video.src = p.fallbackUrl;
        loading.style.display = 'block';
        video.play().then(() => {
          window.toomanyvids.log('Transcode playback started', { index });
        }).catch(() => {
          loading.style.display = 'none';
          titleEl.textContent = 'Cannot play: .' + ext.toUpperCase();
          titleEl.style.opacity = '1';
          infoEl.style.opacity = '1';
        });
        return;
      }

      const unsupported = ['mkv', 'avi', 'flv', 'wmv', 'hevc', 'h265'];
      if (unsupported.includes(ext)) {
        titleEl.textContent = 'Codec? : .' + ext.toUpperCase();
      } else {
        titleEl.textContent = 'Error: .' + ext.toUpperCase() + ' (code ' + errCode + ')';
      }
      titleEl.style.opacity = '1';
      infoEl.style.opacity = '1';

      cell.onclick = () => {
        video.play().catch(() => {});
        cell.onclick = null;
        titleEl.style.opacity = '0';
        infoEl.style.opacity = '0';
      };
    });

    video.addEventListener('stalled', () => {
      const p = getPlayer();
      loading.style.display = 'block';
      if (!p) return;
      const meta = { index, src: p.videoUrl, readyState: video.readyState };
      if (!p.videoStarted) {
        // Expected while an ffmpeg pipe warms up; log once per load instead of spamming.
        if (!p._startupStallLogged) {
          p._startupStallLogged = true;
          window.toomanyvids.debug('Waiting for first frame', meta);
        }
        return;
      }
      const now = Date.now();
      if (now - p._lastStallWarn > 30000) {
        p._lastStallWarn = now;
        window.toomanyvids.warn('Video stalled', meta);
      }
    });

    video.addEventListener('playing', () => {
      const p = getPlayer();
      if (p) p.videoStarted = true;
      loading.style.display = 'none';
      if (p && !p._blackCheckDone && !p.usingFallback && p.fallbackUrl && !p._blackTimer) {
        p._blackTimer = setTimeout(attemptBlackDetect, 1500);
      }
    });

    video.addEventListener('ended', () => {
      if (this.config?.loop) return;
      const next = this.getAvailableVideo(index);
      if (next) this.loadSingleVideo(getPlayer(), next, false, this.config?.mute);
    });

    const seekViaServer = (targetTime) => {
      const p = getPlayer();
      if (!p) return;
      const baseUrl = p.usingFallback ? p.fallbackUrl : p.videoUrl;
      if (!baseUrl) return;
      const sep = baseUrl.includes('?') ? '&' : '?';
      const wasMuted = video.muted;
      const wasLoop = video.loop;
      p.videoStarted = false;
      p._startupStallLogged = false;
      video.src = baseUrl + sep + 't=' + Math.floor(targetTime);
      video.muted = wasMuted;
      video.loop = wasLoop;
      video.play().catch(() => {});
    };

    bindSeekControls(video, seekBar, timeDisplay, (time) => {
      const p = getPlayer();
      loading.style.display = 'block';
      if (p && (p.mode !== 'direct' || p.usingFallback)) {
        seekViaServer(time);
      } else {
        video.currentTime = time;
      }
    });

    video.addEventListener('seeked', () => {
      loading.style.display = 'none';
      if (video.paused && !this.isPaused) {
        video.play().catch(() => {});
      }
    });

    video.addEventListener('canplay', () => {
      loading.style.display = 'none';
    });

    cell.addEventListener('dblclick', (e) => {
      e.preventDefault();
      this.toggleFullscreen(index);
    });

    let clickTimer = null;
    cell.addEventListener('click', (e) => {
      if (e.target.closest('.seek-bar-container')) return;
      if (clickTimer) {
        clearTimeout(clickTimer);
        clickTimer = null;
        return;
      }
      clickTimer = setTimeout(() => {
        clickTimer = null;
        if (video.paused) {
          video.play().catch(() => {});
        } else {
          video.pause();
        }
      }, 250);
    });

    cell.addEventListener('mouseenter', () => {
      cellOverlay.classList.add('visible');
    });

    cell.addEventListener('mouseleave', () => {
      cellOverlay.classList.remove('visible');
      pickList.style.display = 'none';
    });

    btnNext.addEventListener('click', (e) => {
      e.stopPropagation();
      const next = this.getAvailableVideo(index);
      if (next) {
        window.toomanyvids.log('Next video', { index, path: next.path });
        this.loadSingleVideo(this.players[index], next, this.config?.loop, this.config?.mute);
      } else {
        window.toomanyvids.warn('No available video for Next', { index });
      }
    });

    btnPick.addEventListener('click', (e) => {
      e.stopPropagation();
      if (pickList.style.display === 'block') {
        pickList.style.display = 'none';
        return;
      }
      const available = this.getAvailableVideos(index);
      pickList.innerHTML = '';
      available.forEach((v) => {
        const name = v.path.split(/[/\\]/).pop().replace(/\.[^/.]+$/, '');
        const item = document.createElement('div');
        item.className = 'pick-item';
        item.textContent = name;
        item.title = v.path;
        item.addEventListener('click', (ev) => {
          ev.stopPropagation();
          window.toomanyvids.log('Pick video', { index, path: v.path });
          this.loadSingleVideo(this.players[index], v, this.config?.loop, this.config?.mute);
          pickList.style.display = 'none';
        });
        pickList.appendChild(item);
      });
      pickList.style.display = 'block';
    });

    btnMeta.addEventListener('click', async (e) => {
      e.stopPropagation();
      const p = this.players[index];
      if (!p || !p.videoUrl) {
        this.showToast('No video loaded yet');
        return;
      }
      const idMatch = p.videoUrl.match(/id=([^&]+)/);
      if (!idMatch) return;
      const videoId = idMatch[1];
      try {
        const meta = await window.toomanyvids.getVideoMeta(videoId);
        if (meta.error) {
          this.showToast('Meta error: ' + meta.error);
          return;
        }
        const lines = [];
        lines.push(`File: ${meta.path}`);
        if (meta.container) lines.push(`Container: ${meta.container}`);
        if (meta.duration) lines.push(`Duration: ${Math.floor(meta.duration / 60)}:${Math.floor(meta.duration % 60).toString().padStart(2, '0')}`);
        if (meta.size) lines.push(`Size: ${this.formatFileSize(parseInt(meta.size))}`);
        if (meta.bitrate) lines.push(`Bitrate: ${Math.round(parseInt(meta.bitrate) / 1000)} kbps`);
        if (meta.videoCodec) {
          lines.push(`Video: ${meta.videoCodecLong || meta.videoCodec} ${meta.width}x${meta.height} ${meta.fps} ${meta.pixelFormat || ''}`.trim());
          if (meta.profile) lines.push(`Video Profile: ${meta.profile}`);
          if (meta.rotation) lines.push(`Rotation: ${meta.rotation}°`);
        }
        if (meta.audioCodec) {
          lines.push(`Audio: ${meta.audioCodecLong || meta.audioCodec} ${meta.audioSampleRate}Hz ${meta.audioChannels}ch`);
        }
        this.showMeta(lines.join('\n'));
        window.toomanyvids.log('Meta shown', { index, path: meta.path });
      } catch (err) {
        this.showToast('Failed to get metadata');
        window.toomanyvids.warn('Meta failed', { index, error: err.message });
      }
    });

    btnDelete.addEventListener('click', async (e) => {
      e.stopPropagation();
      const p = getPlayer();
      if (!p || !p.videoPath || !p.videoUrl) return;

      const idMatch = p.videoUrl.match(/id=([^&]+)/);
      if (!idMatch) return;

      const deletedPath = p.videoPath;
      const deletedName = deletedPath.split(/[/\\]/).pop();
      const result = await window.toomanyvids.deleteVideo(idMatch[1]);
      if (result.error) {
        this.showToast('Delete failed: ' + result.error);
        return;
      }
      if (!result.deleted) return;

      video.pause();
      video.removeAttribute('src');
      video.load();
      p.videoPath = null;
      p.videoUrl = null;
      this.videoPool = this.videoPool.filter(v => v.path !== deletedPath);

      const next = this.getAvailableVideo(index);
      if (next) {
        this.loadSingleVideo(p, next, this.config?.loop, this.config?.mute);
      } else {
        loading.style.display = 'none';
        titleEl.textContent = 'No videos left';
        titleEl.style.opacity = '1';
      }
      this.showToast('Deleted ' + deletedName);
    });

    const applyRotation = (deg) => {
      const p = getPlayer();
      if (!p) return;
      p.rotation = ((p.rotation + deg) % 360 + 360) % 360;
      this.applyRotationTo(video, p.rotation);
    };

    btnRotateLeft.addEventListener('click', (e) => {
      e.stopPropagation();
      applyRotation(-90);
    });

    btnRotateRight.addEventListener('click', (e) => {
      e.stopPropagation();
      applyRotation(90);
    });

    return cell;
  }

  toggleFullscreen(index) {
    if (this.fullscreenPlayer === index) {
      this.exitFullscreen();
    } else {
      this.enterFullscreen(index);
    }
  }

  enterFullscreen(index) {
    const player = this.players[index];
    if (!player || !player.videoPath) return;

    window.toomanyvids.log('Enter fullscreen', { index, path: player.videoPath });
    this.fullscreenPlayer = index;
    this.gridContainer.style.display = 'none';

    let fullscreenContainer = document.getElementById('fullscreen-container');
    if (!fullscreenContainer) {
      fullscreenContainer = document.createElement('div');
      fullscreenContainer.id = 'fullscreen-container';
      fullscreenContainer.innerHTML = `
        <video playsinline muted preload="metadata"></video>
        <div class="fullscreen-overlay">
          <div class="fullscreen-title"></div>
          <div class="fullscreen-info"></div>
          <div class="fullscreen-seek-container">
            <input type="range" class="fullscreen-seek" min="0" max="100" value="0">
            <span class="fullscreen-time">0:00 / 0:00</span>
          </div>
        </div>
        <div class="fullscreen-hint">Press ESC or double-click to exit</div>
      `;
      this.gridContainer.parentNode.insertBefore(fullscreenContainer, this.gridContainer.nextSibling);

      fullscreenContainer.addEventListener('dblclick', () => this.exitFullscreen());
      fullscreenContainer.addEventListener('mouseenter', () => {
        fullscreenContainer.querySelector('.fullscreen-overlay').classList.add('visible');
      });
      fullscreenContainer.addEventListener('mouseleave', () => {
        fullscreenContainer.querySelector('.fullscreen-overlay').classList.remove('visible');
      });

      const createdVideo = fullscreenContainer.querySelector('video');
      bindSeekControls(
        createdVideo,
        fullscreenContainer.querySelector('.fullscreen-seek'),
        fullscreenContainer.querySelector('.fullscreen-time'),
        (time) => { createdVideo.currentTime = time; }
      );
    }

    const fullscreenVideo = fullscreenContainer.querySelector('video');
    const titleEl = fullscreenContainer.querySelector('.fullscreen-title');
    const infoEl = fullscreenContainer.querySelector('.fullscreen-info');

    const savedTime = player.video.currentTime;
    const savedUrl = (player.usingFallback && player.fallbackUrl) || player.videoUrl || player.video.src;
    player.video.pause();

    fullscreenVideo.muted = this.isMuted;
    fullscreenVideo.loop = this.config?.loop || false;
    titleEl.textContent = player.element.querySelector('.cell-title').textContent;
    infoEl.textContent = player.element.querySelector('.cell-info').textContent;

    fullscreenContainer.style.display = 'flex';
    this.applyRotationTo(fullscreenVideo, player.rotation);

    const tryPlay = () => {
      if (fullscreenVideo.readyState >= 3) {
        fullscreenVideo.currentTime = savedTime;
        fullscreenVideo.play().catch(() => {});
        this.applyRotationTo(fullscreenVideo, player.rotation);
        return true;
      }
      return false;
    };

    fullscreenVideo.oncanplay = () => {
      if (!tryPlay()) return;
      fullscreenVideo.oncanplay = null;
    };

    fullscreenVideo.onerror = () => {
      window.toomanyvids.error('Fullscreen video error', { index, src: savedUrl, readyState: fullscreenVideo.readyState });
      fullscreenVideo.oncanplay = null;
    };

    fullscreenVideo.src = savedUrl;

    if (!tryPlay()) {
      let attempts = 0;
      const poll = setInterval(() => {
        attempts++;
        if (tryPlay() || attempts > 20) {
          clearInterval(poll);
          fullscreenVideo.oncanplay = null;
        }
      }, 250);
    }
  }

  exitFullscreen() {
    if (this.fullscreenPlayer === null) return;

    window.toomanyvids.log('Exit fullscreen', { index: this.fullscreenPlayer });
    const player = this.players[this.fullscreenPlayer];
    const fullscreenContainer = document.getElementById('fullscreen-container');

    if (fullscreenContainer) {
      const fullscreenVideo = fullscreenContainer.querySelector('video');

      if (player) {
        player.video.currentTime = fullscreenVideo.currentTime;
        player.video.play().catch(() => {});
      }

      fullscreenVideo.pause();
      fullscreenVideo.src = '';
      fullscreenVideo.style.transform = '';
      fullscreenContainer.style.display = 'none';
    }

    this.gridContainer.style.display = 'grid';
    if (player) this.applyRotationTo(player.video, player.rotation);
    this.fullscreenPlayer = null;
  }

  clearPlayer(player) {
    const video = player.video;
    clearTimeout(player._blackTimer);
    video.pause();
    video.removeAttribute('src');
    video.load();
    video.style.transform = '';
    player.videoUrl = null;
    player.videoPath = null;
    player.videoExt = null;
    player.fallbackUrl = null;
    player.usingFallback = false;
    player._blackCheckDone = false;
    player._blackAttempts = 0;
    player._blackTimer = null;
    player.videoStarted = false;
    player._startupStallLogged = false;
    player.rotation = 0;
    player.element.classList.add('video-cell-empty');
    player.element.querySelector('.loading').style.display = 'none';
    const titleEl = player.element.querySelector('.cell-title');
    const infoEl = player.element.querySelector('.cell-info');
    titleEl.textContent = '';
    titleEl.title = '';
    infoEl.textContent = '';
    infoEl.title = '';
  }

  loadVideos(videos, loop, mute) {
    // A video may only run in one cell: cells beyond the selected videos stay empty.
    this.players.forEach((player, index) => {
      if (index >= videos.length) this.clearPlayer(player);
    });

    videos.forEach((videoData, index) => {
      setTimeout(() => {
        const player = this.players[index];
        if (player) this.loadSingleVideo(player, videoData, loop, mute);
      }, index * 250);
    });
  }

  formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  resetPlayerState(player) {
    clearTimeout(player._blackTimer);
    player.rotation = 0;
    player.usingFallback = false;
    player._blackCheckDone = false;
    player._blackAttempts = 0;
    player._blackTimer = null;
    player.videoStarted = false;
    player._startupStallLogged = false;
    player._lastStallWarn = 0;
  }

  getActivePaths() {
    return new Set(this.players.map(p => p.videoPath).filter(Boolean));
  }

  getAvailableVideos(excludeIndex) {
    const activePaths = this.getActivePaths();
    const excluded = this.players[excludeIndex]?.videoPath;
    const available = this.videoPool.filter(v => v.path !== excluded && !activePaths.has(v.path));
    if (available.length === 0) {
      return this.videoPool.filter(v => v.path !== excluded);
    }
    return available;
  }

  getAvailableVideo(excludeIndex) {
    const available = this.getAvailableVideos(excludeIndex);
    if (available.length === 0) return null;
    return available[Math.floor(Math.random() * available.length)];
  }

  loadSingleVideo(player, videoData, loop, mute) {
    const video = player.video;
    const cell = player.element;
    const loading = cell.querySelector('.loading');
    const titleEl = cell.querySelector('.cell-title');
    const infoEl = cell.querySelector('.cell-info');

    const { url, fallbackUrl, path: filePath, size, ext, mode } = videoData;
    const title = filePath.split(/[/\\]/).pop().replace(/\.[^/.]+$/, '');
    const sizeStr = this.formatFileSize(size);

    cell.classList.remove('video-cell-empty');
    titleEl.textContent = title;
    titleEl.title = title;
    infoEl.textContent = sizeStr;
    infoEl.title = filePath;
    loading.style.display = 'block';
    titleEl.style.opacity = '0';
    infoEl.style.opacity = '0';

    this.resetPlayerState(player);
    video.style.transform = '';

    player.videoUrl = url;
    player.videoPath = filePath;
    player.videoSize = size;
    player.fallbackUrl = fallbackUrl || null;
    player.videoExt = ext || '';
    player.mode = mode || 'direct';

    video.src = url;
    video.loop = loop;
    video.muted = mute;

    video.play().then(() => {
      window.toomanyvids.debug('Autoplay started', { index: player.index, path: filePath });
    }).catch((err) => {
      window.toomanyvids.warn('Autoplay prevented', { index: player.index, path: filePath, error: err.name });
      loading.style.display = 'none';
      titleEl.textContent = 'Click to play: ' + title;
      titleEl.style.opacity = '1';
      infoEl.style.opacity = '1';

      cell.onclick = () => {
        video.play().catch(() => {});
        cell.onclick = null;
        titleEl.style.opacity = '0';
        infoEl.style.opacity = '0';
      };
    });
  }

  reshuffle() {
    window.toomanyvids.log('Reshuffle triggered');
    window.toomanyvids.reshuffle();
  }

  togglePause() {
    this.isPaused = !this.isPaused;
    window.toomanyvids.log('Toggle pause', { paused: this.isPaused });
    const btn = document.getElementById('btn-pause');

    this.players.forEach(player => {
      if (this.isPaused) {
        player.video.pause();
      } else {
        player.video.play().catch(() => {});
      }
    });

    btn.textContent = this.isPaused ? 'Resume' : 'Pause';
    this.updateStatus();
  }

  toggleMute() {
    this.isMuted = !this.isMuted;
    window.toomanyvids.log('Toggle mute', { muted: this.isMuted });
    const btn = document.getElementById('btn-mute');

    this.players.forEach(player => {
      player.video.muted = this.isMuted;
    });

    btn.textContent = this.isMuted ? 'Unmute' : 'Mute';
  }

  updateStatus() {
    if (!this.config) return;
    const { grid } = this.config;
    const playingCount = this.players.filter(p => !p.video.paused).length;
    this.statusEl.textContent = `${grid.rows}x${grid.cols} | ${playingCount} playing`;
  }

  showMeta(text) {
    this.metaTextEl.textContent = text;
    this.metaModal.classList.add('visible');
  }

  hideMeta() {
    this.metaModal.classList.remove('visible');
  }

  async copyMeta() {
    try {
      await navigator.clipboard.writeText(this.metaTextEl.textContent);
      this.showToast('Metadata copied to clipboard');
    } catch (err) {
      this.showToast('Copy failed: ' + err.message);
    }
  }

  showError(message) {
    window.toomanyvids.error('Error dialog shown', { message });
    this.errorMessage.textContent = message;
    this.errorModal.classList.add('visible');
  }

  showToast(message) {
    let toast = document.getElementById('toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'toast';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('visible');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => {
      toast.classList.remove('visible');
    }, 2500);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.toomanyvids.log('DOMContentLoaded fired');
  try {
    window.gridPlayer = new VideoGridPlayer();
  } catch (err) {
    window.toomanyvids.error('VideoGridPlayer constructor failed', { error: err.message, stack: err.stack });
  }
});

window.addEventListener('error', (event) => {
  try {
    window.toomanyvids.error('Uncaught JS error', { message: event.message, filename: event.filename, lineno: event.lineno, colno: event.colno });
  } catch (_) {}
});

window.addEventListener('unhandledrejection', (event) => {
  try {
    window.toomanyvids.error('Unhandled promise rejection', { reason: String(event.reason) });
  } catch (_) {}
});
