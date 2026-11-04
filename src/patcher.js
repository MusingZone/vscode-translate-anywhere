'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const BEGIN = '/* IMMERSIVE_TRANSLATE_BEGIN */';
const END = '/* IMMERSIVE_TRANSLATE_END */';
const digest = text => crypto.createHash('sha256').update(text).digest('hex');
// vscode.env.appRoot reports "c:\..." while other callers pass "C:\..."; state is keyed by this path.
const normalizeRoot = root => path.resolve(root).replace(/^[a-z]:/, drive => drive.toUpperCase());
const pathsFor = root => ({
  bundle: path.join(root, 'out', 'vs', 'workbench', 'workbench.desktop.main.js'),
  html: path.join(root, 'out', 'vs', 'code', 'electron-browser', 'workbench', 'workbench.html'),
  webview: path.join(root, 'out', 'vs', 'workbench', 'contrib', 'webview', 'browser', 'pre', 'index.html'),
  product: path.join(root, 'product.json')
});
// VS Code's integrity check: base64 SHA-256 without padding, compared to product.json "checksums".
const vscodeChecksum = text => crypto.createHash('sha256').update(Buffer.from(text, 'utf8')).digest('base64').replace(/=+$/, '');
const CHECKSUMMED = { bundle: 'vs/workbench/workbench.desktop.main.js', html: 'vs/code/electron-browser/workbench/workbench.html' };
const withoutChecksums = text => text.replace(/"checksums"\s*:\s*\{[^}]*\}/, '');
const escapeRegExp = text => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
// VS Code's main process reads product.json once at launch, so after (re)patching, a window reload would still
// compare the new files against stale checksums and show "Your Code installation appears to be corrupt".
// The integrity check is redirected to the checksums currently on disk (same check a full restart performs).
const FRESH = '(await globalThis.__imtFreshChecksums?.())||';
const ISPURE = /(async _isPure\(\)\{let \w+=)(this\.productService\.checksums\|\|\{\};)/;
const FRESH_HELPER = `globalThis.__imtFreshChecksums=async()=>{try{` +
  `const r=await fetch(new URL('../../../../../product.json',location.href),{cache:'no-store'});` +
  `const p=r.ok?await r.json():null;return p&&p.checksums&&typeof p.checksums==='object'?p.checksums:null}catch{return null}};`;
// Removes exactly what patchSources adds, so "only our patch differs" can be verified against the backup.
function withoutOurPatch(key, text, endpoint) {
  const block = new RegExp(`\\n${escapeRegExp(BEGIN)}[\\s\\S]*?${escapeRegExp(END)}\\n`, 'g');
  if (key === 'bundle') return text.replace(block, '').split(FRESH).join('');
  if (key === 'html') return text.replace(` ${endpoint};`, ';');
  if (key === 'webview') {
    return text.replace(block, '').replace(`connect-src ${endpoint}; `, '').replace(/'sha256-[A-Za-z0-9+/=]+'/g, "'sha256'");
  }
  return withoutChecksums(text);
}

// Serializes patching across VS Code windows (each runs its own extension host).
async function withPatchLock(stateFolder, action, { timeoutMs = 120000, staleMs = 180000 } = {}) {
  fs.mkdirSync(stateFolder, { recursive: true });
  const lock = path.join(stateFolder, 'patch.lock');
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      fs.writeFileSync(lock, String(process.pid), { flag: 'wx' });
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      try {
        if (Date.now() - fs.statSync(lock).mtimeMs > staleMs) { fs.unlinkSync(lock); continue; }
      } catch { continue; }
      if (Date.now() > deadline) throw new Error('Another VS Code window is still patching; try again shortly.');
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  try { return await action(); }
  finally { try { fs.unlinkSync(lock); } catch { /* already removed */ } }
}

function updateChecksums(product, patched) {
  let result = product;
  for (const [key, rel] of Object.entries(CHECKSUMMED)) {
    const pattern = new RegExp(`("${rel.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}"\\s*:\\s*")([^"]*)(")`);
    result = result.replace(pattern, (_all, open, _old, close) => open + vscodeChecksum(patched[key]) + close);
  }
  return result;
}

function addConnectSource(html, endpoint) {
  let count = 0;
  const result = html.replace(/connect-src(\s+)([^;"]+)(;)/g, (match, space, sources, end) => {
    count++;
    return `connect-src${space}${sources} ${endpoint}${end}`;
  });
  if (count !== 1) throw new Error('Unsupported workbench CSP: expected exactly one connect-src directive');
  return result;
}

function patchSources(originals, runtime, config) {
  if (!originals.bundle.includes('Copyright (C) Microsoft Corporation')) {
    throw new Error('Unsupported workbench bundle');
  }
  const block = `${BEGIN}\n;(${runtime})(${JSON.stringify(config)});\n${END}`;
  // Optional: an unknown future layout only loses the reload-without-warning nicety, not translation.
  const bundleSource = ISPURE.test(originals.bundle) ? originals.bundle.replace(ISPURE, `$1${FRESH}$2`) : originals.bundle;
  const bundleBlock = bundleSource === originals.bundle ? block : `${BEGIN}\n${FRESH_HELPER}\n;(${runtime})(${JSON.stringify(config)});\n${END}`;
  const bundle = bundleSource + '\n' + bundleBlock + '\n';
  const html = addConnectSource(originals.html, config.endpoint);
  const pattern = /(<script async type="module">)([\s\S]*?)(<\/script>)/g;
  const scripts = [...originals.webview.matchAll(pattern)];
  if (scripts.length !== 1 || !originals.webview.includes("const getActiveFrame =")) {
    throw new Error('Unsupported webview preload layout; installation left unchanged');
  }
  const script = scripts[0][2] + '\n' + block + '\n';
  // HTML parsers normalize CRLF before evaluating inline scripts and CSP hashes.
  const oldHash = crypto.createHash('sha256').update(scripts[0][2].replace(/\r\n?/g, '\n')).digest('base64');
  const newHash = crypto.createHash('sha256').update(script.replace(/\r\n?/g, '\n')).digest('base64');
  if (!originals.webview.includes(`'sha256-${oldHash}'`)) {
    throw new Error('Webview script CSP hash mismatch; installation left unchanged');
  }
  const webview = originals.webview
    .replace(pattern, (_all, open, _script, close) => open + script + close)
    .replace(`'sha256-${oldHash}'`, `'sha256-${newHash}'`)
    .replace("frame-src 'self';", `connect-src ${config.endpoint}; frame-src 'self';`);
  const patched = { bundle, html, webview };
  if (originals.product !== undefined) patched.product = updateChecksums(originals.product, patched);
  return patched;
}

function atomicWrite(file, text) {
  const temp = file + '.immersive-translate.tmp';
  const previous = fs.existsSync(file) ? fs.statSync(file) : null;
  try {
    fs.writeFileSync(temp, text, 'utf8');
    if (previous && process.platform !== 'win32') {
      fs.chmodSync(temp, previous.mode & 0o7777);
      // An elevated (root) run must not leave root-owned files in a user-owned installation,
      // or the user's own VS Code updates and later unprivileged repairs would fail.
      if (process.getuid?.() === 0) fs.chownSync(temp, previous.uid, previous.gid);
    }
    fs.renameSync(temp, file);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}

function applyPatch(root, stateFolder, runtime, config) {
  root = normalizeRoot(root);
  fs.mkdirSync(stateFolder, { recursive: true });
  const files = pathsFor(root);
  const stateFile = path.join(stateFolder, `patch-${digest(root).slice(0, 16)}.json`);
  const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : null;
  const originals = {};
  const current = {};
  for (const [key, file] of Object.entries(files)) {
    current[key] = fs.readFileSync(file, 'utf8');
    // State written by older versions has no record for newly managed files (e.g. product.json).
    const record = state?.files[key];
    const backup = record && fs.existsSync(record.backup) ? fs.readFileSync(record.backup, 'utf8') : undefined;
    const backupValid = backup !== undefined && digest(backup) === record.originalHash;
    if (record && digest(current[key]) === record.patchedHash) {
      if (!backupValid) throw new Error(`Backup corrupted: ${file}`);
      originals[key] = backup;
    } else if (record && backupValid && withoutOurPatch(key, current[key], config.endpoint) === withoutOurPatch(key, backup, config.endpoint)) {
      // Only our own patch differs from the verified pristine backup: an earlier/interrupted run of this extension
      // (e.g. an older UI version or two windows patching concurrently). Rebuild from the backup instead of failing.
      originals[key] = backup;
    } else if (current[key].includes(BEGIN) || (record && digest(current[key]) !== record.originalHash)) {
      throw new Error(`Installation changed outside this extension: ${file}. Restore or reinstall VS Code before repair.`);
    } else {
      originals[key] = current[key];
    }
  }
  const patched = patchSources(originals, runtime, config);
  if (Object.keys(files).every(key => current[key] === patched[key])) return { changed: false, stateFile };
  // Preflight every target before changing any file.
  for (const file of Object.values(files)) {
    fs.accessSync(file, fs.constants.W_OK);
    const probe = file + '.immersive-translate.tmp';
    fs.writeFileSync(probe, '', { flag: 'wx' });
    fs.unlinkSync(probe);
  }
  const next = { root, files: {} };
  for (const [key, file] of Object.entries(files)) {
    const backup = path.join(stateFolder, `${digest(root).slice(0, 16)}-${key}.original`);
    if (!fs.existsSync(backup)) fs.writeFileSync(backup, originals[key], 'utf8');
    if (digest(fs.readFileSync(backup, 'utf8')) !== digest(originals[key])) {
      throw new Error(`Existing backup differs: ${backup}`);
    }
    next.files[key] = { file, backup, originalHash: digest(originals[key]), patchedHash: digest(patched[key]) };
  }
  const written = [];
  try {
    for (const [key, file] of Object.entries(files)) {
      atomicWrite(file, patched[key]);
      written.push(key);
    }
    atomicWrite(stateFile, JSON.stringify(next, null, 2));
  } catch (error) {
    const rollbackErrors = [];
    for (const key of written.reverse()) {
      try { atomicWrite(files[key], current[key]); }
      catch (rollbackError) { rollbackErrors.push(String(rollbackError)); }
    }
    if (rollbackErrors.length) throw new Error(`${error}; rollback failed: ${rollbackErrors.join('; ')}`);
    throw error;
  }
  return { changed: true, stateFile };
}

function restorePatch(root, stateFolder) {
  root = normalizeRoot(root);
  const stateFile = path.join(stateFolder, `patch-${digest(root).slice(0, 16)}.json`);
  if (!fs.existsSync(stateFile)) return false;
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  const restore = [];
  for (const record of Object.values(state.files)) {
    const hash = digest(fs.readFileSync(record.file, 'utf8'));
    if (hash === record.originalHash) continue;
    if (hash !== record.patchedHash) throw new Error(`Refusing to overwrite externally changed file: ${record.file}`);
    const original = fs.readFileSync(record.backup, 'utf8');
    if (digest(original) !== record.originalHash) throw new Error(`Backup corrupted: ${record.backup}`);
    restore.push({ ...record, original });
  }
  const written = [];
  try {
    for (const record of restore) {
      const current = fs.readFileSync(record.file, 'utf8');
      atomicWrite(record.file, record.original);
      written.push({ file: record.file, current });
    }
  } catch (error) {
    const errors = [];
    for (const record of written.reverse()) {
      try { atomicWrite(record.file, record.current); }
      catch (rollbackError) { errors.push(String(rollbackError)); }
    }
    if (errors.length) throw new Error(`${error}; restore rollback failed: ${errors.join('; ')}`);
    throw error;
  }
  return restore.length > 0;
}

module.exports = { applyPatch, restorePatch, patchSources, pathsFor, digest, normalizeRoot, withPatchLock };
