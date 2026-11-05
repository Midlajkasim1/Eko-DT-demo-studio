"""Eko-Chat request scope: the project ONE request was validated for, and the ONE deadline it must finish within.

A chat request can be long (a model round takes seconds, a tool-calling conversation several rounds) and the backend serves one project at a time:
another user's project switch can land between two steps of the same request. Two rules keep that from ever mixing projects or running on:

  ProjectContext  captured once, right after the session guard, and never rebuilt from the backend's mutable globals. pinned_view_fn() hands
                  every tool and orchestration step a view whose project IS the context's; before it does, it runs the same guard again and
                  compares the live project with the captured one. A change raises ProjectChanged: the rest of the request is abandoned and the
                  answer is a safe `project_changed` error. There is no fallback to the new project, nor to "the nearest" one.
  Deadline        one budget for the whole request (chat.request_deadline_s, default 90 s), model calls and tool steps together. It is not the
                  per-call timeout times the number of rounds: every model call is bounded by what is LEFT of it, and is cancelled when it runs out.

Pure logic: no FIN, no network, no import of eko_chat or main.
"""
from __future__ import annotations

import asyncio
import dataclasses
import time
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Optional

DEFAULT_DEADLINE_S = 90.0
MIN_DEADLINE_S, MAX_DEADLINE_S = 0.5, 600.0

PROJECT_CHANGED_TEXT = ("The open project changed while this question was being answered, so it was stopped and nothing is shown. "
                        "Ask again for the project that is open now.")


class ProjectChanged(Exception):
    """The project or session this request was validated for is no longer the one the backend serves (or the session ended)."""

    def __init__(self, code: str = "project_changed", message: str = PROJECT_CHANGED_TEXT, status: int = 409):
        super().__init__(message)
        self.code, self.message, self.status = code, message, status

    @classmethod
    def from_http(cls, exc: Any) -> "ProjectChanged":
        """From the HTTPException the session guard raised on a re-check: a session that ended keeps its own code (401), a project or
        site that no longer matches is `project_changed` (409). Nothing else of the guard's message is passed on."""
        status = getattr(exc, "status_code", 409)
        detail = getattr(exc, "detail", None)
        code = detail.get("error") if isinstance(detail, dict) else None
        if status == 401 and code in ("session_required", "session_expired", "fin_not_connected"):
            return cls(code, "The session ended while this question was being answered, so it was stopped. Sign in again and ask again.", 401)
        return cls()


@dataclass(frozen=True)
class ProjectContext:
    """What the session guard validated for this request. Frozen: nothing can re-point it at another project."""
    project_id: Optional[str]      # the Studio project id (the X-Eko-Project header the guard compared)
    project_name: str              # the FIN project name the backend served at that moment
    user: Optional[str]            # the signed-in user the guard returned
    site: Optional[str]            # the FIN project that user's session signed in for


def pinned_view_fn(view_fn: Callable[[], Any], ctx: ProjectContext, recheck: Optional[Callable[[], None]] = None) -> Callable[[], Any]:
    """A view_fn whose every view is for ctx's project, or raises ProjectChanged.

    `view_fn` builds a view from the backend's globals; `recheck` runs the session guard again (it raises ProjectChanged when the session or the
    project it sees is no longer ctx's). The view that comes back carries ctx's own project fields and scope, never the globals'."""
    def fn() -> Any:
        if recheck is not None:
            recheck()
        view = view_fn()
        if not getattr(view, "authenticated", False) or view.project_id != ctx.project_id or view.project_name != ctx.project_name:
            raise ProjectChanged()
        scope = (ctx.user, ctx.site) if ctx.user is not None else None
        return dataclasses.replace(view, project_id=ctx.project_id, project_name=ctx.project_name, scope=scope)
    return fn


class DeadlineExceeded(Exception):
    """The request's overall time budget ran out."""


class Deadline:
    """One time budget for a whole request, counted from its arrival."""

    def __init__(self, seconds: float, t0: Optional[float] = None):
        self.seconds = float(seconds)
        self.t0 = t0 if t0 is not None else time.perf_counter()

    @classmethod
    def from_config(cls, cfg: Any, t0: Optional[float] = None) -> "Deadline":
        """chat.request_deadline_s when it is a plain number in range, else the default (a bad value never disables the deadline)."""
        v = cfg.get("request_deadline_s") if isinstance(cfg, dict) else None
        ok = isinstance(v, (int, float)) and not isinstance(v, bool) and MIN_DEADLINE_S <= v <= MAX_DEADLINE_S
        return cls(v if ok else DEFAULT_DEADLINE_S, t0)

    def remaining(self) -> float:
        return max(0.0, self.seconds - (time.perf_counter() - self.t0))

    def expired(self) -> bool:
        return self.remaining() <= 0.0


async def within(deadline: Optional[Deadline], awaitable: Awaitable) -> Any:
    """Await it, but never past the deadline: what is still running then is cancelled (and its slot, connection or lock released by the
    awaitable's own `async with`/`finally`), and DeadlineExceeded is raised. No deadline: a plain await."""
    if deadline is None:
        return await awaitable
    left = deadline.remaining()
    if left <= 0.0:
        close = getattr(awaitable, "close", None)
        if close is not None:
            close()                          # never awaited: do not leave a coroutine behind
        raise DeadlineExceeded()
    try:
        return await asyncio.wait_for(awaitable, left)
    except asyncio.TimeoutError:
        if deadline.remaining() > 0.05:      # a timeout of the awaitable's own, not the deadline's: not ours to rename
            raise
        raise DeadlineExceeded() from None


def timeout_text(deadline: Optional[Deadline]) -> str:
    n = f"{deadline.seconds:g}" if deadline is not None else str(int(DEFAULT_DEADLINE_S))
    return f"The question was not answered within {n} seconds, so it was stopped. Please try again, or ask one thing at a time."


def partial_prefix(deadline: Optional[Deadline]) -> str:
    n = f"{deadline.seconds:g}" if deadline is not None else str(int(DEFAULT_DEADLINE_S))
    return f"This answer is incomplete: the time limit of {n} seconds was reached. What had been read from FIN by then: "
