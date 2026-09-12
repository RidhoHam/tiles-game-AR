export function createUnitLabel(root) {
  const element = document.createElement('div');
  element.className = 'unit-label';
  element.hidden = true;
  root.append(element);
  return {
    show(unit, targetTitle, position) {
      const title = unit?.title ?? unit?.type ?? '';
      element.replaceChildren();
      const head = document.createElement('p');
      head.textContent = `${title} · ${unit.health}/${unit.maxHealth}`;
      const target = document.createElement('p');
      target.textContent = `Target: ${targetTitle ?? '—'}`;
      element.append(head, target);
      if (position) element.style.transform = `translate(-50%, -50%) translate(${position.x}px, ${position.y}px)`;
      element.hidden = false;
    },
    hide() { element.hidden = true; },
    dispose() { element.remove(); }
  };
}