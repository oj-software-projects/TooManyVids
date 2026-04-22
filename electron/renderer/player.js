/**
 * TooManyVids - Video Player Controller
 * Manages the video grid and playback
 */

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

    this.setupEventListeners();
    this.setupIpcListeners();
    window.toomanyvids.log('VideoGridPlayer initialized');
  }

  setupEventListeners() {
    document.addEventListener('keydown', (e) => {
      switch (e.key.toLowerCase()) {
        case 'q':
          if (!this.fullscreenPlayer) window.close();
          break;
        case 'escape':
          if (this.fullscreenPlayer) {
            this.exitFullscreen();
          } else {
            window.close();
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
    this.updateStatus();
  }

  setupIpcListeners() {
    window.toomanyvids.onConfig((config) => {
      window.toomanyvids.log('Config received', { grid: config.grid?.rows + 'x' + config.grid?.cols, videoCount: config.videos?.length, poolCount: config.pool?.length });
      this.videoPool = config.pool || config.videos || [];
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
        transcodeUrl: null,
        usingTranscode: false,
        needsRemux: false,
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
    const loading = cell.querySelector('.loading');
    const cellOverlay = cell.querySelector('.cell-overlay');
    const seekBar = cell.querySelector('.seek-bar');
    const timeDisplay = cell.querySelector('.time-display');
    const titleEl = cell.querySelector('.cell-title');
    const infoEl = cell.querySelector('.cell-info');
    const btnNext = cell.querySelector('.btn-next');
    const btnPick = cell.querySelector('.btn-pick');
    const btnMeta = cell.querySelector('.btn-meta');
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

    video.addEventListener('error', () => {
      loading.style.display = 'none';
      const ext = player.videoExt || '';
      const videoError = video.error;
      const errCode = videoError ? videoError.code : 'unknown';
      const errMsg = videoError ? videoError.message : 'unknown';
      window.toomanyvids.error('Video error', { index, ext, errCode, errMsg, src: player.videoUrl });

      if (player.transcodeUrl && !player.usingTranscode) {
        window.toomanyvids.info('Retrying with transcode', { index, path: player.videoPath });
        player.usingTranscode = true;
        video.src = player.transcodeUrl;
        loading.style.display = 'block';
        video.play().then(() => {
          window.toomanyvids.info('Transcode playback started', { index });
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
      window.toomanyvids.warn('Video stalled', { index, src: player.videoUrl });
      loading.style.display = 'block';
    });

    video.addEventListener('playing', () => {
      loading.style.display = 'none';
    });

    video.addEventListener('ended', () => {
      if (!this.config?.loop) {
        this.playNextVideo(index);
      }
    });

    const seekRemux = (targetTime) => {
      const baseUrl = player.usingTranscode && player.transcodeUrl ? player.transcodeUrl : player.videoUrl;
      const sep = baseUrl.includes('?') ? '&' : '?';
      const wasMuted = video.muted;
      const wasLoop = video.loop;
      video.src = baseUrl + sep + 't=' + Math.floor(targetTime);
      video.muted = wasMuted;
      video.loop = wasLoop;
      video.play().catch(() => {});
    };

    let isSeeking = false;
    let seekTargetTime = null;

    seekBar.addEventListener('pointerdown', (e) => {
      isSeeking = true;
      seekBar.setPointerCapture(e.pointerId);
    });

    seekBar.addEventListener('pointerup', (e) => {
      isSeeking = false;
      seekBar.releasePointerCapture(e.pointerId);
      if (seekTargetTime !== null) {
        loading.style.display = 'block';
        if (player.needsRemux) {
          seekRemux(seekTargetTime);
        } else {
          video.currentTime = seekTargetTime;
        }
        seekTargetTime = null;
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

    seekBar.addEventListener('input', (e) => {
      if (video.duration) {
        seekTargetTime = (e.target.value / 100) * video.duration;
        const currentMins = Math.floor(seekTargetTime / 60);
        const currentSecs = Math.floor(seekTargetTime % 60).toString().padStart(2, '0');
        const totalMins = Math.floor(video.duration / 60);
        const totalSecs = Math.floor(video.duration % 60).toString().padStart(2, '0');
        timeDisplay.textContent = `${currentMins}:${currentSecs} / ${totalMins}:${totalSecs}`;
      }
    });

    video.addEventListener('timeupdate', () => {
      if (!isSeeking && video.duration) {
        const percent = (video.currentTime / video.duration) * 100;
        seekBar.value = percent;
        const currentMins = Math.floor(video.currentTime / 60);
        const currentSecs = Math.floor(video.currentTime % 60).toString().padStart(2, '0');
        const totalMins = Math.floor(video.duration / 60);
        const totalSecs = Math.floor(video.duration % 60).toString().padStart(2, '0');
        timeDisplay.textContent = `${currentMins}:${currentSecs} / ${totalMins}:${totalSecs}`;
      }
    });

    seekBar.addEventListener('click', (e) => {
      e.stopPropagation();
      if (video.duration) {
        const rect = seekBar.getBoundingClientRect();
        const percent = (e.clientX - rect.left) / rect.width;
        loading.style.display = 'block';
        if (player.needsRemux) {
          seekRemux(percent * video.duration);
        } else {
          video.currentTime = percent * video.duration;
        }
      }
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
      if (!p || !p.videoUrl) return;
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
        const text = lines.join('\n');
        await navigator.clipboard.writeText(text);
        this.showToast('Metadata copied to clipboard');
        window.toomanyvids.info('Meta copied', { index, path: meta.path });
      } catch (err) {
        this.showToast('Failed to get metadata');
        window.toomanyvids.error('Meta failed', { index, error: err.message });
      }
    });

    const applyRotation = (deg) => {
      const player = this.players[index];
      if (!player) return;
      player.rotation = ((player.rotation + deg) % 360 + 360) % 360;
      const isVertical = player.rotation === 90 || player.rotation === 270;
      const scale = isVertical ? 'scaleY(0.5625)' : '';
      video.style.transform = `rotate(${player.rotation}deg) ${scale}`;
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
    if (!player) return;

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
    }

    const fullscreenVideo = fullscreenContainer.querySelector('video');
    const titleEl = fullscreenContainer.querySelector('.fullscreen-title');
    const infoEl = fullscreenContainer.querySelector('.fullscreen-info');
    const seekBar = fullscreenContainer.querySelector('.fullscreen-seek');
    const timeDisplay = fullscreenContainer.querySelector('.fullscreen-time');

    let isSeeking = false;
    let seekTarget = null;

    seekBar.onpointerdown = (e) => {
      isSeeking = true;
      seekBar.setPointerCapture(e.pointerId);
    };

    seekBar.onpointerup = (e) => {
      isSeeking = false;
      seekBar.releasePointerCapture(e.pointerId);
      if (seekTarget !== null) {
        fullscreenVideo.currentTime = seekTarget;
        seekTarget = null;
      }
    };

    seekBar.oninput = (e) => {
      if (fullscreenVideo.duration) {
        seekTarget = (e.target.value / 100) * fullscreenVideo.duration;
        const currentMins = Math.floor(seekTarget / 60);
        const currentSecs = Math.floor(seekTarget % 60).toString().padStart(2, '0');
        const totalMins = Math.floor(fullscreenVideo.duration / 60);
        const totalSecs = Math.floor(fullscreenVideo.duration % 60).toString().padStart(2, '0');
        timeDisplay.textContent = `${currentMins}:${currentSecs} / ${totalMins}:${totalSecs}`;
      }
    };

    fullscreenVideo.ontimeupdate = () => {
      if (fullscreenVideo.duration && !isSeeking) {
        const percent = (fullscreenVideo.currentTime / fullscreenVideo.duration) * 100;
        seekBar.value = percent;
        const currentMins = Math.floor(fullscreenVideo.currentTime / 60);
        const currentSecs = Math.floor(fullscreenVideo.currentTime % 60).toString().padStart(2, '0');
        const totalMins = Math.floor(fullscreenVideo.duration / 60);
        const totalSecs = Math.floor(fullscreenVideo.duration % 60).toString().padStart(2, '0');
        timeDisplay.textContent = `${currentMins}:${currentSecs} / ${totalMins}:${totalSecs}`;
      }
    };

    const savedTime = player.video.currentTime;
    const savedUrl = player.videoUrl || player.video.src;
    player.video.pause();

    fullscreenVideo.muted = this.isMuted;
    fullscreenVideo.loop = this.config?.loop || false;
    titleEl.textContent = player.element.querySelector('.cell-title').textContent;
    infoEl.textContent = player.element.querySelector('.cell-info').textContent;

    const isVertical = player.rotation === 90 || player.rotation === 270;
    const scale = isVertical ? 'scaleY(0.5625)' : '';
    fullscreenVideo.style.transform = `rotate(${player.rotation}deg) ${scale}`;

    fullscreenContainer.style.display = 'flex';

    const tryPlay = () => {
      if (fullscreenVideo.readyState >= 3) {
        fullscreenVideo.currentTime = savedTime;
        fullscreenVideo.play().catch(() => {});
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
        const isVertical = player.rotation === 90 || player.rotation === 270;
        const scale = isVertical ? 'scaleY(0.5625)' : '';
        player.video.style.transform = `rotate(${player.rotation}deg) ${scale}`;
      }

      fullscreenVideo.pause();
      fullscreenVideo.src = '';
      fullscreenVideo.style.transform = '';
      fullscreenContainer.style.display = 'none';
    }

    this.gridContainer.style.display = 'grid';
    this.fullscreenPlayer = null;
  }

  loadVideos(videos, loop, mute) {
    const shuffled = this.shuffleArray([...videos]);

    this.players.forEach((player, index) => {
      setTimeout(() => {
        const videoData = shuffled[index % shuffled.length];
        this.loadSingleVideo(player, videoData, loop, mute);
      }, index * 500);
    });
  }

  formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
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

    const { url, path: filePath, size, transcodeUrl, ext, needsRemux } = videoData;
    const title = filePath.split(/[/\\]/).pop().replace(/\.[^/.]+$/, '');
    const sizeStr = this.formatFileSize(size);

    titleEl.textContent = title;
    titleEl.title = title;
    infoEl.textContent = sizeStr;
    infoEl.title = filePath;
    loading.style.display = 'block';
    titleEl.style.opacity = '0';
    infoEl.style.opacity = '0';

    player.rotation = 0;
    player.usingTranscode = false;
    video.style.transform = '';

    player.videoUrl = url;
    player.videoPath = filePath;
    player.videoSize = size;
    player.transcodeUrl = transcodeUrl || null;
    player.videoExt = ext || '';
    player.needsRemux = !!needsRemux;

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

  playNextVideo(index) {
    const player = this.players[index];
    if (player && player.video) {
      player.video.currentTime = 0;
      player.video.play().catch(() => {});
    }
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
    window.player = new VideoGridPlayer();
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
