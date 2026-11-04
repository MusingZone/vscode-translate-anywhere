'use strict';
const fs = require('node:fs');
const zlib = require('node:zlib');

const UMLAUTS = { ä: 'a', ö: 'o', ü: 'u' };

/** Candidate base forms for an inflected German word, most likely first. */
function germanCandidates(word) {
  const out = [word];
  const add = value => { if (value.length >= 2 && !out.includes(value)) out.push(value); };
  if (word.includes('ss')) add(word.replace(/ss/g, 'ß'));
  if (word.startsWith('sich ')) add(word.slice(5));
  // Participles: gemacht -> machen, gegangen -> gehen, verkauft -> verkaufen.
  const participle = word.match(/^ge(.{2,}?)(?:et|t|en)$/);
  if (participle) add(participle[1] + 'en'), add(participle[1] + 'n');
  // zu-infinitives inside separable verbs: anzurufen -> anrufen.
  const zu = word.match(/^(.+?)zu(.{3,}en)$/);
  if (zu) add(zu[1] + zu[2]);
  const suffixes = ['ungen', 'innen', 'sten', 'ste', 'ern', 'en', 'em', 'er', 'es', 'est', 'et', 'st', 'te', 'ten', 'tet', 'e', 'n', 's', 't'];
  const verbal = new Set(['est', 'et', 'st', 'te', 'ten', 'tet', 't']);
  for (const suffix of suffixes) {
    if (!word.endsWith(suffix) || word.length - suffix.length < 3) continue;
    const stem = word.slice(0, -suffix.length);
    if (suffix === 'ungen') { add(stem + 'ung'); continue; }
    if (suffix === 'innen') { add(stem + 'in'); continue; }
    if (verbal.has(suffix)) add(stem + 'en');
    add(stem);
    add(stem + 'en');
    add(stem + 'n');
    add(stem + 'e');
  }
  // Plural umlauts: Häuser -> Haus, Bücher -> Buch.
  for (const candidate of [...out]) {
    const plain = candidate.replace(/[äöü](?=[^äöü]*$)/, char => UMLAUTS[char]);
    if (plain !== candidate) add(plain);
  }
  return out;
}

class Dictionary {
  constructor(file, entries, language = 'en') {
    this.entries = entries || JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString('utf8'));
    this.language = language;
  }

  // Off-thread read/decompress so the bridge stays responsive to other windows during startup.
  static async load(file, language = 'en') {
    const compressed = await fs.promises.readFile(file);
    const raw = await new Promise((resolve, reject) =>
      zlib.gunzip(compressed, (error, data) => error ? reject(error) : resolve(data)));
    await new Promise(resolve => setImmediate(resolve));
    return new Dictionary(file, JSON.parse(raw.toString('utf8')), language);
  }

  lookup(text) {
    if (this.language === 'de') return this.lookupGerman(text);
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

  lookupGerman(text) {
    const word = text.trim().toLowerCase().replace(/\s+/g, ' ').replace(/^[„"'»«(]+|[“"'»«).,;:!?]+$/g, '');
    for (const candidate of germanCandidates(word)) {
      if (Object.hasOwn(this.entries, candidate)) {
        const [phonetic, translation] = this.entries[candidate];
        return { found: true, word: candidate, phonetic, translation, source: 'HanDeDict (offline)', language: 'de' };
      }
    }
    return { found: false, word, language: 'de' };
  }
}

module.exports = { Dictionary, germanCandidates };
