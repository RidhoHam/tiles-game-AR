// The in-battle menu. There is deliberately no "Ganti Roster" entry: the lineup
// is whatever is on the table, and changing it is done by going back to `scan`.
export function createQuickMenu(root, actions = {}) {
  const element = document.createElement('div');
  element.className = 'quick-menu';
  element.hidden = true;

  const entries = [
    { label: 'Ulang Battle', action: () => actions.replay?.() },
    { label: 'Audio', action: () => actions.toggleMute?.() }
  ];

  for (const entry of entries) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = entry.label;
    button.addEventListener('click', () => { api.close(); entry.action(); });
    element.append(button);
  }
  root.append(element);

  let timer = null;

  const api = {
    open() {
      clearTimeout(timer);
      element.hidden = false;
      timer = setTimeout(() => api.close(), actions.autoCloseMs ?? 6000);
    },
    close() { clearTimeout(timer); timer = null; element.hidden = true; },
    isOpen() { return element.hidden === false; },
    dispose() { clearTimeout(timer); timer = null; element.remove(); }
  };
  return api;
}
