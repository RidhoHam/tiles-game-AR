/**
 * Settings Dialog Component
 *
 * Manages the studio settings modal lifecycle, shortcuts, and state synchronisation.
 */

export class SettingsDialogComponent {
  constructor(options = {}) {
    this.modalEl = document.getElementById('settingsModal');
    this.openBtn = document.getElementById('openSettingsBtn');
    this.closeBtn = document.getElementById('closeSettingsBtn');
    this.onSettingsChange = options.onSettingsChange || (() => {});

    this._bindEvents();
  }

  _bindEvents() {
    if (this.openBtn && this.modalEl) {
      this.openBtn.addEventListener('click', () => this.open());
    }

    if (this.closeBtn && this.modalEl) {
      this.closeBtn.addEventListener('click', () => this.close());
    }

    if (this.modalEl) {
      this.modalEl.addEventListener('click', (e) => {
        if (e.target === this.modalEl) {
          this.close();
        }
      });
    }

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen()) {
        this.close();
      }
    });
  }

  open() {
    if (!this.modalEl) return;
    if (typeof this.modalEl.showModal === 'function') {
      this.modalEl.showModal();
    } else {
      this.modalEl.setAttribute('open', '');
    }
    if (typeof window !== 'undefined' && window.lucide) {
      window.lucide.createIcons();
    }
  }

  close() {
    if (!this.modalEl) return;
    if (typeof this.modalEl.close === 'function') {
      this.modalEl.close();
    } else {
      this.modalEl.removeAttribute('open');
    }
  }

  isOpen() {
    return this.modalEl ? (this.modalEl.open || this.modalEl.hasAttribute('open')) : false;
  }
}
