import { normalizeDetections } from './card-tracking.js';
import { CARD_TARGETS, TARGET_FILE } from './card-targets.js';

// The MindAR image-tracking runtime is a browser-only ESM bundle. It is
// installed with:
//
//   npm install mind-ar@1.2.5
//
// and loaded with a DYNAMIC import inside start() for two reasons:
//
//   1. This module stays importable in plain Node (the dynamic import lives
//      inside `_loadRuntime()` and is never executed at import time), so
//      tests/ar/*.test.js can import it without a DOM.
//   2. Vite code-splits the dynamic import into its own chunk, so the tracker
//      stays out of the initial bundle and only downloads when AR mode starts.
//
// NOTE ON THE SPECIFIER: the import below is a dynamic `import()` with a STATIC
// string literal and NO `@vite-ignore`. That is deliberate. With `@vite-ignore`
// Vite leaves the bare specifier untouched, the built output literally contains
// `import("mind-ar/dist/...")`, and the BROWSER then fails because it cannot
// resolve bare specifiers without an import map. Without `@vite-ignore`, Vite
// rewrites it to a real emitted chunk URL that the browser *can* load.
//
// The runtime needs the `three` module, which Vite resolves through the alias
// in vite.config.js (three -> src/ar/three-compat.js, which supplies the
// `sRGBEncoding` symbol three removed in r152). See three-compat.js.
//
// `globalThis.THREE` is published in _assertEnvironment() below, using a LAZY
// dynamic import of three so this module stays DOM-free and bundler-symbol-free
// when imported in plain Node by the tests. MindAR's dist bundle does not itself
// read a THREE global (it imports the module), but this controller's guard
// expects one and some MindAR builds/addons do read it, so we set it explicitly
// rather than leaving a latent crash.
const MINDAR_PACKAGE = 'mind-ar/dist/mindar-image-three.prod.js';

const MINDAR_INSTALL_COMMAND = `npm install ${MINDAR_PACKAGE.split('/')[0]}@1.2.5`;

// getUserMedia target: a rear-facing camera when the device has one.
const CAMERA_CONSTRAINTS = Object.freeze({ video: { facingMode: 'environment' }, audio: false });

const CAMERA_DENIED_MESSAGE =
  'Akses kamera ditolak atau gagal. Izinkan kamera untuk situs ini di setelan Chrome lalu muat ulang halaman.';
const CAMERA_MISSING_MESSAGE =
  'Kamera tidak tersedia. Pakai Chrome desktop terbaru yang mengizinkan akses kamera.';
const CAMERA_TRACK_MISSING_MESSAGE =
  'Kamera terbuka tetapi tidak mengirim gambar video. Periksa kamera lain yang sedang dipakai lalu muat ulang halaman.';

export class CardTrackingController {
  constructor({ container, onCards, onError, media } = {}) {
    this.container = container ?? null;
    this.onCards = onCards;
    this.onError = onError;

    // Injectable for Node tests: a MediaDevices-like object. When omitted the
    // browser global is read lazily, so this module never touches `navigator`
    // at import time.
    this.media = media ?? null;

    this.cards = new Map();

    this.started = false;
    this.disposed = false;
    this._stopped = false;
    this.running = false;
    this.loading = false;

    this.mindar = null;
    this.video = null;
    this.stream = null;
    this.renderer = null;
    this.onFrame = null;
    this.onResize = null;
    this.createdNodes = [];
    this.knownCardIds = new Set();
    this.missingTargetsReported = false;
    this.lastError = null;
    this.stoppedTracks = new WeakSet();
    this._startup = null;
    this._runtimeStopped = false;
    this._disposedControllers = new WeakSet();
  }

  isSupported() {
    return Boolean(this._mediaDevices()?.getUserMedia);
  }

  get camera() {
    return this.video ?? this.mindar?.video ?? null;
  }

  /**
   * Acquires the camera, boots MindAR and starts tracking.
   *
   * MindAR owns camera acquisition. MindAR 1.2.5 ignores a stream argument and
   * acquires its own stream, so passing a pre-acquired stream would prompt twice.
   */
  async start() {
    if (this._startup) throw new Error('Pelacakan kartu masih dimulai. Tunggu startup selesai sebelum memulai lagi.');
    if (this.started) return this;
    if (this.disposed) {
      throw new Error('Pelacakan kartu sudah dibuang (dispose). Buat controller baru untuk memulai lagi.');
    }

    this.running = true;
    this._stopped = false;
    this.lastError = null;
    this._runtimeStopped = false;
    const startup = { cancelled: false, pending: false, mindar: this.mindar };
    this._startup = startup;
    const checkCancelled = () => {
      if (startup.cancelled || this.disposed) {
        const error = new Error('Pelacakan kartu dibatalkan.');
        error.name = 'AbortError';
        throw error;
      }
    };

    try {
      this.loading = true;
        await this._assertEnvironment();
        checkCancelled();

       // Injected media is a test/caller-owned stream. Browser production must
       // not pre-acquire because MindAR 1.2.5 acquires its own stream.
        const supplied = this.media ? (this.stream ?? await this._acquireCamera()) : null;
        if (supplied) this.stream = supplied;
        checkCancelled();
       if (supplied) {
         this.stream = supplied;
         this._assertLiveVideoTrack(supplied);
       }

       if (!this.mindar) {
         const MindARThree = await this._loadRuntime();
         checkCancelled();
         await this._fetchTargets(checkCancelled);
         checkCancelled();
         this.mindar = new MindARThree({
          container: this.container,
          // MindAR fetches this URL itself; preflight above validates the response.
          imageTargetSrc: TARGET_FILE,
          maxTrack: CARD_TARGETS.length,
          uiLoading: 'no',
          uiScanning: 'no',
          uiError: 'no'
         });
         startup.mindar = this.mindar;
        // MindAR creates these; record them so dispose() can remove them.
        this.createdNodes = this._childNodes();
      }
      this.loading = false;

        try {
          startup.pending = true;
          await startup.mindar.start(supplied);
          checkCancelled();
        } catch (error) {
          checkCancelled();
         // MindAR 1.2.5 can reject without forwarding the getUserMedia error.
          if (!safeSrcObject(this.mindar?.video) && !/target|decode|format|parse|invalid|corrupt|fetch|HTTP/i.test(errorMessage(error))) {
           throw new Error(`${CAMERA_DENIED_MESSAGE} (${errorMessage(error) || 'penyebab tidak diketahui'})`);
         }
          throw error;
        } finally {
          startup.pending = false;
        }

      // Belt and braces: if the runtime ignored the stream we passed, adopt and
      // verify whatever it did attach rather than silently continuing blind.
       const attached = safeSrcObject(this.mindar?.video);
       if (supplied && attached && attached !== supplied) this._releaseStream(supplied);
       if (!attached) throw new Error(CAMERA_DENIED_MESSAGE);
       this.stream = attached;
       this._assertLiveVideoTrack(attached);

      this._configureDisplay();
      this._wireTargets();
      // Poll the anchors once immediately so the first card list never waits on
      // a render frame, then keep polling from the loop.
      this._readAnchors();
      this._startLoop();

      this.started = true;
      return this;
    } catch (error) {
      this.loading = false;
      if (startup.cancelled || this.disposed) {
        this._teardownTracking(startup.mindar);
        if (this.disposed) this._disposeRuntime(startup.mindar);
        checkCancelled();
      }
      return this._fail(this._messageFor(error));
    } finally {
      this._startup = null;
    }
  }
  // ---------------------------------------------------------------------------
  // Runtime loading and environment checks
  // ---------------------------------------------------------------------------

  async _loadRuntime() {
    let module = null;
    try {
      // The specifier MUST be an inline string literal so the bundler can
      // statically resolve it. Writing `import(MINDAR_PACKAGE)` here does NOT
      // work: the bundler treats the identifier as a runtime value, leaves the
      // bare specifier in the output verbatim, and the browser then fails
      // (browsers cannot resolve bare specifiers). With the literal below,
      // Vite rewrites the call to a real emitted chunk URL while still
      // code-splitting MindAR out of the initial bundle. In plain Node this
      // line is never reached by the tests (they stub `_loadRuntime`), so no
      // DOM/bundler is required to import this module.
      module = await import('mind-ar/dist/mindar-image-three.prod.js');
    } catch (error) {
      if (this._looksLikeMissingPackage(error)) {
        throw new Error(`Paket MindAR belum terpasang. Jalankan '${MINDAR_INSTALL_COMMAND}' lalu muat ulang halaman (lihat public/cards/README.md).`);
      }
      throw new Error(`Runtime MindAR gagal dimuat: ${errorMessage(error)}. Pastikan paket mind-ar terpasang dan halaman dimuat ulang.`);
    }
    const MindARThree = module?.MindARThree ?? globalThis.MINDAR?.IMAGE?.MindARThree ?? null;
    if (typeof MindARThree !== 'function') {
      throw new Error('Runtime MindAR dimuat tetapi MindARThree tidak ditemukan. Periksa versi paket mind-ar yang terpasang.');
    }
    return MindARThree;
  }

  _looksLikeMissingPackage(error) {
    const message = errorMessage(error);
    return /cannot find package|failed to resolve|err_module_not_found|module not found|is not defined/i.test(message);
  }

  async _assertEnvironment() {
    if (typeof globalThis.document === 'undefined') {
      throw new Error('Pelacakan kartu hanya berjalan di browser. Buka aplikasi lewat Chrome desktop.');
    }
    if (!this.container) {
      throw new Error('Container AR belum diberikan. Sediakan elemen <div> untuk video dan overlay lewat opsi container.');
    }
    // Publish the Three.js module so `globalThis.THREE` exists for MindAR and
    // for this controller's own guard. The import is dynamic and lives here
    // (not at module scope) so importing this file in plain Node never pulls
    // three; it only runs on the browser start() path. Vite resolves 'three'
    // through the alias in vite.config.js.
    if (typeof globalThis.THREE === 'undefined') {
      globalThis.THREE = await import('three');
    }
    if (CARD_TARGETS.length !== 6) {
      throw new Error(`CARD_TARGETS harus berisi tepat enam kartu, tetapi berisi ${CARD_TARGETS.length}. Periksa src/ar/card-targets.js.`);
    }
  }

  async _fetchTargets(checkCancelled = () => {}) {
    const fetchImpl = defaultFetch();
    if (!fetchImpl) {
      throw new Error(`Tidak bisa memuat berkas target '${TARGET_FILE}': fetch tidak tersedia di lingkungan ini.`);
    }
    let response;
    try {
      response = await fetchImpl(TARGET_FILE);
      checkCancelled();
    } catch (error) {
      checkCancelled();
      throw new Error(`Berkas target '${TARGET_FILE}' tidak bisa diambil (${errorMessage(error)}). Pastikan berkas ada di public/cards/targets.mind.`);
    }
    if (!response?.ok) {
      throw new Error(`Berkas target '${TARGET_FILE}' tidak ditemukan (HTTP ${response?.status ?? '???'}). Kompilasi keenam gambar kartu dengan Image Target Compiler MindAR di https://hiukim.github.io/mind-ar-js-doc/tools/compile lalu letakkan hasilnya di public/cards/targets.mind. Langkah lengkap ada di public/cards/README.md.`);
    }
    try {
      const buffer = await response.arrayBuffer();
      checkCancelled();
      const { decode } = await import('@msgpack/msgpack');
      checkCancelled();
      const data = decode(new Uint8Array(buffer));
      if (data?.v !== 2 || !Array.isArray(data.dataList) || data.dataList.length !== CARD_TARGETS.length ||
          data.dataList.some(target => !(target?.targetImage?.width > 0) || !(target?.targetImage?.height > 0) ||
            !Array.isArray(target.trackingData) || !target.trackingData.length ||
            !Array.isArray(target.matchingData) || !target.matchingData.length)) {
        throw new Error('invalid target data');
      }
    } catch (error) {
      checkCancelled();
      throw new Error(`Berkas target '${TARGET_FILE}' ada tetapi tidak bisa dibaca sebagai target MindAR (format/kompilasi tidak valid). Kompilasi ulang keenam gambar kartu dengan Image Target Compiler MindAR lalu ganti public/cards/targets.mind. (${errorMessage(error)})`);
    }
    return TARGET_FILE;
  }

  // ---------------------------------------------------------------------------
  // Camera ownership and injected-media compatibility
  // ---------------------------------------------------------------------------

  _mediaDevices() {
    if (this.media?.getUserMedia) return this.media;
    if (this.media?.mediaDevices?.getUserMedia) return this.media.mediaDevices;
    return globalThis.navigator?.mediaDevices ?? null;
  }

  async _acquireCamera() {
    const devices = this._mediaDevices();
    if (!devices?.getUserMedia) {
      throw new Error(CAMERA_MISSING_MESSAGE);
    }
    try {
      return await devices.getUserMedia(CAMERA_CONSTRAINTS);
    } catch (error) {
      // Every rejection here is a permission/device failure. The specific
      // camera message is what the user sees and what callers assert on.
      throw new Error(`${CAMERA_DENIED_MESSAGE} (${errorMessage(error) || 'penyebab tidak diketahui'})`);
    }
  }

  _assertLiveVideoTrack(stream) {
    const tracks = stream?.getVideoTracks?.() ?? stream?.getTracks?.()?.filter?.(track => track?.kind === 'video') ?? [];
    const hasLiveTrack = tracks.some(track => track?.readyState === 'live');
    if (!hasLiveTrack) throw new Error(CAMERA_TRACK_MISSING_MESSAGE);
  }

  _attachedStream() {
    return this.video?.srcObject ?? this.mindar?.video?.srcObject ?? null;
  }

  _childNodes() {
    const children = this.container?.children;
    if (!children) return [];
    return Array.from(children);
  }

  _configureDisplay() {
    const video = this.camera;
    if (!video) return;
    video.width = 640;
    video.height = 480;
  }

  // ---------------------------------------------------------------------------
  // Tracking: anchors and the card map
  // ---------------------------------------------------------------------------

  _wireTargets() {
    // MindAR starts with no anchors; register all targets before polling them.
    if (this.mindar?.addAnchor && this.mindar.anchors.length === 0) {
      CARD_TARGETS.forEach((_, index) => this.mindar.addAnchor(index));
    }
    const anchors = this.mindar?.anchors ?? [];
    for (let index = 0; index < anchors.length; index++) {
      const anchor = anchors[index];
      // Redundant fast path. This update is NOT the source of truth: MindAR only
      // fires these from its internal per-frame update, which never runs unless
      // frames are pulled, so `_readAnchors()` polling stays authoritative.
      anchor.onTargetFound = () => this._commitPosition(index, this._positionOf(anchor), this._poseOf(anchor));
      anchor.onTargetLost = () => this._dropCard(index);
    }
  }

  _startLoop() {
    this.renderer = this.mindar?.renderer ?? null;
    if (!this.renderer || typeof this.renderer.render !== 'function') return;
    this.onResize = () => this.mindar?.resize?.();
    if (typeof globalThis.addEventListener === 'function') globalThis.addEventListener('resize', this.onResize);
    this.onFrame = () => {
      if (!this.running) return;
      try {
        this._readAnchors();
        this.renderer.render(this.mindar.scene, this.mindar.camera);
      } catch (error) {
        this._noteError(error);
      }
      this._scheduleFrame();
    };
    this._scheduleFrame();
  }

  _scheduleFrame() {
    if (!this.running) return;
    if (typeof globalThis.requestAnimationFrame === 'function') globalThis.requestAnimationFrame(this.onFrame);
  }

  /**
   * Reads every anchor and commits a FULL snapshot of the visible cards.
   *
   * This is the reliable path: it detects both added and removed cards (a card
   * whose anchor stops being visible silently leaves the snapshot) and never
   * depends on MindAR's internal callbacks firing. Exposed for tests as the
   * map-commit entry point with fake anchors.
   */
  _readAnchors() {
    const anchors = Array.isArray(this.mindar?.anchors) ? this.mindar.anchors : [];
    const raw = [];
    for (let index = 0; index < anchors.length; index++) {
      const anchor = anchors[index];
      if (!anchor || anchor.visible !== true) continue;
      const position = this._positionOf(anchor);
      if (!position) continue;
      raw.push({ targetIndex: index, worldPosition: position, pose: this._poseOf(anchor) });
    }
    this._commit(raw);
  }

  _positionOf(anchor) {
    const elements = anchor?.group?.matrix?.elements;
    if (!isElementArray(elements) || elements.length < 16) return null;
    return [elements[12], elements[13], elements[14]].every(value => Number.isFinite(value))
      ? [elements[12], elements[13], elements[14]]
      : null;
  }

  // MindAR keeps `group.matrixAutoUpdate = false`, so `group.matrix.elements` is
  // the ONLY valid pose source; `group.position` never moves. A 16-element
  // column-major copy of that matrix travels with each card.
  _poseOf(anchor) {
    const elements = anchor?.group?.matrix?.elements;
    return isElementArray(elements) && elements.length >= 16 ? Array.from(elements).slice(0, 16) : null;
  }

  _commitPosition(index, position, pose = null) {
    if (!position) return;
    const cardId = CARD_TARGETS[index]?.cardId;
    if (!cardId) return;
    const next = new Map(this.cards);
    for (const card of normalizeDetections([{ targetIndex: index, worldPosition: position, pose }])) {
      next.set(card.cardId, card);
    }
    this._commitMap(next);
  }

  _dropCard(index) {
    const cardId = CARD_TARGETS[index]?.cardId;
    if (!cardId || !this.cards.has(cardId)) return;
    const next = new Map(this.cards);
    next.delete(cardId);
    this._commitMap(next);
  }

  _commit(raw) {
    const next = new Map();
    for (const card of normalizeDetections(raw)) next.set(card.cardId, card);
    this._commitMap(next);
  }

  _commitMap(next) {
    if (!this._changed(next)) return;
    this.cards = next;
    this._emit();
    // Only genuinely NEW detections are worth a log line; a card that is merely
    // moving would otherwise re-log every frame.
    const fresh = [...next.keys()].filter(cardId => !this.knownCardIds.has(cardId));
    if (fresh.length > 0) {
      this.knownCardIds = new Set(next.keys());
      console.info('[card-tracking] Kartu terdeteksi:', fresh.join(', '));
    } else if (next.size === 0) {
      this.knownCardIds = new Set();
    }
  }

  _changed(next) {
    if (next.size !== this.cards.size) return true;
    for (const [cardId, card] of next) {
      const previous = this.cards.get(cardId);
      if (!previous) return true;
      // Rotation-only and sub-millimetre changes must also reach the preview.
      if (card.pose?.length !== previous.pose?.length) return true;
      if (card.pose?.some((value, index) => value !== previous.pose[index])) return true;
      const before = previous.worldPosition;
      if (!Array.isArray(before) || before.length !== 3) return true;
      for (let axis = 0; axis < 3; axis++) {
        if (Math.abs(before[axis] - card.worldPosition[axis]) > 0.0005) return true;
      }
    }
    return false;
  }

  _emit() {
    if (typeof this.onCards === 'function') this.onCards([...this.cards.values()]);
  }
  // ---------------------------------------------------------------------------
  // Failure reporting and teardown
  // ---------------------------------------------------------------------------

  /**
   * Reports a recoverable middleware error (render/worker faults) to `onError`.
   *
   * A decode/format failure is NOT a missing file: the 404 message belongs to
   * `_fetchTargets` alone, so the shape failures get their own message instead of
   * telling the user a present file is missing.
   */
  _noteError(error) {
    this.lastError = error;
    if (this.missingTargetsReported) return;
    const message = errorMessage(error).toLowerCase();
    if (!/target|not found|404|fetch|image|decode|format|parse|invalid/i.test(message)) return;
    this.missingTargetsReported = true;
    const isDecodeFailure = /decode|format|parse|invalid|corrupt/.test(message);
    this.onError?.(new Error(isDecodeFailure
      ? `Berkas target '${TARGET_FILE}' ada tetapi tidak bisa dibaca sebagai target MindAR (format/kompilasi tidak valid). Kompilasi ulang keenam gambar kartu dengan Image Target Compiler MindAR di https://hiukim.github.io/mind-ar-js-doc/tools/compile lalu ganti public/cards/targets.mind (lihat public/cards/README.md).`
      : `Berkas target '${TARGET_FILE}' tidak bisa dibaca. Kompilasi keenam gambar kartu dengan Image Target Compiler MindAR lalu letakkan public/cards/targets.mind (lihat public/cards/README.md).`));
  }

  _messageFor(error) {
    if (error instanceof Error) return error;
    return new Error(`Pelacakan kartu gagal dimulai: ${errorMessage(error) || 'penyebab tidak diketahui'}.`);
  }

  async _fail(error) {
    this.lastError = error;
    await this.stop();
    this.onError?.(error);
    throw error;
  }

  /** Idempotent. Releasing an already-stopped controller is a no-op. */
  stop() {
    if (this._startup) this._startup.cancelled = true;
    if (!this._stopped || this._startup) {
      this._teardownTracking();
      this._stopped = true;
    }
    this.running = false;
    this.loading = false;
    this.started = false;
    if (this.cards.size > 0) {
      this.cards = new Map();
      this._emit();
    }
    this.knownCardIds = new Set();
    return this;
  }

  _teardownTracking(mindar = this.mindar ?? this._startup?.mindar) {
    this.started = false;
    // Detach first: MindAR.stop also stops srcObject tracks, so leaving the
    // stream attached would stop those tracks twice.
    this._releaseCamera(mindar);
    try {
      // A pending runtime may create its controller/stream later. Stop it only
      // after it settles, while releasing already-reachable tracks immediately.
      if (!this._startup?.pending && !this._runtimeStopped && mindar) {
        this._runtimeStopped = true;
        mindar.stop?.();
      }
    } catch {
      /* the runtime may already be gone */
    }
    try { mindar?.video?.remove?.(); } catch { /* already detached */ }
    try {
      mindar?.controller?.stopProcessVideo?.();
    } catch {
      /* the tracking worker may already be gone */
    }
    if (typeof globalThis.removeEventListener === 'function' && this.onResize) {
      globalThis.removeEventListener('resize', this.onResize);
    }
    this.onResize = null;
    this.onFrame = null;
    this._releaseCamera(mindar);
  }

  /**
   * Releases every camera track. Defensive throughout: this runs inside start()'s
   * catch path, where a missing/vanished DOM must never replace the real error
   * (a bare `document` reference used to throw "document is not defined").
   */
  _releaseCamera(mindar = this.mindar) {
    const streams = [this.stream, mindar?.stream, mindar?.controller?.stream,
      safeSrcObject(this.video), safeSrcObject(mindar?.video), safeSrcObject(mindar?.controller?.video)]
      .filter(Boolean);
    this.stream = null;
    for (const video of new Set([this.video, mindar?.video, mindar?.controller?.video].filter(Boolean))) {
      try { video.pause?.(); } catch { /* element already detached */ }
      try { video.srcObject = null; } catch { /* element already detached */ }
      try { video.remove?.(); } catch { /* already detached */ }
    }
    this.video = null;
    const tracks = new Set();
    for (const stream of streams) for (const track of tryTracks(stream)) tracks.add(track);
    for (const track of tracks) {
      if (!track || this.stoppedTracks.has(track)) continue;
      this.stoppedTracks.add(track);
      try { track?.stop?.(); } catch { /* track already ended */ }
    }
  }

  _releaseStream(stream) {
    for (const track of tryTracks(stream)) {
      if (!track || this.stoppedTracks.has(track)) continue;
      this.stoppedTracks.add(track);
      try { track?.stop?.(); } catch { /* track already ended */ }
    }
  }

  /** Idempotent, safe before start(), and safe after dispose(). */
  dispose() {
    this.stop();
    this.disposed = true;
    if (!this._startup?.pending) this._disposeRuntime(this.mindar);
    for (const node of this.createdNodes) {
      try { node?.parentNode?.removeChild?.(node); } catch { /* already removed */ }
    }
    this.createdNodes = [];
    this.mindar = null;
    this.renderer = null;
    return this;
  }

  _disposeRuntime(mindar) {
    const controller = mindar?.controller;
    if (!controller || this._disposedControllers.has(controller)) return;
    this._disposedControllers.add(controller);
    try { controller.dispose?.(); } catch { /* controller already gone */ }
  }
}

function isElementArray(value) {
  return Array.isArray(value) || (ArrayBuffer.isView(value) && typeof value.length === 'number');
}

function safeSrcObject(video) {
  try { return video?.srcObject ?? null; } catch { return null; }
}

function tryTracks(stream) {
  try {
    if (typeof stream?.getTracks !== 'function') return [];
    return stream.getTracks() ?? [];
  } catch {
    return [];
  }
}

function defaultFetch() {
  return typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null;
}

function errorMessage(error) {
  return String(error?.message ?? error ?? '');
}
