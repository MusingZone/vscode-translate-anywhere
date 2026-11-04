'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// The Marketplace build ships without the 15 MB dictionary; it is fetched once from the first mirror that works.
const RELEASE_TAG = 'dictionary-v1';
const REPO = 'MusingZone/vscode-translate-anywhere';
const FILE = 'dictionary.json.gz';
const DEFAULT_MIRRORS = [
  `https://github.com/${REPO}/releases/download/${RELEASE_TAG}/${FILE}`,
  `https://cdn.jsdelivr.net/gh/${REPO}@${RELEASE_TAG}/data/${FILE}`,
  `https://fastly.jsdelivr.net/gh/${REPO}@${RELEASE_TAG}/data/${FILE}`,
  `https://raw.githubusercontent.com/${REPO}/${RELEASE_TAG}/data/${FILE}`
];

/**
 * Where the dictionary should be read from, in priority order:
 * a user-chosen file, the copy bundled in an offline VSIX, then a previous download.
 * @returns {{file: string, kind: 'custom'|'bundled'|'downloaded'} | null}
 */
function locateDictionary({ customPath, bundledFile, storageFolder, sha256 }) {
  if (customPath) {
    if (!fs.existsSync(customPath)) throw new Error(`Dictionary file not found: ${customPath}`);
    return { file: customPath, kind: 'custom' };
  }
  if (bundledFile && fs.existsSync(bundledFile)) return { file: bundledFile, kind: 'bundled' };
  const downloaded = downloadedFile(storageFolder, sha256);
  if (fs.existsSync(downloaded)) return { file: downloaded, kind: 'downloaded' };
  return null;
}

const downloadedFile = (storageFolder, sha256) => path.join(storageFolder, 'dictionary', `dictionary-${sha256.slice(0, 12)}.json.gz`);

/**
 * Downloads the dictionary, trying each mirror in turn, and verifies its SHA-256 before moving it into place.
 * @param {{storageFolder: string, sha256: string, mirrors?: string[], onProgress?: (info: {url: string, received: number, total: number}) => void,
 *          signal?: AbortSignal, fetchImpl?: typeof fetch, timeoutMs?: number}} options
 */
async function downloadDictionary({ storageFolder, sha256, mirrors = DEFAULT_MIRRORS, onProgress, signal, fetchImpl = fetch, timeoutMs = 120000 }) {
  const target = downloadedFile(storageFolder, sha256);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const errors = [];
  for (const url of mirrors.filter(Boolean)) {
    if (signal?.aborted) throw signal.reason || new Error('Download cancelled');
    const temp = `${target}.${process.pid}.${Date.now()}.part`;
    try {
      const signals = [AbortSignal.timeout(timeoutMs), signal].filter(Boolean);
      const response = await fetchImpl(url, { redirect: 'follow', signal: AbortSignal.any(signals) });
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
      const total = Number(response.headers.get('content-length')) || 0;
      const hash = crypto.createHash('sha256');
      const out = fs.createWriteStream(temp);
      let received = 0;
      try {
        for await (const chunk of response.body) {
          hash.update(chunk);
          received += chunk.length;
          if (!out.write(chunk)) await new Promise(resolve => out.once('drain', resolve));
          onProgress?.({ url, received, total });
        }
      } finally {
        await new Promise((resolve, reject) => out.end(error => error ? reject(error) : resolve()));
      }
      const actual = hash.digest('hex');
      if (actual !== sha256) throw new Error(`checksum mismatch (${actual.slice(0, 12)}…)`);
      fs.renameSync(temp, target);
      return { file: target, url };
    } catch (error) {
      fs.rmSync(temp, { force: true });
      if (signal?.aborted) throw signal.reason || error;
      errors.push(`${url}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`Dictionary download failed from every mirror:\n${errors.join('\n')}`);
}

module.exports = { DEFAULT_MIRRORS, RELEASE_TAG, locateDictionary, downloadDictionary, downloadedFile };
