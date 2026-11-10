# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for security problems. Use GitHub's private vulnerability reporting instead: *Security → Report a vulnerability* at https://github.com/MusingZone/vscode-translate-anywhere/security.

You should receive a response within 7 days.

## Security design notes

- **Installation changes.** The extension changes VS Code's own UI files only after explicit consent (`translateAnywhere.integration.enabled`). Originals are backed up and restored atomically, and the extension refuses to overwrite files changed by anyone else.
- **Elevation.** For system-wide installations, a single maintenance operation runs elevated through the platform's own prompt (UAC on Windows, the administrator password dialog on macOS, polkit `pkexec` on Linux). No service, scheduled task or persistent elevated process is created.
- **Local bridge.**
  - Listens on `127.0.0.1:17865` only.
  - Every request needs a random 256-bit token generated per installation and stored in the extension's global storage.
  - Requests are accepted only from VS Code's own origins (`vscode-file://vscode-app` and `vscode-webview://`).
  - Input size is limited.
- **Known limitation.** The token is embedded in the patched UI files. In system-wide installations those files are readable by other local users of the same machine, who could then call the bridge to run dictionary lookups or AI translations through your VS Code session while it is open. Use a per-user VS Code installation on shared machines.
- **AI providers and API keys.**
  - API keys are stored only in VS Code's Secret Storage (the OS keychain). They are never written to settings or logs, and they are sent only to the configured provider's base URL.
  - Selected text is sent to that provider. Changing `translateAnywhere.ai.baseUrl` redirects both the text and the key, so only use endpoints you trust.
- **Dictionary download.** The dictionary is downloaded over HTTPS and verified against a SHA-256 hash shipped in the extension before it is used. A custom `dictionary.downloadUrl` must serve the identical file.
- **Token-free online translation.**
  - Disabled unless the online engine is explicitly selected and the chosen service is separately authorized in this local VS Code profile. Syncing settings does not grant consent. Offline-only mode never calls online or AI translation.
  - Selected text and paragraph/page content go directly to the chosen service's fixed HTTPS endpoint; no cookies, API keys, redirects, extension-owned relay or silent fallback. Source text is in query parameters and may appear in service/proxy logs.
  - Google uses an unofficial experimental endpoint with no availability guarantee. MyMemory's terms permit long-term segment retention and sharing with translation partners. Do not send confidential text, code or credentials.
  - Revoking permission cancels unfinished online work and clears its memory-only cache; already-transmitted text cannot be recalled. Engine, source, provider and target changes cancel online jobs too.
  - Online service output is rendered as text, never trusted HTML. Input, queue, concurrency, timeout and output limits apply.
- **Sidebar webview.**
  - Runs with a nonce-based Content Security Policy and no remote resources.
  - Accepts only an allow-list of setting keys and this extension's own commands.
  - Opens external links only for `https:` URLs.
- **Content Security Policy.** The CSP is extended only with the exact bridge origin. Webview script hashes are recomputed for the exact injected script; `unsafe-inline` is never added.
