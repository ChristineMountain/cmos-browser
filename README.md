# CMOS Browser

A small web app for browsing the CMOS camera data under `/data`. You can browse
by night or object, filter by metadata, preview images with adjustable stretch,
read the full headers and telescope/weather metadata, and download the original
files.

**The data is only ever read.** The app never writes, moves or renames anything
in `/data` (which is also mounted read-only). Everything it creates stays in
this folder.

Everyone runs **their own copy** in **their own remote-desktop session** on the
server, so nobody depends on anyone else's session. The code lives on GitHub
(public, no data in it) and updates itself. Ratings and notes are shared with
the team through a **private** GitHub repo.

## Install (once per person)

You need: a login on the server's remote desktop, and a free
[GitHub account](https://github.com/signup) to share ratings and notes.

1. **Send the owner your GitHub username**, so they can invite you to the
   private ratings repo (see *For the owner* below). You can install before the
   invite arrives; sharing just starts once it's there.
2. In your **remote desktop on the server**, open a **Terminal** and paste:

   ```bash
   bash <(curl -fsSL https://raw.githubusercontent.com/ChristineMountain/cmos-browser/main/install.sh)
   ```

   It takes about 5 minutes the first time. When it asks you to sign in to
   GitHub, it shows a code and opens a page in Firefox: paste the code there
   and click **Authorize**. It accepts the invitation to the ratings repo for
   you.
3. Double-click **CMOS Browser** on your desktop. If the desktop asks whether to
   trust the launcher, choose *Launch Anyway* / *Mark as trusted*.

Running the installer again is safe: it finishes or repairs an install and keeps
your ratings and notes. Run it again after you get the invite, if you installed
before.

## Every day

Log in to the remote desktop and double-click **CMOS Browser**. That's it:
it fetches the latest version from GitHub, starts, and opens Firefox at
**http://localhost:8010/**. It also starts by itself when you log in.

The top bar shows who you are and whether sharing works, e.g.
**👤 alice · synced 2 min ago**. Click it to sync right away. It turns red if
the last sync failed; hover over it to see why.

## Ratings, notes and collections

- **Ratings and notes are yours**, saved under your GitHub name. They are
  shared automatically (a few seconds after you change something, and every
  2 minutes) through the private repo `ChristineMountain/cmos-ratings`, one
  file per person (`ratings/<name>.json`). Each exposure's page shows
  everyone else's under **Others**.
- **Collections stay on your copy**. They are not shared.
- Everything is saved on your copy first, so the app works fine offline or if
  GitHub is down; it catches up later.
- **Everyone's ratings and notes as a spreadsheet:** open
  http://localhost:8010/api/annotations/export.csv (one row per person per
  exposure).

## Sharing links

The **Share** button copies a link to what you're looking at (a night, a
filtered search, or one exposure). Anyone with the app installed can open it in
their Firefox on the server. Links to a single exposure use its folder and name
(`#/x/20260914/object00026`), so they work in everyone's copy. Collection links
only work for you, because collections aren't shared.

## Updates

**Nobody reinstalls.** The app updates from GitHub every time it's opened from
the desktop icon, and at login (`./run.sh update` does it by hand). If a change
needs new Python packages (`environment.yml`), the update installs them. With
no network, the current version keeps running.

## For the owner

**Edit the code** in `~/cmos-browser`, test it (`./run.sh restart`, then reload
the page), and publish it:

```bash
cd ~/cmos-browser
git add -A && git commit -m "Describe the change"
git push
```

Everyone gets it the next time they open the app. **Test before you push**: a
broken version reaches everyone. To undo the last change for everyone:
`git revert HEAD && git push`.

`config.toml` is shared with everyone. Personal settings go in
`config.local.toml` (not in git), which overrides it.

**Invite a coworker** to share ratings (they need to have sent you their GitHub
username):

```bash
gh api -X PUT repos/ChristineMountain/cmos-ratings/collaborators/THEIR_USERNAME -f permission=push
```

or on github.com: *cmos-ratings → Settings → Collaborators → Add people*.
To stop sharing with someone, remove them there. Their file stays in the repo
until you delete it.

## New data shows up automatically

The server re-scans the data folders **every 15 minutes** at the lowest
priority. A scan that finds nothing new takes well under a second. New
exposures appear within about 15 minutes. An open page shows a *"New data has
been added — Reload"* note. Hover over the totals in the top bar to see when the
index was last updated. Set the interval with `auto_refresh_minutes` in
`config.toml` (0 turns it off; restart after changing).

You can still update by hand at any time, e.g. right after an observing run:

```bash
./run.sh index                    # scan everything in config.toml; only new/changed exposures are read
./run.sh index --only 20260915    # just one night
./run.sh index --rebuild          # re-read everything (rarely needed)
```

The server does not need a restart. Reload the page to see the new data.
A manual update and the automatic one never run at the same time. If one is
busy, the other waits for the next turn or tells you to try again.
A full scan of all nights takes about 35 seconds. Updates usually take a few
seconds. Indexing runs at the lowest CPU priority (`nice 19`) and low disk
priority.

## Opening an exposure in the port-8003 viewer

Every exposure has an **Open in viewer ↗** button (top right of its page, and a
*Viewer ↗* link on each gallery card and in the *Files* tab). It opens that exact
exposure in the existing image viewer in a new tab, for example
`http://172.18.0.1:8003/viewer/?ct=…&dir=slow%2F20260131&screen=viewer&path=slow%2F20260131%2Fobject00060`.
This is useful for raw `.hpkcmos-pack` exposures, which this app can't preview.
The link pattern is `viewer_url` / `viewer_root` in `config.toml`. If the viewer's
address changes, edit it there and restart (`./run.sh restart`). The viewer runs on the Docker host, outside everyone's sessions. The links use
`172.18.0.1:8003` (the host's address on the internal network), which works
from Firefox in any remote desktop on the server.

## Organizing: collections, ratings, notes

- **Collections** (sidebar → *Collections* → *+ New collection*) are named groups,
  like "Good M13 frames" or "Flats for June". An exposure can be in any number
  of collections. Click a collection to show only its exposures, sort by
  *Recently added*, or *Rename*, *Export file list* (a text file of the original
  file paths, handy for scripts) and *Delete*. Deleting a collection only removes
  the grouping. The exposures and files are untouched.
- **Select several at once:** in the gallery, click **Select**, click cards (or
  *Select all shown*), then *Add to collection…*, *Rate…*, or (inside a
  collection) *Remove from this collection*.
- **On an exposure's page** (top right): click the **stars** to rate (or press
  keys 1–5, and 0 to clear; click the same star again to clear it). Add it to
  collections or remove it with the chips, and type **notes**, which save
  automatically. Other people's ratings and notes appear below yours under
  **Others**.
- **Filter** by *My rating* or *Has my notes* in the sidebar, or sort by
  *Highest rated*. These use your own ratings and notes. The search box also
  searches your notes.

All of this lives in **`userdata.sqlite`** in your copy (your ratings and notes
are also on GitHub), separate from the index, so rebuilding the index never
affects it. It is keyed by folder and
exposure name, so it stays attached to the right exposure. **Back up
`userdata.sqlite` if your organizing matters to you** (`cp userdata.sqlite
userdata-backup.sqlite`). Nothing is ever written to `/data`.

## Adding more folders

Edit `include` in `config.toml`. Patterns are relative to `/data`. For example:

```toml
include = [
  "[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]",   # dated night folders (default)
  "someone/project/*/*",                          # add only after asking the owner
]
```

Then run `./run.sh index`. Removing a pattern and re-indexing removes those
exposures from the app.

## What's where

| File | Purpose |
|---|---|
| `config.toml` | Settings: data folders, port, cache limits |
| `index.py` | Builds the SQLite index (`index.sqlite`, about 3.5 MB) from headers and `*_meta.json` |
| `cmosdata.py` | Read-only file access: FITS/zstd/pack headers and pixels |
| `app.py` | Web server (FastAPI) |
| `static/` | The web page (plain HTML/CSS/JS) |
| `userdata.sqlite` | Your collections, plus everyone's ratings and notes (yours are backed up on GitHub) |
| `sync.py` | Shares ratings and notes through the private GitHub repo |
| `ratings-data/` | Your copy of the private ratings repo (made by `install.sh`) |
| `install.sh` | The installer (also safe to re-run as a repair) |
| `environment.yml` | Python packages the app needs |
| `config.local.toml` | Your personal settings, e.g. your GitHub name (not in git) |
| `edit_key.txt` | Private key that unlocks editing in a browser (`./run.sh editlink`) |
| `cache/thumbs/` | Gallery thumbnails (WebP, about 5–70 KB each) |
| `run.sh` | start / stop / restart / status / index / update / open |
| `server.log` | Server errors, if any |
| `.env/` | The app's own Python environment (made by `install.sh`) |

## How it behaves on the shared server

- **Thumbnails** are made only when a card scrolls into view, at most two at a
  time. Each reads frame 0 of each sensor (about 1 s). They are cached on disk
  with a **200 MB cap**: the oldest are deleted first. Nothing is written if free
  disk space drops below **500 MB**. Both limits are in `config.toml`. You can
  delete `cache/thumbs/*` at any time.
- **Previews** in the viewer are binned (4×4 or 8×8 by default) and sent to the
  browser once. Stretch and levels are then applied in the browser, so sliders
  don't load the server. Recent previews are kept in memory only (at most 64 MB).
- The server runs at `nice 10` with at most two image reads at a time. Late
  frames in compressed `.fits.zst` files are refused, because they would need
  long decompression.

## Notes about the data

- An *exposure* is `objectNNNNN_meta.json` plus up to 6 sensor files
  `objectNNNNN_0 … _5` in FITS, `.fits.zst`, or raw `.hpkcmos-pack(.zst)`.
- **Raw `.hpkcmos-pack` files have no image preview** in this version. Their
  metadata is indexed and they can be downloaded.
- **Exposure time** comes from the FITS `EXPTIME` when available. Otherwise it is
  `NEXP × line time` (mode 10: 10 µs, mode 12: 33.3 µs), which matches `EXPTIME`
  exactly in the files checked. 2025 files used an older header in which
  `EXPTIME` held the NEXP count. This is handled.
- Times in `meta.json` are Arizona local time (UTC−7). The app shows UTC.
- **Filter names** are normalized for filtering only (`OG-515` → `OG515`,
  `DD051` → `DDO51`). The original value is always shown.
- **The mosaic** shows sensors 0–5 side by side in number order. The WCS headers
  do not give the true focal-plane layout.
- **Thumbnails** subtract each column's median so stars stand out. The viewer
  shows raw values unless you tick "Flatten columns". The data itself is never
  changed.
- Some files are not readable by every account (many June 2026 nights). The
  app marks them "no access". Ask the data owner if you need them.

## Troubleshooting

- *"Port 8010 is in use"*: another program has it. Put `port = 8011` in
  `config.local.toml` and `./run.sh restart`.
- *The top bar says "not shared"*: GitHub isn't set up for this copy. Run the
  installer again.
- *It says "not synced" (red)*: hover over it for the reason. Usually you
  haven't been invited to `cmos-ratings` yet, or the network is down.
- *"Couldn't update"*: you changed files in `~/cmos-browser` yourself. Run
  `git -C ~/cmos-browser status` to see which, or re-run the installer to go
  back to the official version.
- *Page loads but is empty*: run `./run.sh index` first.
- *Something broke*: check `server.log`, then `./run.sh restart`.
