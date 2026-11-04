# Contributing to Translate Anywhere

Thanks for helping! Bug reports, translations and pull requests are all welcome.
Please open an [issue](https://github.com/MusingZone/vscode-translate-anywhere/issues) first for larger changes so we can agree on the approach.

## Development setup

Requirements:

- Windows, macOS or Linux with desktop VS Code 1.100 or newer.
- Node.js 22 or newer (the packaging tool `@vscode/vsce` needs it).
- Python 3.10+ with Playwright and Google Chrome for the headless UI tests:
  ```powershell
  pip install playwright
  ```

```powershell
git clone https://github.com/MusingZone/vscode-translate-anywhere.git
cd vscode-translate-anywhere
npm test
```

The extension has no runtime npm dependencies; `src/` is loaded as-is.

To try a change in VS Code, build a package and install it. **Extensions: Install from VSIX…** is the most reliable route because the integration patches VS Code's own UI files, which an Extension Development Host shares with your normal window:

```powershell
npm run package -- --lite-only --target win32-x64
code --install-extension dist\vscode-translate-anywhere-win32-x64-<version>.vsix --force
```

Then run **Developer: Reload Window**.

## Project layout

| Path | What it is |
| --- | --- |
| `src/extension.js` | Activation, settings, commands, AI calls, dictionary loading, sidebar state. |
| `src/ui.js` | The script injected into VS Code's workbench and webviews: red dot, popup, Alt+Z / Alt+W, string tables. |
| `src/panel.js` | The settings sidebar webview. |
| `src/bridge.js` | Local HTTP bridge between the injected UI and the extension (127.0.0.1, token and origin checks). |
| `src/patcher.js`, `src/elevation.js` | Applying, verifying and restoring the VS Code UI integration. |
| `src/providers.js` | AI provider presets, prompts and streaming clients. |
| `src/dictionary.js`, `src/dictionary-store.js` | Offline dictionaries (lookup, German stemming) and the verified download with mirrors. |
| `src/vocabulary.js` | The vocabulary book. |
| `data/` | Dictionary metadata and licenses. The `.json.gz` dictionaries are excluded from the Marketplace build. |
| `tools/` | Build, packaging, test and screenshot scripts. |
| `test/core.test.js` | Unit tests (`node --test`). |

## Tests

Run all three before opening a pull request:

```powershell
npm test                          # unit tests
python tools/ui-dom-test.py       # injected UI in headless Chrome
python tools/panel-test.py        # sidebar; add --zh or --de for the other languages
```

`panel-test.py` needs the `NODE` environment variable when `node` is not on `PATH`.
CI runs the unit tests on every push and pull request.

## Adding an interface language

The interface is translated in four places. The unit test `every interface language has a complete string table` fails until all four are complete, so you cannot miss one silently.

1. **Settings and commands:** copy `package.nls.json` to `package.nls.<locale>.json` (VS Code locale ID, such as `de`, `fr` or `ja`) and translate every value.
2. **Popup:** in `src/ui.js`, add a table to `STRINGS` with every key from `STRINGS.en`.
3. **Sidebar:** in `src/panel.js`, add a table to `STRINGS` with every key from `STRINGS.en`.
4. **Messages:** in `src/extension.js`:
   - add the code to `UI_LANGUAGES` and `resolveUiLanguage()`;
   - extend `L()` with a new argument;
   - give every `L(...)` call its translation.

Finally:

- add the code to the `translateAnywhere.uiLanguage` enum (and its labels) in `package.json`;
- extend the parity test in `test/core.test.js`;
- run `python tools/panel-test.py --<lang>` if you add a flag for it.

Style tips:

- Keep the terms VS Code itself uses in your language (for example "Erweiterung", "Befehlspalette").
- Keep placeholders like `{0}` and `${...}` unchanged.
- Keep product names (VS Code, Copilot, Marketplace) untranslated.

## Dictionaries

| Dictionary | Source | Build | Release tag |
| --- | --- | --- | --- |
| English → Chinese | [ECDICT](https://github.com/skywind3000/ECDICT) (MIT) | `py -3 tools/build.py` | `dictionary-v1` |
| German → Chinese | [HanDeDict](https://handedict.zydeo.net/) (CC BY-SA 3.0) | `py -3 tools/build-de.py` | `dictionary-de-v1` |

The build scripts document where to download the sources (into `tools/vendor/`, which is git-ignored). They write `data/<name>.json.gz` deterministically and record the source and output SHA-256 in `data/<name>-source.json`. The extension verifies downloads against that hash.

To publish a new dictionary version:

1. Bump the release tag in `src/dictionary-store.js` (for example `dictionary-de-v2`).
2. Commit the rebuilt files, then push a tag with that name on that commit.
3. Attach the `.json.gz` to a GitHub release of the same name.

Never replace the file behind an existing tag: installed copies would fail the checksum.

Data derived from HanDeDict must stay under CC BY-SA 3.0 and keep `data/HanDeDict-LICENSE.txt` up to date.

## Pull request guidelines

- Keep changes focused. Never touch the code-editor surfaces: by design the extension does nothing in text editors.
- Add or update tests for behavior changes, and update `README.md`, `README.zh-CN.md` and `CHANGELOG.md` (under a new version heading) when users will notice the change.
- Documentation is written in English; the Chinese README mirrors the English one.
- Files use LF line endings (enforced by `.gitattributes`).
- Do not commit secrets, API keys, personal paths or generated `dist/` packages.
- By contributing, you agree that your contribution is licensed under the [MIT License](LICENSE.txt). Contributions to the German dictionary data are licensed under CC BY-SA 3.0.

## Releasing (maintainers)

See [PUBLISHING.md](PUBLISHING.md). In short: bump `version` in `package.json`, add a CHANGELOG entry, then push a `v<version>` tag. The release workflow runs the Windows/macOS/Linux tests, builds the VSIXs (seven platform-specific lite packages and one universal offline package), creates the GitHub release and publishes to the Marketplace.
