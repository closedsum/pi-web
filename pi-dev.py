#!/usr/bin/env python3
"""Pi-web dev launcher — kills stale processes, clears locks, starts dev server."""
import os, subprocess, sys, shutil, signal

PORT = 30141
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

def kill_port_listeners():
    """Kill processes listening on the dev port."""
    if sys.platform == "win32":
        try:
            out = subprocess.check_output(["netstat", "-ano"], text=True, stderr=subprocess.DEVNULL)
            for line in out.splitlines():
                if f":{PORT}" in line and "LISTENING" in line:
                    pid = line.strip().split()[-1]
                    try:
                        subprocess.run(["taskkill", "/F", "/PID", pid], capture_output=True)
                        print(f"[pi-web] Killed stale PID {pid}")
                    except Exception:
                        pass
        except Exception:
            pass

def clear_lock():
    """Remove .next if it has a stale lock."""
    next_dir = os.path.join(SCRIPT_DIR, ".next")
    lock = os.path.join(next_dir, "dev", "lock")
    if os.path.exists(lock):
        print("[pi-web] Clearing stale .next lock...")
        shutil.rmtree(next_dir, ignore_errors=True)

def main():
    os.chdir(SCRIPT_DIR)
    print("[pi-web] Cleaning stale processes...")
    kill_port_listeners()
    clear_lock()
    print(f"[pi-web] Starting dev server on 127.0.0.1:{PORT}...")
    try:
        proc = subprocess.Popen(["npm", "run", "dev"], shell=sys.platform == "win32")
        proc.wait()
    except KeyboardInterrupt:
        proc.terminate()
        sys.exit(0)

if __name__ == "__main__":
    main()
