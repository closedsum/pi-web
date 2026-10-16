"""Pi Web launcher — starts server, opens a new Chrome window, shuts down on idle."""

import argparse
import os
import subprocess
import socket
import sys
import time
import urllib.parse

SERVER_HOST = "127.0.0.1"
SERVER_PORT = 30141

log = lambda msg: print(msg, flush=True)

_GSD_CHROME = os.path.join(
    os.environ.get("HOME") or os.environ.get("USERPROFILE", ""),
    "gsd-config", "get-shit-done", "bin", "gsd_chrome_launch.py",
)


def open_in_new_chrome_window(url):
    if os.path.isfile(_GSD_CHROME):
        subprocess.Popen([sys.executable, _GSD_CHROME, url])
    else:
        import webbrowser
        log("gsd_chrome_launch.py not found — falling back to default browser")
        webbrowser.open(url)


def wait_for_server(timeout=60):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with socket.create_connection((SERVER_HOST, SERVER_PORT), timeout=1):
                return True
        except (ConnectionRefusedError, OSError):
            time.sleep(0.5)
    return False


def kill_tree(pid):
    if sys.platform == "win32":
        subprocess.run(["taskkill", "/f", "/t", "/pid", str(pid)], capture_output=True)
    else:
        os.kill(pid, 15)


def main():
    parser = argparse.ArgumentParser(description="Launch Pi Web")
    parser.add_argument("mode", choices=["dev", "start"])
    parser.add_argument("--cwd", default=None, help="Project directory to open")
    args = parser.parse_args()

    project_dir = os.path.dirname(os.path.abspath(__file__))
    base_url = f"http://{SERVER_HOST}:{SERVER_PORT}"
    cwd = args.cwd or os.getcwd()
    url = f"{base_url}?cwd={urllib.parse.quote(cwd, safe='')}"
    npm_cmd = ["npm", "run", "dev" if args.mode == "dev" else "start"]

    log(f"Starting Pi Web ({args.mode})...")
    env = {**os.environ, "PI_WEB_IDLE_TIMEOUT_MS": "120000"}
    server = subprocess.Popen(npm_cmd, cwd=project_dir, shell=True, env=env)

    log("Waiting for server...")
    if not wait_for_server():
        log("Server failed to start.")
        kill_tree(server.pid)
        sys.exit(1)

    log(f"Server ready — opening {url} in new Chrome window")
    open_in_new_chrome_window(url)

    log("Press Ctrl+C to stop the server.")
    try:
        server.wait()
    except KeyboardInterrupt:
        log("\nShutting down...")
        kill_tree(server.pid)

    log("Done.")


if __name__ == "__main__":
    main()
