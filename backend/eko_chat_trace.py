"""Eko-Chat call diagnostics: did this question reach a language model, which one, how long it took, and what it chose.

One line per event, on the server's standard output, always the same shape:

  [eko-chat] LLM_CALL_STARTED   stage=interpret provider=ollama model=qwen3.5:4b
  [eko-chat] LLM_CALL_COMPLETED stage=interpret provider=ollama model=qwen3.5:4b ms=842 tool_selected=yes tool=get_environment outcome=ok
  [eko-chat] LLM_CALL_FAILED    stage=interpret provider=ollama model=qwen3.5:4b ms=2012 code=llm_unavailable
  [eko-chat] LLM_CALL_SKIPPED   provider=ollama model=qwen3.5:4b reason=rules_matched
  [eko-chat] TOOL_RESULT        tool=get_environment available=false reason=metric_unavailable
  [eko-chat] CHAT_RESULT        mode=RULES_ONLY handler=rules rule=equipment.list.read tool=find_equipment llm_called=false ...

and every request ends with one CHAT_RESULT whose `mode` is

  RULES_ONLY    deterministic code answered; no language model was called (it was not needed, or none is configured)
  LLM_USED      a language model was called and its output produced the answer (the tool it chose, or its grounded answer)
  LLM_FALLBACK  the model path was entered (rules did not know the question) but did not produce the answer: the model was down, slow, not
                installed, not configured, in cool-down, returned nothing usable or said it was unsupported, or its answer failed the
                grounding check; a fixed reply (or the topic reply) was given instead

(The router's own "llm_fallback" route means the other thing: rules handed the question on to the model. This module's LLM_FALLBACK is about
what came back.)

What is never written: the question or the answer, an API key or its variable's value, the model server's address, session or cookie values, FIN
point IDs or expressions, credentials, tool arguments, or project data. Values are cut to plain names (letters, digits and . _ - , only; a model name
may also hold : and /), anything else is written as "-". `chat.diagnostics: false` in config.json silences the lines; the counters in
GET /api/chat/stats (`modes`, `llm_calls`) stay on either way.
"""
from __future__ import annotations

import re
import time
from typing import Any, Optional

RULES_ONLY, LLM_USED, LLM_FALLBACK = "RULES_ONLY", "LLM_USED", "LLM_FALLBACK"

MODES = {RULES_ONLY: 0, LLM_USED: 0, LLM_FALLBACK: 0}
LLM_CALLS = {"started": 0, "completed": 0, "failed": 0}

_PLAIN = re.compile(r"^[A-Za-z0-9_.,\-]{1,96}$")
_MODEL = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/\-]{0,80}$")
_FIN_REF = re.compile(r"(?:^|[^A-Za-z0-9])@?p:[A-Za-z0-9_]+:r:", re.I)


def _plain(value: Any) -> str:
    text = "-" if value is None else str(value)
    return text if _PLAIN.match(text) else "-"


def _model(value: Any) -> str:
    text = "-" if value is None else str(value)
    return text if _MODEL.match(text) and not _FIN_REF.search(text) else "-"


def emit(event: str, **fields: Any) -> None:
    """One diagnostic line. Written with print() like the rest of the backend's logs; `model` / `provider` keep their ':' and '/'."""
    try:
        parts = [f"{k}={_model(v) if k == 'model' else _plain(v)}" for k, v in fields.items()]
        print(f"[eko-chat] {event:<17} " + " ".join(parts), flush=True)
    except Exception:       # a diagnostic line never breaks a request (a closed or missing stdout, say)
        pass


class ChatTrace:
    """The diagnostics of ONE request. Built by the endpoint, handed to the code that may call a model."""

    def __init__(self, provider: Any, model: Any, enabled: bool = True, t0: Optional[float] = None, counts: bool = True):
        self.provider, self.model = _plain(provider), _model(model)
        self.enabled, self.counts = enabled, counts
        self.t0 = t0 if t0 is not None else time.perf_counter()
        self.calls_started = self.calls_completed = 0
        self.llm_ms = 0.0
        self.used = False                    # a model's output produced the answer
        self.fallback: Optional[str] = None  # why the model path did not produce it
        self.tool: Optional[str] = None
        self.rule: Optional[str] = None
        self.deferred = False                # the endpoint prints the summary (it may still change the reply), not the model path
        self.done = False

    @classmethod
    def null(cls) -> "ChatTrace":
        """A trace that writes and counts nothing: for code called without one (tests, scripts)."""
        return cls("-", "-", enabled=False, counts=False)

    @classmethod
    def for_config(cls, cfg: dict, default_model: str, t0: Optional[float] = None) -> "ChatTrace":
        """The provider and model the request would use: after the environment is applied (see eko_chat_llm.effective)."""
        provider = cfg.get("provider") if isinstance(cfg.get("provider"), str) and cfg.get("provider") else "none"
        if provider == "rules":
            model = "-"
        elif provider == "ollama":
            model = str(cfg.get("model") or default_model).strip()
        else:
            model = str(cfg.get("model") or "-").strip()
        return cls(provider, model, enabled=cfg.get("diagnostics") is not False, t0=t0)

    def _emit(self, event: str, **fields: Any) -> None:
        if self.enabled:
            emit(event, **fields)

    # ── a model call ──
    def call_started(self, stage: str) -> None:
        self.calls_started += 1
        if self.counts:
            LLM_CALLS["started"] += 1
        self._emit("LLM_CALL_STARTED", stage=stage, provider=self.provider, model=self.model)

    def call_completed(self, stage: str, ms: float, tools: Optional[list] = None, outcome: str = "ok") -> None:
        self.calls_completed += 1
        self.llm_ms += ms
        if self.counts:
            LLM_CALLS["completed"] += 1
        tools = [t for t in (tools or []) if isinstance(t, str)]
        self._emit("LLM_CALL_COMPLETED", stage=stage, provider=self.provider, model=self.model, ms=round(ms),
                   tool_selected="yes" if tools else "no", tool=",".join(tools) if tools else None, outcome=outcome)

    def call_failed(self, stage: str, ms: float, code: str) -> None:
        self.llm_ms += ms
        if self.counts:
            LLM_CALLS["failed"] += 1
        self._emit("LLM_CALL_FAILED", stage=stage, provider=self.provider, model=self.model, ms=round(ms), code=code)

    def tool_result(self, tool: str, available: bool, reason: Optional[str] = None) -> None:
        self._emit("TOOL_RESULT", tool=tool, available="true" if available else "false", reason=reason)

    # ── how the request ended ──
    def mark_used(self, tool: Optional[str] = None, rule: Optional[str] = None) -> None:
        self.used = True
        self.tool = tool or self.tool
        self.rule = rule or self.rule

    def mark_fallback(self, reason: str) -> None:
        self.fallback = self.fallback or reason

    def mode(self) -> str:
        if self.used:
            return LLM_USED
        return LLM_FALLBACK if (self.calls_started or self.fallback) else RULES_ONLY

    def finish(self, handler: str, rule: Optional[str] = None, tool: Optional[str] = None, skipped: Optional[str] = None,
               outcome: str = "ok") -> str:
        """Print the request's summary (once) and return its mode."""
        mode = self.mode()
        if self.done:
            return mode
        self.done = True
        if self.counts:
            MODES[mode] += 1
        if mode == RULES_ONLY:
            self._emit("LLM_CALL_SKIPPED", provider=self.provider, model=self.model, reason=skipped or "rules_matched")
        self._emit("CHAT_RESULT", mode=mode, handler=handler, rule=rule or self.rule, tool=tool or self.tool,
                   llm_called="true" if self.calls_started else "false", llm_calls=self.calls_completed, llm_ms=round(self.llm_ms),
                   total_ms=round((time.perf_counter() - self.t0) * 1000), provider=self.provider, model=self.model,
                   fallback_reason=self.fallback, llm_skipped=skipped if mode == RULES_ONLY else None, outcome=outcome)
        return mode

    def run_finished(self, outcome: str, error: Optional[str]) -> None:
        """The model path (LLMRun.finish) is over. The tool-calling path prints its own summary here; the hybrid path leaves it to the endpoint."""
        if self.deferred:
            return
        if outcome == "success" and not error:
            self.mark_used()
        else:
            self.mark_fallback(error or outcome)
        self.finish("llm_tools", outcome="ok" if outcome == "success" and not error else (error or outcome))


def stats() -> dict:
    """Counters since the process started: requests by mode, and model calls by result. No text of any request."""
    return {"modes": dict(MODES), "llm_calls": dict(LLM_CALLS)}
