/**
 * TooManyVids - Video Player Controller
 * Manages the video grid and playback
 */

class VideoGridPlayer {
  constructor() {
    this.gridContainer = document.getElementById('grid-container');
    this.statusEl = document.getElementById('status');
    this.shortcutsEl = document.getElementById('shortcuts');
    this.errorModal = document.getElementById('error-modal');
    this.errorMessage = document.getElementById('error-message');

    this.players = [];
    this.config = null;
    this.isPaused = false;
    this.isMuted = true;

    this.setupEventListeners();
    this.setupIpcListeners();
  }

  setupEventListeners() {
    document.addEventListener('keydown', (e) => {
      switch (e.key.toLowerCase()) {
        case 'q':
        case 'escape':
          window.close();
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
        index: i
      });
    }

    this.loadVideos(videos, loop, mute);
  }

  createVideoCell(index) {
    const cell = document.createElement('div');
    cell.className = 'video-cell';
    cell.innerHTML = `
      <video playsinline autoplay muted></video>
      <div class="loading">Loading...</div>
      <div class="overlay"></div>
    `;

    const video = cell.querySelector('video');
    const loading = cell.querySelector('.loading');
    const overlay = cell.querySelector('.overlay');

    video.addEventListener('loadeddata', () => {
      loading.style.display = 'none';
      this.updateStatus();
    });

    video.addEventListener('canplay', () => {
      loading.style.display = 'none';
    });

    video.addEventListener('error', () => {
      loading.style.display = 'none';
      overlay.textContent = 'Error loading video';
      overlay.style.opacity = '1';
    });

    video.addEventListener('ended', () => {
      if (!this.config?.loop) {
        this.playNextVideo(index);
      }
    });

    return cell;
  }

  loadVideos(videos, loop, mute) {
    this.players.forEach((player, index) => {
      const video = player.video;
      const cell = player.element;
      const overlay = cell.querySelector('.overlay');
      const loading = cell.querySelector('.loading');

      const videoUrl = videos[index % videos.length];
      const filename = decodeURIComponent(videoUrl.split('/').pop().split('?')[0]);

      overlay.textContent = filename;
      loading.style.display = 'block';
      overlay.style.opacity = '0';

      video.pause();
      video.removeAttribute('src');
      video.load();

      video.src = videoUrl;
      video.loop = loop;
      video.muted = mute;

      video.play().catch(err => {
        loading.style.display = 'none';
        overlay.textContent = 'Click to play';
        overlay.style.opacity = '1';
        
        cell.onclick = () => {
          video.play().catch(() => {});
          cell.onclick = null;
        };
      });
    });

    this.updateStatus();
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
