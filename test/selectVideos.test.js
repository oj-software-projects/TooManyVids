'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { selectVideos } = require('../src/files/scanDirectories');

const pool = Array.from({ length: 7 }, (_, i) => `/v/video-${i}.mp4`);

test('never repeats a video when the grid has more cells than videos', () => {
  const picked = selectVideos(pool, 16, true);
  assert.strictEqual(picked.length, 7);
  assert.strictEqual(new Set(picked).size, 7);
});

test('preserves order and takes the first videos without shuffle', () => {
  assert.deepStrictEqual(selectVideos(pool, 4, false), pool.slice(0, 4));
});

test('empty pool yields an empty grid selection', () => {
  assert.deepStrictEqual(selectVideos([], 16, true), []);
});