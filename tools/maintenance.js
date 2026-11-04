'use strict';
const fs = require('node:fs');
const path = require('node:path');
const [appRoot, stateFolder, extensionRoot, mode, resultFile] = process.argv.slice(2);
try {
  if (!['apply', 'restore'].includes(mode)) throw new Error('Invalid maintenance mode');
  if (path.dirname(resultFile) !== stateFolder || !/^elevation-[a-f0-9-]+\.json$/.test(path.basename(resultFile))) {
    throw new Error('Invalid result file location');
  }
  const patcher = require(path.join(extensionRoot, 'src', 'patcher.js'));
  let changed;
  if (mode === 'apply') {
    const token = fs.readFileSync(path.join(stateFolder, 'bridge-token'), 'utf8');
    const ui = require(path.join(extensionRoot, 'src', 'ui.js'));
    changed = patcher.applyPatch(appRoot, stateFolder, ui.toString(), {
      endpoint: 'http://127.0.0.1:17865', token,
      version: JSON.parse(fs.readFileSync(path.join(extensionRoot, 'package.json'), 'utf8')).version
    }).changed;
  } else {
    changed = patcher.restorePatch(appRoot, stateFolder);
  }
  fs.writeFileSync(resultFile, JSON.stringify({ ok: true, changed }), 'utf8');
} catch (error) {
  fs.writeFileSync(resultFile, JSON.stringify({ ok: false, error: error.message }), 'utf8');
  process.exitCode = 1;
}
