# Changelog

All notable changes to this extension are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.4.0] - German

### Added
- **German → Chinese dictionary.** German words are looked up offline in a dictionary derived from [HanDeDict](https://handedict.zydeo.net/) (CC BY-SA 3.0, about 133,000 headwords).
  - German is recognized from umlauts/ß or from the surrounding paragraph.
  - Plurals, umlaut plurals, verb endings, participles, *zu*-infinitives, superlatives and *ss*/*ß* spellings are reduced to the dictionary form.
  - The Marketplace build downloads it once (about 3 MB, SHA-256 verified, with mirrors) the first time you select a German word. The offline VSIX bundles it.
  - German sentences and paragraphs still go to AI, with a prompt that names the source language explicitly.
- **German interface** (`translateAnywhere.uiLanguage`: `de`): popup, sidebar, messages, settings and command titles.
- New setting `translateAnywhere.dictionary.german` and command **Download German–Chinese Dictionary**. The sidebar shows the German dictionary status.
- `CONTRIBUTING.md` with the development setup and a guide to adding an interface language.

### Changed
- The vocabulary Markdown export follows the interface language.
- German support stays out of the way for everyone else:
  - the interface language still follows VS Code's display language (English when it is not Chinese or German);
  - the German dictionary is only consulted, and only downloaded, when German is detected;
  - a word missed in a German context that has no umlauts falls back to the English dictionary.

### Fixed
- **Clicking anywhere closes the popup**, including clicks in another page. For example, a popup opened in Chat now closes when you click in a Markdown preview, and the reverse also works. Switching to another application still leaves it open.

## [0.3.0] - First Marketplace release

### Added
- **Settings sidebar** in the Activity Bar. It covers:
  - integration status;
  - target language and full-page mode;
  - AI provider and model drop-downs, API keys and an optional speed test;
  - dictionary status and actions, per-surface switches, a shortcut recorder and the vocabulary.
- **AI providers** besides VS Code language models: OpenAI, Anthropic Claude, Google Gemini, DeepSeek, Alibaba Qwen, Moonshot Kimi, Zhipu GLM, SiliconFlow, OpenRouter, Groq, Mistral, Ollama and any OpenAI-compatible endpoint. API keys are kept in VS Code Secret Storage.
- **Dictionary delivery options:**
  - automatic one-time download with mirror fallback (GitHub Releases, jsDelivr, raw.githubusercontent) and SHA-256 verification;
  - an offline VSIX with the dictionary bundled;
  - a local dictionary file (`translateAnywhere.dictionary.path`).
- New settings: `ai.provider`, `ai.apiModel`, `ai.baseUrl`, `dictionary.autoDownload`, `dictionary.path`, `dictionary.downloadUrl`.
- New commands: Select AI Provider, Set API Key, Download Dictionary, Use Local Dictionary File…, Use Default Dictionary, Show Log.
- Chinese README, screenshots and a demo GIF.

### Changed
- Publisher is now `MusingZone`. New icon.
- The Marketplace package no longer bundles the 15 MB dictionary; it is about 80 KB.
- After an AI translation, the popup button reads **Retranslate**.

### Fixed
- No red dot on extension details pages (README / changelog). These webviews are sandboxed without scripts, and timers scheduled on their window never ran.
- Selection translation now also works in Welcome walkthrough steps.
- No red dot in the Chat question box (shown when an agent asks you something), tool confirmations and input notices. These live in the Chat input area, outside the response list.
- New surface `workbenchUI` (on by default) adds notifications, dialogs, workbench hover cards, the Workspace Trust page and empty-view messages. The covered areas follow every workbench CSS rule that makes text selectable; text editors and editor hovers stay excluded.
- Full-page "translation only" mode showed list bullets on an empty line above the translated text.

## [0.2.0] - Initial version (not published)

### Added
- Select & hover translation in Chat, Markdown preview, Release Notes, Settings, Keyboard Shortcuts, extension details pages and the Welcome page. Text editors are never affected.
- Offline English → Chinese dictionary (ECDICT). Automatic AI translation for phrases, sentences, paragraphs and non-Chinese target languages.
- Paragraph translation (default `Alt+Z`) and full-page translation (default `Alt+W`). Both shortcuts are configurable, and full-page translation can be translation-only or bilingual.
- Vocabulary book with CSV export.
- Settings for target language (20 languages), UI language, per-surface switches, shortcuts and the AI model.
- Model picker that opens instantly, with an optional benchmark button.
- English and Simplified Chinese UI.
- Automatic restore of VS Code's files when the extension is uninstalled.
- Automatic reapplication after VS Code updates. A window reload is enough; no "corrupt installation" warning.
