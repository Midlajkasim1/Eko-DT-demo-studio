"""Operator settings that survive an update: backend/config.local.json over backend/config.json.

Run from backend/:   python -m unittest tests.test_config_overlay
Extracting a newer Eko-DT ZIP over an installation replaces config.json (the export writes it) before any of our code runs, so nothing that lives in config.json
can survive an update. config.local.json is the operator's file: the export never contains it, so extraction cannot touch it, and the backend lays it over
config.json when it starts. These tests cover the merge, the failure mode (a file that cannot be read keeps the AI assistant OFF), and the real backend importing
with such a file in a folder made of the exported files only.
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.dirname(HERE)
ROOT = os.path.dirname(BACKEND)
sys.path.insert(0, BACKEND)

import config_overlay as co  # noqa: E402

BASE = {"project_name": "marsaAlArab", "polling": {"live_ms": 5000, "realtime_ms": 30000}, "allowed": ["a", "b"],
        "chat": {"enabled": False, "provider": "rules", "model": "qwen3:4b", "timeout_s": 60, "allowed_projects": ["marsaAlArab"], "local_ai": "auto"}}


class MergeTests(unittest.TestCase):
    def test_a_nested_value_is_replaced_and_its_siblings_stay(self):
        got = co.deep_merge(BASE, {"chat": {"enabled": True, "model": "qwen3:8b"}})
        self.assertEqual((got["chat"]["enabled"], got["chat"]["model"], got["chat"]["timeout_s"], got["chat"]["allowed_projects"]), (True, "qwen3:8b", 60, ["marsaAlArab"]))
        self.assertEqual(got["polling"], BASE["polling"])
        self.assertEqual(got["project_name"], "marsaAlArab")

    def test_lists_and_scalars_are_replaced_whole(self):
        got = co.deep_merge(BASE, {"allowed": ["c"], "project_name": "other", "polling": {"live_ms": 1000}})
        self.assertEqual((got["allowed"], got["project_name"], got["polling"]), (["c"], "other", {"live_ms": 1000, "realtime_ms": 30000}))

    def test_a_key_the_shipped_file_does_not_have_is_added(self):
        self.assertEqual(co.deep_merge(BASE, {"notification_db_path": "D:\\eko.db"})["notification_db_path"], "D:\\eko.db")

    def test_neither_input_is_modified(self):
        base, local = json.loads(json.dumps(BASE)), {"chat": {"enabled": True}, "extra": {"x": [1]}}
        before = (json.dumps(base), json.dumps(local))
        merged = co.deep_merge(base, local)
        merged["chat"]["timeout_s"] = 1
        merged["extra"]["x"].append(2)
        self.assertEqual((json.dumps(base), json.dumps(local)), before)

    def test_a_value_of_another_type_replaces_it(self):
        self.assertEqual(co.deep_merge({"a": {"b": 1}}, {"a": 5}), {"a": 5})
        self.assertEqual(co.deep_merge({"a": 5}, {"a": {"b": 1}}), {"a": {"b": 1}})

    def test_the_paths_that_differ_are_named_without_their_values(self):
        paths = co.overridden(BASE, {"chat": {"enabled": True, "model": "qwen3:4b", "api_key_env": "CORP_KEY"}, "polling": {"live_ms": 1000}})
        self.assertEqual(sorted(paths), ["chat.api_key_env", "chat.enabled", "polling.live_ms"])      # model is the same value: not an override


class FileTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = os.path.join(self.tmp.name, "config.local.json")

    def write(self, text):
        with open(self.path, "w", encoding="utf-8") as f:
            f.write(text)

    def test_no_file_is_no_override(self):
        merged, info = co.apply_local(BASE, self.path)
        self.assertEqual((merged, info["exists"], info["overridden"], info["error"]), (BASE, False, [], None))

    def test_the_file_is_laid_over_the_base(self):
        self.write(json.dumps({"chat": {"local_ai": "off", "model": "llama3.1:8b"}}))
        merged, info = co.apply_local(BASE, self.path)
        self.assertEqual((merged["chat"]["local_ai"], merged["chat"]["model"], merged["chat"]["timeout_s"]), ("off", "llama3.1:8b", 60))
        self.assertEqual((info["exists"], sorted(info["overridden"]), info["error"]), (True, ["chat.local_ai", "chat.model"], None))

    def test_a_file_with_a_byte_order_mark_and_non_ascii_text_is_read(self):
        with open(self.path, "w", encoding="utf-8-sig") as f:
            json.dump({"display_name": "مستشفى"}, f, ensure_ascii=False)
        self.assertEqual(co.apply_local(BASE, self.path)[0]["display_name"], "مستشفى")

    def test_a_file_that_cannot_be_read_keeps_the_assistant_off_and_says_why(self):
        base = json.loads(json.dumps(BASE))
        base["chat"]["enabled"] = True                                                # (an installed assistant that was on)
        for bad in ("{ not json", "[1, 2]", '"text"', "null", ""):
            self.write(bad)
            merged, info = co.apply_local(base, self.path)
            self.assertIs(merged["chat"]["enabled"], False, bad)
            self.assertTrue(info["error"] and "config.local.json" in info["error"], (bad, info))
            self.assertEqual(merged["project_name"], "marsaAlArab")                  # the rest of the shipped file is used as it is
        self.assertIs(base["chat"]["enabled"], True)                                 # the input is not modified

    def test_read_local_tells_a_missing_file_from_a_broken_one(self):
        self.assertEqual(co.read_local(self.path), ({}, False, None))
        self.write('{"chat": {"enabled": true}}')
        self.assertEqual(co.read_local(self.path), ({"chat": {"enabled": True}}, True, None))
        self.write("{")
        local, exists, error = co.read_local(self.path)
        self.assertEqual((local, exists), (None, True))
        self.assertIsNotNone(error)


class BackendTests(unittest.TestCase):
    """The real backend, imported from a folder holding only the files an export holds (plus config.local.json where the test puts one)."""

    def folder(self, shipped, local=None):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        with open(os.path.join(ROOT, "src", "lib", "backendExport.ts"), encoding="utf-8") as f:
            listed = re.findall(r"'([^']+)'", f.read().split("[", 1)[1].split("]", 1)[0])
        for name in listed:
            if name.endswith(".py"):
                shutil.copy(os.path.join(BACKEND, name), tmp.name)
        with open(os.path.join(tmp.name, "config.json"), "w", encoding="utf-8") as f:
            json.dump(shipped, f)
        if local is not None:
            with open(os.path.join(tmp.name, "config.local.json"), "w", encoding="utf-8") as f:
                f.write(local if isinstance(local, str) else json.dumps(local))
        return tmp.name

    def chat(self, folder):
        code = "import json, main; print(json.dumps({'chat': main.CONFIG['chat'], 'base': main.BASE_CONFIG['chat'], 'name': main.PROJECT_NAME}))"
        env = dict(os.environ, EKO_NOTIFICATION_DB=os.path.join(folder, "n.db"))
        run = subprocess.run([sys.executable, "-c", code], cwd=folder, env=env, capture_output=True, text=True, timeout=120)
        self.assertEqual(run.returncode, 0, run.stderr[-800:])
        return json.loads(run.stdout.strip().splitlines()[-1]), run.stdout + run.stderr

    def shipped(self):
        with open(os.path.join(BACKEND, "config.json"), encoding="utf-8") as f:
            return json.load(f)

    def test_without_the_file_the_backend_serves_config_json_as_before(self):
        got, _ = self.chat(self.folder(self.shipped()))
        self.assertEqual(got["chat"], self.shipped()["chat"])

    def test_with_the_file_the_backend_serves_the_operators_settings(self):
        got, out = self.chat(self.folder(self.shipped(), {"chat": {"enabled": True, "provider": "ollama", "model": "qwen3:8b", "base_url": "http://127.0.0.1:11434"}}))
        self.assertEqual((got["chat"]["enabled"], got["chat"]["provider"], got["chat"]["model"]), (True, "ollama", "qwen3:8b"))
        self.assertEqual(got["base"]["model"], "qwen3:8b")                         # also what a project switch restores
        self.assertEqual(got["chat"]["allowed_projects"], self.shipped()["chat"]["allowed_projects"])
        logged = " ".join(line for line in out.splitlines() if line.startswith("[config]"))
        self.assertIn("config.local.json overrides", logged)
        self.assertIn("chat.model", logged)
        self.assertNotIn("qwen3:8b", logged)                                        # key names only: never a value
        self.assertNotIn("127.0.0.1", logged)

    def test_an_update_replaces_config_json_and_the_operators_settings_stay(self):
        folder = self.folder(self.shipped(), {"chat": {"enabled": True, "provider": "ollama", "local_ai": "off", "model": "llama3.1:8b"}})
        newer = self.shipped()
        newer["chat"]["timeout_s"] = 99                                              # the next release changes a default and adds a key
        newer["brand_new_setting"] = {"x": 1}
        with open(os.path.join(folder, "config.json"), "w", encoding="utf-8") as f:
            json.dump(newer, f)
        got, _ = self.chat(folder)
        self.assertEqual((got["chat"]["timeout_s"], got["chat"]["local_ai"], got["chat"]["model"], got["chat"]["enabled"]), (99, "off", "llama3.1:8b", True))

    def test_a_file_that_cannot_be_read_leaves_the_assistant_off_and_the_backend_running(self):
        shipped = self.shipped()
        shipped["chat"]["enabled"] = True
        got, out = self.chat(self.folder(shipped, "{ oops"))
        self.assertIs(got["chat"]["enabled"], False)
        self.assertIn("config.local.json could not be read", out)
        self.assertEqual(got["name"], shipped["project_name"])

    def test_the_overlay_is_in_the_exported_file_list_and_the_local_file_is_not(self):
        with open(os.path.join(ROOT, "src", "lib", "backendExport.ts"), encoding="utf-8") as f:
            listed = re.findall(r"'([^']+)'", f.read().split("[", 1)[1].split("]", 1)[0])
        self.assertIn("config_overlay.py", listed)
        self.assertNotIn("config.local.json", listed)


if __name__ == "__main__":
    unittest.main()
