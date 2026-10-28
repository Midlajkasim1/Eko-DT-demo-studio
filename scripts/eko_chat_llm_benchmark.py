"""Measure Eko-Chat's hybrid mode against a local Ollama: intent latency, answer latency, structured-output rate, intent accuracy.

Run from the repository root (Windows PowerShell):
    python scripts/eko_chat_llm_benchmark.py                       # live: the configured model on http://localhost:11434
    python scripts/eko_chat_llm_benchmark.py --model qwen3:4b --repeat 3
    python scripts/eko_chat_llm_benchmark.py --unavailable          # nothing listening: how the chat behaves without Ollama
    python scripts/eko_chat_llm_benchmark.py --simulate             # checks this harness with a canned model; NOT a measurement

What it measures: the question goes through the same code the chat endpoint runs (the rules first, then eko_chat_llm.hybrid) over a
SYNTHETIC building (fixed made-up numbers, below), so the times are the model's and the chat code's, not FIN's: FIN polling is not
part of a chat request. It does not touch FIN, a session, the notification database or any project data. Nothing is sent anywhere
but the Ollama address. The first model call is timed separately: it includes loading the model into memory.
"""
import argparse
import asyncio
import json
import os
import statistics
import sys
import time
from datetime import datetime

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend"))

import httpx  # noqa: E402

import eko_chat  # noqa: E402
import eko_chat_llm  # noqa: E402
import eko_chat_router  # noqa: E402

# (area, question, expected tool, expected parameters that must match; tool None = the model should ask for clarification / refuse)
QUESTIONS = [
    ("iaq", "What is the current IAQ index?", "get_environment", {"metric": "iaq"}),
    ("iaq", "How clean is the air inside at the moment?", "get_environment", {"metric": "iaq"}),
    ("iaq", "Is the CO2 getting too high in the building?", "get_environment", {"metric": "co2"}),
    ("energy", "How much energy did the building use today?", "get_energy", {"period": "today"}),
    ("energy", "How many kWh have we burned since midnight?", "get_energy", {"period": "today"}),
    ("energy", "Which part of the building is eating the most electricity?", "get_energy", {"by": "board"}),
    ("equipment", "Is AHU-ANC09-BF-01 online?", "get_equipment_status", {"equipment": "AHU-ANC09-BF-01"}),
    ("equipment", "Can you check on AHU-ANC09-BF-01, it felt warm earlier", "get_equipment_status", {"equipment": "AHU-ANC09-BF-01"}),
    ("equipment", "Give me a list of the fcu units, three is plenty", "find_equipment", {"type": "fcu", "limit": 3}),
    ("equipment", "Tell me how the fan coil on level 2 is doing", None, {}),
    ("alarms", "Show me the latest five alarms.", "get_alarms", {"limit": 5}),
    ("alarms", "Anything critical going wrong right now?", "get_alarms", {"severity": "critical"}),
    ("notifications", "Show recent notifications", "get_notifications", {}),
    ("notifications", "Do I have anything unread waiting for me?", "get_notifications", {"view": "unread"}),
    ("hvac", "Which air handlers are up and running?", "get_hvac_status", {}),
    ("overview", "Can you explain the current building conditions?", "get_building_snapshot", {}),
    ("unsupported", "What is the weather forecast for tomorrow?", None, {}),
]
FLEET = [{"name": n, "floor": "L1", "type": t, "category": "hvac", "tags": [t], "isSystem": True, "inAlarm": False, "alarms": [],
          "points": [{"navName": "Supply Temp", "currentValue": "14", "reporting": True}]}
         for n, t in (("AHU-ANC09-BF-01", "ahu"), ("AHU-ANC09-GF-02", "ahu"), ("FCU-ANC09-L2-01", "fcu"), ("FCU-ANC09-L2-02", "fcu"), ("FCU-ANC09-L2-03", "fcu"))]


def synthetic_view() -> eko_chat.DataView:
    now = datetime.now().isoformat()
    return eko_chat.DataView(
        authenticated=True, project_id="bench", project_name="benchmark-building",
        power={"timestamp": now, "iaq_index": 82.4, "ra_co2": 640.0, "avg_zone_temp": 23.5, "hourly_energy": 120.0, "avg_co2": 650.0},
        equipment={"timestamp": now, "equipment": FLEET},
        alarms={"timestamp": now, "alarms": [], "counts": {"critical": 1, "warning": 2, "info": 1, "total": 4}},
        facility={"totalEquipment": 5, "onlineEquipment": 4, "onlineNames": [e["name"] for e in FLEET[:4]]},
        scope=("bench", "benchmark-building"), notifications=lambda user, site, **kw: {"items": [], "more": False, "unread": 0},
        alarm_records=lambda: [])


def canned(question: str):
    """--simulate: the intent each benchmark question should get, as a perfect model would answer it."""
    for _, q, tool, params in QUESTIONS:
        if q == question:
            name = {"get_building_snapshot": "explain_conditions", "find_equipment": "list_equipment"}.get(tool, tool or "unsupported")
            return {"intent": name, **{k: v for k, v in params.items() if tool}}
    return {"intent": "unsupported"}


def percentile(values, p):
    values = sorted(values)
    return values[min(len(values) - 1, int(round(p / 100 * (len(values) - 1))))] if values else None


async def one(cfg, question):
    view = synthetic_view()
    t0 = time.perf_counter()
    decision = eko_chat_router.route(question)
    if decision["route"] == "direct":
        out = eko_chat_router.execute(decision, view)
        return {"route": "rules", "tool": out["intent"], "params": out["parameters"], "ms": (time.perf_counter() - t0) * 1000, "model_ms": 0, "calls": 0,
                "valid": True, "error": None}
    n = len(eko_chat.LLM_RUNS)
    resp = await eko_chat_llm.hybrid(cfg, question, lambda: view, decision.get("reason"))
    total = (time.perf_counter() - t0) * 1000
    run = eko_chat.LLM_RUNS[-1] if len(eko_chat.LLM_RUNS) > n else {}
    call = (resp.get("tool_calls") or [None])[0]
    return {"route": resp["route"], "tool": call["name"] if call else None, "params": call["arguments"] if call else {}, "ms": total,
            "model_ms": run.get("inference_ms") or 0, "calls": run.get("model_calls", 0), "answer_source": resp.get("answer_source"),
            "valid": run.get("error") not in ("llm_invalid_output",), "error": run.get("error")}


def matches(row, tool, params):
    return row["tool"] == tool and all(row["params"].get(k) == v for k, v in params.items())


async def main(args):
    cfg = {"enabled": True, "provider": "ollama", "base_url": args.base_url, "model": args.model, "timeout_s": args.timeout,
           "max_output_tokens": args.max_tokens, "num_ctx": 2048}
    if args.unavailable:
        cfg["base_url"] = "http://127.0.0.1:9"            # nothing listens on the discard port
    if args.simulate:
        def handler(request):
            body = json.loads(request.content)
            if "format" in body:
                return httpx.Response(200, json={"message": {"content": json.dumps(canned(json.loads(body["messages"][1]["content"])["question"]))},
                                                 "prompt_eval_count": 1, "eval_count": 1})
            return httpx.Response(200, json={"message": {"content": "Four alarms are open."}})
        eko_chat.HTTP_TRANSPORT = httpx.MockTransport(handler)
    mode = "SIMULATED (canned model, not a measurement)" if args.simulate else "UNAVAILABLE (no Ollama)" if args.unavailable else "LIVE"
    print(f"mode: {mode}\nmodel: {cfg['model']} @ {cfg['base_url']}   timeout {cfg['timeout_s']} s   max output {cfg['max_output_tokens']} tokens\n")
    cold = None
    if not (args.simulate or args.unavailable):         # the first call loads the model: report it, keep it out of the statistics
        t = time.perf_counter()
        await eko_chat_llm.hybrid(cfg, "warm up: how clean is the air inside?", lambda: synthetic_view(), "unsupported_or_ambiguous")
        cold = (time.perf_counter() - t) * 1000
        failed = eko_chat.LLM_RUNS[-1].get("error") if eko_chat.LLM_RUNS else "no run"
        if failed in ("llm_unavailable", "llm_timeout", "llm_model_missing", "llm_http_error", "llm_invalid_response", "llm_not_configured", "no run"):
            print(f"The model did not answer the warm-up call ({failed}), so there is nothing to measure: no timings are printed.\n"
                  f"  Is Ollama running ({cfg['base_url']}) and is '{cfg['model']}' pulled?  See backend/README.md > Hybrid mode.")
            return 2
        print(f"cold start (model load + first call): {cold:,.0f} ms\n")
    rows = []
    for rep in range(args.repeat):
        for area, question, tool, params in QUESTIONS:
            row = await one(cfg, question)
            row.update(area=area, question=question, expected=tool, ok=matches(row, tool, params) if tool else row["tool"] is None, rep=rep)
            rows.append(row)
    shown = rows[:len(QUESTIONS)]
    print(f"{'area':<15}{'route':<12}{'ms':>8}{'model ms':>10}  {'ok':<4}question")
    for r in shown:
        print(f"{r['area']:<15}{r['route']:<12}{r['ms']:>8.0f}{r['model_ms']:>10.0f}  {'yes' if r['ok'] else 'NO':<4}{r['question'][:60]}")
    model_rows = [r for r in rows if r["route"] != "rules"]
    ms = lambda rs, key: [r[key] for r in rs if r[key] is not None]    # noqa: E731
    print("\nsummary")
    print(f"  questions run                  {len(rows)}   (answered by the rules, no model: {len(rows) - len(model_rows)})")
    print(f"  intent accuracy (all)          {sum(r['ok'] for r in rows)}/{len(rows)}")
    if model_rows:
        parsed = sum(1 for r in model_rows if r["valid"] and r["error"] not in ("llm_unavailable", "llm_timeout", "llm_model_missing", "llm_http_error", "llm_invalid_response", "llm_not_configured", "llm_cooldown"))
        print(f"  model questions                {len(model_rows)}   intent accuracy {sum(r['ok'] for r in model_rows)}/{len(model_rows)}")
        print(f"  structured-output success      {parsed}/{len(model_rows)}   errors: {sorted({r['error'] for r in model_rows if r['error']}) or 'none'}")
        for label, rs in (("model questions (end to end)", model_rows), ("rules questions", [r for r in rows if r["route"] == 'rules'])):
            if rs:
                v = ms(rs, "ms")
                print(f"  {label:<30} p50 {statistics.median(v):,.0f} ms   p95 {percentile(v, 95):,.0f} ms   max {max(v):,.0f} ms")
        one_call = [r["model_ms"] for r in model_rows if r["calls"] == 1 and r["model_ms"]]
        two_call = [r for r in model_rows if r["calls"] == 2]
        if one_call:
            print(f"  intent interpretation (1 call) p50 {statistics.median(one_call):,.0f} ms   p95 {percentile(one_call, 95):,.0f} ms")
        if two_call:
            print(f"  overview, intent + summary     p50 {statistics.median(ms(two_call, 'ms')):,.0f} ms   (summary used by the answer: "
                  f"{sum(1 for r in two_call if r.get('answer_source') == 'llm')}/{len(two_call)})")
    if args.json:
        with open(args.json, "w", encoding="utf-8") as f:
            json.dump({"mode": mode, "model": cfg["model"], "cold_start_ms": cold, "rows": rows}, f, indent=1, default=str)
        print(f"\nwritten: {args.json}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--base-url", default=os.environ.get("OLLAMA_BASE_URL", eko_chat_llm.DEFAULT_BASE_URL))
    ap.add_argument("--model", default=os.environ.get("OLLAMA_MODEL", eko_chat_llm.DEFAULT_MODEL))
    ap.add_argument("--timeout", type=float, default=float(os.environ.get("LLM_TIMEOUT_SECONDS", 60)))
    ap.add_argument("--max-tokens", type=int, default=int(os.environ.get("LLM_MAX_OUTPUT_TOKENS", eko_chat_llm.DEFAULT_MAX_OUTPUT_TOKENS)))
    ap.add_argument("--repeat", type=int, default=1, help="run the question set this many times")
    ap.add_argument("--json", help="also write every row to this file")
    group = ap.add_mutually_exclusive_group()
    group.add_argument("--simulate", action="store_true", help="canned model: checks the harness, measures nothing")
    group.add_argument("--unavailable", action="store_true", help="point at a closed port: how the chat behaves without Ollama")
    sys.exit(asyncio.run(main(ap.parse_args())) or 0)
