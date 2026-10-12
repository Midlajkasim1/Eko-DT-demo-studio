"""The real backend app with the fake FIN client, for browser tests.

    python tests/fake_fin_server.py --port 8000     (run from backend/)

Sign in with any username/password. Never use this for anything but testing.
"""
import argparse
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)

import main  # noqa: E402
import uvicorn  # noqa: E402
from fake_fin import FakeFinClient  # noqa: E402

main.FinScramClient = FakeFinClient

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8000)
    args = ap.parse_args()
    uvicorn.run(main.app, host="127.0.0.1", port=args.port, log_level="warning")
