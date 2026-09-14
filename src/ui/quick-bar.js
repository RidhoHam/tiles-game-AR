/**
 * Quick floating action bar for mobile and desktop AR:
 * - "Pilih Mode": beralih antara Mode Battle dan Mode Test secara langsung.
 * - "Masuk Posisi": mengatur unit / preview agar maju ke posisi formasi di depan garis (tidak berdempetan).
 * - "Mulai Battle": tombol aksi cepat di luar panel wizard.
 * - "Panduan": tombol cepat untuk membuka/menutup panel wizard.
 */
export function createQuickBar(root, state, actions = {}) {
  const bar = document.createElement('nav');
  bar.className = 'quick-bar';
  bar.setAttribute('aria-label', 'Bar Aksi Cepat');

  // 1. Mode Switcher
  const modeBtn = document.createElement('button');
  modeBtn.type = 'button';
  modeBtn.className = 'quick-btn quick-btn--mode';
  const renderMode = () => {
    const isBattle = state.mode === 'battle';
    modeBtn.innerHTML = isBattle ? '⚔️ Mode: <b>Battle</b>' : '🎯 Mode: <b>Test</b>';
    modeBtn.setAttribute('aria-label', `Ganti ke mode ${isBattle ? 'Test' : 'Battle'}`);
  };
  renderMode();
  modeBtn.addEventListener('click', () => {
    const next = state.mode === 'battle' ? 'test' : 'battle';
    state.setMode(next);
    actions.onToggleMode?.(next);
    renderMode();
  });

  // 2. Masuk Posisi Button
  const posBtn = document.createElement('button');
  posBtn.type = 'button';
  posBtn.className = 'quick-btn quick-btn--position';
  posBtn.innerHTML = '🛡️ <b>Masuk Posisi</b>';
  posBtn.setAttribute('aria-label', 'Atur unit ke posisi formasi di depan garis');
  posBtn.addEventListener('click', () => {
    actions.onFormPosition?.();
  });

  // 3. Mulai Battle Button
  const battleBtn = document.createElement('button');
  battleBtn.type = 'button';
  battleBtn.className = 'quick-btn quick-btn--battle';
  battleBtn.innerHTML = '🔥 <b>Mulai Battle</b>';
  battleBtn.setAttribute('aria-label', 'Mulai pertempuran pasir');
  battleBtn.addEventListener('click', () => {
    actions.onStartBattle?.();
  });

  // 4. Toggle Panduan Button
  const guideBtn = document.createElement('button');
  guideBtn.type = 'button';
  guideBtn.className = 'quick-btn quick-btn--guide';
  guideBtn.innerHTML = '📋 <b>Panduan ▾</b>';
  guideBtn.setAttribute('aria-label', 'Buka atau ciutkan panduan');
  guideBtn.addEventListener('click', () => {
    actions.onToggleGuide?.();
  });

  bar.append(modeBtn, posBtn, battleBtn, guideBtn);
  root.append(bar);

  const updateState = snapshot => {
    renderMode();
    const isScan = snapshot.phase === 'scan';
    const isBattleMode = snapshot.mode === 'battle';
    posBtn.style.display = isScan && isBattleMode ? 'inline-flex' : 'none';
    battleBtn.style.display = isScan && isBattleMode ? 'inline-flex' : 'none';

    const cards = snapshot.cards ?? [];
    const blue = cards.filter(c => c.side === 'blue' || c.faction === 'blue');
    const red = cards.filter(c => c.side === 'red' || c.faction === 'red');
    const ready = blue.length > 0 && red.length > 0;
    battleBtn.disabled = !ready;
    if (ready) {
      battleBtn.classList.add('is-ready');
    } else {
      battleBtn.classList.remove('is-ready');
    }
  };

  const unsubscribe = state.subscribe(updateState);
  updateState(state.snapshot?.() ?? state);

  return {
    bar,
    setGuideMinimized(minimized) {
      guideBtn.innerHTML = minimized ? '📋 <b>Panduan ▸</b>' : '📋 <b>Ciutkan ▾</b>';
    },
    setCountdown(seconds) {
      if (typeof seconds === 'number' && seconds > 0) {
        battleBtn.innerHTML = `⚔️ <b>Battle (${seconds}s)</b>`;
        battleBtn.classList.add('is-countdown');
        battleBtn.disabled = false;
      } else {
        battleBtn.innerHTML = '🔥 <b>Mulai Battle</b>';
        battleBtn.classList.remove('is-countdown');
      }
    },
    dispose() {
      unsubscribe();
      bar.remove();
    }
  };
}
