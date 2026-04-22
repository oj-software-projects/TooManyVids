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

    this.gridContainer = document.getElementById('grid-container');
    this.statusEl = document.getElementById('status');
    this.shortcutsEl = document.getElementById('shortcuts');
    this.errorMessage = document.getElementById('error-message');
    this.errorModal = document.getElementById('error-modal');

    this.setupEventListeners();
    this.setupIpcListeners();
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
      this.initializeGrid(config);
    });

    window.toomanyvids.onReshuffle((data) => {
      this.loadVideos(data.videos, data.loop, data.mute);
    });

    window.toomanyvids.onError((message) => {
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
        videoUrl: null
      });
    }

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
        <div class="seek-bar-container">
          <input type="range" class="seek-bar" min="0" max="100" value="0">
          <span class="time-display">0:00 / 0:00</span>
        </div>
      </div>
    `;

    const video = cell.querySelector('video');
    const loading = cell.querySelector('.loading');
    const cellOverlay = cell.querySelector('.cell-overlay');
    const seekBar = cell.querySelector('.seek-bar');
    const timeDisplay = cell.querySelector('.time-display');
    const titleEl = cell.querySelector('.cell-title');
    const infoEl = cell.querySelector('.cell-info');

    video.addEventListener('loadeddata', () => {
      loading.style.display = 'none';
      this.updateStatus();
    });

    video.addEventListener('canplay', () => {
      loading.style.display = 'none';
    });

    video.addEventListener('error', () => {
      loading.style.display = 'none';
      const title = titleEl.textContent || 'Video';
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

    video.addEventListener('ended', () => {
      if (!this.config?.loop) {
        this.playNextVideo(index);
      }
    });

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
        video.currentTime = seekTargetTime;
        seekTargetTime = null;
      }
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
        video.currentTime = percent * video.duration;
      }
    });

    cell.addEventListener('dblclick', (e) => {
      e.preventDefault();
      this.toggleFullscreen(index);
    });

    cell.addEventListener('mouseenter', () => {
      cellOverlay.classList.add('visible');
    });

    cell.addEventListener('mouseleave', () => {
      cellOverlay.classList.remove('visible');
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

    this.fullscreenPlayer = index;
    this.gridContainer.style.display = 'none';

    let fullscreenContainer = document.getElementById('fullscreen-container');
    if (!fullscreenContainer) {
      fullscreenContainer = document.createElement('div');
      fullscreenContainer.id = 'fullscreen-container';
      fullscreenContainer.innerHTML = `
        <video playsinline autoplay muted></video>
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

    fullscreenVideo.src = player.video.src;
    fullscreenVideo.muted = this.isMuted;
    fullscreenVideo.loop = this.config?.loop || false;
    fullscreenVideo.currentTime = player.video.currentTime;
    titleEl.textContent = player.element.querySelector('.cell-title').textContent;
    infoEl.textContent = player.element.querySelector('.cell-info').textContent;

    fullscreenVideo.play().catch(() => {});
    fullscreenContainer.style.display = 'flex';

    player.video.pause();
  }

  exitFullscreen() {
    if (this.fullscreenPlayer === null) return;

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
      }, index * 100);
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

  loadSingleVideo(player, videoData, loop, mute) {
    const video = player.video;
    const cell = player.element;
    const loading = cell.querySelector('.loading');
    const titleEl = cell.querySelector('.cell-title');
    const infoEl = cell.querySelector('.cell-info');

    const { url, path: filePath, size } = videoData;
    const filename = decodeURIComponent(url.split('/').pop().split('?')[0]);
    const title = filename.replace(/\.[^/.]+$/, '');
    const sizeStr = this.formatFileSize(size);

    titleEl.textContent = title;
    infoEl.textContent = `${filePath} • ${sizeStr}`;
    loading.style.display = 'block';
    titleEl.style.opacity = '0';
    infoEl.style.opacity = '0';

    video.src = url;
    video.loop = loop;
    video.muted = mute;
    player.videoUrl = url;
    player.videoPath = filePath;
    player.videoSize = size;

    video.play().then(() => {
    }).catch(() => {
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
    window.toomanyvids.reshuffle();
  }

  togglePause() {
    this.isPaused = !this.isPaused;
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
    this.errorMessage.textContent = message;
    this.errorModal.classList.add('visible');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.player = new VideoGridPlayer();
});
