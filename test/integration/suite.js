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

// On failure, print the extension's own output channel so CI logs show why.
function dumpExtensionLog(extension) {
  console.log(`extension active: ${extension && extension.isActive}`);
  const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? walk(`${dir}/${entry.name}`) : [`${dir}/${entry.name}`]);
  try {
    for (const file of walk(`${process.env.IMT_USER_DATA}/logs`).filter(file => /Translate Anywhere/.test(file))) {
      console.log(`--- ${file}\n${fs.readFileSync(file, 'utf8')}`);
    }
  } catch (error) {
    console.log(`No extension log: ${error.message}`);
  }
}

async function run() {
  const extension = vscode.extensions.getExtension('musingzone.vscode-translate-anywhere');
  try {
    await stage(extension);
  } catch (error) {
    dumpExtensionLog(extension);
    throw error;
  }
}

async function stage(extension) {
  const files = pathsFor(process.env.IMT_APP_ROOT);
  const pristine = JSON.parse(process.env.IMT_PRISTINE);
  const patched = () => fs.readFileSync(files.bundle, 'utf8').includes('IMMERSIVE_TRANSLATE_BEGIN')
    && fs.readFileSync(files.webview, 'utf8').includes('IMMERSIVE_TRANSLATE_BEGIN');
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
