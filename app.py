"""CMOS Browser web server (FastAPI). Read-only access to the data.

Start with ./run.sh start (see README).
"""
import csv
import getpass
import io
import json
import os
import re
import secrets
import shutil
import stat
import sqlite3
import threading
import time
import traceback
from collections import OrderedDict

import numpy as np
from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from PIL import Image
from pydantic import BaseModel, Field

import cmosdata as cd
import index as indexer
import sync

cd.lower_priority(10)  # before any worker threads exist, so they inherit it
CFG = cd.load_config()
STATIC = os.path.join(cd.PROJECT_DIR, "static")
THUMBS = os.path.join(CFG["cache_dir"], "thumbs")
os.makedirs(THUMBS, exist_ok=True)

# At most two heavy image reads at a time, whatever the browser asks for.
HEAVY = threading.Semaphore(2)

# ---- who may change collections/ratings/notes ------------------------------
# Everyone who can reach the app may view. Changes are allowed from inside this
# container (the owner's remote desktop) or with the private edit key, which the
# owner opens once per browser via `./run.sh editlink`.
KEY_FILE = os.path.join(cd.PROJECT_DIR, "edit_key.txt")
if not os.path.exists(KEY_FILE):
    with open(os.open(KEY_FILE, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w") as f:
        f.write(secrets.token_urlsafe(18))
with open(KEY_FILE) as f:
    EDIT_KEY = f.read().strip()


def is_local(request):
    return request.client is not None and request.client.host in ("127.0.0.1", "::1")


def is_owner(request):
    return is_local(request) or secrets.compare_digest(request.headers.get("X-Edit-Key", ""), EDIT_KEY)


# ---- who is this? --------------------------------------------------------------
# Everyone runs their own copy in their own session, so "you" is whoever installed
# this copy: their GitHub login (set by install.sh in config.local.toml), or the
# account name if they haven't connected GitHub.
ME = CFG.get("me") or getpass.getuser()


def current_user(request):
    return ME


def can_edit(request):
    # everyone_can_edit (config.toml): anyone who can open the app may change collections/ratings/notes.
    return CFG["everyone_can_edit"] or is_owner(request)


# ---- safe sharing ------------------------------------------------------------
# The app reads files as the owner's account. With safe_sharing on, viewers only
# get file contents (previews, headers, meta.json, downloads) for files that
# EVERY account on the server can read, so sharing never widens anyone's access.
# Checked live (folder results cached briefly), so permission changes apply at once.
_dir_cache = {}


def world_readable(path):
    try:
        if not os.stat(path).st_mode & stat.S_IROTH:
            return False
    except OSError:
        return False
    now = time.time()
    d = os.path.dirname(path)
    while d not in ("/", ""):
        ok, t = _dir_cache.get(d, (None, 0))
        if ok is None or now - t > 60:
            try:
                ok = bool(os.stat(d).st_mode & stat.S_IXOTH)
            except OSError:
                ok = False
            _dir_cache[d] = (ok, now)
        if not ok:
            return False
        d = os.path.dirname(d)
    return True


def restricted(request):
    """True when this visitor only gets files that every account can read."""
    return request is not None and CFG["safe_sharing"] and not is_owner(request)


def shared_ok(request, path):
    return not restricted(request) or world_readable(path)


def guard(request, path):
    if not shared_ok(request, path):
        raise HTTPException(403, "Not shared: this file isn't readable by every account on the server, "
                                 "so only the owner can open it here.")


def require_edit(request: Request):
    if not can_edit(request):
        raise HTTPException(403, "This copy of the app is view-only. Ask the owner if something should change.")


def require_user(request: Request):
    return current_user(request)

app = FastAPI(title="CMOS Browser", docs_url=None, redoc_url=None)
app.mount("/static", StaticFiles(directory=STATIC), name="static")


@app.middleware("http")
async def no_stale_frontend(request, call_next):
    """Make browsers re-check the page and its scripts, so updates show up after a reload."""
    response = await call_next(request)
    if request.url.path == "/" or request.url.path.startswith("/static/"):
        response.headers["Cache-Control"] = "no-cache"
    return response


USER_SCHEMA = """
CREATE TABLE IF NOT EXISTS collections (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  description TEXT, created REAL
);
CREATE TABLE IF NOT EXISTS collection_items (
  collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  folder TEXT NOT NULL, prefix TEXT NOT NULL, added REAL,
  PRIMARY KEY (collection_id, folder, prefix)
);
CREATE INDEX IF NOT EXISTS ix_items_exp ON collection_items(folder, prefix);
CREATE TABLE IF NOT EXISTS annotations (
  user TEXT NOT NULL, folder TEXT NOT NULL, prefix TEXT NOT NULL, rating INTEGER, note TEXT, updated REAL,
  verdict TEXT,  -- good / junk / unsure
  PRIMARY KEY (user, folder, prefix)
);
CREATE INDEX IF NOT EXISTS ix_ann_exp ON annotations(folder, prefix);
CREATE TABLE IF NOT EXISTS tags (
  user TEXT NOT NULL, folder TEXT NOT NULL, prefix TEXT NOT NULL, tag TEXT NOT NULL COLLATE NOCASE, added REAL,
  PRIMARY KEY (user, folder, prefix, tag)
);
CREATE INDEX IF NOT EXISTS ix_tags_exp ON tags(folder, prefix);
CREATE INDEX IF NOT EXISTS ix_tags_tag ON tags(tag);
"""
VERDICTS = ("good", "junk", "unsure")
EMPTY = "rating IS NULL AND note IS NULL AND verdict IS NULL"  # an annotation row with nothing left in it


def udb():
    """Read-write connection to the user's own database (collections, ratings, notes).

    Items are keyed by folder + exposure name, not index ids, so they survive
    any rebuild of the index.
    """
    con = sqlite3.connect(CFG["user_db"], timeout=30)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys=ON")
    return con


with udb() as _c:
    _c.execute("PRAGMA journal_mode=WAL")
    # Before ratings/notes were per person they had no user column: they become the owner's.
    if _c.execute("SELECT 1 FROM sqlite_master WHERE name='annotations'").fetchone() and \
            "user" not in [r[1] for r in _c.execute("PRAGMA table_info(annotations)")]:
        _c.execute("ALTER TABLE annotations RENAME TO annotations_old")
        _c.executescript(USER_SCHEMA)
        _c.execute("INSERT INTO annotations (user, folder, prefix, rating, note, updated) "
                   "SELECT ?, folder, prefix, rating, note, updated FROM annotations_old", (ME,))
        _c.execute("DROP TABLE annotations_old")
    _c.executescript(USER_SCHEMA)  # creates missing tables first (a new install has none)
    if "verdict" not in [r[1] for r in _c.execute("PRAGMA table_info(annotations)")]:
        _c.execute("ALTER TABLE annotations ADD COLUMN verdict TEXT")


def db():
    """Read-only connection to the index, with the user database attached as `u`."""
    con = sqlite3.connect(f"file:{CFG['index_db']}?mode=ro", uri=True, timeout=30)
    con.row_factory = sqlite3.Row
    con.execute("ATTACH DATABASE ? AS u", (f"file:{CFG['user_db']}?mode=ro",))
    return con


def rows(sql, params=()):
    with db() as con:
        return [dict(r) for r in con.execute(sql, params)]


def get_exposure(eid):
    r = rows("SELECT * FROM exposures WHERE id=?", (eid,))
    if not r:
        raise HTTPException(404, "exposure not found")
    return r[0]


def get_files(eid):
    return rows("SELECT * FROM files WHERE exposure_id=? ORDER BY sensor, format", (eid,))


def preview_files(eid, request=None):
    """One readable FITS file per sensor (plain FITS preferred over .zst).

    For a restricted visitor, an exposure only has previews if all of them are
    shared (a partial mosaic would be confusing)."""
    best = {}
    for f in get_files(eid):
        if f["readable"] and cd.is_fits(f["format"]):
            if f["sensor"] not in best or (best[f["sensor"]]["format"] == "fits.zst" and f["format"] == "fits"):
                best[f["sensor"]] = f
    out = [best[s] for s in sorted(best)]
    if out and restricted(request) and not all(world_readable(f["path"]) for f in out):
        return []
    return out


# ------------------------------------------------------------------ pages

@app.get("/", include_in_schema=False)
def index():
    return FileResponse(os.path.join(STATIC, "index.html"))


# ------------------------------------------------------------------ listing API

@app.get("/api/stats")
def stats(request: Request):
    r = rows("""SELECT count(*) AS exposures, count(DISTINCT night) AS nights,
                       count(DISTINCT object_key) AS objects, sum(total_bytes) AS bytes,
                       sum(n_fits > 0) AS with_fits, min(night) AS first, max(night) AS last
                FROM exposures""")[0]
    r["files"] = rows("SELECT count(*) AS n FROM files")[0]["n"]
    try:
        info = {x["key"]: x["value"] for x in rows("SELECT key, value FROM info")}
    except sqlite3.OperationalError:  # index built before this table existed
        info = {}
    r["last_indexed"] = float(info["last_indexed"]) if "last_indexed" in info else None
    r["auto_refresh_minutes"] = CFG["auto_refresh_minutes"]
    # The port-8003 viewer runs on the Docker host: from inside this container it is
    # at the host's bridge address, from a laptop it is localhost (via SSH tunnel).
    vhost = CFG["viewer_host_inside"] if is_local(request) else CFG["viewer_host_outside"]
    r["viewer_url"] = CFG["viewer_url"].replace("{host}", vhost)
    r["viewer_root"] = CFG["viewer_root"]
    r["can_edit"] = can_edit(request)
    r["user"] = current_user(request)
    r["sync"] = sync.status
    return r


@app.post("/api/sync")
def sync_now():
    """Share my ratings and notes and fetch everyone else's right away."""
    sync.sync_once(udb, ME)
    return sync.status


@app.get("/api/lookup")
def lookup(folder: str, prefix: str):
    """Exposure id from folder + name. Ids differ between people's copies, so shared links use names."""
    r = rows("SELECT id FROM exposures WHERE folder=? AND prefix=?", (folder, prefix))
    if not r:
        raise HTTPException(404, "That exposure isn't in your index (yet). Try ./run.sh index.")
    return r[0]


@app.get("/api/nights")
def nights():
    return rows("""SELECT night, count(*) AS n, sum(n_fits > 0) AS n_fits,
                          count(DISTINCT object_key) AS n_objects, sum(total_bytes) AS bytes,
                          min(start_utc) AS first, max(start_utc) AS last
                   FROM exposures WHERE night IS NOT NULL GROUP BY night ORDER BY night DESC""")


@app.get("/api/objects")
def objects():
    return rows("""SELECT object_key AS key,
                          (SELECT object FROM exposures e2 WHERE e2.object_key = e.object_key
                           GROUP BY object ORDER BY count(*) DESC LIMIT 1) AS name,
                          count(*) AS n, count(DISTINCT night) AS n_nights, sum(n_fits > 0) AS n_fits,
                          sum(exptime * coalesce(n_frames, 1)) AS total_time,
                          max(night) AS last_night
                   FROM exposures e GROUP BY object_key ORDER BY n DESC""")


@app.get("/api/filters")
def filters():
    return rows("SELECT filter_norm AS name, count(*) AS n FROM exposures GROUP BY filter_norm ORDER BY n DESC")


SORTS = {
    "newest": "e.start_utc DESC, e.id DESC", "oldest": "e.start_utc ASC, e.id ASC",
    "object": "e.object_key ASC, e.start_utc ASC", "exptime": "e.exptime DESC, e.start_utc DESC",
    "rating": "coalesce(a.rating, 0) DESC, e.start_utc DESC",
    "added": "ci_added DESC, e.start_utc DESC",
}
SEARCH_TERM = re.compile(r'\b(tag|verdict|night):(?:"([^"]*)"|(\S+))', re.I)


def clean_tag(t):
    """Tags are free text: trimmed, single spaces, no leading #, at most 60 characters."""
    return " ".join(str(t).lstrip("#").split())[:60]


IN_COLLECTION = "EXISTS (SELECT 1 FROM u.collection_items ci WHERE ci.collection_id = ? AND ci.folder = e.folder AND ci.prefix = e.prefix)"


@app.get("/api/exposures")
def exposures(
    request: Request, q: str | None = None, night: str | None = None, object: str | None = None,
    filter: str | None = None, date_from: str | None = None, date_to: str | None = None,
    exp_min: float | None = None, exp_max: float | None = None, mode: str | None = None,
    kind: str | None = Query(None, pattern="^(fits|raw)$"), sort: str = "newest",
    collection: int | None = None, rating: int | None = Query(None, ge=0, le=5),
    has_note: bool = False, tag: list[str] = Query([]),
    verdict: str | None = Query(None, pattern="^(good|junk|unsure|none|todo)$"),
    limit: int = Query(60, ge=1, le=500), offset: int = Query(0, ge=0),
):
    where, p = [], []
    # The search box understands tag:cloudy, tag:"satellite trail", verdict:junk and night:20260914.
    tags = list(tag)
    for key, quoted, plain in SEARCH_TERM.findall(q or ""):
        value = quoted or plain
        if key.lower() == "tag":
            tags.append(value)
        elif key.lower() == "verdict" and value.lower() in VERDICTS + ("none", "todo"):
            verdict = value.lower()
        elif key.lower() == "night":  # 20260914 or 2026-09-14
            v = value.replace("-", "")
            night = f"{v[:4]}-{v[4:6]}-{v[6:8]}" if len(v) == 8 and v.isdigit() else value
    q = SEARCH_TERM.sub(" ", q or "").strip()
    if q:
        where.append("(e.object LIKE ? OR e.prefix LIKE ? OR e.filter LIKE ? OR e.note LIKE ? OR a.note LIKE ? "
                     "OR EXISTS (SELECT 1 FROM u.tags t WHERE t.folder = e.folder AND t.prefix = e.prefix AND t.tag LIKE ?))")
        p += [f"%{q}%"] * 6
    for t in tags:
        where.append("EXISTS (SELECT 1 FROM u.tags t WHERE t.folder = e.folder AND t.prefix = e.prefix AND t.tag = ?)")
        p.append(clean_tag(t))
    if verdict in VERDICTS:  # anyone gave this verdict
        where.append("EXISTS (SELECT 1 FROM u.annotations x WHERE x.folder = e.folder AND x.prefix = e.prefix AND x.verdict = ?)")
        p.append(verdict)
    elif verdict == "none":  # nobody has judged it yet
        where.append("NOT EXISTS (SELECT 1 FROM u.annotations x WHERE x.folder = e.folder AND x.prefix = e.prefix AND x.verdict IS NOT NULL)")
    elif verdict == "todo":  # I haven't judged it yet
        where.append("a.verdict IS NULL")
    if night:
        where.append("e.night = ?"); p.append(night)
    if object is not None:
        if object == "":
            where.append("e.object_key IS NULL")
        else:
            where.append("e.object_key = ?"); p.append(object.lower())
    if filter:
        where.append("e.filter_norm = ?"); p.append(filter)
    if date_from:
        where.append("e.night >= ?"); p.append(date_from)
    if date_to:
        where.append("e.night <= ?"); p.append(date_to)
    if exp_min is not None:
        where.append("e.exptime >= ?"); p.append(exp_min)
    if exp_max is not None:
        where.append("e.exptime <= ?"); p.append(exp_max)
    if mode:
        where.append("e.mode = ?"); p.append(mode)
    if kind == "fits":
        where.append("e.n_fits > 0")
    elif kind == "raw":
        where.append("e.n_fits = 0")
    if collection is not None:
        where.append(IN_COLLECTION); p.append(collection)
    if rating:
        where.append("a.rating >= ?"); p.append(rating)
    if has_note:
        where.append("coalesce(a.note, '') != ''")
    w = ("WHERE " + " AND ".join(where)) if where else ""
    frm = "FROM exposures e LEFT JOIN u.annotations a ON a.folder = e.folder AND a.prefix = e.prefix AND a.user = ?"
    p = [current_user(request)] + p
    if sort == "added" and collection is None:
        sort = "newest"
    added = ("(SELECT ci.added FROM u.collection_items ci WHERE ci.collection_id = ? "
             "AND ci.folder = e.folder AND ci.prefix = e.prefix)") if sort == "added" else "NULL"
    total = rows(f"SELECT count(*) AS n {frm} {w}", p)[0]["n"]
    items = rows(f"""SELECT e.id, e.folder, e.prefix, e.night, e.object, e.filter, e.filter_norm, e.exptime,
                            e.exptime_src, e.nexp, e.n_frames, e.mode, e.start_utc, e.start_local, e.n_sensors,
                            e.n_fits, e.total_bytes, e.formats, e.signature, e.airmass, e.error, e.n_files,
                            (SELECT count(*) FROM files f WHERE f.exposure_id = e.id AND f.readable) AS n_readable,
                            a.rating, coalesce(a.note, '') != '' AS has_note, a.verdict,
                            (SELECT group_concat(tag, char(31)) FROM (SELECT DISTINCT t.tag FROM u.tags t
                               WHERE t.folder = e.folder AND t.prefix = e.prefix ORDER BY t.tag)) AS tags,
                            (SELECT group_concat(x.verdict, char(31)) FROM u.annotations x
                               WHERE x.folder = e.folder AND x.prefix = e.prefix AND x.verdict IS NOT NULL) AS verdicts,
                            (SELECT count(*) FROM u.collection_items ci WHERE ci.folder = e.folder AND ci.prefix = e.prefix) AS n_collections,
                            {added} AS ci_added
                     {frm} {w} ORDER BY {SORTS.get(sort, SORTS['newest'])} LIMIT ? OFFSET ?""",
                 ([collection] if sort == "added" else []) + p + [limit, offset])
    for it in items:
        it["tags"] = it["tags"].split("\x1f") if it["tags"] else []
        vs = it["verdicts"].split("\x1f") if it["verdicts"] else []
        it["verdicts"] = {v: vs.count(v) for v in VERDICTS if v in vs}
    if restricted(request):
        for it in items:
            it["preview_shared"] = bool(it["n_fits"]) and bool(preview_files(it["id"], request))
    return {"total": total, "items": items}


def user_info(e, user):
    """My rating, note, verdict and tags, everyone else's, and the collections for one exposure."""
    k = (e["folder"], e["prefix"])
    with udb() as con:
        people = {}
        for a in con.execute("SELECT user, rating, note, verdict FROM annotations WHERE folder=? AND prefix=? "
                             "ORDER BY updated DESC", k):
            people[a["user"]] = {"user": a["user"], "rating": a["rating"], "note": a["note"], "verdict": a["verdict"], "tags": []}
        for t in con.execute("SELECT user, tag FROM tags WHERE folder=? AND prefix=? ORDER BY added", k):
            people.setdefault(t["user"], {"user": t["user"], "rating": None, "note": None, "verdict": None, "tags": []})["tags"].append(t["tag"])
        cols = con.execute("""SELECT c.id, c.name FROM collections c JOIN collection_items ci ON ci.collection_id = c.id
                              WHERE ci.folder=? AND ci.prefix=? ORDER BY c.name""", k).fetchall()
    me = people.pop(user, {})
    return {"rating": me.get("rating"), "user_note": me.get("note"), "verdict": me.get("verdict"),
            "tags": me.get("tags", []), "others": list(people.values()), "collections": [dict(c) for c in cols]}


@app.get("/api/exposures/{eid}")
def exposure(eid: int, request: Request):
    e = get_exposure(eid)
    e["files"] = get_files(eid)
    for f in e["files"]:
        f["shared"] = bool(f["readable"]) and shared_ok(request, f["path"])
    e["restricted"] = restricted(request)
    pf = preview_files(eid, request)
    e["preview_sensors"] = [f["sensor"] for f in pf]
    e["fits_frames"] = None  # frames actually stored in the FITS files (may be < n_frames)
    if pf:
        try:
            e["fits_frames"] = cd.fits_frame_count(pf[0]["path"])
        except Exception:
            pass
    with db() as con:  # neighbours within the same folder, for prev/next
        prev = con.execute("SELECT id FROM exposures WHERE folder=? AND prefix<? ORDER BY prefix DESC LIMIT 1",
                           (e["folder"], e["prefix"])).fetchone()
        nxt = con.execute("SELECT id FROM exposures WHERE folder=? AND prefix>? ORDER BY prefix ASC LIMIT 1",
                          (e["folder"], e["prefix"])).fetchone()
    e["prev_id"], e["next_id"] = prev and prev[0], nxt and nxt[0]
    e.update(user_info(e, current_user(request)))
    return e


@app.get("/api/exposures/{eid}/meta")
def exposure_meta(eid: int, request: Request):
    e = get_exposure(eid)
    path = os.path.join(CFG["data_root"], e["folder"], e["prefix"] + cd.META_SUFFIX)
    if os.path.exists(path):
        guard(request, path)
    try:
        with open(path, "rb") as f:
            return json.loads(f.read(), parse_constant=lambda c: None)
    except FileNotFoundError:
        raise HTTPException(404, "no meta.json for this exposure")
    except (OSError, ValueError) as ex:
        raise HTTPException(500, f"cannot read meta.json: {ex}")


def get_file(fid):
    r = rows("SELECT * FROM files WHERE id=?", (fid,))
    if not r:
        raise HTTPException(404, "file not found")
    return r[0]


@app.get("/api/files/{fid}/header")
def file_header(fid: int, request: Request):
    f = get_file(fid)
    guard(request, f["path"])
    if not f["readable"]:
        raise HTTPException(403, "no read permission for this file")
    try:
        if cd.is_fits(f["format"]):
            hs = cd.read_fits_headers(f["path"], n_ext=1)
            return {"kind": "fits", "hdus": [
                {"name": "Primary" if i == 0 else "Frame 0 (HDU 1)",
                 "cards": [[c.keyword, str(c.value), c.comment] for c in h.cards]}
                for i, h in enumerate(hs)]}
        return {"kind": "pack", "json": cd.read_pack_header(f["path"])}
    except Exception as ex:
        raise HTTPException(500, f"cannot read header: {ex}")


@app.get("/api/files/{fid}/download")
def download(fid: int, request: Request):
    f = get_file(fid)
    guard(request, f["path"])
    if not f["readable"]:
        raise HTTPException(403, "no read permission for this file")
    return FileResponse(f["path"], filename=os.path.basename(f["path"]), media_type="application/octet-stream")


# ------------------------------------------------------------------ images

def load_sensor(f, frame, b):
    a, h = cd.read_fits_frame(f["path"], frame)
    return cd.bin_image(a, b), h


def stretch_u8(img):
    """Robust asinh stretch to 8-bit for thumbnails."""
    finite = img[np.isfinite(img)]
    sample = finite[:: max(1, finite.size // 200_000)]
    lo, hi = np.percentile(sample, [1, 99.8]) if sample.size else (0, 1)
    t = np.clip((img - lo) / max(hi - lo, 1e-6), 0, 1)
    t = np.arcsinh(t / 0.1) / np.arcsinh(1 / 0.1)
    t[~np.isfinite(img)] = 0
    return (t * 255).astype(np.uint8)


class ThumbCache:
    """WebP thumbnails on disk with a size cap and a free-space guard."""

    def __init__(self, folder, max_bytes, min_free):
        self.folder, self.max_bytes, self.min_free = folder, max_bytes, min_free
        self.lock = threading.Lock()

    def path(self, e):
        return os.path.join(self.folder, f"{e['id']}_{e['signature']}.webp")

    def get(self, e):
        p = self.path(e)
        try:
            with open(p, "rb") as f:
                data = f.read()
            os.utime(p)  # mark as recently used
            return data
        except FileNotFoundError:
            return None

    def put(self, e, data):
        with self.lock:
            if shutil.disk_usage(self.folder).free - len(data) < self.min_free:
                return  # disk nearly full: serve from memory only
            for old in os.listdir(self.folder):  # older versions of this exposure
                if old.startswith(f"{e['id']}_"):
                    os.remove(os.path.join(self.folder, old))
            tmp = self.path(e) + ".tmp"
            with open(tmp, "wb") as f:
                f.write(data)
            os.replace(tmp, self.path(e))
            self.trim()

    def usage(self):
        entries = [(x.stat().st_mtime, x.stat().st_size, x.path) for x in os.scandir(self.folder) if x.name.endswith(".webp")]
        return entries, sum(s for _, s, _ in entries)

    def trim(self):
        entries, total = self.usage()
        if total <= self.max_bytes:
            return
        for _, size, p in sorted(entries):  # oldest first, down to 90% of the cap
            os.remove(p)
            total -= size
            if total <= self.max_bytes * 0.9:
                break


THUMBS_CACHE = ThumbCache(THUMBS, CFG["cache_max_mb"] * 1_000_000, CFG["min_free_mb"] * 1_000_000)


@app.get("/api/exposures/{eid}/thumb.webp")
def thumb(eid: int, request: Request):
    e = get_exposure(eid)
    headers = {"Cache-Control": "public, max-age=86400"}
    if restricted(request) and not preview_files(eid, request):
        raise HTTPException(403, "Not shared: these files aren't readable by every account on the server.")
    data = THUMBS_CACHE.get(e)
    if data is None:
        files = preview_files(eid)
        if not files:
            raise HTTPException(404, "no FITS files to preview")
        with HEAVY:
            try:
                tiles = [(f["sensor"], *load_sensor(f, 0, 16)) for f in files]
            except Exception as ex:
                raise HTTPException(500, f"cannot read image: {ex}")
        # Quick-look only: remove each sensor's column pattern/gradient so stars stand out.
        tiles = [(s, a - np.median(a, axis=0, keepdims=True), h) for s, a, h in tiles]
        img, _ = cd.mosaic(tiles, 16)
        buf = io.BytesIO()
        Image.fromarray(stretch_u8(img)[::-1]).save(buf, "WEBP", quality=75, method=4)  # FITS y axis points up
        data = buf.getvalue()
        THUMBS_CACHE.put(e, data)
    return Response(data, media_type="image/webp", headers=headers)


@app.get("/api/cache")
def cache_info():
    _, total = THUMBS_CACHE.usage()
    return {"thumb_bytes": total, "cap_bytes": THUMBS_CACHE.max_bytes,
            "disk_free_bytes": shutil.disk_usage(THUMBS).free, "min_free_bytes": THUMBS_CACHE.min_free}


_PIX = OrderedDict()  # tiny in-memory cache of recent preview payloads
_PIX_LOCK = threading.Lock()


@app.get("/api/exposures/{eid}/pixels")
def pixels(eid: int, request: Request, sensor: str = "all", frame: int = Query(0, ge=0), bin: int | None = Query(None, ge=1, le=32)):
    """Binned pixel data for the in-browser viewer.

    Body: little-endian uint16, row-major, top row first (already flipped so
    north/up is at the top as in DS9). Code 0 = no data (gap); otherwise
    value = offset + (code - 1) / scale. Shape and layout are in the X-* headers.
    """
    e = get_exposure(eid)
    files = preview_files(eid, request)
    if sensor != "all":
        files = [f for f in files if str(f["sensor"]) == sensor]
    if not files:
        raise HTTPException(404, "no FITS data for this sensor")
    b = bin or (8 if sensor == "all" else 4)
    nframes = e["n_frames"] or 1
    if frame >= nframes:
        raise HTTPException(400, f"frame must be < {nframes}")
    key = (eid, e["signature"], sensor, frame, b)
    with _PIX_LOCK:
        if key in _PIX:
            _PIX.move_to_end(key)
            body, hdr = _PIX[key]
            return Response(body, media_type="application/octet-stream", headers=hdr)
    # Compressed files must be decompressed from the start up to the frame:
    # keep that bounded so one click can't tie up the shared server.
    n_zst = sum(f["format"] == "fits.zst" for f in files)
    if n_zst and (frame + 1) * n_zst > 60:
        raise HTTPException(400, f"frame {frame} of compressed (.zst) data is too slow to preview here; "
                                 "pick a single sensor or an earlier frame, or download the file")
    est = len(files) * 2560 * 10000 / (b * b)
    if est > 12_000_000:
        raise HTTPException(400, "too many pixels: choose a larger bin factor")
    with HEAVY:
        try:
            tiles = [(f["sensor"], *load_sensor(f, frame, b)) for f in files]
        except ValueError as ex:
            if "truncated" in str(ex):
                raise HTTPException(404, f"frame {frame} is not stored in this FITS file")
            raise HTTPException(500, f"cannot read image: {ex}")
        except Exception as ex:
            raise HTTPException(500, f"cannot read image: {ex}")
    img, layout = cd.mosaic(tiles, b)
    img = img[::-1]
    for t in layout:  # y is now measured from the top
        t["y0"] = img.shape[0] - t["y0"] - t["h"]
    finite = np.isfinite(img)
    lo, hi = (float(img[finite].min()), float(img[finite].max())) if finite.any() else (0.0, 1.0)
    scale = min(64.0, 65534.0 / max(hi - lo, 1e-6))
    code = np.zeros(img.shape, dtype="<u2")
    code[finite] = np.round((img[finite] - lo) * scale).astype(np.uint32) + 1
    body = code.tobytes()
    hdr = {"X-Width": str(img.shape[1]), "X-Height": str(img.shape[0]), "X-Offset": repr(lo),
           "X-Scale": repr(scale), "X-Bin": str(b), "X-Layout": json.dumps(layout),
           "Access-Control-Expose-Headers": "*"}
    with _PIX_LOCK:
        _PIX[key] = (body, hdr)
        while sum(len(v[0]) for v in _PIX.values()) > 64_000_000:
            _PIX.popitem(last=False)
    return Response(body, media_type="application/octet-stream", headers=hdr)


# ------------------------------------------------------------------ organizing (user database)
# Everything here writes only to userdata.sqlite in the project folder.

class CollectionIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str | None = Field(None, max_length=2000)


class CollectionPatch(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=120)
    description: str | None = Field(None, max_length=2000)


class ExposureIds(BaseModel):
    exposure_ids: list[int] = Field(min_length=1, max_length=5000)


class Annotation(BaseModel):
    rating: int | None = Field(None, ge=0, le=5)
    note: str | None = Field(None, max_length=20000)
    verdict: str | None = Field(None, pattern="^(good|junk|unsure|)$")  # "" clears it


class BulkRating(ExposureIds):
    rating: int = Field(ge=0, le=5)


class BulkVerdict(ExposureIds):
    verdict: str = Field(pattern="^(good|junk|unsure|)$")


class TagChange(BaseModel):
    add: list[str] = Field([], max_length=50)
    remove: list[str] = Field([], max_length=50)


class BulkTags(ExposureIds, TagChange):
    pass


def keys_for(ids):
    """(folder, prefix) for each exposure id that exists in the index."""
    out = []
    for i in range(0, len(ids), 500):
        chunk = ids[i:i + 500]
        out += [(r["folder"], r["prefix"]) for r in
                rows(f"SELECT folder, prefix FROM exposures WHERE id IN ({','.join('?' * len(chunk))})", chunk)]
    return out


def get_collection(con, cid):
    c = con.execute("SELECT * FROM collections WHERE id=?", (cid,)).fetchone()
    if not c:
        raise HTTPException(404, "collection not found")
    return c


@app.get("/api/collections")
def collections():
    with udb() as con:
        return [dict(r) for r in con.execute(
            """SELECT c.id, c.name, c.description, c.created, count(ci.prefix) AS n
               FROM collections c LEFT JOIN collection_items ci ON ci.collection_id = c.id
               GROUP BY c.id ORDER BY c.name COLLATE NOCASE""")]


@app.post("/api/collections", dependencies=[Depends(require_edit)])
def create_collection(body: CollectionIn):
    try:
        with udb() as con:
            cur = con.execute("INSERT INTO collections (name, description, created) VALUES (?,?,?)",
                              (body.name.strip(), body.description, time.time()))
            return {"id": cur.lastrowid, "name": body.name.strip()}
    except sqlite3.IntegrityError:
        raise HTTPException(409, f"a collection called '{body.name.strip()}' already exists")


@app.patch("/api/collections/{cid}", dependencies=[Depends(require_edit)])
def update_collection(cid: int, body: CollectionPatch):
    try:
        with udb() as con:
            get_collection(con, cid)
            if body.name is not None:
                con.execute("UPDATE collections SET name=? WHERE id=?", (body.name.strip(), cid))
            if body.description is not None:
                con.execute("UPDATE collections SET description=? WHERE id=?", (body.description, cid))
    except sqlite3.IntegrityError:
        raise HTTPException(409, "another collection already has that name")
    return {"ok": True}


@app.delete("/api/collections/{cid}", dependencies=[Depends(require_edit)])
def delete_collection(cid: int):
    """Deletes the collection only; the exposures (and the data) are untouched."""
    with udb() as con:
        get_collection(con, cid)
        con.execute("DELETE FROM collections WHERE id=?", (cid,))
    return {"ok": True}


@app.post("/api/collections/{cid}/add", dependencies=[Depends(require_edit)])
def add_to_collection(cid: int, body: ExposureIds):
    keys = keys_for(body.exposure_ids)
    now = time.time()
    with udb() as con:
        get_collection(con, cid)
        before = con.total_changes
        con.executemany("INSERT OR IGNORE INTO collection_items (collection_id, folder, prefix, added) VALUES (?,?,?,?)",
                        [(cid, f, p, now) for f, p in keys])
        return {"added": con.total_changes - before}


@app.post("/api/collections/{cid}/remove", dependencies=[Depends(require_edit)])
def remove_from_collection(cid: int, body: ExposureIds):
    keys = keys_for(body.exposure_ids)
    with udb() as con:
        get_collection(con, cid)
        before = con.total_changes
        con.executemany("DELETE FROM collection_items WHERE collection_id=? AND folder=? AND prefix=?",
                        [(cid, f, p) for f, p in keys])
        return {"removed": con.total_changes - before}


@app.get("/api/collections/{cid}/export.txt")
def export_collection(cid: int):
    """Plain-text list of the original file paths in a collection, for scripts and pipelines."""
    with udb() as con:
        c = get_collection(con, cid)
        items = con.execute("SELECT folder, prefix FROM collection_items WHERE collection_id=? ORDER BY folder, prefix",
                            (cid,)).fetchall()
    lines = [f"# Collection: {c['name']}", f"# {len(items)} exposures; one original file path per line", ""]
    with db() as con:
        for it in items:
            e = con.execute("SELECT id FROM exposures WHERE folder=? AND prefix=?", (it["folder"], it["prefix"])).fetchone()
            meta = os.path.join(CFG["data_root"], it["folder"], it["prefix"] + cd.META_SUFFIX)
            if not e:
                lines.append(f"# not in index any more: {it['folder']}/{it['prefix']}")
                continue
            if os.path.exists(meta):
                lines.append(meta)
            lines += [f["path"] for f in con.execute("SELECT path FROM files WHERE exposure_id=? ORDER BY sensor, format", (e["id"],))]
    safe = "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in c["name"])[:60] or "collection"
    return Response("\n".join(lines) + "\n", media_type="text/plain; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="{safe}.txt"'})


@app.put("/api/exposures/{eid}/annotation", dependencies=[Depends(require_edit)])
def set_annotation(eid: int, body: Annotation, user: str = Depends(require_user)):
    """Set this person's rating and/or note. Fields left out of the request are kept as they are."""
    e = get_exposure(eid)
    fields = body.model_dump(exclude_unset=True)
    k = (user, e["folder"], e["prefix"])
    with udb() as con:
        con.execute("INSERT OR IGNORE INTO annotations (user, folder, prefix, updated) VALUES (?,?,?,?)", k + (time.time(),))
        if "rating" in fields:
            con.execute("UPDATE annotations SET rating=?, updated=? WHERE user=? AND folder=? AND prefix=?",
                        (fields["rating"] or None, time.time()) + k)
        if "note" in fields:
            note = (fields["note"] or "").strip() or None
            con.execute("UPDATE annotations SET note=?, updated=? WHERE user=? AND folder=? AND prefix=?",
                        (note, time.time()) + k)
        if "verdict" in fields:
            con.execute("UPDATE annotations SET verdict=?, updated=? WHERE user=? AND folder=? AND prefix=?",
                        (fields["verdict"] or None, time.time()) + k)
        con.execute(f"DELETE FROM annotations WHERE {EMPTY} AND user=? AND folder=? AND prefix=?", k)
    sync.request_sync()
    return user_info(e, user)


@app.post("/api/annotations/rating", dependencies=[Depends(require_edit)])
def bulk_rating(body: BulkRating, user: str = Depends(require_user)):
    keys = keys_for(body.exposure_ids)
    now = time.time()
    with udb() as con:
        for f, p in keys:
            con.execute("INSERT OR IGNORE INTO annotations (user, folder, prefix, updated) VALUES (?,?,?,?)", (user, f, p, now))
            con.execute("UPDATE annotations SET rating=?, updated=? WHERE user=? AND folder=? AND prefix=?",
                        (body.rating or None, now, user, f, p))
        con.execute(f"DELETE FROM annotations WHERE {EMPTY} AND user=?", (user,))
    sync.request_sync()
    return {"updated": len(keys)}


@app.post("/api/annotations/verdict", dependencies=[Depends(require_edit)])
def bulk_verdict(body: BulkVerdict, user: str = Depends(require_user)):
    keys = keys_for(body.exposure_ids)
    now = time.time()
    with udb() as con:
        for f, p in keys:
            con.execute("INSERT OR IGNORE INTO annotations (user, folder, prefix, updated) VALUES (?,?,?,?)", (user, f, p, now))
            con.execute("UPDATE annotations SET verdict=?, updated=? WHERE user=? AND folder=? AND prefix=?",
                        (body.verdict or None, now, user, f, p))
        con.execute(f"DELETE FROM annotations WHERE {EMPTY} AND user=?", (user,))
    sync.request_sync()
    return {"updated": len(keys)}


def change_tags(con, user, keys, add, remove):
    now = time.time()
    for t in filter(None, map(clean_tag, add)):
        # reuse the spelling someone already used ("Cloudy" and "cloudy" are one tag)
        t = (con.execute("SELECT tag FROM tags WHERE tag = ? LIMIT 1", (t,)).fetchone() or [t])[0]
        con.executemany("INSERT OR IGNORE INTO tags (user, folder, prefix, tag, added) VALUES (?,?,?,?,?)",
                        [(user, f, p, t, now) for f, p in keys])
    for t in filter(None, map(clean_tag, remove)):
        con.executemany("DELETE FROM tags WHERE user=? AND folder=? AND prefix=? AND tag=?", [(user, f, p, t) for f, p in keys])


@app.put("/api/exposures/{eid}/tags", dependencies=[Depends(require_edit)])
def set_tags(eid: int, body: TagChange, user: str = Depends(require_user)):
    """Add and/or remove my tags on one exposure."""
    e = get_exposure(eid)
    with udb() as con:
        change_tags(con, user, [(e["folder"], e["prefix"])], body.add, body.remove)
    sync.request_sync()
    return user_info(e, user)


@app.post("/api/tags/bulk", dependencies=[Depends(require_edit)])
def bulk_tags(body: BulkTags, user: str = Depends(require_user)):
    keys = keys_for(body.exposure_ids)
    with udb() as con:
        change_tags(con, user, keys, body.add, body.remove)
    sync.request_sync()
    return {"updated": len(keys)}


@app.get("/api/tags")
def all_tags():
    """Every tag anyone has used, with how many exposures have it and who used it (for the sidebar and suggestions)."""
    with udb() as con:
        return [dict(r) for r in con.execute(
            """SELECT tag, count(DISTINCT folder || '/' || prefix) AS n, group_concat(DISTINCT user) AS people
               FROM tags GROUP BY tag COLLATE NOCASE ORDER BY n DESC, tag COLLATE NOCASE""")]


@app.get("/api/junk.txt")
def export_junk():
    """Files someone marked Junk, with who said what, for the data owner to review. The app never deletes anything."""
    with udb() as con:
        marks = con.execute("""SELECT folder, prefix,
                                      group_concat(CASE WHEN verdict='junk' THEN user END) AS junk,
                                      group_concat(CASE WHEN verdict='good' THEN user END) AS good,
                                      group_concat(CASE WHEN verdict='unsure' THEN user END) AS unsure
                               FROM annotations WHERE verdict IS NOT NULL GROUP BY folder, prefix
                               HAVING junk IS NOT NULL ORDER BY folder, prefix""").fetchall()
    disputed = sum(1 for m in marks if m["good"] or m["unsure"])
    lines = ["# Exposures marked Junk in CMOS Browser. Nothing has been deleted.",
             f"# {len(marks)} exposures ({disputed} where someone disagreed: check those first).",
             "# One original file path per line; '#' lines say who marked what.", ""]
    with db() as con:
        for m in marks:
            who = f"junk: {m['junk']}" + (f"; good: {m['good']}" if m["good"] else "") + (f"; unsure: {m['unsure']}" if m["unsure"] else "")
            lines.append(f"# {m['folder']}/{m['prefix']}  ({who})")
            e = con.execute("SELECT id FROM exposures WHERE folder=? AND prefix=?", (m["folder"], m["prefix"])).fetchone()
            meta = os.path.join(CFG["data_root"], m["folder"], m["prefix"] + cd.META_SUFFIX)
            if os.path.exists(meta):
                lines.append(meta)
            if e:
                lines += [f["path"] for f in con.execute("SELECT path FROM files WHERE exposure_id=? ORDER BY sensor, format", (e["id"],))]
    return Response("\n".join(lines) + "\n", media_type="text/plain; charset=utf-8",
                    headers={"Content-Disposition": 'attachment; filename="junk-files.txt"'})


@app.get("/api/annotations/export.csv")
def export_annotations():
    """Everyone's verdicts, ratings, tags and notes as a spreadsheet: one row per person per exposure."""
    out = {}
    with udb() as con:
        for a in con.execute("SELECT user, folder, prefix, rating, note, verdict, updated FROM annotations"):
            out[(a["folder"], a["prefix"], a["user"])] = dict(a, tags=[])
        for t in con.execute("SELECT user, folder, prefix, tag, added FROM tags ORDER BY added"):
            r = out.setdefault((t["folder"], t["prefix"], t["user"]), {"rating": None, "note": None, "verdict": None,
                                                                      "updated": t["added"], "tags": []})
            r["tags"].append(t["tag"])
            r["updated"] = max(r["updated"] or 0, t["added"] or 0)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["person", "folder", "exposure", "verdict", "rating", "tags", "note", "updated_utc"])
    for (folder, prefix, user), r in sorted(out.items()):
        w.writerow([user, folder, prefix, r["verdict"] or "", r["rating"] or "", "; ".join(r["tags"]), r["note"] or "",
                    time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime(r["updated"])) if r["updated"] else ""])
    return Response(buf.getvalue(), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": 'attachment; filename="ratings-and-notes.csv"'})


# ------------------------------------------------------------------ automatic index refresh

def auto_refresh():
    """Re-scan the data folders every `auto_refresh_minutes`, at the lowest priority."""
    minutes = CFG["auto_refresh_minutes"]
    cd.lower_priority(19)  # this thread only
    time.sleep(60)  # let the server settle first
    while True:
        try:
            st = indexer.update_index(CFG, log=lambda m: None)
            if st["new"] or st["updated"] or st["removed"]:
                print(time.strftime("%Y-%m-%d %H:%M:%S"), "auto-refresh:",
                      ", ".join(f"{k} {v}" for k, v in st.items() if k != "unchanged"), flush=True)
        except indexer.IndexBusy:
            pass  # a manual ./run.sh index is running; try again next time
        except Exception:
            print(time.strftime("%Y-%m-%d %H:%M:%S"), "auto-refresh failed:", flush=True)
            traceback.print_exc()
        time.sleep(minutes * 60)


if __name__ == "__main__":
    import uvicorn
    if CFG["auto_refresh_minutes"] > 0:
        threading.Thread(target=auto_refresh, name="auto-refresh", daemon=True).start()
    threading.Thread(target=sync.loop, args=(udb, ME), name="ratings-sync", daemon=True).start()
    uvicorn.run(app, host=CFG["host"], port=CFG["port"], log_level="warning")
