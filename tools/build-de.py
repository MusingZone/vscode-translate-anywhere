"""Rebuild data/dictionary-de.json.gz (German -> Simplified Chinese) from HanDeDict.

Download the source first (about 11 MB); data/dictionary.json.gz (ECDICT) must exist too, it is used to rank
Chinese words by how common they are:
    curl -L -o tools/vendor/handedict.u8.gz https://handedict.zydeo.net/api/export/download/handedict.u8.gz

HanDeDict is a Chinese -> German dictionary in CEDICT format, licensed CC BY-SA 3.0. This script reverses it
into a German lookup index; the resulting data file is a derivative work under the same license
(see data/HanDeDict-LICENSE.txt).
"""
import gzip
import hashlib
import json
import re
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "tools" / "vendor" / "handedict.u8.gz"
TARGET = ROOT / "data" / "dictionary-de.json.gz"
MAX_SENSES = 6
MAX_WORDS = 4

LINE = re.compile(r"^(\S+) (\S+) \[([^\]]*)\] /(.*)/\s*$")
PARENS = re.compile(r"\([^()]*\)")
CJK = re.compile(r"[\u3400-\u9fff\uf900-\ufaff]")
# HanDeDict word-class tags -> the short labels Chinese learners know from English dictionaries.
POS = {"S": "n.", "V": "v.", "Adj": "adj.", "Adv": "adv.", "Präp": "prep.", "Konj": "conj.", "Pron": "pron.",
       "Num": "num.", "Int": "int.", "Zähl": "量词", "Interj": "int.", "Part": "part."}

TONES = {"a": "āáǎà", "e": "ēéěè", "i": "īíǐì", "o": "ōóǒò", "u": "ūúǔù", "ü": "ǖǘǚǜ"}


def syllable(text):
    match = re.fullmatch(r"([a-zü:]+)([1-5])", text.lower())
    if not match:
        return text
    letters, tone = match.group(1).replace("u:", "ü").replace("v", "ü"), int(match.group(2))
    if tone == 5:
        return letters
    for vowel in ("a", "e"):
        if vowel in letters:
            index = letters.index(vowel)
            break
    else:
        index = letters.index("ou") if "ou" in letters else max(
            (i for i, c in enumerate(letters) if c in TONES), default=-1)
    if index < 0:
        return letters
    return letters[:index] + TONES[letters[index]][tone - 1] + letters[index + 1:]


def pinyin(text):
    return "".join(syllable(part) for part in text.split())


def tags(gloss):
    """Word class from the trailing "(V)" / "(S, Edu)" annotation, if any."""
    for group in reversed(re.findall(r"\(([^()]*)\)", gloss)):
        first = group.split(",")[0].strip()
        if first in POS:
            return POS[first]
    return ""


def terms(gloss):
    text = PARENS.sub(" ", gloss)
    for part in re.split(r"[,;]", text):
        term = re.sub(r"\s+", " ", part).strip(" .!?…").lower()
        if term and not CJK.search(term) and len(term) <= 48 and len(term.split()) <= MAX_WORDS and re.search(r"[a-zäöüß]", term):
            yield term


def chinese_frequency():
    """How often each Chinese word and character appears in the ECDICT definitions: a free proxy for how common it is."""
    words, chars = defaultdict(int), defaultdict(int)
    with gzip.open(ROOT / "data" / "dictionary.json.gz", "rt", encoding="utf-8") as handle:
        for _phonetic, translation in json.load(handle).values():
            for run in re.findall(r"[\u4e00-\u9fff]+", translation):
                words[run] += 1
                for char in run:
                    chars[char] += 1
    return words, chars


def build():
    import math
    word_freq, char_freq = chinese_frequency()

    def commonness(simp):
        rare = sum(1 for char in simp if char_freq.get(char, 0) < 20)
        return math.log10(1 + word_freq.get(simp, 0)) * 1.2 - rare * 2.5

    candidates = defaultdict(dict)
    entries = 0
    with gzip.open(SOURCE, "rt", encoding="utf-8-sig") as handle:
        for line in handle:
            if line.startswith("#"):
                continue
            match = LINE.match(line.strip())
            if not match:
                continue
            _trad, simp, reading, body = match.groups()
            glosses = [g for g in body.split("/") if g.strip()]
            if not glosses or any(g.startswith(("Familienname", "Variante von", "alte Variante")) for g in glosses):
                continue
            entries += 1
            for sense_index, gloss in enumerate(glosses):
                pos = tags(gloss)
                for term_index, term in enumerate(terms(gloss)):
                    keys = [(term, 0.0)]
                    if term.startswith("sich "):
                        keys.append((term[5:], 0.5))
                    for key, penalty in keys:
                        # Prefer the primary sense, two-character words, and well-described (usually common) entries.
                        score = (sense_index + term_index * 0.5 + abs(len(simp) - 2) * 0.7 - commonness(simp)
                                 - min(len(glosses), 5) * 0.3 + penalty + (1.5 if len(simp) > 4 else 0))
                        best = candidates[key].get(simp)
                        if best is None or score < best[0]:
                            candidates[key][simp] = (score, pos, pinyin(reading))
    index = {}
    for key, words in candidates.items():
        ranked = sorted(words.items(), key=lambda item: item[1][0])[:MAX_SENSES]
        groups = {}
        for simp, (_score, pos, reading) in ranked:
            groups.setdefault(pos, []).append(f"{simp} {reading}")
        lines = [f"{pos} {'；'.join(items)}".strip() for pos, items in groups.items()]
        index[key] = ["", "\n".join(lines)]
    TARGET.parent.mkdir(exist_ok=True)
    data = json.dumps(index, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode("utf-8")
    with TARGET.open("wb") as handle:
        with gzip.GzipFile(fileobj=handle, mode="wb", mtime=0, filename="") as compressed:
            compressed.write(data)
    with gzip.open(SOURCE, "rt", encoding="utf-8-sig") as handle:
        stamp = next((l.split(":", 1)[1].strip() for l in handle if l.startswith("# Datenstand")), "")
    metadata = {
        "source": "https://handedict.zydeo.net/",
        "downloadURL": "https://handedict.zydeo.net/api/export/download/handedict.u8.gz",
        "license": "CC BY-SA 3.0",
        "sourceDate": stamp,
        "sourceEntries": entries,
        "entries": len(index),
        "sourceSHA256": hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
        "dictionarySHA256": hashlib.sha256(TARGET.read_bytes()).hexdigest(),
    }
    (ROOT / "data" / "dictionary-de-source.json").write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    print(f"German dictionary: {len(index)} keys from {entries} entries, {TARGET.stat().st_size} compressed bytes")


if __name__ == "__main__":
    build()
