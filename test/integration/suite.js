'use strict';
// Runs inside the VS Code extension host launched by run.js (IMT_STAGE selects the step).
const fs = require('node:fs');
const crypto = require('node:crypto');
const vscode = require('vscode');
const { pathsFor } = require('../../src/patcher');

const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(what, check, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await sleep(500);
  }
  throw new Error(`Timed out waiting for: ${what}`);
}

async function run() {
  const files = pathsFor(process.env.IMT_APP_ROOT);
  const pristine = JSON.parse(process.env.IMT_PRISTINE);
  const patched = () => fs.readFileSync(files.bundle, 'utf8').includes('IMMERSIVE_TRANSLATE_BEGIN')
    && fs.readFileSync(files.webview, 'utf8').includes('IMMERSIVE_TRANSLATE_BEGIN');
  const extension = vscode.extensions.getExtension('musingzone.vscode-translate-anywhere');
  if (!extension) throw new Error('Extension not found');
  // activate() only settles after the "Reload Window" notification is answered, so watch the effects instead.
  if (process.env.IMT_STAGE === 'integrate') {
    await waitFor('the extension to patch VS Code on startup', patched);
    const response = await fetch(`http://127.0.0.1:${process.env.TRANSLATE_ANYWHERE_PORT || 17865}/status`,
      { method: 'POST', headers: { Origin: 'vscode-file://vscode-app' } });
    if (response.status !== 401) throw new Error(`Bridge should reject unauthenticated requests, got ${response.status}`);
    return;
  }
  // Relaunched on the patched build: the workbench loaded (this host runs), the patch is kept, then disable restores.
  if (!patched()) throw new Error('Patch missing after relaunch');
  await waitFor('the extension to activate', () => extension.isActive, 60000);
  await sleep(3000);
  if (!patched()) throw new Error('Patch removed after relaunch');
  vscode.commands.executeCommand('translateAnywhere.disable');
  await waitFor('Disable to restore the original files',
    () => Object.entries(files).every(([key, file]) => sha(file) === pristine[key]));
}
module.exports = { run };
