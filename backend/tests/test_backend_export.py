"""The project export's backend file list (src/lib/backendExport.ts) holds every Python module the exported backend needs.

Run from backend/:   python -m unittest tests.test_backend_export
The export copies exactly the files in BACKEND_EXPORT_FILES. A module that eko_chat.py imports but the list lacks makes the exported backend fail with
ModuleNotFoundError (it happened with eko_chat_capabilities and eko_chat_trace). These tests read the list, follow the imports of every listed file, and import
the backend from a folder holding ONLY the listed files (plus the config.json the exporter writes itself).
"""
import ast
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

with open(os.path.join(ROOT, "src", "lib", "backendExport.ts"), encoding="utf-8") as _f:
    LISTED = re.findall(r"'([^']+)'", _f.read().split("[", 1)[1].split("]", 1)[0])
LOCAL = {f[:-3] for f in os.listdir(BACKEND) if f.endswith(".py")}


def imported_local_modules(files):
    """Every backend module that the given files import (anywhere in them, inside functions too), followed transitively."""
    needed, queue, seen = {}, [f for f in files if f.endswith(".py")], set()
    while queue:
        name = queue.pop()
        if name in seen:
            continue
        seen.add(name)
        with open(os.path.join(BACKEND, name), encoding="utf-8") as f:
            tree = ast.parse(f.read())
        for node in ast.walk(tree):
            mods = []
            if isinstance(node, ast.Import):
                mods = [a.name.split(".")[0] for a in node.names]
            elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
                mods = [node.module.split(".")[0]]
            for m in mods:
                if m in LOCAL and m != name[:-3]:
                    needed.setdefault(m + ".py", set()).add(name)
                    queue.append(m + ".py")
    return needed


class ExportListTests(unittest.TestCase):
    def test_the_list_was_read(self):
        self.assertGreater(len(LISTED), 10)
        self.assertEqual(len(LISTED), len(set(LISTED)), "no file is listed twice")

    def test_every_listed_file_exists(self):
        self.assertEqual([n for n in LISTED if not os.path.isfile(os.path.join(BACKEND, n))], [])

    def test_every_chat_module_is_listed(self):
        chat = sorted(f for f in os.listdir(BACKEND) if f.startswith("eko_chat") and f.endswith(".py"))
        self.assertGreaterEqual(len(chat), 6)
        for name in ("eko_chat.py", "eko_chat_router.py", "eko_chat_llm.py", "eko_chat_capabilities.py", "eko_chat_trace.py", "eko_chat_context.py"):
            self.assertIn(name, chat)
        self.assertEqual([n for n in chat if n not in LISTED], [], "a chat module the export would leave out")

    def test_every_backend_module_an_exported_file_imports_is_listed(self):
        needed = imported_local_modules(LISTED)
        self.assertIn("eko_chat_context.py", needed)
        self.assertEqual({m: sorted(by) for m, by in needed.items() if m not in LISTED}, {})

    def test_the_exported_backend_imports_from_the_listed_files_alone(self):
        tmp = tempfile.mkdtemp(prefix="eko-export-test-")
        try:
            for name in LISTED:
                shutil.copy(os.path.join(BACKEND, name), tmp)
            shutil.copy(os.path.join(BACKEND, "config.json"), tmp)               # the exporter writes backend/config.json itself
            env = dict(os.environ, EKO_NOTIFICATION_DB=os.path.join(tmp, "n.sqlite3"), PYTHONDONTWRITEBYTECODE="1")
            code = ("import sys; sys.path.insert(0, %r); import main, eko_chat, eko_chat_llm, eko_chat_router, eko_chat_capabilities, "
                    "eko_chat_trace, eko_chat_context; print('import ok')" % tmp)
            r = subprocess.run([sys.executable, "-I", "-c", code], cwd=tmp, env=env, capture_output=True, text=True, timeout=180)
            self.assertEqual((r.returncode, r.stdout.strip().splitlines()[-1:]), (0, ["import ok"]), (r.stderr or r.stdout)[-800:])
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def test_a_missing_chat_module_would_be_caught(self):
        for leave_out in ("eko_chat_context.py", "eko_chat_trace.py", "eko_chat_capabilities.py"):
            tmp = tempfile.mkdtemp(prefix="eko-export-test-")
            try:
                for name in LISTED:
                    if name != leave_out:
                        shutil.copy(os.path.join(BACKEND, name), tmp)
                shutil.copy(os.path.join(BACKEND, "config.json"), tmp)
                env = dict(os.environ, EKO_NOTIFICATION_DB=os.path.join(tmp, "n.sqlite3"), PYTHONDONTWRITEBYTECODE="1")
                r = subprocess.run([sys.executable, "-I", "-c", "import sys; sys.path.insert(0, %r); import main" % tmp], cwd=tmp, env=env,
                                   capture_output=True, text=True, timeout=180)
                self.assertNotEqual(r.returncode, 0, leave_out)
                self.assertIn("ModuleNotFoundError", r.stderr, leave_out)
            finally:
                shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
