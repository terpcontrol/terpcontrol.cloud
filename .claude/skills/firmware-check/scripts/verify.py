#!/usr/bin/env python3
"""Poll /device until every hardware type has its target firmware id installed
and the device is freshly back online, or timeout.

Usage:
    verify.py <state-file>

The state file is the one written by run-cycle.sh — one
"<hw_type> <firmware_id>" pair per line.

Reads credentials from environment:
    API_URL_EXTERNAL        - server URL
    AGENT_TESTING_USERNAME  - user login
    AGENT_TESTING_PASSWORD  - user password

Exits 0 on full success, 1 on timeout, 2 on bad input.
"""

import json
import os
import sys
import time
import urllib.request

TIMEOUT_S = 15 * 60       # per cycle
RECENT_LASTSEEN_S = 60    # "back online" = lastseen within this window
POLL_INTERVAL_S = 15
PRINT_INTERVAL_S = 25     # throttle status lines


def env(name: str) -> str:
    v = os.environ.get(name)
    if not v:
        print(f"missing env var: {name}", file=sys.stderr)
        sys.exit(2)
    return v


def login(api: str, user: str, password: str) -> str:
    req = urllib.request.Request(
        api + "/login",
        method="POST",
        data=json.dumps({"username": user, "password": password}).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req) as r:
        return json.load(r)["userToken"]["token"]


def fleet(api: str, token: str):
    req = urllib.request.Request(api + "/device", headers={"Authorization": "Bearer " + token})
    with urllib.request.urlopen(req) as r:
        return json.load(r)


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: verify.py <state-file>", file=sys.stderr)
        return 2

    api = env("API_URL_EXTERNAL")
    user = env("AGENT_TESTING_USERNAME")
    password = env("AGENT_TESTING_PASSWORD")

    targets = {}
    with open(sys.argv[1]) as f:
        for line in f:
            parts = line.split()
            if len(parts) == 2:
                targets[parts[0]] = parts[1]
    if not targets:
        print("state file is empty", file=sys.stderr)
        return 2

    start = time.time()
    last_print = 0.0
    while True:
        elapsed = int(time.time() - start)
        try:
            token = login(api, user, password)
            devices = fleet(api, token)
        except Exception as e:
            print(f"[t+{elapsed}s] api error: {e}", flush=True)
            time.sleep(POLL_INTERVAL_S)
            continue

        now_ms = int(time.time() * 1000)
        statuses = []
        all_ok = True
        for d in devices:
            hw = d.get("device_type")
            if hw not in targets:
                continue
            fw = (d.get("hardwareInfo") or {}).get("firmware_version") or ""
            last = d.get("lastseen") or 0
            age = (now_ms - last) // 1000
            match = fw == targets[hw]
            online = last >= now_ms - RECENT_LASTSEEN_S * 1000
            ok = match and online
            if not ok:
                all_ok = False
            statuses.append(f"{hw}={'OK' if ok else f'fw={fw[:8]} age={age}s'}")

        summary = " ".join(statuses)
        if all_ok:
            print(f"[t+{elapsed}s] ALL OK — {summary}", flush=True)
            return 0

        if time.time() - last_print >= PRINT_INTERVAL_S:
            print(f"[t+{elapsed}s] {summary}", flush=True)
            last_print = time.time()

        if elapsed > TIMEOUT_S:
            print(f"[t+{elapsed}s] TIMEOUT — {summary}", flush=True)
            return 1

        time.sleep(POLL_INTERVAL_S)


if __name__ == "__main__":
    sys.exit(main())
