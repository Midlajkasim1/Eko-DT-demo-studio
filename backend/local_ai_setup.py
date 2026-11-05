"""Eko-DT local AI step of Start_Viewer_Windows.bat: Ollama and the qwen3:8b model on this machine.

The batch file calls this after it has checked Python and installed the dependencies, and before it starts the backend. It is a step of that script, not a
second installer, and it uses only the Python standard library. In order, it

  1. reads the configuration (config.json with the operator's config.local.json laid over it, see config_overlay) and decides whether it may act at all (see
     decide): an administrator's choice is never overridden
  2. finds Ollama, and installs it ONLY when it is missing: from OllamaSetup.exe next to the batch file if there is one, else from the official HTTPS download,
     in both cases only if the file is signed by Ollama Inc.; silent, for this user, no administrator rights
  3. checks that the service answers on http://127.0.0.1:11434 and starts `ollama serve` (loopback only) when it does not
  4. checks the model list and downloads qwen3:8b ONLY when it is missing (never any other model)
  5. verifies the API, the model and its tool support, and only then
  6. turns the assistant on by recording a few chat keys in config.local.json (a backup of an existing one is kept; nothing else is rewritten)

config.json itself is never written: every Eko-DT update replaces it, so anything kept there would be lost by the next update. config.local.json is not in the
export, so an update leaves it alone. A folder set up by the earlier build, which wrote into config.json, has its AI settings copied into config.local.json
the first time this runs (legacy_ai_settings), if config.json still has them.

Every failure is a warning and exit code 1; the batch file then starts Eko-DT anyway, in rules-only mode. A second run finds everything in place and
downloads, installs and writes nothing. All traffic to Ollama is on 127.0.0.1 and goes direct (a proxy is never used for loopback); the installer download uses
the proxy settings this machine already has and nothing is done to get around one.

`--print-no-proxy` prints the NO_PROXY value that keeps loopback out of a configured proxy, for the batch file to set for the backend.
"""
from __future__ import annotations

import copy
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Callable, Optional

import config_overlay as co

HOST, PORT = "127.0.0.1", 11434
BASE_URL = f"http://{HOST}:{PORT}"
MODEL = "qwen3:8b"
MIN_FREE_BYTES = 8 * 1024 ** 3          # the model is about 5.2 GB; the rest is room for the download
INSTALLER_URL = "https://ollama.com/download/OllamaSetup.exe"
MIN_INSTALLER_BYTES = 10 * 1024 ** 2
SIGNER = "CN=Ollama Inc."
OFF = ("0", "false", "no", "off")
LOOPBACK = ("127.0.0.1", "localhost", "::1", "[::1]")
DEFAULT_URLS = ("http://localhost:11434", "http://localhost:11434/v1", "http://127.0.0.1:11434", "http://127.0.0.1:11434/v1")
PROXY_VARS = ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy")
LOCAL_BACKUP = co.LOCAL_NAME + ".pre-local-ai.bak"
# what the shipped config.json says about AI, and the keys this setup (or an operator) may have changed in it
SHIPPED_CHAT = {"enabled": False, "provider": "rules", "base_url": "http://localhost:11434/v1", "model": "qwen3:4b", "local_ai": "auto"}
AI_KEYS = ("local_ai", "local_ai_enabled_by_setup", "enabled", "provider", "base_url", "model")
STALL_S = 180                           # a model download that reports no progress for this long has failed


class SetupError(Exception):
    """A step failed in a way the user can be told about in one sentence."""


# ─── Who may change what ─────────────────────────────────────────────────────

def decide(cfg: Any, env: dict) -> dict:
    """{"skip": reason} when this step must not act, else the plan: provider, enabled, model and whether the model is ours to download.

    The batch file acts only for a configuration that opted in with chat.local_ai = "auto" (the exports write that). "off" is the administrator's way to keep the
    assistant out; chat turned off after this step turned it on (the marker) stays off; a provider, a connection or a model somebody chose is theirs."""
    chat = cfg.get("chat") if isinstance(cfg, dict) and isinstance(cfg.get("chat"), dict) else {}
    flag = str(env.get("LLM_ENABLED") or "").strip().lower()
    if flag in OFF:
        return {"skip": "LLM_ENABLED is off in the environment"}
    forced = str(env.get("LLM_PROVIDER") or "").strip().lower()
    if forced and forced != "ollama":
        return {"skip": f"LLM_PROVIDER is {forced} in the environment"}
    mode = chat.get("local_ai")
    if mode == "off":
        return {"skip": "chat.local_ai is off"}
    if mode != "auto":
        return {"skip": "chat.local_ai is not auto (this folder was not set up for local AI)"}
    provider = str(chat.get("provider") or "rules").strip().lower()
    if provider not in ("rules", "ollama"):
        return {"skip": f"chat.provider is {provider}"}
    base = str(chat.get("base_url") or "").strip().rstrip("/")
    if base and base.lower() not in tuple(u.rstrip("/") for u in DEFAULT_URLS):
        return {"skip": "chat.base_url is a connection that is not the default local Ollama"}
    enabled = chat.get("enabled") is True
    if not enabled and chat.get("local_ai_enabled_by_setup") is True:
        return {"skip": "chat was turned off after this setup turned it on"}
    model = str(chat.get("model") or "").strip()
    managed = provider == "rules" or not model or model == MODEL
    return {"skip": None, "provider": provider, "enabled": enabled, "model": MODEL if managed else model, "model_managed": managed}


def legacy_ai_settings(chat: Any) -> dict:
    """The AI settings in a shipped-style config.json's chat block that an earlier build or an operator put there, to be kept in config.local.json: only when the
    block shows it (the setup marker, local_ai off, or a provider other than rules), and only the AI keys that differ from what the release ships."""
    if not isinstance(chat, dict):
        return {}
    shows = chat.get("local_ai_enabled_by_setup") is True or chat.get("local_ai") == "off" or str(chat.get("provider") or "rules").strip().lower() != "rules"
    if not shows:
        return {}
    return {k: chat[k] for k in AI_KEYS if k in chat and (k == "local_ai_enabled_by_setup" or chat[k] != SHIPPED_CHAT.get(k))}


def merge(cfg: dict, plan: dict) -> tuple[dict, list]:
    """(new config, the chat keys changed): enabled / provider / base_url / model where they are not already what the plan needs. A custom value stays."""
    new = copy.deepcopy(cfg)
    chat = new.get("chat")
    if not isinstance(chat, dict):
        chat = new["chat"] = {}
    changes: list = []

    def put(key: str, value: Any) -> None:
        if chat.get(key) != value:
            chat[key] = value
            changes.append(key)
    if chat.get("enabled") is not True:
        put("enabled", True)
        put("local_ai_enabled_by_setup", True)
    if plan["provider"] == "rules":
        put("provider", "ollama")
        put("base_url", BASE_URL)
        put("model", plan["model"])
    else:
        if not chat.get("base_url"):
            put("base_url", BASE_URL)
        if not chat.get("model"):
            put("model", plan["model"])
    return new, changes


def merged_no_proxy(env: dict) -> str:
    """NO_PROXY with loopback added, but only when a proxy is configured (otherwise it is returned as it is)."""
    current = env.get("NO_PROXY") or env.get("no_proxy") or ""
    parts = [p.strip() for p in current.split(",") if p.strip()]
    if not any(env.get(k) for k in PROXY_VARS):
        return current
    for host in ("127.0.0.1", "localhost"):
        if host not in parts:
            parts.append(host)
    return ",".join(parts)


# ─── The official download chain ─────────────────────────────────────────────

def allowed_download_url(url: str) -> bool:
    """https, and a host of the official chain: ollama.com redirects to the GitHub release assets."""
    try:
        parts = urllib.parse.urlsplit(url)
    except ValueError:
        return False
    host = (parts.hostname or "").lower()
    return parts.scheme == "https" and (host in ("ollama.com", "github.com", "githubusercontent.com") or host.endswith(".githubusercontent.com"))


class CheckedRedirect(urllib.request.HTTPRedirectHandler):
    """Follows a redirect only to a host of the official chain."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not allowed_download_url(newurl):
            raise urllib.error.URLError(f"redirect to {urllib.parse.urlsplit(newurl).hostname or 'an unknown host'} refused")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


# ─── The step ────────────────────────────────────────────────────────────────

def log_path(env: dict) -> str:
    """EKO_LOCAL_AI_LOG_DIR, else %LOCALAPPDATA%\\EKO-DT\\logs (next to the notification database), else the temp folder."""
    base = env.get("LOCALAPPDATA")
    folder = env.get("EKO_LOCAL_AI_LOG_DIR") or (os.path.join(base, "EKO-DT", "logs") if base else os.path.join(tempfile.gettempdir(), "EKO-DT-logs"))
    return os.path.join(folder, "local-ai-setup.log")


class LocalAI:
    def __init__(self, backend_dir: str, *, env: Optional[dict] = None, base_url: str = BASE_URL, say: Optional[Callable[[str, str], None]] = None,
                 sleep: Callable[[float], None] = time.sleep, wait_s: float = 45.0, popen: Callable = subprocess.Popen, run: Callable = subprocess.run,
                 which: Callable = shutil.which, exists: Callable = os.path.exists, os_name: str = os.name):
        parts = urllib.parse.urlsplit(base_url)
        if parts.scheme != "http" or (parts.hostname or "") not in ("127.0.0.1",):
            raise ValueError("The local AI step only talks to Ollama on http://127.0.0.1")
        self.base = base_url.rstrip("/")
        self.backend_dir = os.path.abspath(backend_dir)
        self.root = os.path.dirname(self.backend_dir)
        self.config_path = os.path.join(self.backend_dir, "config.json")
        self.local_path = os.path.join(self.backend_dir, co.LOCAL_NAME)
        self.env = dict(os.environ if env is None else env)
        self.sleep, self.wait_s, self.popen, self.run_cmd, self.which, self.exists, self.os_name = sleep, wait_s, popen, run, which, exists, os_name
        self.say_fn = say
        self.local_opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))      # loopback goes direct, whatever proxy the machine uses
        self._log = log_path(self.env)

    # ── output ──
    def say(self, level: str, text: str) -> None:
        if self.say_fn is not None:
            self.say_fn(level, text)
            return
        print(f"[Local AI] {'WARNING: ' if level == 'WARNING' else ''}{text}", flush=True)
        try:
            os.makedirs(os.path.dirname(self._log), exist_ok=True)
            with open(self._log, "a", encoding="utf-8") as f:
                f.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')} {level} {text}\n")
        except OSError:
            pass                    # a log that cannot be written never stops the step

    def info(self, text: str) -> None:
        self.say("INFO", text)

    def fail(self, text: str) -> int:
        self.say("WARNING", f"{text} Eko-DT will start in rules-only mode; run Start_Viewer_Windows.bat again to retry.")
        return 1

    # ── the service on loopback ──
    def call(self, method: str, path: str, body: Optional[dict] = None, timeout: float = 10.0) -> Any:
        data = json.dumps(body).encode("utf-8") if body is not None else None
        req = urllib.request.Request(self.base + path, data=data, method=method, headers={"Content-Type": "application/json"})
        try:
            with self.local_opener.open(req, timeout=timeout) as resp:
                raw = resp.read()
        except urllib.error.HTTPError as exc:
            raise SetupError(f"Ollama answered HTTP {exc.code} for {path}") from None
        except (urllib.error.URLError, OSError, ValueError) as exc:
            raise SetupError(f"Ollama is not reachable on {self.base}") from None
        try:
            return json.loads(raw or b"{}")
        except ValueError:
            raise SetupError(f"{self.base} answered something that is not Ollama") from None

    def running(self) -> bool:
        try:
            return isinstance(self.call("GET", "/api/version", timeout=3), dict)
        except SetupError:
            return False

    def wait_running(self) -> bool:
        deadline = time.monotonic() + self.wait_s
        while time.monotonic() < deadline:
            if self.running():
                return True
            self.sleep(1.0)
        return self.running()

    def model_names(self) -> list:
        got = self.call("GET", "/api/tags")
        return [str(m.get("name") or m.get("model") or "") for m in (got.get("models") or []) if isinstance(m, dict)]

    @staticmethod
    def has_model(names: list, wanted: str) -> bool:
        return wanted in names or (":" not in wanted and f"{wanted}:latest" in names)

    # ── the program ──
    def find_ollama(self) -> Optional[str]:
        found = self.which("ollama")
        if found:
            return found
        for var, parts in (("LOCALAPPDATA", ("Programs", "Ollama", "ollama.exe")), ("ProgramFiles", ("Ollama", "ollama.exe"))):
            base = self.env.get(var)
            if base:
                path = os.path.join(base, *parts)
                if self.exists(path):
                    return path
        return None

    def start(self, exe: str) -> bool:
        """`ollama serve`, detached, on loopback only; it inherits this machine's proxy settings for the model download."""
        env = dict(self.env)
        env["OLLAMA_HOST"] = f"{HOST}:{PORT}"
        flags = 0
        if self.os_name == "nt":
            flags = getattr(subprocess, "DETACHED_PROCESS", 0x8) | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0x200) | getattr(subprocess, "CREATE_NO_WINDOW", 0x08000000)
        try:
            out = open(os.path.join(os.path.dirname(self._log), "ollama-serve.log"), "ab") if os.path.isdir(os.path.dirname(self._log)) else subprocess.DEVNULL
            self.popen([exe, "serve"], env=env, stdout=out, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL, creationflags=flags, close_fds=True)
        except OSError as exc:
            self.say("WARNING", f"Ollama could not be started ({type(exc).__name__}).")
            return False
        return self.wait_running()

    # ── installing Ollama ──
    def install(self) -> bool:
        """Only called when Ollama is missing. True when it was installed."""
        if self.os_name != "nt":
            self.say("WARNING", "Ollama can only be installed automatically on Windows.")
            return False
        staged = os.path.join(self.root, "OllamaSetup.exe")
        try:
            if self.exists(staged):
                self.info("Using OllamaSetup.exe from this folder.")
                return self.install_from(staged)
            downloaded = self.download_installer()
        except SetupError as exc:
            self.say("WARNING", str(exc))
            return False
        try:
            return self.install_from(downloaded)
        finally:
            try:
                os.remove(downloaded)
            except OSError:
                pass

    def download_installer(self) -> str:
        self.info("Downloading the Ollama installer from ollama.com ...")
        opener = urllib.request.build_opener(CheckedRedirect)         # the machine's own proxy settings; nothing is done to get around them
        req = urllib.request.Request(INSTALLER_URL, headers={"User-Agent": "EKO-DT-local-ai-setup"})
        fd, path = tempfile.mkstemp(suffix=".exe", prefix="OllamaSetup-")
        os.close(fd)
        try:
            with opener.open(req, timeout=60) as resp:
                if not allowed_download_url(resp.geturl()):
                    raise SetupError("The download was redirected away from the official Ollama host, so it was refused.")
                total = int(resp.headers.get("Content-Length") or 0)
                done, shown = 0, -1
                with open(path, "wb") as f:
                    while True:
                        chunk = resp.read(1024 * 1024)
                        if not chunk:
                            break
                        f.write(chunk)
                        done += len(chunk)
                        if total and done * 10 // total != shown:
                            shown = done * 10 // total
                            self.info(f"Ollama installer: {done * 100 // total}%")
            if done < MIN_INSTALLER_BYTES or (total and done < total):
                raise SetupError("The Ollama installer download was incomplete.")
            return path
        except SetupError:
            self._discard(path)
            raise
        except urllib.error.HTTPError as exc:
            self._discard(path)
            hint = " A proxy that needs a login has to be set up for this account." if exc.code == 407 else ""
            raise SetupError(f"The Ollama installer could not be downloaded (HTTP {exc.code}).{hint}") from None
        except (urllib.error.URLError, OSError, ValueError) as exc:
            self._discard(path)
            raise SetupError("The Ollama installer could not be downloaded. Check the internet connection and the proxy settings, "
                             "or put OllamaSetup.exe next to Start_Viewer_Windows.bat.") from None

    @staticmethod
    def _discard(path: str) -> None:
        try:
            os.remove(path)
        except OSError:
            pass

    def signature(self, path: str) -> tuple[str, str]:
        script = '$s = Get-AuthenticodeSignature -LiteralPath $env:EKO_SIGNED_FILE; "$($s.Status)|$($s.SignerCertificate.Subject)"'
        try:
            done = self.run_cmd(["powershell", "-NoProfile", "-NonInteractive", "-Command", script], env=dict(self.env, EKO_SIGNED_FILE=path),
                                capture_output=True, text=True, timeout=90)
            status, _, subject = (done.stdout or "").strip().partition("|")
            return status, subject
        except (OSError, subprocess.SubprocessError):
            return "", ""

    def install_from(self, path: str) -> bool:
        status, subject = self.signature(path)
        if status != "Valid" or SIGNER not in subject:
            self.say("WARNING", "The Ollama installer is not signed by Ollama Inc., so it was not run.")
            return False
        self.info("Installing Ollama for this user (this can take a few minutes) ...")
        return self.run_installer(path)

    def run_installer(self, path: str) -> bool:
        try:
            done = self.run_cmd([path, "/VERYSILENT", "/NORESTART", "/SUPPRESSMSGBOXES"], timeout=1800)
        except (OSError, subprocess.SubprocessError):
            self.say("WARNING", "The Ollama installer could not be run.")
            return False
        if done.returncode != 0:
            self.say("WARNING", f"The Ollama installer stopped with code {done.returncode}.")
            return False
        return True

    # ── the model ──
    def models_dir(self) -> str:
        return self.env.get("OLLAMA_MODELS") or os.path.join(os.path.expanduser("~"), ".ollama", "models")

    def disk_free(self) -> int:
        path = os.path.abspath(self.models_dir())
        while path and not os.path.exists(path):
            parent = os.path.dirname(path)
            if parent == path:
                break
            path = parent
        return shutil.disk_usage(path).free

    def pull(self, model: str) -> None:
        """Downloads `model` through the local service (which uses the proxy settings it was started with) and shows the progress."""
        self.info(f"Downloading {model} (about 5 GB; this can take a long time) ...")
        req = urllib.request.Request(self.base + "/api/pull", data=json.dumps({"model": model, "stream": True}).encode(), method="POST",
                                     headers={"Content-Type": "application/json"})
        shown, ok = -1, False
        try:
            with self.local_opener.open(req, timeout=STALL_S) as resp:
                for line in resp:
                    try:
                        item = json.loads(line)
                    except ValueError:
                        continue
                    if item.get("error"):
                        raise SetupError(f"The model download failed: {item['error']}.")
                    if item.get("total"):
                        pct = int(item.get("completed", 0) * 100 / item["total"])
                        if pct // 10 != shown:
                            shown = pct // 10
                            self.info(f"{model}: {pct}%")
                    if item.get("status") == "success":
                        ok = True
        except SetupError:
            raise
        except (urllib.error.URLError, OSError, ValueError):
            raise SetupError("The model download stopped (no progress). Check the connection and the proxy settings of the Ollama service.") from None
        if not ok:
            raise SetupError("The model download did not finish.")

    def verify(self, model: str) -> None:
        """The API answers, the model is there and it can use tools (the planner needs them)."""
        self.call("GET", "/api/version", timeout=5)
        if not self.has_model(self.model_names(), model):
            raise SetupError(f"The model {model} is not available in Ollama.")
        got = self.call("POST", "/api/show", {"model": model}, timeout=30)
        caps = got.get("capabilities") if isinstance(got, dict) else None
        if isinstance(caps, list) and "tools" not in caps:
            raise SetupError(f"The model {model} does not support tools, which Eko-DT needs.")

    def warm_up(self, model: str) -> None:
        """Loads the model once after a download, so the first question does not pay for it. Only a hint: a failure is not one."""
        self.info("Loading the model once so the first question is fast ...")
        try:
            self.call("POST", "/api/chat", {"model": model, "messages": [{"role": "user", "content": "ok"}], "stream": False, "think": False,
                                            "keep_alive": "10m", "options": {"num_predict": 1}}, timeout=300)
        except SetupError:
            self.info("The model did not answer the warm-up yet; the first question may be slow.")

    # ── the configuration ──
    def read_config(self) -> Optional[dict]:
        try:
            with open(self.config_path, encoding="utf-8-sig") as f:
                cfg = json.load(f)
        except (OSError, ValueError):
            cfg = None
        if not isinstance(cfg, dict):
            self.say("WARNING", "config.json could not be read, so the local AI setup was not done and the file was not touched. Eko-DT will start in rules-only mode.")
            return None
        return cfg

    def write_local(self, local: dict, patch: dict) -> None:
        """config.local.json with `patch` laid over what it holds (every other key stays); a file that was there is copied aside once first; atomic."""
        new = co.deep_merge(local, patch)
        backup = os.path.join(self.backend_dir, LOCAL_BACKUP)
        if os.path.exists(self.local_path) and not os.path.exists(backup):
            shutil.copy2(self.local_path, backup)
        fd, tmp = tempfile.mkstemp(prefix=co.LOCAL_NAME + ".", suffix=".tmp", dir=self.backend_dir)
        try:
            with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as f:
                json.dump(new, f, indent=2, ensure_ascii=False)
                f.write("\n")
            os.replace(tmp, self.local_path)
        except BaseException:
            self._discard(tmp)
            raise

    def check_exposure(self) -> None:
        value = str(self.env.get("OLLAMA_HOST") or "").strip().lower()
        if not value:
            return
        value = value.split("://", 1)[-1]
        host = "" if value.startswith(":") else (value.rsplit(":", 1)[0] if ":" in value else ("" if value.isdigit() else value))
        if host not in LOOPBACK and not (host == "" and value.isdigit()):
            self.say("WARNING", f"OLLAMA_HOST is {self.env.get('OLLAMA_HOST')}: Ollama may be reachable from the network. Eko-DT only uses {self.base}; "
                                "set OLLAMA_HOST to 127.0.0.1 if that is not intended.")

    # ── the whole step ──
    def run(self) -> int:
        base = self.read_config()
        if base is None:
            return 1
        local, exists, problem = co.read_local(self.local_path)
        if problem:
            self.say("WARNING", f"{problem}, so the local AI setup was not done and the file was not touched. Eko-DT will start in rules-only mode.")
            return 1
        if not exists:
            kept = legacy_ai_settings(base.get("chat"))
            if kept:                                      # set up by the build that wrote into config.json: keep it where an update cannot remove it
                self.write_local({}, {"chat": kept})
                local = {"chat": kept}
                self.info(f"The AI settings found in config.json were kept in {co.LOCAL_NAME}, which an update of Eko-DT does not replace.")
        cfg = co.deep_merge(base, local)
        plan = decide(cfg, self.env)
        if plan["skip"]:
            self.info(f"Local AI setup skipped: {plan['skip']}.")
            return 0
        model = plan["model"]
        try:
            self.info(f"Checking Ollama and the {model} model ...")
            self.check_exposure()
            exe = self.find_ollama()
            if not self.running():
                if exe is None:
                    self.info("Ollama is not installed.")
                    if not self.install():
                        return self.fail("Ollama could not be installed.")
                    exe = self.find_ollama()
                    self.wait_running()                       # the installer starts the service
                if not self.running():
                    if exe is None:
                        return self.fail("Ollama was installed but its program could not be found.")
                    self.info("Starting the Ollama service ...")
                    if not self.start(exe) or not self.running():
                        return self.fail(f"The Ollama service did not start on {self.base}.")
            else:
                self.info("Ollama is installed and running.")
            pulled = False
            if not self.has_model(self.model_names(), model):
                if not plan["model_managed"] or model != MODEL:
                    return self.fail(f"The model {model} is not installed in Ollama, and only {MODEL} is downloaded automatically.")
                if self.disk_free() < MIN_FREE_BYTES:
                    return self.fail(f"There is not enough free disk space for {MODEL} (about 8 GB are needed).")
                self.pull(model)
                pulled = True
            else:
                self.info(f"The model {model} is already installed.")
            self.verify(model)
            if pulled:
                self.warm_up(model)
            new, changes = merge(cfg, plan)
            if changes:
                self.write_local(local, {"chat": {k: new["chat"][k] for k in changes}})
                self.info(f"Eko-DT is set to use the local assistant ({', '.join(changes)} saved in {co.LOCAL_NAME}, which an update of Eko-DT does not replace).")
            self.info(f"Local AI is ready: Ollama at {BASE_URL} with {model}.")
            return 0
        except SetupError as exc:
            return self.fail(str(exc))
        except Exception as exc:                              # never a traceback in front of the user, and never a reason not to start
            return self.fail(f"The local AI setup stopped unexpectedly ({type(exc).__name__}).")


def main(argv: list) -> int:
    if "--print-no-proxy" in argv:
        print(merged_no_proxy(dict(os.environ)))
        return 0
    try:
        return LocalAI(os.path.dirname(os.path.abspath(__file__))).run()
    except KeyboardInterrupt:
        print("[Local AI] WARNING: interrupted. Eko-DT will start in rules-only mode.", flush=True)
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
