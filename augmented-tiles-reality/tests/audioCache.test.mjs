import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AudioCacheManager } from '../src/core/audio/audioCache.js';

test('AudioCacheManager instantiates and provides safe fallback when CacheStorage unavailable', async () => {
  const cache = new AudioCacheManager({ cacheName: 'test-audio-cache' });
  assert.ok(cache, 'Cache instance created');

  // In Node environment without window.caches, it should fallback to memory cache gracefully
  const testBuffer = new Uint8Array([1, 2, 3, 4]).buffer;
  await cache.put('https://example.com/test.mp3', testBuffer);
  const retrieved = await cache.get('https://example.com/test.mp3');
  assert.ok(retrieved, 'Buffer retrieved from fallback cache');
  assert.equal(retrieved.byteLength, 4);
});
