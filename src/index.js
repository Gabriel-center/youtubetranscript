// YouTube Transcript — single-file Cloudflare Worker
//   GET /                      → the web page
//   GET /api/transcript?v=…    → JSON transcript  (&track=<id>  &tlang=<code>)
//   GET /manifest.webmanifest  → lets you "install" the page and share YouTube links to it (Android)
//
// The browser can't read YouTube directly (CORS), so this Worker fetches the captions
// server-side and hands them to the page. Three methods are tried in order:
//   1. Innertube player API (Android client) → caption track → timedtext
//   2. Caption tracks embedded in the watch page → timedtext
//   3. The "Show transcript" panel endpoint (get_transcript)

const PAGE = "<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1, viewport-fit=cover\">\n<title>YouTube Transcript</title>\n<meta name=\"description\" content=\"Paste a YouTube link, get the full transcript.\">\n<meta name=\"theme-color\" content=\"#111214\" media=\"(prefers-color-scheme: dark)\">\n<meta name=\"theme-color\" content=\"#f6f5f2\" media=\"(prefers-color-scheme: light)\">\n<link rel=\"manifest\" href=\"/manifest.webmanifest\">\n<link rel=\"icon\" href=\"/icon.svg\" type=\"image/svg+xml\">\n<link rel=\"apple-touch-icon\" href=\"/icon.svg\">\n<script>document.documentElement.className += \" js\";</script>\n<style>\n  .js #ssr { display: none; }\n  #ssr .transcript { border-top: 0; }\n  #ssr h2 { font-size: 1.15rem; margin: 14px 0 4px; }\n  :root {\n    --bg: #f6f5f2; --panel: #ffffff; --ink: #1b1c1e; --muted: #6b6e74; --line: #e3e1dc;\n    --accent: #d93a31; --accent-ink: #fff; --soft: #f0eee9; --mark: #ffe58a; --err: #b3261e; --err-bg: #fdecea;\n    --radius: 14px;\n    color-scheme: light;\n  }\n  @media (prefers-color-scheme: dark) {\n    :root {\n      --bg: #111214; --panel: #1a1b1e; --ink: #ecebe7; --muted: #9a9ca2; --line: #2a2c30;\n      --accent: #ff5b4f; --accent-ink: #fff; --soft: #232428; --mark: #6b5a12; --err: #ffb4ab; --err-bg: #3a1714;\n      color-scheme: dark;\n    }\n  }\n  * { box-sizing: border-box; }\n  html { -webkit-text-size-adjust: 100%; }\n  body {\n    margin: 0; background: var(--bg); color: var(--ink);\n    font: 16px/1.55 ui-sans-serif, system-ui, -apple-system, \"Segoe UI\", Roboto, sans-serif;\n    padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);\n  }\n  main { max-width: 760px; margin: 0 auto; padding: 20px 16px 120px; }\n  h1 { font-size: 1.35rem; margin: 6px 0 2px; letter-spacing: -0.01em; display: flex; align-items: center; gap: 10px; }\n  h1 svg { width: 28px; height: 28px; flex: none; }\n  .sub { color: var(--muted); margin: 0 0 18px; font-size: .95rem; }\n\n  form { display: flex; gap: 8px; }\n  .field { position: relative; flex: 1; min-width: 0; }\n  input[type=text] {\n    width: 100%; font: inherit; color: inherit; background: var(--panel);\n    border: 1px solid var(--line); border-radius: var(--radius); padding: 13px 76px 13px 14px; outline: none;\n  }\n  input[type=text]:focus { border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 20%, transparent); }\n  .paste {\n    position: absolute; right: 6px; top: 50%; transform: translateY(-50%);\n    border: 0; background: var(--soft); color: var(--ink); font: inherit; font-size: .85rem;\n    padding: 6px 10px; border-radius: 9px; cursor: pointer;\n  }\n  button.primary {\n    border: 0; background: var(--accent); color: var(--accent-ink); font: inherit; font-weight: 600;\n    padding: 0 18px; border-radius: var(--radius); cursor: pointer; min-height: 48px;\n  }\n  button.primary:disabled { opacity: .6; cursor: default; }\n\n  .status { margin: 18px 0 0; color: var(--muted); display: flex; align-items: center; gap: 10px; }\n  .spinner { width: 18px; height: 18px; border: 2px solid var(--line); border-top-color: var(--accent); border-radius: 50%; animation: spin .8s linear infinite; }\n  @keyframes spin { to { transform: rotate(360deg); } }\n  .error { margin-top: 18px; background: var(--err-bg); color: var(--err); border-radius: var(--radius); padding: 14px 16px; }\n  .error details { margin-top: 8px; font-size: .85rem; opacity: .9; }\n  .error pre { white-space: pre-wrap; margin: 6px 0 0; font-size: .8rem; }\n\n  .card { margin-top: 20px; background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); overflow: hidden; }\n  .video { display: flex; gap: 14px; padding: 14px; align-items: center; }\n  .video img { width: 132px; aspect-ratio: 16/9; object-fit: cover; border-radius: 9px; flex: none; background: var(--soft); }\n  .video .t { font-weight: 650; line-height: 1.3; }\n  .video .m { color: var(--muted); font-size: .88rem; margin-top: 4px; }\n  .video a { color: inherit; text-decoration: none; }\n  @media (max-width: 460px) { .video img { width: 104px; } .video .t { font-size: .95rem; } }\n\n  .controls { display: flex; flex-wrap: wrap; gap: 8px; padding: 12px 14px; border-top: 1px solid var(--line); }\n  select, .toggle {\n    font: inherit; font-size: .88rem; color: inherit; background: var(--soft); border: 1px solid transparent;\n    border-radius: 10px; padding: 7px 10px; max-width: 100%;\n  }\n  .toggle { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; user-select: none; }\n  .toggle input { accent-color: var(--accent); margin: 0; }\n  .search { flex: 1 1 160px; font: inherit; font-size: .88rem; color: inherit; background: var(--soft); border: 1px solid transparent; border-radius: 10px; padding: 7px 10px; outline: none; min-width: 0; }\n  .search:focus { border-color: var(--accent); }\n  .note { padding: 0 14px 10px; color: var(--muted); font-size: .85rem; }\n\n  .transcript { padding: 6px 14px 18px; border-top: 1px solid var(--line); font-size: 1rem; }\n  .transcript p { margin: 12px 0; }\n  .transcript .line { margin: 6px 0; }\n  .ts {\n    display: inline-block; min-width: 3.4em; margin-right: 8px; font: 500 .8rem/1.6 ui-monospace, SFMono-Regular, Menlo, monospace;\n    color: var(--accent); text-decoration: none; vertical-align: 1px;\n  }\n  .hide-ts .ts { display: none; }\n  mark { background: var(--mark); color: inherit; border-radius: 3px; }\n  .stats { color: var(--muted); font-size: .82rem; padding: 0 14px 12px; }\n\n  .bar {\n    position: fixed; left: 0; right: 0; bottom: 0; z-index: 5;\n    background: color-mix(in srgb, var(--bg) 88%, transparent); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);\n    border-top: 1px solid var(--line); padding: 10px 12px calc(10px + env(safe-area-inset-bottom));\n  }\n  .bar .in { max-width: 760px; margin: 0 auto; display: flex; gap: 8px; overflow-x: auto; scrollbar-width: none; }\n  .bar button {\n    flex: 1 0 auto; border: 1px solid var(--line); background: var(--panel); color: var(--ink); font: inherit; font-size: .9rem; font-weight: 550;\n    border-radius: 12px; padding: 10px 14px; cursor: pointer; white-space: nowrap;\n  }\n  .bar button.main { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); }\n  .toast {\n    position: fixed; left: 50%; bottom: calc(84px + env(safe-area-inset-bottom)); transform: translateX(-50%) translateY(10px);\n    background: var(--ink); color: var(--bg); padding: 9px 16px; border-radius: 999px; font-size: .9rem;\n    opacity: 0; pointer-events: none; transition: .2s; z-index: 10;\n  }\n  .toast.on { opacity: 1; transform: translateX(-50%) translateY(0); }\n  [hidden] { display: none !important; }\n  .foot { color: var(--muted); font-size: .8rem; margin-top: 28px; }\n</style>\n</head>\n<body>\n<main>\n  <h1>\n    <svg viewBox=\"0 0 512 512\" aria-hidden=\"true\"><rect width=\"512\" height=\"512\" rx=\"112\" fill=\"#e8453c\"/><path d=\"M200 160v192l160-96z\" fill=\"#fff\"/><rect x=\"120\" y=\"390\" width=\"272\" height=\"22\" rx=\"11\" fill=\"#fff\" opacity=\".85\"/><rect x=\"160\" y=\"428\" width=\"192\" height=\"22\" rx=\"11\" fill=\"#fff\" opacity=\".6\"/></svg>\n    YouTube Transcript\n  </h1>\n  <p class=\"sub\">Paste a link and get the whole transcript to read, copy or download.</p>\n\n  <form id=\"form\" autocomplete=\"off\">\n    <div class=\"field\">\n      <input id=\"url\" type=\"text\" inputmode=\"url\" placeholder=\"https://youtu.be/…\" aria-label=\"YouTube link\" spellcheck=\"false\">\n      <button type=\"button\" class=\"paste\" id=\"paste\">Paste</button>\n    </div>\n    <button class=\"primary\" id=\"go\" type=\"submit\">Get</button>\n  </form>\n\n  <div class=\"status\" id=\"status\" hidden><div class=\"spinner\"></div><span>Fetching captions…</span></div>\n  <div class=\"error\" id=\"error\" hidden></div>\n\n  <section class=\"card\" id=\"result\" hidden>\n    <div class=\"video\">\n      <a id=\"thumbLink\" target=\"_blank\" rel=\"noopener\"><img id=\"thumb\" alt=\"\"></a>\n      <div>\n        <div class=\"t\"><a id=\"title\" target=\"_blank\" rel=\"noopener\"></a></div>\n        <div class=\"m\" id=\"meta\"></div>\n      </div>\n    </div>\n    <div class=\"controls\">\n      <select id=\"track\" aria-label=\"Caption track\"></select>\n      <select id=\"tlang\" aria-label=\"Translate to\"></select>\n      <label class=\"toggle\"><input type=\"checkbox\" id=\"showTs\" checked> Timestamps</label>\n      <label class=\"toggle\"><input type=\"checkbox\" id=\"paras\" checked> Paragraphs</label>\n      <input class=\"search\" id=\"search\" type=\"search\" placeholder=\"Find in transcript\" aria-label=\"Find in transcript\">\n    </div>\n    <div class=\"note\" id=\"note\" hidden></div>\n    <div class=\"stats\" id=\"stats\"></div>\n    <div class=\"transcript\" id=\"text\"></div>\n  </section>\n\n  <!--SSR-->\n\n  <p class=\"foot\">On Android you can install this page (browser menu → Add to Home screen / Install) and then share videos straight to it from the YouTube app.</p>\n</main>\n\n<div class=\"bar\" id=\"bar\" hidden>\n  <div class=\"in\">\n    <button class=\"main\" id=\"copy\">Copy</button>\n    <button id=\"share\">Share</button>\n    <button id=\"dlTxt\">.txt</button>\n    <button id=\"dlSrt\">.srt</button>\n    <button id=\"dlMd\">.md</button>\n  </div>\n</div>\n<div class=\"toast\" id=\"toast\"></div>\n\n<script>\n(function () {\n  \"use strict\";\n  var $ = function (id) { return document.getElementById(id); };\n  var data = null;   // last API response\n  var busy = false;\n\n  // ---------- helpers ----------\n  function fmt(sec) {\n    sec = Math.max(0, Math.floor(sec));\n    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;\n    var mm = h ? String(m).padStart(2, \"0\") : String(m);\n    return (h ? h + \":\" : \"\") + mm + \":\" + String(s).padStart(2, \"0\");\n  }\n  function srtTime(sec) {\n    var ms = Math.round(sec * 1000);\n    var h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60, r = ms % 1000;\n    return String(h).padStart(2, \"0\") + \":\" + String(m).padStart(2, \"0\") + \":\" + String(s).padStart(2, \"0\") + \",\" + String(r).padStart(3, \"0\");\n  }\n  function esc(s) {\n    return String(s).replace(/[&<>\"']/g, function (c) { return { \"&\": \"&amp;\", \"<\": \"&lt;\", \">\": \"&gt;\", '\"': \"&quot;\", \"'\": \"&#39;\" }[c]; });\n  }\n  function toast(msg) {\n    var t = $(\"toast\"); t.textContent = msg; t.classList.add(\"on\");\n    clearTimeout(toast._t); toast._t = setTimeout(function () { t.classList.remove(\"on\"); }, 1800);\n  }\n  function safeName(s) {\n    return (s || \"transcript\").replace(/[\\\\/:*?\"<>|]+/g, \" \").replace(/\\s+/g, \" \").trim().slice(0, 90) || \"transcript\";\n  }\n  function findId(text) {\n    text = String(text || \"\").trim();\n    if (/^[A-Za-z0-9_-]{11}$/.test(text)) return text;\n    var m = text.match(/(?:[?&]v=|youtu\\.be\\/|\\/shorts\\/|\\/embed\\/|\\/live\\/)([A-Za-z0-9_-]{11})/);\n    return m ? m[1] : null;\n  }\n\n  // Group caption lines into readable paragraphs.\n  function paragraphs(segs, auto) {\n    var out = [], cur = null;\n    for (var i = 0; i < segs.length; i++) {\n      var s = segs[i], prev = segs[i - 1];\n      var gap = prev ? s.s - (prev.s + prev.d) : 0;\n      var brk = !cur || gap > 2.5 ||\n        (!auto && cur.len > 380 && /[.!?…][\"')\\]]?$/.test(prev.t)) ||\n        (auto && s.s - cur.s > 40) || cur.len > 1400;\n      if (brk) { cur = { s: s.s, parts: [], len: 0 }; out.push(cur); }\n      cur.parts.push(s.t); cur.len += s.t.length + 1;\n    }\n    return out.map(function (p) { return { s: p.s, t: p.parts.join(\" \").replace(/\\s+/g, \" \") }; });\n  }\n\n  function blocks() {\n    if (!data) return [];\n    return $(\"paras\").checked ? paragraphs(data.segments, data.track && data.track.auto) : data.segments;\n  }\n\n  function plainText(withTs) {\n    var sep = $(\"paras\").checked ? \"\\n\\n\" : \"\\n\";\n    return blocks().map(function (b) { return (withTs ? \"[\" + fmt(b.s) + \"] \" : \"\") + b.t; }).join(sep);\n  }\n\n  // ---------- rendering ----------\n  function render() {\n    if (!data) return;\n    var q = $(\"search\").value.trim();\n    var re = q ? new RegExp(\"(\" + q.replace(/[.*+?^${}()|[\\]\\\\]/g, \"\\\\/* __PAGE__ */\") + \")\", \"gi\") : null;\n    var isPara = $(\"paras\").checked;\n    var hits = 0, html = [];\n    blocks().forEach(function (b) {\n      var body = esc(b.t);\n      if (re) {\n        var n = (b.t.match(re) || []).length;\n        if (!n) return;\n        hits += n;\n        body = body.replace(re, \"<mark>$1</mark>\");\n      }\n      var ts = '<a class=\"ts\" href=\"https://youtu.be/' + data.id + \"?t=\" + Math.floor(b.s) + '\" target=\"_blank\" rel=\"noopener\">' + fmt(b.s) + \"</a>\";\n      html.push(isPara ? \"<p>\" + ts + body + \"</p>\" : '<div class=\"line\">' + ts + body + \"</div>\");\n    });\n    $(\"text\").innerHTML = html.join(\"\") || '<p style=\"color:var(--muted)\">No matches.</p>';\n    $(\"text\").classList.toggle(\"hide-ts\", !$(\"showTs\").checked);\n\n    var words = data.segments.reduce(function (n, s) { return n + s.t.split(/\\s+/).length; }, 0);\n    $(\"stats\").textContent = (q ? hits + \" match\" + (hits === 1 ? \"\" : \"es\") + \" · \" : \"\") +\n      words.toLocaleString() + \" words · about \" + Math.max(1, Math.round(words / 230)) + \" min read\";\n  }\n\n  function show(d) {\n    data = d;\n    $(\"result\").hidden = false; $(\"bar\").hidden = false;\n    var link = \"https://youtu.be/\" + d.id;\n    $(\"thumb\").src = \"https://i.ytimg.com/vi/\" + d.id + \"/mqdefault.jpg\";\n    $(\"thumbLink\").href = link; $(\"title\").href = link;\n    $(\"title\").textContent = d.title || d.id;\n    var bits = [];\n    if (d.author) bits.push(d.author);\n    if (d.lengthSeconds) bits.push(fmt(d.lengthSeconds));\n    if (d.track) bits.push(d.track.name + (d.track.auto && !/auto/i.test(d.track.name) ? \" (auto)\" : \"\"));\n    if (d.tlang) bits.push(\"→ \" + ((d.translations || []).filter(function (l) { return l.code === d.tlang; })[0] || { name: d.tlang }).name);\n    $(\"meta\").textContent = bits.join(\" · \");\n\n    // track picker\n    var tr = $(\"track\");\n    tr.innerHTML = (d.tracks || []).map(function (t) {\n      var label = t.name + (t.auto && !/auto/i.test(t.name) ? \" (auto)\" : \"\");\n      return '<option value=\"' + esc(t.id) + '\"' + (d.track && d.track.id === t.id ? \" selected\" : \"\") + \">\" + esc(label) + \"</option>\";\n    }).join(\"\");\n    tr.hidden = !(d.tracks && d.tracks.length > 1);\n\n    // translation picker\n    var tl = $(\"tlang\");\n    var canTranslate = d.track && d.track.translatable && d.translations && d.translations.length;\n    tl.innerHTML = '<option value=\"\">Translate…</option>' + (canTranslate ? d.translations.map(function (l) {\n      return '<option value=\"' + esc(l.code) + '\"' + (d.tlang === l.code ? \" selected\" : \"\") + \">\" + esc(l.name) + \"</option>\";\n    }).join(\"\") : \"\");\n    tl.hidden = !canTranslate;\n\n    $(\"note\").hidden = !d.note; $(\"note\").textContent = d.note || \"\";\n    render();\n  }\n\n  function showError(body) {\n    var e = $(\"error\");\n    var msg = (body && body.error) || \"Something went wrong.\";\n    var tries = body && body.attempts && body.attempts.length\n      ? \"<details><summary>What was tried</summary><pre>\" + esc(body.attempts.join(\"\\n\")) + \"</pre></details>\" : \"\";\n    e.innerHTML = esc(msg) + tries;\n    e.hidden = false;\n  }\n\n  // ---------- fetching ----------\n  function load(id, opts) {\n    if (busy) return;\n    opts = opts || {};\n    busy = true;\n    $(\"go\").disabled = true; $(\"error\").hidden = true; $(\"status\").hidden = false;\n    if (!opts.keep) { $(\"result\").hidden = true; $(\"bar\").hidden = true; }\n\n    var qs = \"v=\" + encodeURIComponent(id);\n    if (opts.track) qs += \"&track=\" + encodeURIComponent(opts.track);\n    if (opts.tlang) qs += \"&tlang=\" + encodeURIComponent(opts.tlang);\n\n    fetch(\"/api/transcript?\" + qs)\n      .then(function (r) { return r.json().catch(function () { return { ok: false, error: \"Server returned \" + r.status }; }); })\n      .then(function (body) {\n        if (!body.ok) { showError(body); return; }\n        show(body);\n        try { history.replaceState(null, \"\", \"/\" + id); } catch (e) {}\n        document.title = (body.title ? body.title + \" — \" : \"\") + \"Transcript\";\n      })\n      .catch(function () { showError({ error: \"Couldn't reach the server. Check your connection and try again.\" }); })\n      .then(function () { busy = false; $(\"go\").disabled = false; $(\"status\").hidden = true; });\n  }\n\n  // ---------- downloads / sharing ----------\n  function download(name, text, type) {\n    var blob = new Blob([text], { type: type + \";charset=utf-8\" });\n    var a = document.createElement(\"a\");\n    a.href = URL.createObjectURL(blob); a.download = name;\n    document.body.appendChild(a); a.click();\n    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);\n  }\n  function header() {\n    return (data.title || data.id) + \"\\n\" + (data.author ? data.author + \"\\n\" : \"\") + \"https://youtu.be/\" + data.id + \"\\n\\n\";\n  }\n\n  $(\"copy\").onclick = function () {\n    var text = plainText($(\"showTs\").checked);\n    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject())\n      .then(function () { toast(\"Copied\"); })\n      .catch(function () {\n        var ta = document.createElement(\"textarea\"); ta.value = text; document.body.appendChild(ta);\n        ta.select(); try { document.execCommand(\"copy\"); toast(\"Copied\"); } catch (e) { toast(\"Couldn't copy\"); } ta.remove();\n      });\n  };\n  $(\"share\").onclick = function () {\n    var text = header() + plainText($(\"showTs\").checked);\n    var file = null;\n    try { file = new File([text], safeName(data.title) + \".txt\", { type: \"text/plain\" }); } catch (e) {}\n    if (file && navigator.canShare && navigator.canShare({ files: [file] })) {\n      navigator.share({ files: [file], title: data.title }).catch(function () {});\n    } else if (navigator.share) {\n      navigator.share({ title: data.title, text: text }).catch(function () {});\n    } else { $(\"copy\").onclick(); }\n  };\n  $(\"dlTxt\").onclick = function () { download(safeName(data.title) + \".txt\", header() + plainText($(\"showTs\").checked), \"text/plain\"); };\n  $(\"dlMd\").onclick = function () {\n    var md = \"# \" + (data.title || data.id) + \"\\n\\n\" + (data.author ? \"**\" + data.author + \"** · \" : \"\") + \"[Watch on YouTube](https://youtu.be/\" + data.id + \")\\n\\n\";\n    md += blocks().map(function (b) {\n      return ($(\"showTs\").checked ? \"[\" + fmt(b.s) + \"](https://youtu.be/\" + data.id + \"?t=\" + Math.floor(b.s) + \") \" : \"\") + b.t;\n    }).join($(\"paras\").checked ? \"\\n\\n\" : \"  \\n\");\n    download(safeName(data.title) + \".md\", md + \"\\n\", \"text/markdown\");\n  };\n  $(\"dlSrt\").onclick = function () {\n    var segs = data.segments;\n    var srt = segs.map(function (s, i) {\n      var next = segs[i + 1];\n      var end = s.s + (s.d || 2);\n      if (next && end > next.s) end = next.s;\n      if (end <= s.s) end = s.s + 0.5;\n      return (i + 1) + \"\\n\" + srtTime(s.s) + \" --> \" + srtTime(end) + \"\\n\" + s.t + \"\\n\";\n    }).join(\"\\n\");\n    download(safeName(data.title) + \".srt\", srt, \"application/x-subrip\");\n  };\n\n  // ---------- events ----------\n  $(\"form\").onsubmit = function (e) {\n    e.preventDefault();\n    var id = findId($(\"url\").value);\n    if (!id) { showError({ error: \"That doesn't look like a YouTube link.\" }); return; }\n    $(\"url\").blur();\n    load(id);\n  };\n  $(\"paste\").onclick = function () {\n    if (!navigator.clipboard || !navigator.clipboard.readText) { $(\"url\").focus(); return; }\n    navigator.clipboard.readText().then(function (t) {\n      $(\"url\").value = t.trim();\n      if (findId(t)) $(\"form\").requestSubmit ? $(\"form\").requestSubmit() : $(\"go\").click();\n    }).catch(function () { $(\"url\").focus(); });\n  };\n  $(\"track\").onchange = function () { load(data.id, { track: this.value, keep: true }); };\n  $(\"tlang\").onchange = function () { load(data.id, { track: data.track && data.track.id, tlang: this.value, keep: true }); };\n  $(\"showTs\").onchange = render;\n  $(\"paras\").onchange = render;\n  $(\"search\").oninput = render;\n\n  // The server already rendered this video's transcript into the page\n  var initial = window.__INITIAL__;\n  if (initial) {\n    var ssr = $(\"ssr\"); if (ssr) ssr.remove();\n    if (initial.id) $(\"url\").value = \"https://youtu.be/\" + initial.id;\n    if (initial.ok) {\n      show(initial);\n      document.title = (initial.title ? initial.title + \" — \" : \"\") + \"Transcript\";\n    } else showError(initial);\n    return;\n  }\n\n  // Otherwise auto-load from ?v= / ?url= / shared text\n  var p = new URLSearchParams(location.search);\n  var start = findId(p.get(\"v\")) || findId(p.get(\"url\")) || findId(p.get(\"text\")) || findId(p.get(\"title\"));\n  if (start) { $(\"url\").value = \"https://youtu.be/\" + start; load(start); }\n})();\n</script>\n</body>\n</html>\n";

const WEB_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const ANDROID_VERSION = "20.10.38";
const ANDROID_UA = `com.google.android.youtube/${ANDROID_VERSION} (Linux; U; Android 11) gzip`;
const FALLBACK_KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";
const FALLBACK_WEB_VERSION = "2.20250101.00.00";
const CACHE_SECONDS = 6 * 3600;

const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="#e8453c"/><path d="M200 160v192l160-96z" fill="#fff"/><rect x="120" y="390" width="272" height="22" rx="11" fill="#fff" opacity=".85"/><rect x="160" y="428" width="192" height="22" rx="11" fill="#fff" opacity=".6"/></svg>`;

const MANIFEST = {
  name: "YouTube Transcript",
  short_name: "Transcript",
  start_url: "/",
  scope: "/",
  display: "standalone",
  background_color: "#111214",
  theme_color: "#111214",
  icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  share_target: { action: "/", method: "GET", params: { title: "title", text: "text", url: "url" } },
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors() });
    if (request.method !== "GET" && request.method !== "HEAD")
      return json({ ok: false, error: "Method not allowed" }, 405);

    // Video links the page understands, so the same URL works for people and for AI agents:
    //   /?v=<link or id>   /watch?v=<id>   /<id>   /shorts/<id>   (+ ?text=/url= from Android share)
    const pathId = url.pathname.match(/^\/(?:(?:shorts|live|embed)\/)?([A-Za-z0-9_-]{11})\/?$/);
    const queryInput =
      url.searchParams.get("v") || url.searchParams.get("url") || url.searchParams.get("text") || "";

    if (url.pathname === "/text" || url.pathname.startsWith("/text/")) {
      const input = url.pathname.slice(6) || queryInput;
      return textResponse(await loadTranscript(input, url, ctx), url);
    }

    if (pathId || ((url.pathname === "/" || url.pathname === "/watch" || url.pathname === "/index.html") && queryInput)) {
      const data = await loadTranscript(pathId ? pathId[1] : queryInput, url, ctx);
      return pageResponse(data);
    }

    switch (url.pathname) {
      case "/":
      case "/index.html":
        return pageResponse(null);
      case "/manifest.webmanifest":
        return new Response(JSON.stringify(MANIFEST), {
          headers: { "content-type": "application/manifest+json", "cache-control": "public, max-age=86400" },
        });
      case "/icon.svg":
        return new Response(ICON_SVG, {
          headers: { "content-type": "image/svg+xml", "cache-control": "public, max-age=86400" },
        });
      case "/api/transcript": {
        const data = await loadTranscript(queryInput, url, ctx);
        return json(data.body, data.status, data.status === 200 ? { "cache-control": `public, max-age=${CACHE_SECONDS}` } : {});
      }
      default:
        return new Response("Not found", { status: 404 });
    }
  },
};

// ───────────────────────────── API ─────────────────────────────

// Returns { status, body } where body is the API JSON ({ ok: true, … } or { ok: false, error, … }).
async function loadTranscript(input, url, ctx) {
  const id = parseVideoId(input);
  if (!id) return { status: 400, body: { ok: false, error: "That doesn't look like a YouTube link or video ID." } };

  const track = (url.searchParams.get("track") || "").slice(0, 64);
  const tlang = (url.searchParams.get("tlang") || "").replace(/[^A-Za-z0-9-]/g, "").slice(0, 16);
  const fresh = url.searchParams.get("fresh") === "1";

  const cacheKey = new Request(
    `https://transcript.cache/${id}?track=${encodeURIComponent(track)}&tlang=${tlang}`,
  );
  const cache = typeof caches !== "undefined" ? caches.default : null;
  if (cache && !fresh) {
    const hit = await cache.match(cacheKey);
    if (hit) return { status: 200, body: await hit.json() };
  }

  let body;
  try {
    body = { ok: true, ...(await getTranscript(id, { track, tlang })) };
  } catch (err) {
    return {
      status: err.status || 502,
      body: { ok: false, id, error: err.message || String(err), attempts: err.attempts || [] },
    };
  }
  if (cache) {
    const stored = new Response(JSON.stringify(body), {
      headers: { "content-type": "application/json", "cache-control": `public, max-age=${CACHE_SECONDS}` },
    });
    ctx.waitUntil(cache.put(cacheKey, stored));
  }
  return { status: 200, body };
}

// ───────────────────── Server-rendered output ─────────────────────
// Agents that read pages without running JavaScript get the full transcript as text.

function pageResponse(data) {
  let html = PAGE;
  if (data) {
    const b = data.body;
    const ssr = b.ok
      ? `<article id="ssr" class="card"><div class="transcript"><h2>${esc(b.title || b.id)}</h2>` +
        `<p>${esc(metaLine(b))}<br><a href="https://youtu.be/${b.id}">https://youtu.be/${b.id}</a></p>` +
        paragraphs(b.segments, b.track && b.track.auto)
          .map((p) => `<p>[${fmtTime(p.s)}] ${esc(p.t)}</p>`)
          .join("") +
        `</div></article>`
      : `<article id="ssr" class="error">${esc(b.error)}</article>`;
    const initial = `<script>window.__INITIAL__=${JSON.stringify(b).replace(/</g, "\\u003c").replace(/[\u2028\u2029]/g, "")};</script>`;
    html = html.replace("<!--SSR-->", ssr + initial);
    if (b.ok && b.title) html = html.replace("<title>YouTube Transcript</title>", `<title>${esc(b.title)} · Transcript</title>`);
  }
  return new Response(html, {
    status: data ? data.status : 200,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" },
  });
}

function textResponse(data, url) {
  const b = data.body;
  const headers = { "content-type": "text/plain; charset=utf-8", ...cors() };
  if (!b.ok) return new Response(`Error: ${b.error}\n`, { status: data.status, headers });
  const ts = url.searchParams.get("ts") !== "0";
  const body =
    `${b.title || b.id}\n${metaLine(b)}\nhttps://youtu.be/${b.id}\n\n` +
    paragraphs(b.segments, b.track && b.track.auto)
      .map((p) => (ts ? `[${fmtTime(p.s)}] ` : "") + p.t)
      .join("\n\n") +
    "\n";
  return new Response(body, { status: 200, headers: { ...headers, "cache-control": `public, max-age=${CACHE_SECONDS}` } });
}

function metaLine(b) {
  const bits = [];
  if (b.author) bits.push(b.author);
  if (b.lengthSeconds) bits.push(fmtTime(b.lengthSeconds));
  if (b.track) bits.push(b.track.name + (b.track.auto && !/auto/i.test(b.track.name) ? " (auto-generated)" : ""));
  if (b.tlang) bits.push(`translated to ${b.tlang}`);
  return bits.join(" · ");
}

// Same grouping the page uses: break on pauses, sentence ends, or ~40 s of auto captions.
function paragraphs(segs, auto) {
  const out = [];
  let cur = null;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    const prev = segs[i - 1];
    const gap = prev ? s.s - (prev.s + prev.d) : 0;
    const brk =
      !cur ||
      gap > 2.5 ||
      (!auto && cur.len > 380 && /[.!?…]["')\]]?$/.test(prev.t)) ||
      (auto && s.s - cur.s > 40) ||
      cur.len > 1400;
    if (brk) {
      cur = { s: s.s, parts: [], len: 0 };
      out.push(cur);
    }
    cur.parts.push(s.t);
    cur.len += s.t.length + 1;
  }
  return out.map((p) => ({ s: p.s, t: p.parts.join(" ").replace(/\s+/g, " ") }));
}

function fmtTime(sec) {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return (h ? `${h}:${String(m).padStart(2, "0")}` : String(m)) + `:${String(s).padStart(2, "0")}`;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

class TranscriptError extends Error {
  constructor(message, status, attempts) {
    super(message);
    this.status = status;
    this.attempts = attempts;
  }
}

async function getTranscript(id, { track, tlang }) {
  const attempts = [];
  const note = (method, msg) => attempts.push(`${method}: ${msg}`);

  // Watch page: gives the API key, client version, visitor data, embedded player
  // response and the transcript-panel params. Not fatal if it fails.
  let page = {};
  try {
    page = await fetchWatchPage(id);
    if (page.blocked) note("watch page", "YouTube showed a bot check to this server");
  } catch (e) {
    note("watch page", e.message);
  }

  // Player responses from both sources
  let android = null;
  try {
    android = await fetchAndroidPlayer(id, page);
  } catch (e) {
    note("android player", e.message);
  }

  const candidates = [];
  if (android) candidates.push({ method: "android", player: android });
  if (page.player) candidates.push({ method: "web", player: page.player });

  // Hard stops: video doesn't exist / is private
  const statuses = candidates.map((c) => c.player.playabilityStatus || {});
  const dead = statuses.find((s) => s.status === "ERROR");
  if (dead && candidates.every((c) => !tracksOf(c.player).length)) {
    throw new TranscriptError(
      `YouTube says this video is unavailable${dead.reason ? `: ${dead.reason}` : "."}`,
      404,
      attempts,
    );
  }

  const details =
    candidates.map((c) => c.player.videoDetails).find((d) => d && d.title) || page.details || {};
  const meta = {
    id,
    title: details.title || page.title || "",
    author: details.author || "",
    lengthSeconds: Number(details.lengthSeconds) || 0,
  };

  let sawTracks = false;
  let lastTracks = [];
  let lastTranslations = [];

  for (const c of candidates) {
    const st = c.player.playabilityStatus || {};
    const tracks = tracksOf(c.player);
    if (!tracks.length) {
      note(`${c.method} player`, st.status && st.status !== "OK" ? `${st.status}${st.reason ? ` (${st.reason})` : ""}` : "no caption tracks listed");
      continue;
    }
    sawTracks = true;
    lastTracks = tracks;
    lastTranslations = translationsOf(c.player);

    const chosen = pickTrack(tracks, track);
    try {
      const segments = await fetchTimedText(chosen.baseUrl, chosen.translatable ? tlang : "");
      if (segments.length) {
        return {
          ...meta,
          method: `${c.method}-timedtext`,
          track: publicTrack(chosen),
          tlang: chosen.translatable && tlang ? tlang : "",
          tracks: tracks.map(publicTrack),
          translations: lastTranslations,
          segments,
        };
      }
      note(`${c.method} timedtext`, "empty response");
    } catch (e) {
      note(`${c.method} timedtext`, e.message);
    }
  }

  // Fallback: the transcript panel endpoint (default language only, no translation)
  if (page.transcriptParams) {
    try {
      const segments = await fetchTranscriptPanel(page);
      if (segments.length) {
        return {
          ...meta,
          method: "transcript-panel",
          track: lastTracks.length ? publicTrack(pickTrack(lastTracks, "")) : null,
          tlang: "",
          tracks: lastTracks.map(publicTrack),
          translations: [],
          note: "Fetched through YouTube's transcript panel, which only gives the default language.",
          segments,
        };
      }
      note("transcript panel", "empty response");
    } catch (e) {
      note("transcript panel", e.message);
    }
  }

  if (!sawTracks && !page.transcriptParams && candidates.some((c) => (c.player.playabilityStatus || {}).status === "OK")) {
    throw new TranscriptError("This video has no captions or transcript on YouTube.", 404, attempts);
  }
  const botChecked =
    page.blocked ||
    statuses.some((s) => s.status === "LOGIN_REQUIRED" && /bot|sign in/i.test(s.reason || ""));
  throw new TranscriptError(
    botChecked
      ? "YouTube is showing a bot check to this server right now. Try again in a while."
      : "Couldn't get a transcript for this video.",
    botChecked ? 429 : 502,
    attempts,
  );
}

// ─────────────────────────── YouTube ───────────────────────────

async function fetchWatchPage(id) {
  const r = await fetch(`https://www.youtube.com/watch?v=${id}&hl=en&bpctr=9999999999&has_verified=1`, {
    headers: {
      "user-agent": WEB_UA,
      "accept-language": "en-US,en;q=0.9",
      cookie: "CONSENT=YES+cb; SOCS=CAI",
    },
    redirect: "follow",
  });
  const html = await r.text();
  const out = {
    blocked: /g-recaptcha|\/sorry\/index|unusual traffic/i.test(html) && !/ytInitialPlayerResponse/.test(html),
    apiKey: match(html, /"INNERTUBE_API_KEY":"([^"]+)"/),
    clientVersion: match(html, /"INNERTUBE_CLIENT_VERSION":"([^"]+)"/) || match(html, /"clientVersion":"([\d.]+)"/),
    visitorData: match(html, /"VISITOR_DATA":"([^"]+)"/),
    transcriptParams: match(html, /"getTranscriptEndpoint":\{"params":"([^"]+)"/),
    title: decodeEntities(match(html, /<meta name="title" content="([^"]*)"/) || ""),
  };
  out.player = extractJson(html, "ytInitialPlayerResponse");
  if (out.transcriptParams) out.transcriptParams = decodeJsonString(out.transcriptParams);
  return out;
}

async function fetchAndroidPlayer(id, page) {
  const key = page.apiKey || FALLBACK_KEY;
  const headers = {
    "content-type": "application/json",
    "user-agent": ANDROID_UA,
    "x-youtube-client-name": "3",
    "x-youtube-client-version": ANDROID_VERSION,
  };
  if (page.visitorData) headers["x-goog-visitor-id"] = page.visitorData;
  const r = await fetch(`https://www.youtube.com/youtubei/v1/player?key=${key}&prettyPrint=false`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      context: {
        client: {
          clientName: "ANDROID",
          clientVersion: ANDROID_VERSION,
          androidSdkVersion: 30,
          hl: "en",
          gl: "US",
          ...(page.visitorData ? { visitorData: page.visitorData } : {}),
        },
      },
      videoId: id,
      contentCheckOk: true,
      racyCheckOk: true,
    }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

async function fetchTimedText(baseUrl, tlang) {
  let u = baseUrl.startsWith("http") ? baseUrl : `https://www.youtube.com${baseUrl}`;
  u = u.replace(/&fmt=[^&]*/g, "");
  if (tlang) u += `&tlang=${encodeURIComponent(tlang)}`;
  const r = await fetch(u, { headers: { "user-agent": WEB_UA, "accept-language": "en-US,en;q=0.9" } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return parseTimedText(await r.text());
}

async function fetchTranscriptPanel(page) {
  const key = page.apiKey || FALLBACK_KEY;
  const r = await fetch(`https://www.youtube.com/youtubei/v1/get_transcript?key=${key}&prettyPrint=false`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": WEB_UA,
      "x-youtube-client-name": "1",
      "x-youtube-client-version": page.clientVersion || FALLBACK_WEB_VERSION,
      ...(page.visitorData ? { "x-goog-visitor-id": page.visitorData } : {}),
      origin: "https://www.youtube.com",
    },
    body: JSON.stringify({
      context: {
        client: {
          clientName: "WEB",
          clientVersion: page.clientVersion || FALLBACK_WEB_VERSION,
          hl: "en",
          gl: "US",
          ...(page.visitorData ? { visitorData: page.visitorData } : {}),
        },
      },
      params: page.transcriptParams,
    }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return parseTranscriptPanel(await r.json());
}

// ─────────────────────────── Parsing ───────────────────────────

function parseVideoId(input) {
  input = String(input || "").trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(input)) return input;
  try {
    const u = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
    const host = u.hostname.toLowerCase().replace(/^(www|m|music)\./, "");
    if (host === "youtu.be") {
      const id = u.pathname.slice(1, 12);
      if (/^[A-Za-z0-9_-]{11}$/.test(id)) return id;
    }
    if (host === "youtube.com" || host === "youtube-nocookie.com") {
      const v = u.searchParams.get("v");
      if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) return v;
      const m = u.pathname.match(/^\/(?:shorts|embed|live|v|e)\/([A-Za-z0-9_-]{11})/);
      if (m) return m[1];
    }
  } catch {}
  // Shared text like "Look at this https://youtu.be/xxxx"
  const m = input.match(/(?:[?&]v=|youtu\.be\/|\/shorts\/|\/embed\/|\/live\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

function tracksOf(player) {
  const list = player?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
  return list
    .filter((t) => t && t.baseUrl)
    .map((t) => ({
      id: t.vssId || `${t.kind === "asr" ? "a" : ""}.${t.languageCode}`,
      lang: t.languageCode || "",
      name: textOf(t.name) || t.languageCode || "Unknown",
      auto: t.kind === "asr",
      translatable: !!t.isTranslatable,
      baseUrl: t.baseUrl,
    }));
}

function translationsOf(player) {
  const list = player?.captions?.playerCaptionsTracklistRenderer?.translationLanguages || [];
  return list
    .map((l) => ({ code: l.languageCode, name: textOf(l.languageName) || l.languageCode }))
    .filter((l) => l.code);
}

function publicTrack(t) {
  return { id: t.id, lang: t.lang, name: t.name, auto: t.auto, translatable: t.translatable };
}

// Requested track if given; otherwise a human-made track in the spoken language,
// then any human-made track, then the auto-generated one.
function pickTrack(tracks, wanted) {
  if (wanted) {
    const exact = tracks.find((t) => t.id === wanted) || tracks.find((t) => t.lang === wanted);
    if (exact) return exact;
  }
  const asr = tracks.find((t) => t.auto);
  const manual = tracks.filter((t) => !t.auto);
  if (asr) {
    const base = asr.lang.split("-")[0];
    const same = manual.find((t) => t.lang.split("-")[0] === base);
    if (same) return same;
  }
  return manual[0] || asr || tracks[0];
}

function parseTimedText(xml) {
  const out = [];
  let m;
  // Format 1: <text start="1.2" dur="3.4">…</text>
  const reText = /<text\b([^>]*)>([\s\S]*?)<\/text>/g;
  while ((m = reText.exec(xml))) {
    const a = attrs(m[1]);
    const t = cleanText(m[2]);
    if (t) out.push({ s: round(+a.start || 0), d: round(+a.dur || 0), t });
  }
  if (out.length) return out;
  // Format 3 (srv3): <p t="1200" d="3400"><s>…</s></p>
  const reP = /<p\b([^>]*)>([\s\S]*?)<\/p>/g;
  while ((m = reP.exec(xml))) {
    const a = attrs(m[1]);
    const t = cleanText(m[2]);
    if (t) out.push({ s: round((+a.t || 0) / 1000), d: round((+a.d || 0) / 1000), t });
  }
  return out;
}

function parseTranscriptPanel(data) {
  const out = [];
  walk(data, (node) => {
    const seg = node.transcriptSegmentRenderer;
    if (!seg) return;
    const start = Number(seg.startMs) || 0;
    const end = Number(seg.endMs) || start;
    const t = cleanText(textOf(seg.snippet) || "");
    if (t) out.push({ s: round(start / 1000), d: round((end - start) / 1000), t });
  });
  return out;
}

// ─────────────────────────── Helpers ───────────────────────────

function walk(node, fn) {
  if (Array.isArray(node)) for (const n of node) walk(n, fn);
  else if (node && typeof node === "object") {
    fn(node);
    for (const k in node) walk(node[k], fn);
  }
}

function textOf(o) {
  if (!o) return "";
  if (typeof o === "string") return o;
  if (o.simpleText) return o.simpleText;
  if (Array.isArray(o.runs)) return o.runs.map((r) => r.text || "").join("");
  return "";
}

function attrs(s) {
  const o = {};
  s.replace(/([\w-]+)="([^"]*)"/g, (_, k, v) => {
    o[k] = v;
    return "";
  });
  return o;
}

function cleanText(s) {
  // Captions are sometimes entity-encoded twice (&amp;#39;)
  let t = decodeEntities(decodeEntities(String(s).replace(/<[^>]+>/g, "")));
  t = t.replace(/<[^>]+>/g, "");
  return t.replace(/\s+/g, " ").trim();
}

const NAMED = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };
function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (all, e) => {
    if (e[0] === "#") {
      const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try {
        return String.fromCodePoint(n);
      } catch {
        return all;
      }
    }
    return NAMED[e.toLowerCase()] ?? all;
  });
}

function decodeJsonString(s) {
  try {
    return JSON.parse(`"${s}"`);
  } catch {
    return s;
  }
}

function match(s, re) {
  const m = s.match(re);
  return m ? m[1] : null;
}

// Finds `name = {…}` in a page and parses the balanced JSON object.
function extractJson(html, name) {
  const re = new RegExp(`${name}\\s*=\\s*\\{`);
  const m = re.exec(html);
  if (!m) return null;
  let i = m.index + m[0].length - 1;
  const start = i;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (; i < html.length; i++) {
    const c = html[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) {
      try {
        return JSON.parse(html.slice(start, i + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

function round(n) {
  return Math.round(n * 1000) / 1000;
}

function cors() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "content-type",
  };
}

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...cors(), ...extra },
  });
}

