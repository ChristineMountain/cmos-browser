"""Share ratings and notes through a private GitHub repo.

Each person's copy of the app keeps its own ratings and notes in userdata.sqlite
and mirrors them to <ratings repo>/ratings/<GitHub login>.json. Everyone else's
files are read back in, so each exposure shows what the others thought.
One file per person means two people saving at the same time never collide.

The repo is cloned once by install.sh into ./ratings-data. Without it (or
without network) the app works normally and simply doesn't share.
"""
import json
import os
import subprocess
import threading
import time

import cmosdata as cd

REPO_DIR = os.path.join(cd.PROJECT_DIR, "ratings-data")
FILES_DIR = os.path.join(REPO_DIR, "ratings")

_lock = threading.Lock()
_wake = threading.Event()
status = {"enabled": False, "last_ok": None, "error": None}


def git(*args, timeout=60):
    env = dict(os.environ, GIT_TERMINAL_PROMPT="0")
    r = subprocess.run(["git", "-C", REPO_DIR, *args], capture_output=True, text=True, timeout=timeout, env=env)
    if r.returncode:
        raise RuntimeError((r.stderr or r.stdout).strip().splitlines()[-1] if (r.stderr or r.stdout).strip() else f"git {args[0]} failed")
    return r.stdout


def enabled():
    return os.path.isdir(os.path.join(REPO_DIR, ".git"))


def _own_rows(con, me):
    return [dict(r) for r in con.execute(
        "SELECT folder, prefix, rating, note, updated FROM annotations WHERE user=? ORDER BY folder, prefix", (me,))]


def _write_own(con, me):
    os.makedirs(FILES_DIR, exist_ok=True)
    path = os.path.join(FILES_DIR, f"{me}.json")
    text = json.dumps({"person": me, "annotations": _own_rows(con, me)}, indent=1, ensure_ascii=False) + "\n"
    old = open(path, encoding="utf-8").read() if os.path.exists(path) else None
    if text != old:
        with open(path, "w", encoding="utf-8") as f:
            f.write(text)
    return text != old


def _read(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f).get("annotations", [])


def _replace_user(con, user, items):
    con.execute("DELETE FROM annotations WHERE user=?", (user,))
    con.executemany("INSERT OR REPLACE INTO annotations (user, folder, prefix, rating, note, updated) VALUES (?,?,?,?,?,?)",
                    [(user, a["folder"], a["prefix"], a.get("rating"), a.get("note"), a.get("updated")) for a in items])


def sync_once(udb, me):
    """Pull everyone's files, publish mine, read the others in. Safe to call any time."""
    if not enabled():
        status.update(enabled=False)
        return
    status["enabled"] = True
    with _lock:
        try:
            git("pull", "--rebase", "--quiet", timeout=60)
            with udb() as con:
                con.execute("CREATE TABLE IF NOT EXISTS sync_state (key TEXT PRIMARY KEY, value TEXT)")
                # The first time on this copy, start from what's already on GitHub
                # (e.g. after a reinstall), instead of overwriting it with nothing.
                if not con.execute("SELECT 1 FROM sync_state WHERE key='imported_own'").fetchone():
                    own = os.path.join(FILES_DIR, f"{me}.json")
                    if os.path.exists(own) and not _own_rows(con, me):
                        _replace_user(con, me, _read(own))
                    con.execute("INSERT INTO sync_state VALUES ('imported_own', '1')")
                changed = _write_own(con, me)
            if changed:
                git("add", os.path.join("ratings", f"{me}.json"))
                git("commit", "--quiet", "-m", f"Update {me}'s ratings and notes")
            if git("rev-list", "--count", "@{u}..HEAD").strip() != "0":
                try:
                    git("push", "--quiet", timeout=60)
                except RuntimeError:  # someone else pushed first: catch up and retry once
                    git("pull", "--rebase", "--quiet", timeout=60)
                    git("push", "--quiet", timeout=60)
            people = {f[:-5]: os.path.join(FILES_DIR, f) for f in os.listdir(FILES_DIR) if f.endswith(".json")}
            with udb() as con:
                for person, path in people.items():
                    if person != me:
                        _replace_user(con, person, _read(path))
                gone = [r[0] for r in con.execute("SELECT DISTINCT user FROM annotations")
                        if r[0] != me and r[0] not in people]
                for person in gone:
                    con.execute("DELETE FROM annotations WHERE user=?", (person,))
            status.update(last_ok=time.time(), error=None)
        except Exception as e:  # offline, GitHub down, no access yet…: try again next round
            status["error"] = str(e)[:300]


def request_sync():
    """Ask for a sync soon (after someone rates or writes a note)."""
    _wake.set()


def loop(udb, me, every_s=120):
    while True:
        sync_once(udb, me)
        if _wake.wait(every_s):
            time.sleep(5)  # gather a burst of edits into one commit
        _wake.clear()
