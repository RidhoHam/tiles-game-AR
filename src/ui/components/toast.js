export function createToast(root) {
  const element = document.createElement('div');
  element.className = 'toast';
  element.setAttribute('role', 'status');
  element.setAttribute('aria-live', 'polite');
  root.append(element);
  let timer = null;
  return {
    show(message, { duration = 3200 } = {}) {
      element.textContent = message;
      element.classList.add('is-visible');
      clearTimeout(timer);
      timer = setTimeout(() => element.classList.remove('is-visible'), duration);
    },
    hide() { clearTimeout(timer); element.classList.remove('is-visible'); },
    dispose() { clearTimeout(timer); element.remove(); }
  };
}