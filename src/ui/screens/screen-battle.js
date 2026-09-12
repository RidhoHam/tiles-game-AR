import { UNIT_DEFINITIONS } from '../../core/unit-definitions.js';
import { createStatusPill } from '../components/status-pill.js';
import { createQuickMenu } from '../components/quick-menu.js';
import { createUnitLabel } from '../components/unit-label.js';

// The battle is a spectator experience now: no summon zones, no roster entry.
// The only always-visible chrome is the status pill; a double click opens the
// small quick menu (replay / audio).
export function createScreenBattle(root, state, handlers = {}) {
  const { onOpenMenu, replay, toggleMute } = handlers;

  const element = document.createElement('section');
  element.className = 'screen screen-battle';

  const hint = document.createElement('p');
  hint.className = 'screen-battle__hint';
  hint.textContent = 'Ketuk ganda area kosong untuk menu';
  element.append(hint);
  root.append(element);

  const pill = createStatusPill(element);
  const menu = createQuickMenu(element, { replay, toggleMute });
  const label = createUnitLabel(element);

  const onDoubleClick = () => onOpenMenu?.();
  window.addEventListener('dblclick', onDoubleClick);

  return {
    update(snapshot) {
      const baseHealth = { blue: 0, red: 0 };
      for (const unit of snapshot?.units ?? []) {
        if (!unit.alive) continue;
        if (UNIT_DEFINITIONS[unit.type]?.role !== 'base') continue;
        if (unit.faction in baseHealth) baseHealth[unit.faction] = unit.health;
      }
      pill.update(snapshot, baseHealth);
    },
    flashUnit(unit, targetTitle, position) {
      label.show(unit, targetTitle, position);
    },
    // Exposed so the controller can open the quick menu when its own gesture
    // handling (double tap on the arena) fires, not only the window dblclick.
    openMenu() { menu.open(); },
    dispose() {
      window.removeEventListener('dblclick', onDoubleClick);
      label.dispose();
      menu.dispose();
      pill.dispose();
      element.remove();
    }
  };
}
