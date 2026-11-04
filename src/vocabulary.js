'use strict';
const fs = require('node:fs');
const path = require('node:path');

const keyOf = text => text.trim().toLowerCase();

class Vocabulary {
  constructor(file) {
    this.file = file;
  }

  // Re-read on every call: several VS Code windows may share the file.
  list() {
    try {
      const entries = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return Array.isArray(entries) ? entries : [];
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
  }

  save(entries) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temp = this.file + '.tmp';
    fs.writeFileSync(temp, JSON.stringify(entries, null, 2), 'utf8');
    fs.renameSync(temp, this.file);
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
      this.save(entries);
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
    this.save(kept);
    return entries.length - kept.length;
  }

  toMarkdown(zh = false) {
    const cell = value => String(value || '').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
    const entries = this.list();
    const rows = entries.map(entry =>
      `| ${cell(entry.text)} | ${cell(entry.phonetic && `/${entry.phonetic}/`)} | ${cell(entry.translation)} | ${cell((entry.addedAt || '').slice(0, 10))} |`);
    const text = zh
      ? { title: '生词本', header: '| 单词 / 短语 | 音标 | 释义 | 收藏日期 |', empty: '还没有收藏。划词后在弹窗中点击 ☆ 收藏。' }
      : { title: 'Vocabulary', header: '| Word / phrase | Phonetic | Translation | Added |', empty: 'Nothing saved yet. Select text and click ☆ in the translation popup.' };
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

module.exports = { Vocabulary };
