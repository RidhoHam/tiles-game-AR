export function createStatusPillLabel(snapshot, baseHealth) {
  const total = Math.max(0, Math.floor(snapshot?.time || 0));
  const minutes = String(Math.floor(total / 60)).padStart(2, '0');
  const seconds = String(total % 60).padStart(2, '0');
  return `${minutes}:${seconds} · Biru ${baseHealth.blue} / Merah ${baseHealth.red}`;
}

export function createStatusPill(root) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'status-pill';
  const detail = document.createElement('div');
  detail.className = 'status-pill__detail';
  detail.hidden = true;
  root.append(button, detail);
  let expanded = false;
  button.addEventListener('click', () => { expanded = !expanded; detail.hidden = !expanded; });
  return {
    update(snapshot, baseHealth) {
      button.textContent = createStatusPillLabel(snapshot, baseHealth);
      detail.replaceChildren(...(snapshot?.units ?? []).filter(unit => unit.alive).map(unit => {
        const row = document.createElement('p');
        row.textContent = `${unit.type} · ${unit.health}/${unit.maxHealth}`;
        return row;
      }));
    },
    dispose() { button.remove(); detail.remove(); }
  };
}