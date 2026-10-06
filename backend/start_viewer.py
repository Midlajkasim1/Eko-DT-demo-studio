from __future__ import annotations

import os
import socket
import subprocess
import sys
import time
import webbrowser

PORT = 8000
HOST = "127.0.0.1"
HERE = os.path.dirname(os.path.abspath(__file__))


def _listening(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.4)
        return sock.connect_ex((HOST, port)) == 0


def _pids_on_port_windows(port: int) -> list[int]:
    try:
        out = subprocess.check_output(["netstat", "-ano"], text=True, stderr=subprocess.DEVNULL)
    except (OSError, subprocess.CalledProcessError):
        return []
    pids: set[int] = set()
    needle = f":{port}"
    for line in out.splitlines():
        if needle not in line or "LISTENING" not in line.upper():
            continue
        parts = line.split()
        if parts and parts[-1].isdigit():
            pid = int(parts[-1])
            if pid not in (0, 4):
                pids.add(pid)
    return list(pids)


def free_port(port: int) -> None:
    if not _listening(port):
        return
    if os.name == "nt":
        for pid in _pids_on_port_windows(port):
            subprocess.run(
                ["taskkill", "/F", "/PID", str(pid), "/T"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
    else:
        subprocess.run(
            ["fuser", "-k", f"{port}/tcp"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    for _ in range(25):
        if not _listening(port):
            return
        time.sleep(0.2)


def wait_ready(port: int, timeout: float = 45) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if _listening(port):
            return True
        time.sleep(0.3)
    return False


def main() -> int:
    os.chdir(HERE)
    print("EKO viewer  http://127.0.0.1:%s/" % PORT)
    print("Stopping any previous instance on this port...")
    free_port(PORT)
    proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", str(PORT)],
        cwd=HERE,
    )
    try:
        if not wait_ready(PORT):
            print("Server did not start. Check the messages above.")
            proc.terminate()
            return 1
        webbrowser.open("http://127.0.0.1:%s/" % PORT)
        print("Sign in when the page opens. Press Ctrl+C to stop.")
        return proc.wait()
    except KeyboardInterrupt:
        print("\nStopping.")
        proc.terminate()
        try:
            proc.wait(timeout=8)
        except subprocess.TimeoutExpired:
            proc.kill()
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
