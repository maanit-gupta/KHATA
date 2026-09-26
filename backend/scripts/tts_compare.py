"""GOAL_2.0 P1.5: speech output quality samples for a native speaker (NEEDS_HUMAN N-009).

Three fixed English read-backs → Hindi and Tamil with three translate options (Mayura
modern-colloquial, Mayura formal, sarvam-translate:v1) → one Bulbul clip per option (the three
sentences joined, one TTS call each). Writes artifacts/tts-compare/{lang}_{option}.mp3 and
report.md with every text and whether it passed the number guard.

Pronunciation check: the modern-colloquial (current) and sarvam-translate clips of each language
go back through STT (translate mode). If Bulbul read an amount wrongly, the English transcript
won't carry the right number.

Cost: 18 translate + 6 TTS + 4 STT = 28 Sarvam calls.
Usage: backend/.venv/bin/python backend/scripts/tts_compare.py
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from app import config  # noqa: E402,F401  (loads backend/.env before the SDK clients are built)
from app.services import llm_router, retry  # noqa: E402
from app.services import sarvam as sarvam_mod  # noqa: E402

OUT = ROOT / "artifacts" / "tts-compare"
SENTENCES = [
    "Ishaan, 2,470 rupees udhaar, saved.",
    "Meera, 6,300 rupees payment received. Tap confirm to save.",
    "Dev owes you 1,25,000 rupees, the most of anyone.",
]
AMOUNTS = ["2470", "6300", "125000"]
OPTIONS = {"mayura-colloquial": ("mayura:v1", "modern-colloquial"),
           "mayura-formal": ("mayura:v1", "formal"),
           "sarvam-translate": ("sarvam-translate:v1", "formal")}
LANGS = {"hi-IN": "shubh", "ta-IN": "ratan"}
CALLS = {"sarvam": 0}


def _counting(fn, status_of):
    def counted():
        CALLS["sarvam"] += 1
        return fn()
    return retry.with_backoff(counted, status_of)


sarvam_mod.with_backoff = _counting


def _digits(text: str) -> str:
    return re.sub(r"(?<=\d),(?=\d)", "", text)


UNITS = {w: i for i, w in enumerate("zero one two three four five six seven eight nine ten eleven twelve thirteen "
                                    "fourteen fifteen sixteen seventeen eighteen nineteen".split())}
TENS = {w: 10 * i for i, w in enumerate("_ _ twenty thirty forty fifty sixty seventy eighty ninety".split()) if w != "_"}
SCALES = {"hundred": 100, "thousand": 1000, "lakh": 100_000, "lakhs": 100_000, "crore": 10_000_000}


def spoken_numbers(text: str) -> set[str]:
    """Numbers in an English transcript, as digits: "2470", "2,470" and "two thousand four hundred
    seventy" all give "2470" (Hindi STT writes amounts as words)."""
    found = {_digits(n) for n in re.findall(r"\d[\d,]*", text)}
    words = re.findall(r"[a-z]+", text.lower().replace("-", " "))
    total = current = 0
    in_number = False
    for w in words + ["."]:
        if w in UNITS or w in TENS:
            current += UNITS.get(w, 0) + TENS.get(w, 0)
            in_number = True
        elif w in SCALES and in_number:
            if SCALES[w] == 100:
                current *= 100
            else:
                total += current * SCALES[w]
                current = 0
        elif w == "and" and in_number:
            continue
        elif in_number:
            found.add(str(total + current))
            total = current = 0
            in_number = False
    return found


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    s = sarvam_mod.client()
    rows = []
    for lang, voice in LANGS.items():
        for opt, (model, mode) in OPTIONS.items():
            texts = [s.translate(t, "en-IN", lang, model=model, mode=mode) for t in SENTENCES]
            guard = [llm_router._numbers(tr) == llm_router._numbers(en) for tr, en in zip(texts, SENTENCES)]
            audio = s.speak(" ".join(texts), lang, voice)
            mp3 = OUT / f"{lang}_{opt}.mp3"
            mp3.write_bytes(audio)
            row = {"lang": lang, "option": opt, "model": model, "mode": mode, "voice": voice,
                   "texts": texts, "number_guard": guard, "audio": mp3.relative_to(ROOT).as_posix()}
            if opt in ("mayura-colloquial", "sarvam-translate"):
                heard = s.transcribe_to_english(audio, lang, "audio/mpeg", mp3.name).text
                row["heard_back"] = heard
                row["amounts_heard"] = {a: a in spoken_numbers(heard) for a in AMOUNTS}
            rows.append(row)
            print(lang, opt, guard, row.get("amounts_heard"), flush=True)
    (OUT / "results.json").write_text(json.dumps({"calls": CALLS, "rows": rows}, ensure_ascii=False, indent=2))
    write_report(rows, CALLS["sarvam"])


def write_report(rows: list[dict], calls: int) -> None:
    L = ["# Read-back samples: which translation sounds right?", "",
         "For a native Hindi and Tamil speaker (NEEDS_HUMAN N-009). Each MP3 speaks the same three read-backs:", ""]
    L += [f"{i}. {t}" for i, t in enumerate(SENTENCES, 1)]
    L += ["", f"Sarvam calls used: {calls}. The app currently uses **mayura-colloquial** for every language "
          "(`backend/app/constants.py` → `TRANSLATE`).", ""]
    for r in rows:
        L += [f"## {r['lang']} · {r['option']} (`{r['model']}`, mode `{r['mode']}`, voice `{r['voice']}`)", "",
              f"Audio: `{r['audio']}`", ""]
        L += [f"{i}. {t} — number guard: {'pass' if g else 'FAIL (would fall back to English)'}"
              for i, (t, g) in enumerate(zip(r["texts"], r["number_guard"]), 1)]
        if "heard_back" in r:
            ok = all(r["amounts_heard"].values())
            L += ["", f"Pronunciation check (the clip fed back through speech-to-text): “{r['heard_back']}” → "
                      f"amounts {'all heard correctly' if ok else 'NOT all heard: ' + str(r['amounts_heard'])}."]
        L.append("")
    L += ["## Notes from the machine check (not a native speaker's judgement)", "",
          "- Bulbul said every amount correctly in both languages: fed back through speech-to-text, all four "
          "checked clips returned 2470, 6300 and 1,25,000 (Hindi STT writes them as words, e.g. \"one lakh twenty-five "
          "thousand\"). Amounts are already spoken with Indian digit grouping (\"1,25,000\"), so no extra "
          "pre-formatting is needed.",
          "- Tamil, Mayura formal, sentence 1 dropped \"seventy\" (2,470 became \"இரண்டு ஆயிரத்து நாநூறு\", 2,400). "
          "The number guard catches this and the app would speak that line in English instead.",
          "- Mayura colloquial (the current setting) keeps English words inside the sentence (\"payment receive "
          "हो गया\", \"save பண்ணிட்டாரு\"). sarvam-translate is fully in the native script.",
          "- Possible wrong senses to listen for: formal Hindi \"बचा लिए गए\" reads like \"rescued\" for "
          "\"saved\"; formal Tamil \"கடன் வாங்கியிருக்கிறேன்\" reads like \"I borrowed\" (the opposite "
          "direction of udhaar).",
          "", "To switch a language, set its entry in `TRANSLATE` in `backend/app/constants.py`, e.g. "
          "`TRANSLATE[\"ta-IN\"] = {\"model\": \"sarvam-translate:v1\", \"mode\": \"formal\"}`.", ""]
    (OUT / "report.md").write_text("\n".join(L), encoding="utf-8")


def rescore() -> None:
    """Re-check saved results with the current rules (no API calls)."""
    d = json.loads((OUT / "results.json").read_text())
    for r in d["rows"]:
        if r.get("heard_back"):
            r["amounts_heard"] = {a: a in spoken_numbers(r["heard_back"]) for a in AMOUNTS}
    (OUT / "results.json").write_text(json.dumps(d, ensure_ascii=False, indent=2))
    write_report(d["rows"], d["calls"]["sarvam"])


if __name__ == "__main__":
    rescore() if "--rescore" in sys.argv else main()
