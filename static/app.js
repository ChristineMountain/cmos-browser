"use strict";
// CMOS Browser front end: plain JS, no build step.

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

async function api(path) {
  const r = await fetch(path);
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error(j.detail || `${r.status} ${r.statusText}`);
  }
  return r.json();
}

// ------------------------------------------------------------------ formatting
const fmt = {
  exp(s) {
    if (s == null) return "—";
    if (s >= 1) return `${+s.toPrecision(4)} s`;
    if (s >= 1e-3) return `${+(s * 1e3).toPrecision(3)} ms`;
    return `${+(s * 1e6).toPrecision(3)} µs`;
  },
  bytes(b) {
    if (b == null) return "—";
    const u = ["B", "KB", "MB", "GB", "TB", "PB"];
    let i = 0;
    while (b >= 1000 && i < u.length - 1) { b /= 1000; i++; }
    return `${b >= 100 || i === 0 ? Math.round(b) : b.toFixed(1)} ${u[i]}`;
  },
  num: (n) => (n == null ? "—" : Number(n).toLocaleString()),
  time: (iso) => (iso ? iso.slice(11, 16) : "—"),
  dt: (iso) => (iso ? iso.replace("T", " ").slice(0, 19) : "—"),
  night(n) {
    if (!n) return "—";
    const d = new Date(n + "T12:00:00Z");
    return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  },
  sexa(deg, hours) {
    if (deg == null) return "—";
    let v = hours ? deg / 15 : deg;
    const sign = v < 0 ? "-" : hours ? "" : "+";
    v = Math.abs(v);
    const a = Math.floor(v), b = Math.floor((v - a) * 60), c = ((v - a) * 60 - b) * 60;
    const p = (x, n = 2) => String(x).padStart(n, "0");
    return `${sign}${p(a)}${hours ? "h" : "°"} ${p(b)}${hours ? "m" : "′"} ${c.toFixed(hours ? 2 : 1).padStart(hours ? 5 : 4, "0")}${hours ? "s" : "″"}`;
  },
  f1: (x, unit = "") => (x == null ? "—" : `${(+x).toFixed(1)}${unit}`),
};

const FILTER_COLORS = { g: "#2fa36b", r: "#d9534f", i: "#9b5de5", HA658: "#e83f6f", DDO51: "#2b9eb3", OG515: "#c98a1b" };
const filterBadge = (f) => f ? `<span class="badge f" style="background:${FILTER_COLORS[f] || "rgba(10,14,22,.75)"}">${esc(f)}</span>` : "";

// ------------------------------------------------------------------ URL state
// Gallery state lives in the URL hash (#/?night=…&object=…), detail in #/exp/<id>.
const KEYS = ["q", "night", "object", "collection", "tag", "verdict", "filter", "date_from", "date_to", "exp_min", "exp_max", "mode", "kind", "rating", "has_note", "sort"];
const VERDICT = { good: "✅ Good", junk: "🗑 Junk", unsure: "❔ Unsure" };
function parseHash() {
  const h = location.hash.slice(1) || "/";
  const [path, qs] = h.split("?");
  return { path, params: new URLSearchParams(qs || "") };
}
let galleryHash = "#/";
function setParams(updates) {
  const params = new URLSearchParams(galleryHash.split("?")[1] || "");
  for (const [k, v] of Object.entries(updates)) {
    if (v === null || v === undefined || v === "") params.delete(k); else params.set(k, v);
  }
  location.hash = "/?" + params.toString();
}

// ------------------------------------------------------------------ editing rights
// The owner unlocks editing in a browser once with the private link from
// `./run.sh editlink` (#/?key=…). The key stays in this browser's storage.
let editKey = "";
try { editKey = localStorage.getItem("editKey") || ""; } catch {}
{
  const { path, params } = parseHash();
  if (params.has("key")) {
    editKey = params.get("key");
    try { localStorage.setItem("editKey", editKey); } catch {}
    params.delete("key");
    history.replaceState(null, "", "#" + path + (params.toString() ? "?" + params : ""));
  }
}
let canEdit = false;
function editHeaders() { return editKey ? { "X-Edit-Key": editKey } : {}; }

// ------------------------------------------------------------------ top bar & theme
$("#themeBtn").onclick = () => {
  const root = document.documentElement;
  const sysDark = matchMedia("(prefers-color-scheme: dark)").matches;
  const isDark = root.dataset.theme ? root.dataset.theme === "dark" : sysDark;
  root.dataset.theme = isDark ? "light" : "dark";
  try { localStorage.setItem("theme", root.dataset.theme); } catch {}
};
$("#menuBtn").onclick = () => $("#sidebar").classList.toggle("open");

let seenIndexed = null, viewerCfg = { url: "", root: "" };
async function loadStats() {
  try {
    const s = await api("/api/stats");
    viewerCfg = { url: s.viewer_url || "", root: s.viewer_root || "" };
    canEdit = !!s.can_edit;
    renderSync(s);
    document.body.classList.toggle("readonly", !canEdit);
    $("#roBadge").hidden = canEdit;
    $("#dNote").readOnly = !canEdit;
    $("#dNote").placeholder = canEdit ? "Your notes on this exposure… (saved automatically)" : "No notes";
    $("#stats").textContent = `${fmt.num(s.exposures)} exposures · ${s.nights} nights · ${fmt.bytes(s.bytes)}`;
    const upd = s.last_indexed ? new Date(s.last_indexed * 1000).toLocaleString() : "unknown";
    $("#stats").title = `Index last updated: ${upd}` + (s.auto_refresh_minutes ? `\nChecks for new data every ${s.auto_refresh_minutes} min` : "");
    seenIndexed ??= s.exposures;
    if (s.exposures !== seenIndexed) $("#newData").hidden = false;
  } catch { /* stats are optional */ }
}
// The server re-scans the data on its own; tell the user when something new appears.
setInterval(loadStats, 5 * 60 * 1000);
$("#reloadBtn").onclick = () => location.reload();

// Link to the same exposure in the existing port-8003 viewer (pattern from config.toml).
function viewerUrl(e) {
  if (!viewerCfg.url) return null;
  const dir = [viewerCfg.root, e.folder].filter(Boolean).join("/");
  return viewerCfg.url
    .replaceAll("{ct}", Date.now())
    .replaceAll("{dir}", encodeURIComponent(dir))
    .replaceAll("{path}", encodeURIComponent(`${dir}/${e.prefix}`));
}

// ------------------------------------------------------------------ sidebar
let sideMode = "nights", nightsData = [], objectsData = [], collectionsData = [], tagsData = [];
$$(".sidebar .tab").forEach((t) => t.onclick = () => {
  sideMode = t.dataset.side;
  $$(".sidebar .tab").forEach((x) => x.classList.toggle("active", x === t));
  renderSide();
});
$("#sideFilter").oninput = () => renderSide();

async function loadSide() {
  [nightsData, objectsData] = await Promise.all([api("/api/nights"), api("/api/objects")]);
  await loadCollections();
  await loadTags();
  const filters = await api("/api/filters");
  $("#fFilter").innerHTML = `<option value="">Any</option>` +
    filters.filter((f) => f.name).map((f) => `<option value="${esc(f.name)}">${esc(f.name)} (${f.n})</option>`).join("");
  syncControls();
  renderSide();
  renderChips(new URLSearchParams(galleryHash.split("?")[1] || ""));  // names are known now
}

// Every tag anyone has used: the sidebar list and the suggestions while typing.
async function loadTags() {
  tagsData = await api("/api/tags");
  $("#tagList").innerHTML = tagsData.map((t) => `<option value="${esc(t.tag)}">`).join("");
  if (sideMode === "tags") renderSide();
}

async function loadCollections() {
  collectionsData = await api("/api/collections");
  const opts = collectionsData.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join("");
  const nw = `<option value="new">+ New collection…</option>`;
  $("#selAdd").innerHTML = `<option value="">Add to collection…</option>${opts}${nw}`;
  $("#dAddCol").innerHTML = `<option value="">+ Add to collection…</option>${opts}${nw}`;
}

function renderSide() {
  const params = new URLSearchParams(galleryHash.split("?")[1] || "");
  const term = $("#sideFilter").value.trim().toLowerCase();
  const ul = $("#sideList");
  $("#newColBtn").hidden = sideMode !== "collections";
  if (sideMode === "tags") {
    if (!tagsData.length) {
      ul.innerHTML = `<li class="hint">No tags yet.<br><br>Open a photo (or use <b>Triage</b>) and type a tag under the verdict buttons: anything that helps find it later, like <i>satellite trail</i> or <i>cloudy</i>.</li>`;
      return;
    }
    ul.innerHTML = tagsData.filter((t) => !term || t.tag.toLowerCase().includes(term)).map((t) =>
      `<li data-tag="${esc(t.tag)}" class="${params.get("tag")?.toLowerCase() === t.tag.toLowerCase() ? "active" : ""}">
        <span class="name">🏷 ${esc(t.tag)}</span><span class="n">${t.n}</span>
        <span class="sub">by ${esc(t.people.split(",").join(", "))}</span></li>`).join("");
    $$("li", ul).forEach((li) => li.onclick = () => {
      setParams({ tag: params.get("tag") === li.dataset.tag ? null : li.dataset.tag });
      $("#sidebar").classList.remove("open");
    });
    return;
  }
  if (sideMode === "collections") {
    const list = collectionsData.filter((c) => !term || c.name.toLowerCase().includes(term));
    if (!collectionsData.length) {
      ul.innerHTML = `<li class="hint">No collections yet.<br><br>Create one with the button above, then add exposures from the gallery (<b>Select</b>) or from an exposure's page.</li>`;
      return;
    }
    ul.innerHTML = list.map((c) => {
      const on = params.get("collection") === String(c.id);
      return `<li data-id="${c.id}" class="${on ? "active" : ""}">
        <span class="name">📁 ${esc(c.name)}</span><span class="n">${c.n}</span>
        ${c.description ? `<span class="sub">${esc(c.description)}</span>` : ""}
        ${on ? `<span class="acts"><button data-act="rename" class="edit-only">Rename</button><a href="/api/collections/${c.id}/export.txt" data-act="export" title="Text file listing the original file paths">Export file list</a><button data-act="delete" class="danger edit-only">Delete</button></span>` : ""}
      </li>`;
    }).join("");
    $$("li", ul).forEach((li) => li.onclick = (ev) => {
      const act = ev.target.dataset.act;
      const c = collectionsData.find((x) => String(x.id) === li.dataset.id);
      if (act === "export") return;
      if (act === "rename") return editCollection(c);
      if (act === "delete") return deleteCollection(c);
      setParams({ collection: params.get("collection") === li.dataset.id ? null : li.dataset.id, sort: null });
      $("#sidebar").classList.remove("open");
    });
    return;
  }
  if (sideMode === "nights") {
    const max = Math.max(1, ...nightsData.map((n) => n.n));
    ul.innerHTML = nightsData
      .filter((n) => !term || n.night.includes(term) || fmt.night(n.night).toLowerCase().includes(term))
      .map((n) => `<li data-night="${n.night}" class="${params.get("night") === n.night ? "active" : ""}">
          <span class="name">${fmt.night(n.night)}</span><span class="n">${n.n}</span>
          <span class="sub">${n.n_objects} object${n.n_objects === 1 ? "" : "s"} · ${n.n_fits ? `${n.n_fits} with preview · ` : ""}${fmt.bytes(n.bytes)}</span>
          <span class="bar" style="width:${(100 * n.n / max).toFixed(1)}%"></span></li>`).join("");
    $$("li", ul).forEach((li) => li.onclick = () => {
      setParams({ night: params.get("night") === li.dataset.night ? null : li.dataset.night });
      $("#sidebar").classList.remove("open");
    });
  } else {
    ul.innerHTML = objectsData
      .filter((o) => !term || (o.name || "").toLowerCase().includes(term))
      .map((o) => {
        const key = o.key ?? "__none__";
        return `<li data-key="${esc(key)}" class="${params.get("object") === key ? "active" : ""}">
          <span class="name">${o.name ? esc(o.name) : "<i class='muted'>(no object name)</i>"}</span><span class="n">${o.n}</span>
          <span class="sub">${o.n_nights} night${o.n_nights === 1 ? "" : "s"}${o.total_time ? ` · ${fmt.exp(o.total_time)} total` : ""}</span></li>`;
      }).join("");
    $$("li", ul).forEach((li) => li.onclick = () => {
      setParams({ object: params.get("object") === li.dataset.key ? null : li.dataset.key });
      $("#sidebar").classList.remove("open");
    });
  }
}

// ------------------------------------------------------------------ filter controls
const CONTROLS = { fVerdict: "verdict", fFilter: "filter", fFrom: "date_from", fTo: "date_to", fExpMin: "exp_min", fExpMax: "exp_max", fMode: "mode", fKind: "kind", fRating: "rating", sort: "sort" };
for (const [id, key] of Object.entries(CONTROLS)) {
  $("#" + id).onchange = (e) => setParams({ [key]: e.target.value });
}
$("#fNote").onchange = (e) => setParams({ has_note: e.target.checked ? "1" : null });
let qTimer;
$("#q").oninput = (e) => { clearTimeout(qTimer); qTimer = setTimeout(() => setParams({ q: e.target.value.trim() }), 300); };
$("#clearBtn").onclick = () => { location.hash = "/"; };

function syncControls() {
  const params = new URLSearchParams(galleryHash.split("?")[1] || "");
  for (const [id, key] of Object.entries(CONTROLS)) $("#" + id).value = params.get(key) || (key === "sort" ? "newest" : "");
  if (document.activeElement !== $("#q")) $("#q").value = params.get("q") || "";
  $("#fNote").checked = !!params.get("has_note");
  $("#sortAdded").hidden = !params.get("collection");
}

function renderChips(params) {
  const label = {
    q: (v) => `“${v}”`, night: (v) => fmt.night(v),
    object: (v) => v === "__none__" ? "No object name" : (objectsData.find((o) => o.key === v)?.name || v),
    filter: (v) => `Filter ${v}`, date_from: (v) => `From ${v}`, date_to: (v) => `To ${v}`,
    exp_min: (v) => `Exp ≥ ${v} s`, exp_max: (v) => `Exp ≤ ${v} s`, mode: (v) => `Mode ${v}`,
    kind: (v) => (v === "fits" ? "FITS only" : "Raw only"),
    collection: (v) => `📁 ${collectionsData.find((c) => String(c.id) === v)?.name || "Collection " + v}`,
    rating: (v) => `${"★".repeat(+v)}${+v < 5 ? "+" : ""}`, has_note: () => "Has notes",
    tag: (v) => `🏷 ${v}`,
    verdict: (v) => VERDICT[v] || (v === "none" ? "Not judged yet" : "Not judged by me"),
  };
  $("#chips").innerHTML = KEYS.filter((k) => k !== "sort" && params.get(k))
    .map((k) => `<span class="chip">${esc(label[k](params.get(k)))}<button data-k="${k}" title="Remove">×</button></span>`).join("");
  $$("#chips button").forEach((b) => b.onclick = () => setParams({ [b.dataset.k]: null }));
}

// ------------------------------------------------------------------ gallery
const PAGE = 60;
let galleryState = { key: null, offset: 0, total: 0, loading: false };

function apiQuery(params, offset) {
  const p = new URLSearchParams();
  for (const k of KEYS) {
    const v = params.get(k);
    if (!v) continue;
    if (k === "object") p.set("object", v === "__none__" ? "" : v);
    else p.set(k, v);
  }
  p.set("limit", PAGE);
  p.set("offset", offset);
  return "/api/exposures?" + p;
}

async function loadGallery(params, append = false) {
  const key = params.toString();
  if (!append) {
    galleryState = { key, offset: 0, total: 0, loading: true };
    $("#grid").innerHTML = "";
    thumbQueue.length = 0;
    selected.clear();
    updateSelbar();
  }
  galleryState.loading = true;
  try {
    const data = await api(apiQuery(params, galleryState.offset));
    if (galleryState.key !== key) return; // a newer query started meanwhile
    galleryState.total = data.total;
    galleryState.offset += data.items.length;
    $("#grid").insertAdjacentHTML("beforeend", data.items.map(cardHTML).join(""));
    $$("#grid img[data-src]:not([data-q])").forEach((img) => { img.dataset.q = 1; thumbObserver.observe(img); });
    $("#count").textContent = `${fmt.num(data.total)} exposure${data.total === 1 ? "" : "s"}`;
    $("#moreBtn").hidden = galleryState.offset >= data.total;
    $("#empty").hidden = data.total > 0;
  } catch (e) {
    $("#grid").innerHTML = `<div class="note warn">Could not load exposures: ${esc(e.message)}</div>`;
  } finally {
    galleryState.loading = false;
  }
}
$("#moreBtn").onclick = () => {
  if (!galleryState.loading) loadGallery(new URLSearchParams(galleryHash.split("?")[1] || ""), true);
};

function cardHTML(e) {
  const ph = (title, text) => `<div class="thumb"><div class="ph"><b>${title}</b>${text}</div></div>`;
  const thumb = e.n_fits > 0 && e.preview_shared === false
    ? ph("NOT SHARED", "not readable by every account<br>on the server")
    : e.n_fits > 0
    ? `<div class="thumb loading"><img data-src="/api/exposures/${e.id}/thumb.webp?v=${e.signature}" alt=""></div>`
    : !e.n_files ? ph("METADATA ONLY", "no image files in folder")
    : !e.n_readable ? ph("NO ACCESS", "files are not readable<br>for your account")
    : ph("RAW", "hpkcmos-pack<br>no preview");
  const flags = [
    e.rating ? `<span class="st" title="Your rating">${"★".repeat(e.rating)}</span>` : "",
    e.has_note ? `<span title="Has your notes">📝</span>` : "",
    verdictFlag(e),
    e.tags.length ? `<span class="card-tags" title="${esc(e.tags.join(", "))}">🏷 ${esc(e.tags.slice(0, 2).join(", "))}${e.tags.length > 2 ? ` +${e.tags.length - 2}` : ""}</span>` : "",
    e.n_collections ? `<span title="In ${e.n_collections} collection${e.n_collections === 1 ? "" : "s"}">📁 ${e.n_collections}</span>` : "",
  ].join("");
  return `<a class="card${selected.has(e.id) ? " selected" : ""}" href="#/exp/${e.id}" data-id="${e.id}">
    <div style="position:relative">${thumb}
      <div class="badges">${filterBadge(e.filter_norm)}${e.n_frames > 1 ? `<span class="badge">${fmt.num(e.n_frames)}×</span>` : ""}</div>
      <span class="tick">✓</span>
    </div>
    <div class="card-body">
      <div class="card-title">${e.object ? esc(e.object) : "<span class='muted'>(no object)</span>"}</div>
      <div class="card-meta">
        <span title="Exposure time${e.exptime_src === "derived" ? " (derived from NEXP)" : ""}">⏱ ${fmt.exp(e.exptime)}</span>
        <span title="Start (UTC)">${fmt.time(e.start_utc)} UT</span>
        <span>${esc(e.night || "")}</span>
        <span title="${esc(e.folder)}/${esc(e.prefix)}">${esc(e.prefix.replace(/^object0*/, "#"))}</span>
        ${viewerCfg.url ? `<span class="ext" role="link" tabindex="0" data-folder="${esc(e.folder)}" data-prefix="${esc(e.prefix)}" title="Open in the port-8003 viewer (new tab)">Viewer ↗</span>` : ""}
      </div>
      <div class="card-flags">${flags}</div>
    </div></a>`;
}

// My verdict, plus everyone's counts when people have judged it (e.g. "🗑 2 · ✅ 1").
function verdictFlag(e) {
  const all = Object.entries(e.verdicts || {});
  if (!all.length) return "";
  const title = all.map(([v, n]) => `${VERDICT[v]}: ${n}`).join(", ") + (e.verdict ? ` (yours: ${VERDICT[e.verdict]})` : "");
  const text = all.length === 1 && all[0][1] === 1 ? VERDICT[all[0][0]].split(" ")[0] : all.map(([v, n]) => `${VERDICT[v].split(" ")[0]} ${n}`).join(" · ");
  return `<span class="vflag${all.length > 1 ? " disputed" : ""}" title="${esc(title)}">${text}</span>`;
}

// ------------------------------------------------------------------ selecting & organizing in the gallery
const selected = new Set();
let selecting = false;
function setSelecting(on) {
  selecting = on;
  $("#grid").classList.toggle("selecting", on);
  $("#selectBtn").hidden = on;
  if (!on) { selected.clear(); $$("#grid .card.selected").forEach((c) => c.classList.remove("selected")); }
  updateSelbar();
}
function updateSelbar() {
  $("#selbar").hidden = !selecting;
  $("#selCount").textContent = `${selected.size} selected`;
  const inCol = new URLSearchParams(galleryHash.split("?")[1] || "").get("collection");
  $("#selRemove").hidden = !inCol;
  for (const id of ["selAdd", "selRate", "selRemove"]) $("#" + id).disabled = !selected.size;
}
$("#selectBtn").onclick = () => setSelecting(true);
$("#selDone").onclick = () => setSelecting(false);
$("#selNone").onclick = () => { selected.clear(); $$("#grid .card.selected").forEach((c) => c.classList.remove("selected")); updateSelbar(); };
$("#selAll").onclick = () => { $$("#grid .card").forEach((c) => { selected.add(+c.dataset.id); c.classList.add("selected"); }); updateSelbar(); };
$("#grid").addEventListener("click", (ev) => {
  const ext = ev.target.closest(".ext");
  if (ext && !selecting) {
    ev.preventDefault();
    window.open(viewerUrl(ext.dataset), "_blank", "noopener");
    return;
  }
  if (!selecting) return;
  const card = ev.target.closest(".card");
  if (!card) return;
  ev.preventDefault();
  const id = +card.dataset.id;
  if (selected.has(id)) selected.delete(id); else selected.add(id);
  card.classList.toggle("selected", selected.has(id));
  updateSelbar();
});

async function post(path, body, method = "POST") {
  const r = await fetch(path, { method, headers: { "Content-Type": "application/json", ...editHeaders() }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(typeof j.detail === "string" ? j.detail : r.statusText);
  return j;
}
function toast(text) {
  $("#count").textContent = text;
  setTimeout(() => $("#count").textContent = `${fmt.num(galleryState.total)} exposure${galleryState.total === 1 ? "" : "s"}`, 2500);
}
async function refreshGallery() {
  lastGalleryKey = null;
  await loadCollections();
  renderSide();
  route();
}

$("#selAdd").onchange = async (e) => {
  let cid = e.target.value;
  e.target.value = "";
  if (!cid || !selected.size) return;
  if (cid === "new") { cid = await editCollection(null); if (!cid) return; }
  try {
    const r = await post(`/api/collections/${cid}/add`, { exposure_ids: [...selected] });
    const name = collectionsData.find((c) => String(c.id) === String(cid))?.name;
    setSelecting(false);
    await refreshGallery();
    toast(`Added ${r.added} to “${name}”`);
  } catch (err) { alert(err.message); }
};
$("#selRemove").onclick = async () => {
  const cid = new URLSearchParams(galleryHash.split("?")[1] || "").get("collection");
  if (!cid || !selected.size) return;
  try {
    const r = await post(`/api/collections/${cid}/remove`, { exposure_ids: [...selected] });
    setSelecting(false);
    await refreshGallery();
    toast(`Removed ${r.removed} from the collection (the data is not affected)`);
  } catch (err) { alert(err.message); }
};
$("#selVerdict").onchange = async (e) => {
  const v = e.target.value, label = e.target.selectedOptions[0].textContent;
  e.target.value = "";
  if (label === "Verdict…" || !selected.size) return;
  try {
    await post("/api/annotations/verdict", { exposure_ids: [...selected], verdict: v });
    setSelecting(false);
    await refreshGallery();
  } catch (err) { alert(err.message); }
};
$("#selTag").onclick = async () => {
  if (!selected.size) return;
  const t = prompt(`Tag for the ${selected.size} selected photo${selected.size === 1 ? "" : "s"} (start with - to remove a tag):`);
  if (!t || !t.trim()) return;
  const remove = t.trim().startsWith("-");
  try {
    await post("/api/tags/bulk", { exposure_ids: [...selected], [remove ? "remove" : "add"]: [t.trim().replace(/^-/, "")] });
    setSelecting(false);
    await Promise.all([refreshGallery(), loadTags()]);
  } catch (err) { alert(err.message); }
};
$("#selRate").onchange = async (e) => {
  const v = e.target.value;
  e.target.value = "";
  if (v === "" || !selected.size) return;
  try {
    await post("/api/annotations/rating", { exposure_ids: [...selected], rating: +v });
    setSelecting(false);
    await refreshGallery();
  } catch (err) { alert(err.message); }
};

// Create (c = null) or rename a collection with a small dialog. Resolves to its id, or null if cancelled.
function editCollection(c) {
  const dlg = $("#colDialog");
  $("#colDlgTitle").textContent = c ? "Rename collection" : "New collection";
  $("#colOk").textContent = c ? "Save" : "Create";
  $("#colName").value = c?.name || "";
  $("#colDesc").value = c?.description || "";
  $("#colErr").textContent = "";
  dlg.showModal();
  $("#colName").focus();
  return new Promise((resolve) => {
    $("#colCancel").onclick = () => { dlg.close(); resolve(null); };
    dlg.oncancel = () => resolve(null);
    $("#colForm").onsubmit = async (ev) => {
      ev.preventDefault();
      const body = { name: $("#colName").value.trim(), description: $("#colDesc").value.trim() };
      if (!body.name) return;
      try {
        const r = c ? await post(`/api/collections/${c.id}`, body, "PATCH") : await post("/api/collections", body);
        dlg.close();
        await loadCollections();
        renderSide();
        if (!$("#detail").hidden && cur) renderOrganize();
        resolve(c ? c.id : r.id);
      } catch (err) { $("#colErr").textContent = err.message; }
    };
  });
}
async function deleteCollection(c) {
  if (!confirm(`Delete the collection “${c.name}”?\n\nOnly the collection is removed. The exposures and the data files are not affected.`)) return;
  try { await post(`/api/collections/${c.id}`, {}, "DELETE"); } catch (err) { alert(err.message); return; }
  const params = new URLSearchParams(galleryHash.split("?")[1] || "");
  await loadCollections();
  if (params.get("collection") === String(c.id)) setParams({ collection: null });
  else renderSide();
}
$("#newColBtn").onclick = () => editCollection(null);

// Thumbnails load lazily, at most two at a time, so the server is never flooded.
const thumbQueue = [];
let thumbsActive = 0;
const thumbObserver = new IntersectionObserver((entries) => {
  for (const en of entries) if (en.isIntersecting) { thumbObserver.unobserve(en.target); thumbQueue.push(en.target); }
  pumpThumbs();
}, { rootMargin: "400px" });
function pumpThumbs() {
  while (thumbsActive < 2 && thumbQueue.length) {
    const img = thumbQueue.shift();
    if (!img.isConnected) continue;
    thumbsActive++;
    const done = (ok) => {
      thumbsActive--;
      img.parentElement.classList.remove("loading");
      if (ok) img.classList.add("loaded");
      else img.parentElement.insertAdjacentHTML("beforeend", `<div class="ph">preview unavailable</div>`);
      pumpThumbs();
    };
    img.onload = () => done(true);
    img.onerror = () => done(false);
    img.src = img.dataset.src;
  }
}

// ------------------------------------------------------------------ routing
let lastGalleryKey = null;
function route() {
  const { path, params } = parseHash();
  const x = path.match(/^\/x\/([^/]+)\/([^/]+)/);  // shared link: exposure by folder + name
  if (x) {
    api(`/api/lookup?folder=${x[1]}&prefix=${x[2]}`)
      .then((r) => history.replaceState(null, "", `#/exp/${r.id}`))
      .catch((err) => { alert(err.message); history.replaceState(null, "", "#/"); })
      .finally(route);
    return;
  }
  const m = path.match(/^\/exp\/(\d+)/);
  if (m) {
    openDetail(+m[1]);
    if (lastGalleryKey === null) { lastGalleryKey = ""; loadGallery(new URLSearchParams()); }
    return;
  }
  galleryHash = location.hash || "#/";
  closeDetail();
  syncControls();
  renderChips(params);
  renderSide();
  const key = params.toString();
  if (key !== lastGalleryKey) { lastGalleryKey = key; loadGallery(params); }
}
window.addEventListener("hashchange", route);

// ------------------------------------------------------------------ detail view
let cur = null;           // current exposure (from /api/exposures/<id>)
let detailToken = 0;

function closeDetail() {
  if ($("#detail").hidden) return;
  saveNote();
  $("#detail").hidden = true;
  document.body.style.overflow = "";
  cur = null;
}
$("#closeBtn").onclick = () => { location.hash = galleryHash; };
$("#prevBtn").onclick = () => cur?.prev_id && (location.hash = `/exp/${cur.prev_id}`);
$("#nextBtn").onclick = () => cur?.next_id && (location.hash = `/exp/${cur.next_id}`);
document.addEventListener("keydown", (e) => {
  if ($("#detail").hidden || e.target.matches("input, select, textarea")) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (/^[0-5]$/.test(e.key) && cur && canEdit) { setRating(+e.key); return; }
  const v = { g: "good", j: "junk", u: "unsure" }[e.key.toLowerCase()];
  if (v && cur && canEdit) { setVerdict(v); return; }
  if (e.key.toLowerCase() === "t" && canEdit) { e.preventDefault(); $("#dTagIn").focus(); return; }
  if (e.key === "Escape") { if (triage.on) stopTriage(); $("#closeBtn").click(); }
  else if (triage.on && e.key === "ArrowRight" && cur) { triage.skipped.add(cur.id); triageNext(cur.id); }
  else if (e.key === "ArrowLeft") $("#prevBtn").click();
  else if (e.key === "ArrowRight") $("#nextBtn").click();
});

$$(".info .tab").forEach((t) => t.onclick = () => showInfoTab(t.dataset.info));
function showInfoTab(name) {
  $$(".info .tab").forEach((x) => x.classList.toggle("active", x.dataset.info === name));
  $$(".info [data-pane]").forEach((p) => p.hidden = p.dataset.pane !== name);
  if (name === "meta") loadMeta();
  if (name === "header") loadHeader();
}

async function openDetail(id) {
  if (cur && cur.id !== id) await saveNote();
  const token = ++detailToken;
  $("#detail").hidden = false;
  document.body.style.overflow = "hidden";
  $("#dTitle").textContent = "Loading…";
  let e;
  try {
    e = await api(`/api/exposures/${id}`);
  } catch (err) {
    $("#dTitle").textContent = "Exposure not found";
    $("#dSub").textContent = err.message;
    return;
  }
  if (token !== detailToken) return;
  const sameExposure = cur && cur.id === e.id;
  cur = e;
  $("#dTitle").innerHTML = `${e.object ? esc(e.object) : "<span class='muted'>(no object)</span>"} ${filterBadge(e.filter_norm)}`;
  $("#dSub").textContent = `${fmt.night(e.night)} · ${fmt.dt(e.start_utc)} UTC · ${e.folder}/${e.prefix}`;
  const vu = viewerUrl(e);
  $("#viewerBtn").hidden = !vu;
  if (vu) $("#viewerBtn").href = vu;
  $("#prevBtn").disabled = !e.prev_id;
  $("#nextBtn").disabled = !e.next_id;
  renderSummary(e);
  renderFiles(e);
  renderOrganize();
  $("#metaBody").dataset.for = "";
  $("#hdrFile").innerHTML = e.files.filter((f) => f.shared)
    .map((f) => `<option value="${f.id}">Sensor ${f.sensor} · ${esc(f.format)}</option>`).join("");
  $("#hdrBody").dataset.for = "";
  const active = $(".info .tab.active").dataset.info;
  showInfoTab(active);
  if (!sameExposure) setupViewer(e);
}

// ---------- organizing one exposure (rating, collections, notes)
function renderOrganize() {
  const e = cur;
  $("#dStars").innerHTML = [1, 2, 3, 4, 5].map((n) =>
    `<button data-n="${n}" class="${(e.rating || 0) >= n ? "on" : ""}" title="${n} star${n > 1 ? "s" : ""}">★</button>`).join("");
  $$("#dStars button").forEach((b) => b.onclick = () => setRating(+b.dataset.n === e.rating ? 0 : +b.dataset.n));
  $("#dCols").innerHTML = e.collections.map((c) =>
    `<span class="chip">📁 ${esc(c.name)}<button data-id="${c.id}" title="Remove from this collection" class="edit-only">×</button></span>`).join("");
  $$("#dCols button").forEach((b) => b.onclick = async () => {
    await post(`/api/collections/${b.dataset.id}/remove`, { exposure_ids: [cur.id] });
    await afterOrganize();
  });
  const inIds = new Set(e.collections.map((c) => String(c.id)));
  $$("#dAddCol option").forEach((o) => o.hidden = inIds.has(o.value));
  $$("#dVerdict button").forEach((b) => b.classList.toggle("on", b.dataset.v === e.verdict));
  $("#dTags").innerHTML = (e.tags || []).map((t) =>
    `<span class="chip tag">🏷 ${esc(t)}<button data-t="${esc(t)}" title="Remove this tag" class="edit-only">×</button></span>`).join("");
  $$("#dTags button").forEach((b) => b.onclick = () => changeTags([], [b.dataset.t]));
  if (!noteDirty) $("#dNote").value = e.user_note || "";  // never overwrite unsaved typing
  const others = e.others || [];
  $("#dOthers").hidden = !others.length;
  $("#dOthers").innerHTML = others.length ? `<div class="muted small">Others</div>` + others.map((o) =>
    `<div class="other"><b>${esc(o.user)}</b> ${o.verdict ? VERDICT[o.verdict] : ""} <span class="st">${o.rating ? "★".repeat(o.rating) : ""}</span>` +
    (o.tags.length ? ` ${o.tags.map((t) => `<a class="chip tag small" href="#/?tag=${encodeURIComponent(t)}">🏷 ${esc(t)}</a>`).join(" ")}` : "") +
    (o.note ? `<div class="other-note">${esc(o.note)}</div>` : "") + `</div>`).join("") : "";
  $(".organize").hidden = !canEdit && !e.rating && !e.verdict && !(e.tags || []).length && !e.collections.length && !e.user_note && !others.length;
  $("#dNote").hidden = !canEdit && !e.user_note;
  $("#dSaved").textContent = "";
}
async function afterOrganize(savedMsg = "Saved") {
  const id = cur.id;
  Object.assign(cur, await api(`/api/exposures/${id}`).then((x) => ({ rating: x.rating, user_note: x.user_note, verdict: x.verdict, tags: x.tags, others: x.others, collections: x.collections })));
  await loadCollections();
  renderOrganize();
  $("#dSaved").textContent = savedMsg;
  lastGalleryKey = null; // gallery shows ratings/collections; refresh it when we go back
}
async function setVerdict(v) {
  if (!cur) return;
  const id = cur.id, clear = v === cur.verdict;  // pressing the same one again clears it
  await post(`/api/exposures/${id}/annotation`, { verdict: clear ? "" : v }, "PUT");
  if (triage.on && !clear) return triageNext(id);
  await afterOrganize(clear ? "Verdict cleared" : VERDICT[v]);
}
$$("#dVerdict button").forEach((b) => b.onclick = () => setVerdict(b.dataset.v));

async function changeTags(add, remove) {
  if (!cur) return;
  const r = await post(`/api/exposures/${cur.id}/tags`, { add, remove }, "PUT");
  cur.tags = r.tags;
  renderOrganize();
  $("#dSaved").textContent = add.length ? "Tag added" : "Tag removed";
  lastGalleryKey = null;
  loadTags();
}
$("#dTagIn").onkeydown = (ev) => {
  if (ev.key === "Enter" && ev.target.value.trim()) {
    ev.preventDefault();
    changeTags([ev.target.value.trim()], []);
    ev.target.value = "";
  } else if (ev.key === "Escape") { ev.stopPropagation(); ev.target.blur(); }
};
$("#dTagIn").onchange = (ev) => {  // picked from the suggestion list
  if (tagsData.some((t) => t.tag === ev.target.value)) { changeTags([ev.target.value], []); ev.target.value = ""; }
};

// ---------- triage: go through the photos I haven't judged yet, one at a time
// Uses the gallery's current filters; "next" is simply the first photo still
// without my verdict, so it never loses its place. Skipped photos are remembered.
const triage = { on: false, params: null, skipped: new Set() };
async function triageNext(doneId) {
  const p = new URLSearchParams(triage.params);
  p.set("verdict", "todo");
  p.delete("sort");
  const r = await api(apiQuery(p, 0).replace(/limit=\d+/, `limit=${triage.skipped.size + 2}`));
  const next = r.items.find((x) => x.id !== doneId && !triage.skipped.has(x.id));
  const left = r.total - (doneId && r.items.some((x) => x.id === doneId) ? 1 : 0);
  if (!next) { stopTriage(); toast("All done: every photo here has your verdict."); return; }
  $("#triageLeft").textContent = `${left} left`;
  location.hash = `/exp/${next.id}`;
}
function startTriage() {
  triage.on = true;
  triage.params = new URLSearchParams(galleryHash.split("?")[1] || "");
  triage.skipped.clear();
  $("#triageBar").hidden = false;
  triageNext(null);
}
function stopTriage() {
  triage.on = false;
  $("#triageBar").hidden = true;
  lastGalleryKey = null;
}
$("#triageBtn").onclick = startTriage;

async function setRating(n) {
  if (!cur) return;
  await post(`/api/exposures/${cur.id}/annotation`, { rating: n }, "PUT");
  await afterOrganize(n ? `Rated ${n}★` : "Rating cleared");
}
$("#dAddCol").onchange = async (ev) => {
  let cid = ev.target.value;
  ev.target.value = "";
  if (!cid || !cur) return;
  if (cid === "new") { cid = await editCollection(null); if (!cid) return; }
  await post(`/api/collections/${cid}/add`, { exposure_ids: [cur.id] });
  await afterOrganize("Added to collection");
};
let noteTimer, noteDirty = false;
async function saveNote() {
  clearTimeout(noteTimer);
  const e = cur, text = $("#dNote").value;
  if (!e || !noteDirty) return;
  noteDirty = false;
  if (text.trim() === (e.user_note || "")) return;
  $("#dSaved").textContent = "Saving…";
  try {
    const r = await post(`/api/exposures/${e.id}/annotation`, { note: text }, "PUT");
    e.user_note = r.user_note;
    $("#dSaved").textContent = "Note saved";
    lastGalleryKey = null;
  } catch (err) { noteDirty = true; $("#dSaved").textContent = "Could not save: " + err.message; }
}
$("#dNote").oninput = () => {
  noteDirty = true;
  $("#dSaved").textContent = "…"; clearTimeout(noteTimer); noteTimer = setTimeout(saveNote, 800); };
$("#dNote").onblur = saveNote;

function kvRows(rows) {
  return rows.map(([k, v]) => k === "§" ? `<tr class="sec"><th colspan="2">${esc(v)}</th></tr>` : `<tr><th>${esc(k)}</th><td>${v}</td></tr>`).join("");
}

function renderSummary(e) {
  const frames = e.fits_frames != null && e.fits_frames !== e.n_frames
    ? `${fmt.num(e.n_frames)} captured · ${fmt.num(e.fits_frames)} stored in FITS` : fmt.num(e.n_frames);
  const rows = [
    ["§", "Observation"],
    ["Object", esc(e.object ?? "—")],
    ["Filter", e.filter ? `${esc(e.filter)}${e.filter_norm && e.filter_norm !== e.filter ? ` <span class="muted">(${esc(e.filter_norm)})</span>` : ""}` : "—"],
    ["Night", fmt.night(e.night)],
    ["Start (UTC)", fmt.dt(e.start_utc)],
    ["Start (local, MST)", fmt.dt(e.start_local)],
    ["Exposure time", `${fmt.exp(e.exptime)}${e.exptime_src === "derived" ? ` <span class="muted">(NEXP × line time)</span>` : ""}`],
    ["NEXP", fmt.num(e.nexp)],
    ["Frames", frames],
    ["Readout mode", esc(e.mode ?? "—")],
    ["Gain", e.gain != null ? `${e.gain} <span class="muted">(code ${e.gain_code ?? "?"})</span>` : e.gain_code != null ? `code ${e.gain_code}` : "—"],
    ["Offset", e.offset ?? "—"],
    ["§", "Pointing"],
    ["RA", fmt.sexa(e.ra, true)],
    ["Dec", fmt.sexa(e.dec, false)],
    ["Alt / Az", e.el != null ? `${fmt.f1(e.el, "°")} / ${fmt.f1(e.az, "°")}` : "—"],
    ["Airmass", e.airmass != null ? (+e.airmass).toFixed(3) : "—"],
    ["§", "Conditions"],
    ["Sensor temperature", fmt.f1(e.sensor_temp, " °C")],
    ["Outside temperature", fmt.f1(e.outside_temp, " °C")],
    ["Outside humidity", fmt.f1(e.humidity, " %")],
    ["Wind", fmt.f1(e.wind, " mph")],
    ["§", "Data"],
    ["Folder", `<span class="mono">${esc(e.folder)}</span>`],
    ["Exposure", `<span class="mono">${esc(e.prefix)}</span>`],
    ["Sensors", `${e.n_sensors} (${e.n_fits} with FITS preview)`],
    ["Formats", esc(e.formats)],
    ["Total size", fmt.bytes(e.total_bytes)],
  ];
  if (e.note) rows.push(["Note", esc(e.note)]);
  if (e.error) rows.push(["Index warnings", `<span style="color:var(--warn)">${esc(e.error)}</span>`]);
  $("#summary").innerHTML = kvRows(rows);
}

function renderFiles(e) {
  const big = e.files.some((f) => f.size > 5e9);
  $("#filesBody").innerHTML = `
    ${viewerUrl(e) ? `<div class="note">View this exposure in the existing image viewer: <a href="${esc(viewerUrl(e))}" target="_blank" rel="noopener">Open in viewer ↗</a></div>` : ""}
    <div class="note">Downloads are the original files, byte for byte. ${big ? "<br><b>Some files are very large</b>; downloading over an SSH tunnel may take a long time." : ""}</div>
    <table class="files"><thead><tr><th>Sensor</th><th>Format</th><th class="r">Size</th><th></th></tr></thead><tbody>
    ${e.files.map((f) => `<tr><td>${f.sensor}</td><td class="mono">${esc(f.format)}</td><td class="r">${fmt.bytes(f.size)}</td>
      <td>${!f.readable ? `<span class="muted small">no read access</span>`
        : !f.shared ? `<span class="muted small" title="Not readable by every account on the server">owner only</span>`
        : `<a class="dl" href="/api/files/${f.id}/download" download>Download</a>`}</td></tr>`).join("")}
    </tbody></table>`;
}

async function loadHeader() {
  const fid = $("#hdrFile").value;
  const body = $("#hdrBody");
  if (!fid) { body.innerHTML = `<div class="note">No readable files.</div>`; return; }
  if (body.dataset.for === fid) return;
  body.dataset.for = fid;
  body.innerHTML = `<div class="muted">Reading header…</div>`;
  try {
    const h = await api(`/api/files/${fid}/header`);
    if (body.dataset.for !== fid) return;
    if (h.kind === "fits") {
      body.innerHTML = h.hdus.map((hdu) => `<h4>${esc(hdu.name)}</h4><table>${hdu.cards
        .filter((c) => c[0] !== "")
        .map((c) => `<tr data-k="${esc((c[0] + " " + c[1]).toLowerCase())}"><td>${esc(c[0])}</td><td>${esc(c[1])}</td><td>${esc(c[2])}</td></tr>`).join("")}</table>`).join("");
    } else {
      body.innerHTML = `<div class="note">Raw camera file: this is its JSON header.</div><pre class="mono">${esc(JSON.stringify(h.json, null, 2))}</pre>`;
    }
    filterHeader();
  } catch (err) {
    body.innerHTML = `<div class="note warn">${esc(err.message)}</div>`;
  }
}
$("#hdrFile").onchange = loadHeader;
$("#hdrFilter").oninput = filterHeader;
function filterHeader() {
  const t = $("#hdrFilter").value.trim().toLowerCase();
  $$("#hdrBody tr").forEach((tr) => tr.hidden = t && !tr.dataset.k.includes(t));
}

async function loadMeta() {
  const box = $("#metaBody");
  if (!cur || box.dataset.for === String(cur.id)) return;
  const id = cur.id;
  box.dataset.for = id;
  box.innerHTML = `<div class="muted">Loading…</div>`;
  try {
    const m = await api(`/api/exposures/${id}/meta`);
    if (box.dataset.for !== String(id)) return;
    const env = (m.tel_envs || [])[0] || {};
    const obj = (o) => Object.entries(o || {}).filter(([, v]) => v !== null && typeof v !== "object")
      .map(([k, v]) => [k, esc(v)]);
    const cc = m.capture_config || {};
    const rows = [
      ["§", "Capture"], ["start_time (local)", esc(m.start_time)],
      ...obj(cc), ...obj(cc.fits_headers).map(([k, v]) => [`header ${k}`, v]),
      ["§", `Telescope (first of ${(m.tel_envs || []).length} samples)`], ...obj(env.tel_status),
      ["§", "Dome"], ...obj(env.dome_env),
      ["§", "Weather station"], ...obj(env.weather),
      ["§", "GPS"], ["records", (m.gps_records || []).length],
    ];
    box.innerHTML = `<table class="kv">${kvRows(rows)}</table>
      <details class="raw"><summary>Full meta.json</summary><pre class="mono">${esc(JSON.stringify(m, null, 2))}</pre></details>`;
  } catch (err) {
    box.innerHTML = `<div class="note warn">${esc(err.message)}</div>`;
  }
}

// ------------------------------------------------------------------ image viewer
const canvas = $("#canvas"), ctx = canvas.getContext("2d");
const off = document.createElement("canvas"), offCtx = off.getContext("2d");
const viewer = $("#viewer");
let px = null;            // {w, h, raw, flat, layout, bin, sample}
let view = { scale: 1, tx: 0, ty: 0, fitted: true };
let levels = { lo: 0, hi: 1, preset: 99.5 };
let pixToken = 0;

const STRETCH = {
  linear: (t) => t,
  sqrt: (t) => Math.sqrt(t),
  log: (t) => Math.log10(1 + 1000 * t) / 3,
  asinh: (t) => Math.asinh(t / 0.1) / Math.asinh(10),
};
const CMAPS = (() => {
  const lerp = (stops) => {
    const lut = new Uint8Array(256 * 3);
    for (let i = 0; i < 256; i++) {
      const t = i / 255 * (stops.length - 1), k = Math.min(Math.floor(t), stops.length - 2), f = t - k;
      for (let c = 0; c < 3; c++) lut[i * 3 + c] = Math.round(stops[k][c] + (stops[k + 1][c] - stops[k][c]) * f);
    }
    return lut;
  };
  return {
    gray: lerp([[0, 0, 0], [255, 255, 255]]),
    inv: lerp([[255, 255, 255], [0, 0, 0]]),
    heat: lerp([[0, 0, 0], [120, 20, 10], [230, 90, 20], [255, 210, 80], [255, 255, 255]]),
    viridis: lerp([[68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37]]),
  };
})();

function setupViewer(e) {
  px = null;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  $("#vReadout").textContent = "";
  const sensors = e.preview_sensors;
  const controls = $$(".viewer-controls select, .viewer-controls input, .levels input, .levels button");
  $(".viewer-controls").hidden = $(".levels").hidden = $(".zoom-btns").hidden = !sensors.length;
  if (!sensors.length) {
    controls.forEach((c) => c.disabled = true);
    if (e.restricted && e.n_fits > 0 && e.files.some((f) => f.readable && !f.shared))
      msg(`<b>Not shared</b><br>These files aren't readable by every account on the server,<br>so they're only available to the owner of this app.`);
    else if (!e.files.length) msg(`<b>Metadata only</b><br>The folder has a meta.json for this exposure but no image files.`);
    else if (!e.files.some((f) => f.readable)) msg(`<b>No read access</b><br>These files exist but are not readable for your account.<br>Ask the data owner to make them readable to see more.`);
    else if (e.files.some((f) => f.readable && f.format.startsWith("fits"))) msg(`<b>No preview</b><br>The FITS files for this exposure could not be read.`);
    else msg(`<b>Raw camera data</b><br>This exposure is stored only as <span class="mono">.hpkcmos-pack</span>, which can't be previewed here.<br>${viewerUrl(e) ? `Use <b>Open in viewer ↗</b> (top right) to see it in the port-8003 viewer.<br>` : ""}Metadata and downloads are available on the right.`);
    return;
  }
  controls.forEach((c) => c.disabled = false);
  $("#vSensor").innerHTML = (sensors.length > 1 ? `<option value="all">All ${sensors.length}</option>` : "") +
    sensors.map((s) => `<option value="${s}">Sensor ${s}</option>`).join("");
  const maxFrame = (e.fits_frames ?? e.n_frames ?? 1) - 1;
  $("#vFrame").max = Math.max(0, maxFrame);
  $("#vFrame").value = 0;
  $("#vFrame").title = `0 – ${Math.max(0, maxFrame)}`;
  updateBinOptions();
  view.fitted = true;
  loadPixels();
}

function updateBinOptions() {
  const all = $("#vSensor").value === "all";
  const opts = all ? [4, 8, 16] : [2, 4, 8];
  const def = all ? 8 : 4;
  $("#vBin").innerHTML = opts.map((b) => `<option value="${b}" ${b === def ? "selected" : ""}>${b}×${b}</option>`).join("");
}
$("#vSensor").onchange = () => { updateBinOptions(); view.fitted = true; loadPixels(); };
$("#vBin").onchange = () => { view.fitted = true; loadPixels(); };
$("#vFrame").onchange = () => {
  const f = $("#vFrame");
  f.value = Math.min(Math.max(0, Math.round(+f.value || 0)), +f.max);
  loadPixels();
};

function msg(html) { $("#vMsg").innerHTML = html ? `<div>${html}</div>` : ""; }

async function loadPixels() {
  if (!cur) return;
  const token = ++pixToken;
  const q = new URLSearchParams({ sensor: $("#vSensor").value, frame: $("#vFrame").value, bin: $("#vBin").value });
  msg(`<span>Reading image… <span class="small">(${$("#vSensor").value === "all" ? "all sensors" : "1 sensor"}, binned ${$("#vBin").value}×${$("#vBin").value})</span></span>`);
  let r;
  try {
    r = await fetch(`/api/exposures/${cur.id}/pixels?${q}`);
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || r.statusText);
  } catch (err) {
    if (token === pixToken) msg(`<span style="color:var(--bad)">${esc(err.message)}</span>`);
    return;
  }
  const buf = await r.arrayBuffer();
  if (token !== pixToken) return;
  const w = +r.headers.get("X-Width"), h = +r.headers.get("X-Height");
  const offset = +r.headers.get("X-Offset"), scale = +r.headers.get("X-Scale");
  const codes = new Uint16Array(buf);
  const raw = new Float32Array(codes.length);
  for (let i = 0; i < codes.length; i++) raw[i] = codes[i] ? offset + (codes[i] - 1) / scale : NaN;
  px = { w, h, raw, flat: null, layout: JSON.parse(r.headers.get("X-Layout")), bin: +r.headers.get("X-Bin") };
  msg("");
  prepareData();
  if (view.fitted) fit();
}

function data() { return $("#vFlat").checked ? px.flat : px.raw; }

function prepareData() {
  if ($("#vFlat").checked && !px.flat) px.flat = flatten(px);
  const v = data();
  // Sorted sample of finite values: drives percentiles, the histogram and the sliders.
  const step = Math.max(1, Math.floor(v.length / 250000));
  const s = [];
  for (let i = 0; i < v.length; i += step) if (v[i] === v[i]) s.push(v[i]);
  px.sample = Float32Array.from(s).sort();
  if (levels.preset != null) applyPreset(levels.preset, false);
  else { levels.lo = Math.max(levels.lo, pct(0) - 1); levels.hi = Math.min(levels.hi, pct(100) + 1); }
  syncLevelInputs();
  render();
}

function flatten(p) {
  // Subtract each column's median within each sensor tile (display only).
  const out = new Float32Array(p.raw);
  for (const t of p.layout) {
    const col = new Float32Array(t.h);
    for (let x = t.x0; x < t.x0 + t.w; x++) {
      let n = 0;
      for (let y = t.y0; y < t.y0 + t.h; y++) { const v = p.raw[y * p.w + x]; if (v === v) col[n++] = v; }
      if (!n) continue;
      const med = col.subarray(0, n).sort()[n >> 1];
      for (let y = t.y0; y < t.y0 + t.h; y++) out[y * p.w + x] -= med;
    }
  }
  return out;
}
$("#vFlat").onchange = () => { if (px) prepareData(); };

function pct(p) {
  const s = px.sample;
  if (!s.length) return 0;
  return s[Math.min(s.length - 1, Math.max(0, Math.round(p / 100 * (s.length - 1))))];
}
function applyPreset(p, redraw = true) {
  levels.preset = p;
  levels.lo = pct((100 - p) / 2);
  levels.hi = pct(100 - (100 - p) / 2);
  if (levels.hi <= levels.lo) levels.hi = levels.lo + 1;
  $$(".presets .chip-btn").forEach((b) => b.classList.toggle("active", +b.dataset.p === p));
  if (redraw) { syncLevelInputs(); render(); }
}
$$(".presets .chip-btn").forEach((b) => b.onclick = () => px && applyPreset(+b.dataset.p));

// Sliders move through the data's quantiles, so there is fine control where most pixels are.
const SL = 1000;
function valueToSlider(v) {
  const s = px.sample;
  let a = 0, b = s.length - 1;
  while (a < b) { const m = (a + b) >> 1; if (s[m] < v) a = m + 1; else b = m; }
  return Math.round(a / Math.max(1, s.length - 1) * SL);
}
const sliderToValue = (x) => pct(x / SL * 100);
function syncLevelInputs() {
  if (!px) return;
  $("#vMin").value = valueToSlider(levels.lo);
  $("#vMax").value = valueToSlider(levels.hi);
  const d = (v) => +v.toPrecision(6);
  $("#vMinN").value = d(levels.lo);
  $("#vMaxN").value = d(levels.hi);
  drawHist();
}
function manualLevels(lo, hi) {
  levels.preset = null;
  $$(".presets .chip-btn").forEach((b) => b.classList.remove("active"));
  levels.lo = lo; levels.hi = hi;
  if (levels.hi <= levels.lo) levels.hi = levels.lo + 1e-3;
  scheduleRender();
}
$("#vMin").oninput = (e) => { manualLevels(sliderToValue(+e.target.value), levels.hi); $("#vMinN").value = +levels.lo.toPrecision(6); drawHist(); };
$("#vMax").oninput = (e) => { manualLevels(levels.lo, sliderToValue(+e.target.value)); $("#vMaxN").value = +levels.hi.toPrecision(6); drawHist(); };
$("#vMinN").onchange = (e) => { manualLevels(+e.target.value, levels.hi); syncLevelInputs(); };
$("#vMaxN").onchange = (e) => { manualLevels(levels.lo, +e.target.value); syncLevelInputs(); };
$("#vStretch").onchange = () => render();
$("#vCmap").onchange = () => render();

let rafPending = false;
function scheduleRender() {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => { rafPending = false; render(); });
}

let imgData = null;
function render() {
  if (!px) return;
  const { w, h } = px, v = data();
  if (off.width !== w || off.height !== h) { off.width = w; off.height = h; imgData = null; }
  if (!imgData) imgData = offCtx.createImageData(w, h);
  const out = imgData.data, lut = CMAPS[$("#vCmap").value], f = STRETCH[$("#vStretch").value];
  const N = 4096, tt = new Uint16Array(N + 1);
  for (let i = 0; i <= N; i++) tt[i] = Math.round(Math.min(1, Math.max(0, f(i / N))) * 255) * 3;
  const lo = levels.lo, inv = N / (levels.hi - levels.lo);
  for (let i = 0, o = 0; i < v.length; i++, o += 4) {
    const x = v[i];
    if (x !== x) { out[o] = out[o + 1] = out[o + 2] = 22; out[o + 3] = 255; continue; }
    let k = (x - lo) * inv;
    k = k < 0 ? 0 : k > N ? N : k | 0;
    const c = tt[k];
    out[o] = lut[c]; out[o + 1] = lut[c + 1]; out[o + 2] = lut[c + 2]; out[o + 3] = 255;
  }
  offCtx.putImageData(imgData, 0, 0);
  draw();
}

function draw() {
  const dpr = window.devicePixelRatio || 1;
  const cw = viewer.clientWidth, ch = viewer.clientHeight;
  if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
    canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (!px) return;
  ctx.imageSmoothingEnabled = view.scale < 1;
  ctx.setTransform(view.scale * dpr, 0, 0, view.scale * dpr, view.tx * dpr, view.ty * dpr);
  ctx.drawImage(off, 0, 0);
  // sensor labels
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (px.layout.length > 1) {
    ctx.font = "600 11px system-ui, sans-serif";
    for (const t of px.layout) {
      const x = view.tx + t.x0 * view.scale + 6, y = view.ty + t.y0 * view.scale + 16;
      ctx.fillStyle = "rgba(0,0,0,.55)"; ctx.fillRect(x - 3, y - 12, 22, 16);
      ctx.fillStyle = "#cfd6ea"; ctx.fillText(`S${t.sensor}`, x, y);
    }
  }
}

function fit() {
  if (!px) return;
  const cw = viewer.clientWidth, ch = viewer.clientHeight;
  view.scale = Math.min(cw / px.w, ch / px.h) * 0.98;
  view.tx = (cw - px.w * view.scale) / 2;
  view.ty = (ch - px.h * view.scale) / 2;
  view.fitted = true;
  draw();
}
function zoomAt(factor, mx, my) {
  if (!px) return;
  const minS = Math.min(viewer.clientWidth / px.w, viewer.clientHeight / px.h) * 0.5;
  const s = Math.min(64, Math.max(minS, view.scale * factor));
  factor = s / view.scale;
  view.tx = mx - (mx - view.tx) * factor;
  view.ty = my - (my - view.ty) * factor;
  view.scale = s;
  view.fitted = false;
  draw();
}
viewer.addEventListener("wheel", (e) => {
  e.preventDefault();
  const r = viewer.getBoundingClientRect();
  zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
}, { passive: false });
$("#zoomIn").onclick = () => zoomAt(1.5, viewer.clientWidth / 2, viewer.clientHeight / 2);
$("#zoomOut").onclick = () => zoomAt(1 / 1.5, viewer.clientWidth / 2, viewer.clientHeight / 2);
$("#zoomFit").onclick = fit;
viewer.addEventListener("dblclick", fit);

let drag = null;
viewer.addEventListener("pointerdown", (e) => {
  if (e.target.closest("button")) return;
  drag = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty };
  viewer.setPointerCapture(e.pointerId);
  viewer.classList.add("dragging");
});
viewer.addEventListener("pointerup", () => { drag = null; viewer.classList.remove("dragging"); });
viewer.addEventListener("pointermove", (e) => {
  const r = viewer.getBoundingClientRect();
  if (drag) {
    view.tx = drag.tx + e.clientX - drag.x;
    view.ty = drag.ty + e.clientY - drag.y;
    view.fitted = false;
    draw();
  }
  readout(e.clientX - r.left, e.clientY - r.top);
});
viewer.addEventListener("pointerleave", () => $("#vReadout").textContent = "");

function readout(mx, my) {
  if (!px) return;
  const ix = Math.floor((mx - view.tx) / view.scale), iy = Math.floor((my - view.ty) / view.scale);
  const t = px.layout.find((t) => ix >= t.x0 && ix < t.x0 + t.w && iy >= t.y0 && iy < t.y0 + t.h);
  if (!t) { $("#vReadout").textContent = ""; return; }
  const v = data()[iy * px.w + ix];
  // FITS pixel coordinates (1-based, y measured from the bottom) of the binned block's corner
  const fx = (ix - t.x0) * px.bin + 1, fy = (t.y0 + t.h - 1 - iy) * px.bin + 1;
  const b = px.bin > 1 ? ` (mean of ${px.bin}×${px.bin})` : "";
  $("#vReadout").textContent = `S${t.sensor}  x ${fx}  y ${fy}   ${v === v ? v.toFixed(1) : "—"}${$("#vFlat").checked ? " flat" : ""}${b}`;
}

new ResizeObserver(() => { if (view.fitted) fit(); else draw(); drawHist(); }).observe(viewer);

function drawHist() {
  const c = $("#hist"), g = c.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  c.width = Math.max(1, Math.round(c.clientWidth * dpr)); c.height = Math.round(56 * dpr);
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const W = c.clientWidth, H = 56;
  g.clearRect(0, 0, W, H);
  if (!px || !px.sample.length) return;
  // Window around the current levels so the interesting part fills the plot.
  const span = levels.hi - levels.lo;
  const a = Math.max(pct(0), levels.lo - span * 0.6), b = Math.min(pct(100), levels.hi + span * 0.6);
  const NB = 160, counts = new Float64Array(NB), s = px.sample;
  for (let i = 0; i < s.length; i++) { const k = Math.floor((s[i] - a) / (b - a) * NB); if (k >= 0 && k < NB) counts[k]++; }
  const mx = Math.log1p(Math.max(...counts));
  const css = getComputedStyle(document.documentElement);
  const xOf = (v) => (v - a) / (b - a) * W;
  g.fillStyle = css.getPropertyValue("--accent").trim() + "22";
  g.fillRect(xOf(levels.lo), 0, xOf(levels.hi) - xOf(levels.lo), H);
  g.fillStyle = css.getPropertyValue("--muted").trim();
  for (let i = 0; i < NB; i++) {
    const hh = counts[i] ? Math.log1p(counts[i]) / mx * (H - 4) : 0;
    g.fillRect(i / NB * W, H - hh, W / NB + 0.5, hh);
  }
  g.fillStyle = css.getPropertyValue("--accent").trim();
  g.fillRect(xOf(levels.lo) - 1, 0, 2, H);
  g.fillRect(xOf(levels.hi) - 1, 0, 2, H);
}

// ------------------------------------------------------------------ sharing ratings (GitHub)
function renderSync(s) {
  const st = s.sync || {};
  const ago = st.last_ok ? Math.max(0, Math.round((Date.now() / 1000 - st.last_ok) / 60)) : null;
  const state = !st.enabled ? "not shared" : st.error ? "not synced" : ago === null ? "syncing…" : ago < 1 ? "synced" : `synced ${ago} min ago`;
  $("#whoBtn").hidden = false;
  $("#whoBtn").textContent = `👤 ${s.user} · ${state}`;
  $("#whoBtn").classList.toggle("warn", !!(st.enabled && st.error));
  $("#whoBtn").title = !st.enabled
    ? "Ratings and notes stay on this copy only (GitHub not set up; see README)."
    : (st.error ? `Last sync failed: ${st.error}\n` : "") + "Your ratings and notes are shared with the team through GitHub. Click to sync now.";
}
$("#whoBtn").onclick = async () => {
  $("#whoBtn").textContent = "👤 syncing…";
  try { await post("/api/sync", {}); } catch {}
  await loadStats();
  if (cur) await afterOrganize("");
};

// ------------------------------------------------------------------ start
loadStats().finally(route);  // viewer link and editing settings are needed first
setInterval(loadStats, 60 * 1000);  // keep the sync status fresh

// ------------------------------------------------------------------ share
$("#shareBtn").onclick = () => {
  const { path, params } = parseHash();
  params.delete("key");
  // Everyone runs their own copy at localhost:8010. Exposure ids differ between
  // copies, so a single exposure is shared by folder and name (#/x/<folder>/<name>).
  const target = cur && path.startsWith("/exp/") ? `/x/${encodeURIComponent(cur.folder)}/${encodeURIComponent(cur.prefix)}` : path;
  $("#shareUrl").value = `http://localhost:${location.port || 80}/#${target}${params.toString() ? "?" + params : ""}`;
  $("#shareMsg").textContent = "";
  $("#shareDialog").showModal();
  $("#shareUrl").select();
};
$("#shareClose").onclick = () => $("#shareDialog").close();
$("#shareCopy").onclick = async () => {
  $("#shareUrl").select();
  try { await navigator.clipboard.writeText($("#shareUrl").value); }
  catch { document.execCommand("copy"); }
  $("#shareMsg").textContent = "Copied. Paste it into an email or chat.";
};
loadSide().catch((e) => { $("#sideList").innerHTML = `<li class="muted">${esc(e.message)}</li>`; });
