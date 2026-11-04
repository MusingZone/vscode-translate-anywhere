'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');

// VS Code's own executable, run with ELECTRON_RUN_AS_NODE, performs the privileged patch (as bin/code does).
// macOS: the main binary of the .app (the extension host itself runs inside a "Code Helper (Plugin)").
function codeExecutableFor(appRoot, execPath = process.execPath, platform = process.platform) {
  if (platform === 'darwin') {
    const macos = path.resolve(appRoot, '..', '..', 'MacOS');
    try {
      const plist = fs.readFileSync(path.resolve(appRoot, '..', '..', 'Info.plist'), 'utf8');
      const name = /<key>CFBundleExecutable<\/key>\s*<string>([^<]+)<\/string>/.exec(plist)?.[1];
      if (name && fs.existsSync(path.join(macos, name))) return path.join(macos, name);
    } catch { /* fall through */ }
    for (const name of ['Electron', 'Code', 'Code - Insiders', 'VSCodium']) {
      if (fs.existsSync(path.join(macos, name))) return path.join(macos, name);
    }
  }
  return execPath;
}

// Read-only installs cannot be patched even with administrator rights.
function readOnlyInstallReason(appRoot, env = process.env) {
  const root = String(appRoot).replace(/\\/g, '/');
  if (root.includes('/AppTranslocation/')) return 'translocated';
  if (root.startsWith('/snap/')) return 'snap';
  if (env.FLATPAK_ID || root.startsWith('/app/')) return 'flatpak';
  return null;
}

const quoteSh = value => `'${String(value).replace(/'/g, `'\\''`)}'`;
const quoteAppleScript = value => `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

// Builds the process to spawn for one elevated maintenance run. Pure, so it is unit-tested on every OS.
function elevationPlan({ platform = process.platform, appRoot, stateFolder, extensionRoot, codeExecutable, mode, resultFile,
  owner = typeof process.getuid === 'function' ? `${process.getuid()}:${process.getgid()}` : '', privileged = true, prompt = '' }) {
  const maintenance = path.join(extensionRoot, 'tools', 'maintenance.js');
  if (platform === 'win32') {
    const script = path.join(extensionRoot, 'tools', 'elevate.ps1');
    const quotePS = value => "'" + value.replace(/'/g, "''") + "'";
    const quoteArg = value => '"' + value.replace(/"/g, '\\"') + '"';
    const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script,
      '-CodeExecutable', codeExecutable, '-AppRoot', appRoot, '-StateFolder', stateFolder,
      '-ExtensionRoot', extensionRoot, '-Mode', mode, '-ResultFile', resultFile];
    const argumentLine = args.map(quoteArg).join(' ');
    const command = `$ErrorActionPreference='Stop'; $p=Start-Process -FilePath powershell.exe -Verb RunAs -ArgumentList ${quotePS(argumentLine)} -Wait -PassThru; exit $p.ExitCode`;
    return { file: 'powershell.exe', args: ['-NoProfile', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')] };
  }
  const nodeArgs = [maintenance, appRoot, stateFolder, extensionRoot, mode, resultFile, owner];
  const shell = ['ELECTRON_RUN_AS_NODE=1', ...[codeExecutable, ...nodeArgs].map(quoteSh)].join(' ');
  if (platform === 'darwin') {
    const suffix = privileged ? ` with administrator privileges${prompt ? ` with prompt ${quoteAppleScript(prompt)}` : ''}` : '';
    return { file: 'osascript', args: ['-e', `do shell script ${quoteAppleScript(shell)}${suffix}`], shell };
  }
  return privileged
    ? { file: 'pkexec', args: ['/usr/bin/env', 'ELECTRON_RUN_AS_NODE=1', codeExecutable, ...nodeArgs], shell: `sudo env ${shell}` }
    : { file: '/bin/sh', args: ['-c', shell], shell };
}

async function elevatedMaintenance({ appRoot, stateFolder, extensionRoot, codeExecutable, mode, prompt }) {
  const resultFile = path.join(stateFolder, `elevation-${crypto.randomUUID()}.json`);
  const plan = elevationPlan({ appRoot, stateFolder, extensionRoot, codeExecutable: codeExecutableFor(appRoot, codeExecutable), mode, resultFile, prompt });
  try {
    let processError;
    await new Promise(resolve => {
      execFile(plan.file, plan.args, { windowsHide: true, timeout: 180000 }, error => { processError = error; resolve(); });
    });
    if (!fs.existsSync(resultFile)) {
      const error = new Error(processError?.code === 'ENOENT'
        ? `${plan.file} is not available to request administrator rights`
        : `Administrator operation did not complete (the prompt may have been cancelled): ${processError?.message || 'no result'}`);
      // Linux without polkit: the user can run the same step in a terminal.
      if (process.platform === 'linux') {
        error.manualCommand = elevationPlan({ appRoot, stateFolder, extensionRoot, codeExecutable: codeExecutableFor(appRoot, codeExecutable), mode,
          resultFile: path.join(stateFolder, 'elevation-00000000-0000-0000-0000-000000000000.json') }).shell;
      }
      throw error;
    }
    const result = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
    if (!result.ok) throw new Error(result.error);
    if (processError) throw processError;
    return { changed: result.changed };
  } finally {
    if (fs.existsSync(resultFile)) fs.unlinkSync(resultFile);
  }
}
module.exports = { elevatedMaintenance, elevationPlan, codeExecutableFor, readOnlyInstallReason };
