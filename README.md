# CMOS Browser

A web app for browsing the CMOS camera data on the server: browse by night or
object, filter by metadata, preview images with adjustable stretch, read the
full headers and telescope/weather metadata, judge and tag photos with the
team, and download the original files.

![CMOS Browser](docs/images/exposure.jpg)

**📖 [User guide with screenshots](docs/USER_GUIDE.md)**: how to get access,
install, and use every part of the app.

**The data is only ever read.** The app never writes, moves or renames anything
in the data folder (`/storage/hdd/cmos` on the current server). Everything it
creates stays in the app's own folder.

Everyone runs **their own copy** in **their own remote-desktop session** on the
server, so nobody depends on anyone else's session. The code lives here on
GitHub (public, no data in it) and updates itself. Verdicts, tags, ratings and
notes are shared with the team through a **private** GitHub repo.

## Quick start

1. Get a **server login** from a server admin, and send your **GitHub
   username** to the maintainer (see [Who to ask](#who-to-ask)).
2. In your **remote desktop on the server**, open a **Terminal** and paste:

   ```bash
   bash <(curl -fsSL https://raw.githubusercontent.com/ChristineMountain/cmos-browser/main/install.sh)
   ```

   Sign in to GitHub when it asks (it shows a code; paste it into the page that
   opens in Firefox and click **Authorize**).
3. Double-click **CMOS Browser** on your desktop.

The [user guide](docs/USER_GUIDE.md) explains each step in detail.

## Who to ask

| For | Ask |
|---|---|
| A login on the server | A server admin (anyone in the server's `sudo` group) |
| An invitation to share ratings (the private `cmos-ratings` repo), or problems with the app | The maintainer: [@ChristineMountain](https://github.com/ChristineMountain) |

*Maintainers: keep this table up to date when the project changes hands (see
[Handing the project over](#handing-the-project-over)).*

## Updates

**Nobody reinstalls.** The app updates from GitHub every time it's opened from
the desktop icon, and at login, and every 5 minutes while it runs (`./run.sh update` does it by hand). If a change
needs new Python packages (`environment.yml`), the update installs them. With
no network, the current version keeps running.

## For the maintainer

### Adding a new person

1. They need a **server login** first (a server admin creates it).
2. They send you their **GitHub username**.
3. Invite them to the ratings repo: on github.com, open
   **cmos-ratings → Settings → Collaborators → Add people**, enter their
   username and give them **Write** access. Or in a terminal:

   ```bash
   gh api -X PUT repos/ChristineMountain/cmos-ratings/collaborators/THEIR_USERNAME -f permission=push
   ```

4. They run the installer (or run it again if they already installed). It
   accepts the invitation for them. **Invitations expire after 7 days**; invite
   them again if it ran out.

Nobody needs an invitation to `cmos-browser` itself: it's public. To stop
sharing with someone, remove them under *Collaborators*. Their file stays in the
repo until you delete it.

### Handing the project over

Only an **admin** of the GitHub repos can invite people and publish changes.
Before the current maintainer leaves:

1. **cmos-ratings → Settings → Collaborators**: set the new maintainer's role to
   **Admin**.
2. **cmos-browser → Settings → Collaborators → Add people**: add the new
   maintainer as **Admin**.
3. Update the [Who to ask](#who-to-ask) table above.

Both repos stay under the original owner's GitHub account, and everything keeps
working as long as that account exists. If it will be deleted, **transfer both
repos** to the new maintainer first (*Settings → General → Transfer
ownership*), then replace `ChristineMountain` with the new owner in
`install.sh`, `README.md` and `docs/USER_GUIDE.md`. Existing copies keep
updating, because GitHub redirects the old address.

### Changing the code

Edit the code in `~/cmos-browser`, test it (`./run.sh restart`, then reload
the page), and publish it:

```bash
cd ~/cmos-browser
git add -A && git commit -m "Describe the change"
git push
```

Everyone gets it within 5 minutes, or the next time they open the app. **Test
before you push**: a broken version reaches everyone. To undo the last change
for everyone: `git revert HEAD && git push`.

`config.toml` is shared with everyone. Personal settings go in
`config.local.toml` (not in git), which overrides it.

### Updating the screenshots in the user guide

The images in `docs/images/` are screenshots of a copy with demo ratings (so no
one's real notes end up in this public repo). Retake them the same way if the
app's look changes a lot.

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
This viewer can also do things this app doesn't, such as astrometry and catalogs.
The link pattern is `viewer_url` / `viewer_root` in `config.toml`. If the viewer's
address changes, edit it there and restart (`./run.sh restart`). The viewer runs on the Docker host, outside everyone's sessions. The links use
`172.18.0.1:8003` (the host's address on the internal network), which works
from Firefox in any remote desktop on the server.

## Adding more folders

Edit `include` in `config.toml`. Patterns are relative to the data folder (`data_root`). For example:

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
| `config.toml` | Shared settings: data folders, cache limits |
| `index.py` | Builds the SQLite index (`index.sqlite`, about 3.5 MB) from headers and `*_meta.json` |
| `cmosdata.py` | Read-only file access: FITS/zstd/pack headers and pixels |
| `app.py` | Web server (FastAPI) |
| `static/` | The web page (plain HTML/CSS/JS) |
| `userdata.sqlite` | Your collections, plus everyone's ratings and notes (yours are backed up on GitHub) |
| `sync.py` | Shares ratings and notes through the private GitHub repo |
| `ratings-data/` | Your copy of the private ratings repo (made by `install.sh`) |
| `install.sh` | The installer (also safe to re-run as a repair) |
| `environment.yml` | Python packages the app needs |
| `config.local.toml` | Your personal settings: your GitHub name and port (not in git) |
| `edit_key.txt` | Private key that unlocks editing in a browser (`./run.sh editlink`) |
| `cache/thumbs/` | Gallery thumbnails (WebP, about 5–70 KB each) |
| `run.sh` | start / stop / restart / status / index / update / open |
| `docs/` | The user guide and its screenshots |
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
  long decompression (both `.fits.zst` and `.hpkcmos-pack.zst`).

## Notes about the data

- An *exposure* is `objectNNNNN_meta.json` plus up to 6 sensor files
  `objectNNNNN_0 … _5` in FITS, `.fits.zst`, or raw `.hpkcmos-pack(.zst)`.
- **Raw `.hpkcmos-pack` files are previewed** just like FITS (FITS is used when
  both exist). The decoder (`read_pack_frame` in `cmosdata.py`) was checked pixel
  for pixel against FITS converted from the same captures. Sensors can store
  different numbers of frames; the frame slider follows the selected sensor.
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

See [Troubleshooting in the user guide](docs/USER_GUIDE.md#13-troubleshooting).
Also:

- *"Couldn't update"*: files in `~/cmos-browser` were changed by hand. Run
  `git -C ~/cmos-browser status` to see which, or run the installer again to go
  back to the official version.
- *Something broke*: check `server.log`, then `./run.sh restart`.
