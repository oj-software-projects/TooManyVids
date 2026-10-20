'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { DEFAULT_CONFIG, mergeConfig, sanitizeSettings } = require('../src/config/config');

test('CLI layer overrides saved values, unset keys keep saved values', () => {
  const saved = { dirs: ['/a'], grid: { rows: 3, cols: 3 }, shuffle: false, loop: true, mute: false };
  const cli = { dirs: ['/b'], mute: true };
  assert.deepStrictEqual(mergeConfig(DEFAULT_CONFIG, saved, cli), {
    dirs: ['/b'],
    grid: { rows: 3, cols: 3 },
    shuffle: false,
    loop: true,
    mute: true
  });
});

test('sanitize clamps grid, drops invalid dirs, dedupes paths', () => {
  const cfg = sanitizeSettings({
    dirs: ['/a', '/a', '  ', 42, ' /b '],
    grid: { rows: 0, cols: 99 },
    shuffle: 'yes'
  });
  assert.deepStrictEqual(cfg.dirs, ['/a', '/b']);
  assert.deepStrictEqual(cfg.grid, { rows: 1, cols: 8 });
  assert.strictEqual(cfg.shuffle, true);
});

test('sanitize falls back to defaults on empty input', () => {
  assert.deepStrictEqual(sanitizeSettings(undefined), { ...DEFAULT_CONFIG, grid: { ...DEFAULT_CONFIG.grid } });
});
