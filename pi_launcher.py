"""Pi Web launcher — starts server, opens a Chrome tab, shuts down on idle."""

import argparse
import os
import subprocess
import socket
import sys
import time
import webbrowser

SERVER_HOST = "127.0.0.1"
SERVER_PORT = 30141

log = lambda msg: print(msg, flush=True)


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
    args = parser.parse_args()

    project_dir = os.path.dirname(os.path.abspath(__file__))
    url = f"http://{SERVER_HOST}:{SERVER_PORT}"
    npm_cmd = ["npm", "run", "dev" if args.mode == "dev" else "start"]

    log(f"Starting Pi Web ({args.mode})...")
    server = subprocess.Popen(npm_cmd, cwd=project_dir, shell=True)

    log("Waiting for server...")
    if not wait_for_server():
        log("Server failed to start.")
        kill_tree(server.pid)
        sys.exit(1)

    log(f"Server ready — opening {url}")
    webbrowser.open(url)

    log("Press Ctrl+C to stop the server.")
    try:
        server.wait()
    except KeyboardInterrupt:
        log("\nShutting down...")
        kill_tree(server.pid)

    log("Done.")


if __name__ == "__main__":
    main()
