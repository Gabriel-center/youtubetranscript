# YouTube Transcript

Paste a YouTube link, get the full transcript: read it, search it, copy it, or download it as .txt, .srt or .md.

The whole app is one Cloudflare Worker (`src/index.js`):

- `GET /` serves the page
- `GET /api/transcript?v=<link or id>` returns JSON (`&track=<id>` picks a caption track, `&tlang=<code>` translates)

The browser can't read YouTube directly (CORS), so the Worker fetches captions server-side. It tries the Android innertube player API, then the caption tracks in the watch page, then the transcript-panel endpoint.

Deploys automatically when this repo is connected to the `youtubetranscript` Worker (Settings → Build → Connect).
