# Token-free online translation (0.7.0)

Existing installations keep the AI engine until the user explicitly changes it.

## Research and decision

Checked on 2026-11-10. "Free tier" does not necessarily mean "no credentials".

| Service | Credentials / limits | Decision |
| --- | --- | --- |
| Google Cloud Translation | Official API requires project credentials or an API key; not a zero-configuration anonymous service. | Keep separate from the experimental website endpoint. |
| Microsoft Azure Translator | Official API requires a resource key, token or Entra authentication. | Not a token-free choice. |
| DeepL API Free | Requires an API key even on its free plan. | Not a token-free choice. |
| Youdao text translation | Official documentation requires an application ID and secret, plus a signed request. | Trial credit is not an anonymous API; do not extract website signatures. |
| LibreTranslate | Self-hosting is free; the professionally hosted service requires a paid key. Public third-party instances have independent limits and availability. | Do not hard-code an unknown community server or deploy a user-funded backend. |
| MyMemory | Documented anonymous API; 5,000 characters/day; 500 UTF-8 bytes/request. The source can be `Autodetect` (verified live; the response reports `detectedLanguage`). | Implement, with clear quota and retention warnings. |
| Google Translate website endpoint | The `translate.googleapis.com/translate_a/single?client=gtx` endpoint answered anonymous test requests. This is **not** the supported Google Cloud Translation API. No published quota, availability commitment or integration permission was established by this investigation. | Implement as **experimental**, explicitly selected and separately authorized. Its technical availability must not be interpreted as a guarantee or endorsement; it may stop working at any time. |

No scraping of login sessions, API-key sharing, token acquisition, CAPTCHA bypass, proxy rotation or quota evasion is used. Service errors never cause silent fallback to another company or AI.

### Sources

- [Google Cloud Translation authentication](https://cloud.google.com/translate/docs/authentication)
- [Azure Translator authentication](https://learn.microsoft.com/en-us/azure/ai-services/translator/text-translation/reference/authentication)
- [DeepL authentication](https://developers.deepl.com/docs/getting-started/auth)
- [Youdao text translation API and required credentials](https://ai.youdao.com/DOCSIRMA/html/trans/api/wbfy/index.html)
- [LibreTranslate documentation and hosting distinction](https://docs.libretranslate.com/)
- [MyMemory API specification](https://mymemory.translated.net/doc/spec.php)
- [MyMemory usage limits](https://mymemory.translated.net/doc/usagelimits.php)
- [MyMemory terms and privacy policy](https://mymemory.translated.net/terms-and-conditions)
- [Google terms](https://policies.google.com/terms) and [privacy policy](https://policies.google.com/privacy)

MyMemory's usage page mixes "words" and "characters"; this extension quotes its explicit anonymous **5,000 chars/day** allowance rather than assuming a larger quota. Its terms permit automated API use but prohibit quota circumvention and translating multiple paragraphs in a single request. Segmentation respects paragraph boundaries and the 500-byte limit. The actual allowance is controlled by the service; shared egress IPs can affect availability.

Baidu's documentation URLs returned only a client-rendered navigation shell during this check; Tencent's attempted reference redirected to an overview or returned 404. Their current authentication/quotas were therefore not established from those responses, and neither is presented as a verified token-free option.

## How to use it

1. After updating, run **Developer: Reload Window** in **every** open VS Code window, or restart VS Code. Translations for all windows are answered by whichever window owns the local bridge; versions before 0.7.0 cannot hand it over, so an unreloaded older window would keep translating with AI. This version shows a warning and a sidebar notice when that happens. The existing reversible UI integration may also need repair/reload because the injected runtime changed.
2. Open Translate Anywhere → **Translation engine** → **Online (no API key)**. The permission dialog for the selected service opens immediately.
3. Choose **Google Translate (experimental)**, or **MyMemory**. Source language defaults to automatic detection for both. Switching to a service that is not allowed yet asks again.
4. Read the disclosure and confirm (or click **Allow this service** directly under the engine picker later). Permission is separate for each service, local to the VS Code profile, and is not enabled by changing or syncing settings.
5. Try a public sample sentence, **Alt+Z** for a paragraph, and **Alt+W** for a page. Dictionary hits remain offline. The popup button and source attribution follow the selected engine.
6. Use **Revoke permission** to cancel active/queued online work and clear the online cache. Text already sent cannot be recalled.
7. Select **AI** to return to the existing model/API configuration, or **Offline dictionary only** to disable online/AI translation of dictionary misses and paragraphs.

Do not send confidential workplace text, source code, credentials or other sensitive material. Online requests contain source text in HTTPS query parameters, which can be retained in service/proxy logs. MyMemory states that submitted segments may be retained long-term and shared with translation partners. Selecting an engine is not an organizational approval to transmit data.

The existing `ai.autoTranslate` setting is retained for compatibility but now controls automatic dictionary-miss translation with the selected engine. Paragraph/page shortcuts remain explicit user actions. Online permission covers those automatic and shortcut-driven requests; no network translation occurs on selection alone.

## Runtime guarantees and limitations

- Fixed HTTPS service endpoints, no credentials/cookies, no redirects and no extension-owned relay.
- Case-sensitive memory-only cache, isolated by service/source/target; up to 300 results.
- Two active online translations, up to 24 queued, abortable queue, 30-second total timeout including queue wait. Google HTTP 429/503 responses are retried at most twice for the same request (0.4 s, then 1.2 s). All waits share one 3-second budget per request segment; a Retry-After longer than the remaining budget is honoured by giving up rather than retrying early. This all happens within the 30-second timeout; other failures are not retried and nothing ever falls back to another service. Behind shared corporate proxies Google intermittently answers 429 "unusual traffic" for some egress nodes; if it persists, switch to MyMemory.
- UTF-8-safe splitting (MyMemory: 500 bytes; experimental Google: conservative 1,000 bytes), preserving source whitespace and paragraph boundaries without truncating input.
- With **auto**, Google detects the source itself and MyMemory receives its documented `Autodetect` source; choose an explicit source language if detection guesses wrong.
- HTTP errors, quota exhaustion, invalid JSON, changed response shapes and empty translations are errors, never displayed as successful translations.
- Service-provided strings are rendered as text, not HTML.
- Changing engine, source, service or target cancels online jobs, clears the online cache and restores existing page translations. Revocation is forwarded over the authenticated local bridge when another window owns the requests. That route can only revoke, never grant permission. Revocation cannot remove already-transmitted text.
- Translation quality, terminology preservation and availability are not guaranteed. Unlike the AI prompt, these engines cannot be instructed to preserve identifiers.

## Verification

Six synthetic, nonconfidential translations passed on this machine through its configured network proxy:

| Service | English → Chinese | German → Chinese | English → German |
| --- | --- | --- | --- |
| Google (experimental) | 1,422 ms | 1,243 ms | 506 ms |
| MyMemory | 1,906 ms | 890 ms | 1,059 ms |

These are single observations, not a benchmark, accuracy rating or availability promise. Example input: “This update makes search results appear faster.” Google returned “此更新使搜索结果显示得更快。” and MyMemory returned “此更新可加快搜索结果的显示速度。” No repository/private content was sent.

Plain Node `fetch` on this machine initially ignored proxy environment variables and timed out. The live smoke test used Node 26's `--use-env-proxy`; TLS verification was not disabled. Both services were afterwards confirmed from an actual VS Code extension host through the same proxy, including a 12-paragraph full-page translation with Google.

Reproducible offline checks:

```powershell
npm test
python tools\panel-test.py
python tools\panel-test.py --zh
python tools\panel-test.py --de
python tools\ui-dom-test.py
node tools\package.js
```

Node tests use mocked responses and never contact translation services. Headless UI tests use a mocked bridge and the installed Chrome, without opening a new VS Code window or touching the everyday browser profile. Real extension-host connectivity and translation quality were accepted in a manual trial before release.
