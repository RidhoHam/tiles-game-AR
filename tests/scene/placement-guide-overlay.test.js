import test from 'node:test';
import assert from 'node:assert/strict';
import { PlacementGuideOverlay } from '../../src/scene/placement-guide-overlay.js';

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.parentNode = null;
    this.hidden = false;
    this.className = '';
    this.dataset = {};
    this.attributes = new Map();
    this.style = {
      pointerEvents: '',
      values: new Map(),
      setProperty: (name, value) => this.style.values.set(name, value)
    };
  }

  setAttribute(name, value) { this.attributes.set(name, value); }

  append(...children) {
    for (const child of children) {
      child.parentNode = this;
      this.children.push(child);
    }
  }

  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    child.parentNode = null;
  }
}

test('placement guide creates three inert lines and follows scan lifecycle', () => {
  const originalDocument = globalThis.document;
  globalThis.document = { createElement: tagName => new FakeElement(tagName) };
  try {
    const parent = new FakeElement('div');
    const guide = new PlacementGuideOverlay(parent);

    assert.equal(parent.children.length, 1);
    assert.equal(guide.lines.length, 3);
    assert.equal(guide.visible, false);
    assert.equal(guide.host.style.pointerEvents, 'none');
    for (const line of guide.lines) {
      assert.equal(line.style.pointerEvents, 'none');
      assert.match(line.className, /placement-guide__line/);
    }

    guide.show();
    assert.equal(guide.visible, true);
    guide.hide();
    assert.equal(guide.visible, false);

    guide.dispose();
    assert.equal(parent.children.length, 0);
    assert.doesNotThrow(() => guide.show());
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
});
