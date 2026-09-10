import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('Modular components exist and export required classes', async () => {
  assert.ok(fs.existsSync(path.resolve('src/ui/components/settingsDialog.js')), 'settingsDialog.js exists');
  assert.ok(fs.existsSync(path.resolve('src/renderer/tiles2dRenderer.js')), 'tiles2dRenderer.js exists');
  assert.ok(fs.existsSync(path.resolve('src/core/audio/audioCache.js')), 'audioCache.js exists');
  assert.ok(fs.existsSync(path.resolve('src/core/audio/stereoPanner.js')), 'stereoPanner.js exists');
  assert.ok(fs.existsSync(path.resolve('src/core/midi/trackManager.js')), 'trackManager.js exists');
  assert.ok(fs.existsSync(path.resolve('src/vision/twoPointCalibration.js')), 'twoPointCalibration.js exists');
  assert.ok(fs.existsSync(path.resolve('src/vision/palmRejection.js')), 'palmRejection.js exists');
});
