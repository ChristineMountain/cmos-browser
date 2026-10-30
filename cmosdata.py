"""Read-only access to the CMOS data: config, file discovery, headers, pixels.

Nothing in this module ever writes to the data directories. Files are only
opened with mode 'rb'.
"""
import compression.zstd as zstd
import glob
import json
import os
import re
import struct
import tomllib
from datetime import datetime, timedelta

import numpy as np
from astropy.io import fits

PROJECT_DIR = os.path.dirname(os.path.abspath(__file__))

# <prefix>_<sensor>.<ext>  e.g. object00012_3.fits.zst
FILE_RE = re.compile(r"^(?P<prefix>.+)_(?P<sensor>\d+)\.(?P<ext>(?:fits|hpkcmos-pack)[\w.\-]*)$")
META_SUFFIX = "_meta.json"
NIGHT_RE = re.compile(r"(?:^|/)(\d{8})(?:/|$)")


def lower_priority(niceness):
    """Be a good neighbour on the shared server: lower CPU and disk priority."""
    try:
        os.setpriority(os.PRIO_PROCESS, 0, max(niceness, os.getpriority(os.PRIO_PROCESS, 0)))
    except OSError:
        pass
    try:  # ioprio_set(IOPRIO_WHO_PROCESS, self, best-effort class, lowest level 7)
        import ctypes, platform
        nr = {"x86_64": 251, "aarch64": 30}.get(platform.machine())
        if nr:
            ctypes.CDLL(None, use_errno=True).syscall(nr, 1, 0, (2 << 13) | 7)
    except Exception:
        pass


def load_config():
    with open(os.path.join(PROJECT_DIR, "config.toml"), "rb") as f:
        cfg = tomllib.load(f)
    # Personal settings (written by install.sh, never committed) override config.toml.
    local = os.path.join(PROJECT_DIR, "config.local.toml")
    if os.path.exists(local):
        with open(local, "rb") as f:
            cfg.update(tomllib.load(f))
    cfg.setdefault("user_db", "userdata.sqlite")
    cfg.setdefault("auto_refresh_minutes", 15)
    cfg.setdefault("viewer_url", "")
    cfg.setdefault("viewer_root", "slow")
    cfg.setdefault("viewer_host_inside", "172.18.0.1:8003")
    cfg.setdefault("viewer_host_outside", "localhost:8003")
    cfg.setdefault("safe_sharing", True)
    cfg.setdefault("everyone_can_edit", False)
    for key in ("index_db", "cache_dir", "user_db"):
        if not os.path.isabs(cfg[key]):
            cfg[key] = os.path.join(PROJECT_DIR, cfg[key])
    return cfg


def file_format(ext):
    """Classify a file extension: 'fits', 'fits.zst', 'pack' or 'pack.zst'."""
    if "fits" in ext:
        return "fits.zst" if ext.endswith(".zst") else "fits"
    return "pack.zst" if ext.endswith(".zst") else "pack"


def is_fits(fmt):
    return fmt.startswith("fits")


# ---------------------------------------------------------------- discovery

def included_folders(cfg):
    """Folders (absolute paths) matching the configured include patterns."""
    root = cfg["data_root"]
    out = set()
    for pattern in cfg["include"]:
        for p in glob.glob(os.path.join(root, pattern)):
            if os.path.isdir(p) and not any(part.startswith(".") for part in os.path.relpath(p, root).split("/")):
                out.add(os.path.normpath(p))
    return sorted(out)


def scan_folder(folder):
    """Group the files in one folder into exposures (not recursive).

    Returns {prefix: {"meta": path or None, "files": [dict(sensor, path, format, size, mtime, readable)]}}
    """
    groups = {}
    try:
        entries = list(os.scandir(folder))
    except OSError:
        return groups
    for e in entries:
        if e.name.startswith(".") or not e.is_file(follow_symlinks=False):
            continue
        if e.name.endswith(META_SUFFIX):
            groups.setdefault(e.name[: -len(META_SUFFIX)], {"meta": None, "files": []})["meta"] = e.path
            continue
        m = FILE_RE.match(e.name)
        if not m:
            continue
        st = e.stat(follow_symlinks=False)
        g = groups.setdefault(m["prefix"], {"meta": None, "files": []})
        g["files"].append({
            "sensor": int(m["sensor"]),
            "path": e.path,
            "format": file_format(m["ext"]),
            "size": st.st_size,
            "mtime": st.st_mtime,
            "readable": os.access(e.path, os.R_OK),
        })
    return groups


def night_of(rel_folder):
    m = NIGHT_RE.search(rel_folder)
    return f"{m[1][:4]}-{m[1][4:6]}-{m[1][6:]}" if m else None


# ---------------------------------------------------------------- headers

def open_stream(path):
    """Open a file for sequential reading, transparently decompressing .zst."""
    return zstd.open(path, "rb") if path.endswith(".zst") else open(path, "rb")


def _read_fits_header_bytes(f):
    """Read 2880-byte blocks up to and including the END card."""
    chunks = []
    while True:
        blk = f.read(2880)
        if len(blk) < 2880:
            raise ValueError("truncated FITS header")
        chunks.append(blk)
        for i in range(0, 2880, 80):
            if blk[i:i + 8] == b"END     ":
                return b"".join(chunks)


def _data_bytes(h):
    naxis = h.get("NAXIS", 0)
    if naxis == 0:
        return 0
    n = abs(h["BITPIX"]) // 8
    for i in range(1, naxis + 1):
        n *= h[f"NAXIS{i}"]
    n = (n + h.get("PCOUNT", 0)) * h.get("GCOUNT", 1)
    return (n + 2879) // 2880 * 2880


def _skip(f, n):
    if n == 0:
        return
    if hasattr(f, "seekable") and f.seekable() and not isinstance(f, zstd.ZstdFile):
        f.seek(n, os.SEEK_CUR)
        return
    while n > 0:  # compressed stream: decompress and discard in chunks
        got = len(f.read(min(n, 8 << 20)))
        if got == 0:
            raise ValueError("truncated FITS data")
        n -= got


def _parse_header(raw):
    return fits.Header.fromstring(raw.decode("ascii", errors="replace"))


def read_fits_headers(path, n_ext=1):
    """Primary header plus the first `n_ext` extension headers, reading as little as possible."""
    out = []
    with open_stream(path) as f:
        for i in range(n_ext + 1):
            try:
                h = _parse_header(_read_fits_header_bytes(f))
            except ValueError:
                break
            out.append(h)
            if i < n_ext:
                _skip(f, _data_bytes(h))
    return out


def fits_frame_count(path):
    """Number of image frames stored in a plain (uncompressed) FITS file, from its
    size and the first frame's layout, or None when it can't be known cheaply."""
    if path.endswith(".zst"):
        return None
    with open(path, "rb") as f:
        p_raw = _read_fits_header_bytes(f)
        p_len = len(p_raw) + _data_bytes(_parse_header(p_raw))
        f.seek(p_len)
        e_raw = _read_fits_header_bytes(f)
        e_len = len(e_raw) + _data_bytes(_parse_header(e_raw))
    return (os.path.getsize(path) - p_len) // e_len if e_len else None


def _read_pack_header(f):
    (n,) = struct.unpack(">I", f.read(4))
    if n > 1 << 20:
        raise ValueError("unexpected pack header length")
    return json.loads(f.read(n)), 4 + n


def read_pack_header(path):
    """The JSON header at the start of a .hpkcmos-pack file (4-byte big-endian length + JSON)."""
    with open_stream(path) as f:
        return _read_pack_header(f)[0]


# Each pack frame is a 1024-byte JSON block (space padded), then the pixels:
# 16 bit: little-endian uint16; 12 bit: 8 extra bytes, then two pixels per
# 3 bytes, most significant nibble first. Rows are those selected by the ROI
# (one hex digit = 4 bits, one bit = 100 rows), 2560 pixels wide. The first 16
# pixels of row 0 hold the camera's frame header (the FITS conversion zeroes them).
# Checked pixel for pixel against FITS converted from the same captures.
PACK_FRAME_META = 1024


def _pack_layout(h):
    bpp = h["bit_per_pixel"]
    if bpp not in (12, 16):
        raise ValueError(f"unsupported pack bit_per_pixel {bpp}")
    npix = h["frame_size"] // 2  # frame_size counts 2 bytes per pixel even for 12-bit data
    roi = (h.get("capture_config") or {}).get("roi")
    rows = 100 * sum(bin(int(c, 16)).count("1") for c in roi) if roi else 0
    nx = npix // rows if rows and npix % rows == 0 else 2560
    ny = npix // nx
    pix_bytes = npix * 2 if bpp == 16 else npix * 3 // 2 + 8
    return bpp, ny, nx, PACK_FRAME_META + pix_bytes


def pack_frame_count(path):
    """Frames actually stored in an uncompressed pack file (None for .zst)."""
    if path.endswith(".zst"):
        return None
    with open(path, "rb") as f:
        h, start = _read_pack_header(f)
    return (os.path.getsize(path) - start) // _pack_layout(h)[3]


def stored_frame_count(path, fmt):
    return fits_frame_count(path) if is_fits(fmt) else pack_frame_count(path)


def read_pack_frame(path, frame=0):
    """Return (data as 2-D uint16 array, frame metadata dict) for frame `frame` (0-based)."""
    with open_stream(path) as f:
        h, _ = _read_pack_header(f)
        bpp, ny, nx, stride = _pack_layout(h)
        _skip(f, frame * stride)
        buf = f.read(stride)
    if len(buf) < stride:
        raise ValueError("truncated pack data")
    meta = json.loads(buf[:PACK_FRAME_META].rstrip(b" \0") or b"{}")
    pix = buf[PACK_FRAME_META:]
    if bpp == 16:
        a = np.frombuffer(pix, dtype="<u2").reshape(ny, nx).copy()
    else:
        b = np.frombuffer(pix, dtype=np.uint8, offset=8).reshape(-1, 3).astype(np.uint16)
        a = np.empty((b.shape[0], 2), dtype=np.uint16)
        a[:, 0] = (b[:, 0] << 4) | (b[:, 1] >> 4)
        a[:, 1] = ((b[:, 1] & 0xF) << 8) | b[:, 2]
        a = a.reshape(ny, nx)
    a[0, :16] = 0  # camera frame header, blanked as in the FITS files
    return a, meta


def header_to_dict(h):
    return {k: h[k] for k in h.keys() if k not in ("COMMENT", "HISTORY", "")}


# ---------------------------------------------------------------- metadata

def _sexa(s, hours):
    """'001320.13' -> degrees (RA in hours), '+313812.0' -> degrees."""
    try:
        s = str(s).strip()
        sign = -1 if s.startswith("-") else 1
        s = s.lstrip("+-")
        whole, _, frac = s.partition(".")
        whole = whole.zfill(6)
        a, b = int(whole[:-4]), int(whole[-4:-2])
        c = float(whole[-2:] + ("." + frac if frac else ""))
        v = sign * (a + b / 60 + c / 3600)
        return v * 15 if hours else v
    except (ValueError, TypeError):
        return None


# Exposure time per unit of NEXP for each readout MODE, used only when no
# FITS header (EXPTIME) is available, e.g. raw pack files. Checked against
# FITS headers (see README).
LINE_TIME = {"10": 1.0e-5, "12": 1.0 / 30000}


def _norm_filter(f):
    if not f:
        return None
    k = re.sub(r"[\s\-_]", "", str(f)).upper()
    if len(k) == 1:  # SDSS-style g, r, i stay lowercase
        return k.lower()
    return {"DD051": "DDO51", "DD0515": "DDO51"}.get(k, k)


def summarize(rel_folder, prefix, group, cfg):
    """Build one index row (dict) for an exposure from meta.json + one file header."""
    row = {
        "folder": rel_folder, "prefix": prefix, "night": night_of(rel_folder),
        "object": None, "filter": None, "exptime": None, "exptime_src": None,
        "nexp": None, "n_frames": None, "mode": None, "gain": None, "gain_code": None,
        "offset": None, "start_local": None, "start_utc": None, "ra": None, "dec": None,
        "el": None, "az": None, "airmass": None, "outside_temp": None, "humidity": None,
        "wind": None, "sensor_temp": None, "note": None, "error": None,
    }
    errors = []
    meta = None
    if group["meta"]:
        try:
            with open(group["meta"], "rb") as f:
                meta = json.load(f)
        except (OSError, ValueError) as e:
            errors.append(f"meta.json: {e}")
    if meta:
        cc = meta.get("capture_config") or {}
        fh = cc.get("fits_headers") or {}
        # Old (2025) captures called the NEXP count "exptime".
        row.update(object=fh.get("OBJECT"), filter=fh.get("FILTER"), nexp=cc.get("nexp", cc.get("exptime")),
                   n_frames=cc.get("n_frames"), mode=cc.get("mode"), gain_code=cc.get("gain_code"),
                   offset=cc.get("offset"), start_local=meta.get("start_time"))
        row["note"] = (meta.get("metanote") or None) and str(meta.get("metanote"))
        envs = meta.get("tel_envs") or []
        if envs:
            e0 = envs[0] or {}
            ts = e0.get("tel_status") or {}
            row.update(ra=_sexa(ts.get("ra"), True), dec=_sexa(ts.get("dec"), False),
                       el=ts.get("el"), az=ts.get("az"), airmass=ts.get("secz"))
            de = e0.get("dome_env") or {}
            row.update(outside_temp=de.get("outside_temp_c"), humidity=de.get("outside_humidity"))
            row["wind"] = (e0.get("weather") or {}).get("windSpd")

    # One file header for what meta.json lacks (FITS preferred: it has EXPTIME).
    files = sorted((f for f in group["files"] if f["readable"]),
                   key=lambda f: (not is_fits(f["format"]), f["format"].endswith(".zst"), f["sensor"]))
    for f in files[:1]:
        try:
            if is_fits(f["format"]):
                hs = read_fits_headers(f["path"], n_ext=1)
                p = hs[0]
                if "NEXP" in p:
                    row["exptime"], row["exptime_src"] = p.get("EXPTIME"), "header" if p.get("EXPTIME") is not None else None
                    row["gain"] = p.get("GAIN")
                else:  # old (2025) format: EXPTIME holds the NEXP count, GAIN the gain code
                    if row["nexp"] is None:
                        row["nexp"] = p.get("EXPTIME")
                    if row["gain_code"] is None:
                        row["gain_code"] = p.get("GAIN")
                for k, hk in (("object", "OBJECT"), ("filter", "FILTER"), ("nexp", "NEXP"),
                              ("n_frames", "N_FRAMES"), ("mode", "MODE"), ("gain_code", "GAINCODE"), ("offset", "OFFSET")):
                    if row[k] is None and p.get(hk) is not None:
                        row[k] = p.get(hk).strip() if isinstance(p.get(hk), str) else p.get(hk)
                if len(hs) > 1:
                    row["sensor_temp"] = hs[1].get("sensor_temperature")
                    if row["ra"] is None and hs[1].get("CRVAL1") is not None:
                        row["ra"], row["dec"] = hs[1].get("CRVAL1"), hs[1].get("CRVAL2")
            else:
                ph = read_pack_header(f["path"])
                cc = ph.get("capture_config") or {}
                fh = cc.get("fits_headers") or {}
                for k, v in (("object", fh.get("OBJECT")), ("filter", fh.get("FILTER")), ("nexp", cc.get("nexp")),
                             ("n_frames", ph.get("n_frames") or cc.get("n_frames")), ("mode", cc.get("mode")),
                             ("gain_code", cc.get("gain_code")), ("offset", cc.get("offset"))):
                    if row[k] is None and v is not None:
                        row[k] = v
                if row["start_local"] is None and ph.get("timestamp"):
                    row["start_utc"] = ph["timestamp"]  # pack timestamp is UTC
        except Exception as e:  # unreadable/odd file: index what we can
            errors.append(f"{os.path.basename(f['path'])}: {e}")

    if row["mode"] is not None:
        row["mode"] = str(row["mode"]).strip()
    if row["exptime"] is None and row["nexp"] and row["mode"] in LINE_TIME:
        row["exptime"], row["exptime_src"] = row["nexp"] * LINE_TIME[row["mode"]], "derived"
    if row["start_local"] and not row["start_utc"]:
        try:
            t = datetime.fromisoformat(row["start_local"]) - timedelta(hours=cfg["local_utc_offset_hours"])
            row["start_utc"] = t.isoformat(timespec="seconds")
        except ValueError:
            pass
    if isinstance(row["object"], str):
        row["object"] = row["object"].strip() or None
    row["filter_norm"] = _norm_filter(row["filter"])
    row["object_key"] = row["object"].lower() if row["object"] else None
    row["error"] = "; ".join(errors) or None
    return row


# ---------------------------------------------------------------- pixels

def read_fits_frame(path, frame=0):
    """Return (data as 2-D array, extension header) for image extension `frame` (0-based)."""
    with open_stream(path) as f:
        h = _parse_header(_read_fits_header_bytes(f))
        _skip(f, _data_bytes(h))
        i = 0
        while True:
            h = _parse_header(_read_fits_header_bytes(f))
            if h.get("NAXIS", 0) >= 2:
                if i == frame:
                    break
                i += 1
            _skip(f, _data_bytes(h))
        bitpix = h["BITPIX"]
        dtype = {8: ">u1", 16: ">i2", 32: ">i4", 64: ">i8", -32: ">f4", -64: ">f8"}[bitpix]
        ny, nx = h["NAXIS2"], h["NAXIS1"]
        nbytes = ny * nx * abs(bitpix) // 8
        buf = f.read(nbytes)
        if len(buf) < nbytes:
            raise ValueError("truncated image data")
    a = np.frombuffer(buf, dtype=dtype).reshape(ny, nx)
    bscale, bzero = h.get("BSCALE", 1), h.get("BZERO", 0)
    if bscale != 1 or bzero != 0:
        a = a.astype(np.float32) * bscale + bzero
    return a, h


def read_frame(path, fmt, frame=0):
    """Pixels of one frame from a FITS or raw pack file: (2-D array, header)."""
    return read_fits_frame(path, frame) if is_fits(fmt) else read_pack_frame(path, frame)


def bin_image(a, b):
    """Block-average by an integer factor b (edges cropped). Returns float32."""
    if b <= 1:
        return a.astype(np.float32)
    ny, nx = a.shape[0] // b * b, a.shape[1] // b * b
    a = a[:ny, :nx]
    acc = np.int64 if a.dtype.kind in "iu" else np.float64
    return (a.reshape(ny // b, b, nx // b, b).sum(axis=(1, 3), dtype=acc) / (b * b)).astype(np.float32)


# Where each sensor sits on the sky, from the per-sensor WCS in the FITS headers
# (identical on every night that has one; raw pack files have no WCS). Shown as
# on the sky, north up and east left, like the CMOS Viewer: left to right
# 0, 3, 1, 4, 2, 5. Sensors 0-2 have row 0 at the top and x increasing to the
# right; sensors 3-5 are mounted rotated by 180 degrees. Neighbours are 2900
# pixels apart centre to centre, so there is a 340-pixel gap between them.
SKY_ORDER = [0, 3, 1, 4, 2, 5]
ROTATED_180 = {3, 4, 5}
SENSOR_GAP = 340


def mosaic(tiles, b):
    """Arrange binned sensor tiles into one image, as they sit on the sky.

    tiles: list of (sensor, binned array, ext header). Each array is in file
    order (row 0 first). Sensors not in SKY_ORDER go on the right, unrotated.
    Gaps are filled with NaN. Returns (image, [dict(sensor, x0, y0, w, h, bin,
    rot180)]) in binned pixels, y measured from the top of the image.
    """
    rank = {s: i for i, s in enumerate(SKY_ORDER)}
    tiles = sorted(tiles, key=lambda t: (rank.get(t[0], len(rank)), t[0]))
    gap = max(1, round(SENSOR_GAP / b)) if len(tiles) > 1 else 0
    h = max(t[1].shape[0] for t in tiles)
    w = sum(t[1].shape[1] for t in tiles) + gap * (len(tiles) - 1)
    img = np.full((h, w), np.nan, dtype=np.float32)
    layout, x = [], 0
    for s, a, _ in tiles:
        rot = s in ROTATED_180
        if rot:
            a = a[::-1, ::-1]
        y0 = h - a.shape[0] if rot else 0  # partial ROI frames: keep row 0 on its own edge
        img[y0: y0 + a.shape[0], x: x + a.shape[1]] = a
        layout.append({"sensor": s, "x0": x, "y0": y0, "w": a.shape[1], "h": a.shape[0], "bin": b, "rot180": rot})
        x += a.shape[1] + gap
    return img, layout
