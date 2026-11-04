#!/usr/bin/env node
// Cross-platform integration test against a real, freshly downloaded VS Code Stable build.
//   1. Patch/restore the real installation files directly (layout, CSP hash, checksums).
//   2. Run the elevated maintenance step through VS Code's own Electron binary (as the admin prompt does);
//      on macOS/Linux also as root via sudo, checking the state files are handed back to the user.
//   3. Launch VS Code with the extension: it integrates on startup; relaunch on the patched build; disable/restore.
// Usage (Linux needs a display): cd test/integration && npm install && node run.js   (xvfb-run -a node run.js)
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { downloadAndUnzipVSCode, runTests } = require('@vscode/test-electron');

const root = path.resolve(__dirname, '..', '..');
const { applyPatch, restorePatch, pathsFor } = require(path.join(root, 'src', 'patcher'));
const { codeExecutableFor, elevationPlan } = require(path.join(root, 'src', 'elevation'));
const ui = require(path.join(root, 'src', 'ui'));

const checksum = text => crypto.createHash('sha256').update(text).digest('base64').replace(/=+$/, '');
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function appRootFor(executable) {
  if (process.platform === 'darwin') return path.resolve(executable, '..', '..', 'Resources', 'app');
  const dir = path.dirname(executable);
  // Newer Windows builds keep resources in a commit-named subfolder.
  const candidates = [path.join(dir, 'resources', 'app'),
    ...fs.readdirSync(dir).map(name => path.join(dir, name, 'resources', 'app'))];
  const found = candidates.find(candidate => fs.existsSync(path.join(candidate, 'product.json')));
  if (!found) throw new Error(`No resources/app next to ${executable}`);
  return found;
}

function assertChecksums(appRoot) {
  const files = pathsFor(appRoot);
  const product = JSON.parse(fs.readFileSync(files.product, 'utf8'));
  assert.equal(product.checksums['vs/workbench/workbench.desktop.main.js'], checksum(fs.readFileSync(files.bundle)));
  assert.equal(product.checksums['vs/code/electron-browser/workbench/workbench.html'], checksum(fs.readFileSync(files.html)));
}

function maintenance(appRoot, executable, stateFolder, mode, { sudo = false } = {}) {
  const resultFile = path.join(stateFolder, `elevation-${crypto.randomUUID()}.json`);
  const codeExecutable = codeExecutableFor(appRoot, executable);
  if (process.platform === 'win32') {
    execFileSync(codeExecutable, [path.join(root, 'tools', 'maintenance.js'), appRoot, stateFolder, root, mode, resultFile],
      { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
  } else {
    const plan = elevationPlan({ appRoot, stateFolder, extensionRoot: root, codeExecutable, mode, resultFile, privileged: false });
    if (sudo) execFileSync('sudo', ['-n', '/bin/sh', '-c', plan.shell]);
    else execFileSync(plan.file, plan.args);
  }
  const result = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
  fs.unlinkSync(resultFile);
  return result;
}

async function main() {
  const executable = process.env.IMT_VSCODE_EXECUTABLE || await downloadAndUnzipVSCode({ version: 'stable', cachePath: process.env.IMT_VSCODE_CACHE || path.join(__dirname, '.vscode-test') });
  const appRoot = appRootFor(executable);
  const files = pathsFor(appRoot);
  const pristine = Object.fromEntries(Object.entries(files).map(([key, file]) => [key, sha(file)]));
  const { version } = JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8'));
  console.log(`VS Code ${version} (${process.platform}-${process.arch}) at ${appRoot}`);
  assertChecksums(appRoot);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'imt-int-'));
  const assertPristine = () => {
    for (const [key, file] of Object.entries(files)) assert.equal(sha(file), pristine[key], `${key} not restored`);
  };

  // 1. Direct patch on the real files.
  const state = path.join(temp, 'state');
  const config = { endpoint: 'http://127.0.0.1:17865', token: 'integration', version: 'test' };
  assert.equal(applyPatch(appRoot, state, ui.toString(), config).changed, true);
  assert.ok(fs.readFileSync(files.bundle, 'utf8').includes('__imtFreshChecksums'), 'integrity-check hook not applied');
  assertChecksums(appRoot);
  assert.equal(restorePatch(appRoot, state), true);
  assertPristine();
  console.log('1. direct patch/restore: ok');

  // 2. The elevated step, run through VS Code's own binary.
  const elevated = path.join(temp, 'elevated');
  fs.mkdirSync(elevated);
  fs.writeFileSync(path.join(elevated, 'bridge-token'), 'integration');
  assert.deepEqual(maintenance(appRoot, executable, elevated, 'apply'), { ok: true, changed: true });
  assertChecksums(appRoot);
  assert.deepEqual(maintenance(appRoot, executable, elevated, 'restore'), { ok: true, changed: true });
  assertPristine();
  if (process.platform !== 'win32') {
    const rootState = path.join(temp, 'root-state');
    fs.mkdirSync(rootState);
    fs.writeFileSync(path.join(rootState, 'bridge-token'), 'integration');
    assert.deepEqual(maintenance(appRoot, executable, rootState, 'apply', { sudo: true }), { ok: true, changed: true });
    for (const name of fs.readdirSync(rootState)) {
      assert.equal(fs.statSync(path.join(rootState, name)).uid, process.getuid(), `${name} left owned by root`);
    }
    assert.deepEqual(maintenance(appRoot, executable, rootState, 'restore', { sudo: true }), { ok: true, changed: true });
    assertPristine();
    for (const file of Object.values(files)) {
      assert.equal(fs.statSync(file).uid, process.getuid(), `${file} left owned by root after the elevated run`);
    }
  }
  console.log('2. elevated maintenance step: ok');

  // 3. Real VS Code with the extension: integrate on startup, relaunch patched, then disable/restore.
  const userData = path.join(temp, 'user-data');
  fs.mkdirSync(path.join(userData, 'User'), { recursive: true });
  fs.writeFileSync(path.join(userData, 'User', 'settings.json'), JSON.stringify({
    'translateAnywhere.integration.enabled': true, 'security.workspace.trust.enabled': false, 'update.mode': 'none'
  }));
  const workspace = path.join(temp, 'workspace');
  fs.mkdirSync(workspace);
  // test-electron does not quote arguments on Windows, so reach the repo through a space-free junction.
  let devRoot = root;
  if (/\s/.test(root)) {
    devRoot = path.join(temp, 'repo');
    fs.symlinkSync(root, devRoot, 'junction');
  }
  const launch = stage => runTests({
    // test-electron still assumes macOS's binary is called Electron; read the real name from Info.plist.
    vscodeExecutablePath: codeExecutableFor(appRoot, executable),
    extensionDevelopmentPath: devRoot,
    extensionTestsPath: path.join(devRoot, 'test', 'integration', 'suite.js'),
    extensionTestsEnv: { TRANSLATE_ANYWHERE_PORT: process.env.TRANSLATE_ANYWHERE_PORT || '17865', IMT_STAGE: stage, IMT_USER_DATA: userData, IMT_APP_ROOT: appRoot, IMT_PRISTINE: JSON.stringify(pristine) },
    launchArgs: [workspace, '--user-data-dir', userData, '--extensions-dir', path.join(temp, 'extensions')]
  });
  try {
    await launch('integrate');
    console.log('3a. extension integrated on startup: ok');
    await launch('patched-restart');
    assertPristine();
    console.log('3b. relaunch on the patched build, then disable/restore: ok');
  } finally {
    // Leave a reusable VS Code build behind even when a stage fails.
    try { restorePatch(appRoot, path.join(userData, 'User', 'globalStorage', 'musingzone.vscode-translate-anywhere')); } catch {}
    if (devRoot !== root) fs.unlinkSync(devRoot);
  }
  fs.rmSync(temp, { recursive: true, force: true });
  console.log('INTEGRATION TEST PASSED');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
