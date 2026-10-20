'use strict';

const fs = require('fs');
const path = require('path');
const { getLogger } = require('../logger');

const log = getLogger('config');

const MAX_GRID = 8;
const DEFAULT_GRID = { rows: 2, cols: 2 };
const DEFAULT_CONFIG = { dirs: [], grid: DEFAULT_GRID, shuffle: true, loop: false, mute: true };

function clampInt(value, fallback) {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(MAX_GRID, Math.max(1, n));
}

/** Overlay only the keys a layer actually defines (CLI > saved > defaults). */
function mergeConfig(...layers) {
  const out = { dirs: [], grid: { ...DEFAULT_GRID }, shuffle: true, loop: false, mute: true };
  for (const layer of layers) {
    if (!layer) continue;
    if (Array.isArray(layer.dirs)) out.dirs = layer.dirs.slice();
    if (layer.grid) {
      out.grid = {
        rows: clampInt(layer.grid.rows, out.grid.rows),
        cols: clampInt(layer.grid.cols, out.grid.cols)
      };
    }
    for (const key of ['shuffle', 'loop', 'mute']) {
      if (typeof layer[key] === 'boolean') out[key] = layer[key];
    }
  }
  return out;
}

function sanitizeSettings(raw) {
  const cfg = mergeConfig(raw);
  cfg.dirs = [...new Set(cfg.dirs.filter(d => typeof d === 'string' && d.trim()).map(d => d.trim()))];
  return cfg;
}

function readConfig(file) {
  try {
    return sanitizeSettings(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch (err) {
    if (err.code !== 'ENOENT') log.warn('Cannot read config', { file, error: err.message });
    return null;
  }
}

function writeConfig(file, cfg) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(sanitizeSettings(cfg), null, 2));
    return true;
  } catch (err) {
    log.warn('Cannot write config', { file, error: err.message });
    return false;
  }
}

module.exports = {
  MAX_GRID,
  DEFAULT_GRID,
  DEFAULT_CONFIG,
  mergeConfig,
  sanitizeSettings,
  readConfig,
  writeConfig
};
