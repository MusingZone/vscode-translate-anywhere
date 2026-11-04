# Third-Party Notices

This extension bundles or downloads the following third-party material.

## ECDICT

- Source: https://github.com/skywind3000/ECDICT
- Used for: `data/dictionary.json.gz`, a compact derivative of `ecdict.csv` (word, phonetic and Chinese definitions only). Provenance and the SHA-256 of the source CSV are recorded in `data/dictionary-source.json`.
- License: MIT. The full text is in [`data/ECDICT-LICENSE.txt`](data/ECDICT-LICENSE.txt).

ECDICT includes community-contributed entries. Definitions are shown as-is and may occasionally contain informal or inaccurate content.

## HanDeDict

- Source: https://handedict.zydeo.net/ (Chinese–German dictionary)
- Used for: `data/dictionary-de.json.gz`, a German → Chinese index derived from HanDeDict by `tools/build-de.py`. It is bundled in the offline VSIX and downloaded on first use by the Marketplace build. Provenance, the changes made and the SHA-256 of the source snapshot are recorded in `data/dictionary-de-source.json` and [`data/HanDeDict-LICENSE.txt`](data/HanDeDict-LICENSE.txt).
- License: [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/). The derived data file is distributed under the same license; the license does not extend to the extension's source code (MIT).

HanDeDict is a community project. Entries are shown as-is and may occasionally be inaccurate.