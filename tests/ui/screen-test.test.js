import test from 'node:test';
import assert from 'node:assert/strict';
import { createScreenTest, ACTIONS } from '../../src/ui/screens/screen-test.js';

class FakeElement {
  constructor(tagName) { this.tagName = tagName; this.children = []; this.dataset = {}; this.attributes = {}; this.listeners = {}; this.disabled = false; this.textContent = ''; }
  append(...children) { this.children.push(...children); }
  remove() { this.removed = true; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  addEventListener(name, listener) { this.listeners[name] = listener; }
  click() { if (!this.disabled) this.listeners.click?.(); }
  querySelectorAll(selector) {
    const result = [];
    const visit = node => { for (const child of node.children) { if (selector === 'button' && child.tagName === 'button') result.push(child); visit(child); } };
    visit(this); return result;
  }
}

function withDocument(callback) {
  const previous = globalThis.document;
  globalThis.document = { createElement: tagName => new FakeElement(tagName) };
  try { return callback(); } finally { globalThis.document = previous; }
}

test('test screen renders status and every exact action key unavailable without a model', () => withDocument(() => {
  const root = new FakeElement('div');
  const screen = createScreenTest(root, {});
  const buttons = root.children[0].querySelectorAll('button');
  assert.deepEqual(buttons.slice(0, ACTIONS.length).map(button => button.dataset.action), ACTIONS.map(([key]) => key));
  assert.ok(buttons.slice(0, ACTIONS.length).every(button => button.disabled));
  assert.match(root.children[0].children[0].textContent, /Mode Test/);
  assert.equal(root.children[0].children[2].children[0].textContent, 'Belum ada kartu');
  assert.equal(buttons[ACTIONS.length].textContent, 'Pindai Ulang');
   assert.equal(buttons[ACTIONS.length + 1].textContent, 'Bersihkan Model');
  screen.dispose();
  assert.equal(root.children[0].removed, true);
}));

test('model availability enables actions and dispatches the exact action key', () => withDocument(() => {
  const root = new FakeElement('div');
  const actions = [];
  const screen = createScreenTest(root, {}, { onAction: action => actions.push(action) });
  const element = root.children[0];
  screen.update({ card: { type: 'benteng' }, model: {}, title: 'Benteng', actionLabel: 'Buka / tutup', status: 'Siap' });
  const buttons = element.querySelectorAll('button');
  assert.ok(buttons.slice(0, ACTIONS.length).every(button => !button.disabled));
  assert.equal(buttons.find(button => button.dataset.action === 'action').textContent, 'Buka / tutup');
  assert.equal(element.children[2].children[0].textContent, 'Kartu terdeteksi');
  buttons.find(button => button.dataset.action === 'rotate-left').click();
  assert.deepEqual(actions, ['rotate-left']);
}));

test('rescan and back controls call their handlers', () => withDocument(() => {
  const root = new FakeElement('div');
  let rescans = 0; let backs = 0;
  createScreenTest(root, {}, { onRescan: () => rescans++, onBack: () => backs++ });
  const buttons = root.children[0].querySelectorAll('button');
  buttons[ACTIONS.length].click(); buttons[ACTIONS.length + 1].click();
  assert.equal(rescans, 1); assert.equal(backs, 1);
}));
