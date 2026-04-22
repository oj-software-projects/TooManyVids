/**
 * Directory scanner for video files
 * Recursively scans directories and collects video file paths
 */

const fs = require('fs/promises');
const path = require('path');

/**
 * Supported video file extensions
 */
const VIDEO_EXTENSIONS = new Set([
  '.mp4',
  '.mkv',
  '.avi',
  '.mov',
  '.webm',
  '.flv',
  '.wmv',
  '.m4v',
  '.mpg',
  '.mpeg',
  '.3gp',
  '.ogv'
]);

/**
 * Check if a file has a video extension
 * @param {string} filename
 * @returns {boolean}
 */
function isVideoFile(filename) {
  const ext = path.extname(filename).toLowerCase();
  return VIDEO_EXTENSIONS.has(ext);
}

/**
 * Recursively scan a directory for video files
 * @param {string} dirPath - Directory to scan
 * @returns {Promise<string[]>} Array of absolute video file paths
 */
async function scanDirectory(dirPath) {
  const videos = [];

  try {
    const resolvedPath = path.resolve(dirPath);
    const stat = await fs.stat(resolvedPath);

    if (!stat.isDirectory()) {
      return videos;
    }

    const entries = await fs.readdir(resolvedPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(resolvedPath, entry.name);

      if (entry.isDirectory()) {
        // Recursively scan subdirectories
        const subVideos = await scanDirectory(fullPath);
        videos.push(...subVideos);
      } else if (entry.isFile() && isVideoFile(entry.name)) {
        videos.push(fullPath);
      }
    }
  } catch (err) {
    // Silently skip directories we can't access
    if (err.code !== 'ENOENT' && err.code !== 'EACCES') {
      throw err;
    }
  }

  return videos;
}

/**
 * Scan multiple directories for video files
 * @param {string[]} directories - Array of directory paths
 * @returns {Promise<string[]>} Combined array of video file paths
 */
async function scanDirectories(directories) {
  const allVideos = [];

  for (const dir of directories) {
    const videos = await scanDirectory(dir);
    allVideos.push(...videos);
  }

  // Remove duplicates
  return [...new Set(allVideos)];
}

/**
 * Shuffle array using Fisher-Yates algorithm
 * @param {Array} array - Array to shuffle
 * @param {number|null} seed - Optional seed for reproducibility
 * @returns {Array} Shuffled array
 */
function shuffleArray(array, seed = null) {
  const shuffled = [...array];

  // Simple seeded random if seed provided
  let random;
  if (seed !== null) {
    let s = seed;
    random = () => {
      s = (s * 1664525 + 1013904223) & 0xffffffff;
      return (s >>> 0) / 0xffffffff;
    };
  } else {
    random = Math.random;
  }

  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  return shuffled;
}

/**
 * Select N videos from the pool
 * @param {string[]} videos - Pool of video paths
 * @param {number} count - Number of videos to select
 * @param {boolean} shuffle - Whether to shuffle
 * @param {number|null} seed - Random seed
 * @returns {string[]} Selected videos (may repeat if pool is smaller than count)
 */
function selectVideos(videos, count, shuffle = true, seed = null) {
  if (videos.length === 0) {
    return [];
  }

  let pool = shuffle ? shuffleArray(videos, seed) : [...videos];
  const selected = [];

  for (let i = 0; i < count; i++) {
    selected.push(pool[i % pool.length]);
  }

  return selected;
}

module.exports = {
  scanDirectories,
  scanDirectory,
  isVideoFile,
  VIDEO_EXTENSIONS,
  shuffleArray,
  selectVideos
};
