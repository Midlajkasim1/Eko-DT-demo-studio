"""The local AI step of Start_Viewer_Windows.bat: backend/local_ai_setup.py.

Run from backend/:   python -m unittest tests.test_local_ai_setup
The helper detects Ollama, installs it only when it is missing, makes sure the service is running, downloads qwen3:8b only when it is missing, checks the
API and the model, and only then turns the assistant on in config.json (a key-level merge that never overrides an administrator's setting). Every failure is
a warning and exit code 1: the batch file then starts Eko-DT in rules-only mode.

Nothing here touches the real Ollama, the network or the real config: a fake Ollama server answers on a free loopback port (it records every request), the
installer, the service start and the signature check are replaced, and the config is a throwaway file.
"""
import io
import json
import os
import sys
import tempfile
import threading
import unittest
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

import config_overlay as co  # noqa: E402
import local_ai_setup as las  # noqa: E402

MODEL = "qwen3:8b"
GIB = 1024 ** 3


class FakeOllama:
    """A loopback server that answers like Ollama (version, tags, show, pull, chat) and records every request. `up` switches it on and off."""

    def __init__(self):
        self.models = []
        self.requests = []
        self.tools = True
        self.pull_error = None
        self.pull_stalls = False
        self.httpd = None

    def start(self):
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def _send(self, code, obj, raw=None):
                body = raw if raw is not None else json.dumps(obj).encode()
                self.send_response(code)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def _body(self):
                n = int(self.headers.get("Content-Length") or 0)
                return json.loads(self.rfile.read(n) or b"{}")

            def do_GET(self):
                outer.requests.append(("GET", self.path, None))
                if self.path == "/api/version":
                    self._send(200, {"version": "0.40.14"})
                elif self.path == "/api/tags":
                    self._send(200, {"models": [{"name": m, "model": m} for m in outer.models]})
                else:
                    self._send(404, {})

            def do_POST(self):
                body = self._body()
                outer.requests.append(("POST", self.path, body))
                if self.path == "/api/show":
                    if body.get("model") in outer.models:
                        self._send(200, {"capabilities": ["completion"] + (["tools"] if outer.tools else [])})
                    else:
                        self._send(404, {"error": "model not found"})
                elif self.path == "/api/pull":
                    lines = [{"status": "pulling manifest"}, {"status": "pulling abc", "total": 100, "completed": 40}, {"status": "pulling abc", "total": 100, "completed": 100}]
                    if outer.pull_error:
                        lines = [{"status": "pulling manifest"}, {"error": outer.pull_error}]
                    elif not outer.pull_stalls:
                        lines.append({"status": "success"})
                        outer.models.append(body["model"])
                    raw = b"".join(json.dumps(x).encode() + b"\n" for x in lines)
                    self._send(200, None, raw)
                elif self.path == "/api/chat":
                    self._send(200, {"message": {"role": "assistant", "content": "ok"}})
                else:
                    self._send(404, {})

        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.port = self.httpd.server_address[1]
        self.thread = threading.Thread(target=lambda: self.httpd.serve_forever(poll_interval=0.02), daemon=True)
        self.thread.start()

    def stop(self):
        if self.httpd:
            self.httpd.shutdown()
            self.httpd.server_close()
            self.httpd = None

    @property
    def base(self):
        return f"http://127.0.0.1:{self.port}"

    def paths(self, method=None):
        return [(m, p) for m, p, _ in self.requests if method in (None, m)]


CONFIG = {
    "project_name": "marsaAlArab",
    "fin_server_url": "https://localhost",
    "chat": {"enabled": False, "fast_router": True, "max_concurrent_llm": 2, "provider": "rules", "base_url": "http://localhost:11434/v1", "model": "qwen3:4b",
             "api_key_env": "EKO_CHAT_API_KEY", "timeout_s": 60, "allowed_projects": ["marsaAlArab", "ekoHospital"], "local_ai": "auto"},
    "polling": {"live_ms": 5000},
}


class Base(unittest.TestCase):
    """A throwaway backend folder with a config.json, and a LocalAI wired to the fake server with every outside action replaced."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = self.tmp.name
        self.backend = os.path.join(self.root, "backend")
        os.makedirs(self.backend)
        self.fake = FakeOllama()
        self.fake.start()
        self.addCleanup(self.fake.stop)
        self.said = []
        self.calls = []
        self.write_config(CONFIG)

    def write_config(self, cfg):
        with open(os.path.join(self.backend, "config.json"), "w", encoding="utf-8") as f:
            json.dump(cfg, f, indent=2)

    def write_local(self, cfg):
        with open(os.path.join(self.backend, "config.local.json"), "w", encoding="utf-8") as f:
            json.dump(cfg, f, indent=2)

    def config(self):
        """The configuration the backend would use: config.json with config.local.json laid over it."""
        with open(os.path.join(self.backend, "config.json"), encoding="utf-8") as f:
            return co.apply_local(json.load(f), os.path.join(self.backend, "config.local.json"))[0]

    def config_bytes(self):
        """(config.json, config.local.json or None) as bytes: equal before and after means nothing was written to either."""
        out = []
        for name in ("config.json", "config.local.json"):
            path = os.path.join(self.backend, name)
            if os.path.exists(path):
                with open(path, "rb") as f:
                    out.append(f.read())
            else:
                out.append(None)
        return tuple(out)

    def make(self, env=None, installed=True, running=True):
        """installed: an ollama.exe exists; running: the fake server counts as the running service. Install / start / disk are recorded, never real."""
        ai = las.LocalAI(self.backend, env=env or {}, base_url=self.fake.base, say=lambda level, text: self.said.append((level, text)), sleep=lambda s: None,
                         wait_s=0.2)
        self.exe = {"path": r"C:\fake\ollama.exe" if installed else None}
        self.running_flag = {"up": running}
        self.free = 50 * GIB
        self.install_ok = True
        self.start_ok = True
        real_running = ai.running
        ai.find_ollama = lambda: self.exe["path"]
        ai.disk_free = lambda: self.free
        ai.install = self._install
        ai.start = self._start
        ai.running = lambda: self.running_flag["up"] and real_running()
        return ai

    def _install(self):
        self.calls.append("install")
        if self.install_ok:
            self.exe["path"] = r"C:\fake\ollama.exe"
            self.running_flag["up"] = True       # the installer starts the app
        return self.install_ok

    def _start(self, exe):
        self.calls.append("start")
        if self.start_ok:
            self.running_flag["up"] = True
        return self.start_ok

    def text(self):
        return "\n".join(t for _, t in self.said)

    def warnings(self):
        return [t for lvl, t in self.said if lvl == "WARNING"]


class PolicyTests(unittest.TestCase):
    """decide(): who may change what. An administrator's choice is never overridden."""

    def d(self, chat=None, env=None, **top):
        cfg = dict(top)
        if chat is not None:
            cfg["chat"] = chat
        return las.decide(cfg, env or {})

    def test_the_exports_default_is_to_set_up(self):
        got = self.d(CONFIG["chat"])
        self.assertIsNone(got["skip"])
        self.assertEqual((got["provider"], got["model"], got["model_managed"]), ("rules", MODEL, True))

    def test_off_and_not_opted_in_do_nothing(self):
        for chat in (dict(CONFIG["chat"], local_ai="off"), {k: v for k, v in CONFIG["chat"].items() if k != "local_ai"}, dict(CONFIG["chat"], local_ai="on"),
                     dict(CONFIG["chat"], local_ai=True)):
            self.assertIsNotNone(self.d(chat)["skip"], chat)
        self.assertIsNotNone(las.decide({}, {})["skip"])
        self.assertIsNotNone(las.decide(None, {})["skip"])

    def test_chat_the_administrator_switched_off_after_setup_stays_off(self):
        chat = dict(CONFIG["chat"], enabled=False, local_ai_enabled_by_setup=True)
        self.assertIn("turned off", self.d(chat)["skip"])
        self.assertIsNone(self.d(dict(chat, enabled=True))["skip"])

    def test_the_environment_kill_switch_and_another_provider_are_respected(self):
        for env in ({"LLM_ENABLED": "false"}, {"LLM_ENABLED": "0"}, {"LLM_PROVIDER": "rules"}, {"LLM_PROVIDER": "openai_compatible"}):
            self.assertIsNotNone(self.d(CONFIG["chat"], env)["skip"], env)
        self.assertIsNone(self.d(CONFIG["chat"], {"LLM_PROVIDER": "ollama", "LLM_ENABLED": "true"})["skip"])
        self.assertIsNotNone(self.d(dict(CONFIG["chat"], provider="openai_compatible"))["skip"])

    def test_a_connection_that_is_not_the_default_local_one_is_not_ours_to_manage(self):
        for url in ("http://10.1.2.3:11434", "http://ollama.internal:11434", "http://127.0.0.1:11500", "https://localhost:11434"):
            self.assertIn("connection", self.d(dict(CONFIG["chat"], base_url=url))["skip"], url)
        for url in ("http://localhost:11434/v1", "http://127.0.0.1:11434", "http://localhost:11434/", "", None):
            self.assertIsNone(self.d(dict(CONFIG["chat"], base_url=url))["skip"], url)

    def test_a_model_the_administrator_chose_is_kept(self):
        got = self.d(dict(CONFIG["chat"], provider="ollama", model="llama3.1:8b"))
        self.assertEqual((got["model"], got["model_managed"]), ("llama3.1:8b", False))
        got = self.d(dict(CONFIG["chat"], provider="ollama", model=""))
        self.assertEqual((got["model"], got["model_managed"]), (MODEL, True))
        got = self.d(dict(CONFIG["chat"], provider="ollama", model=MODEL))
        self.assertEqual(got["model_managed"], True)


class MergeTests(unittest.TestCase):
    def test_the_assistant_is_turned_on_with_the_local_connection_and_nothing_else_changes(self):
        new, changes = las.merge(CONFIG, las.decide(CONFIG, {}))
        chat = new["chat"]
        self.assertEqual((chat["enabled"], chat["provider"], chat["base_url"], chat["model"]), (True, "ollama", "http://127.0.0.1:11434", MODEL))
        self.assertIs(chat["local_ai_enabled_by_setup"], True)
        for key in ("fast_router", "max_concurrent_llm", "api_key_env", "timeout_s", "allowed_projects", "local_ai"):
            self.assertEqual(chat[key], CONFIG["chat"][key], key)
        self.assertEqual({k: v for k, v in new.items() if k != "chat"}, {k: v for k, v in CONFIG.items() if k != "chat"})
        self.assertEqual(sorted(changes), ["base_url", "enabled", "local_ai_enabled_by_setup", "model", "provider"])
        self.assertEqual(CONFIG["chat"]["enabled"], False)                          # the input is not modified

    def test_a_configuration_already_in_place_is_not_changed(self):
        done = las.merge(CONFIG, las.decide(CONFIG, {}))[0]
        again, changes = las.merge(done, las.decide(done, {}))
        self.assertEqual((again, changes), (done, []))

    def test_custom_values_survive(self):
        cfg = {"chat": dict(CONFIG["chat"], enabled=True, provider="ollama", base_url="http://127.0.0.1:11434", model="llama3.1:8b", timeout_s=120, api_key_env="MY_KEY")}
        new, changes = las.merge(cfg, las.decide(cfg, {}))
        self.assertEqual((new, changes), (cfg, []))

    def test_an_enabled_rules_chat_gets_the_model_but_keeps_being_enabled_by_its_owner(self):
        cfg = {"chat": dict(CONFIG["chat"], enabled=True)}
        new, changes = las.merge(cfg, las.decide(cfg, {}))
        self.assertNotIn("local_ai_enabled_by_setup", new["chat"])                  # the administrator enabled it, not the setup
        self.assertEqual(new["chat"]["provider"], "ollama")

    def test_a_missing_chat_block_is_built_with_the_safe_defaults(self):
        cfg = {"project_name": "x", "chat": {"local_ai": "auto"}}
        new, _ = las.merge(cfg, las.decide(cfg, {}))
        self.assertEqual((new["chat"]["enabled"], new["chat"]["provider"], new["chat"]["model"]), (True, "ollama", MODEL))
        self.assertEqual(new["project_name"], "x")


class FreshInstallTests(Base):
    def test_a_machine_without_ollama_gets_it_the_service_the_model_and_the_configuration(self):
        ai = self.make(installed=False, running=False)
        self.assertEqual(ai.run(), 0, self.text())
        self.assertEqual(self.calls, ["install"])                                   # the installer started the service: nothing else to start
        self.assertEqual([p for m, p, b in self.fake.requests if p == "/api/pull"], ["/api/pull"])
        self.assertEqual([b["model"] for m, p, b in self.fake.requests if p == "/api/pull"], [MODEL])
        self.assertIn(MODEL, self.fake.models)
        chat = self.config()["chat"]
        self.assertEqual((chat["enabled"], chat["provider"], chat["base_url"], chat["model"]), (True, "ollama", "http://127.0.0.1:11434", MODEL))
        self.assertIn("ready", self.text().lower())

    def test_the_steps_run_in_the_documented_order(self):
        ai = self.make(installed=False, running=False)
        ai.run()
        self.assertEqual(self.calls[0], "install")                                  # before any request to the service
        paths = [p for _, p, _ in self.fake.requests]
        self.assertLess(paths.index("/api/tags"), paths.index("/api/pull"))         # the model is looked for before it is downloaded
        self.assertLess(paths.index("/api/pull"), paths.index("/api/show"))         # and checked after
        self.assertEqual(self.config()["chat"]["provider"], "ollama")             # the configuration comes last

    def test_the_warm_up_runs_once_after_a_download(self):
        self.make(installed=False, running=False).run()
        chat_calls = [b for m, p, b in self.fake.requests if p == "/api/chat"]
        self.assertEqual(len(chat_calls), 1)
        self.assertEqual((chat_calls[0]["model"], chat_calls[0]["stream"], chat_calls[0]["options"]["num_predict"]), (MODEL, False, 1))


class ExistingOllamaTests(Base):
    def test_ollama_that_is_installed_and_running_is_not_installed_or_started_again(self):
        self.fake.models = [MODEL]
        self.assertEqual(self.make().run(), 0, self.text())
        self.assertEqual(self.calls, [])
        self.assertEqual([p for m, p in self.fake.paths("POST") if p == "/api/pull"], [])
        self.assertEqual(self.config()["chat"]["provider"], "ollama")

    def test_ollama_installed_but_not_running_is_started_not_reinstalled(self):
        self.fake.models = [MODEL]
        self.assertEqual(self.make(installed=True, running=False).run(), 0, self.text())
        self.assertEqual(self.calls, ["start"])

    def test_a_running_service_whose_program_is_not_found_is_not_installed_over(self):
        self.fake.models = [MODEL]
        self.assertEqual(self.make(installed=False, running=True).run(), 0, self.text())
        self.assertEqual(self.calls, [])


class ModelTests(Base):
    def test_a_model_that_is_present_is_not_downloaded(self):
        self.fake.models = [MODEL, "other:1b"]
        self.make().run()
        self.assertNotIn("/api/pull", [p for _, p in self.fake.paths()])
        self.assertNotIn("/api/chat", [p for _, p in self.fake.paths()])           # and no warm-up either

    def test_a_missing_model_is_downloaded_once_with_its_exact_name(self):
        self.fake.models = ["qwen3.5:4b"]
        self.assertEqual(self.make().run(), 0, self.text())
        pulls = [b for m, p, b in self.fake.requests if p == "/api/pull"]
        self.assertEqual([x["model"] for x in pulls], [MODEL])
        self.assertTrue(pulls[0]["stream"])
        self.assertIn("40%", self.text())                                           # progress is shown

    def test_a_model_the_administrator_chose_is_never_downloaded_and_its_absence_is_a_warning(self):
        self.write_config({"chat": dict(CONFIG["chat"], provider="ollama", enabled=True, model="llama3.1:8b")})
        before = self.config_bytes()
        self.assertEqual(self.make().run(), 1)
        self.assertNotIn("/api/pull", [p for _, p in self.fake.paths()])
        self.assertTrue(any("llama3.1:8b" in w for w in self.warnings()), self.warnings())
        self.assertEqual(self.config_bytes()[0], before[0])                         # (config.json is never written; the choice was copied to config.local.json)

    def test_a_download_that_fails_is_a_warning_and_leaves_rules_only(self):
        self.fake.pull_error = "pull model manifest: connection refused"
        before = self.config_bytes()
        self.assertEqual(self.make().run(), 1)
        self.assertEqual(self.config_bytes(), before)
        self.assertTrue(any("rules-only" in w for w in self.warnings()), self.warnings())
        self.assertTrue(any("connection refused" in w for w in self.warnings()))

    def test_a_download_that_never_finishes_is_a_failure_not_a_success(self):
        self.fake.pull_stalls = True
        before = self.config_bytes()
        self.assertEqual(self.make().run(), 1)
        self.assertEqual(self.config_bytes(), before)

    def test_too_little_disk_space_is_said_before_five_gigabytes_are_asked_for(self):
        ai = self.make()
        self.free = 3 * GIB
        self.assertEqual(ai.run(), 1)
        self.assertNotIn("/api/pull", [p for _, p in self.fake.paths()])
        self.assertTrue(any("disk" in w.lower() for w in self.warnings()), self.warnings())

    def test_a_model_without_tool_support_is_not_turned_on(self):
        self.fake.models = [MODEL]
        self.fake.tools = False
        before = self.config_bytes()
        self.assertEqual(self.make().run(), 1)
        self.assertEqual(self.config_bytes(), before)
        self.assertTrue(any("tool" in w.lower() for w in self.warnings()))


class FailureTests(Base):
    def test_an_ollama_that_cannot_be_installed_is_a_warning_and_rules_only(self):
        ai = self.make(installed=False, running=False)
        self.install_ok = False
        before = self.config_bytes()
        self.assertEqual(ai.run(), 1)
        self.assertEqual(self.calls, ["install"])
        self.assertEqual(self.config_bytes(), before)
        self.assertNotIn("/api/pull", [p for _, p in self.fake.paths()])           # nothing was pulled or configured
        self.assertTrue(any("rules-only" in w and "Ollama" in w for w in self.warnings()), self.warnings())

    def test_a_service_that_will_not_start_is_a_warning(self):
        ai = self.make(installed=True, running=False)
        self.start_ok = False
        before = self.config_bytes()
        self.assertEqual(ai.run(), 1)
        self.assertEqual(self.calls, ["start"])
        self.assertEqual(self.config_bytes(), before)

    def test_ollama_unavailable_after_a_successful_start_is_a_warning(self):
        ai = self.make(installed=True, running=False)
        ai.start = lambda exe: (self.calls.append("start"), True)[1]            # claims to have started; the server never answers
        ai.running = lambda: False
        self.assertEqual(ai.run(), 1)

    def test_a_port_held_by_something_else_is_named(self):
        import socket
        listener = socket.socket()
        listener.bind(("127.0.0.1", 0))
        listener.listen(5)
        self.addCleanup(listener.close)

        def accept_and_hang_up():
            try:
                while True:
                    listener.accept()[0].close()
            except OSError:
                pass
        threading.Thread(target=accept_and_hang_up, daemon=True).start()
        before = self.config_bytes()
        ai = las.LocalAI(self.backend, env={}, base_url=f"http://127.0.0.1:{listener.getsockname()[1]}", say=lambda l, x: self.said.append((l, x)),
                         sleep=lambda s: None, wait_s=0.2)
        ai.find_ollama = lambda: r"C:\fake\ollama.exe"
        ai.start = lambda exe: False
        self.assertEqual(ai.run(), 1)                                               # something answers on the port, but it is not Ollama
        self.assertEqual(self.config_bytes(), before)

    def test_an_unreadable_configuration_is_left_alone(self):
        with open(os.path.join(self.backend, "config.json"), "w", encoding="utf-8") as f:
            f.write("{ not json")
        self.assertEqual(self.make().run(), 1)
        self.assertEqual(self.fake.requests, [])                                    # nothing was installed or downloaded for a config that cannot be read
        self.assertTrue(any("config.json" in w for w in self.warnings()))

    def test_an_unexpected_error_is_a_warning_not_a_traceback(self):
        ai = self.make()
        ai.model_names = mock.Mock(side_effect=RuntimeError("boom"))
        self.assertEqual(ai.run(), 1)
        self.assertTrue(any("RuntimeError" in w for w in self.warnings()), self.warnings())


class SecondRunTests(Base):
    def test_a_second_run_downloads_installs_and_writes_nothing(self):
        self.make(installed=False, running=False).run()
        first = self.config_bytes()
        self.fake.requests.clear()
        self.calls.clear()
        again = self.make(installed=True, running=True)
        self.assertEqual(again.run(), 0, self.text())
        self.assertEqual(self.calls, [])
        self.assertEqual({m for m, _ in self.fake.paths()} - {"GET", "POST"}, set())
        self.assertNotIn("/api/pull", [p for _, p in self.fake.paths()])
        self.assertNotIn("/api/chat", [p for _, p in self.fake.paths()])
        self.assertEqual(self.config_bytes(), first)


class ExistingConfigurationTests(Base):
    def test_other_settings_and_credentials_settings_survive_byte_for_byte_as_values(self):
        custom = dict(CONFIG, fin_server_url="https://10.207.200.85", custom_key={"nested": [1, 2, {"a": "ب"}]})
        custom["chat"] = dict(CONFIG["chat"], api_key_env="CORP_LLM_KEY", timeout_s=90, allowed_projects=["ekoHospital"])
        self.write_config(custom)
        self.fake.models = [MODEL]
        self.make().run()
        got = self.config()
        self.assertEqual(got["custom_key"], custom["custom_key"])
        self.assertEqual(got["fin_server_url"], "https://10.207.200.85")
        for key in ("api_key_env", "timeout_s", "allowed_projects"):
            self.assertEqual(got["chat"][key], custom["chat"][key], key)
        self.assertNotIn("api_key", got["chat"])
        with open(os.path.join(self.backend, "config.json"), encoding="utf-8") as f:
            self.assertEqual(json.load(f), custom)                                  # the shipped file is never rewritten

    def test_ai_the_administrator_disabled_is_left_alone_and_nothing_is_installed(self):
        for chat in (dict(CONFIG["chat"], local_ai="off"), dict(CONFIG["chat"], enabled=False, local_ai_enabled_by_setup=True)):
            self.write_config({"chat": chat})
            before = self.config_bytes()
            self.fake.requests.clear()
            self.assertEqual(self.make(installed=False, running=False).run(), 0)
            self.assertEqual((self.calls, self.fake.requests, self.config_bytes()[0]), ([], [], before[0]))
            self.assertIsNotNone(self.config_bytes()[1])                            # the setting was moved to config.local.json, where an update cannot remove it
            os.remove(os.path.join(self.backend, "config.local.json"))
        self.write_config(CONFIG)
        self.assertEqual(self.make(env={"LLM_ENABLED": "false"}, installed=False, running=False).run(), 0)
        self.assertEqual(self.calls, [])

    def test_an_older_folder_that_never_opted_in_is_not_changed(self):
        self.write_config({"chat": {k: v for k, v in CONFIG["chat"].items() if k != "local_ai"}})
        before = self.config_bytes()
        self.assertEqual(self.make(installed=False, running=False).run(), 0)
        self.assertEqual((self.calls, self.config_bytes()), ([], before))

    def test_a_custom_ollama_connection_is_not_touched(self):
        self.write_config({"chat": dict(CONFIG["chat"], base_url="http://10.1.2.3:11434", provider="ollama", enabled=True, allow_remote_llm=True)})
        before = self.config_bytes()
        self.assertEqual(self.make(installed=False, running=False).run(), 0)
        self.assertEqual((self.calls, self.fake.requests, self.config_bytes()[0]), ([], [], before[0]))      # (and kept in config.local.json for the next update)


class UpdateTests(Base):
    """Extracting a newer Eko-DT ZIP over an installation replaces config.json (the export writes it) and leaves config.local.json (the export never contains it).
    The setup records its settings in config.local.json only, so nothing it or the operator decided is lost by an update."""

    def extract_update(self, shipped=None):
        """What extracting a newer ZIP does to the configuration files: config.json is replaced by the new release's, config.local.json is not in the ZIP."""
        newer = json.loads(json.dumps(shipped or CONFIG))
        newer["chat"]["timeout_s"] = 99                         # the release changed a default
        newer["new_release_setting"] = {"x": 1}                 # and added a setting
        self.write_config(newer)
        return newer

    def local(self):
        with open(os.path.join(self.backend, "config.local.json"), encoding="utf-8") as f:
            return json.load(f)

    def test_a_fresh_installation_gets_the_default_setup_and_config_json_is_never_written(self):
        shipped = self.config_bytes()[0]
        self.assertEqual(self.make(installed=False, running=False).run(), 0, self.text())
        self.assertEqual(self.config_bytes()[0], shipped)
        self.assertEqual(self.local(), {"chat": {"enabled": True, "local_ai_enabled_by_setup": True, "provider": "ollama", "base_url": "http://127.0.0.1:11434", "model": MODEL}})
        got = self.config()["chat"]
        self.assertEqual((got["enabled"], got["provider"], got["model"], got["timeout_s"], got["local_ai"]), (True, "ollama", MODEL, 60, "auto"))

    def test_an_update_over_a_set_up_installation_keeps_the_assistant_working_without_a_new_setup(self):
        self.make(installed=False, running=False).run()
        local_before = open(os.path.join(self.backend, "config.local.json"), "rb").read()
        newer = self.extract_update()
        self.assertFalse(newer["chat"]["enabled"])                                   # the new config.json knows nothing of the setup
        self.fake.requests.clear()
        self.calls.clear()
        self.assertEqual(self.make().run(), 0, self.text())
        self.assertEqual(self.calls, [])                                             # nothing installed or started
        self.assertNotIn("/api/pull", [p for _, p in self.fake.paths()])             # nothing downloaded
        self.assertNotIn("/api/chat", [p for _, p in self.fake.paths()])
        self.assertEqual(open(os.path.join(self.backend, "config.local.json"), "rb").read(), local_before)      # nothing rewritten
        got = self.config()
        self.assertEqual((got["chat"]["enabled"], got["chat"]["provider"], got["chat"]["model"]), (True, "ollama", MODEL))
        self.assertEqual((got["chat"]["timeout_s"], got["new_release_setting"]), (99, {"x": 1}))        # and the release's changes arrived

    def test_an_administrators_off_survives_an_update(self):
        self.write_local({"chat": {"local_ai": "off"}})
        before = self.config_bytes()
        self.extract_update()
        self.assertEqual(self.make(installed=False, running=False).run(), 0)
        self.assertEqual((self.calls, self.fake.requests), ([], []))                 # nothing installed, downloaded or even asked
        self.assertEqual(self.config_bytes()[1], before[1])
        self.assertEqual(self.config()["chat"]["local_ai"], "off")
        self.assertFalse(self.config()["chat"]["enabled"])

    def test_chat_the_administrator_turned_off_after_the_setup_stays_off_after_an_update(self):
        self.make(installed=False, running=False).run()
        self.write_local({"chat": {"enabled": False, "local_ai_enabled_by_setup": True, "provider": "ollama", "base_url": "http://127.0.0.1:11434", "model": MODEL}})
        before = self.config_bytes()[1]
        self.extract_update()
        self.fake.requests.clear()
        self.calls.clear()
        self.assertEqual(self.make().run(), 0)
        self.assertEqual((self.calls, self.fake.requests, self.config_bytes()[1]), ([], [], before))
        self.assertFalse(self.config()["chat"]["enabled"])

    def test_a_custom_provider_model_and_connection_survive_an_update(self):
        mine = {"chat": {"enabled": True, "provider": "ollama", "base_url": "http://127.0.0.1:11434", "model": "llama3.1:8b", "timeout_s": 120, "api_key_env": "CORP_KEY"}}
        self.write_local(mine)
        self.fake.models = ["llama3.1:8b"]
        self.extract_update()
        before = self.config_bytes()[1]
        self.assertEqual(self.make().run(), 0, self.text())
        self.assertNotIn("/api/pull", [p for _, p in self.fake.paths()])
        self.assertEqual(self.config_bytes()[1], before)
        got = self.config()["chat"]
        self.assertEqual((got["model"], got["timeout_s"], got["api_key_env"]), ("llama3.1:8b", 120, "CORP_KEY"))

    def test_another_provider_the_operator_chose_survives_an_update_and_is_not_set_up_over(self):
        self.write_local({"chat": {"enabled": True, "provider": "openai_compatible", "base_url": "https://llm.corp/v1", "model": "gpt-corp"}})
        before = self.config_bytes()[1]
        self.extract_update()
        self.assertEqual(self.make(installed=False, running=False).run(), 0)
        self.assertEqual((self.calls, self.fake.requests, self.config_bytes()[1]), ([], [], before))
        self.assertEqual(self.config()["chat"]["provider"], "openai_compatible")

    def test_a_remote_ollama_the_operator_chose_survives_an_update(self):
        self.write_local({"chat": {"enabled": True, "provider": "ollama", "base_url": "http://10.1.2.3:11434", "allow_remote_llm": True}})
        before = self.config_bytes()[1]
        self.extract_update()
        self.assertEqual(self.make(installed=False, running=False).run(), 0)
        self.assertEqual((self.calls, self.fake.requests, self.config_bytes()[1]), ([], [], before))

    def test_credentials_and_unrelated_settings_in_the_local_file_are_never_touched(self):
        mine = {"fin_server_url": "https://10.207.200.85", "notification_db_path": "D:\\eko\\n.db", "custom": {"nested": [1, {"a": "ب"}]},
                "chat": {"api_key_env": "CORP_LLM_KEY", "allowed_projects": ["ekoHospital"]}}
        self.write_local(mine)
        self.fake.models = [MODEL]
        self.assertEqual(self.make().run(), 0, self.text())
        got = self.local()
        for key in ("fin_server_url", "notification_db_path", "custom"):
            self.assertEqual(got[key], mine[key], key)
        self.assertEqual((got["chat"]["api_key_env"], got["chat"]["allowed_projects"]), ("CORP_LLM_KEY", ["ekoHospital"]))
        self.assertEqual(got["chat"]["provider"], "ollama")                          # and the setup's own keys were added beside them
        self.assertNotIn('"api_key"', json.dumps(got))                               # (api_key_env, the NAME of a variable, is the only credential setting)
        with open(os.path.join(self.backend, "config.local.json"), encoding="utf-8") as f:
            self.assertIn("ب", f.read())                                            # not escaped away

    def test_a_local_file_that_was_there_before_is_backed_up_once_before_the_first_change(self):
        original = json.dumps({"chat": {"timeout_s": 5}}).encode()
        with open(os.path.join(self.backend, "config.local.json"), "wb") as f:
            f.write(original)
        self.fake.models = [MODEL]
        self.make().run()
        backup = os.path.join(self.backend, "config.local.json.pre-local-ai.bak")
        with open(backup, "rb") as f:
            self.assertEqual(f.read(), original)
        self.write_local({"chat": {"enabled": False, "local_ai_enabled_by_setup": False, "provider": "rules"}})      # a later state
        self.make().run()
        with open(backup, "rb") as f:
            self.assertEqual(f.read(), original)                                    # never overwritten

    def test_a_local_file_that_cannot_be_read_is_not_touched_and_nothing_is_installed(self):
        with open(os.path.join(self.backend, "config.local.json"), "w", encoding="utf-8") as f:
            f.write("{ oops")
        before = self.config_bytes()
        self.assertEqual(self.make(installed=False, running=False).run(), 1)
        self.assertEqual((self.calls, self.fake.requests, self.config_bytes()), ([], [], before))
        self.assertTrue(any("config.local.json" in w for w in self.warnings()), self.warnings())

    def test_the_setup_after_a_failed_run_still_does_not_write_config_json(self):
        self.fake.pull_error = "no network"
        before = self.config_bytes()
        self.assertEqual(self.make().run(), 1)
        self.assertEqual(self.config_bytes(), before)                                # neither file exists or changed: rules-only, nothing half-configured


class LegacyTests(Base):
    """A folder set up by the build that wrote into config.json: its AI settings move to config.local.json the first time the new setup runs (if config.json still
    has them, e.g. the user kept the old file when asked), so the next update cannot take them away."""

    OLD = {"enabled": True, "provider": "ollama", "base_url": "http://127.0.0.1:11434", "model": MODEL, "local_ai": "auto", "local_ai_enabled_by_setup": True}

    def local(self):
        with open(os.path.join(self.backend, "config.local.json"), encoding="utf-8") as f:
            return json.load(f)

    def test_the_ai_settings_of_the_old_build_are_kept_and_only_those(self):
        self.write_config(dict(CONFIG, polling={"live_ms": 777}, chat=dict(CONFIG["chat"], **self.OLD, timeout_s=77)))
        self.fake.models = [MODEL]
        self.assertEqual(self.make().run(), 0, self.text())
        self.assertEqual(self.local(), {"chat": {"enabled": True, "provider": "ollama", "base_url": "http://127.0.0.1:11434", "model": MODEL, "local_ai_enabled_by_setup": True}})
        self.assertIn("config.local.json", self.text())

    def test_the_old_installation_then_survives_the_update_that_replaces_its_config_json(self):
        self.write_config(dict(CONFIG, chat=dict(CONFIG["chat"], **self.OLD)))
        self.fake.models = [MODEL]
        self.make().run()
        self.write_config(CONFIG)                                                    # the update
        local_before = self.config_bytes()[1]
        self.fake.requests.clear()
        self.assertEqual(self.make().run(), 0, self.text())
        self.assertEqual(self.config_bytes()[1], local_before)
        self.assertEqual((self.config()["chat"]["enabled"], self.config()["chat"]["model"]), (True, MODEL))
        self.assertNotIn("/api/pull", [p for _, p in self.fake.paths()])

    def test_an_off_in_the_old_config_json_becomes_durable_and_is_respected(self):
        self.write_config(dict(CONFIG, chat=dict(CONFIG["chat"], local_ai="off")))
        self.assertEqual(self.make(installed=False, running=False).run(), 0)
        self.assertEqual((self.calls, self.fake.requests), ([], []))
        self.assertEqual(self.local(), {"chat": {"local_ai": "off"}})
        self.write_config(CONFIG)                                                    # the update brings back "auto"
        self.assertEqual(self.make(installed=False, running=False).run(), 0)
        self.assertEqual((self.calls, self.fake.requests), ([], []))
        self.assertEqual(self.config()["chat"]["local_ai"], "off")

    def test_a_provider_chosen_by_hand_in_config_json_is_kept_too(self):
        self.write_config(dict(CONFIG, chat=dict(CONFIG["chat"], enabled=True, provider="openai_compatible", base_url="https://llm.corp/v1", model="gpt-corp")))
        self.assertEqual(self.make(installed=False, running=False).run(), 0)
        self.assertEqual(self.local(), {"chat": {"enabled": True, "provider": "openai_compatible", "base_url": "https://llm.corp/v1", "model": "gpt-corp"}})

    def test_a_shipped_config_has_nothing_to_keep_and_creates_no_file_before_a_successful_setup(self):
        self.assertEqual(las.legacy_ai_settings(CONFIG["chat"]), {})
        self.make(installed=False, running=False).run()
        self.assertEqual(sorted(os.listdir(self.backend)), ["config.json", "config.local.json"])
        failing = self.make(installed=False, running=False)
        os.remove(os.path.join(self.backend, "config.local.json"))
        self.install_ok = False
        self.assertEqual(failing.run(), 1)
        self.assertFalse(os.path.exists(os.path.join(self.backend, "config.local.json")))

    def test_an_existing_local_file_is_never_overridden_by_the_old_settings(self):
        self.write_config(dict(CONFIG, chat=dict(CONFIG["chat"], **self.OLD)))
        mine = {"chat": {"local_ai": "off"}}
        self.write_local(mine)
        before = self.config_bytes()[1]
        self.assertEqual(self.make(installed=False, running=False).run(), 0)
        self.assertEqual(self.config_bytes()[1], before)

    def test_what_counts_as_an_old_setting(self):
        keep = las.legacy_ai_settings
        self.assertEqual(keep(dict(CONFIG["chat"], local_ai_enabled_by_setup=True, enabled=True, provider="ollama", model=MODEL, base_url="http://127.0.0.1:11434")),
                         {"enabled": True, "provider": "ollama", "model": MODEL, "base_url": "http://127.0.0.1:11434", "local_ai_enabled_by_setup": True})
        self.assertEqual(keep(dict(CONFIG["chat"], local_ai="off")), {"local_ai": "off"})
        self.assertEqual(keep({"local_ai": "auto", "enabled": False, "provider": "rules"}), {})
        self.assertEqual(keep(None), {})
        self.assertEqual(keep("text"), {})


class LocalhostOnlyTests(Base):
    def test_only_loopback_is_ever_called(self):
        self.fake.models = [MODEL]
        self.make().run()
        self.assertTrue(self.fake.requests)
        for bad in ("http://10.0.0.5:11434", "http://example.com", "http://localhost:11434", "https://127.0.0.1:11434", "ftp://127.0.0.1"):
            with self.assertRaises(ValueError, msg=bad):
                las.LocalAI(self.backend, env={}, base_url=bad)

    def test_local_calls_do_not_go_through_a_proxy(self):
        # a proxy that does not exist is configured for the whole machine; a call to loopback must not be sent to it
        dead = {"HTTP_PROXY": "http://127.0.0.1:9", "HTTPS_PROXY": "http://127.0.0.1:9", "http_proxy": "http://127.0.0.1:9", "ALL_PROXY": "http://127.0.0.1:9"}
        with mock.patch.dict(os.environ, dead):
            ai = self.make(env=dict(dead))
            self.assertEqual(ai.call("GET", "/api/version")["version"], "0.40.14")
            self.assertTrue(ai.running())
            self.assertNotIn("ProxyHandler", [type(h).__name__ for h in ai.local_opener.handlers])
            # and the one that downloads the installer is the standard opener: the machine's proxy settings apply to it
            self.assertTrue(any(isinstance(h, urllib.request.ProxyHandler) for h in urllib.request.build_opener(las.CheckedRedirect).handlers))

    def test_an_ollama_that_listens_on_the_network_is_warned_about_not_changed(self):
        self.fake.models = [MODEL]
        ai = self.make(env={"OLLAMA_HOST": "0.0.0.0:11434"})
        self.assertEqual(ai.run(), 0)
        self.assertTrue(any("OLLAMA_HOST" in w for w in self.warnings()), self.warnings())
        quiet = self.make(env={"OLLAMA_HOST": "127.0.0.1:11434"})
        self.said.clear()
        quiet.run()
        self.assertFalse(any("OLLAMA_HOST" in w for w in self.warnings()))

    def test_the_service_the_script_starts_listens_on_loopback_only(self):
        seen = {}

        class P:
            def __init__(self, cmd, **kw):
                seen.update(cmd=cmd, env=kw["env"])
        ai = las.LocalAI(self.backend, env={"OLLAMA_HOST": "0.0.0.0", "HTTPS_PROXY": "http://proxy.corp:8080"}, base_url=self.fake.base, say=lambda l, t: None,
                         sleep=lambda s: None, wait_s=0.1, popen=P, os_name="nt")
        ai.running = lambda: True
        ai.start(r"C:\fake\ollama.exe")
        self.assertEqual(seen["cmd"], [r"C:\fake\ollama.exe", "serve"])
        self.assertEqual(seen["env"]["OLLAMA_HOST"], "127.0.0.1:11434")
        self.assertEqual(seen["env"]["HTTPS_PROXY"], "http://proxy.corp:8080")      # the proxy the machine uses is kept for the model download


class LogTests(Base):
    def test_the_log_goes_where_it_is_told_else_next_to_the_notification_database(self):
        self.assertEqual(las.log_path({"EKO_LOCAL_AI_LOG_DIR": r"D:\logs"}), os.path.join(r"D:\logs", "local-ai-setup.log"))
        self.assertEqual(las.log_path({"LOCALAPPDATA": r"C:\Users\u\AppData\Local"}), os.path.join(r"C:\Users\u\AppData\Local", "EKO-DT", "logs", "local-ai-setup.log"))

    def test_what_happened_is_logged_and_nothing_secret_is(self):
        logs = os.path.join(self.root, "logs")
        self.fake.models = [MODEL]
        ai = las.LocalAI(self.backend, env={"EKO_LOCAL_AI_LOG_DIR": logs, "HTTPS_PROXY": "http://user:secret@proxy:8080"}, base_url=self.fake.base,
                         sleep=lambda s: None, wait_s=0.2)
        with mock.patch("builtins.print"):
            ai.run()
        with open(os.path.join(logs, "local-ai-setup.log"), encoding="utf-8") as f:
            text = f.read()
        self.assertIn("Local AI is ready", text)
        self.assertNotIn("secret", text)
        self.assertNotIn("proxy", text.lower())


class NoProxyTests(unittest.TestCase):
    def test_loopback_is_added_only_when_a_proxy_is_set(self):
        self.assertEqual(las.merged_no_proxy({}), "")
        self.assertEqual(las.merged_no_proxy({"NO_PROXY": "corp.local"}), "corp.local")
        self.assertEqual(las.merged_no_proxy({"HTTPS_PROXY": "http://p:1"}), "127.0.0.1,localhost")
        self.assertEqual(las.merged_no_proxy({"http_proxy": "http://p:1", "no_proxy": "corp.local,127.0.0.1"}), "corp.local,127.0.0.1,localhost")
        self.assertEqual(las.merged_no_proxy({"ALL_PROXY": "x", "NO_PROXY": " a , ,b "}), "a,b,127.0.0.1,localhost")


class InstallerTests(unittest.TestCase):
    """The installer download and run: official HTTPS only, signed by Ollama Inc., never run otherwise."""

    def ai(self, **kw):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        os.makedirs(os.path.join(tmp.name, "backend"))
        kw.setdefault("os_name", "nt")
        return las.LocalAI(os.path.join(tmp.name, "backend"), env=kw.pop("env", {}), say=lambda l, t: None, sleep=lambda s: None, **kw), tmp.name

    def test_only_https_hosts_of_the_official_download_chain_are_followed(self):
        ok = ("https://ollama.com/download/OllamaSetup.exe", "https://github.com/ollama/ollama/releases/download/v1/OllamaSetup.exe",
              "https://objects.githubusercontent.com/x/y", "https://release-assets.githubusercontent.com/z")
        for url in ok:
            self.assertTrue(las.allowed_download_url(url), url)
        for url in ("http://ollama.com/download/OllamaSetup.exe", "https://evil.example/OllamaSetup.exe", "https://ollama.com.evil.example/x", "https://notgithub.com/x",
                    "ftp://ollama.com/x", "file:///c:/x.exe", "https://githubusercontent.com.evil.io/x", ""):
            self.assertFalse(las.allowed_download_url(url), url)

    def test_a_redirect_off_the_allowed_hosts_is_refused(self):
        handler = las.CheckedRedirect()
        req = urllib.request.Request("https://ollama.com/download/OllamaSetup.exe")
        with self.assertRaises(urllib.error.URLError):
            handler.redirect_request(req, io.BytesIO(), 302, "Found", {}, "https://evil.example/OllamaSetup.exe")

    def test_a_signature_that_is_not_ollama_inc_is_never_run(self):
        ai, root = self.ai()
        installer = os.path.join(root, "OllamaSetup.exe")
        with open(installer, "wb") as f:
            f.write(b"MZ" + b"0" * 100)
        ran = []
        for result in ("Valid|CN=Somebody Else", "NotSigned|", "HashMismatch|CN=Ollama Inc., O=Ollama Inc.", "UnknownError|", ""):
            ai.signature = lambda path, r=result: tuple(r.split("|", 1)) if r else ("", "")
            ai.run_installer = lambda path: ran.append(path) or True
            self.assertFalse(ai.install_from(installer), result)
        self.assertEqual(ran, [])
        ai.signature = lambda path: ("Valid", "CN=Ollama Inc., O=Ollama Inc., L=Toronto, C=CA")
        self.assertTrue(ai.install_from(installer))
        self.assertEqual(ran, [installer])

    def test_a_staged_installer_next_to_the_batch_file_is_used_without_a_download(self):
        ai, root = self.ai()
        staged = os.path.join(root, "OllamaSetup.exe")
        with open(staged, "wb") as f:
            f.write(b"MZ")
        ai.download_installer = mock.Mock(side_effect=AssertionError("must not download"))
        ai.install_from = lambda path: path == staged
        self.assertTrue(las.LocalAI.install(ai))

    def test_without_a_staged_installer_it_is_downloaded_checked_and_removed(self):
        ai, root = self.ai()
        fetched = os.path.join(root, "dl.exe")
        with open(fetched, "wb") as f:
            f.write(b"MZ")
        ai.download_installer = lambda: fetched
        ai.install_from = lambda path: path == fetched
        self.assertTrue(las.LocalAI.install(ai))
        self.assertFalse(os.path.exists(fetched))

    def test_a_download_failure_is_a_failed_install_and_runs_nothing(self):
        ai, _ = self.ai()
        ai.download_installer = mock.Mock(side_effect=las.SetupError("The download failed (HTTP 407). A proxy that needs a login must be set up for this account."))
        ai.install_from = mock.Mock()
        self.assertFalse(las.LocalAI.install(ai))
        ai.install_from.assert_not_called()

    def test_the_installer_runs_silently_and_per_user(self):
        seen = {}
        ai, _ = self.ai(run=lambda cmd, **kw: seen.update(cmd=cmd) or mock.Mock(returncode=0))
        self.assertTrue(las.LocalAI.run_installer(ai, r"C:\x\OllamaSetup.exe"))
        self.assertEqual(seen["cmd"], [r"C:\x\OllamaSetup.exe", "/VERYSILENT", "/NORESTART", "/SUPPRESSMSGBOXES"])
        self.assertNotIn("/ALLUSERS", seen["cmd"])
        failing, _ = self.ai(run=lambda cmd, **kw: mock.Mock(returncode=5))
        self.assertFalse(las.LocalAI.run_installer(failing, r"C:\x\OllamaSetup.exe"))

    def test_nothing_is_installed_off_windows(self):
        ai, _ = self.ai(os_name="posix")
        ai.download_installer = mock.Mock()
        self.assertFalse(las.LocalAI.install(ai))
        ai.download_installer.assert_not_called()

    def test_the_program_is_looked_for_on_the_path_and_in_the_usual_user_and_machine_folders(self):
        ai, _ = self.ai(env={"LOCALAPPDATA": r"C:\Users\u\AppData\Local", "ProgramFiles": r"C:\Program Files"})
        asked = []
        ai.which = lambda name: None
        ai.exists = lambda p: asked.append(p) or False
        self.assertIsNone(las.LocalAI.find_ollama(ai))
        self.assertEqual(asked, [os.path.join(r"C:\Users\u\AppData\Local", "Programs", "Ollama", "ollama.exe"), os.path.join(r"C:\Program Files", "Ollama", "ollama.exe")])
        ai.which = lambda name: r"C:\tools\ollama.exe"
        self.assertEqual(las.LocalAI.find_ollama(ai), r"C:\tools\ollama.exe")


if __name__ == "__main__":
    unittest.main()
