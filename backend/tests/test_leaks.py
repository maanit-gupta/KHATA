"""GOAL_2.0 P1.1: nothing canned can reach a production code path.

(e) No production file (backend/app/, frontend/src/) references test fixtures, mocks, samples,
    seed data, test folders, or a demo mode. Exceptions live in tests/leak_allowlist.json, each
    with a reason.
(b) No prompt carries a party name or an example sentence: a model given a sample entry pulls an
    unclear transcript towards it. Number-word rules stay, context-free.
(c) The STT call sends no prompt / context / priming text.
(d) No schema carries example, default or sample values (models echo them back).
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.services import llm_router, receipt_ocr
from app.services.sarvam import Sarvam

ROOT = Path(__file__).resolve().parents[2]
PROD_TREES = [ROOT / "backend" / "app", ROOT / "frontend" / "src"]
PROD_SUFFIXES = {".py", ".ts", ".tsx", ".js", ".jsx", ".css", ".json", ".html"}
# GOAL_2.0 §1 names the first five; the rest catch the demo-mode shape that caused P1 (D-049).
LEAK_TERMS = ["fixtures", "mock", "sample_", "seed", "tests/", "e2e/", "demo", "use_mock", "canned"]
ALLOWLIST = json.loads((Path(__file__).parent / "leak_allowlist.json").read_text())["allowed"]


def _prod_files():
    for tree in PROD_TREES:
        for p in sorted(tree.rglob("*")):
            if p.is_file() and p.suffix in PROD_SUFFIXES and "__pycache__" not in p.parts:
                yield p


def _allowed(rel: str, term: str, line: str) -> bool:
    return any(a["path"] == rel and a["term"] == term and a["line_contains"] in line for a in ALLOWLIST)


def test_production_code_references_no_fixtures_mocks_samples_or_demo_data():
    hits = []
    for p in _prod_files():
        rel = p.relative_to(ROOT).as_posix()
        for n, line in enumerate(p.read_text(errors="ignore").splitlines(), 1):
            low = line.lower()
            for term in LEAK_TERMS:
                if term in low and not _allowed(rel, term, line):
                    hits.append(f"{rel}:{n}: '{term}': {line.strip()[:100]}")
    assert not hits, "canned/test data referenced from production code:\n" + "\n".join(hits)


def test_every_allowlist_entry_has_a_reason_and_still_matches_something():
    for a in ALLOWLIST:
        assert a["reason"].strip(), a
        text = (ROOT / a["path"]).read_text()
        assert any(a["term"] in line.lower() and a["line_contains"] in line for line in text.splitlines()), \
            f"stale allowlist entry: {a}"


def test_the_leak_scan_really_scans_both_trees():
    files = [p.relative_to(ROOT).as_posix() for p in _prod_files()]
    assert any(f.startswith("backend/app/services/") for f in files)
    assert any(f.startswith("frontend/src/screens/") for f in files)
    assert "frontend/src/lib/demo.ts" not in files          # the demo backend is gone (D-049)


# --- prompts --------------------------------------------------------------------------------
PROMPTS = {
    "PARSE_SYSTEM": llm_router.PARSE_SYSTEM,
    "QA_SYSTEM": llm_router.QA_SYSTEM,
    "RECEIPT_SYSTEM": llm_router.RECEIPT_SYSTEM,
    "NARRATE_SYSTEM": llm_router.NARRATE_SYSTEM,
}
# Every name that ever appeared as an example in this repo (UI copy, the removed demo, fixtures),
# plus common names STT produces. None may appear in a prompt.
NAMES = ["ramesh", "rakesh", "lakshmi", "laxmi", "suresh", "priya", "balaji", "gupta", "sharma", "asha",
         "vijay", "meena", "gita", "geetha", "anita", "shanti", "ravi", "kumar", "mohan", "raju", "sita",
         "traders", "kirana", "dairy"]
# Capitalised words the prompts may use: ordinary English, no proper nouns. A new capitalised word
# in a prompt fails this test until a person looks at it.
PROMPT_WORDS = {"You", "Rules", "Use", "Copy", "If", "Never", "Words", "A", "Buying", "Number", "ONE",
                "Output", "Answer", "ONLY", "Indian", "English", "Write", "You", "Summarise", "The",
                "Amounts", "Mention", "Several", "No", "Today", "Add"}


@pytest.mark.parametrize("name", PROMPTS)
def test_prompts_contain_no_party_names(name):
    text = PROMPTS[name].lower()
    found = [n for n in NAMES if re.search(rf"\b{n}\b", text)]
    assert not found, f"{name} names {found}"


@pytest.mark.parametrize("name", PROMPTS)
def test_prompts_contain_no_unexpected_proper_nouns(name):
    words = set(re.findall(r"\b[A-Z][A-Za-z]*\b", PROMPTS[name])) - PROMPT_WORDS
    words = {w for w in words if not w.isupper() or len(w) > 3}   # allow short acronyms like OCR, INR
    assert not words, f"{name}: unexpected capitalised words {sorted(words)}"


def test_prompts_have_no_example_sentences():
    for name, text in PROMPTS.items():
        assert "e.g." not in text and "for example" not in text.lower(), name
        assert "ko 250" not in text and "udhaar diya" not in text, name


def test_parse_prompt_numbers_only_in_context_free_number_word_rules():
    """The only digits in PARSE_SYSTEM are the right-hand side of 'number words = digits'."""
    for line in llm_router.PARSE_SYSTEM.splitlines():
        if re.search(r"\d", line):
            stripped = re.sub(r"[a-z][a-z -]* = \d+;?", "", line.lower())
            assert not re.search(r"\d", stripped), f"digit outside a number-word rule: {line!r}"


def test_answer_prompt_gives_no_example_amount():
    assert not re.search(r"\d", llm_router.QA_SYSTEM)
    assert not re.search(r"\d", llm_router.NARRATE_SYSTEM)


# --- schemas --------------------------------------------------------------------------------
def _walk(node, path="$"):
    if isinstance(node, dict):
        for k, v in node.items():
            yield path, k, v
            yield from _walk(v, f"{path}.{k}")
    elif isinstance(node, list):
        for i, v in enumerate(node):
            yield from _walk(v, f"{path}[{i}]")


@pytest.mark.parametrize("schema_name", ["ENTRY_SCHEMA", "RECEIPT_FIELDS_SCHEMA"])
def test_groq_schemas_have_no_examples_or_defaults(schema_name):
    schema = getattr(llm_router, schema_name)
    for path, key, value in _walk(schema):
        assert key not in ("example", "examples", "default", "const"), f"{schema_name} {path}.{key}"
        if key == "description":
            assert not re.search(r"\d", value) and "e.g" not in value, f"{schema_name} {path}: {value!r}"


def test_ocr_extract_schema_has_no_examples_or_defaults():
    for path, key, value in _walk(receipt_ocr.RECEIPT_SCHEMA):
        assert key not in ("example", "examples", "default", "const", "enum"), f"{path}.{key}"
        if key == "description":
            assert not re.search(r"\d", value) and "e.g" not in value, f"{path}: {value!r}"
    # Every field still has a type and a description (Sarvam's schema rules).
    for name, field in receipt_ocr.RECEIPT_SCHEMA["properties"].items():
        assert field["type"] and field["description"].strip(), name


# --- STT priming ----------------------------------------------------------------------------
class _FakeSdk:
    def __init__(self):
        self.kwargs: dict = {}
        self.speech_to_text = SimpleNamespace(transcribe=self._transcribe)

    def _transcribe(self, **kwargs):
        self.kwargs = kwargs
        return SimpleNamespace(transcript="  paid four hundred  ", language_code="hi-IN", request_id="r1")


def _adapter():
    a = Sarvam.__new__(Sarvam)
    a.client = _FakeSdk()
    return a


def test_stt_call_sends_no_prompt_or_context():
    a = _adapter()
    a.transcribe_to_english(b"\x1aE\xdf\xa3" + b"\x00" * 2000, "ta-IN", "audio/webm", "note.webm")
    sent = a.client.kwargs
    assert set(sent) == {"file", "mode", "language_code", "model", "request_options"}
    assert sent["model"] == "saaras:v3" and sent["mode"] == "translate" and sent["language_code"] == "ta-IN"
    for banned in ("prompt", "context", "keyterms", "hotwords", "keyterm"):
        assert banned not in sent


def test_stt_priming_flag_sends_only_the_shops_own_names():
    """STT_PRIME_PARTY_NAMES (off by default, D-045) biases towards names already in this shop's
    book; it never carries an example phrase."""
    a = _adapter()
    a.transcribe_to_english(b"x" * 2000, "hi-IN", keyterms=["Name One", "Name Two"])
    assert a.client.kwargs["keyterms"] == ["Name One", "Name Two"]
    assert a.client.kwargs["model"] == "saaras:v4"


# --- P1.5: translate settings are config, per language ---------------------------------------
class _FakeText:
    def __init__(self):
        self.kwargs: dict = {}

    def translate(self, **kwargs):
        self.kwargs = kwargs
        return SimpleNamespace(translated_text="x")


def test_translate_mode_comes_from_per_language_config(monkeypatch):
    from app import constants
    from app.services import sarvam as sarvam_mod
    a = Sarvam.__new__(Sarvam)
    a.client = SimpleNamespace(text=_FakeText())
    a.translate("Hello", "en-IN", "hi-IN")
    assert (a.client.text.kwargs["model"], a.client.text.kwargs["mode"]) == ("mayura:v1", "modern-colloquial")
    assert a.client.text.kwargs["numerals_format"] == "international"
    monkeypatch.setitem(sarvam_mod.TRANSLATE, "ta-IN", {"model": "sarvam-translate:v1", "mode": "modern-colloquial"})
    a.translate("Hello", "en-IN", "ta-IN")
    assert (a.client.text.kwargs["model"], a.client.text.kwargs["mode"]) == ("sarvam-translate:v1", "formal")
    assert set(constants.TRANSLATE) == set(constants.LANGS)
