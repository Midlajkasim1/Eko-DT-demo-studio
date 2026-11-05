"""The operator's settings, kept apart from the shipped ones: backend/config.local.json laid over backend/config.json.

Every Eko-DT export writes backend/config.json, so extracting a newer ZIP over an installation replaces it, and that happens before any of our code runs: nothing
the operator (or the local AI setup) puts in config.json can survive an update. config.local.json is the file an update cannot touch: the export never contains it.
The backend lays it over config.json when it starts (main.py), and backend/local_ai_setup.py records its AI settings in it and nowhere else.

  * dicts are merged key by key; anything else (a list, a string, a number) in config.local.json replaces the shipped value whole
  * a key that only config.local.json has is added; a key it does not mention keeps the shipped value, so a newer release can change a default or add a setting
  * a config.local.json that cannot be read (broken JSON, not an object) is not used, and the AI assistant is turned OFF until it is fixed: a setting the operator
    may have put there to keep it off must never be silently ignored into "on"

Pure stdlib; no FIN, no network.
"""
from __future__ import annotations

import copy
import json
import os
from typing import Any, Optional

LOCAL_NAME = "config.local.json"


def deep_merge(base: dict, local: dict) -> dict:
    """base with local laid over it (neither is modified)."""
    out = copy.deepcopy(base)
    for key, value in local.items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = deep_merge(out[key], value)
        else:
            out[key] = copy.deepcopy(value)
    return out


def overridden(base: dict, local: dict, prefix: str = "") -> list:
    """The dotted paths in `local` whose value differs from base's: names only, never values (they may be credentials' settings)."""
    paths: list = []
    for key, value in local.items():
        path = f"{prefix}{key}"
        have = base.get(key) if isinstance(base, dict) else None
        if isinstance(value, dict) and isinstance(have, dict):
            paths += overridden(have, value, path + ".")
        elif isinstance(value, dict) and not value:
            continue
        elif value != have or key not in (base if isinstance(base, dict) else {}):
            paths.append(path)
    return paths


def read_local(path: str) -> tuple[Optional[dict], bool, Optional[str]]:
    """(settings, file exists, problem): ({}, False, None) without a file; (None, True, why) for one that cannot be used."""
    if not os.path.exists(path):
        return {}, False, None
    try:
        with open(path, encoding="utf-8-sig") as f:
            data = json.load(f)
    except OSError:
        return None, True, f"{LOCAL_NAME} could not be read (the file is not readable)"
    except ValueError:
        return None, True, f"{LOCAL_NAME} could not be read (it is not valid JSON)"
    if not isinstance(data, dict):
        return None, True, f"{LOCAL_NAME} could not be read (it is not a JSON object)"
    return data, True, None


def apply_local(base: dict, path: str) -> tuple[dict, dict]:
    """(config the backend uses, info {"path", "exists", "overridden": [paths], "error"}). Without a file, or with one that cannot be read, the shipped config
    is returned (copied); in the second case chat.enabled is False."""
    local, exists, problem = read_local(path)
    info: dict[str, Any] = {"path": path, "exists": exists, "overridden": [], "error": problem}
    if problem:
        merged = copy.deepcopy(base)
        chat = merged.get("chat")
        if isinstance(chat, dict):
            chat["enabled"] = False
        else:
            merged["chat"] = {"enabled": False}
        return merged, info
    info["overridden"] = overridden(base, local or {})
    return (deep_merge(base, local) if local else copy.deepcopy(base)), info
