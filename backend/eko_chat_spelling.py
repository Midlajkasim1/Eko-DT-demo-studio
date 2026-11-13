"""Eko-Chat spelling help: a misspelt Eko-DT word ("alamr", "temperture", "chilller") is read as the word meant, so the fixed rules can answer it.

Pure text, no model, no FIN, no dependency: a few dozen words and an edit distance. It is deliberately timid:

  * only plain lower- or mixed-case Latin words of five letters or more are looked at; a token with a digit, "-" or "_" (an equipment ID such as AHU-01 or
    FCU_ANC09), an all-capitals token and any number are never touched
  * first choice: the corrected question is one the fixed rules answer (`routed`): that reading is used, and when two different words fit and both give
    such a question, nothing is guessed: the user is asked which one was meant
  * otherwise no rule answers it and the model reads it: a word with exactly ONE candidate is corrected (a word with several is left as written). The
    router has already declined this text, so no tool runs on the guess; the model reads the corrected words and the validation of its tool arguments is
    against the corrected question
  * a plural or singular of a vocabulary word ("temperatures") is a word, not a typo, and is never changed
  * the original wording is kept in the note that says what was understood
"""
from __future__ import annotations

import itertools
import re
from typing import Callable

VOCAB = ("alarm", "alarms", "alert", "alerts", "equipment", "energy", "consumption", "consumed", "temperature", "pressure", "status", "cooling", "tower",
         "towers", "pump", "pumps", "chiller", "chillers", "humidity", "power", "current", "today", "yesterday", "hourly", "weekly", "daily", "monthly",
         "building", "notification", "notifications", "unread", "online", "critical", "warning", "warnings", "usage", "latest", "recent", "electricity",
         "equipments", "assets", "summary", "history", "capabilities")
_TOKEN = re.compile(r"(?<![\w-])[A-Za-z]{5,}(?![\w-])")
# shortcut: real words that sit one edit from a vocabulary word are listed by hand; add one here when a question is "corrected" wrongly
REAL_WORDS = {"bumps", "jumps", "dumps", "lumps", "humps", "pumps", "towel", "towed", "cowers", "powder", "alerts", "chilled", "consumer", "consumers", "consume",
              "consumes", "cooler", "coolers", "cooled", "pumped", "powers", "powered", "tempered"} - set(VOCAB)
MAX_TYPOS = 3          # a question with more unknown words than this is left alone
MAX_COMBOS = 12


def _distance(a: str, b: str, limit: int) -> int:
    """Edit distance with an adjacent swap counted as one edit ("alamr" -> "alarm" is 1); limit + 1 when it is more than limit."""
    if abs(len(a) - len(b)) > limit:
        return limit + 1
    before, row = None, list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            v = min(row[j] + 1, cur[j - 1] + 1, row[j - 1] + (ca != cb))
            if i > 1 and j > 1 and ca == b[j - 2] and a[i - 2] == cb:
                v = min(v, before[j - 2] + 1)
            cur.append(v)
        before, row = row, cur
    return row[-1]


def near(token: str) -> list:
    """The words of the vocabulary this unknown token is exactly one edit from, one per stem. One edit only: two would turn "unavailable" into "available"."""
    low = token.lower()
    if low in VOCAB or low in REAL_WORDS:
        return []
    if any(low + "s" == w or w + "s" == low or low + "es" == w or w + "es" == low for w in VOCAB):
        return []                   # a plural or singular of a word we know
    limit = 1
    found = sorted((_distance(low, w, limit), abs(len(low) - len(w)), w) for w in VOCAB)
    found = [x for x in found if x[0] <= limit]
    out: list = []
    for d, _, w in found:
        if d == found[0][0] and not any(w.rstrip("s") == o.rstrip("s") for o in out):
            out.append(w)
    return out


def _case(original: str, word: str) -> str:
    return word.capitalize() if original[:1].isupper() else word


def interpret(text: str, routed: Callable[[str], bool]) -> dict:
    """What to do with a question's spelling: {} (leave it), {"text": corrected, "note": what was understood} or {"ask": the question to put back}.
    `routed(text)` says whether the fixed rules answer that text."""
    spots = [(m, near(m.group(0))) for m in _TOKEN.finditer(text) if not m.group(0).isupper()]
    spots = [(m, words) for m, words in spots if words]
    if not spots or len(spots) > MAX_TYPOS:
        return {}
    variants = []
    for combo in itertools.islice(itertools.product(*(words for _, words in spots)), MAX_COMBOS):
        fixed = text
        for (m, _), word in sorted(zip(spots, combo), key=lambda x: -x[0][0].start()):
            fixed = fixed[:m.start()] + _case(m.group(0), word) + fixed[m.end():]
        if fixed not in variants and routed(fixed):
            variants.append(fixed)
    if len(variants) == 1:
        return {"text": variants[0], "note": f'Understood "{text.strip()}" as "{variants[0].strip()}".'}
    if len(variants) > 1:
        return {"ask": "Did you mean " + " or ".join(f'"{v.strip()}"' for v in variants[:3]) + "? Please ask again with the one you mean."}
    if routed(text):
        return {}                   # the rules already answer what was written (as "consumer" is): a correction that they cannot answer would only break it
    if all(len(words) == 1 for _, words in spots):
        fixed = text
        for m, words in sorted(spots, key=lambda x: -x[0].start()):
            fixed = fixed[:m.start()] + _case(m.group(0), words[0]) + fixed[m.end():]
        return {"text": fixed, "note": f'Understood "{text.strip()}" as "{fixed.strip()}".'}
    return {}
