'use strict';
const fs = require('node:fs');
const path = require('node:path');

const keyOf = text => String(text || '').trim().toLowerCase();
const timeOf = value => Date.parse(value || '') || 0;
const MAX_REMOVED = 2000;

/**
 * Merges two vocabulary snapshots ({ entries, removed }) from different computers.
 * Per word, the newest event wins: an entry's `addedAt` against a removal time in `removed` (keyed by lower-case text).
 */
function mergeVocabulary(...snapshots) {
  const entries = new Map();
  const removed = new Map();
  for (const snapshot of snapshots) {
    for (const entry of Array.isArray(snapshot?.entries) ? snapshot.entries : []) {
      const key = keyOf(entry?.text);
      if (!key) continue;
      const known = entries.get(key);
      if (!known || timeOf(entry.addedAt) > timeOf(known.addedAt)) entries.set(key, entry);
    }
    for (const [key, at] of Object.entries(snapshot?.removed || {})) {
      if (timeOf(at) > timeOf(removed.get(key))) removed.set(key, at);
    }
  }
  for (const [key, entry] of entries) {
    if (removed.has(key) && timeOf(removed.get(key)) >= timeOf(entry.addedAt)) entries.delete(key);
    else removed.delete(key);
  }
  const sortedRemoved = [...removed].sort((a, b) => timeOf(b[1]) - timeOf(a[1]) || (a[0] < b[0] ? -1 : 1)).slice(0, MAX_REMOVED);
  return {
    entries: [...entries.values()].sort((a, b) => timeOf(b.addedAt) - timeOf(a.addedAt) || (keyOf(a.text) < keyOf(b.text) ? -1 : 1)),
    removed: Object.fromEntries(sortedRemoved)
  };
}

class Vocabulary {
  /** `onChange` runs after the user adds or removes entries (used to publish them to Settings Sync). */
  constructor(file, { onChange } = {}) {
    this.file = file;
    this.removedFile = file.replace(/\.json$/i, '') + '.removed.json';
    this.onChange = onChange;
  }

  // Re-read on every call: several VS Code windows may share the file.
  list() {
    const entries = this.read(this.file);
    return Array.isArray(entries) ? entries : [];
  }

  /** Removal times of deleted entries, so that a deletion also reaches other computers. */
  removed() {
    const removed = this.read(this.removedFile);
    return removed && typeof removed === 'object' && !Array.isArray(removed) ? removed : {};
  }

  snapshot() {
    return { entries: this.list(), removed: this.removed() };
  }

  /** Replaces the local state with a merged snapshot (no change event: this is not a user edit). */
  replace({ entries, removed }) {
    this.write(this.removedFile, removed);
    this.write(this.file, entries);
  }

  read(file) {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return undefined;
      throw error;
    }
  }

  write(file, value) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = file + '.tmp';
    fs.writeFileSync(temp, JSON.stringify(value, null, 2), 'utf8');
    fs.renameSync(temp, file);
  }

  save(entries, removedKeys = []) {
    const now = new Date().toISOString();
    const removed = this.removed();
    for (const entry of entries) delete removed[keyOf(entry.text)];
    for (const key of removedKeys) removed[key] = now;
    this.replace({ entries, removed: mergeVocabulary({ removed }).removed });
    try { this.onChange?.(); } catch { /* syncing must never break saving */ }
  }

  has(text) {
    return this.list().some(entry => keyOf(entry.text) === keyOf(text));
  }

  /** Adds the entry, or removes it when already saved. Returns whether it is saved afterwards. */
  toggle({ text, translation = '', phonetic = '' }) {
    const entries = this.list();
    const index = entries.findIndex(entry => keyOf(entry.text) === keyOf(text));
    if (index >= 0) {
      entries.splice(index, 1);
      this.save(entries, [keyOf(text)]);
      return false;
    }
    entries.unshift({ text: text.trim(), phonetic, translation: translation.trim(), addedAt: new Date().toISOString() });
    this.save(entries);
    return true;
  }

  remove(texts) {
    const keys = new Set(texts.map(keyOf));
    const entries = this.list();
    const kept = entries.filter(entry => !keys.has(keyOf(entry.text)));
    this.save(kept, [...keys]);
    return entries.length - kept.length;
  }

  toMarkdown(language = 'en') {
    const cell = value => String(value || '').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
    const entries = this.list();
    const rows = entries.map(entry =>
      `| ${cell(entry.text)} | ${cell(entry.phonetic && `/${entry.phonetic}/`)} | ${cell(entry.translation)} | ${cell((entry.addedAt || '').slice(0, 10))} |`);
    const TEXT = {
      en: { title: 'Vocabulary', header: '| Word / phrase | Phonetic | Translation | Added |', empty: 'Nothing saved yet. Select text and click ☆ in the translation popup.' },
      zh: { title: '生词本', header: '| 单词 / 短语 | 音标 | 释义 | 收藏日期 |', empty: '还没有收藏。划词后在弹窗中点击 ☆ 收藏。' },
      de: { title: 'Vokabelliste', header: '| Wort / Ausdruck | Lautschrift | Übersetzung | Hinzugefügt |', empty: 'Noch nichts gespeichert. Text markieren und im Übersetzungsfenster auf ☆ klicken.' }
    };
    // `true` is the pre-0.4 way of asking for Chinese.
    const text = TEXT[language === true ? 'zh' : language] || TEXT.en;
    return [
      `# ${text.title} (${entries.length})`, '',
      entries.length ? `${text.header}\n| --- | --- | --- | --- |\n` + rows.join('\n') : text.empty,
      ''
    ].join('\n');
  }

  toCsv() {
    const quote = value => `"${String(value || '').replace(/"/g, '""')}"`;
    const lines = [['word', 'phonetic', 'translation', 'addedAt'].join(',')];
    for (const entry of this.list()) {
      lines.push([entry.text, entry.phonetic, entry.translation, entry.addedAt].map(quote).join(','));
    }
    // BOM so Excel opens the Chinese text as UTF-8.
    return '\ufeff' + lines.join('\r\n') + '\r\n';
  }
}

module.exports = { Vocabulary, mergeVocabulary };
