'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');

async function elevatedMaintenance({ appRoot, stateFolder, extensionRoot, codeExecutable, mode }) {
  const resultFile = path.join(stateFolder, `elevation-${crypto.randomUUID()}.json`);
  const script = path.join(extensionRoot, 'tools', 'elevate.ps1');
  const quotePS = value => "'" + value.replace(/'/g, "''") + "'";
  const quoteArg = value => '"' + value.replace(/"/g, '\\"') + '"';
  const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script,
    '-CodeExecutable', codeExecutable, '-AppRoot', appRoot, '-StateFolder', stateFolder,
    '-ExtensionRoot', extensionRoot, '-Mode', mode, '-ResultFile', resultFile];
  const argumentLine = args.map(quoteArg).join(' ');
  const command = `$ErrorActionPreference='Stop'; $p=Start-Process -FilePath powershell.exe -Verb RunAs -ArgumentList ${quotePS(argumentLine)} -Wait -PassThru; exit $p.ExitCode`;
  const encoded = Buffer.from(command, 'utf16le').toString('base64');
  try {
    let processError;
    await new Promise(resolve => {
      execFile('powershell.exe', ['-NoProfile', '-EncodedCommand', encoded], {
        windowsHide: true, timeout: 180000
      }, error => { processError = error; resolve(); });
    });
    if (!fs.existsSync(resultFile)) {
      throw new Error(`Administrator operation did not complete (UAC may have been cancelled): ${processError?.message || 'no result'}`);
    }
    const result = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
    if (!result.ok) throw new Error(result.error);
    if (processError) throw processError;
    return { changed: result.changed };
  } finally {
    if (fs.existsSync(resultFile)) fs.unlinkSync(resultFile);
  }
}
module.exports = { elevatedMaintenance };
