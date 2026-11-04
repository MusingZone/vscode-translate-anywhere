"""Rebuild data/dictionary.json.gz from tools/vendor/ecdict.csv (download it from the URL in data/dictionary-source.json).

Packaging is done with vsce: see PUBLISHING.md.
"""
import csv
import gzip
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def dictionary():
    source = ROOT / "tools" / "vendor" / "ecdict.csv"
    entries = {}
    with source.open(encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            word = row["word"].strip().lower()
            translation = row["translation"].strip()
            if word and translation:
                entries[word] = [row["phonetic"].strip(), translation]
    target = ROOT / "data" / "dictionary.json.gz"
    target.parent.mkdir(exist_ok=True)
    data = json.dumps(entries, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    with target.open("wb") as handle:
        with gzip.GzipFile(fileobj=handle, mode="wb", mtime=0, filename="") as compressed:
            compressed.write(data)
    metadata = {
        "source": "https://github.com/skywind3000/ECDICT",
        "downloadURL": "https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv",
        "license": "MIT",
        "entries": len(entries),
        "csvSHA256": hashlib.sha256(source.read_bytes()).hexdigest(),
        "dictionarySHA256": hashlib.sha256(target.read_bytes()).hexdigest(),
    }
    (ROOT / "data" / "dictionary-source.json").write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    print(f"Dictionary: {len(entries)} entries, {target.stat().st_size} compressed bytes")


if __name__ == "__main__":
    dictionary()
