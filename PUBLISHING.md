# Publishing Guide

How to publish **Translate Anywhere - Select & Hover Translator** (`MusingZone.vscode-translate-anywhere`) to GitHub, the Visual Studio Marketplace and, optionally, Open VSX.

Official reference: <https://code.visualstudio.com/api/working-with-extensions/publishing-extension>.

## 0. Prerequisites

- **Node.js 22 LTS or newer** (includes npm and npx).
- **Git**, and a GitHub account or organization named `MusingZone`.
- A **Microsoft account** for the Marketplace and Azure DevOps.
- Optional, for the screenshot and UI tests: Python 3.10+ with `pip install playwright pillow` and Google Chrome.

## 1. Repository layout

| Path | In git | In the VSIX | Purpose |
|---|:-:|:-:|---|
| `src/` | ✅ | ✅ | Extension code (`extension.js`, `ui.js`, `panel.js`, `providers.js`, `dictionary-store.js`, …) |
| `tools/maintenance.js` | ✅ | ✅ | Patcher used at runtime (also run elevated) |
| `data/dictionary.json.gz` | ✅ | offline build only | ECDICT-based dictionary (≈ 15 MB) |
| `data/dictionary-source.json` | ✅ | ✅ | Source URL, licence and SHA-256 of the dictionary |
| `data/dictionary-de.json.gz` | ✅ | offline build only | German–Chinese dictionary from HanDeDict (≈ 3 MB, CC BY-SA 3.0) |
| `data/dictionary-de-source.json`, `data/*-LICENSE.txt` | ✅ | ✅ | German dictionary provenance and SHA-256; dictionary licences |
| `images/` | ✅ | ✅ | Extension icon and Activity Bar icon |
| `docs/index.html`, `docs/CNAME`, `docs/images/` | ✅ | ❌ | Publisher website and README screenshots (vsce rewrites image links to GitHub) |
| `package.json`, `package.nls*.json` | ✅ | ✅ | Manifest and English / Chinese / German UI strings |
| `README*.md`, `CHANGELOG.md`, `LICENSE.txt`, `SECURITY.md`, `THIRD-PARTY-NOTICES.md` | ✅ | ✅ | Documentation |
| `PUBLISHING.md`, `CONTRIBUTING.md` | ✅ | ❌ | This guide; contributor guide |
| `test/`, `tools/*.py`, `tools/package.js` | ✅ | ❌ | Tests, image generation, packaging |
| `.github/workflows/` | ✅ | ❌ | CI (`ci.yml`) and tag releases (`release.yml`) |
| `dist/`, `tools/vendor/`, `node_modules/`, `JOURNAL.md` | ❌ | ❌ | Build output, raw ECDICT / HanDeDict sources, dependencies, private notes (all in `.gitignore`) |

## 2. Push the source to GitHub

1. On GitHub, create an **empty public** repository `MusingZone/vscode-translate-anywhere`. Do not add a README, licence or `.gitignore`; they already exist here.
2. In this folder:

   ```powershell
   git init -b main
   git add .
   git status   # JOURNAL.md, dist/ and tools/vendor/ must NOT be listed
   git commit -m "Translate Anywhere 0.3.0"
   git remote add origin https://github.com/MusingZone/vscode-translate-anywhere.git
   git push -u origin main
   ```

   Git asks you to sign in the first time. The browser-based Git Credential Manager login is easiest.
3. On the repository page:
   - Add a description and the topics `vscode-extension`, `translation`, `dictionary` and `chinese`.
   - Enable **Settings → Code security → Private vulnerability reporting**, which `SECURITY.md` refers to.

## 3. Publish the dictionary (once per dictionary version)

The Marketplace (“lite”) package downloads the dictionary on first use. It tries these mirrors in order, and every mirror depends on the tag `dictionary-v1`:

1. `https://github.com/MusingZone/vscode-translate-anywhere/releases/download/dictionary-v1/dictionary.json.gz`
2. `https://cdn.jsdelivr.net/gh/MusingZone/vscode-translate-anywhere@dictionary-v1/data/dictionary.json.gz`
3. `https://fastly.jsdelivr.net/gh/…` (same path)
4. `https://raw.githubusercontent.com/MusingZone/vscode-translate-anywhere/dictionary-v1/data/dictionary.json.gz`

The file is verified against `dictionarySHA256` in `data/dictionary-source.json`, so any mirror that serves a different file is rejected.

```powershell
git tag dictionary-v1
git push origin dictionary-v1
```

Then on GitHub, open **Releases → Draft a new release** and choose the tag `dictionary-v1`. Title it “Dictionary v1”, attach `data/dictionary.json.gz` and publish the release.

Check the mirrors:

```powershell
curl.exe -sIL https://github.com/MusingZone/vscode-translate-anywhere/releases/download/dictionary-v1/dictionary.json.gz | Select-String "HTTP/"
curl.exe -sIL https://cdn.jsdelivr.net/gh/MusingZone/vscode-translate-anywhere@dictionary-v1/data/dictionary.json.gz | Select-String "HTTP/"
```

> **Never move or delete the `dictionary-v1` tag.** Published extensions depend on it.
>
> **German–Chinese dictionary.** The same procedure applies with the tag `dictionary-de-v1` (`GERMAN_RELEASE_TAG` in `src/dictionary-store.js`), the file `data/dictionary-de.json.gz` and the release title “German–Chinese Dictionary v1”. Build it with `python tools/build-de.py` (it needs `tools/vendor/handedict.u8.gz` from the URL in `data/dictionary-de-source.json`, and `data/dictionary.json.gz`) and keep `data/HanDeDict-LICENSE.txt` with it.
>
> If you rebuild the dictionary:
> 1. Run `python tools/build.py`. It needs `tools/vendor/ecdict.csv`, which you can download from the URL in `data/dictionary-source.json`.
> 2. Update the SHA-256 value in `data/dictionary-source.json`.
> 3. Change `RELEASE_TAG` in `src/dictionary-store.js` to `dictionary-v2`.
> 4. Repeat this section with the new tag.

## 4. Create the Marketplace publisher (once)

1. Sign in at <https://marketplace.visualstudio.com/manage> with your Microsoft account.
2. Choose **Create publisher**:
   - **ID**: `MusingZone`. It must equal `"publisher"` in `package.json` and cannot be changed later. IDs are case-insensitive.
   - **Name**: `MusingZone`. Optionally add the GitHub URL and a logo.
3. Set up **Trusted Publishing** so GitHub Actions can publish without a stored token:
   1. On the publisher page, open **Trusted Publishing → Create**.
   2. Fill in:
      - Policy name: `Release workflow`
      - Repository owner: `MusingZone`
      - Repository: `vscode-translate-anywhere`
      - Workflow: `release.yml`
      - Environment: leave empty
   3. `release.yml` already has `id-token: write` and runs `vsce publish --oidc`.

   See <https://code.visualstudio.com/api/working-with-extensions/publishing-extension#secure-automated-publishing-to-visual-studio-marketplace>.
4. Optional, only for publishing from your own machine: create an Azure DevOps **Personal Access Token**.
   - Use **All accessible organizations** with the **Marketplace → Manage** scope.
   - Then run `npx @vscode/vsce login MusingZone`.
   - Never commit the token.

### Verified publisher badge

The verified publisher badge is separate from authentication for publishing. To request it:

1. In the Marketplace management page, open **MusingZone → Details → Verified domain**.
2. Enter and save a root domain that represents the publisher or extension and whose DNS records you can manage. It must use HTTPS, respond with HTTP 200 to a HEAD request, and not be a subdomain. The website should contain information relevant to the extension.
3. Select **Verify** to open the DNS instructions. Add the specified TXT record, then select **Verify** in the dialog to validate the record and submit the request.

Before applying, Microsoft requires at least one extension to have been on the Marketplace for six months and the domain to have been registered for at least six months. Microsoft also reviews the domain, website, extensions and their standing; approval is not immediate or guaranteed. See the [verified publisher requirements](https://code.visualstudio.com/api/working-with-extensions/publishing-extension.md#verify-a-publisher) and [extension runtime security](https://code.visualstudio.com/docs/configure/extensions/extension-runtime-security).

VS Code still asks users to trust a third-party publisher the first time they install one of its extensions, even when the publisher has a verified badge.

### Publisher website

The GitHub Pages landing page is `docs/index.html`; `docs/CNAME` specifies `vta.musingzone.com`. Configure Pages to deploy from the `main` branch's `/docs` folder. A Pages site has only one custom domain, so two separate repositories provide client-side redirects to `https://vta.musingzone.com`, preserving the path, query, and hash:

| Domain | Repository | DNS |
| --- | --- | --- |
| `vta.musingzone.com` (primary) | this repository, `/docs` | `vta` CNAME → `musingzone.github.io` |
| `musingzone.com` (+ `www`) | [`MusingZone/musingzone.com-redirect`](https://github.com/MusingZone/musingzone.com-redirect) | `@` A → GitHub Pages IPs; `www` CNAME → `musingzone.github.io` |
| `vta.musing.zone` | [`MusingZone/vta.musing.zone-redirect`](https://github.com/MusingZone/vta.musing.zone-redirect) | `vta` CNAME → `musingzone.github.io` |

The Marketplace publisher domain must be the root domain (`https://musingzone.com`). The redirect page returns HTTP 200, as Marketplace requires. Both `musingzone.com` and `musing.zone` are verified in the MusingZone GitHub account; keep their `_github-pages-challenge-MusingZone` TXT records. The DNSPod free plan allows only two A records per host, so the root uses two of GitHub's four Pages IPs.

Use GitHub's [custom domain configuration guide](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site) for the current DNS records and HTTPS setup. After the certificates are issued, enable **Enforce HTTPS** in each repository. If a certificate stalls, remove the custom domain and add it again. Confirm that `curl.exe -I https://musingzone.com` returns HTTP 200 from a network that can reach the site.

## 5. Pre-flight checklist (every release)

- [ ] `version` in `package.json` is bumped (SemVer), and `CHANGELOG.md` has a matching section.
- [ ] Unit tests pass: `npm test` (55 tests: patcher, bridge, providers, online services, engine routing/consent, dictionary download, German lookup, vocabulary, string-table parity).
- [ ] UI tests pass (optional, need Playwright and Chrome):
  - `python tools/ui-dom-test.py`, which tests the injected runtime;
  - `python tools/panel-test.py` with no flag, `--zh` and `--de`, which test the sidebar under its CSP.
- [ ] Screenshots are refreshed if the UI changed: `python tools/screenshots.py` writes `docs/images/en` and `docs/images/zh-CN`.
- [ ] Manual check on the latest VS Code Stable:
  1. Enable the integration and reload.
  2. Select and hover in Chat, Markdown preview, Release Notes, Settings and an extension details page.
  3. Try Alt+Z and Alt+W, and the sidebar.
  4. Disable/restore, restart, and confirm there is no “corrupt installation” warning.
- [ ] No secrets or personal paths: `git grep -n -i -E "token|password|apikey|C:\\\\Users"` shows only expected code.

## 6. Build the packages

```powershell
npm run package          # = node tools/package.js
```

This creates eight files in `dist/`:

| File | Size | Use |
|---|---|---|
| `vscode-translate-anywhere-win32-x64-<ver>.vsix` | ≈ 100 KB | **Marketplace** (lite, downloads the dictionaries) |
| `vscode-translate-anywhere-win32-arm64-<ver>.vsix` | ≈ 100 KB | **Marketplace** (lite, downloads the dictionaries) |
| `vscode-translate-anywhere-darwin-x64-<ver>.vsix` | ≈ 100 KB | **Marketplace** (lite, downloads the dictionaries) |
| `vscode-translate-anywhere-darwin-arm64-<ver>.vsix` | ≈ 100 KB | **Marketplace** (lite, downloads the dictionaries) |
| `vscode-translate-anywhere-linux-x64-<ver>.vsix` | ≈ 100 KB | **Marketplace** (lite, downloads the dictionaries) |
| `vscode-translate-anywhere-linux-arm64-<ver>.vsix` | ≈ 100 KB | **Marketplace** (lite, downloads the dictionaries) |
| `vscode-translate-anywhere-linux-armhf-<ver>.vsix` | ≈ 100 KB | **Marketplace** (lite, downloads the dictionaries) |
| `vscode-translate-anywhere-offline-<ver>.vsix` | ≈ 18 MB | GitHub Release only (universal, both dictionaries bundled) |

Options are `--target win32-x64`, `--lite-only` and `--offline-only`. Arguments after `--` are passed to vsce.

Test locally with `code --install-extension dist\vscode-translate-anywhere-win32-x64-<ver>.vsix --force`.

## 7. Publish

**Marketplace, from the command line (recommended).** Publish the exact lite files you tested:

```powershell
npx @vscode/vsce publish --packagePath dist/vscode-translate-anywhere-win32-x64-<ver>.vsix dist/vscode-translate-anywhere-win32-arm64-<ver>.vsix dist/vscode-translate-anywhere-darwin-x64-<ver>.vsix dist/vscode-translate-anywhere-darwin-arm64-<ver>.vsix dist/vscode-translate-anywhere-linux-x64-<ver>.vsix dist/vscode-translate-anywhere-linux-arm64-<ver>.vsix dist/vscode-translate-anywhere-linux-armhf-<ver>.vsix
```

**Marketplace, by web upload.** At <https://marketplace.visualstudio.com/manage>, choose **MusingZone → New extension → Visual Studio Code** and upload each lite `.vsix`.

After upload:
- The Marketplace runs automated validation and a malware scan, which usually takes a few minutes.
- The listing appears at <https://marketplace.visualstudio.com/items?itemName=MusingZone.vscode-translate-anywhere>.
- VS Code users can install it within roughly 5–10 minutes.

**GitHub Release for the code version.**

```powershell
git tag v<ver>
git push origin v<ver>
```

The `Release` workflow (`.github/workflows/release.yml`) does three things:
1. Runs the unit tests and the real-VS Code integration test on Windows, macOS and Linux (`.github/workflows/ci.yml`).
2. Builds all eight VSIXs and attaches them to a GitHub release named after the tag.
3. Publishes the lite packages to the Marketplace through Trusted Publishing (OIDC).

Without a Trusted Publishing policy, the publish step fails. In that case, publish manually as above.

**Open VSX (optional; used by VSCodium, Cursor, Windsurf and others).**

1. Create an account at <https://open-vsx.org> and an access token.
2. Run `npx ovsx create-namespace MusingZone -p <token>` once.
3. Publish with `npx ovsx publish --packagePath dist/vscode-translate-anywhere-win32-x64-<ver>.vsix dist/vscode-translate-anywhere-win32-arm64-<ver>.vsix dist/vscode-translate-anywhere-darwin-x64-<ver>.vsix dist/vscode-translate-anywhere-darwin-arm64-<ver>.vsix dist/vscode-translate-anywhere-linux-x64-<ver>.vsix dist/vscode-translate-anywhere-linux-arm64-<ver>.vsix dist/vscode-translate-anywhere-linux-armhf-<ver>.vsix -p <token>`.

The patcher locates the installation through `vscode.env.appRoot`. Test on each editor before announcing support.

### Updating

1. Run `npm version patch --no-git-tag-version` (or `minor`).
2. Update `CHANGELOG.md`.
3. Commit and push.
4. Push the tag `v<version>`. CI then releases and publishes.

Installed users update automatically. After a VS Code update, the extension re-applies its integration by itself.

### Pre-releases

To publish a pre-release, run `vsce publish --pre-release --packagePath …` manually. The release workflow always publishes stable versions.

## 8. Marketplace policy notes for this extension

- **Installation patching.** The extension modifies files inside the VS Code installation, as “Custom CSS and JS Loader”, “Apc Customize UI++” and “Background” do. Because this is sensitive, keep the following true:
  - it stays off until the user consents;
  - it is disclosed in the README (“How it works”), in the consent dialog and in `SECURITY.md`;
  - Disable restores the original files.

  Misleading listings can be removed by Microsoft.
- **Third-party AI.** The README and `SECURITY.md` state that selected text goes to the chosen provider and that keys live in Secret Storage. Keep that accurate when adding providers.
- **Antivirus heuristics.** For system-wide installs, repair runs elevated (a UAC-elevated PowerShell on Windows, `osascript … with administrator privileges` on macOS, `pkexec` on Linux). If users report AV warnings, recommend the per-user VS Code installer.
- **Names and trademarks.** Do not use other products' names or logos (“Immersive Translate”, the VS Code logo) in the display name, icon or keywords. The README states that the extension is not affiliated with them.
- **Unpublishing.** `vsce unpublish MusingZone.vscode-translate-anywhere` removes all versions. Prefer marking the extension deprecated in the publisher portal.
