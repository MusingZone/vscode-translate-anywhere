'use strict';
// Runs as the "vscode:uninstall" hook (plain Node, no VS Code API) after the extension is uninstalled:
// restores every VS Code installation this extension patched, using the backups in its global storage.
const fs = require('node:fs');
const path = require('node:path');
const { restorePatch } = require('../src/patcher');

// VS Code names globalStorage folders after the lower-cased extension ID (publisher "MusingZone").
const EXTENSION_ID = 'musingzone.vscode-translate-anywhere';
const userDataFolders = () => {
  const base = process.platform === 'win32' ? process.env.APPDATA
    : process.platform === 'darwin' ? path.join(process.env.HOME || '', 'Library', 'Application Support')
      : process.env.XDG_CONFIG_HOME || path.join(process.env.HOME || '', '.config');
  const products = ['Code', 'Code - Insiders', 'Code - Exploration', 'VSCodium'];
  const folders = base ? products.map(product => path.join(base, product, 'User')) : [];
  if (process.env.VSCODE_PORTABLE) folders.push(path.join(process.env.VSCODE_PORTABLE, 'user-data', 'User'));
  return folders;
};

for (const userFolder of userDataFolders()) {
  const stateFolder = path.join(userFolder, 'globalStorage', EXTENSION_ID);
  if (!fs.existsSync(stateFolder)) continue;
  for (const name of fs.readdirSync(stateFolder).filter(file => /^patch-[0-9a-f]+\.json$/.test(file))) {
    try {
      const { root } = JSON.parse(fs.readFileSync(path.join(stateFolder, name), 'utf8'));
      if (root && fs.existsSync(root) && restorePatch(root, stateFolder)) console.log(`Restored ${root}`);
    } catch (error) {
      // Typically missing write access to a machine-wide install; the user can reinstall VS Code to recover.
      console.error(`Could not restore ${name}: ${error.message}`);
    }
  }
}
