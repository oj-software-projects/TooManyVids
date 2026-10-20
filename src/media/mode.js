/**
 * How a video file reaches the browser:
 * - direct:  stream the file with HTTP range support
 * - remux:   ffmpeg stream copy into fragmented mp4 (no re-encode)
 * - transcode: ffmpeg re-encode to H.264/AAC (expensive, queued)
 */

const REMUX_EXTENSIONS = new Set(['.mkv', '.avi', '.flv', '.wmv', '.3gp']);
const TRANSCODE_EXTENSIONS = new Set(['.mpg', '.mpeg']);

// Containers that Chrome can sometimes play directly but may need a re-encode.
const TRANSCODE_FALLBACK_EXTENSIONS = new Set([
  '.mov', '.m4v', '.mkv', '.avi', '.flv', '.wmv', '.mpg', '.mpeg', '.3gp', '.ogv'
]);

function modeForExtension(ext) {
  if (TRANSCODE_EXTENSIONS.has(ext)) return 'transcode';
  if (REMUX_EXTENSIONS.has(ext)) return 'remux';
  return 'direct';
}

function pickMode(ext, ffmpegAvailable) {
  return ffmpegAvailable ? modeForExtension(ext) : 'direct';
}

module.exports = {
  REMUX_EXTENSIONS,
  TRANSCODE_EXTENSIONS,
  TRANSCODE_FALLBACK_EXTENSIONS,
  modeForExtension,
  pickMode
};
