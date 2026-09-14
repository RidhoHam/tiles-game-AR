import { CARD_TARGETS } from '../../ar/card-targets.js';
import { UNIT_DEFINITIONS, ROLES } from '../../core/unit-definitions.js';
import { ROLE_REQUIREMENTS } from '../../core/team-composition.js';

// The `scan` phase. Its job is to answer, at every instant and for every card,
// "is this one detected yet?" - so a player who has laid down a SINGLE card sees
// that card light up instead of an unchanging screen. That is why the per-card
// grid is driven by the CURRENT detections rather than by `validateTeams` alone
// (a full validation only ever says "not yet", which is indistinguishable from
// "the app is broken" or "the lighting is bad").
//
// Three layers of feedback, from coarsest to finest:
//   1. a live count: "2 dari 6 kartu terdeteksi".
//   2. a six-row grid, one row per known card, each detected / not detected.
//   3. a per-side breakdown that names the card(s) still missing per team.
// The SPECIFIC `validateTeams` errors are listed below the grid, unchanged.
//
// "Mulai Battle" is enabled only on `validation.valid`; while it is disabled the
// summary explains exactly what is still missing, so the button is never a dead
// end the player cannot interpret.
export function createScreenScan(root, state, handlers = {}) {
  const { onStart, onRescan, onChangeVolume } = handlers;

  const element = document.createElement('section');
  element.className = 'screen screen-scan';

  const heading = document.createElement('h2');
  heading.textContent = 'Pindai Kartu';

  const hint = document.createElement('p');
  hint.className = 'screen-scan__hint';
  hint.textContent = 'Arahkan kamera ke meja sampai kartu terbaca. Letakkan Tim Biru di sisi kiri dan Tim Merah di sisi kanan garis tengah (putar HP ke Landscape untuk area lebih leluasa).';

  // Layer 1: the always-visible count.
  const count = document.createElement('p');
  count.className = 'screen-scan__count';

  // Layer 2: the six per-card rows.
  const grid = document.createElement('div');
  grid.className = 'screen-scan__cards';

  const rows = new Map();
  for (const target of CARD_TARGETS) {
    const row = document.createElement('div');
    row.className = 'screen-scan__card';
    row.dataset.cardId = target.cardId;
    row.dataset.detected = 'false';

    const name = document.createElement('span');
    name.className = 'screen-scan__name';
    name.textContent = UNIT_DEFINITIONS[target.type]?.title ?? target.type;

    const status = document.createElement('span');
    status.className = 'screen-scan__status';
    status.textContent = 'Belum terdeteksi';

    row.append(name, status);
    grid.append(row);
    rows.set(target.cardId, { row, status });
  }

  // Layer 3: per-side breakdown, one block per team.
  const sides = document.createElement('div');
  sides.className = 'screen-scan__sides';
  const sideBlocks = new Map();
  for (const faction of ['blue', 'red']) {
    const block = document.createElement('div');
    block.className = `screen-scan__side-block screen-scan__side-block--${faction}`;
    block.dataset.faction = faction;

    const title = document.createElement('span');
    title.className = 'screen-scan__side-title';

    const detail = document.createElement('span');
    detail.className = 'screen-scan__side-detail';

    block.append(title, detail);
    sides.append(block);
    sideBlocks.set(faction, { block, title, detail });
  }

  // Explains why a side may read differently from where the player THINKS the
  // card went: while the lineup is incomplete the arena centre is the midpoint of
  // whatever has been detected, so sides are provisional until all six are in.
  const note = document.createElement('p');
  note.className = 'screen-scan__note';

  const summary = document.createElement('p');
  summary.className = 'screen-scan__summary';

  const errorList = document.createElement('ul');
  errorList.className = 'screen-scan__errors';

  const actions = document.createElement('div');
  actions.className = 'screen-scan__actions';

  const startButton = document.createElement('button');
  startButton.type = 'button';
  startButton.className = 'screen-scan__start primary';
  startButton.textContent = 'Mulai Battle';
  startButton.disabled = true;
  startButton.addEventListener('click', () => { if (!startButton.disabled) onStart?.(); });

  const rescanButton = document.createElement('button');
  rescanButton.type = 'button';
  rescanButton.className = 'screen-scan__rescan';
  rescanButton.textContent = 'Pindai Ulang';
  rescanButton.addEventListener('click', () => onRescan?.());

  actions.append(startButton, rescanButton);
  element.append(heading, hint, count, grid, sides, note, summary, errorList, actions);
  root.append(element);

  const SIDE_LABEL = { blue: 'Tim Biru', red: 'Tim Merah' };
  const ROLE_LABEL = { base: 'benteng', artileri: 'artileri', prajurit: 'prajurit' };

  // Where the card was seen, from the side the controller stamped on it. With
  // fewer than TWO cards there is no spread to split, so `deriveArena` puts the
  // centre ON the only card and `side` is null; in that case the honest message
  // is a plain "Terdeteksi" rather than a misleading side claim.
  const sideText = side => side === 'blue' ? 'kiri (Biru)' : side === 'red' ? 'kanan (Merah)' : null;
  const typeOf = new Map(CARD_TARGETS.map(target => [target.cardId, target.type]));
  const titleOf = type => UNIT_DEFINITIONS[type]?.title ?? type;
  const roleOf = type => UNIT_DEFINITIONS[type]?.role ?? null;

  // Text for the per-side block: which roles are present and what is missing.
  // Roles are counted, not deduped, so a duplicated role (e.g. two bentengs on
  // one side) shows both titles; `validateTeams` names the duplicate explicitly
  // in the error list below.
  function sideDetail(faction, cards) {
    const byRole = new Map(ROLES.map(role => [role, []]));
    for (const card of cards) {
      if (card.side !== faction) continue;
      const role = roleOf(card.type);
      if (byRole.has(role)) byRole.get(role).push(titleOf(card.type));
    }

    const done = [];
    const missing = [];
    for (const role of ROLES) {
      const need = ROLE_REQUIREMENTS[role] ?? 1;
      const have = byRole.get(role);
      if (have.length >= need) done.push(ROLE_LABEL[role]);
      else missing.push(`${need - have.length} ${ROLE_LABEL[role]}`);
    }

    if (done.length === 0) return 'Belum ada kartu di sisi ini.';
    if (missing.length === 0) return `Lengkap: ${done.join(', ')} \u2713`;
    return `Butuh ${missing.join(', ')}.`;
  }

  function update({ cards = [], errors = [], valid = false } = {}) {
    const byCardId = new Map();
    for (const card of cards) {
      if (card?.cardId) byCardId.set(card.cardId, card);
    }

    // Layer 2: every known card, always, with its detection state spelled out.
    for (const [cardId, entry] of rows) {
      const card = byCardId.get(cardId);
      entry.row.dataset.detected = card ? 'true' : 'false';
      const where = card ? sideText(card.side) : null;
      entry.status.textContent = card
        ? (where ? `Terdeteksi \u2014 ${where}` : 'Terdeteksi')
        : 'Belum terdeteksi';
    }

    const found = byCardId.size;

    // Layer 1: the live count, present whether or not the lineup is valid.
    count.textContent = `${found} dari ${rows.size} kartu terdeteksi.`;
    count.dataset.detected = String(found);
    count.dataset.total = String(rows.size);

    // Layer 3: the per-side breakdown.
    const detected = [...byCardId.values()];
    for (const [faction, block] of sideBlocks) {
      const list = detected.filter(card => card.side === faction);
      block.title.textContent = `${SIDE_LABEL[faction]} (${list.length}/3)`;
      block.detail.textContent = sideDetail(faction, detected);
      block.block.dataset.ready = String(list.length === 3);
    }

    const unsided = detected.filter(card => !card.side).length;
    note.textContent = unsided > 0
      ? `${unsided} kartu terdeteksi tetapi belum bisa ditentukan sisinya. Letakkan kartu lain agar garis tengah terbentuk.`
      : (found > 0 && !valid
          ? 'Sisi kartu masih perkiraan sampai keenam kartu terdeteksi.'
          : '');

    errorList.replaceChildren(...errors.map(message => {
      const item = document.createElement('li');
      item.textContent = message;
      return item;
    }));

    summary.textContent = valid
      ? (typeof countdown === 'number' && countdown > 0
          ? `✅ Semua model siap terproyeksikan! Memulai pertempuran otomatis dalam ${countdown} detik...`
          : `Model siap: ${found} kartu terproyeksikan. Tekan Mulai Battle atau tunggu hitung mundur otomatis.`)
      : `${found} dari ${rows.size} kartu terdeteksi. Perbaiki hal berikut sebelum bertempur:`;
    summary.dataset.valid = valid ? 'true' : 'false';

    startButton.disabled = !valid;
    startButton.textContent = typeof countdown === 'number' && countdown > 0 ? `Mulai Battle (${countdown}s)` : 'Mulai Battle';
  }

  // First paint from whatever the controller already knows, so entering `scan`
  // never shows an empty grid before the first onCards callback.
  const initial = state?.validation ?? null;
  update({
    cards: state?.cards ?? [],
    errors: initial?.errors ?? [],
    valid: initial?.valid === true
  });

  return {
    update,
    // Kept for interface compatibility: it only refreshes the live count, which
    // is the one piece of this screen an external caller ever pushed directly.
    // The full `update()` above is the supported path for detection changes.
    setProgress(value) {
      const found = Number.isFinite(value) ? value : 0;
      count.textContent = `${found} dari ${rows.size} kartu terdeteksi.`;
    },
    cardType(cardId) { return typeOf.get(cardId) ?? null; },
    onChangeVolume,
    dispose() { element.remove(); }
  };
}
