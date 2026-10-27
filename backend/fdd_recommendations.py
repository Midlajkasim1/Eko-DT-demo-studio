"""Deterministic recommended actions for FD&D-diagnosed FIN alarms.

A recommendation is looked up, never generated: it appears only when the alarm was diagnosed by an
FD&D rule (dispatcher CONTROL) and its FIN message matches a catalogue entry that a domain expert
has validated against that rule. No match means no recommendation.

Each CATALOGUE entry:
    id      stable name of the mapping
    match   regex tested against FIN's own alarm message (case-insensitive)
    action  the recommended action, one short sentence
    basis   why the action applies to that rule
All four are required non-empty strings and ids are unique; validate() enforces this at import.

CATALOGUE is empty on purpose. The repository holds no verified list of the FIN FD&D rules or their
messages for any project, and a recommendation written from a guess is worse than none. Add an entry
only for a rule whose exact FIN message and corrective action have been confirmed by someone who
knows that plant.
"""
import re
from functools import lru_cache

_FIELDS = ("id", "match", "action", "basis")


@lru_cache(maxsize=None)
def _pattern(match):
    """Compile each regex once; re's own cache holds only 512 and would recompile past that."""
    return re.compile(match, re.I)


def validate(catalogue):
    """Return the catalogue unchanged, or raise ValueError naming the first broken entry.

    Run at import, so a bad entry stops the backend at start-up instead of raising inside the live
    alarm poll, where it would skip the rest of every cycle.
    """
    seen = set()
    for n, entry in enumerate(catalogue):
        name = f'#{n}' + (f' "{entry["id"]}"' if isinstance(entry, dict) and isinstance(entry.get("id"), str) else "")
        if not isinstance(entry, dict):
            raise ValueError(f"FD&D catalogue entry {name}: must be a dict, got {type(entry).__name__}")
        for field in _FIELDS:
            value = entry.get(field)
            if not isinstance(value, str) or not value.strip():
                raise ValueError(f"FD&D catalogue entry {name}: '{field}' must be a non-empty string, got {value!r}")
        try:
            _pattern(entry["match"])
        except re.error as exc:
            raise ValueError(f"FD&D catalogue entry {name}: 'match' is not a valid regex ({exc})") from exc
        if entry["id"] in seen:
            raise ValueError(f"FD&D catalogue entry {name}: duplicate id")
        seen.add(entry["id"])
    return catalogue


CATALOGUE: tuple = validate(())


def recommend(message, detail, diagnosed, catalogue=None):
    """Return {"recommendation", "basis"} for a matching FD&D alarm, else None."""
    text = " ".join(str(message or "").split())
    if not diagnosed or not text:
        return None
    if catalogue is not None:   # only tests pass one; the poll uses CATALOGUE, validated at import
        validate(catalogue)
    for entry in CATALOGUE if catalogue is None else catalogue:
        if _pattern(entry["match"]).search(text):
            evidence = f'FIN reported "{text}"'
            detail = " ".join(str(detail or "").split())
            if detail:
                evidence += f' ({detail})'
            return {"recommendation": entry["action"], "basis": f'{entry["basis"]} {evidence}.'}
    return None
