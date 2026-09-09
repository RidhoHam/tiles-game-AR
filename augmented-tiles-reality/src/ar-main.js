import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
    import { ARScene } from './ar/arScene.js';
    import { HandTracker, calculateTwoHandSpan, detectPinch } from './vision/handTracker.js';
    import { HitDetector } from './engine/hitDetector.js';
    import { SoundEngine } from './audio/soundEngine.js';
    import { parseSongChart, convertTilesJsonToChart } from './engine/songParser.js';
    import { ARUIController, UI_STATES } from './ui/arUI.js';

    // Application state
    let arScene = null;
    let handTracker = null;
    let hitDetector = null;
    let soundEngine = null;
    let arUI = null;

    let selectedLanes = 8;
    let currentViewMode = 'tiles'; // 'tiles' | 'roll'
    let currentGameMode = localStorage.getItem('ar_game_mode') || 'play'; // 'play' | 'auto' | 'wait_chord' | 'wait_all'
    let isWaitingForHit = false;
    let selectedSongId = 'demo_canon';
    let loadedSongData = null;
    let currentChart = null;
    let loadedCustomChart = null;

    let isCameraMirrored = localStorage.getItem('ar_camera_mirrored') !== 'false'; // Default TRUE (mirrored webcam)

    let savedFlowDir = localStorage.getItem('ar_flow_direction');
    if (!savedFlowDir || savedFlowDir === 'up') {
      savedFlowDir = 'down';
      localStorage.setItem('ar_flow_direction', 'down');
    }
    let flowDirection = savedFlowDir || 'down'; // Default: 'down' (Atas ke Bawah - standard falling notes)

    function isValidCorners(c) {
      return Boolean(
        c && c.p1 && c.p2 && c.p3 && c.p4 &&
        Number.isFinite(c.p1.x) && Number.isFinite(c.p1.y) &&
        Number.isFinite(c.p2.x) && Number.isFinite(c.p2.y) &&
        Number.isFinite(c.p3.x) && Number.isFinite(c.p3.y) &&
        Number.isFinite(c.p4.x) && Number.isFinite(c.p4.y)
      );
    }

    // Persisted holographic desk canvas corners for seamless gameplay alignment
    let persistedCanvasCorners = null;
    try {
      const saved = localStorage.getItem('ar_canvas_corners');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (isValidCorners(parsed)) {
          persistedCanvasCorners = parsed;
        } else {
          localStorage.removeItem('ar_canvas_corners');
        }
      }
    } catch (e) {}

    function saveCanvasCorners() {
      if (persistedCanvasCorners && isValidCorners(persistedCanvasCorners)) {
        try {
          localStorage.setItem('ar_canvas_corners', JSON.stringify(persistedCanvasCorners));
        } catch (e) {}
      }
    }

    // Active corner dragging tracking
    let pointerDraggingCorner = null; // 'p1' | 'p2' | 'p3' | 'p4' | null
    const handDraggingCorner = {
      Left: null,
      Right: null
    };

    let isPlaying = false;
    let songStartTimeSec = 0;
    let lastHandPositions = {};
    let fingerLaneState = {}; // tracks {lane, hitFired} per finger to prevent false triggers on lateral movement
    let fallbackInteractionActive = false;
    let gestureCanvas = null;
    let gestureCtx = null;

    function showArToast(message, type = 'info', durationMs = 3500) {
      const toastEl = document.getElementById('ar-toast');
      if (!toastEl) return;
      toastEl.className = `ar-toast ${type}`;
      toastEl.innerText = message;
      toastEl.classList.remove('hidden');
      if (window._arToastTimer) clearTimeout(window._arToastTimer);
      window._arToastTimer = setTimeout(() => {
        toastEl.classList.add('hidden');
      }, durationMs);
    }

    // Preloaded canonical demo songs data fallback
    const DEMO_SONGS = {
      demo_canon: {
        id: 'demo_canon',
        title: 'Canon in D',
        artist: 'Johann Pachelbel',
        bpm: 100,
        charts: {
          '4lane': {
            difficulty: 'normal',
            lanes: 4,
            notes: [
              { beat: 0, lane: 0, hand: 'left', type: 'tap', note: 'D4', midi: 62, duration: 1 },
              { beat: 1, lane: 3, hand: 'right', type: 'tap', note: 'F#5', midi: 78, duration: 1 },
              { beat: 2, lane: 2, hand: 'right', type: 'tap', note: 'E5', midi: 76, duration: 1 },
              { beat: 3, lane: 1, hand: 'left', type: 'tap', note: 'D5', midi: 74, duration: 1 },
              { beat: 4, lane: 0, hand: 'left', type: 'chord', duration: 2, notes: [{ lane: 0, hand: 'left', note: 'A3', midi: 57 }, { lane: 2, hand: 'right', note: 'C#5', midi: 73 }] },
              { beat: 6, lane: 1, hand: 'left', type: 'tap', note: 'B4', midi: 71, duration: 1 },
              { beat: 7, lane: 2, hand: 'right', type: 'tap', note: 'C#5', midi: 73, duration: 1 },
              { beat: 8, lane: 1, hand: 'left', type: 'chord', duration: 2, notes: [{ lane: 1, hand: 'left', note: 'B3', midi: 59 }, { lane: 3, hand: 'right', note: 'D5', midi: 74 }] },
              { beat: 10, lane: 2, hand: 'right', type: 'tap', note: 'C#5', midi: 73, duration: 1 },
              { beat: 11, lane: 1, hand: 'left', type: 'tap', note: 'B4', midi: 71, duration: 1 },
              { beat: 12, lane: 0, hand: 'left', type: 'chord', duration: 2, notes: [{ lane: 0, hand: 'left', note: 'F#3', midi: 54 }, { lane: 2, hand: 'right', note: 'A4', midi: 69 }] },
              { beat: 14, lane: 1, hand: 'left', type: 'tap', note: 'B4', midi: 71, duration: 1 },
              { beat: 15, lane: 2, hand: 'right', type: 'tap', note: 'C#5', midi: 73, duration: 1 },
              { beat: 16, lane: 0, hand: 'left', type: 'chord', duration: 2, notes: [{ lane: 0, hand: 'left', note: 'G3', midi: 55 }, { lane: 1, hand: 'right', note: 'B4', midi: 71 }] }
            ]
          },
          '8lane': {
            difficulty: 'hard',
            lanes: 8,
            notes: [
              { beat: 0, lane: 1, hand: 'left', type: 'tap', note: 'D3', midi: 50, duration: 1 },
              { beat: 0, lane: 5, hand: 'right', type: 'tap', note: 'F#4', midi: 66, duration: 1 },
              { beat: 2, lane: 2, hand: 'left', type: 'tap', note: 'A2', midi: 45, duration: 1 },
              { beat: 2, lane: 6, hand: 'right', type: 'tap', note: 'E4', midi: 64, duration: 1 },
              { beat: 4, lane: 0, hand: 'left', type: 'tap', note: 'B2', midi: 47, duration: 1 },
              { beat: 4, lane: 7, hand: 'right', type: 'tap', note: 'D5', midi: 74, duration: 1 },
              { beat: 6, lane: 1, hand: 'left', type: 'tap', note: 'F#2', midi: 42, duration: 1 },
              { beat: 6, lane: 4, hand: 'right', type: 'tap', note: 'C#4', midi: 61, duration: 1 },
              { beat: 8, lane: 0, hand: 'left', type: 'tap', note: 'G2', midi: 43, duration: 1 },
              { beat: 8, lane: 5, hand: 'right', type: 'tap', note: 'B4', midi: 71, duration: 1 }
            ]
          }
        }
      },
      demo_twinkle: {
        id: 'demo_twinkle',
        title: 'Twinkle Twinkle Little Star',
        artist: 'Traditional',
        bpm: 100,
        charts: {
          '4lane': {
            difficulty: 'easy',
            lanes: 4,
            notes: [
              { beat: 0, lane: 0, hand: 'left', type: 'tap', note: 'C4', midi: 60, duration: 1 },
              { beat: 1, lane: 0, hand: 'left', type: 'tap', note: 'C4', midi: 60, duration: 1 },
              { beat: 2, lane: 2, hand: 'right', type: 'tap', note: 'G4', midi: 67, duration: 1 },
              { beat: 3, lane: 2, hand: 'right', type: 'tap', note: 'G4', midi: 67, duration: 1 },
              { beat: 4, lane: 3, hand: 'right', type: 'tap', note: 'A4', midi: 69, duration: 1 },
              { beat: 5, lane: 3, hand: 'right', type: 'tap', note: 'A4', midi: 69, duration: 1 },
              { beat: 6, lane: 2, hand: 'right', type: 'hold', note: 'G4', midi: 67, duration: 2 },
              { beat: 8, lane: 1, hand: 'left', type: 'tap', note: 'F4', midi: 65, duration: 1 },
              { beat: 9, lane: 1, hand: 'left', type: 'tap', note: 'F4', midi: 65, duration: 1 },
              { beat: 10, lane: 1, hand: 'left', type: 'tap', note: 'E4', midi: 64, duration: 1 },
              { beat: 11, lane: 1, hand: 'left', type: 'tap', note: 'E4', midi: 64, duration: 1 },
              { beat: 12, lane: 0, hand: 'left', type: 'tap', note: 'D4', midi: 62, duration: 1 },
              { beat: 13, lane: 0, hand: 'left', type: 'tap', note: 'D4', midi: 62, duration: 1 },
              { beat: 14, lane: 0, hand: 'left', type: 'hold', note: 'C4', midi: 60, duration: 2 }
            ]
          },
          '8lane': {
            difficulty: 'normal',
            lanes: 8,
            notes: [
              { beat: 0, lane: 0, hand: 'left', type: 'tap', note: 'C3', midi: 48, duration: 1 },
              { beat: 0, lane: 4, hand: 'right', type: 'tap', note: 'C4', midi: 60, duration: 1 },
              { beat: 2, lane: 1, hand: 'left', type: 'tap', note: 'G3', midi: 55, duration: 1 },
              { beat: 2, lane: 6, hand: 'right', type: 'tap', note: 'G4', midi: 67, duration: 1 },
              { beat: 4, lane: 2, hand: 'left', type: 'tap', note: 'A3', midi: 57, duration: 1 },
              { beat: 4, lane: 7, hand: 'right', type: 'tap', note: 'A4', midi: 69, duration: 1 },
              { beat: 6, lane: 1, hand: 'left', type: 'hold', note: 'G3', midi: 55, duration: 2 },
              { beat: 6, lane: 6, hand: 'right', type: 'hold', note: 'G4', midi: 67, duration: 2 }
            ]
          }
        }
      }
    };

    async function init() {
      const container = document.getElementById('ar-container');

      // 1. Initialize ARUI Controller
      arUI = new ARUIController({ container });

      // 2. Initialize Three.js Scene
      arScene = new ARScene({
        container,
        three: THREE,
        laneCount: selectedLanes,
        arenaWidth: 0.8,
        arenaDepth: 2.0,
        hitPlaneZ: 0.0,
        travelDurationSec: 2.0
      });

      // 3. Initialize Hit Detector
      hitDetector = new HitDetector({
        laneCount: selectedLanes,
        arenaWidth: 0.8,
        hitPlaneZ: 0.0,
        perfectWindowSec: 0.050,
        goodWindowSec: 0.120,
        forgiveness: 1.2
      });

      // 4. Initialize Sound Engine
      soundEngine = new SoundEngine();

      // 5. Initialize Hand Tracker (async, low-latency 10-finger mode)
      handTracker = new HandTracker({
        alpha: 0.88,
        adaptiveSmoothing: true,
        arenaConfig: { arenaWidth: 0.8, cameraZOffset: 0.0, mirror: isCameraMirrored }
      });
      handTracker.init().catch(err => console.warn('MediaPipe async load warning:', err));

      // Attempt camera fallback right away for AR background
      await arScene.initFallbackCamera(container);
      applyCameraMirror();

      // 6. Initialize 2D Gesture Canvas
      gestureCanvas = document.getElementById('gesture-canvas');
      if (gestureCanvas) {
        gestureCtx = gestureCanvas.getContext('2d');
        const resizeGesture = () => {
          const dpr = window.devicePixelRatio || 1;
          gestureCanvas.width = window.innerWidth * dpr;
          gestureCanvas.height = window.innerHeight * dpr;
          gestureCanvas.style.width = window.innerWidth + 'px';
          gestureCanvas.style.height = window.innerHeight + 'px';
          gestureCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        };
        window.addEventListener('resize', resizeGesture);
        resizeGesture();
      }

      setupDOMEventHandlers();
      setupTouchLaneFallback();
      setupCornerPointerHandlers();
      startMainRenderLoop();
    }

    function confirmAndOpenSongMenu() {
      if (!persistedCanvasCorners) {
        persistedCanvasCorners = getDefaultCanvasCorners(window.innerWidth, window.innerHeight);
      }
      saveCanvasCorners();
      try {
        soundEngine.init().catch(() => {});
      } catch (e) {}

      arScene.confirmPlacement();

      // Ensure scan banner is hidden and song modal is displayed immediately
      const scanBanner = document.getElementById('scan-banner');
      if (scanBanner) scanBanner.classList.add('hidden');
      const songModal = document.getElementById('song-modal');
      if (songModal) songModal.classList.remove('hidden');

      if (arUI && arUI.stateMachine) {
        if (arUI.stateMachine.getState() === UI_STATES.SCAN_SURFACE) {
          arUI.stateMachine.transition(UI_STATES.SELECT_SONG_MODE);
        } else {
          arUI.stateMachine.state = UI_STATES.SELECT_SONG_MODE;
          arUI.updateUIForState(UI_STATES.SELECT_SONG_MODE);
        }
      }
    }

    function setupDOMEventHandlers() {
      // Surface Placement Handlers
      const btnPlace = document.getElementById('btn-place-arena');
      const btnSkip = document.getElementById('btn-skip-placement');

      btnPlace?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        confirmAndOpenSongMenu();
      });

      btnSkip?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        persistedCanvasCorners = getDefaultCanvasCorners(window.innerWidth, window.innerHeight);
        saveCanvasCorners();
        arScene.placeArena({ x: 0, y: -0.3, z: -1.2 });
        confirmAndOpenSongMenu();
      });

      // Mirror & Direction Toggles
      document.getElementById('btn-scan-mirror')?.addEventListener('click', toggleCameraMirror);
      document.getElementById('btn-hud-mirror')?.addEventListener('click', toggleCameraMirror);
      document.getElementById('btn-scan-direction')?.addEventListener('click', toggleFlowDirection);
      document.getElementById('btn-hud-direction')?.addEventListener('click', toggleFlowDirection);
      applyCameraMirror();
      applyFlowDirection();

      // Dual Mode Switcher Tabs (Tiles vs Real Piano)
      const viewTilesBtn = document.getElementById('viewTilesBtn');
      const viewRollBtn = document.getElementById('viewRollBtn');
      const hudModeBadge = document.getElementById('hud-mode-badge');

      const setViewMode = (mode) => {
        currentViewMode = mode === 'roll' ? 'roll' : 'tiles';
        if (viewTilesBtn) viewTilesBtn.classList.toggle('active', currentViewMode === 'tiles');
        if (viewRollBtn) viewRollBtn.classList.toggle('active', currentViewMode === 'roll');
        if (hudModeBadge) hudModeBadge.innerText = currentViewMode === 'roll' ? '🎹 Real Piano' : '🎮 Tiles';
        arScene.setViewMode(currentViewMode);
      };

      viewTilesBtn?.addEventListener('click', (e) => {
        e.preventDefault();
        setViewMode('tiles');
      });
      viewRollBtn?.addEventListener('click', (e) => {
        e.preventDefault();
        setViewMode('roll');
      });

      // Allow clicking hud-mode-badge to toggle view mode during play!
      hudModeBadge?.addEventListener('click', (e) => {
        e.preventDefault();
        const nextMode = currentViewMode === 'roll' ? 'tiles' : 'roll';
        setViewMode(nextMode);
        showToast(nextMode === 'roll' ? 'Tampilan: 🎹 Real Piano' : 'Tampilan: 🎮 Tiles');
      });

      // Game Mode Tabs in Modal & HUD Switcher Button
      const arGameModeTabs = document.querySelectorAll('#arGameModeTabs .game-mode-tab');
      const btnHudGameMode = document.getElementById('btn-hud-gamemode');

      const GAME_MODE_LABELS = {
        play: '🎮 Interactive',
        auto: '▶️ Auto-Play',
        wait_chord: '⏸️ Stop Chord',
        wait_all: '⏸️ Stop All'
      };

      const setGameMode = (mode) => {
        if (!GAME_MODE_LABELS[mode]) mode = 'play';
        currentGameMode = mode;
        try { localStorage.setItem('ar_game_mode', mode); } catch (_) {}

        arGameModeTabs.forEach(tab => {
          tab.classList.toggle('active', tab.getAttribute('data-gamemode') === mode);
        });

        if (btnHudGameMode) {
          btnHudGameMode.innerText = GAME_MODE_LABELS[mode];
          btnHudGameMode.className = `hud-badge-pill gamemode-btn mode-${mode}`;
        }
      };

      arGameModeTabs.forEach(tab => {
        tab.addEventListener('click', (e) => {
          e.preventDefault();
          const targetMode = tab.getAttribute('data-gamemode');
          if (targetMode) setGameMode(targetMode);
        });
      });

      btnHudGameMode?.addEventListener('click', (e) => {
        e.preventDefault();
        const modes = ['play', 'auto', 'wait_chord', 'wait_all'];
        const nextIdx = (modes.indexOf(currentGameMode) + 1) % modes.length;
        const nextMode = modes[nextIdx];
        setGameMode(nextMode);
        showToast(`Mode Permainan: ${GAME_MODE_LABELS[nextMode]}`);
      });

      // Apply initial modes
      setViewMode(currentViewMode);
      setGameMode(currentGameMode);

      // Song Select Items
      const songItems = document.querySelectorAll('.song-item');
      songItems.forEach(item => {
        item.addEventListener('click', () => {
          songItems.forEach(si => si.classList.remove('selected'));
          item.classList.add('selected');
          selectedSongId = item.getAttribute('data-song-id');
        });
      });

      // File input: Supports both binary MIDI (.mid / .midi) and JSON charts
      const fileInput = document.getElementById('song-file-input');
      fileInput?.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        try {
          const fileName = file.name.toLowerCase();
          const isMidi = fileName.endsWith('.mid') || fileName.endsWith('.midi') || file.type === 'audio/midi';

          if (isMidi) {
            const buffer = await file.arrayBuffer();
            if (!window.Midi) {
              throw new Error('Tone.js Midi parser belum tersedia di browser.');
            }
            const parsed = new window.Midi(buffer);
            const tempo = parsed.header.tempos && parsed.header.tempos.length
              ? parsed.header.tempos[0].bpm
              : 120;
            const songBpm = Number.isFinite(tempo) ? Math.round(tempo) : 120;

            const rawNotes = [];
            let noteIdCounter = 0;
            for (const track of parsed.tracks) {
              for (const n of track.notes) {
                rawNotes.push({
                  id: ++noteIdCounter,
                  time: n.time,
                  duration: Math.max(0.08, n.duration),
                  midi: n.midi,
                  velocity: n.velocity ?? 0.8,
                  name: n.name || ''
                });
              }
            }
            rawNotes.sort((a, b) => a.time - b.time || a.midi - b.midi);
            if (!rawNotes.length) throw new Error('Tidak ditemukan not musik dalam file MIDI.');

            const title = file.name.replace(/\.(mid|midi)$/i, '');
            // Convert to 8-lane chart for Tiles mode and preserve MIDI pitch for Real Piano mode
            const chartNotes = rawNotes.map(n => {
              const minM = 36;
              const maxM = 84;
              const norm = Math.max(0, Math.min(1, (n.midi - minM) / (maxM - minM)));
              const lane = Math.min(7, Math.floor(norm * 8));
              return {
                id: `midi_${n.id}`,
                beat: (n.time / 60) * songBpm,
                timeSec: n.time,
                lane,
                hand: lane < 4 ? 'left' : 'right',
                type: 'tap',
                note: n.name || 'C4',
                midi: n.midi,
                durationBeat: (n.duration / 60) * songBpm,
                durationSec: n.duration,
                velocity: n.velocity
              };
            });

            loadedSongData = {
              id: 'imported_midi',
              title,
              artist: 'MIDI Import',
              bpm: songBpm,
              timeSignature: '4/4'
            };
            currentChart = {
              id: 'imported_midi',
              title,
              artist: 'MIDI Import',
              bpm: songBpm,
              difficulty: 'normal',
              lanes: 8,
              durationSec: Math.max(...chartNotes.map(n => n.timeSec + n.durationSec)) + 2.0,
              notes: chartNotes
            };
            tagChordsInChart(currentChart);
            loadedCustomChart = currentChart;
            selectedSongId = 'imported_midi';

            // Add or highlight Custom MIDI in modal song list
            const songListEl = document.querySelector('.song-list');
            if (songListEl) {
              let customItem = songListEl.querySelector('.custom-midi-item');
              if (!customItem) {
                customItem = document.createElement('div');
                customItem.className = 'song-item custom-midi-item';
                customItem.setAttribute('data-song-id', 'imported_midi');
                songListEl.insertBefore(customItem, songListEl.firstChild);
              }
              customItem.innerHTML = `
                <div class="song-item-info">
                  <h4>🎵 ${title}</h4>
                  <p>MIDI Import • ${chartNotes.length} not • ${songBpm} BPM</p>
                </div>
                <span class="song-item-tag" style="background: linear-gradient(135deg, #059669, #10b981); color: #fff;">Custom MIDI</span>
              `;
              document.querySelectorAll('.song-item').forEach(si => si.classList.remove('selected'));
              customItem.classList.add('selected');
              customItem.onclick = () => {
                document.querySelectorAll('.song-item').forEach(si => si.classList.remove('selected'));
                customItem.classList.add('selected');
                selectedSongId = 'imported_midi';
              };
            }

            const hudTitle = document.getElementById('hud-song-title');
            if (hudTitle) hudTitle.innerText = title;
            showArToast(`🎵 Berhasil memuat MIDI: ${title} (${chartNotes.length} not)`, 'success', 4000);
          } else {
            // JSON Chart Parser
            const text = await file.text();
            const json = JSON.parse(text);
            if (json.tiles) {
              const converted = convertTilesJsonToChart(json);
              loadedSongData = converted.song;
              currentChart = parseSongChart(converted.song, converted.chart);
            } else if (json.charts) {
              loadedSongData = json;
              const chartKey = selectedLanes >= 8 ? '8lane' : '4lane';
              const chartData = json.charts[chartKey] || Object.values(json.charts)[0];
              currentChart = parseSongChart(json, chartData);
            }
            loadedCustomChart = currentChart;
            selectedSongId = 'imported_midi';
            showArToast(`📄 Berhasil memuat Chart: ${loadedSongData.title || file.name}`, 'success', 3500);
          }
        } catch (err) {
          console.error(err);
          showArToast('❌ Gagal membaca file: ' + err.message, 'error', 4500);
        }
      });

      // Direct Play Button (Skip extra calibration, immediately start with current table width)
      const btnDirectPlay = document.getElementById('btn-direct-play');
      btnDirectPlay?.addEventListener('click', async (e) => {
        e?.preventDefault?.();
        try {
          if (soundEngine.initAudio) soundEngine.initAudio();
          else if (soundEngine.init) await soundEngine.init();
        } catch (err) {
          console.warn('Audio init error:', err);
        }
        await prepareSongChart();
        arScene.confirmPlacement();
        document.getElementById('song-modal')?.classList.add('hidden');
        hitDetector.arenaWidth = arScene.arenaWidth;
        arScene.setLaneCount(selectedLanes);
        arUI.stateMachine.transition(UI_STATES.COUNTDOWN);
        arUI.showCountdown(3, () => startSongGameplay());
      });

      // Start Calibration Button
      const btnStartCalib = document.getElementById('btn-start-calibration');
      btnStartCalib?.addEventListener('click', () => {
        prepareSongChart();
        arUI.calibrationManager.reset();
        arUI.stateMachine.transition(UI_STATES.CALIBRATING);
      });

      // Calibration Confirm & Skip Buttons
      const btnConfirmCalib = document.getElementById('btn-confirm-calib');
      const btnSkipCalib = document.getElementById('btn-skip-calib');

      const applyCalibrationAndStart = () => {
        const calib = arUI.calibrationManager.computeCalibration();
        if (arUI.calibrationManager.samples.length > 0) {
          hitDetector.arenaWidth = calib.arenaWidth;
          hitDetector.hitPlaneZ = calib.hitPlaneZ;
          arScene.arenaWidth = calib.arenaWidth;
          arScene.hitPlaneZ = calib.hitPlaneZ;
        } else {
          // Keep the custom 2-hand pinch table width!
          hitDetector.arenaWidth = arScene.arenaWidth;
        }
        arScene.setLaneCount(selectedLanes);

        arUI.stateMachine.transition(UI_STATES.COUNTDOWN);
        arUI.showCountdown(3, () => startSongGameplay());
      };

      btnConfirmCalib?.addEventListener('click', applyCalibrationAndStart);
      btnSkipCalib?.addEventListener('click', applyCalibrationAndStart);

      // HUD Buttons
      document.getElementById('btn-mute')?.addEventListener('click', () => {
        const muted = soundEngine.toggleMute();
        document.getElementById('btn-mute').innerText = muted ? '🔇' : '🔊';
      });

      document.getElementById('btn-exit')?.addEventListener('click', () => {
        isPlaying = false;
        arUI.stateMachine.transition(UI_STATES.SELECT_SONG_MODE);
      });

      // Result Modal Buttons
      document.getElementById('btn-result-replay')?.addEventListener('click', () => {
        prepareSongChart();
        arUI.stateMachine.transition(UI_STATES.COUNTDOWN);
        arUI.showCountdown(3, () => startSongGameplay());
      });

      document.getElementById('btn-result-songs')?.addEventListener('click', () => {
        arUI.stateMachine.transition(UI_STATES.SELECT_SONG_MODE);
      });
    }

    function toggleCameraMirror() {
      isCameraMirrored = !isCameraMirrored;
      localStorage.setItem('ar_camera_mirrored', isCameraMirrored ? 'true' : 'false');
      applyCameraMirror();
      showArToast(isCameraMirrored ? '🔄 Kamera: Cermin (Mirrored)' : '📷 Kamera: Normal (Non-Mirror)', 'info');
    }

    function applyCameraMirror() {
      const videoEl = arScene?.videoElement;
      if (videoEl) {
        videoEl.style.transform = isCameraMirrored ? 'scaleX(-1)' : 'none';
      }
      if (handTracker && handTracker.arenaConfig) {
        handTracker.arenaConfig.mirror = isCameraMirrored;
      }
      const btnScanMirror = document.getElementById('btn-scan-mirror');
      if (btnScanMirror) {
        btnScanMirror.innerHTML = `<span>🔄 Cermin: ${isCameraMirrored ? 'ON' : 'OFF'}</span>`;
      }
      const btnHudMirror = document.getElementById('btn-hud-mirror');
      if (btnHudMirror) {
        btnHudMirror.style.borderColor = isCameraMirrored ? '#38bdf8' : '';
        btnHudMirror.style.color = isCameraMirrored ? '#38bdf8' : '';
      }
    }

    function toggleFlowDirection() {
      flowDirection = flowDirection === 'up' ? 'down' : 'up';
      localStorage.setItem('ar_flow_direction', flowDirection);
      applyFlowDirection();
      showArToast(flowDirection === 'up' ? '⬆️ Alur Tuts: Bawah ke Atas' : '⬇️ Alur Tuts: Atas ke Bawah', 'info');
    }

    function applyFlowDirection() {
      const isUp = flowDirection === 'up';
      const scanDirText = document.getElementById('scan-direction-text');
      if (scanDirText) {
        scanDirText.innerText = isUp ? '⬆️ Alur: Bawah ke Atas' : '⬇️ Alur: Atas ke Bawah';
      }
      const btnHudDir = document.getElementById('btn-hud-direction');
      if (btnHudDir) {
        btnHudDir.innerText = isUp ? '⬆️' : '⬇️';
        btnHudDir.title = isUp ? 'Alur: Bawah ke Atas (Klik untuk ganti)' : 'Alur: Atas ke Bawah (Klik untuk ganti)';
      }
    }

    function tagChordsInChart(chart) {
      if (!chart || !Array.isArray(chart.notes)) return chart;
      const CHORD_TIME_WINDOW = 0.005; // 5ms — only truly simultaneous MIDI notes count as chords
      const notes = chart.notes;

      for (let i = 0; i < notes.length; i++) {
        const n = notes[i];
        if (n.type === 'chord' || Array.isArray(n.notes)) {
          n.isChord = true;
          n.chordSize = Array.isArray(n.notes) ? n.notes.length : 2;
          continue;
        }
        const sim = notes.filter(m => Math.abs(m.timeSec - n.timeSec) <= CHORD_TIME_WINDOW);
        if (sim.length >= 2) {
          n.isChord = true;
          n.chordSize = sim.length;
          n.type = 'chord';
          n.chordGroup = sim;
        } else {
          n.isChord = false;
        }
      }
      return chart;
    }

    function adaptChartToLanes(chart, targetLanes) {
      if (!chart) return chart;
      let adapted = chart;
      if (chart.lanes !== targetLanes) {
        const srcLanes = chart.lanes || 8;
        const adaptedNotes = (chart.notes || []).map(note => {
          const newLane = Math.min(targetLanes - 1, Math.max(0, Math.floor((note.lane / srcLanes) * targetLanes)));
          const subNotes = note.notes ? note.notes.map(sn => ({
            ...sn,
            lane: Math.min(targetLanes - 1, Math.max(0, Math.floor((sn.lane / srcLanes) * targetLanes)))
          })) : null;
          return {
            ...note,
            lane: newLane,
            hand: newLane < (targetLanes / 2) ? 'left' : 'right',
            notes: subNotes
          };
        });
        adapted = {
          ...chart,
          lanes: targetLanes,
          notes: adaptedNotes
        };
      }
      return tagChordsInChart(adapted);
    }

    async function prepareSongChart() {
      if (selectedSongId === 'imported_midi' && loadedCustomChart) {
        currentChart = adaptChartToLanes(loadedCustomChart, selectedLanes);
        tagChordsInChart(currentChart);
        arScene.setViewMode(currentViewMode);
        const titleEl = document.getElementById('hud-song-title');
        if (titleEl) titleEl.innerText = currentChart.title;
        return;
      }
      let songData = DEMO_SONGS[selectedSongId] || loadedSongData || DEMO_SONGS.demo_canon;
      const chartKey = selectedLanes >= 8 ? '8lane' : '4lane';
      const chartData = songData.charts ? (songData.charts[chartKey] || Object.values(songData.charts)[0]) : { lanes: selectedLanes, notes: [] };

      const parsed = parseSongChart(songData, chartData);
      currentChart = adaptChartToLanes(parsed, selectedLanes);
      tagChordsInChart(currentChart);
      arScene.setViewMode(currentViewMode);

      const titleEl = document.getElementById('hud-song-title');
      if (titleEl) titleEl.innerText = currentChart.title;
    }

    function startSongGameplay() {
      if (!currentChart) prepareSongChart();
      arUI.scoreManager.reset();
      arUI.updateScore(0, 0, 100);

      // Ensure AudioContext is initialized and resumed
      try {
        if (soundEngine) {
          if (!soundEngine.ctx) soundEngine.initAudio();
          else if (soundEngine.ctx.state === 'suspended' && typeof soundEngine.ctx.resume === 'function') {
            soundEngine.ctx.resume().catch(() => {});
          }
        }
      } catch (e) {}

      // Reset notes state
      if (currentChart && Array.isArray(currentChart.notes)) {
        for (const note of currentChart.notes) {
          note.spawned = false;
          note.played = false;
          note.missed = false;
          note.playedSound = false;
        }
      }

      songStartTimeSec = performance.now() / 1000;
      isPlaying = true;
      arUI.stateMachine.transition(UI_STATES.PLAYING);
    }

    function setupTouchLaneFallback() {
      // Screen tap fallback: In PLAYING, tap plays notes
      const container = document.getElementById('ar-container');
      container?.addEventListener('pointerdown', (e) => {
        if (!isPlaying || !currentChart) return;
        const rect = container.getBoundingClientRect();
        const normX = (e.clientX - rect.left) / rect.width;
        const tappedLane = Math.min(selectedLanes - 1, Math.max(0, Math.floor(normX * selectedLanes)));
        arScene.triggerKeyDepress(tappedLane);

        const currentTimeSec = (performance.now() / 1000) - songStartTimeSec;
        const mockPrev = { x: (normX - 0.5) * hitDetector.arenaWidth, y: 0, z: -0.05 };
        const mockCurr = { x: (normX - 0.5) * hitDetector.arenaWidth, y: 0, z: 0.05 };

        handleHitEvaluation(mockPrev, mockCurr, currentTimeSec);
      });
    }

    function setupCornerPointerHandlers() {
      if (!gestureCanvas) return;

      const getCornerAt = (x, y, radius = 55) => {
        if (!persistedCanvasCorners) return null;
        for (const key of ['p1', 'p2', 'p3', 'p4']) {
          const pt = persistedCanvasCorners[key];
          if (pt && Math.hypot(pt.x - x, pt.y - y) <= radius) {
            return key;
          }
        }
        return null;
      };

      gestureCanvas.addEventListener('pointerdown', (e) => {
        const currentState = arUI?.stateMachine?.getState();
        const rect = gestureCanvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        if (currentState === UI_STATES.SCAN_SURFACE) {
          if (!persistedCanvasCorners) {
            persistedCanvasCorners = getDefaultCanvasCorners(window.innerWidth, window.innerHeight);
          }
          const hitKey = getCornerAt(x, y, 60);
          if (hitKey) {
            pointerDraggingCorner = hitKey;
            try { gestureCanvas.setPointerCapture?.(e.pointerId); } catch (_) {}
            e.preventDefault();
            e.stopPropagation();
          }
          return;
        }

        if (isPlaying && currentChart) {
          const normX = x / rect.width;
          const tappedLane = Math.min(selectedLanes - 1, Math.max(0, Math.floor(normX * selectedLanes)));
          arScene.triggerKeyDepress(tappedLane);
          const currentTimeSec = (performance.now() / 1000) - songStartTimeSec;
          const mockPrev = { x: (normX - 0.5) * hitDetector.arenaWidth, y: 0, z: -0.05 };
          const mockCurr = { x: (normX - 0.5) * hitDetector.arenaWidth, y: 0, z: 0.05 };
          handleHitEvaluation(mockPrev, mockCurr, currentTimeSec);
        }
      });

      gestureCanvas.addEventListener('pointermove', (e) => {
        if (pointerDraggingCorner && persistedCanvasCorners) {
          const rect = gestureCanvas.getBoundingClientRect();
          const x = Math.max(15, Math.min(window.innerWidth - 15, e.clientX - rect.left));
          const y = Math.max(15, Math.min(window.innerHeight - 15, e.clientY - rect.top));
          persistedCanvasCorners[pointerDraggingCorner] = { x, y };
          saveCanvasCorners();
          e.preventDefault();
        }
      });

      const endDrag = (e) => {
        if (pointerDraggingCorner) {
          pointerDraggingCorner = null;
          try { gestureCanvas.releasePointerCapture?.(e.pointerId); } catch (_) {}
        }
      };
      gestureCanvas.addEventListener('pointerup', endDrag);
      gestureCanvas.addEventListener('pointercancel', endDrag);
    }

    function handleHitEvaluation(prevPos, currPos, currentTimeSec) {
      const hit = hitDetector.evaluateCrossingHit(prevPos, currPos, currentTimeSec, currentChart.notes);
      if (hit) {
        hit.note.played = true;
        hit.note.playedSound = true;
        soundEngine.playNote(hit.note.note || hit.note.midi, hit.note.durationSec);

        const scoreRes = arUI.scoreManager.recordHit(hit.judgement);
        arUI.showJudgement(hit.judgement, scoreRes.points);
        arUI.updateScore(arUI.scoreManager.score, arUI.scoreManager.combo, arUI.scoreManager.accuracy);

        const laneOrMidi = (arScene.viewMode === 'roll' && hit.note.midi) ? hit.note.midi : hit.lane;
        triggerKeyHitAnimation(laneOrMidi, hit.judgement, Boolean(hit.note.type === 'chord' || hit.note.isChord));
        arScene.triggerHitVFX(laneOrMidi, hit.judgement);
        arScene.setSpatialCombo(arUI.scoreManager.combo, hit.judgement);
        arScene.worldReaction.setCombo(arUI.scoreManager.combo);
      }
    }

    function handleChordSlam(currentTimeSec) {
      if (!currentChart || !isPlaying) return;
      const notes = currentChart.notes;
      const goodWin = hitDetector.goodWindowSec || 0.12;

      // In wait_chord mode, prioritize any chord currently stopping the song
      let hitCandidates = [];
      if (isWaitingForHit) {
        const waitingNote = notes.find(n => !n.played && !n.missed);
        if (waitingNote) {
          const targetTime = waitingNote.timeSec;
          hitCandidates = notes.filter(n => !n.played && !n.missed && Math.abs(n.timeSec - targetTime) <= 0.08);
        }
      }

      if (hitCandidates.length === 0) {
        hitCandidates = notes.filter(n =>
          !n.played && !n.missed &&
          Math.abs(n.timeSec - currentTimeSec) <= (goodWin * 1.8)
        );
      }

      if (hitCandidates.length > 0) {
        for (const note of hitCandidates) {
          note.played = true;
          note.playedSound = true;
          soundEngine.playNote(note.note || note.midi, note.durationSec || 0.4);
          const laneOrMidi = (arScene.viewMode === 'roll' && note.midi) ? note.midi : note.lane;
          triggerKeyHitAnimation(laneOrMidi, 'PERFECT', true);
          arScene.triggerHitVFX(laneOrMidi, 'PERFECT');
        }

        const scoreRes = arUI.scoreManager.recordHit('PERFECT', { isChord: true });
        arUI.showJudgement('PERFECT', scoreRes.points * hitCandidates.length);
        arUI.updateScore(arUI.scoreManager.score, arUI.scoreManager.combo, arUI.scoreManager.accuracy);
        arScene.setSpatialCombo(arUI.scoreManager.combo, '⚡ SLAM');
        arScene.worldReaction.setCombo(arUI.scoreManager.combo);

        // Flash HUD pill
        const slamBadge = document.getElementById('hud-slam-badge');
        if (slamBadge) {
          slamBadge.classList.add('active');
          setTimeout(() => slamBadge.classList.remove('active'), 220);
        }
      }
    }

    // Physical Spacebar for Chord Slam [Space]
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' || e.key === ' ') {
        if (isPlaying) {
          e.preventDefault();
          const currentTimeSec = (performance.now() / 1000) - songStartTimeSec;
          handleChordSlam(currentTimeSec);
        }
      }
    });

    // HUD Chord Slam pill click
    document.getElementById('hud-slam-badge')?.addEventListener('click', () => {
      if (isPlaying) {
        const currentTimeSec = (performance.now() / 1000) - songStartTimeSec;
        handleChordSlam(currentTimeSec);
      }
    });

    // Project normalized camera coordinates (or fallback arena coordinates) to exact screen pixels
    function getScreenPoint(camPt, fallbackPt, customW = window.innerWidth, customH = window.innerHeight) {
      const videoEl = arScene?.videoElement;
      const vw = (videoEl && videoEl.videoWidth) ? videoEl.videoWidth : 640;
      const vh = (videoEl && videoEl.videoHeight) ? videoEl.videoHeight : 480;
      const videoAspect = vw / vh;
      const screenAspect = customW / customH;

      let renderW, renderH, offsetX, offsetY;
      if (screenAspect > videoAspect) {
        renderW = customW;
        renderH = customW / videoAspect;
        offsetX = 0;
        offsetY = (customH - renderH) / 2;
      } else {
        renderH = customH;
        renderW = customH * videoAspect;
        offsetX = (customW - renderW) / 2;
        offsetY = 0;
      }

      if (camPt && typeof camPt.x === 'number' && typeof camPt.y === 'number') {
        const sx = offsetX + camPt.x * renderW;
        const sy = offsetY + camPt.y * renderH;
        return {
          x: Math.max(15, Math.min(customW - 15, sx)),
          y: Math.max(15, Math.min(customH - 15, sy))
        };
      }

      if (fallbackPt && typeof fallbackPt.x === 'number') {
        const nx = fallbackPt.x / 0.8 + 0.5;
        const ny = 0.5 - fallbackPt.y / 0.6;
        return {
          x: Math.max(15, Math.min(customW - 15, nx * customW)),
          y: Math.max(15, Math.min(customH - 15, ny * customH))
        };
      }

      return null;
    }

    // Maps a screen coordinate {x, y} to a musical lane index [0..numLanes-1] on the calibrated desk canvas
    function getLaneFromScreenPoint(pt, corners, numLanes = 8) {
      if (!pt || !corners) return -1;
      const { p1, p2, p3, p4 } = corners;
      if (!p1 || !p2 || !p3 || !p4) return -1;

      // Depth vector from back (p1..p2) to front (p4..p3)
      const topMidX = (p1.x + p2.x) / 2;
      const topMidY = (p1.y + p2.y) / 2;
      const botMidX = (p4.x + p3.x) / 2;
      const botMidY = (p4.y + p3.y) / 2;

      const dyX = botMidX - topMidX;
      const dyY = botMidY - topMidY;
      const depthSq = dyX * dyX + dyY * dyY || 1;

      // v is position along depth axis (0 at Hit Line p1..p2, 1 at front p4..p3)
      const v = ((pt.x - topMidX) * dyX + (pt.y - topMidY) * dyY) / depthSq;

      // Generous vertical tolerance [-0.7 to 2.2] so fingers resting, hovering or pressing are captured
      if (v < -0.7 || v > 2.2) return -1;

      const clampedV = Math.max(0, Math.min(1, v));
      // Interpolate left and right boundaries at depth v
      const lx = p1.x + (p4.x - p1.x) * clampedV;
      const ly = p1.y + (p4.y - p1.y) * clampedV;
      const rx = p2.x + (p3.x - p2.x) * clampedV;
      const ry = p2.y + (p3.y - p2.y) * clampedV;

      const spanX = rx - lx;
      const spanY = ry - ly;
      const spanSq = spanX * spanX + spanY * spanY || 1;

      // u is position along width [0.0..1.0] from Left to Right
      const u = ((pt.x - lx) * spanX + (pt.y - ly) * spanY) / spanSq;

      // Generous horizontal tolerance on left & right edges (-0.1 to 1.1)
      if (u < -0.1 || u > 1.1) return -1;

      const clampedU = Math.max(0, Math.min(0.999, u));
      return Math.floor(clampedU * numLanes);
    }

    function getDefaultCanvasCorners(w, h) {
      // Shallow piano keyboard strip matching physical instrument on desk
      const deskW = Math.min(w * 0.72, 520);
      const deskH = Math.max(90, deskW * 0.22);
      const midX = w / 2;
      const midY = h * 0.60;
      const topY = midY - deskH / 2;
      const botY = midY + deskH / 2;
      const inset = deskW * 0.04;
      return {
        p1: { x: midX - deskW / 2 + inset, y: topY },
        p2: { x: midX + deskW / 2 - inset, y: topY },
        p3: { x: midX + deskW / 2, y: botY },
        p4: { x: midX - deskW / 2, y: botY }
      };
    }

    // Global user interaction listeners to unlock Web Audio on first gesture
    ['pointerdown', 'touchstart', 'click', 'keydown'].forEach(evt => {
      window.addEventListener(evt, () => {
        if (soundEngine) {
          if (!soundEngine.ctx) soundEngine.initAudio();
          else if (soundEngine.ctx.state === 'suspended' && typeof soundEngine.ctx.resume === 'function') {
            soundEngine.ctx.resume().catch(() => {});
          }
        }
      }, { passive: true });
    });

    // 2-Octave Piano MIDI definitions (C3 = 48 to B4 = 71)
    const WHITE_KEY_MIDIS = [48, 50, 52, 53, 55, 57, 59, 60, 62, 64, 65, 67, 69, 71];
    const BLACK_KEY_MIDIS = {
      0: 49,
      1: 51,
      3: 54,
      4: 56,
      5: 58,
      7: 61,
      8: 63,
      10: 66,
      11: 68,
      12: 70
    };

    // Active key hit animation system (depression sink, radiant glow, laser pillar, shockwave ring)
    const activeKeyAnimations = new Map();

    function triggerKeyHitAnimation(keyId, judgement = 'PERFECT', isChord = false) {
      if (keyId === undefined || keyId === null) return;
      const now = performance.now();
      activeKeyAnimations.set(String(keyId), {
        startTime: now,
        judgement,
        isChord,
        durationMs: 360
      });
    }

    function getActiveKeyHit(keyId) {
      if (keyId === undefined || keyId === null) return null;
      const anim = activeKeyAnimations.get(String(keyId));
      if (!anim) return null;
      const elapsed = performance.now() - anim.startTime;
      if (elapsed >= anim.durationMs) {
        activeKeyAnimations.delete(String(keyId));
        return null;
      }
      return {
        progress: elapsed / anim.durationMs,
        judgement: anim.judgement,
        isChord: anim.isChord
      };
    }

    function renderRealHandsOnKeyboard(ctx, hands, width, height, corners) {
      if (!ctx || !Array.isArray(hands) || hands.length === 0 || !corners) return;
      const { p1, p2, p3, p4 } = corners;
      if (!p1 || !p2 || !p3 || !p4) return;

      const minKeyY = Math.min(p1.y, p2.y) - 30;
      const maxKeyY = Math.max(p3.y, p4.y) + 40;
      const minKeyX = Math.min(p1.x, p4.x) - 40;
      const maxKeyX = Math.max(p2.x, p3.x) + 40;

      ctx.save();
      // 1. Clip strictly to the virtual piano keyboard & immediate runway border
      // This ensures 100% zero side effects, shadows, or cutouts on the physical desk outside the keys
      ctx.beginPath();
      ctx.moveTo(p1.x - 20, p1.y - 20);
      ctx.lineTo(p2.x + 20, p2.y - 20);
      ctx.lineTo(p3.x + 20, p3.y + 35);
      ctx.lineTo(p4.x - 20, p4.y + 35);
      ctx.closePath();
      ctx.clip();

      // 2. Punch through virtual key overlay so real webcam feed of hands shines through
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = '#000000';
      ctx.strokeStyle = '#000000';

      const FINGER_CHAINS = [
        { chain: [1, 2, 3, 4], width: 34 },      // Thumb
        { chain: [5, 6, 7, 8], width: 28 },      // Index
        { chain: [9, 10, 11, 12], width: 28 },   // Middle
        { chain: [13, 14, 15, 16], width: 26 },  // Ring
        { chain: [17, 18, 19, 20], width: 23 }   // Pinky
      ];

      for (const hand of hands) {
        const rawPts = hand.cameraLandmarks || hand.rawLandmarks;
        if (!rawPts || rawPts.length < 21) continue;

        const screenPts = rawPts.map(pt => {
          if (hand.cameraLandmarks) {
            return getScreenPoint(pt, null, width, height);
          }
          const camPt = {
            x: isCameraMirrored ? (1.0 - (pt.x ?? 0.5)) : (pt.x ?? 0.5),
            y: pt.y ?? 0.5
          };
          return getScreenPoint(camPt, null, width, height);
        });

        if (!screenPts[0] || !screenPts[9]) continue;

        // Overlap test: does hand intersect keyboard bounds?
        const hasOverlap = screenPts.some(pt => pt && pt.x >= minKeyX && pt.x <= maxKeyX && pt.y >= minKeyY && pt.y <= maxKeyY);
        if (!hasOverlap) continue;

        const palmDist = Math.hypot(screenPts[0].x - screenPts[9].x, screenPts[0].y - screenPts[9].y);
        const scale = Math.max(0.75, Math.min(1.45, palmDist / 95));

        // A. Palm Base Polygon
        ctx.beginPath();
        ctx.moveTo(screenPts[0].x, screenPts[0].y);
        ctx.lineTo(screenPts[1].x, screenPts[1].y);
        ctx.lineTo(screenPts[5].x, screenPts[5].y);
        ctx.lineTo(screenPts[9].x, screenPts[9].y);
        ctx.lineTo(screenPts[13].x, screenPts[13].y);
        ctx.lineTo(screenPts[17].x, screenPts[17].y);
        ctx.closePath();
        ctx.fill();

        // Palm interior flesh
        ctx.beginPath();
        ctx.moveTo(screenPts[0].x, screenPts[0].y);
        ctx.lineTo(screenPts[5].x, screenPts[5].y);
        ctx.lineTo(screenPts[17].x, screenPts[17].y);
        ctx.closePath();
        ctx.fill();

        // B. 5 Rounded Finger Segments
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        for (const { chain, width: baseW } of FINGER_CHAINS) {
          const segW = baseW * scale;
          ctx.lineWidth = segW;
          ctx.beginPath();
          ctx.moveTo(screenPts[chain[0]].x, screenPts[chain[0]].y);
          for (let i = 1; i < chain.length; i++) {
            ctx.lineTo(screenPts[chain[i]].x, screenPts[chain[i]].y);
          }
          ctx.stroke();

          // Smooth rounded joint & tip circles
          for (const idx of chain) {
            ctx.beginPath();
            ctx.arc(screenPts[idx].x, screenPts[idx].y, segW / 2, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }

      ctx.restore();
    }

    /**
     * Draws the 2D Spatial Gesture Overlay:
     * - Animated holographic table rectangle spanning between user hands
     * - Dynamic corner brackets [ ] and neon dashed borders
     * - Real-time centimeter width badge (e.g. 📏 LEBAR ARENA: 85 cm)
     * - Hands-free Dwell Lock countdown ring (🔒 100%)
     * - Pinch indicators (👌 PINCH) with golden sparks
     * - Interactive Piano Tiles / Real Piano keys matching calibrated desk canvas
     * - Descending neon falling notes (tuts jatoh) streaming to Hit Line
     * - Hit Line positioned slightly above tiles for crystal-clear PERFECT timing
     * - 10-finger holographic energy rings (Thumb, Index, Mid, Ring, Pinky on both hands)
     */
    function drawGestureOverlay(ctx, hands, width, height, state, span, arenaWidth, laneCount, lockProgress = 0, chart = null, currentTimeSec = 0, viewMode = 'tiles') {
      ctx.clearRect(0, 0, width, height);
      const time = performance.now();
      const videoEl = arScene?.videoElement;

      // Helper to draw corner brackets [ ] oriented along box edges
      function drawCornerBrackets(pts, bracketLen = 26, strokeColor = '#facc15') {
        const [p1, p2, p3, p4] = pts;
        ctx.save();
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = 3.5;
        ctx.lineCap = 'round';
        ctx.shadowColor = strokeColor;
        ctx.shadowBlur = 14;

        // Front edge unit vector (p4 -> p3)
        const fdx = p3.x - p4.x;
        const fdy = p3.y - p4.y;
        const flen = Math.hypot(fdx, fdy) || 1;
        const fux = fdx / flen;
        const fuy = fdy / flen;

        // Left edge unit vector (p4 -> p1)
        const ldx = p1.x - p4.x;
        const ldy = p1.y - p4.y;
        const llen = Math.hypot(ldx, ldy) || 1;
        const lux = ldx / llen;
        const luy = ldy / llen;

        // Right edge unit vector (p3 -> p2)
        const rdx = p2.x - p3.x;
        const rdy = p2.y - p3.y;
        const rlen = Math.hypot(rdx, rdy) || 1;
        const rux = rdx / rlen;
        const ruy = rdy / rlen;

        // Top edge unit vector (p1 -> p2)
        const tdx = p2.x - p1.x;
        const tdy = p2.y - p1.y;
        const tlen = Math.hypot(tdx, tdy) || 1;
        const tux = tdx / tlen;
        const tuy = tdy / tlen;

        // Bottom-Left (p4) - EXACT Left Pinch Point
        ctx.beginPath();
        ctx.moveTo(p4.x + fux * bracketLen, p4.y + fuy * bracketLen);
        ctx.lineTo(p4.x, p4.y);
        ctx.lineTo(p4.x + lux * bracketLen, p4.y + luy * bracketLen);
        ctx.stroke();

        // Bottom-Right (p3) - EXACT Right Pinch Point
        ctx.beginPath();
        ctx.moveTo(p3.x - fux * bracketLen, p3.y - fuy * bracketLen);
        ctx.lineTo(p3.x, p3.y);
        ctx.lineTo(p3.x + rux * bracketLen, p3.y + ruy * bracketLen);
        ctx.stroke();

        // Top-Left (p1)
        ctx.beginPath();
        ctx.moveTo(p1.x + tux * bracketLen, p1.y + tuy * bracketLen);
        ctx.lineTo(p1.x, p1.y);
        ctx.lineTo(p1.x - lux * bracketLen, p1.y - luy * bracketLen);
        ctx.stroke();

        // Top-Right (p2)
        ctx.beginPath();
        ctx.moveTo(p2.x - tux * bracketLen, p2.y - tuy * bracketLen);
        ctx.lineTo(p2.x, p2.y);
        ctx.lineTo(p2.x - rux * bracketLen, p2.y - ruy * bracketLen);
        ctx.stroke();

        ctx.restore();
      }

      // 1. STATE: SCAN_SURFACE (Dynamic 2-Hand Canvas Creation & 4-Corner 1-Hand Pinch Calibration)
      if (state === UI_STATES.SCAN_SURFACE) {
        if (!persistedCanvasCorners) {
          persistedCanvasCorners = getDefaultCanvasCorners(width, height);
        }
        const { p1, p2, p3, p4 } = persistedCanvasCorners;

        // 1a. High-contrast translucent acrylic desk canvas quad
        ctx.save();
        const bgGrad = ctx.createLinearGradient((p1.x + p4.x) / 2, (p1.y + p4.y) / 2, (p2.x + p3.x) / 2, (p2.y + p3.y) / 2);
        bgGrad.addColorStop(0, 'rgba(11, 15, 25, 0.88)');
        bgGrad.addColorStop(0.5, 'rgba(15, 23, 42, 0.85)');
        bgGrad.addColorStop(1, 'rgba(11, 15, 25, 0.88)');
        ctx.fillStyle = bgGrad;
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.lineTo(p3.x, p3.y);
        ctx.lineTo(p4.x, p4.y);
        ctx.closePath();
        ctx.fill();
        ctx.restore();

        // 1b. Piano Keys / Tiles preview inside the quad
        const getPreviewPoint = (u, v) => {
          const tx = p1.x + u * (p2.x - p1.x);
          const ty = p1.y + u * (p2.y - p1.y);
          const bx = p4.x + u * (p3.x - p4.x);
          const by = p4.y + u * (p3.y - p4.y);
          return {
            x: tx + v * (bx - tx),
            y: ty + v * (by - ty)
          };
        };

        if (viewMode === 'roll') {
          // Preview 14 white keys & 10 black keys
          const numWhite = 14;
          for (let k = 0; k < numWhite; k++) {
            const u0 = (k / numWhite) + 0.005;
            const u1 = ((k + 1) / numWhite) - 0.005;
            const kwTL = getPreviewPoint(u0, 0);
            const kwTR = getPreviewPoint(u1, 0);
            const kwBR = getPreviewPoint(u1, 1.0);
            const kwBL = getPreviewPoint(u0, 1.0);
            ctx.save();
            const keyGrad = ctx.createLinearGradient((kwTL.x + kwTR.x) / 2, (kwTL.y + kwTR.y) / 2, (kwBL.x + kwBR.x) / 2, (kwBL.y + kwBR.y) / 2);
            keyGrad.addColorStop(0, '#ffffff');
            keyGrad.addColorStop(0.8, '#f1f5f9');
            keyGrad.addColorStop(1, '#cbd5e1');
            ctx.fillStyle = keyGrad;
            ctx.strokeStyle = '#475569';
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.moveTo(kwTL.x, kwTL.y);
            ctx.lineTo(kwTR.x, kwTR.y);
            ctx.lineTo(kwBR.x, kwBR.y);
            ctx.lineTo(kwBL.x, kwBL.y);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            ctx.restore();
          }
          const blackIndices = [0, 1, 3, 4, 5, 7, 8, 10, 11, 12];
          for (const bIdx of blackIndices) {
            if (bIdx + 1 < numWhite) {
              const midU = (bIdx + 1) / numWhite;
              const kbTL = getPreviewPoint(midU - 0.022, 0);
              const kbTR = getPreviewPoint(midU + 0.022, 0);
              const kbBR = getPreviewPoint(midU + 0.022, 0.62);
              const kbBL = getPreviewPoint(midU - 0.022, 0.62);
              ctx.save();
              ctx.fillStyle = '#090d16';
              ctx.strokeStyle = '#64748b';
              ctx.lineWidth = 1.2;
              ctx.shadowColor = 'rgba(0, 0, 0, 0.65)';
              ctx.shadowBlur = 6;
              ctx.beginPath();
              ctx.moveTo(kbTL.x, kbTL.y);
              ctx.lineTo(kbTR.x, kbTR.y);
              ctx.lineTo(kbBR.x, kbBR.y);
              ctx.lineTo(kbBL.x, kbBL.y);
              ctx.closePath();
              ctx.fill();
              ctx.stroke();
              ctx.restore();
            }
          }
        } else {
          // Preview Tiles Pads
          const numLanes = laneCount || 4;
          for (let l = 0; l < numLanes; l++) {
            const isLeft = l < (numLanes / 2);
            const u0 = (l / numLanes) + 0.015;
            const u1 = ((l + 1) / numLanes) - 0.015;
            const pTL = getPreviewPoint(u0, 0);
            const pTR = getPreviewPoint(u1, 0);
            const pBR = getPreviewPoint(u1, 1.0);
            const pBL = getPreviewPoint(u0, 1.0);
            ctx.save();
            const padGrad = ctx.createLinearGradient((pTL.x + pTR.x) / 2, (pTL.y + pTR.y) / 2, (pBL.x + pBR.x) / 2, (pBL.y + pBR.y) / 2);
            padGrad.addColorStop(0, '#1e293b');
            padGrad.addColorStop(0.4, '#0f172a');
            padGrad.addColorStop(1, '#020617');
            ctx.fillStyle = padGrad;
            ctx.strokeStyle = '#f8fafc';
            ctx.lineWidth = 2;
            ctx.shadowColor = 'rgba(255, 255, 255, 0.35)';
            ctx.shadowBlur = 8;
            ctx.beginPath();
            ctx.moveTo(pTL.x, pTL.y);
            ctx.lineTo(pTR.x, pTR.y);
            ctx.lineTo(pBR.x, pBR.y);
            ctx.lineTo(pBL.x, pBL.y);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            const padMidX = (pTL.x + pTR.x + pBL.x + pBR.x) / 4;
            const padMidY = (pTL.y + pTR.y + pBL.y + pBR.y) / 4;
            ctx.shadowBlur = 0;
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 13px "Outfit", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            const laneLabel = isLeft ? `L${l + 1}` : `R${l - Math.floor(numLanes / 2) + 1}`;
            ctx.fillText(laneLabel, padMidX, padMidY);
            ctx.restore();
          }
        }

        // 1c. Animated Glowing Dashed Border
        ctx.save();
        ctx.strokeStyle = lockProgress > 0 ? '#facc15' : '#38bdf8';
        ctx.lineWidth = lockProgress > 0 ? 3.5 : 2.5;
        ctx.shadowColor = lockProgress > 0 ? '#facc15' : '#38bdf8';
        ctx.shadowBlur = lockProgress > 0 ? 18 : 12;
        ctx.setLineDash([12, 8]);
        ctx.lineDashOffset = -time / 30;
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.lineTo(p3.x, p3.y);
        ctx.lineTo(p4.x, p4.y);
        ctx.closePath();
        ctx.stroke();
        ctx.restore();

        // 1d. Hit Line at back of keys (p1 to p2)
        ctx.save();
        ctx.strokeStyle = '#facc15';
        ctx.lineWidth = 4;
        ctx.shadowColor = '#facc15';
        ctx.shadowBlur = 16;
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();

        ctx.font = 'bold 11px "Outfit", sans-serif';
        ctx.fillStyle = '#facc15';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText('⚡ HIT LINE', p1.x - 10, p1.y);
        ctx.textAlign = 'left';
        ctx.fillText('PERFECT ⚡', p2.x + 10, p2.y);
        ctx.restore();

        // 1e. Corner Brackets [ ]
        drawCornerBrackets([p1, p2, p3, p4], 24, '#facc15');

        // 1f. Connecting Laser Line between hands (from p4 to p3)
        ctx.save();
        const isDraggingCorner = Boolean(pointerDraggingCorner || handDraggingCorner.Left || handDraggingCorner.Right);
        ctx.strokeStyle = isDraggingCorner ? '#facc15' : 'rgba(56, 189, 248, 0.85)';
        ctx.lineWidth = 2.5;
        ctx.shadowColor = '#38bdf8';
        ctx.shadowBlur = 10;
        ctx.setLineDash([8, 6]);
        ctx.lineDashOffset = -time / 20;
        ctx.beginPath();
        ctx.moveTo(p4.x, p4.y);
        ctx.lineTo(p3.x, p3.y);
        ctx.stroke();
        ctx.restore();

        // 1g. Floating Centimeter Width & Arena Badge
        const spanDistPx = Math.hypot(p3.x - p4.x, p3.y - p4.y);
        const spanCm = Math.round((spanDistPx / width) * 160);
        const badgeCenterX = (p1.x + p2.x) / 2;
        const badgeY = Math.max(38, (p1.y + p2.y) / 2 - 32);

        ctx.save();
        const badgeText = lockProgress > 0
          ? `🔒 MENGUNCI ARENA (${Math.round(lockProgress * 100)}%)`
          : `✨ KANVAS PIANO MEJA • 📏 ${spanCm} cm`;
        ctx.font = 'bold 14px "Outfit", system-ui, sans-serif';
        const metrics = ctx.measureText(badgeText);
        const badgeW = Math.max(220, metrics.width + 36);
        const badgeH = 34;

        ctx.fillStyle = 'rgba(11, 15, 25, 0.94)';
        ctx.strokeStyle = lockProgress > 0 ? '#facc15' : '#38bdf8';
        ctx.lineWidth = lockProgress > 0 ? 2.5 : 1.5;
        ctx.shadowColor = lockProgress > 0 ? '#facc15' : '#38bdf8';
        ctx.shadowBlur = 12;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(badgeCenterX - badgeW / 2, badgeY - badgeH / 2, badgeW, badgeH, 17);
        else ctx.rect(badgeCenterX - badgeW / 2, badgeY - badgeH / 2, badgeW, badgeH);
        ctx.fill();
        ctx.stroke();

        if (lockProgress > 0) {
          const fillW = (badgeW - 6) * lockProgress;
          ctx.fillStyle = 'rgba(250, 204, 21, 0.35)';
          ctx.beginPath();
          if (ctx.roundRect) ctx.roundRect(badgeCenterX - badgeW / 2 + 3, badgeY - badgeH / 2 + 3, fillW, badgeH - 6, 14);
          else ctx.rect(badgeCenterX - badgeW / 2 + 3, badgeY - badgeH / 2 + 3, fillW, badgeH - 6);
          ctx.fill();
        }

        ctx.shadowBlur = 0;
        ctx.fillStyle = lockProgress > 0 ? '#facc15' : '#f8fafc';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(badgeText, badgeCenterX, badgeY);
        ctx.restore();


        // 1h. Render the 4 Draggable Corner Handles (TL, TR, BR, BL)
        const cornerHandles = [
          { key: 'p1', pt: p1, name: 'TL', label: 'Kiri Atas', defaultColor: '#38bdf8' },
          { key: 'p2', pt: p2, name: 'TR', label: 'Kanan Atas', defaultColor: '#818cf8' },
          { key: 'p3', pt: p3, name: 'BR', label: 'Kanan Bawah', defaultColor: '#ec4899' },
          { key: 'p4', pt: p4, name: 'BL', label: 'Kiri Bawah', defaultColor: '#facc15' }
        ];

        for (const h of cornerHandles) {
          const isPointerDrag = pointerDraggingCorner === h.key;
          const isHandDrag = (handDraggingCorner.Left === h.key) || (handDraggingCorner.Right === h.key);
          const isDragged = isPointerDrag || isHandDrag;
          const handleColor = isDragged ? '#facc15' : h.defaultColor;
          const ringR = isDragged ? 24 : 17;

          ctx.save();
          // Outer glowing target ring
          ctx.beginPath();
          ctx.arc(h.pt.x, h.pt.y, ringR, 0, Math.PI * 2);
          ctx.strokeStyle = handleColor;
          ctx.lineWidth = isDragged ? 4.0 : 2.5;
          ctx.shadowColor = handleColor;
          ctx.shadowBlur = isDragged ? 22 : 12;
          ctx.stroke();

          // Pulsing aura when dragged
          if (isDragged) {
            ctx.beginPath();
            ctx.arc(h.pt.x, h.pt.y, ringR + 8 + Math.sin(time / 100) * 4, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(250, 204, 21, 0.4)';
            ctx.lineWidth = 2;
            ctx.stroke();
          }

          // Center solid target dot
          ctx.beginPath();
          ctx.arc(h.pt.x, h.pt.y, isDragged ? 6 : 4.5, 0, Math.PI * 2);
          ctx.fillStyle = '#ffffff';
          ctx.fill();

          // Badge Pill
          const badgeText = isDragged ? `✊ GESER ${h.name}` : `👌 ${h.name} (${h.label})`;
          ctx.font = 'bold 11px "Outfit", sans-serif';
          const bw = ctx.measureText(badgeText).width + 18;
          const bh = 22;
          const by = (h.key === 'p1' || h.key === 'p2') ? (h.pt.y - 28) : (h.pt.y + 16);
          const bx = h.pt.x - bw / 2;

          ctx.fillStyle = 'rgba(11, 15, 25, 0.92)';
          ctx.strokeStyle = handleColor;
          ctx.lineWidth = 1.2;
          ctx.shadowBlur = 6;
          ctx.beginPath();
          if (ctx.roundRect) ctx.roundRect(bx, by, bw, bh, 6);
          else ctx.rect(bx, by, bw, bh);
          ctx.fill();
          ctx.stroke();

          ctx.shadowBlur = 0;
          ctx.fillStyle = isDragged ? '#facc15' : '#f8fafc';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(badgeText, h.pt.x, by + bh / 2);
          ctx.restore();
        }

        // 1i. Render Hand Tracking & Pinch Beams
        if (hands && hands.length > 0) {
          for (const hand of hands) {
            const handKey = hand.handedness || 'Right';
            const isLeft = handKey === 'Left';
            const accentColor = isLeft ? '#ec4899' : '#06b6d4';

            const indexPt = getScreenPoint(hand.cameraIndexTip, hand.indexTip);
            const thumbPt = getScreenPoint(hand.cameraThumbTip, hand.thumbTip);
            if (!indexPt) continue;

            const screenDist = thumbPt ? Math.hypot(indexPt.x - thumbPt.x, indexPt.y - thumbPt.y) : 999;
            const isPinching = Boolean(hand.isPinching || screenDist < 60);
            const pinchPt = (thumbPt && isPinching)
              ? { x: (indexPt.x + thumbPt.x) / 2, y: (indexPt.y + thumbPt.y) / 2 }
              : indexPt;

            ctx.save();
            // Fingertip dots
            ctx.beginPath();
            ctx.arc(indexPt.x, indexPt.y, 10, 0, Math.PI * 2);
            ctx.fillStyle = accentColor;
            ctx.shadowColor = accentColor;
            ctx.shadowBlur = 10;
            ctx.fill();

            if (thumbPt) {
              ctx.beginPath();
              ctx.arc(thumbPt.x, thumbPt.y, 8, 0, Math.PI * 2);
              ctx.fillStyle = accentColor;
              ctx.fill();

              // Connecting line
              ctx.beginPath();
              ctx.moveTo(indexPt.x, indexPt.y);
              ctx.lineTo(thumbPt.x, thumbPt.y);
              ctx.strokeStyle = isPinching ? '#facc15' : 'rgba(255, 255, 255, 0.4)';
              ctx.lineWidth = isPinching ? 3.5 : 1.5;
              if (!isPinching) ctx.setLineDash([4, 4]);
              ctx.stroke();
            }

            // Pinch Indicator
            if (isPinching) {
              ctx.beginPath();
              ctx.arc(pinchPt.x, pinchPt.y, 12, 0, Math.PI * 2);
              ctx.fillStyle = '#facc15';
              ctx.shadowColor = '#facc15';
              ctx.shadowBlur = 16;
              ctx.fill();

              // Tether beam to dragged corner if active
              const draggedCornerKey = handDraggingCorner[handKey];
              if (draggedCornerKey && persistedCanvasCorners[draggedCornerKey]) {
                const cPt = persistedCanvasCorners[draggedCornerKey];
                ctx.beginPath();
                ctx.moveTo(pinchPt.x, pinchPt.y);
                ctx.lineTo(cPt.x, cPt.y);
                ctx.strokeStyle = '#facc15';
                ctx.lineWidth = 3;
                ctx.setLineDash([6, 4]);
                ctx.stroke();
              }

              // PINCH badge
              const pbW = 64;
              const pbH = 20;
              ctx.fillStyle = 'rgba(250, 204, 21, 0.95)';
              ctx.shadowBlur = 6;
              ctx.beginPath();
              if (ctx.roundRect) ctx.roundRect(pinchPt.x - pbW / 2, pinchPt.y - 26, pbW, pbH, 5);
              else ctx.rect(pinchPt.x - pbW / 2, pinchPt.y - 26, pbW, pbH);
              ctx.fill();

              ctx.shadowBlur = 0;
              ctx.fillStyle = '#0f172a';
              ctx.font = 'bold 10px "Outfit", sans-serif';
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.fillText('👌 PINCH', pinchPt.x, pinchPt.y - 16);
            }
            ctx.restore();
          }
        }

        // 1j. 3-Second Dwell Hold Countdown Ring in Center of Keyboard
        if (lockProgress > 0) {
          ctx.save();
          const lockRingRadius = 34;
          const lockRingX = (p1.x + p2.x + p3.x + p4.x) / 4;
          const lockRingY = (p1.y + p2.y + p3.y + p4.y) / 4;

          // Background disc
          ctx.fillStyle = 'rgba(11, 15, 25, 0.92)';
          ctx.beginPath();
          ctx.arc(lockRingX, lockRingY, lockRingRadius + 10, 0, Math.PI * 2);
          ctx.fill();

          // Track ring
          ctx.beginPath();
          ctx.arc(lockRingX, lockRingY, lockRingRadius, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
          ctx.lineWidth = 5;
          ctx.stroke();

          // Gold progress arc (3.0s dwell)
          ctx.beginPath();
          ctx.arc(lockRingX, lockRingY, lockRingRadius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * lockProgress);
          ctx.strokeStyle = '#facc15';
          ctx.lineWidth = 6;
          ctx.lineCap = 'round';
          ctx.shadowColor = '#facc15';
          ctx.shadowBlur = 18;
          ctx.stroke();

          ctx.shadowBlur = 0;
          ctx.font = 'bold 14px "Outfit", sans-serif';
          ctx.fillStyle = '#facc15';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(`🔒 ${Math.round(lockProgress * 100)}%`, lockRingX, lockRingY);
          ctx.restore();
        }

        // 1k. Guidance Floating Pill at bottom
        ctx.save();
        const isDraggingAny = Boolean(pointerDraggingCorner || handDraggingCorner.Left || handDraggingCorner.Right);
        let guidanceText = '';
        if (isDraggingAny) {
          guidanceText = '✊ Geser sudut ke posisi meja yang pas, lalu lepas cubitan';
        } else if (lockProgress > 0) {
          guidanceText = `🔒 TAHAN POSISI (${Math.round(lockProgress * 100)}%)... Mengunci kanvas meja!`;
        } else {
          guidanceText = '✨ Rentangkan 2 tangan di meja untuk atur kanvas • Tahan diam 3 detik untuk KUNCI';
        }

        ctx.font = '600 13px "Inter", sans-serif';
        const gw = ctx.measureText(guidanceText).width + 32;
        const gh = 30;
        const gx = width / 2;
        const gy = Math.min(height - 30, Math.max(p3.y, p4.y) + 36);

        ctx.fillStyle = 'rgba(11, 15, 25, 0.92)';
        ctx.strokeStyle = lockProgress > 0 ? '#facc15' : 'rgba(56, 189, 248, 0.6)';
        ctx.lineWidth = lockProgress > 0 ? 2 : 1;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(gx - gw / 2, gy - gh / 2, gw, gh, 15);
        else ctx.rect(gx - gw / 2, gy - gh / 2, gw, gh);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = lockProgress > 0 ? '#facc15' : '#f8fafc';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(guidanceText, gx, gy);
        ctx.restore();
      }

      // 2. STATE: PLAYING & COUNTDOWN (Full Interactive AR Piano Tiles Arena on Calibrated Desk Canvas)
      if (state === UI_STATES.PLAYING || state === UI_STATES.COUNTDOWN) {
        const corners = persistedCanvasCorners || getDefaultCanvasCorners(width, height);
        const { p1, p2, p3, p4 } = corners;
        const numLanes = selectedLanes || 4;

        // Perspective projection algorithm:
        // t = 0.0 is the Hit Line at the back edge of the piano keyboard (p1 -> p2)
        // t = 1.0 is the front edge of the piano keyboard (p4 -> p3)
        // t < 0.0 is the runway OUTSIDE the canvas extending upwards/backwards into background
        const getPerspectivePoint = (u, t) => {
          const lx = p1.x + (p4.x - p1.x) * t;
          const ly = p1.y + (p4.y - p1.y) * t;
          const rx = p2.x + (p3.x - p2.x) * t;
          const ry = p2.y + (p3.y - p2.y) * t;
          return {
            x: (1 - u) * lx + u * rx,
            y: (1 - u) * ly + u * ry
          };
        };

        const isUp = flowDirection === 'up';
        const travelDuration = arScene?.travelDurationSec || 2.2;

        // 2a. Perspective Runway OUTSIDE the Canvas (where notes stream into the keys)
        // In 'up' mode: runway extends towards the player up to t = 3.2
        // In 'down' mode: runway extends into distance up to t = -3.0
        ctx.save();
        const runwayT = isUp ? 3.2 : -3.0;
        const spawnL = getPerspectivePoint(0, runwayT);
        const spawnR = getPerspectivePoint(1.0, runwayT);

        // Faint outer runway guide rails
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.35)';
        ctx.lineWidth = 1.8;
        ctx.setLineDash([8, 6]);
        ctx.beginPath();
        ctx.moveTo(spawnL.x, spawnL.y);
        ctx.lineTo(isUp ? p4.x : p1.x, isUp ? p4.y : p1.y);
        ctx.moveTo(spawnR.x, spawnR.y);
        ctx.lineTo(isUp ? p3.x : p2.x, isUp ? p3.y : p2.y);
        ctx.stroke();

        // Faint perspective lane divider tracks streaming to the keys
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
        ctx.lineWidth = 1.2;
        ctx.setLineDash([4, 6]);
        for (let i = 1; i < numLanes; i++) {
          const u = i / numLanes;
          const sPt = getPerspectivePoint(u, runwayT);
          const ePt = getPerspectivePoint(u, isUp ? 1.0 : 0.0);
          ctx.beginPath();
          ctx.moveTo(sPt.x, sPt.y);
          ctx.lineTo(ePt.x, ePt.y);
          ctx.stroke();
        }

        // Spawn portal line in the distance
        ctx.strokeStyle = 'rgba(129, 140, 248, 0.75)';
        ctx.lineWidth = 2.5;
        ctx.setLineDash([]);
        ctx.shadowColor = '#818cf8';
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.moveTo(spawnL.x, spawnL.y);
        ctx.lineTo(spawnR.x, spawnR.y);
        ctx.stroke();
        ctx.restore();

        // 2b. Falling Notes (Tuts yang Akan Datang) - Streaming from OUTSIDE canvas into keys
        if (chart && Array.isArray(chart.notes)) {
          for (const note of chart.notes) {
            const timeUntilHit = note.timeSec - currentTimeSec;
            const progress = 1.0 - (timeUntilHit / travelDuration); // 0 at spawn outside, 1 at Hit Line

            const noteT = isUp ? (1.0 + 2.2 * (1.0 - progress)) : (-3.0 * (1.0 - progress));
            const isChord = note.type === 'chord' || Boolean(note.isChord) || Boolean(note.notes);
            const durSec = Math.max(0.14, note.durationSec || 0.28);
            const heightT = Math.max(0.10, Math.min(0.45, (durSec / travelDuration) * 2.2));

            const tFront = noteT;
            const tBack = isUp ? (noteT + heightT) : (noteT - heightT);

            const isVisible = isUp
              ? (tFront <= 3.35 && tBack >= 0.7)
              : (tFront >= -3.35 && tBack <= 0.3);

            if (isVisible && !note.missed) {
              let u0, u1;
              if (viewMode === 'roll') {
                const startMidi = 48; // C3
                const endMidi = 71;   // B4 (14 white keys)
                const isBlackMidi = (m) => [1, 3, 6, 8, 10].includes(m % 12);
                const midiVal = typeof note.midi === 'number'
                  ? Math.max(startMidi, Math.min(endMidi, note.midi))
                  : (startMidi + (note.lane || 0) * 3);
                const isBlack = isBlackMidi(midiVal);
                const oct = Math.floor((midiVal - startMidi) / 12);
                const noteInOct = (midiVal - startMidi) % 12;
                const whiteMapInOct = [0, 0.5, 1, 1.5, 2, 3, 3.5, 4, 4.5, 5, 5.5, 6];
                const keyPos = oct * 7 + (whiteMapInOct[noteInOct] ?? 0);
                const centerU = (keyPos + 0.5) / 14;
                const noteWidthU = isBlack ? 0.044 : (1 / 14) - 0.012;
                u0 = Math.max(0.01, centerU - noteWidthU / 2);
                u1 = Math.min(0.99, centerU + noteWidthU / 2);
              } else {
                const lane = (typeof note.lane === 'number' ? note.lane : 0) % numLanes;
                u0 = (lane / numLanes) + 0.018;
                u1 = ((lane + 1) / numLanes) - 0.018;
              }

              const cFL = getPerspectivePoint(u0, tFront);
              const cFR = getPerspectivePoint(u1, tFront);
              const cBR = getPerspectivePoint(u1, tBack);
              const cBL = getPerspectivePoint(u0, tBack);

              ctx.save();
              // Classic Piano Aesthetic: Obsidian Black for normal notes, Radiant Gold for chords
              let grad = ctx.createLinearGradient(cBL.x, cBL.y, cFR.x, cFR.y);
              if (isChord) {
                grad.addColorStop(0, '#facc15');
                grad.addColorStop(1, '#b45309');
              } else {
                grad.addColorStop(0, '#1e293b');
                grad.addColorStop(0.35, '#0f172a');
                grad.addColorStop(1, '#020617');
              }

              ctx.fillStyle = grad;
              ctx.strokeStyle = isChord ? '#facc15' : '#ffffff';
              ctx.lineWidth = isChord ? 2.5 : 1.8;
              ctx.shadowColor = isChord ? '#facc15' : 'rgba(255, 255, 255, 0.45)';
              ctx.shadowBlur = isChord ? 16 : 8;

              ctx.beginPath();
              ctx.moveTo(cFL.x, cFL.y);
              ctx.lineTo(cFR.x, cFR.y);
              ctx.lineTo(cBR.x, cBR.y);
              ctx.lineTo(cBL.x, cBL.y);
              ctx.closePath();
              ctx.fill();
              ctx.stroke();

              // Pitch text
              const midTileX = (cFL.x + cFR.x + cBL.x + cBR.x) / 4;
              const midTileY = (cFL.y + cFR.y + cBL.y + cBR.y) / 4;
              ctx.shadowBlur = 0;
              ctx.fillStyle = '#ffffff';
              ctx.font = 'bold 12px "Outfit", sans-serif';
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.fillText(note.note || '♪', midTileX, midTileY);
              ctx.restore();
            }
          }
        }

        // 2c. Canvas Quad on Desk: Visualizes ONLY Piano Keys or Tiles Pads (t = [0.0, 1.0])
        ctx.save();
        const bgGrad = ctx.createLinearGradient((p1.x + p4.x) / 2, (p1.y + p4.y) / 2, (p2.x + p3.x) / 2, (p2.y + p3.y) / 2);
        bgGrad.addColorStop(0, 'rgba(10, 15, 28, 0.52)');
        bgGrad.addColorStop(1, 'rgba(15, 23, 42, 0.62)');
        ctx.fillStyle = bgGrad;
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.lineTo(p3.x, p3.y);
        ctx.lineTo(p4.x, p4.y);
        ctx.closePath();
        ctx.fill();

        // Outer Neon Glow Border framing the keyboard
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 2.5;
        ctx.shadowColor = '#38bdf8';
        ctx.shadowBlur = 14;
        ctx.stroke();

        // Corner Brackets [ ]
        drawCornerBrackets([p1, p2, p3, p4], 20, '#38bdf8');
        ctx.restore();

        // Render the Keys inside [p1..p4]
        if (viewMode === 'roll') {
          // Real Piano: 14 White keys (t = [0.0, 1.0]) & 10 Black keys (t = [0.0, 0.62])
          const numWhite = 14;

          // 1. White keys (Ivory)
          for (let k = 0; k < numWhite; k++) {
            const u0 = (k / numWhite) + 0.005;
            const u1 = ((k + 1) / numWhite) - 0.005;
            const kMidi = WHITE_KEY_MIDIS[k];
            const hitAnim = getActiveKeyHit(k) || getActiveKeyHit(kMidi);

            const sink = hitAnim ? Math.sin(hitAnim.progress * Math.PI) * 7.0 : 0;
            const kwTL = getPerspectivePoint(u0, 0.0);
            const kwTR = getPerspectivePoint(u1, 0.0);
            const kwBR = getPerspectivePoint(u1, 1.0);
            const kwBL = getPerspectivePoint(u0, 1.0);
            kwBL.y += sink;
            kwBR.y += sink;

            ctx.save();
            const keyGrad = ctx.createLinearGradient((kwTL.x + kwTR.x) / 2, (kwTL.y + kwTR.y) / 2, (kwBL.x + kwBR.x) / 2, (kwBL.y + kwBR.y) / 2);
            if (hitAnim) {
              const hp = 1 - hitAnim.progress;
              if (hitAnim.isChord) {
                keyGrad.addColorStop(0, `rgba(254, 240, 138, ${0.95 * hp + 0.05})`);
                keyGrad.addColorStop(0.5, `rgba(250, 204, 21, ${0.85 * hp + 0.15})`);
                keyGrad.addColorStop(1, `rgba(217, 119, 6, ${0.75 * hp + 0.25})`);
              } else {
                keyGrad.addColorStop(0, `rgba(224, 242, 254, ${0.95 * hp + 0.05})`);
                keyGrad.addColorStop(0.5, `rgba(56, 189, 248, ${0.85 * hp + 0.15})`);
                keyGrad.addColorStop(1, `rgba(14, 165, 233, ${0.75 * hp + 0.25})`);
              }
              ctx.shadowColor = hitAnim.isChord ? '#facc15' : '#38bdf8';
              ctx.shadowBlur = 14 * hp;
            } else {
              keyGrad.addColorStop(0, 'rgba(255, 255, 255, 0.88)');
              keyGrad.addColorStop(0.8, 'rgba(241, 245, 249, 0.82)');
              keyGrad.addColorStop(1, 'rgba(203, 213, 225, 0.76)');
            }
            ctx.fillStyle = keyGrad;
            ctx.strokeStyle = hitAnim ? (hitAnim.isChord ? '#facc15' : '#38bdf8') : '#475569';
            ctx.lineWidth = hitAnim ? 2.2 : 1.2;
            ctx.beginPath();
            ctx.moveTo(kwTL.x, kwTL.y);
            ctx.lineTo(kwTR.x, kwTR.y);
            ctx.lineTo(kwBR.x, kwBR.y);
            ctx.lineTo(kwBL.x, kwBL.y);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            ctx.restore();
          }

          // 2. Black keys (Ebony, t = [0.0, 0.62])
          const blackIndices = [0, 1, 3, 4, 5, 7, 8, 10, 11, 12];
          for (const bIdx of blackIndices) {
            if (bIdx + 1 < numWhite) {
              const midU = (bIdx + 1) / numWhite;
              const u0 = midU - 0.022;
              const u1 = midU + 0.022;
              const bMidi = BLACK_KEY_MIDIS[bIdx];
              const hitAnim = getActiveKeyHit(bMidi);
              const sink = hitAnim ? Math.sin(hitAnim.progress * Math.PI) * 6.0 : 0;

              const kbTL = getPerspectivePoint(u0, 0.0);
              const kbTR = getPerspectivePoint(u1, 0.0);
              const kbBR = getPerspectivePoint(u1, 0.62);
              const kbBL = getPerspectivePoint(u0, 0.62);
              kbBL.y += sink;
              kbBR.y += sink;

              ctx.save();
              if (hitAnim) {
                ctx.fillStyle = hitAnim.isChord ? '#78350f' : '#0369a1';
                ctx.strokeStyle = hitAnim.isChord ? '#facc15' : '#38bdf8';
                ctx.shadowColor = hitAnim.isChord ? '#facc15' : '#38bdf8';
                ctx.shadowBlur = 14 * (1 - hitAnim.progress);
                ctx.lineWidth = 2.0;
              } else {
                ctx.fillStyle = 'rgba(9, 13, 22, 0.88)';
                ctx.strokeStyle = '#64748b';
                ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
                ctx.shadowBlur = 6;
                ctx.lineWidth = 1.2;
              }
              ctx.beginPath();
              ctx.moveTo(kbTL.x, kbTL.y);
              ctx.lineTo(kbTR.x, kbTR.y);
              ctx.lineTo(kbBR.x, kbBR.y);
              ctx.lineTo(kbBL.x, kbBL.y);
              ctx.closePath();
              ctx.fill();
              ctx.stroke();
              ctx.restore();
            }
          }
        } else {
          // Piano Tiles: Monochrome pads (t = [0.0, 1.0])
          for (let l = 0; l < numLanes; l++) {
            const isLeft = l < (numLanes / 2);
            const u0 = (l / numLanes) + 0.015;
            const u1 = ((l + 1) / numLanes) - 0.015;
            const hitAnim = getActiveKeyHit(l);
            const sink = hitAnim ? Math.sin(hitAnim.progress * Math.PI) * 7.0 : 0;

            const pTL = getPerspectivePoint(u0, 0.0);
            const pTR = getPerspectivePoint(u1, 0.0);
            const pBR = getPerspectivePoint(u1, 1.0);
            const pBL = getPerspectivePoint(u0, 1.0);
            pBL.y += sink;
            pBR.y += sink;

            ctx.save();
            const padGrad = ctx.createLinearGradient((pTL.x + pTR.x) / 2, (pTL.y + pTR.y) / 2, (pBL.x + pBR.x) / 2, (pBL.y + pBR.y) / 2);
            if (hitAnim) {
              const hp = 1 - hitAnim.progress;
              if (hitAnim.isChord) {
                padGrad.addColorStop(0, '#ca8a04');
                padGrad.addColorStop(0.5, '#a16207');
                padGrad.addColorStop(1, '#0f172a');
              } else {
                padGrad.addColorStop(0, '#0284c7');
                padGrad.addColorStop(0.5, '#0369a1');
                padGrad.addColorStop(1, '#0f172a');
              }
              ctx.shadowColor = hitAnim.isChord ? '#facc15' : '#38bdf8';
              ctx.shadowBlur = 16 * hp;
            } else {
              padGrad.addColorStop(0, 'rgba(30, 41, 59, 0.62)');
              padGrad.addColorStop(0.4, 'rgba(15, 23, 42, 0.68)');
              padGrad.addColorStop(1, 'rgba(2, 6, 23, 0.74)');
              ctx.shadowColor = 'rgba(56, 189, 248, 0.25)';
              ctx.shadowBlur = 8;
            }

            ctx.fillStyle = padGrad;
            ctx.strokeStyle = hitAnim ? (hitAnim.isChord ? '#fde047' : '#38bdf8') : '#f8fafc';
            ctx.lineWidth = hitAnim ? 3.2 : 2;
            ctx.beginPath();
            ctx.moveTo(pTL.x, pTL.y);
            ctx.lineTo(pTR.x, pTR.y);
            ctx.lineTo(pBR.x, pBR.y);
            ctx.lineTo(pBL.x, pBL.y);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            const padMidX = (pTL.x + pTR.x + pBL.x + pBR.x) / 4;
            const padMidY = (pTL.y + pTR.y + pBL.y + pBR.y) / 4;
            ctx.shadowBlur = 0;
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 13px "Outfit", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            const laneLabel = isLeft ? `L${l + 1}` : `R${l - Math.floor(numLanes / 2) + 1}`;
            ctx.fillText(laneLabel, padMidX, padMidY);
            ctx.restore();
          }
        }

        // 2d. The Hit Line (Positioned along p1 -> p2 at the back of the piano keyboard)
        const hitL = getPerspectivePoint(0, isUp ? 1.0 : 0.0);
        const hitR = getPerspectivePoint(1.0, isUp ? 1.0 : 0.0);

        ctx.save();
        ctx.strokeStyle = '#facc15';
        ctx.lineWidth = 4;
        ctx.shadowColor = '#facc15';
        ctx.shadowBlur = 20;
        ctx.beginPath();
        ctx.moveTo(hitL.x, hitL.y);
        ctx.lineTo(hitR.x, hitR.y);
        ctx.stroke();

        ctx.font = 'bold 11px "Outfit", sans-serif';
        ctx.fillStyle = '#facc15';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText('⚡ HIT LINE', hitL.x - 10, hitL.y);
        ctx.textAlign = 'left';
        ctx.fillText('PERFECT ⚡', hitR.x + 10, hitR.y);
        ctx.restore();

        // Waiting Mode Prompt (when stopped at chord or note)
        if (isWaitingForHit) {
          ctx.save();
          const midHitX = (hitL.x + hitR.x) / 2;
          const midHitY = (hitL.y + hitR.y) / 2 - 26;
          ctx.font = 'bold 12px "Outfit", sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          const pulse = 0.75 + Math.sin(time / 140) * 0.25;
          ctx.fillStyle = `rgba(250, 204, 21, ${pulse})`;
          ctx.shadowColor = '#facc15';
          ctx.shadowBlur = 10;
          const msg = currentGameMode === 'wait_chord'
            ? '⏸️ STOP CHORD — Pukul Tuts / Tekan Space untuk Lanjut!'
            : '⏸️ STOP NOTE — Pukul Tuts untuk Lanjut!';
          ctx.fillText(msg, midHitX, midHitY);
          ctx.restore();
        }

        // ponytail: hand compositing disabled — destination-out creates stripe artifacts, not natural.
        // Upgrade path: use a separate off-screen canvas with the webcam feed for proper hand reveal.
        // renderRealHandsOnKeyboard(ctx, hands, width, height, corners);
      }
    }

    function startMainRenderLoop() {
      let lastTime = performance.now();
      let lastVisionTimestamp = 0;
      let cachedHands = [];
      const VISION_THROTTLE_MS = 33; // Smooth 30 FPS vision tracking with 60 FPS interpolated rendering
      let frameCount = 0;
      let lastFpsTime = performance.now();
      let lastThumbSlamTime = 0;

      // Hands-Free Lock State (Zero-friction confirmation without mouse/touch)
      let dwellStartTime = null;
      let dwellAnchorWidth = null;
      let lockProgress = 0;
      let wasPinchingBoth = false;
      let unpinchLockStartTime = null;

      const onFrame = (timestamp, xrFrame) => {
        const dt = Math.min(0.1, (timestamp - lastTime) / 1000);
        lastTime = timestamp;

        // 0. Live Performance & Diagnostic Monitor
        frameCount++;
        if (timestamp - lastFpsTime >= 500) {
          const fps = Math.round((frameCount * 1000) / (timestamp - lastFpsTime));
          const fpsEl = document.getElementById('fps-display');
          const handsEl = document.getElementById('hands-display');
          const dotEl = document.getElementById('fps-badge-dot');
          if (fpsEl) fpsEl.innerText = `${fps} FPS`;
          if (handsEl) handsEl.innerText = `🖐️ ${cachedHands.length} Tangan`;
          if (dotEl) dotEl.style.background = fps >= 45 ? '#22c55e' : (fps >= 25 ? '#facc15' : '#ef4444');
          frameCount = 0;
          lastFpsTime = timestamp;
        }

        const currentState = arUI.stateMachine.getState();

        // 1. Vision Hand Tracking (Throttled to ~30 FPS to eliminate main thread stutter)
        if (handTracker && arScene.videoElement && (timestamp - lastVisionTimestamp >= VISION_THROTTLE_MS)) {
          cachedHands = handTracker.detectForVideo(arScene.videoElement, timestamp);
          lastVisionTimestamp = timestamp;
        }

        // Smooth fingertip updates on every 60 FPS frame
        if (cachedHands.length > 0) {
          arScene.updateFingertips(cachedHands);
        }

        // Handle SCAN_SURFACE state: Dynamic 2-Hand Canvas Creation & 4-Corner 1-Hand Pinch Drag & 3-Second Dwell Lock
        let currentSpan = null;
        if (currentState === UI_STATES.SCAN_SURFACE) {
          if (!persistedCanvasCorners) {
            persistedCanvasCorners = getDefaultCanvasCorners(window.innerWidth, window.innerHeight);
          }

          // 1. Check 1-Hand Pinch Drag on individual corner handles (TL, TR, BR, BL)
          for (const hand of cachedHands) {
            const handKey = hand.handedness || 'Right';
            const indexPt = getScreenPoint(hand.cameraIndexTip, hand.indexTip);
            const thumbPt = getScreenPoint(hand.cameraThumbTip, hand.thumbTip);
            if (!indexPt) continue;

            const screenDist = thumbPt ? Math.hypot(indexPt.x - thumbPt.x, indexPt.y - thumbPt.y) : 999;
            const isPinching = Boolean(hand.isPinching || screenDist < 60);
            const pinchPt = (thumbPt && isPinching)
              ? { x: (indexPt.x + thumbPt.x) / 2, y: (indexPt.y + thumbPt.y) / 2 }
              : indexPt;

            if (isPinching) {
              if (!handDraggingCorner[handKey]) {
                let closestKey = null;
                let closestDist = 75; // 75px grab radius
                for (const key of ['p1', 'p2', 'p3', 'p4']) {
                  const cPt = persistedCanvasCorners[key];
                  if (!cPt) continue;
                  const d = Math.hypot(cPt.x - pinchPt.x, cPt.y - pinchPt.y);
                  if (d < closestDist) {
                    closestDist = d;
                    closestKey = key;
                  }
                }
                if (closestKey) {
                  handDraggingCorner[handKey] = closestKey;
                }
              }

              if (handDraggingCorner[handKey]) {
                const draggedCorner = handDraggingCorner[handKey];
                persistedCanvasCorners[draggedCorner] = {
                  x: Math.max(15, Math.min(window.innerWidth - 15, pinchPt.x)),
                  y: Math.max(15, Math.min(window.innerHeight - 15, pinchPt.y))
                };
                saveCanvasCorners();
              }
            } else {
              handDraggingCorner[handKey] = null;
            }
          }

          const isDraggingAny = Boolean(pointerDraggingCorner || handDraggingCorner.Left || handDraggingCorner.Right);

          // 2. Dynamic 2-Hand Canvas Creation (when 2 hands are placed on desk and not dragging an individual corner)
          if (!isDraggingAny && cachedHands.length >= 2) {
            const h0 = cachedHands[0];
            const h1 = cachedHands[1];
            const pt0 = getScreenPoint(h0.cameraIndexTip, h0.indexTip);
            const pt1 = getScreenPoint(h1.cameraIndexTip, h1.indexTip);

            if (pt0 && pt1) {
              const ptLeft = pt0.x < pt1.x ? pt0 : pt1;
              const ptRight = pt0.x < pt1.x ? pt1 : pt0;
              const spanDist = Math.hypot(ptRight.x - ptLeft.x, ptRight.y - ptLeft.y);

              if (spanDist >= 80) {
                // p4 is Bottom-Left (Left hand), p3 is Bottom-Right (Right hand)
                const p4 = { x: ptLeft.x, y: ptLeft.y };
                const p3 = { x: ptRight.x, y: ptRight.y };

                // Front vector (Left -> Right)
                const fdx = p3.x - p4.x;
                const fdy = p3.y - p4.y;

                // Perpendicular vector pointing forward/upwards on desk
                let nx = -fdy / spanDist;
                let ny = fdx / spanDist;
                if (ny > 0) {
                  nx = -nx;
                  ny = -ny;
                }

                // Keyboard depth on desk
                const depth = Math.max(70, Math.min(220, spanDist * 0.28));
                const inset = spanDist * 0.04;
                const ux = fdx / spanDist;
                const uy = fdy / spanDist;

                const p1 = {
                  x: Math.max(15, Math.min(window.innerWidth - 15, p4.x + nx * depth + ux * inset)),
                  y: Math.max(15, Math.min(window.innerHeight - 15, p4.y + ny * depth + uy * inset))
                };
                const p2 = {
                  x: Math.max(15, Math.min(window.innerWidth - 15, p3.x + nx * depth - ux * inset)),
                  y: Math.max(15, Math.min(window.innerHeight - 15, p3.y + ny * depth - uy * inset))
                };

                persistedCanvasCorners = { p1, p2, p3, p4 };
                saveCanvasCorners();
              }
            }
          }

          // Update arenaWidth from calibrated corners
          if (persistedCanvasCorners) {
            const { p1, p2, p3, p4 } = persistedCanvasCorners;
            const avgW = (Math.hypot(p2.x - p1.x, p2.y - p1.y) + Math.hypot(p3.x - p4.x, p3.y - p4.y)) / 2;
            const normWidth = Math.max(0.4, Math.min(1.4, (avgW / window.innerWidth) * 1.6));
            arScene.arenaWidth = normWidth;
            hitDetector.arenaWidth = normWidth;
          }

          // 3. Calm 3.0-Second Dwell Hold Timer: Hands steady for 3 seconds to lock canvas
          if (isDraggingAny || cachedHands.length === 0) {
            dwellStartTime = null;
            lockProgress = 0;
          } else {
            // Check hand movement displacement
            let isMoving = false;
            for (const h of cachedHands) {
              const trackKey = `${h.handedness}_indexTip`;
              const prev = lastHandPositions[trackKey];
              if (prev && h.indexTip) {
                const d = Math.hypot(h.indexTip.x - prev.x, h.indexTip.y - prev.y);
                if (d > 0.015) isMoving = true;
              }
              if (h.indexTip) {
                lastHandPositions[trackKey] = { ...h.indexTip };
              }
            }

            if (isMoving) {
              dwellStartTime = null;
              lockProgress = 0;
            } else {
              if (dwellStartTime === null) {
                dwellStartTime = timestamp;
              }
              const elapsed = timestamp - dwellStartTime;
              lockProgress = Math.min(1.0, elapsed / 3000); // 3.0 seconds

              if (lockProgress >= 0.999) {
                confirmAndOpenSongMenu();
                dwellStartTime = null;
                lockProgress = 0;
              }
            }
          }

          const scanInst = document.getElementById('scan-instructions');
          if (scanInst) {
            if (isDraggingAny) {
              scanInst.innerHTML = `<span style="color: #facc15; font-weight: 700;">✊ Menggeser Sudut Kanvas...</span> Lepas cubitan untuk meletakkan posisi sudut.`;
            } else if (lockProgress > 0) {
              scanInst.innerHTML = `<span style="color: #facc15; font-weight: 700;">🔒 Mengunci Posisi: ${Math.round(lockProgress * 100)}%</span> (Tahan tangan diam 3 detik, atau gerakkan tangan untuk batal)`;
            } else if (cachedHands.length >= 2) {
              scanInst.innerHTML = `<span style="color: #38bdf8; font-weight: 700;">🖐️ Kanvas Mengikuti 2 Tangan:</span> Rentangkan kedua tangan di meja. Tahan diam 3 detik atau klik 'Kunci Posisi Meja'!`;
            } else {
              scanInst.innerHTML = `<span style="color: #38bdf8; font-weight: 700;">🖐️ Letakkan 2 Tangan di Meja:</span> Rentangkan tangan untuk membentuk kanvas piano, atau cubit 1 sudut untuk mengatur posisinya.`;
            }
          }
        } else {
          dwellStartTime = null;
          lockProgress = 0;
        }

        // In Calibration state, accumulate samples
        if (currentState === UI_STATES.CALIBRATING && cachedHands.length > 0) {
          for (const h of cachedHands) {
            arUI.calibrationManager.addSample(h.indexTip);
          }
          const prog = arUI.calibrationManager.getProgress();
          arUI.updateCalibrationProgress(prog, arUI.calibrationManager.getSampleCount());
          if (prog >= 1.0) {
            const btnConfirm = document.getElementById('btn-confirm-calib');
            if (btnConfirm) btnConfirm.classList.add('pulse');
          }
        }

        // In Playing state, evaluate hand crossings & finger lane taps for all 10 fingers & thumb chord slam
        if (currentState === UI_STATES.PLAYING && isPlaying && currentChart) {
          const currentTimeSec = (timestamp / 1000) - songStartTimeSec;

          for (const h of cachedHands) {
            // Check downward thumb gesture for Chord Slam [Space]
            if (h.thumbVelocityY < -0.5 || (h.thumbTip && h.thumbTip.y < 0.02 && h.thumbVelocityY < -0.15)) {
              if (timestamp - lastThumbSlamTime > 260) {
                lastThumbSlamTime = timestamp;
                handleChordSlam(currentTimeSec);
              }
            }

            // Check all 5 fingers for lane positioning & note taps
            const fingerKeys = [
              { tipKey: 'indexTip', camKey: 'cameraIndexTip' },
              { tipKey: 'middleTip', camKey: 'cameraMiddleTip' },
              { tipKey: 'ringTip', camKey: 'cameraRingTip' },
              { tipKey: 'pinkyTip', camKey: 'cameraPinkyTip' },
              { tipKey: 'thumbTip', camKey: 'cameraThumbTip' }
            ];

            for (const f of fingerKeys) {
              const tip = h[f.tipKey];
              const camTip = h[f.camKey];
              if (!tip && !camTip) continue;

              const screenPt = getScreenPoint(camTip, tip);
              const trackKey = `${h.handedness}_${f.tipKey}`;
              if (tip) {
                lastHandPositions[trackKey] = { ...tip };
              }

              // Map fingertip to desk canvas lane (2D perspective quad mapping with 3D fallback)
              let lane = -1;
              if (screenPt && persistedCanvasCorners) {
                lane = getLaneFromScreenPoint(screenPt, persistedCanvasCorners, selectedLanes);
              }
              if (lane === -1 && tip) {
                lane = hitDetector.mapHandToLane(tip, selectedLanes, arScene.arenaWidth);
              }

              if (lane >= 0) {
                // Trigger visual key depress on the active lane (always, for visual feedback)
                arScene.triggerKeyDepress(lane);

                // Per-finger debounce: only trigger hit when finger ENTERS a new lane
                const prevState = fingerLaneState[trackKey];
                const isNewLane = !prevState || prevState.lane !== lane;

                if (isNewLane) {
                  fingerLaneState[trackKey] = { lane, hitFired: false };
                }

                if (!fingerLaneState[trackKey].hitFired) {
                  // Check note hit on this lane
                  const hit = hitDetector.evaluateLaneHit(lane, currentTimeSec, currentChart.notes);
                  if (hit) {
                    fingerLaneState[trackKey].hitFired = true;
                    hit.note.played = true;
                    hit.note.playedSound = true;
                    soundEngine.playNote(hit.note.note || hit.note.midi, hit.note.durationSec || 0.35);

                    const scoreRes = arUI.scoreManager.recordHit(hit.judgement);
                    arUI.showJudgement(hit.judgement, scoreRes.points);
                    arUI.updateScore(arUI.scoreManager.score, arUI.scoreManager.combo, arUI.scoreManager.accuracy);

                    const laneOrMidi = (arScene.viewMode === 'roll' && hit.note.midi) ? hit.note.midi : hit.lane;
                    triggerKeyHitAnimation(laneOrMidi, hit.judgement, Boolean(hit.note.type === 'chord' || hit.note.isChord));
                    arScene.triggerHitVFX(laneOrMidi, hit.judgement);
                    arScene.setSpatialCombo(arUI.scoreManager.combo, hit.judgement);
                    arScene.worldReaction.setCombo(arUI.scoreManager.combo);
                  }
                }
              } else {
                // Finger left the keyboard area — reset its state so re-entry triggers a hit
                if (fingerLaneState[trackKey]) {
                  delete fingerLaneState[trackKey];
                }
              }
            }
          }
        }

        // 2. Gameplay state updates
        if (currentState === UI_STATES.PLAYING && isPlaying && currentChart) {
          // Check waiting modes: Stop Chord (wait_chord) & Stop All (wait_all)
          isWaitingForHit = false;
          const tentativeTimeSec = (timestamp / 1000) - songStartTimeSec;

          if (currentGameMode === 'wait_chord') {
            const unhitChord = currentChart.notes.find(n =>
              !n.played && !n.missed &&
              (n.type === 'chord' || n.isChord || (n.chordGroup && n.chordGroup.length >= 2)) &&
              tentativeTimeSec >= (n.timeSec - 0.02)
            );
            if (unhitChord) {
              isWaitingForHit = true;
              songStartTimeSec += dt; // freeze song clock until chord is played
            }
          } else if (currentGameMode === 'wait_all') {
            const unhitNote = currentChart.notes.find(n =>
              !n.played && !n.missed &&
              tentativeTimeSec >= (n.timeSec - 0.02)
            );
            if (unhitNote) {
              isWaitingForHit = true;
              songStartTimeSec += dt; // freeze song clock until note is played
            }
          }

          const currentTimeSec = (timestamp / 1000) - songStartTimeSec;

          if (currentGameMode === 'auto') {
            // Auto-Play: Notes hit automatically at Hit Line with synchronized audio & visuals
            if (Array.isArray(currentChart.notes)) {
              for (const note of currentChart.notes) {
                if (!note.played && currentTimeSec >= (note.timeSec - 0.03)) {
                  note.played = true;
                  note.playedSound = true;
                  const midiOrNote = note.note || note.midi;
                  if (midiOrNote) {
                    soundEngine.playNote(midiOrNote, note.durationSec || 0.35, note.velocity ? Math.max(0.65, note.velocity) : 0.8);
                  }
                  const isChord = Boolean(note.type === 'chord' || note.isChord);
                  const laneOrMidi = (currentViewMode === 'roll' && note.midi) ? note.midi : (note.lane ?? 0);
                  triggerKeyHitAnimation(laneOrMidi, 'PERFECT', isChord);
                  arScene.triggerHitVFX(laneOrMidi, 'PERFECT');

                  const scoreRes = arUI.scoreManager.recordHit('PERFECT', { isChord });
                  arUI.showJudgement('PERFECT', scoreRes.points);
                  arUI.updateScore(arUI.scoreManager.score, arUI.scoreManager.combo, arUI.scoreManager.accuracy);
                  arScene.setSpatialCombo(arUI.scoreManager.combo, 'PERFECT');
                  arScene.worldReaction.setCombo(arUI.scoreManager.combo);
                }
              }
            }
          } else {
            // Interactive, Stop Chord, and Stop All modes:
            if (Array.isArray(currentChart.notes)) {
              for (const note of currentChart.notes) {
                if (!note.playedSound && currentTimeSec >= note.timeSec) {
                  const isChord = Boolean(note.type === 'chord' || note.isChord);
                  if (currentGameMode === 'wait_chord' && isChord) continue;
                  if (currentGameMode === 'wait_all') continue;

                  note.playedSound = true;
                  const midiOrNote = note.note || note.midi;
                  if (midiOrNote) {
                    soundEngine.playNote(midiOrNote, note.durationSec || 0.35, note.velocity ? Math.max(0.65, note.velocity) : 0.8);
                  }
                  const laneOrMidi = (currentViewMode === 'roll' && note.midi) ? note.midi : (note.lane ?? 0);
                  triggerKeyHitAnimation(laneOrMidi, 'PERFECT', isChord);
                }
              }
            }

            // Only check missed notes in pure interactive 'play' mode (NOT in wait modes)
            if (currentGameMode === 'play') {
              const missedNotes = hitDetector.checkMissedNotes(currentTimeSec, currentChart.notes);
              for (const m of missedNotes) {
                arUI.scoreManager.recordHit('MISS');
                arUI.showJudgement('MISS', 0);
                arUI.updateScore(arUI.scoreManager.score, arUI.scoreManager.combo, arUI.scoreManager.accuracy);
                arScene.setSpatialCombo(0, 'MISS');
                arScene.worldReaction.setCombo(0);
              }
            }
          }

          // Spawn notes & update scene
          arScene.spawnNotes(currentChart.notes, currentTimeSec);
          arUI.updateTimeline(currentTimeSec, currentChart.durationSec);

          // Check for song completion
          if (currentTimeSec >= currentChart.durationSec + 0.8) {
            isPlaying = false;
            arUI.showResult(arUI.scoreManager.getSummary());
          }
        }

        // 3. Render 3D Scene
        const sceneTimeSec = (timestamp / 1000) - songStartTimeSec;
        arScene.update(sceneTimeSec, dt, xrFrame);

        if (arScene.renderer && arScene.scene && arScene.camera) {
          arScene.renderer.render(arScene.scene, arScene.camera);
        }

        // 4. Render 2D Spatial Gesture Overlay (Holographic table rectangle, pinch badges, centimeter readout, lock countdown)
        if (gestureCtx && gestureCanvas) {
          try {
            const currentSongTime = isPlaying ? Math.max(0, (timestamp / 1000) - songStartTimeSec) : 0;
            drawGestureOverlay(
              gestureCtx,
              cachedHands,
              window.innerWidth,
              window.innerHeight,
              currentState,
              currentSpan,
              arScene.arenaWidth,
              selectedLanes,
              lockProgress,
              currentChart,
              currentSongTime,
              currentViewMode
            );
          } catch (overlayErr) {
            console.warn('[Overlay] Render error:', overlayErr);
          }
        }
      };

      // Use Three.js setAnimationLoop ONLY (prevents duplicate exponential loops)
      if (arScene.renderer) {
        arScene.renderer.setAnimationLoop(onFrame);
      } else {
        requestAnimationFrame(onFrame);
      }
    }

    // Auto-bootstrap on load (safe for both normal DOM loading and deferred/async ES modules)
    if (document.readyState === 'loading') {
      window.addEventListener('DOMContentLoaded', () => {
        init().catch(err => console.error('AR initialization error:', err));
      });
    } else {
      init().catch(err => console.error('AR initialization error:', err));
    }