# YouTube Transcript

Paste a YouTube link, get the full transcript: read it, search it, copy it, or download it as .txt, .srt or .md.

The whole app is one Cloudflare Worker (`src/index.js`):

- `GET /` serves the page
- `GET /<videoId>`, `/watch?v=<id>`, `/?v=<link>`: the page with the transcript already rendered in the HTML, so AI agents that don't run JavaScript can read it too
- `GET /text/<videoId>` (or `/text?v=<link>`): plain text; add `&ts=0` to drop timestamps
- `GET /api/transcript?v=<link or id>` returns JSON (`&track=<id>` picks a caption track, `&tlang=<code>` translates)

Tip: swap `youtu.be/` or `youtube.com/` in any video link for this Worker's domain.

The browser can't read YouTube directly (CORS), so the Worker fetches captions server-side. It tries the Android innertube player API, then the caption tracks in the watch page, then the transcript-panel endpoint.

Deploys automatically when this repo is connected to the `youtubetranscript` Worker (Settings → Build → Connect).
