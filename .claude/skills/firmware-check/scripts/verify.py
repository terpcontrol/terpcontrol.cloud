#!/usr/bin/env python3
"""Poll the fleet until every hardware type has its target firmware id installed
and the device is freshly back online, or timeout.

Usage:
    verify.py <state-file>

The state file is the one written by run-cycle.sh — one
"<hw_type> <firmware_id>" pair per line.

Reads credentials from environment:
    API_URL_EXTERNAL        - server URL
    AGENT_TESTING_USERNAME  - user login (an e-mail address)
    AGENT_TESTING_PASSWORD  - user password

Exits 0 on full success, 1 on timeout, 2 on bad input.
"""

import datetime
import json
import os
import sys
import time
import urllib.request

TIMEOUT_S = 15 * 60       # per cycle
RECENT_LASTSEEN_S = 60    # "back online" = last seen within this window
POLL_INTERVAL_S = 15
PRINT_INTERVAL_S = 25     # throttle status lines


def env(name: str) -> str:
    v = os.environ.get(name)
    if not v:
        print(f"missing env var: {name}", file=sys.stderr)
        sys.exit(2)
    return v


def instant(value) -> float:
    """Every instant on the wire is an ISO 8601 UTC string; absent is null."""
    if not value:
        return 0.0
    return datetime.datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()


def login(api: str, email: str, password: str) -> str:
    req = urllib.request.Request(
        api + "/sessions",
        method="POST",
        data=json.dumps({"email": email, "password": password}).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req) as r:
        return json.load(r)["userToken"]["token"]


def fleet(api: str, token: str):
    """Every device the account owns. Lists are paged, so the cursor is followed."""
    devices = []
    url = api + "/devices?limit=200"
    while url:
        req = urllib.request.Request(url, headers={"Authorization": "Bearer " + token})
        with urllib.request.urlopen(req) as r:
            page = json.load(r)
        devices += page["items"]
        cursor = page["nextCursor"]
        url = f"{api}/devices?limit=200&cursor={cursor}" if cursor else None
    return devices


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: verify.py <state-file>", file=sys.stderr)
        return 2

    api = env("API_URL_EXTERNAL").rstrip("/") + "/v1"
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

        now = time.time()
        statuses = []
        all_ok = True
        seen = set()
        for d in devices:
            hw = d.get("type")
            if hw not in targets:
                continue
            seen.add(hw)
            state = d.get("state") or {}
            fw = state.get("firmwareId") or ""
            last = instant(state.get("lastSeenAt"))
            age = int(now - last) if last else -1
            ok = fw == targets[hw] and last >= now - RECENT_LASTSEEN_S
            if not ok:
                all_ok = False
            statuses.append(f"{hw}={'OK' if ok else f'fw={fw[:8]} age={age}s'}")

        # A type nobody answered for is not a success: an empty fleet would
        # otherwise pass the cycle without a single device having updated.
        for hw in sorted(set(targets) - seen):
            statuses.append(f"{hw}=absent")
            all_ok = False

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
