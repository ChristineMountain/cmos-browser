// Interface language (English / Japanese).
//
// The app is written in English. When Japanese is selected, this file translates the
// page as it is drawn: a MutationObserver replaces text and title/placeholder attributes
// that match the table below (exact strings first, then the patterns for text with
// numbers in it). Anything not in the table stays in English, so new features never
// break; add their strings here to translate them.
//
// Data (object, tag and collection names, notes, headers, file paths) is never
// translated: see SKIP.
(() => {
  "use strict";
  const KEY = "cmos-lang";
  let lang = "en";
  try { lang = localStorage.getItem(KEY) || (navigator.language || "").startsWith("ja") && "ja" || "en"; } catch {}
  window.I18N = { lang, locale: lang === "ja" ? "ja-JP" : undefined };
  document.documentElement.lang = lang;

  window.setLanguage = (l) => {
    try { localStorage.setItem(KEY, l); } catch {}
    location.reload();
  };
  // The language button in the top bar shows the language it switches to.
  const wireButton = () => {
    const b = document.getElementById("langBtn");
    if (!b) return;
    b.textContent = lang === "ja" ? "English" : "日本語";
    b.title = lang === "ja" ? "英語表示に切り替え (Switch to English)" : "日本語表示に切り替え (Switch to Japanese)";
    b.onclick = () => window.setLanguage(lang === "ja" ? "en" : "ja");
  };
  if (document.body) wireButton(); else document.addEventListener("DOMContentLoaded", wireButton);
  if (lang !== "ja") return;

  const JA = {
    // top bar
    "Search object, filter, file…": "天体・フィルター・ファイルを検索…",
    "You can browse, preview and download. Collections, ratings and notes can only be changed by the owner.":
      "閲覧・プレビュー・ダウンロードができます。コレクション・評価・メモを変更できるのは所有者のみです。",
    "View only": "閲覧のみ",
    "Copy a link to exactly what you're looking at": "今見ている画面へのリンクをコピー",
    "Share": "共有",
    "Toggle light/dark": "ライト／ダーク切り替え",
    "Toggle theme": "テーマ切り替え",
    "not shared": "共有なし",
    "not synced": "未同期",
    "syncing…": "同期中…",
    "synced": "同期済み",
    "👤 syncing…": "👤 同期中…",
    "Ratings and notes stay on this copy only (GitHub not set up; see README).":
      "評価とメモはこのコピーにのみ保存されます（GitHub が未設定です。README を参照）。",
    "Your ratings and notes are shared with the team through GitHub. Click to sync now.":
      "評価とメモは GitHub を通じてチームと共有されます。クリックするとすぐに同期します。",

    // filters
    "Filters": "絞り込み",
    "Band / filter": "バンド / フィルター",
    "Any": "すべて",
    "any": "指定なし",
    "From night": "開始夜",
    "To night": "終了夜",
    "Min exp (s)": "最短露光 (秒)",
    "Max exp (s)": "最長露光 (秒)",
    "Mode": "モード",
    "Data": "データ",
    "All": "すべて",
    "FITS (preview)": "FITS（プレビュー可）",
    "Raw pack only": "Raw pack のみ",
    "Rating": "評価",
    "Has notes": "メモあり",
    "Verdict": "判定",
    "✅ Good (by anyone)": "✅ 良好（誰か）",
    "🗑 Junk (by anyone)": "🗑 不要（誰か）",
    "❔ Unsure (by anyone)": "❔ 保留（誰か）",
    "Not judged by anyone": "誰も判定していない",
    "Not judged by me": "自分が未判定",
    "Text file of everything marked Junk, with who said what. Nothing is deleted.":
      "不要と判定されたものの一覧（誰が判定したか付き）。削除はされません。",
    "Download the junk list": "不要リストをダウンロード",
    "Clear all filters": "絞り込みをすべて解除",

    // sidebar
    "Nights": "観測夜",
    "Objects": "天体",
    "Collections": "コレクション",
    "Tags": "タグ",
    "+ New collection": "+ 新しいコレクション",
    "+ New collection…": "+ 新しいコレクション…",
    "Filter list…": "リストを絞り込み…",
    "No object name": "天体名なし",
    "(no object name)": "（天体名なし）",
    "(no object)": "（天体名なし）",
    "Rename": "名前を変更",
    "Export file list": "ファイル一覧を書き出し",
    "Delete": "削除",
    "Text file listing the original file paths": "元ファイルのパス一覧（テキスト）",
    "No tags yet.": "タグはまだありません。",
    "No collections yet.": "コレクションはまだありません。",
    "Open a photo (or use": "写真を開き（または",
    ") and type a tag under the verdict buttons: anything that helps find it later, like":
      "を使い）、判定ボタンの下にタグを入力してください。後で探しやすくなる言葉、たとえば",
    "or": "や",
    "Create one with the button above, then add exposures from the gallery (":
      "上のボタンで作成し、ギャラリー（",
    ") or from an exposure's page.": "）または露光のページから追加してください。",

    // notices
    "CMOS Browser has been updated.": "CMOS Browser が更新されました。",
    "Reload to get it": "再読み込みして反映",
    "New data has been added.": "新しいデータが追加されました。",
    "Reload": "再読み込み",

    // gallery toolbar
    "Download a text file listing where the files shown here are on the server (all matches, not only the ones loaded)":
      "表示中のファイルのサーバー上の場所をテキストでダウンロード（読み込み済みのものだけでなく全件）",
    "Export paths…": "パスを書き出し…",
    "Every file (.txt)": "全ファイル (.txt)",
    "Folders only (.txt)": "フォルダーのみ (.txt)",
    ".zst files only (.txt)": ".zst ファイルのみ (.txt)",
    "Download a text file with the paths of the selected exposures' files on the server":
      "選択した露光のファイルのサーバー上のパスをテキストでダウンロード",
    "Go through the photos shown here that you haven't judged yet, one at a time":
      "表示中の写真のうち未判定のものを 1 枚ずつ確認",
    "Triage": "仕分け",
    "Select several exposures to organize them": "複数の露光を選択してまとめて整理",
    "Select": "選択",
    "Sort": "並べ替え",
    "Newest first": "新しい順",
    "Oldest first": "古い順",
    "By object": "天体順",
    "Longest exposure": "露光時間の長い順",
    "Highest rated": "評価の高い順",
    "Recently added to collection": "コレクションに追加した順",
    "Select all shown": "表示中をすべて選択",
    "Clear": "選択解除",
    "Add to collection…": "コレクションに追加…",
    "+ Add to collection…": "+ コレクションに追加…",
    "Remove from this collection": "このコレクションから外す",
    "Verdict…": "判定…",
    "✅ Good": "✅ 良好",
    "🗑 Junk": "🗑 不要",
    "❔ Unsure": "❔ 保留",
    "Clear verdict": "判定を解除",
    "Tag…": "タグ…",
    "Rate…": "評価…",
    "Clear rating": "評価を解除",
    "Done": "完了",
    "Load more": "さらに読み込む",
    "No exposures match these filters.": "条件に一致する露光はありません。",
    "Could not load exposures:": "露光を読み込めませんでした:",
    "FITS only": "FITS のみ",
    "Raw only": "Raw のみ",
    "Not judged yet": "未判定",
    "Remove": "削除",
    "Your rating": "自分の評価",
    "Has your notes": "自分のメモあり",
    "Start (UTC)": "開始（UTC）",
    "Exposure time": "露光時間",
    "Exposure time (derived from NEXP)": "露光時間（NEXP から算出）",
    "Open in the port-8003 viewer (new tab)": "ポート 8003 のビューアで開く（新しいタブ）",
    "Viewer ↗": "ビューア ↗",
    "METADATA ONLY": "メタデータのみ",
    "no image files in folder": "フォルダーに画像ファイルがありません",
    "NO ACCESS": "アクセス不可",
    "files are not readable": "ファイルを読み取れません",
    "for your account": "（このアカウントでは）",
    "NOT SHARED": "非共有",
    "not readable by every account": "全アカウントからは読み取れません",
    "on the server": "（サーバー上）",
    "preview unavailable": "プレビューなし",

    // exposure page
    "Back to gallery (Esc)": "ギャラリーに戻る (Esc)",
    "Back": "戻る",
    "Where this exposure's files are on the server": "この露光のファイルのサーバー上の場所",
    "good": "良好",
    "junk": "不要",
    "unsure": "保留",
    "tag": "タグ",
    "skip": "スキップ",
    "stop": "終了",
    "Open this exposure in the image viewer on port 8003 (new tab)":
      "この露光をポート 8003 の画像ビューアで開く（新しいタブ）",
    "Open in": "ビューアで",
    "viewer ↗": "開く ↗",
    "Previous exposure (←)": "前の露光 (←)",
    "Previous": "前へ",
    "Next exposure (→)": "次の露光 (→)",
    "Next": "次へ",
    "Loading…": "読み込み中…",
    "loading…": "読み込み中…",
    "Exposure not found": "露光が見つかりません",

    // viewer toolbar
    "Sensor": "センサー",
    "Bin": "ビニング",
    "Stretch": "ストレッチ",
    "Linear": "線形",
    "Sqrt": "平方根",
    "Log": "対数",
    "Asinh": "Asinh",
    "Colors": "カラー",
    "Gray": "グレー",
    "Heat": "ヒート",
    "Viridis": "Viridis",
    "Subtract each column's median per sensor (display only)": "センサーごとに各列の中央値を差し引く（表示のみ）",
    "Flatten columns": "列ムラを補正",
    "Show the stretch controls (S)": "ストレッチ設定を表示 (S)",
    "Stretch controls": "ストレッチ設定",
    "Close (S)": "閉じる (S)",
    "Close": "閉じる",
    "Black = Offset − Factor × MAD, White = Offset + Factor × MAD (A)":
      "黒 = オフセット − 係数 × MAD、白 = オフセット + 係数 × MAD (A)",
    "Apply auto stretch": "自動ストレッチ",
    "Back to the defaults: auto stretch with Factor 5, gamma 1, not inverted, linear, gray":
      "初期設定に戻す: 自動ストレッチ（係数 5）、ガンマ 1、反転なし、線形、グレー",
    "Reset": "リセット",
    "Offset": "オフセット",
    "Range": "範囲",
    "Factor": "係数",
    "Multiplier for the auto stretch; changing it re-applies the auto stretch":
      "自動ストレッチの係数。変更すると自動ストレッチを再適用します",
    "Drag the markers to set black and white": "マーカーをドラッグして黒と白を設定",
    "Black": "黒",
    "White": "白",
    "Gamma": "ガンマ",
    "Fine steps near the background, coarse toward bright stars": "背景付近は細かく、明るい星に向かって粗く調整",
    "display = normalized ^ (1 / gamma); above 1 brightens mid-tones (double-click: 1)":
      "表示 = 正規化値 ^ (1 / ガンマ)。1 より大きいと中間調が明るくなります（ダブルクリックで 1）",
    "Invert": "反転",
    "On: the current stretch (auto or reset) is recomputed for every frame. Off: levels stay fixed while scrubbing, so brightness changes between frames are visible.":
      "オン: フレームごとにストレッチを再計算します。オフ: レベルを固定するので、フレーム間の明るさの変化がわかります。",
    "Re-stretch each frame": "フレームごとに再ストレッチ",
    "All sensors share the same tone scale.": "すべてのセンサーで同じ階調を使用しています。",
    "Zoom out": "縮小",
    "Fit to window (double-click)": "ウィンドウに合わせる（ダブルクリック）",
    "Reset zoom: 1 image pixel per screen pixel": "等倍表示: 画像 1 ピクセル = 画面 1 ピクセル",
    "Zoom in": "拡大",
    "📍 Pinned": "📍 固定",
    "Copy RA and Dec (C)": "赤経・赤緯をコピー (C)",
    "Copy": "コピー",
    "Remove the pin": "固定を解除",
    "Pixel": "ピクセル",
    "Value": "値",
    "From the WCS in this sensor's FITS header (J2000/ICRS)": "このセンサーの FITS ヘッダーの WCS より (J2000/ICRS)",
    "click to pin RA/Dec": "クリックで赤経・赤緯を固定",
    "no telescope pointing recorded: no RA/Dec": "望遠鏡の指向が記録されていないため赤経・赤緯はありません",
    "Previous frame ( [ )": "前のフレーム ( [ )",
    "Previous frame": "前のフレーム",
    "Play / pause (P)": "再生 / 一時停止 (P)",
    "Play": "再生",
    "Next frame ( ] )": "次のフレーム ( ] )",
    "Next frame": "次のフレーム",
    "Frame": "フレーム",
    "Some sensors stored more frames: pick one sensor to see them all.":
      "一部のセンサーにはさらに多くのフレームがあります。すべて見るにはセンサーを 1 つ選んでください。",
    "Reading image…": "画像を読み込み中…",
    "Not shared": "非共有",
    "These files aren't readable by every account on the server,": "これらのファイルはサーバー上のすべてのアカウントからは読み取れないため、",
    "so they're only available to the owner of this app.": "このアプリの所有者のみが利用できます。",
    "Metadata only": "メタデータのみ",
    "The folder has a meta.json for this exposure but no image files.": "この露光の meta.json はありますが、画像ファイルがありません。",
    "No read access": "読み取り権限なし",
    "These files exist but are not readable for your account.": "ファイルは存在しますが、このアカウントでは読み取れません。",
    "Ask the data owner to make them readable to see more.": "閲覧するにはデータの所有者に読み取り権限を依頼してください。",
    "No preview": "プレビューなし",
    "The image files for this exposure could not be read.": "この露光の画像ファイルを読み込めませんでした。",

    // annotations
    "Good (G)": "良好 (G)",
    "Junk: mark for deletion (J). Nothing is deleted by the app.": "不要: 削除候補としてマーク (J)。アプリが削除することはありません。",
    "Unsure (U)": "保留 (U)",
    "+ tag (T)": "+ タグ (T)",
    "Your rating (keys 1–5, 0 clears)": "自分の評価（キー 1〜5、0 で解除）",
    "Your notes on this exposure… (saved automatically)": "この露光についてのメモ…（自動保存）",
    "Remove this tag": "このタグを削除",
    "Others": "他のメンバー",
    "Verdict cleared": "判定を解除しました",
    "Tag added": "タグを追加しました",
    "Tag removed": "タグを削除しました",
    "All done: every photo here has your verdict.": "完了: ここにあるすべての写真を判定しました。",
    "Rating cleared": "評価を解除しました",
    "Added to collection": "コレクションに追加しました",
    "Saving…": "保存中…",
    "Saved": "保存しました",
    "Note saved": "メモを保存しました",
    "Could not save:": "保存できませんでした:",
    "No notes": "メモなし",

    // information tabs
    "Summary": "概要",
    "Header": "ヘッダー",
    "Telescope & weather": "望遠鏡・気象",
    "Files": "ファイル",
    "Find keyword…": "キーワードを検索…",
    "Observation": "観測",
    "Object": "天体",
    "Filter": "フィルター",
    "Night": "観測夜",
    "Start (local, MST)": "開始（現地時間 MST）",
    "(NEXP × line time)": "（NEXP × ライン時間）",
    "Frames": "フレーム数",
    "Readout mode": "読み出しモード",
    "Gain": "ゲイン",
    "Pointing": "指向",
    "RA": "赤経",
    "Dec": "赤緯",
    "Alt / Az": "高度 / 方位角",
    "Airmass": "エアマス",
    "Conditions": "観測条件",
    "Sensor temperature": "センサー温度",
    "Outside temperature": "外気温",
    "Outside humidity": "外気湿度",
    "Wind": "風速",
    "Folder": "フォルダー",
    "Exposure": "露光",
    "Sensors": "センサー",
    "Formats": "形式",
    "Total size": "合計サイズ",
    "Note": "注記",
    "Index warnings": "インデックスの警告",
    "Capture": "撮影設定",
    "Dome": "ドーム",
    "Weather station": "気象観測装置",
    "Full meta.json": "meta.json 全体",
    "Raw camera file: this is its JSON header.": "カメラの Raw ファイルです。以下はその JSON ヘッダーです。",
    "Reading header…": "ヘッダーを読み込み中…",
    "Copy the folder path": "フォルダーのパスをコピー",
    "Copy folder": "フォルダーをコピー",
    "Copy the full path of every file of this exposure, one per line": "この露光の全ファイルのフルパスを 1 行ずつコピー",
    "Copy file paths": "ファイルパスをコピー",
    "Copied ✓": "コピーしました ✓",
    "View this exposure in the existing image viewer:": "この露光を既存の画像ビューアで表示:",
    "Open in viewer ↗": "ビューアで開く ↗",
    "Downloads are the original files, byte for byte.": "ダウンロードされるのは元のファイルそのものです。",
    "Some files are very large": "一部のファイルは非常に大きいため",
    "; downloading over an SSH tunnel may take a long time.": "、SSH トンネル経由のダウンロードには時間がかかることがあります。",
    "Format": "形式",
    "Size": "サイズ",
    "Download": "ダウンロード",
    "no read access": "読み取り権限なし",
    "owner only": "所有者のみ",
    "Not readable by every account on the server": "サーバー上のすべてのアカウントからは読み取れません",
    "No readable files.": "読み取れるファイルがありません。",

    // dialogs
    "Share this view": "この画面を共有",
    "Works for anyone who has CMOS Browser installed on the server: they open it in Firefox in their remote desktop.":
      "サーバーに CMOS Browser をインストールしている人なら誰でも、自分のリモートデスクトップの Firefox で開けます。",
    "Copy link": "リンクをコピー",
    "Copied. Paste it into an email or chat.": "コピーしました。メールやチャットに貼り付けてください。",
    "New collection": "新しいコレクション",
    "Rename collection": "コレクション名を変更",
    "Name": "名前",
    "Description (optional)": "説明（任意）",
    "Cancel": "キャンセル",
    "Create": "作成",
    "Save": "保存",
    "Copy with Ctrl+C:": "Ctrl+C でコピーしてください:",
    "None of the selected exposures have .zst files. Some nights were stored uncompressed (.fits, .hpkcmos-pack). Choose \"Every file\" to get their paths.":
      "選択した露光には .zst ファイルがありません。非圧縮 (.fits, .hpkcmos-pack) で保存された夜もあります。パスを取得するには「全ファイル」を選んでください。",
    "The selected exposures have no files on the server.": "選択した露光にはサーバー上のファイルがありません。",

  };

  // Text with numbers or names in it. [pattern, replacement]
  const RULES = [
    [/^([\d,]+) exposures? · ([\d,]+) nights · (.+)$/, "$1露光 · $2夜 · $3"],
    [/^([\d,]+) exposures?$/, "$1件の露光"],
    [/^(\d+) selected$/, "$1件を選択中"],
    [/^(\d+) left$/, "残り$1件"],
    [/^(\d+) objects? · (\d+) with FITS · (.+)$/, "$1天体 · FITS $2件 · $3"],
    [/^(\d+) objects? · (.+)$/, "$1天体 · $2"],
    [/^(\d+) nights? · (.+) total$/, "$1夜 · 合計$2"],
    [/^(\d+) nights?$/, "$1夜"],
    [/^by (.+)$/, "使用者: $1"],
    [/^synced (\d+) min ago$/, "$1分前に同期"],
    [/^Index last updated: (.+)\nChecks for new data every (\d+) min$/s, "インデックス最終更新: $1\n$2分ごとに新しいデータを確認"],
    [/^Index last updated: (.+)$/, "インデックス最終更新: $1"],
    [/^Last sync failed: (.*)$/s, "前回の同期に失敗しました: $1"],
    [/^Filter (.+)$/, "フィルター $1"],
    [/^From (.+)$/, "$1から"],
    [/^To (.+)$/, "$1まで"],
    [/^Exp ≥ (.+) s$/, "露光 ≥ $1秒"],
    [/^Exp ≤ (.+) s$/, "露光 ≤ $1秒"],
    [/^Mode (.+)$/, "モード $1"],
    [/^Collection (\d+)$/, "コレクション $1"],
    [/^Exported paths for (\d+) selected exposures?$/, "選択した$1件の露光のパスを書き出しました"],
    [/^Exporting paths for ([\d,]+) exposures?$/, "$1件の露光のパスを書き出し中"],
    [/^Added (\d+) to “(.+)”$/, "「$2」に$1件追加しました"],
    [/^Removed (\d+) from the collection \(the data is not affected\)$/, "コレクションから$1件外しました（データには影響しません）"],
    [/^Tag for the (\d+) selected photos? \(start with - to remove a tag\):$/, "選択した$1枚に付けるタグ（先頭に「-」を付けると削除）："],
    [/^Delete the collection “(.+)”\?\n\nOnly the collection is removed\. The exposures and the data files are not affected\.$/s,
      "コレクション「$1」を削除しますか？\n\n削除されるのはコレクションのみです。露光とデータファイルには影響しません。"],
    [/^Rated (\d)★$/, "★$1を付けました"],
    [/^(\d) stars?$/, "★$1"],
    [/^In (\d+) collections?$/, "$1件のコレクションに登録"],
    [/^(✅ Good|🗑 Junk|❔ Unsure): (\d+)$/, (m, v, n) => `${JA[v]}: ${n}`],
    [/^ \(yours: (✅ Good|🗑 Junk|❔ Unsure)\)$/, (m, v) => `（自分: ${JA[v]}）`],
    [/^(✅ Good|🗑 Junk|❔ Unsure): (\d+) \(yours: (✅ Good|🗑 Junk|❔ Unsure)\)$/, (m, v, n, y) => `${JA[v]}: ${n}（自分: ${JA[y]}）`],
    [/^(✅|🗑|❔) (\d+)$/, "$1 $2"],
    [/^· (.+)$/, (m, x) => "· " + tr(x)],
    [/^Sensor (\d+) · (.+)$/, "センサー $1 · $2"],
    [/^Sensor (\d+)$/, "センサー $1"],
    [/^All (\d+)$/, "すべて ($1)"],
    [/^of ([\d,]+) \(all sensors\)$/, "/ $1（全センサー）"],
    [/^of ([\d,]+)$/, "/ $1"],
    [/^\((all sensors|1 sensor), binned (\d+)×(\d+)\)$/, (m, s, a, b) => `（${s === "all sensors" ? "全センサー" : "センサー 1 つ"}、${a}×${b} ビニング）`],
    [/^mean of (\d+)×(\d+)$/, "$1×$2 の平均"],
    [/^sensor (\d+) \((.+)\)$/, "センサー $1 ($2)"],
    [/^Telescope \(first of (\d+) samples\)$/, "望遠鏡（$1 サンプル中の最初）"],
    [/^(\d+) \((\d+) with preview, (\d+) in FITS\)$/, "$1（プレビュー可 $2、FITS $3）"],
    [/^([\d,]+) captured · ([\d,]+) stored in file$/, "撮影 $1 · ファイル内 $2"],
    [/^code (.+)$/, "コード $1"],
    [/^\(code (.+)\)$/, "（コード $1）"],
    [/^Could not save: (.*)$/s, "保存できませんでした: $1"],
    [/^Could not load exposures: (.*)$/s, "露光を読み込めませんでした: $1"],
  ];

  // Data, not interface: never translate inside these.
  const SKIP = "#langBtn, .jcal, .jdate, pre, code, textarea, .mono, .card-title, .sidebar li .name, .chip.tag, .card-tags, .other b, .other-note, #dTitle, #hdrBody, #metaBody td, .files td.mono";

  function tr(s) {
    if (typeof s !== "string") return s;
    const t = s.trim();
    if (!t || !/[A-Za-z]/.test(t)) return s;
    let out = JA[t];
    if (out === undefined) {
      for (const [re, rep] of RULES) if (re.test(t)) { out = t.replace(re, rep); break; }
    }
    if (out === undefined) return s;
    const lead = s.match(/^\s*/)[0], tail = s.match(/\s*$/)[0];
    return lead + out + tail;
  }
  window.I18N.t = tr;

  const ATTRS = ["title", "placeholder", "aria-label"];
  function skip(node) {
    const el = node.nodeType === 1 ? node : node.parentElement;
    return !el || el.closest(SKIP);
  }
  function translateText(node) {
    if (skip(node)) return;
    const v = tr(node.data);
    if (v !== node.data) node.data = v;
  }
  function translateAttrs(el) {
    if (el.closest("#langBtn")) return;
    for (const a of ATTRS) {
      const v = el.getAttribute(a);
      if (v) { const n = tr(v); if (n !== v) el.setAttribute(a, n); }
    }
  }
  function walk(root) {
    if (root.nodeType === 3) return translateText(root);
    if (root.nodeType !== 1) return;
    translateAttrs(root);
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    for (let n = w.nextNode(); n; n = w.nextNode()) n.nodeType === 3 ? translateText(n) : translateAttrs(n);
  }

  // Messages shown in browser dialogs.
  const _alert = window.alert.bind(window), _confirm = window.confirm.bind(window), _prompt = window.prompt.bind(window);
  window.alert = (m) => _alert(tr(String(m)));
  window.confirm = (m) => _confirm(tr(String(m)));
  window.prompt = (m, d) => _prompt(tr(String(m)), d);

  // Date fields: Firefox draws <input type=date> in its own language, so in Japanese mode
  // the native field is hidden and replaced by a button that opens a Japanese calendar
  // (weeks start on Sunday; Sundays red, Saturdays blue). The hidden field keeps the
  // ISO value and fires "change", so the rest of the app is unaware of the swap.
  const WD = "日月火水木金土";
  const pad = (n) => String(n).padStart(2, "0");
  const iso = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
  const label = (v) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v || "")) return "";
    const [y, m, d] = v.split("-").map(Number);
    return `${y}/${pad(m)}/${pad(d)}(${WD[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]})`;
  };
  let openCal = null;
  function closeCal() { openCal?.remove(); openCal = null; }
  function showCal(input, btn) {
    closeCal();
    const cur = /^\d{4}-\d{2}-\d{2}$/.test(input.value) ? input.value.split("-").map(Number) : null;
    const now = new Date();
    let y = cur ? cur[0] : now.getFullYear(), m = cur ? cur[1] - 1 : now.getMonth();
    const cal = document.createElement("div");
    cal.className = "jcal";
    const pick = (v) => { input.value = v; input.dispatchEvent(new Event("change", { bubbles: true })); closeCal(); btn.focus(); };
    const draw = () => {
      const first = new Date(y, m, 1).getDay(), days = new Date(y, m + 1, 0).getDate();
      const today = iso(now.getFullYear(), now.getMonth(), now.getDate());
      let cells = "";
      for (let i = 0; i < first; i++) cells += "<span></span>";
      for (let d = 1; d <= days; d++) {
        const v = iso(y, m, d), wd = (first + d - 1) % 7;
        const cls = [wd === 0 ? "sun" : wd === 6 ? "sat" : "", v === input.value ? "sel" : "", v === today ? "today" : ""].join(" ");
        cells += `<button type="button" class="${cls}" data-v="${v}">${d}</button>`;
      }
      cal.innerHTML = `<div class="jcal-head"><button type="button" data-nav="-1" aria-label="前の月">‹</button>
          <b>${y}年${m + 1}月</b><button type="button" data-nav="1" aria-label="次の月">›</button></div>
        <div class="jcal-grid">${[...WD].map((w, i) => `<i class="${i === 0 ? "sun" : i === 6 ? "sat" : ""}">${w}</i>`).join("")}${cells}</div>
        <div class="jcal-foot"><button type="button" data-act="today">今日</button><button type="button" data-act="clear">クリア</button></div>`;
    };
    cal.onclick = (ev) => {
      ev.stopPropagation();
      const b = ev.target.closest("button");
      if (!b) return;
      if (b.dataset.nav) { m += +b.dataset.nav; if (m < 0) { m = 11; y--; } if (m > 11) { m = 0; y++; } draw(); }
      else if (b.dataset.v) pick(b.dataset.v);
      else if (b.dataset.act === "today") pick(iso(now.getFullYear(), now.getMonth(), now.getDate()));
      else if (b.dataset.act === "clear") pick("");
    };
    draw();
    document.body.append(cal);
    // Below the field if it fits, else above, else beside it; always kept inside the window
    // (on a short window the calendar scrolls inside itself).
    const M = 8, r = btn.getBoundingClientRect();
    if (cal.offsetHeight > innerHeight - 2 * M) { cal.style.maxHeight = innerHeight - 2 * M + "px"; cal.style.overflowY = "auto"; }
    const W = cal.offsetWidth, H = cal.offsetHeight;
    let left = r.left, top;
    if (r.bottom + 4 + H <= innerHeight - M) top = r.bottom + 4;
    else if (r.top - 4 - H >= M) top = r.top - 4 - H;
    else { left = r.right + 6 + W <= innerWidth - M ? r.right + 6 : r.left; top = r.top + r.height / 2 - H / 2; }
    cal.style.left = Math.max(M, Math.min(left, innerWidth - W - M)) + "px";
    cal.style.top = Math.max(M, Math.min(top, innerHeight - H - M)) + "px";
    openCal = cal;
  }
  document.addEventListener("click", (ev) => { if (openCal && !ev.target.closest(".jcal, .jdate")) closeCal(); });
  document.addEventListener("keydown", (ev) => { if (ev.key === "Escape" && openCal) { ev.stopPropagation(); closeCal(); } }, true);
  addEventListener("resize", closeCal);
  document.addEventListener("scroll", closeCal, true);

  function japaneseDateInput(input) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "jdate";
    const show = () => {
      const t = label(input.value);
      btn.textContent = t || "日付を選択";
      btn.classList.toggle("empty", !t);
    };
    // The app sets .value directly when the address changes; keep the button in step.
    const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
    Object.defineProperty(input, "value", {
      get() { return desc.get.call(this); },
      set(v) { desc.set.call(this, v); show(); },
    });
    btn.onclick = (ev) => { ev.stopPropagation(); openCal ? closeCal() : showCal(input, btn); };
    input.hidden = true;
    input.after(btn);
    show();
  }

  const start = () => {
    document.querySelectorAll("input[type=date]").forEach(japaneseDateInput);
    walk(document.body);
    new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type === "childList") m.addedNodes.forEach(walk);
        else if (m.type === "characterData") translateText(m.target);
        else if (m.type === "attributes") translateAttrs(m.target);
      }
    }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  };
  if (document.body) start(); else document.addEventListener("DOMContentLoaded", start);
})();
