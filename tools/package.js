#!/usr/bin/env node
// Builds the release VSIXs into dist/ (dictionaries: English–Chinese ECDICT, German–Chinese HanDeDict):
//   vscode-translate-anywhere-<target>-<version>.vsix          lite: dictionary downloaded on first use (Marketplace build)
//   vscode-translate-anywhere-offline-<target>-<version>.vsix  offline: dictionary bundled (GitHub Releases)
// Usage: node tools/package.js [--lite-only|--offline-only] [--target win32-x64] [-- extra vsce args]
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const extra = args.includes('--') ? args.slice(args.indexOf('--') + 1) : [];
const own = args.includes('--') ? args.slice(0, args.indexOf('--')) : args;
const targets = own.includes('--target') ? [own[own.indexOf('--target') + 1]] : ['win32-x64', 'win32-arm64'];
const variants = own.includes('--lite-only') ? ['lite'] : own.includes('--offline-only') ? ['offline'] : ['lite', 'offline'];
const { name, version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const DICTIONARY_RULES = ['data/dictionary.json.gz', 'data/dictionary-de.json.gz'];

const ignore = fs.readFileSync(path.join(root, '.vscodeignore'), 'utf8');
for (const rule of DICTIONARY_RULES) {
  if (!ignore.split(/\r?\n/).includes(rule)) throw new Error(`.vscodeignore must contain "${rule}" (lite build).`);
  if (variants.includes('offline') && !fs.existsSync(path.join(root, rule))) {
    throw new Error(`${rule} is missing; run "py -3 tools/build.py" / "py -3 tools/build-de.py" first.`);
  }
}
const offlineIgnore = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ta-pack-')), '.vscodeignore');
fs.writeFileSync(offlineIgnore, ignore.split(/\r?\n/).filter(line => !DICTIONARY_RULES.includes(line)).join('\n'));

// Prefer a local @vscode/vsce, then npx.
const local = path.join(root, 'node_modules', '@vscode', 'vsce', 'vsce');
const vsce = process.env.VSCE ? [process.execPath, process.env.VSCE] : fs.existsSync(local) ? [process.execPath, local]
  : [process.platform === 'win32' ? 'npx.cmd' : 'npx', '--yes', '@vscode/vsce'];

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
try {
  for (const variant of variants) {
    for (const target of targets) {
      const out = path.join('dist', `${name}-${variant === 'offline' ? 'offline-' : ''}${target}-${version}.vsix`);
      const cmd = [...vsce, 'package', '--target', target, '-o', out,
        ...(variant === 'offline' ? ['--ignoreFile', offlineIgnore] : []), ...extra];
      console.log(`> ${variant} ${target}`);
      const result = spawnSync(cmd[0], cmd.slice(1), { cwd: root, stdio: 'inherit', shell: cmd[0].endsWith('.cmd') });
      if (result.status !== 0) process.exit(result.status || 1);
      console.log(`  ${out} (${(fs.statSync(path.join(root, out)).size / 1048576).toFixed(2)} MB)`);
    }
  }
} finally {
  fs.rmSync(path.dirname(offlineIgnore), { recursive: true, force: true });
}
