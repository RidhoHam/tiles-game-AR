/**
 * Audio Cache Manager
 *
 * Provides persistent caching of downloaded audio sample buffers using the
 * browser's CacheStorage API, with in-memory fallback for Node.js / SSR.
 */

export class AudioCacheManager {
  constructor(options = {}) {
    this.cacheName = options.cacheName || 'strudel-piano-cache-v1';
    this.memoryFallback = new Map();
  }

  /**
   * Attempts to retrieve cached ArrayBuffer by URL
   * @param {string} url
   * @returns {Promise<ArrayBuffer|null>}
   */
  async get(url) {
    if (typeof window !== 'undefined' && 'caches' in window) {
      try {
        const cache = await caches.open(this.cacheName);
        const response = await cache.match(url);
        if (response) {
          return await response.arrayBuffer();
        }
      } catch (_) {
        // Fallback to memory on CacheStorage error (e.g. storage quota, private browsing)
      }
    }
    const mem = this.memoryFallback.get(url);
    if (mem) {
      return mem.slice(0);
    }
    return null;
  }

  /**
   * Stores an ArrayBuffer into persistent cache
   * @param {string} url
   * @param {ArrayBuffer} arrayBuffer
   * @returns {Promise<void>}
   */
  async put(url, arrayBuffer) {
    if (!arrayBuffer) return;

    if (typeof window !== 'undefined' && 'caches' in window) {
      try {
        const cache = await caches.open(this.cacheName);
        const response = new Response(arrayBuffer.slice(0), {
          headers: {
            'Content-Type': 'audio/mpeg',
            'Content-Length': String(arrayBuffer.byteLength)
          }
        });
        await cache.put(url, response);
        return;
      } catch (_) {
        // Fallback to memory
      }
    }
    this.memoryFallback.set(url, arrayBuffer.slice(0));
  }

  /**
   * Checks if CacheStorage API is available
   * @returns {boolean}
   */
  isPersistentSupported() {
    return typeof window !== 'undefined' && 'caches' in window;
  }
}
