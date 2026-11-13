# CMOS Browser User Guide

This guide covers access, installation and day-to-day use of CMOS Browser. No
prior knowledge of the application is assumed. For configuration and
maintenance, see the [README](../README.md).

![Home screen](images/home.jpg)

## Contents

- [What CMOS Browser is](#what-cmos-browser-is)
- [Terms used in this guide](#terms-used-in-this-guide)
- [Your first session](#your-first-session)
- [Getting access](#getting-access)
- [Installation](#installation)
- [Starting the application](#starting-the-application)
- [Finding exposures](#finding-exposures)
- [Viewing an exposure](#viewing-an-exposure)
- [Annotations](#annotations)
- [Triage](#triage)
- [Editing multiple exposures](#editing-multiple-exposures)
- [Collections](#collections)
- [Sharing links](#sharing-links)
- [Downloads and exports](#downloads-and-exports)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Troubleshooting](#troubleshooting)

## What CMOS Browser is

Every night the telescope's CMOS camera records images, and they are stored on
a shared server: several terabytes of files, one folder per night. Looking
through those files by hand means opening them one at a time in separate
programs.

CMOS Browser is a website that runs on the server and shows all of this data in
one place. In Firefox you can:

- See every night of observations as a gallery of small preview images.
- Find what you need by object, filter, date or exposure time.
- Open any image, adjust its brightness and contrast, and zoom in.
- Read the technical details: FITS headers, telescope position and weather.
- Mark images as good or bad, add labels and notes, and see what your
  colleagues marked.
- Download the original files.

It only reads the data. Nothing you do in the application can change or delete
a data file.

## Terms used in this guide

| Term | Meaning |
|---|---|
| Night | One observing night. The data for each night is in a folder named by date, such as `20260914`. |
| Exposure | One image taken by the camera. It is made up of one file per sensor plus a `_meta.json` file with telescope and weather information. |
| Sensor | The camera has six image sensors side by side, numbered 0 to 5, so each exposure is six images that together cover the field of view. |
| Frame | Some exposures are a series of short images (frames) rather than a single one. |
| FITS | The standard file format for astronomical images. Some files are compressed (`.fits.zst`) or in the camera's raw format (`.hpkcmos-pack`). |
| Header | The text section of a FITS file that describes the image: exposure time, filter, pointing, and so on. |
| Filter | The color band the image was taken in, such as `r`, `g` or `Ha658`. |
| Stretch | How raw pixel values are mapped to brightness on screen. Astronomical images look black until they are stretched. |
| Annotation | Your verdict, tags, star rating and notes on an exposure. Annotations are shared with the team. |
| Verdict | Your judgment of an exposure: Good, Junk or Unsure. |
| Tag | A short label you attach to exposures, such as `cloudy` or `satellite trail`, so they can be found later. |

## Your first session

Once installed (see below), a typical first session looks like this:

1. Double-click the CMOS Browser icon on the desktop. Firefox opens the
   gallery.
2. In the sidebar on the lower left, click a night. The gallery shows the
   exposures from that night, newest first.
3. Click an exposure to open it. The six sensors are shown side by side.
4. Use the stretch controls to adjust brightness, and scroll to zoom.
5. If the image is good, click Good; if it is unusable, click Junk. Add a tag
   if something specific is visible, for example `satellite trail`.
6. Click the back arrow to return to the gallery.

The rest of this guide explains each step in detail.

## Getting access

CMOS Browser has no accounts of its own. You need:

1. A user account on the server, with remote desktop access. Ask a server
   administrator.
2. A GitHub account ([sign up](https://github.com/signup) if you don't have
   one). Send your username to the maintainer listed in the
   [README](../README.md#contacts), who will invite you to the shared ratings
   repository.

You can install before the invitation arrives. Your annotations are kept
locally and shared once you have access.

## Installation

1. Log in to your remote desktop on the server.
2. Open a terminal (Applications > Terminal Emulator) and run:

   ```bash
   bash <(curl -fsSL https://raw.githubusercontent.com/ChristineMountain/cmos-browser/main/install.sh)
   ```

3. When prompted to sign in to GitHub, the installer shows a one-time code and
   opens a page in Firefox. Enter the code and authorize the request.
4. Installation takes about five minutes. When it finishes, a CMOS Browser icon
   appears on the desktop.

If you installed before receiving the GitHub invitation, run the installer
again after accepting it. Invitations expire after seven days. Re-running the
installer is safe and keeps your annotations.

## Starting the application

Double-click the CMOS Browser icon on the desktop. The first time, the desktop
may ask whether to trust the launcher; confirm it.

The launcher updates the application, starts the server, and opens it in
Firefox. The server also starts automatically at login. Each user has their own
address (for example `http://localhost:8203/`); `~/cmos-browser/run.sh status`
prints yours.

The top bar contains the search field, the number of indexed exposures (hover
to see when the index was last updated), your sync status, a Share button, and
a light/dark theme toggle.

The sync status shows your GitHub username and the time of the last successful
sync. Click it to sync immediately. It is shown in red if the last sync failed;
hover over it for the error. "not shared" means the ratings repository is not
set up for your copy (see [Troubleshooting](#troubleshooting)).

New data is indexed automatically every 15 minutes. Open pages show a notice
when new exposures are available.

## Finding exposures

![Gallery filtered by object](images/gallery.jpg)

### Sidebar

The list in the lower left has four tabs:

- **Nights**: observing nights, newest first, with the number of objects,
  exposures and FITS files.
- **Objects**: target names.
- **Collections**: your collections (see [Collections](#collections)).
- **Tags**: all tags used by the team, with counts and the people who used
  them.

Selecting an entry filters the gallery. The field above the list filters the
list itself.

### Filters

<img src="images/filters.jpg" alt="Filter panel" width="250" align="right">

The filter panel narrows the gallery by band, night range, exposure time,
readout mode, data type, your rating, whether you have written a note, and
verdict. The verdict filter accepts Good, Junk or Unsure from anyone, "Not
judged by anyone", or "Not judged by me".

Active filters appear above the gallery and can be removed individually.
"Clear all filters" resets them. The sort order is selected at the top right
of the gallery.

Each card shows a thumbnail of all sensors, the filter, exposure time, start
time (UT), night and exposure number, followed by your rating, a note
indicator, the team's verdicts, tags, and the number of collections the
exposure belongs to. Verdict counts are highlighted when people disagree. The
Viewer link opens the exposure in the port-8003 image viewer.

<br clear="right">

### Search

![Search by tag and verdict](images/search.jpg)

The search field matches object names, filters, file names, tags and your own
notes. The following qualifiers can be combined with plain text:

| Qualifier | Example |
|---|---|
| `tag:` | `tag:cloudy`, `tag:"satellite trail"` |
| `verdict:` | `verdict:good`, `verdict:junk`, `verdict:unsure` |
| `night:` | `night:20260914` |

For example, `tag:"M33 set" verdict:good` returns the exposures tagged
"M33 set" that someone marked as good.

## Viewing an exposure

Select a card to open the exposure.

![Exposure view with stretch controls](images/exposure.jpg)

The header contains a back button, an "Open in viewer" link to the port-8003
viewer (which supports astrometry and catalogs), and buttons for the previous
and next exposure in the current list.

### Toolbar

| Control | Description |
|---|---|
| Sensor | Show all six sensors or a single sensor at higher resolution |
| Bin | Preview binning. 8x8 is fastest; 2x2 shows more detail. |
| Stretch | Intensity scaling |
| Colors | Gray scale or a color map |
| Flatten columns | Subtract the median of each column to suppress the column pattern (display only) |
| Stretch controls | Show the stretch panel |

Sensors are arranged as they are on the sky: 0, 3, 1, 4, 2, 5 from left to
right, with sensors 3 to 5 rotated by 180 degrees and the actual gaps between
them.

### Stretch controls

- **Apply auto stretch** sets black and white to median - factor x MAD and
  median + factor x MAD, as in the CMOS Viewer. The default factor is 5, and
  each exposure opens with the auto stretch applied.
- **Black, White, Gamma** can be set with the sliders, typed in, or adjusted by
  dragging the markers on the histogram. A gamma above 1 brightens mid-tones.
- **Invert** swaps black and white. **Reset** restores the defaults.
- **Re-stretch each frame** recomputes the auto stretch for every frame. Turn
  it off to keep fixed levels and compare brightness between frames.

All sensors share one tone scale, so their brightness is directly comparable.
The panel can be moved by its title bar and closed; press `S` to toggle it.

### Navigation

Scroll to zoom and drag to pan. The buttons in the lower left zoom out, fit the
image to the window (also on double-click), show it at 1:1, and zoom in. The
readout in the lower right shows the sensor, pixel coordinates and value under
the cursor; with binning, the value is the mean of the bin.

### Multi-frame exposures

![Frame controls](images/frames.jpg)

Exposures with more than one frame show a frame bar below the image. Drag the
slider to move through frames; only the frame where you stop is read. The
arrow buttons (or `[` and `]`) step one frame, and the play button (or `P`)
loops through the frames. A frame number can also be entered directly.

### Information tabs

<img src="images/header.jpg" alt="Header tab" width="300" align="right">

The panel on the right has four tabs:

- **Summary**: object, filter, start time (UTC and local), exposure time,
  frames, readout mode, gain, pointing, airmass and weather.
- **Header**: the FITS header of each sensor file, with a keyword filter.
- **Telescope & weather**: the contents of `*_meta.json`, including capture
  settings, telescope samples taken during the exposure, and weather data.
- **Files**: the files of the exposure with format, size and a download link.

<br clear="right">

## Annotations

![Annotation panel](images/judge.jpg)

The panel at the top right of each exposure holds your annotations:

- **Verdict**: Good, Junk or Unsure. Each person has one verdict per exposure.
  Select the active verdict again to clear it. Junk is only a label; files are
  never deleted.
- **Tags**: free-text labels such as `satellite trail`, `cloudy` or
  `focus test`. Existing tags are suggested while typing to keep naming
  consistent. Tags are case-insensitive.
- **Rating**: one to five stars. Select the current rating again to clear it.
- **Collections**: add the exposure to a collection or remove it.
- **Notes**: free text, saved automatically.

Verdicts, tags, ratings and notes are synchronized with the team a few seconds
after each change and every two minutes. Other people's annotations are listed
under "Others" on the exposure page, and all tags are searchable. Changes are
saved locally first, so the application works offline and syncs later.

## Triage

![Triage mode](images/triage.jpg)

Triage steps through the exposures in the current view (a night, object or
search) that you have not judged yet. Start it with the Triage button above
the gallery. The header shows the number of remaining exposures.

| Key | Action |
|---|---|
| `G`, `J`, `U` | Mark Good, Junk or Unsure and go to the next exposure |
| `T` | Add a tag (`Enter` to confirm, `Esc` to cancel) |
| `Right arrow` | Skip |
| `1` to `5` | Rate |
| `Esc` | Exit triage |

## Editing multiple exposures

![Selection mode](images/select.jpg)

Click Select above the gallery, then select cards individually or with "Select
all shown". The toolbar applies an action to all selected exposures:

- Add to collection, or remove from the current collection
- Set a verdict
- Add a tag, or remove one by prefixing it with `-` (for example `-cloudy`)
- Set a rating

Click Done to leave selection mode.

## Collections

Collections are named groups of exposures, for example "Best M33 frames" or
"Flats for June". An exposure can belong to any number of collections.

- Create a collection under Collections > New collection in the sidebar.
- Add exposures from the exposure page or with selection mode.
- Open a collection from the sidebar to rename it, delete it, sort by date
  added, or export a list of the original file paths.

Deleting a collection does not affect the exposures. Collections are stored
only in your copy and are not shared.

## Sharing links

![Share dialog](images/share.jpg)

The Share button copies a link to the current view: a night, a filtered
search, or a single exposure. Recipients open the link in Firefox in their own
remote desktop, and it opens in their own copy. Links to collections only work
for the person who owns the collection.

## Downloads and exports

| What | Where |
|---|---|
| Original files | Files tab of an exposure |
| File paths of a collection | Open the collection, then Export file list |
| Exposures marked as Junk | Filter panel, Download the junk list |
| All annotations (CSV) | `http://localhost:PORT/api/annotations/export.csv` |

The junk list contains every exposure that someone marked as Junk, who marked
it, who disagreed, and the full file paths. Disagreements are listed first.
Hand it to the data owner for review; the application never deletes data.

The CSV export has one row per person and exposure, with verdict, rating, tags
and note.

## Keyboard shortcuts

On the exposure page:

| Key | Action |
|---|---|
| `G`, `J`, `U` | Set verdict Good, Junk or Unsure (again to clear) |
| `T` | Add a tag |
| `1` to `5`, `0` | Set rating, clear rating |
| `A` | Apply auto stretch |
| `S` | Toggle stretch controls |
| `[`, `]` | Previous or next frame |
| `P` | Play or pause frames |

See [Triage](#triage) for the triage keys.

The theme toggle in the top bar switches between light and dark mode.

![Dark mode](images/dark.jpg)

## Troubleshooting

| Problem | Solution |
|---|---|
| "CMOS Browser could not start" | The message gives the cause. If the port is in use, set a different `port` in `~/cmos-browser/config.local.toml` and start again. |
| The launcher does nothing | Re-run the installer. It repairs the installation and keeps your annotations. |
| Sync status shows "not shared" | Re-run the installer to set up GitHub. |
| Sync status is red | Hover over it for the error. Usually the ratings repository invitation is missing or not yet accepted. |
| An exposure shows "no access" | Your account cannot read those files. Contact the data owner. |
| The gallery is empty | Run `~/cmos-browser/run.sh index` and reload the page. |
| Unknown address | Run `~/cmos-browser/run.sh status`. |
| Other errors | Check `~/cmos-browser/server.log` and run `~/cmos-browser/run.sh restart`. If the problem persists, contact the maintainer. |
