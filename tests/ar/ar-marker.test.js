import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { encode } from '@msgpack/msgpack';
import { CardTrackingController } from '../../src/ar/ar-marker.js';
import { CARD_TARGETS, TARGET_FILE, TARGET_FILES } from '../../src/ar/card-targets.js';

// ---------------------------------------------------------------------------
// A Node-only browser shim. Every test installs what it needs and removes it in
// a finally block, so nothing leaks into the other test files. Nothing here
// needs a real DOM or a real camera: getUserMedia is injected through the
// controller's `media` option and MindAR/THREE are faked.
// ---------------------------------------------------------------------------

async function withGlobals(values, run) {
  const previous = new Map();
  for (const key of Object.keys(values)) previous.set(key, globalThis[key]);
  for (const [key, value] of Object.entries(values)) {
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
  try {
    return await run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete globalThis[key];
      else Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
    }
  }
}

function fakeVideo() {
  return { srcObject: null, pause() {}, play() { return Promise.resolve(); } };
}

function fakeContainer() {
  return { children: [], appendChild() {} };
}

function makeSink() {
  const state = { cards: [], errors: [] };
  return {
    state,
    onCards: list => state.cards.push(list.map(card => card.cardId)),
    onError: error => state.errors.push(error)
  };
}

function liveTrack() {
  return { kind: 'video', readyState: 'live', stopped: 0, stop() { this.stopped += 1; } };
}

function fakeStream(track) {
  return { getTracks: () => [track], getVideoTracks: () => [track] };
}

// A MindARThree-alike whose start() resolves and whose anchors are empty. It
// records the stream it was handed, mirroring the real runtime signature.
function fakeMindARClass({ anchors = [] } = {}) {
  const instances = [];
  class FakeMindARThree {
    constructor(options) {
      this.options = options;
      this.anchors = anchors;
      this.startedWith = undefined;
      this.stopCalls = 0;
      this.video = { srcObject: null };
      this.scene = {};
      this.camera = {};
      this.renderer = { render() {} };
      instances.push(this);
    }
    async start(stream) {
      this.startedWith = stream;
      this.video.srcObject = stream;
      if (this.options) {
        assert.equal(typeof this.options.imageTargetSrc, 'string');
        const response = await fetch(this.options.imageTargetSrc);
        this.imageTarget = await response.arrayBuffer();
      }
      return this;
    }
    stop() { this.stopCalls += 1; }
    resize() {}
  }
  return { FakeMindARThree, instances };
}

const BROWSER_GLOBALS = () => ({
  document: { createElement: () => fakeVideo() },
  THREE: {},
  // A benign navigator so isSupported() is meaningful; the media option still wins.
  navigator: { mediaDevices: {} }
});

// ---------------------------------------------------------------------------
// C1 - camera permission denied is explicit, reported once, and rethrown
// ---------------------------------------------------------------------------

test('start() rejects with one specific Indonesian error when camera permission is denied', async () => {
  const { state, onCards, onError } = makeSink();
  const gotUserMedia = [];
  const media = {
    getUserMedia: () => {
      gotUserMedia.push(1);
      return Promise.reject(new Error('NotAllowedError: Permission denied'));
    }
  };
  const controller = new CardTrackingController({ container: fakeContainer(), onCards, onError, media });

  await withGlobals(BROWSER_GLOBALS(), async () => {
    await assert.rejects(() => controller.start(), error => {
      assert.ok(error instanceof Error);
      // The message must be about ACCESS, not about a missing browser/package.
      assert.match(error.message, /Akses kamera ditolak/i);
      assert.match(error.message, /izin/i);
      assert.match(error.message, /Chrome/i);
      assert.doesNotMatch(error.message, /browser|MindAR/i);
      return true;
    });
  });

  assert.equal(state.errors.length, 1, 'onError must be called exactly once');
  assert.equal(state.errors[0].message, controller.lastError?.message);
  assert.equal(controller.started, false);
  assert.equal(gotUserMedia.length, 1, 'getUserMedia must be called exactly once (no second prompt)');
  assert.deepEqual(state.cards, [], 'onCards must not report cards on failure');
});

test('start() does not call MindAR at all when the camera is denied', async () => {
  const { onCards, onError } = makeSink();
  const { FakeMindARThree, instances } = fakeMindARClass();
  // Make the (dynamic) runtime import resolve to our fake.
  const previousMindar = globalThis.MINDAR;
  Object.defineProperty(globalThis, 'MINDAR', {
    value: { IMAGE: { MindARThree: FakeMindARThree } }, configurable: true, writable: true
  });
  const controller = new CardTrackingController({
    container: fakeContainer(),
    onCards,
    onError,
    media: { getUserMedia: () => Promise.reject(new Error('denied')) }
  });

  try {
    await withGlobals(BROWSER_GLOBALS(), async () => {
      await assert.rejects(() => controller.start(), /Akses kamera ditolak/i);
    });
  } finally {
    if (previousMindar === undefined) delete globalThis.MINDAR;
    else Object.defineProperty(globalThis, 'MINDAR', { value: previousMindar, configurable: true, writable: true });
  }

  assert.equal(instances.length, 0, 'MindAR must never be constructed after a denied camera');
  assert.equal(onCards && 1, 1);
});

test('start() fails when the acquired stream has no live video track', async () => {
  const { state, onCards, onError } = makeSink();
  const controller = new CardTrackingController({
    container: fakeContainer(),
    onCards,
    onError,
    media: { getUserMedia: () => Promise.resolve({ getTracks: () => [], getVideoTracks: () => [] }) }
  });

  await withGlobals(BROWSER_GLOBALS(), async () => {
    await assert.rejects(() => controller.start(), /tidak mengirim gambar video/i);
  });
  assert.equal(state.errors.length, 1);
});

// ---------------------------------------------------------------------------
// Missing target file (404) and missing MindAR package
// ---------------------------------------------------------------------------

test('target file 404 produces a message naming the MindAR web compiler', async () => {
  const { state, onCards, onError } = makeSink();
  const track = liveTrack();
  const controller = new CardTrackingController({
    container: fakeContainer(),
    onCards,
    onError,
    media: { getUserMedia: () => Promise.resolve(fakeStream(track)) }
  });
  const previousFetch = globalThis.fetch;
  Object.defineProperty(globalThis, 'fetch', {
    value: async () => ({ ok: false, status: 404 }), configurable: true, writable: true
  });
  // The camera is acquired before MindAR is loaded, so stub the runtime loader
  // to reach the target-fetch step that is under test here.
  const { FakeMindARThree } = fakeMindARClass();
  controller._loadRuntime = async () => FakeMindARThree;

  try {
    await withGlobals(BROWSER_GLOBALS(), async () => {
      await assert.rejects(() => controller.start(), error => {
        assert.match(error.message, new RegExp(`Berkas target '${TARGET_FILE}' tidak ditemukan`));
        assert.match(error.message, /HTTP 404/);
        assert.match(error.message, /Image Target Compiler/i);
        assert.match(error.message, /hiukim\.github\.io\/mind-ar-js-doc\/tools\/compile/);
        assert.match(error.message, /public\/cards\/README\.md/);
        return true;
      });
    });
  } finally {
    if (previousFetch === undefined) delete globalThis.fetch;
    else Object.defineProperty(globalThis, 'fetch', { value: previousFetch, configurable: true, writable: true });
  }

  assert.equal(state.errors.length, 1);
  assert.equal(track.stopped, 1, 'the camera must be released after the 404 failure');
});

test('a missing MindAR package produces a message naming the install command', async () => {
  const { state, onCards, onError } = makeSink();
  const track = liveTrack();
  const controller = new CardTrackingController({
    container: fakeContainer(),
    onCards,
    onError,
    media: { getUserMedia: () => Promise.resolve(fakeStream(track)) }
  });
  // Force the dynamic import to fail the way Node does for an uninstalled package.
  const originalImport = controller._loadRuntime.bind(controller);
  controller._loadRuntime = async () => {
    const error = new Error("Cannot find package 'mind-ar'");
    error.code = 'ERR_MODULE_NOT_FOUND';
    // Route through the real classifier + message, without a real dynamic import.
    if (controller._looksLikeMissingPackage(error)) {
      throw new Error(`Paket MindAR belum terpasang. Jalankan 'npm install mind-ar@1.2.5' lalu muat ulang halaman (lihat public/cards/README.md).`);
    }
    return originalImport();
  };

  await withGlobals(BROWSER_GLOBALS(), async () => {
    await assert.rejects(() => controller.start(), error => {
      assert.match(error.message, /Paket MindAR belum terpasang/);
      assert.match(error.message, /npm install mind-ar@1\.2\.5/);
      return true;
    });
  });

  assert.equal(state.errors.length, 1);
  assert.equal(track.stopped, 1);
});

test('the missing-package classifier recognises the Node resolution error', () => {
  const controller = new CardTrackingController({ container: null });
  assert.equal(controller._looksLikeMissingPackage(new Error("Cannot find package 'mind-ar'")), true);
  assert.equal(controller._looksLikeMissingPackage(new Error('ERR_MODULE_NOT_FOUND')), true);
  assert.equal(controller._looksLikeMissingPackage(new Error('boom')), false);
});

// ---------------------------------------------------------------------------
// I3 / untested failure paths - stop(), dispose() and camera release
// ---------------------------------------------------------------------------

test('stop() after a successful start releases the camera track', async () => {
  const { state, onCards, onError } = makeSink();
  const track = liveTrack();
  const stream = fakeStream(track);
  const controller = new CardTrackingController({
    container: fakeContainer(),
    onCards,
    onError,
    media: { getUserMedia: () => Promise.resolve(stream) }
  });

  await withGlobals(BROWSER_GLOBALS(), async () => {
    const { FakeMindARThree, instances } = fakeMindARClass();
    controller.mindar = new FakeMindARThree();
    controller._loadRuntime = async () => FakeMindARThree;
    await controller.start();
    assert.equal(controller.started, true);
    assert.equal(instances[0].startedWith, stream, 'MindAR must receive the stream we acquired');

    controller.stop();
    assert.equal(track.stopped, 1, 'stop() must stop the camera track');
    assert.equal(controller.started, false);
    assert.equal(controller.cards.size, 0);
  });
  assert.equal(state.errors.length, 0);
});

test('dispose() calls MindAR stop(), releases the camera and removes its nodes', async () => {
  const { onCards, onError } = makeSink();
  const track = liveTrack();
  const removed = [];
  const node = { parentNode: { removeChild(child) { removed.push(child); } } };
  const container = fakeContainer();
  container.children = [node];
  const controller = new CardTrackingController({
    container,
    onCards,
    onError,
    media: { getUserMedia: () => Promise.resolve(fakeStream(track)) }
  });

  const previousFetch = globalThis.fetch;
  Object.defineProperty(globalThis, 'fetch', {
    value: async () => new Response(await readFile(new URL('../../public/cards/targets.mind', import.meta.url))), configurable: true, writable: true
  });
  try {
    await withGlobals(BROWSER_GLOBALS(), async () => {
      const { FakeMindARThree, instances } = fakeMindARClass();
      // Let start() construct MindAR itself so it also captures the container nodes.
      controller._loadRuntime = async () => FakeMindARThree;
      await controller.start();
      assert.deepEqual(controller.createdNodes, [node], 'start() must record the nodes MindAR created');

      controller.dispose();
      assert.equal(instances[0].stopCalls, 1, 'dispose() must call MindAR stop()');
      assert.equal(track.stopped, 1, 'dispose() must release the camera track');
      assert.deepEqual(removed, [node], 'dispose() must remove container nodes MindAR created');
      assert.equal(controller.mindar, null);
    });
  } finally {
    if (previousFetch === undefined) delete globalThis.fetch;
    else Object.defineProperty(globalThis, 'fetch', { value: previousFetch, configurable: true, writable: true });
  }
});

test('stop() and dispose() are idempotent and safe without start()', async () => {
  const controller = new CardTrackingController({ container: fakeContainer() });
  assert.doesNotThrow(() => controller.stop());
  assert.doesNotThrow(() => controller.stop());
  assert.doesNotThrow(() => controller.dispose());
  assert.doesNotThrow(() => controller.dispose());

  const track = liveTrack();
  const started = new CardTrackingController({
    container: fakeContainer(),
    media: { getUserMedia: () => Promise.resolve(fakeStream(track)) }
  });
  await withGlobals(BROWSER_GLOBALS(), async () => {
    const { FakeMindARThree } = fakeMindARClass();
    started.mindar = new FakeMindARThree();
    started._loadRuntime = async () => FakeMindARThree;
    await started.start();
    started.stop();
    started.stop();
    started.dispose();
    started.dispose();
    assert.equal(track.stopped, 1, 'the track must be stopped exactly once');
  });
});

test('_releaseCamera never throws without a DOM (C2: cleanup must not mask errors)', () => {
  const controller = new CardTrackingController({ container: fakeContainer() });
  const track = liveTrack();
  controller.stream = fakeStream(track);
  controller.video = { pause() { throw new Error('detached'); }, get srcObject() { throw new Error('gone'); } };
  // No document global at all here.
  assert.equal(typeof globalThis.document, 'undefined');
  assert.doesNotThrow(() => controller.dispose());
  assert.equal(track.stopped, 1);
});

test('production adopts MindAR camera without pre-acquisition and stops all reachable streams once', async () => {
  const controller = new CardTrackingController({ container: fakeContainer() });
  controller._assertEnvironment = async () => {};
  controller._acquireCamera = () => { throw new Error('second acquisition'); };
  const first = liveTrack();
  const second = liveTrack();
  const third = liveTrack();
  const runtimeStream = fakeStream(second);
  let acquisitions = 0;
  let stops = 0;
  const runtime = {
    video: fakeVideo(),
    async start() { acquisitions++; this.video.srcObject = runtimeStream; },
    stop() {
      stops++;
      for (const track of this.video.srcObject?.getTracks() ?? []) track.stop();
    }
  };
  controller.mindar = runtime;
  await controller.start();
  assert.equal(controller.stream, runtimeStream);
  assert.equal(acquisitions, 1);
  controller.stream = fakeStream(first);
  controller.video = { srcObject: { getTracks: () => [third, second] } };
  controller.dispose();
  controller.stop();
  controller.dispose();
  assert.deepEqual([first.stopped, second.stopped, third.stopped], [1, 1, 1]);
  assert.equal(runtime.video.srcObject, null);
  assert.equal(stops, 1);
});

test('swallowed MindAR camera denial rejects start and reports onError once', async () => {
  const errors = [];
  const controller = new CardTrackingController({ onError: error => errors.push(error) });
  controller._assertEnvironment = async () => {};
  controller.mindar = { video: fakeVideo(), async start() {}, stop() {} };
  await assert.rejects(controller.start(), /Akses kamera ditolak/i);
  assert.equal(errors.length, 1);
  assert.equal(controller.started, false);
});

test('MindAR replacement stream is adopted and both streams are released once', async () => {
  const suppliedTrack = liveTrack();
  const runtimeTrack = liveTrack();
  const runtimeStream = fakeStream(runtimeTrack);
  const controller = new CardTrackingController({
    media: { getUserMedia: async () => fakeStream(suppliedTrack) }
  });
  controller._assertEnvironment = async () => {};
  let stops = 0;
  controller.mindar = {
    video: fakeVideo(),
    async start() { this.video.srcObject = runtimeStream; },
    stop() { stops++; }
  };
  await controller.start();
  assert.equal(controller.stream, runtimeStream);
  assert.equal(suppliedTrack.stopped, 1);
  controller.dispose();
  controller.dispose();
  assert.equal(runtimeTrack.stopped, 1);
  assert.equal(suppliedTrack.stopped, 1);
  assert.equal(stops, 1);
});

test('MindAR rejection without an error still reports a camera failure', async () => {
  const errors = [];
  const controller = new CardTrackingController({ onError: error => errors.push(error) });
  controller._assertEnvironment = async () => {};
  controller.mindar = { video: fakeVideo(), start: () => Promise.reject(), stop() {} };
  await assert.rejects(controller.start(), /Akses kamera ditolak/i);
  assert.equal(errors.length, 1);
});

// ---------------------------------------------------------------------------
// I5 - the card map is driven by _readAnchors(), not the render loop
// ---------------------------------------------------------------------------

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

for (const action of ['stop', 'dispose']) {
  for (const outcome of ['resolve', 'reject']) {
    test(`${action} during pending MindAR start cleans late streams on ${outcome}`, async () => {
      const entered = deferred();
      const pending = deferred();
      const tracks = Array.from({ length: 5 }, liveTrack);
      const errors = [];
      const controller = new CardTrackingController({ onError: error => errors.push(error) });
      controller._assertEnvironment = async () => {};
      let stops = 0;
      let disposals = 0;
      const runtime = {
        video: fakeVideo(),
        async start() {
          this.video.srcObject = fakeStream(tracks[0]);
          entered.resolve();
          try { await pending.promise; } finally {
            this.video.srcObject = fakeStream(tracks[1]);
            this.stream = fakeStream(tracks[2]);
            this.controller = {
              stream: fakeStream(tracks[3]),
              video: { srcObject: fakeStream(tracks[4]) },
              dispose() { disposals++; }
            };
          }
        },
        stop() {
          stops++;
          for (const track of this.video.srcObject?.getTracks() ?? []) track.stop();
        }
      };
      controller.mindar = runtime;
      const starting = controller.start();
      const rejected = assert.rejects(starting, { name: 'AbortError' });
      await entered.promise;
      controller[action]();
      controller[action]();
      assert.equal(tracks[0].stopped, 1, 'existing stream released immediately');
      if (outcome === 'resolve') pending.resolve();
      else pending.reject(new Error('late runtime failure'));
      await rejected;
      controller[action]();
      assert.deepEqual(tracks.map(track => track.stopped), [1, 1, 1, 1, 1]);
      assert.equal(stops, 1);
      assert.equal(runtime.video.srcObject, null);
      assert.equal(runtime.controller.video.srcObject, null);
      assert.equal(controller.started, false);
      assert.equal(controller.running, false);
      assert.equal(controller.loading, false);
      assert.deepEqual(errors, [], 'cancellation is not a camera/target failure');
      assert.equal(disposals, action === 'dispose' ? 1 : 0);
    });
  }
}

test('production constructor receives TARGET_FILE string after validating actual target bytes', async () => {
  const bytes = await readFile(new URL('../../public/cards/targets.mind', import.meta.url));
  const requests = [];
  const controller = new CardTrackingController();
  controller._assertEnvironment = async () => {};
  const track = liveTrack();
  let options;
  controller._loadRuntime = async () => class {
    constructor(value) { options = value; this.video = fakeVideo(); }
    async start() {
      const response = await fetch(options.imageTargetSrc);
      assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new Uint8Array(bytes));
      this.video.srcObject = fakeStream(track);
    }
    stop() {}
  };
  await withGlobals({ fetch: async url => {
    requests.push(url);
    return new Response(bytes);
  } }, async () => {
    await controller.start();
    assert.equal(typeof options.imageTargetSrc, 'string');
    assert.equal(options.imageTargetSrc, TARGET_FILE);
    assert.deepEqual(requests, [TARGET_FILE, TARGET_FILE]);
    controller.dispose();
  });
  assert.equal(track.stopped, 1);
});

for (const [label, bytes] of [
  ['empty', new Uint8Array()],
  ['HTML fallback', new TextEncoder().encode('<html>not a target</html>')],
  ['invalid version', encode({ v: 1, dataList: [] })],
  ['missing target data', encode({ v: 2, dataList: Array(6).fill({}) })]
]) {
  test(`preflight rejects ${label} bytes as decode failure before runtime construction`, async () => {
    const errors = [];
    const controller = new CardTrackingController({ onError: error => errors.push(error) });
    controller._assertEnvironment = async () => {};
    controller._loadRuntime = async () => class { constructor() { assert.fail('must not construct'); } };
    await withGlobals({ fetch: async () => new Response(bytes) }, async () => {
      await assert.rejects(controller.start(), /format\/kompilasi tidak valid/);
    });
    assert.equal(errors.length, 1);
    assert.doesNotMatch(errors[0].message, /tidak ditemukan|Akses kamera/);
  });
}

test('stop during injected camera acquisition releases its late stream', async () => {
  const pending = deferred();
  const entered = deferred();
  const track = liveTrack();
  const controller = new CardTrackingController({ media: { getUserMedia() { entered.resolve(); return pending.promise; } } });
  controller._assertEnvironment = async () => {};
  const starting = controller.start();
  const rejected = assert.rejects(starting, { name: 'AbortError' });
  await entered.promise;
  controller.stop();
  pending.resolve(fakeStream(track));
  await rejected;
  assert.equal(track.stopped, 1);
  assert.equal(controller.mindar, null);
});

test('runtime decode rejection remains specific without an attached camera', async () => {
  const controller = new CardTrackingController();
  controller._assertEnvironment = async () => {};
  controller.mindar = { async start() { throw new Error('invalid target decode'); }, stop() {} };
  await assert.rejects(controller.start(), /^Error: invalid target decode$/);
});

function fakeAnchor(elements) {
  return { visible: true, group: { matrix: { elements } } };
}

function transform(x, y = 0, z = 0) {
  const elements = new Float32Array(16);
  elements[0] = 1; elements[5] = 1; elements[10] = 1; elements[15] = 1;
  elements[12] = x; elements[13] = y; elements[14] = z;
  return elements;
}

test('_readAnchors commits added cards and reports them through onCards', () => {
  const { state, onCards, onError } = makeSink();
  const controller = new CardTrackingController({ container: fakeContainer(), onCards, onError });
  const anchor = fakeAnchor(transform(1, 0, 2));
  controller.mindar = { anchors: [anchor] };

  controller._readAnchors();
  assert.equal(controller.cards.size, 1);
  assert.deepEqual([...controller.cards.keys()], ['benteng']);
  assert.deepEqual(state.cards, [['benteng']]);

  const card = controller.cards.get('benteng');
  assert.deepEqual(card.worldPosition, [1, 0, 2]);
  assert.deepEqual(card.pose, [...transform(1, 0, 2)], 'pose comes from matrix.elements (I4)');
  assert.deepEqual(Object.keys(card).sort(), ['cardId', 'pose', 'role', 'type', 'worldPosition']);
});

test('_readAnchors detects a REMOVED card and reports the removal', () => {
  const { state, onCards, onError } = makeSink();
  const controller = new CardTrackingController({ container: fakeContainer(), onCards, onError });
  const anchor = fakeAnchor(transform(1, 0, 2));
  controller.mindar = { anchors: [anchor] };

  controller._readAnchors();
  assert.deepEqual(state.cards, [['benteng']]);

  anchor.visible = false;                 // the card left the camera
  controller._readAnchors();
  assert.equal(controller.cards.size, 0);
  assert.deepEqual(state.cards, [['benteng'], []]);
});

test('_readAnchors emits only on a real change, not on every poll', () => {
  const { state, onCards, onError } = makeSink();
  const controller = new CardTrackingController({ container: fakeContainer(), onCards, onError });
  controller.mindar = { anchors: [fakeAnchor(transform(1, 0, 2))] };

  controller._readAnchors();
  controller._readAnchors();
  controller._readAnchors();
  assert.equal(state.cards.length, 1, 'identical consecutive snapshots must not re-emit');

  controller.mindar.anchors[0].group.matrix.elements[12] = 1.5;
  controller._readAnchors();
  assert.equal(state.cards.length, 2, 'a real movement is a change');
});

test('the redundant MindAR found/lost wiring agrees with the polling path', () => {
  const { state, onCards, onError } = makeSink();
  const controller = new CardTrackingController({ container: fakeContainer(), onCards, onError });
  const anchor = fakeAnchor(transform(3, 0, 0));
  anchor.onTargetFound = undefined;
  anchor.onTargetLost = undefined;
  controller.mindar = { anchors: [anchor] };
  controller._wireTargets();
  assert.equal(typeof anchor.onTargetFound, 'function');

  anchor.onTargetFound();                 // the fast path
  assert.deepEqual([...controller.cards.keys()], ['benteng']);
  anchor.onTargetLost();
  assert.equal(controller.cards.size, 0);
  assert.deepEqual(state.cards, [['benteng'], []]);
});

test('_readAnchors tolerates hostile anchors without throwing', () => {
  const { onCards, onError } = makeSink();
  const controller = new CardTrackingController({ container: fakeContainer(), onCards, onError });
  controller.mindar = {
    anchors: [null, {}, { visible: true }, { visible: true, group: {} }, { visible: true, group: { matrix: { elements: [1, 2, 3] } } }, { visible: true, group: { matrix: { elements: [NaN, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, NaN, 0, 0, 1] } } }]
  };
  assert.doesNotThrow(() => controller._readAnchors());
  assert.equal(controller.cards.size, 0, 'no malformed anchor may produce a card');
});

// ---------------------------------------------------------------------------
// I6 - decode failures must not be reported as a missing file
// ---------------------------------------------------------------------------

test('_noteError distinguishes a decode failure from a missing target file', () => {
  const decodeErrors = [];
  const decode = new CardTrackingController({
    container: null, onCards: () => {}, onError: error => decodeErrors.push(error.message)
  });
  decode._noteError(new Error('image decode failed: invalid target format'));
  assert.equal(decodeErrors.length, 1);
  assert.match(decodeErrors[0], /format\/kompilasi tidak valid/i);
  assert.doesNotMatch(decodeErrors[0], /tidak ditemukan/i);
  assert.match(decodeErrors[0], /Image Target Compiler/i);

  const missingErrors = [];
  const missing = new CardTrackingController({
    container: null, onCards: () => {}, onError: error => missingErrors.push(error.message)
  });
  missing._noteError(new Error('image target 404 not found'));
  assert.equal(missingErrors.length, 1);
  assert.match(missingErrors[0], /tidak bisa dibaca/i);
  assert.doesNotMatch(missingErrors[0], /format\/kompilasi tidak valid/i);
});

test('_noteError ignores unrelated errors and reports middleware failures only once', () => {
  const errors = [];
  const controller = new CardTrackingController({ container: null, onCards: () => {}, onError: e => errors.push(e) });
  controller._noteError(new Error('ResizeObserver loop limit exceeded'));
  assert.equal(errors.length, 0);

  controller._noteError(new Error('target decode failed'));
  controller._noteError(new Error('target decode failed again'));
  assert.equal(errors.length, 1, 'a repeated middleware failure must not spam onError');
});

test('controller loads and merges 6 individual target files when targetFiles is supplied', async () => {
  const bytes = await readFile(new URL('../../public/cards/targets.mind', import.meta.url));
  const { decode, encode: enc } = await import('@msgpack/msgpack');
  const full = decode(new Uint8Array(bytes));

  const requestedUrls = [];
  const controller = new CardTrackingController({ targetFiles: TARGET_FILES });
  controller._assertEnvironment = async () => {};
  const track = liveTrack();
  let receivedOptions;

  controller._loadRuntime = async () => class {
    constructor(opts) {
      receivedOptions = opts;
      this.video = fakeVideo();
    }
    async start() {
      assert.match(receivedOptions.imageTargetSrc, /^blob:/);
      this.video.srcObject = fakeStream(track);
    }
    stop() {}
  };

  await withGlobals({
    fetch: async url => {
      requestedUrls.push(url);
      const idx = TARGET_FILES.indexOf(url);
      if (idx >= 0) {
        const singleBuf = enc({ v: 2, dataList: [full.dataList[idx]] });
        return new Response(singleBuf);
      }
      return new Response(bytes);
    }
  }, async () => {
    await controller.start();
    assert.match(receivedOptions.imageTargetSrc, /^blob:/);
    assert.equal(requestedUrls.slice(0, 6).length, 6);
    controller.dispose();
  });
  assert.equal(track.stopped, 1);
});
