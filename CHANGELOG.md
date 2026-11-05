# Changelog

All notable changes to this extension are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.6.2] - Cheaper recommendations

### Fixed
- After a speed test, the **Recommended** group is only judged by a lightweight model (mini, haiku, flash, luna…). If none of your models is lightweight, nothing is asked and no Recommended group is shown, instead of falling back to the fastest model, which may be a premium one.

## [0.6.1] - Sidebar polish

### Added
- The extension's page in **Settings** now links to the sidebar: a tip on top, and **Set it in the sidebar** links on the shortcut, selection-dot, provider and model settings jump straight to the matching control. New command **Open the Sidebar**.
- Sidebar vocabulary shows the five latest entries and a **Show N more** toggle that unfolds the rest in place (scrollable, remembered). Beyond 100 entries a link opens the full list.

### Changed
- After a speed test, the **Recommended** group is picked by the fastest lightweight model you have, not by your configured (possibly premium) model.
- The speed-test tooltip explains that requests to premium models count toward your Copilot premium-request quota and that hidden models are skipped.
- Refreshed README screenshots for the new sidebar layout.

### Fixed
- Garbled characters (`??`) in several Chinese and German setting descriptions (selection dot, model) and in an English range.

## [0.6.0] - Smarter model choice and easier start

### Added
- **Shortcuts & how to use** section at the top of the sidebar explains select, paragraph (Alt+Z) and full-page (Alt+W) translation, with a **Try it on a sample page** button that opens a short practice page.
- When you select a long passage, the popup shows a one-line hint about the paragraph and full-page shortcuts, with a **Translate this paragraph** button. It appears at most three times and stops once you use a shortcut or dismiss it.
- **Open Markdown as preview**: one click makes `.md` files open as a rendered preview by default (easier to read and translate), with **Open as text again** to undo. Also offered once when you open a Markdown file as text.
- The sidebar vocabulary section shows your five most recent entries.
- New commands: **Try It on a Sample Page**, **Open Markdown Files as Preview by Default / as Text by Default**, **Choose Where to Translate**.
- **Customize the selection dot**: click the dot in the sidebar's Shortcuts section to change its size, color, border, opacity and shape with a live preview, or use your own image (PNG, JPG, GIF, WebP or SVG; large images are scaled down). Also available as the command **Customize Selection Dot** and as `translateAnywhere.dot.*` settings.

### Changed
- **Default model**: on a fresh install the extension picks a lightweight model you can see in VS Code's model picker (matched by tier and size words such as luna, haiku, flash, mini, so new versions are recognized without an update). If none matches, the sidebar asks you to choose. **Auto** is still available, but only when you select it.
- Models you hid in VS Code's **Language Models** view are no longer listed or picked, and neither are Copilot's internal helper models that VS Code never shows (for example "GPT-5.4 nano" used for dictation).
- **Recommended** models come from the speed test: after timing your models, one of your own models judges which of them are lightweight and suited to translation. Without such advice there is no Recommended group and models keep VS Code's order.
- **Speed test** is reliable now: it uses a realistic sentence, warms up each model once, times three rounds with limited parallelism and shows the median (and time to first words). It only runs when you click it.
- Sidebar order: Shortcuts before AI engine; Vocabulary before Offline dictionary. **Test AI** is replaced by an **Allow access** link shown only when the model is not authorized yet. Per-surface switches moved to **Where to translate…** in the footer.
- Chinese words in the Marketplace name, description and keywords so the extension is found by searching 翻译.

## [0.5.1] - Sidebar polish

### Changed
- **Test speed** shows its progress on the button, then names the fastest model with a one-click **Use it** link. The model list is sorted by measured speed, with the time in front of each name. Models you have not authorized yet are skipped instead of prompting.
- Sidebar sections can be collapsed, and the sidebar remembers which ones you closed. Errors now appear in a dismissible banner at the top.
- The sidebar only shows dictionaries that are relevant to you.
- Better discoverability in Marketplace search.

### Fixed
- Administrator confirmation and read-only installation messages showed `?` instead of Chinese and German text.
- **Select AI Model** for an API provider now continues to the authorization check after you pick a model.
- Shortcuts with the `` ` `` key (for example `` Alt+` ``) are accepted in Settings and in the sidebar recorder.
- Turning off the German dictionary setting takes effect without reloading the window.
- Settings no longer share a sort position, so their order is stable.
- Smaller wording fixes in Chinese messages and settings.

## [0.5.0] - macOS and Linux

### Added
- **macOS** (Apple Silicon and Intel) and **Linux** (x64, ARM64, ARMhf) support. The Marketplace now offers a package for every desktop platform.
- Administrator confirmation on every platform when the VS Code installation is not writable: UAC on Windows, the system password dialog on macOS, polkit (`pkexec`) on Linux. Files written while elevated are handed back to your user account.
- On Linux without a polkit agent, the error offers a **Copy Terminal Command** button with the equivalent `sudo` command.
- Clear messages for installations that cannot be modified: macOS App Translocation (VS Code started from Downloads or a disk image), Snap and Flatpak.
- An integration test that downloads the current VS Code Stable and patches, relaunches and restores it for real. CI runs it on Windows, macOS and Linux before every release.

### Changed
- The offline VSIX is now a single universal package, `vscode-translate-anywhere-offline-<version>.vsix`.

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
