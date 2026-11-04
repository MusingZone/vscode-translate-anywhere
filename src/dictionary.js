'use strict';
const fs = require('node:fs');
const zlib = require('node:zlib');

class Dictionary {
  constructor(file, entries) {
    this.entries = entries || JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString('utf8'));
  }

  // Off-thread read/decompress so the bridge stays responsive to other windows during startup.
  static async load(file) {
    const compressed = await fs.promises.readFile(file);
    const raw = await new Promise((resolve, reject) =>
      zlib.gunzip(compressed, (error, data) => error ? reject(error) : resolve(data)));
    await new Promise(resolve => setImmediate(resolve));
    return new Dictionary(file, JSON.parse(raw.toString('utf8')));
  }

  lookup(text) {
    const word = text.trim().toLowerCase().replace(/[\u2019]/g, "'");
    const candidates = [word];
    if (word.endsWith('ies')) candidates.push(word.slice(0, -3) + 'y');
    if (word.endsWith('s')) candidates.push(word.slice(0, -1));
    if (word.endsWith('es')) candidates.push(word.slice(0, -2));
    if (word.endsWith('ing')) {
      const stem = word.slice(0, -3);
      candidates.push(stem, stem + 'e');
      if (stem.at(-1) === stem.at(-2)) candidates.push(stem.slice(0, -1));
    }
    if (word.endsWith('ed')) candidates.push(word.slice(0, -2), word.slice(0, -1));
    for (const candidate of candidates) {
      if (Object.hasOwn(this.entries, candidate)) {
        const [phonetic, translation] = this.entries[candidate];
        return { found: true, word: candidate, phonetic, translation, source: 'ECDICT (offline)' };
      }
    }
    return { found: false, word };
  }
}

module.exports = { Dictionary };
