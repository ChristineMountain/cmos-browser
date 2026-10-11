"""Build or update the SQLite index of exposures. Reads the data, never writes it.

Usage:
  .venv/bin/python index.py                 # update everything in config.toml
  .venv/bin/python index.py --only 20260914 # just one folder (relative to data_root)
  .venv/bin/python index.py --rebuild       # re-read every exposure even if unchanged

Runs at low CPU/disk priority. Unchanged exposures are skipped, so re-running
after new data arrives only reads the new files.
"""
import argparse
import fcntl
import hashlib
import json
import os
import sqlite3
import sys
import time

import cmosdata as cd

SCHEMA = """
CREATE TABLE IF NOT EXISTS exposures (
  id INTEGER PRIMARY KEY,
  folder TEXT NOT NULL, prefix TEXT NOT NULL, night TEXT, signature TEXT,
  object TEXT, object_key TEXT, filter TEXT, filter_norm TEXT,
  exptime REAL, exptime_src TEXT, nexp INTEGER, n_frames INTEGER, mode TEXT,
  gain REAL, gain_code INTEGER, offset INTEGER,
  start_local TEXT, start_utc TEXT, ra REAL, dec REAL, el REAL, az REAL, airmass REAL,
  outside_temp REAL, humidity REAL, wind REAL, sensor_temp REAL, note TEXT,
  n_files INTEGER, n_sensors INTEGER, n_fits INTEGER, total_bytes INTEGER,
  formats TEXT, has_meta INTEGER, error TEXT, indexed_at REAL,
  UNIQUE(folder, prefix)
);
CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY,
  exposure_id INTEGER NOT NULL REFERENCES exposures(id) ON DELETE CASCADE,
  sensor INTEGER, path TEXT UNIQUE, format TEXT, size INTEGER, mtime REAL, readable INTEGER
);
CREATE INDEX IF NOT EXISTS ix_exp_night ON exposures(night);
CREATE INDEX IF NOT EXISTS ix_exp_object ON exposures(object_key);
CREATE INDEX IF NOT EXISTS ix_exp_start ON exposures(start_utc);
CREATE INDEX IF NOT EXISTS ix_files_exp ON files(exposure_id);
CREATE TABLE IF NOT EXISTS info (key TEXT PRIMARY KEY, value TEXT);
"""

COLUMNS = ["folder", "prefix", "night", "signature", "object", "object_key", "filter", "filter_norm",
           "exptime", "exptime_src", "nexp", "n_frames", "mode", "gain", "gain_code", "offset",
           "start_local", "start_utc", "ra", "dec", "el", "az", "airmass", "outside_temp", "humidity",
           "wind", "sensor_temp", "note", "n_files", "n_sensors", "n_fits", "total_bytes", "formats",
           "has_meta", "error", "indexed_at"]


def connect(path):
    db = sqlite3.connect(path, timeout=60)
    db.execute("PRAGMA foreign_keys=ON")
    db.execute("PRAGMA journal_mode=WAL")
    db.executescript(SCHEMA)
    return db


def signature(group):
    h = hashlib.sha1()
    parts = [(os.path.basename(f["path"]), f["size"], f["mtime"], f["readable"]) for f in group["files"]]
    if group["meta"]:
        st = os.stat(group["meta"])
        parts.append((os.path.basename(group["meta"]), st.st_size, st.st_mtime, True))
    for p in sorted(parts):
        h.update(repr(p).encode())
    return h.hexdigest()[:16]


class IndexBusy(Exception):
    """Another index update (manual or automatic) is already running."""


def update_index(cfg, only=None, rebuild=False, log=print):
    """Scan the configured folders and update the index. Returns a stats dict.

    Shared by `./run.sh index` and the server's automatic refresh. A lock file
    makes sure only one update runs at a time.
    """
    root = cfg["data_root"]
    if only:
        folders = [os.path.normpath(os.path.join(root, f)) for f in only]
        allowed = set(cd.included_folders(cfg))
        for f in folders:
            if f not in allowed:
                raise ValueError(f"{f} is not matched by 'include' in config.toml; add it there first.")
    else:
        folders = cd.included_folders(cfg)

    lock = open(cfg["index_db"] + ".lock", "w")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        lock.close()
        raise IndexBusy("an index update is already running")

    try:
        db = connect(cfg["index_db"])
        t0 = time.time()
        stats = {"new": 0, "updated": 0, "unchanged": 0, "removed": 0, "errors": 0}
        for i, folder in enumerate(folders, 1):
            rel = os.path.relpath(folder, root)
            groups = {p: g for p, g in cd.scan_folder(folder).items() if g["files"] or g["meta"]}
            existing = {p: (eid, sig) for eid, p, sig in
                        db.execute("SELECT id, prefix, signature FROM exposures WHERE folder=?", (rel,))}
            for prefix in sorted(groups):
                g = groups[prefix]
                sig = signature(g)
                if prefix in existing and existing[prefix][1] == sig and not rebuild:
                    stats["unchanged"] += 1
                    continue
                row = cd.summarize(rel, prefix, g, cfg)
                sensors = {f["sensor"] for f in g["files"]}
                row.update(signature=sig, n_files=len(g["files"]), n_sensors=len(sensors),
                           n_fits=len({f["sensor"] for f in g["files"] if cd.is_fits(f["format"]) and f["readable"]}),
                           total_bytes=sum(f["size"] for f in g["files"]),
                           formats=",".join(sorted({f["format"] for f in g["files"]})),
                           has_meta=int(bool(g["meta"])), indexed_at=time.time())
                stats["errors"] += bool(row["error"])
                with db:
                    if prefix in existing:
                        eid = existing[prefix][0]
                        db.execute(f"UPDATE exposures SET {', '.join(c + '=?' for c in COLUMNS)} WHERE id=?",
                                   [row[c] for c in COLUMNS] + [eid])
                        db.execute("DELETE FROM files WHERE exposure_id=?", (eid,))
                        stats["updated"] += 1
                    else:
                        cur = db.execute(f"INSERT INTO exposures ({', '.join(COLUMNS)}) VALUES ({', '.join('?' * len(COLUMNS))})",
                                         [row[c] for c in COLUMNS])
                        eid = cur.lastrowid
                        stats["new"] += 1
                    db.executemany("INSERT INTO files (exposure_id, sensor, path, format, size, mtime, readable) VALUES (?,?,?,?,?,?,?)",
                                   [(eid, f["sensor"], f["path"], f["format"], f["size"], f["mtime"], int(f["readable"]))
                                    for f in sorted(g["files"], key=lambda f: (f["sensor"], f["format"]))])
            gone = [eid for p, (eid, _) in existing.items() if p not in groups]
            with db:
                db.executemany("DELETE FROM exposures WHERE id=?", [(e,) for e in gone])
            stats["removed"] += len(gone)
            log(f"[{i}/{len(folders)}] {rel}: {len(groups)} exposures")

        if not only:  # folders dropped from config.toml (or deleted) leave the index
            keep = {os.path.relpath(f, root) for f in folders}
            stale = [f for (f,) in db.execute("SELECT DISTINCT folder FROM exposures") if f not in keep]
            with db:
                for f in stale:
                    stats["removed"] += db.execute("DELETE FROM exposures WHERE folder=?", (f,)).rowcount
        stats["seconds"] = round(time.time() - t0, 1)
        with db:
            db.execute("INSERT OR REPLACE INTO info VALUES ('last_indexed', ?)", (str(time.time()),))
            db.execute("INSERT OR REPLACE INTO info VALUES ('last_stats', ?)", (json.dumps(stats),))
        db.execute("PRAGMA wal_checkpoint(PASSIVE)")
        db.close()
        return stats
    finally:
        fcntl.flock(lock, fcntl.LOCK_UN)
        lock.close()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--only", action="append", help="index only this folder (relative to data_root); repeatable")
    ap.add_argument("--rebuild", action="store_true", help="re-read all exposures, even unchanged ones")
    args = ap.parse_args()

    cd.lower_priority(19)
    cfg = cd.load_config()
    try:
        stats = update_index(cfg, only=args.only, rebuild=args.rebuild, log=lambda m: print(m, flush=True))
    except IndexBusy:
        sys.exit("Another index update is running (perhaps the automatic refresh). Try again in a minute.")
    except ValueError as e:
        sys.exit(str(e))
    print(f"Done in {stats.pop('seconds')}s: " + ", ".join(f"{k} {v}" for k, v in stats.items()))
    print(f"Index: {cfg['index_db']} ({os.path.getsize(cfg['index_db']) / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
