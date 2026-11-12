'use strict';
const fs = require('node:fs');
const path = require('node:path');
const [appRoot, stateFolder, extensionRoot, mode, resultFile, owner] = process.argv.slice(2);
// macOS/Linux elevation runs this as root: hand the backups, state and result files back to the user.
function restoreOwner() {
  if (!owner || typeof process.getuid !== 'function' || process.getuid() !== 0) return;
  const [uid, gid] = owner.split(':').map(Number);
  if (!Number.isInteger(uid) || !Number.isInteger(gid) || uid === 0) return;
  for (const name of fs.readdirSync(stateFolder)) {
    const file = path.join(stateFolder, name);
    try { if (fs.statSync(file).uid === 0) fs.chownSync(file, uid, gid); } catch { /* best effort */ }
  }
}
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
    changed = patcher.applyPatch(appRoot, stateFolder, ui.toString(),
      patcher.patchConfig({ endpoint: 'http://127.0.0.1:17865', token, runtime: ui.toString() })).changed;
  } else {
    changed = patcher.restorePatch(appRoot, stateFolder);
  }
  fs.writeFileSync(resultFile, JSON.stringify({ ok: true, changed }), 'utf8');
} catch (error) {
  fs.writeFileSync(resultFile, JSON.stringify({ ok: false, error: error.message }), 'utf8');
  process.exitCode = 1;
} finally {
  try { restoreOwner(); } catch { /* best effort */ }
}
