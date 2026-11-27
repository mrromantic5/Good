# CineFliX API Reference — v6.1 (MovieBox-Pro edition, TypeScript)

CineFliX talks to one upstream catalogue and one football data source. All network code is in **`src/api.ts`**, a typed ES module. Pages import its functions, and they only receive the typed models in `src/types.ts`, described below. Function names are unchanged from v6.0, but they are now named imports (`import * as API from './api'`) instead of the `window.CFApi` global.

| Source | Base URL | Used for |
|---|---|---|
| MovieBox-Pro | `https://api.omegatech.app/api/movie/MovieBox-pro` | Catalogue, title details, streams, live football streams |
| ESPN site API (public) | `https://site.api.espn.com/apis/site/v2/sports/soccer` | Scores, fixtures, tables, match events, highlights |
| Legacy worker (backup only) | `https://cineflix-api.brainsjetai.workers.dev` | Stream fallback when MovieBox returns no qualities |
| ChatXAP backend (unchanged) | `https://c.x.t-lyfe.com.ng/` | Auth, comments, watch progress, active users |

The old `cineflix-api.brainsjetai.workers.dev` catalogue endpoints (`/api/search`, `/api/info`, `/api/trending`, `/api/homepage`) are no longer used. The worker is only called as a stream backup, and you can switch that off (see [Configuration](#configuration)).

---

## 1. Transport, caching and errors

```
Browser ──► MovieBox-Pro (direct)
   │            └─ network/CORS failure
   └──────► cf/api/proxy.php (same origin, disk-cached) ──► MovieBox-Pro
```

- **Direct first.** Every call is a `GET ?action=…`. A response only counts as successful when HTTP is OK and `success !== false`.
- **Automatic proxy fallback.** If the direct call fails at network/CORS level, or with a 5xx error, the client retries through `cf/api/proxy.php` and then keeps using the proxy for the rest of the tab session (`sessionStorage.cf_use_proxy = 1`).
- **Client cache.** Responses are cached in memory and in `sessionStorage`. Identical requests that are already in flight are shared.
- **Timeout.** 15 s per request (`AbortController`).

| Action | Client TTL | Proxy TTL |
|---|---|---|
| `country` | 24 h | 24 h |
| `home`, `trending` | 5 min | 5 min |
| `suggest`, `search` | 10 min | 10 min |
| `filter` | 15 min | 15 min |
| `detail`, `recommend` | 30 min | 30 min |
| `staffrel` | 1 h | 1 h |
| `download` | 4 min | never (signed URLs) |
| ESPN scoreboard / summary | 60 s | 60 s |
| ESPN standings | 30 min | 30 min |

Every API function returns a typed Promise. A rejection means the request itself failed. An empty result (for example no streams) **resolves** with an empty model, so the UI can show a clear empty state instead of an error.

---

## 2. Data models

### Title
Returned by every list, row, hero and detail call.

```js
{
  id: "1950173900541676320",   // subjectId (string — never parse as Number)
  type: 1 | 2,                 // 1 = movie, 2 = series
  isSeries: boolean,
  title, description,
  releaseDate: "2008-07-18", year: "2008",
  duration: 9120,              // seconds (0 for series)
  genres: ["Action","Crime"],
  country: "United States",
  rating: 9.0, ratingCount: 2800000,
  poster: "https://…",         // cover.url
  posterHue: "#665b4a",
  backdrop: "https://…",       // stills → trailer cover → cover
  trailer: "https://….mp4",    // trailer.videoAddress.url
  detailPath: "the-dark-knight-I0HXX8FO3k2",   // required for streams
  subtitles: ["English","French"],
  corner: "", hasResource: true, dubs: [ … ]
}
```
Hero banners also carry `bannerImage` (1920×1080) and `bannerTitle`.

### Pager
```js
{ page: 1, nextPage: 2, hasMore: true, perPage: 20, total: 1000000 }
```

### TitleDetail
```js
{
  subject: Title,
  seasons: [{ se: 1, maxEp: 5, resolutions: [{ res: 720, epNum: 5 }] }],  // series only
  cast:    [{ id: "123", name: "Omar Sy", role: "Assane Diop", avatar: "https://…" }],
  dubs:    [{ id: "838…", lang: "French", code: "fr", original: true, detailPath: "…" }],
  locked:  false
}
```

### StreamSet
```js
{
  streams: [{ label: "720p", res: 720, url: "https://…mp4", size: 640000000, format: "mp4", alt?: "…" }],
  best: Stream | null,      // highest quality ≤ 720p for a fast start
  subtitles: [{ lang: "en", label: "English", url: "https://…srt" }],
  audio: [],
  empty: boolean,
  source: "moviebox" | "legacy"
}
```

### Match (live stream — MovieBox `SPORT_LIVE`)
```js
{
  id: "838786885223864648",      // matchId
  source: "moviebox",
  league: "Football",
  home: { id, name, short: "OLY", logo, score: "0", votes: 10 },
  away: { … },
  start: 1795715100000,           // epoch ms
  status: "upcoming" | "live" | "ended",
  statusRaw: "MatchNotStart",
  streamUrl: "https://sportsnow.top/live/detail?id=…&sportType=football",
  image, title
}
```
Status mapping: `MatchNotStart` → `upcoming`; anything containing *live / progress / half / playing* → `live`; *end / finish / FT* → `ended`. A match that is still `MatchNotStart` less than 2 hours after kick-off is treated as `live`.

### Fixture (ESPN)
Same shape as `Match`, plus `source: "espn"`, `leagueId`, `clock` ("67'", "FT"), `venue`, and `home.winner` / `away.winner`.

---

## 3. API reference (`src/api.ts`)

### Phase 1 — boot and discovery

| Function | Upstream | Returns |
|---|---|---|
| `getCountry()` | `action=country` → `data.countryCode` | `"US"` |
| `getHome()` | `action=home` → `data.operatingList`, `data.platformList` | `{ banners: Title[], sections: [{id,title,kind,items}], live: Match[], liveTitle, liveUrl, platforms: string[] }` |
| `getTrending(page?)` | `action=trending` → `data.subjectList`, `data.pager` | `{ items: Title[], pager }` |

How `home` is parsed: `BANNER` items become `banners`. `SPORT_LIVE` (or any item with a `liveList`) becomes `live`. Every other item that has `subjects` becomes a `section`, and its `kind` is `series` when most of its items are series.

### Phase 2 — search and catalogue

| Function | Upstream | Notes |
|---|---|---|
| `getSuggestions(keyword)` | `action=suggest` → `data.items[].word` | Debounced 280 ms in the UI |
| `searchTitles(keyword, page)` | `action=search` → **`data.data.items`** | Double-nested, handled in the client |
| `filterCatalog({ genre, year, page })` | `action=filter` → `data.items`, `data.pager` | Returns movies and series mixed; the UI filters by `type` |

### Phase 3 — title pages

| Function | Upstream | Notes |
|---|---|---|
| `getTitle(subjectId)` | `action=detail` (singular) | Seasons come from `data.resource.seasons`; cast from `data.stars` (de-duplicated) |
| `getRecommendations(subjectId)` | `action=recommend` → `data.items` | The current title is filtered out |
| `getStaffRelated(staffId)` | `action=staffrel` → `data` | Accepts an array or `{items}` |

### Phase 4 — streams

| Function | Upstream | Notes |
|---|---|---|
| `getStreams({ subjectId, detailPath, isSeries, se, ep })` | `action=download` | Movies always send `se=0&ep=0`. Merges `qualities`, `availableStreams` and `bestQualityUrl`, removes duplicates and sorts high to low. If the result is empty, it tries the legacy worker. |
| `buildProxyVideoUrl(rawUrl)` | `action=video&url=<encoded>` | Assign to `<video src>`. Never fetch it as JSON. Always URL-encodes. |
| `fetchSubtitleVtt(url)` | Subtitle file (direct, then proxy `?sub=`) | Converts SRT to WebVTT |

**Playback fallback chain** (in `src/pages/player.ts`): upstream video proxy URL → raw CDN URL → legacy stream URL → next lower quality → "Playback failed" state with *Try again* and *Watch trailer*.

### Football

| Function | Source | Returns |
|---|---|---|
| `getLiveMatches()` | MovieBox `home` (cached) | `Match[]`, sorted live → upcoming → ended |
| `getLiveMatch(id)` | as above | `Match \| null` |
| `LEAGUES` | — | Premier League, Champions League, LaLiga, Serie A, Bundesliga, Ligue 1, Europa League, FA Cup |
| `getScoreboard(leagueId, date)` | ESPN `/{league}/scoreboard?dates=YYYYMMDD` | `Fixture[]` |
| `getStandings(leagueId)` | ESPN `/apis/v2/…/{league}/standings` | `[{ group, rows: [{rank, team, logo, gp, w, d, l, gd, pts, note}] }]` |
| `getMatchSummary(leagueId, eventId)` | ESPN `/{league}/summary?event=` | `{ events, highlights: [{title, thumb, url}], stats: [{label, home, away}] }` |
| `findStreamFor(fixture, liveList)` | — | Matches an ESPN fixture to a MovieBox stream by team names (fuzzy) |

To add a league, append `{ id, name, short }` to `LEAGUES`. The `id` is the ESPN slug, e.g. `ned.1`, `por.1`, `usa.1`, `caf.nations`.

---

## 4. Same-origin proxy — `cf/api/proxy.php`

| Request | Behaviour |
|---|---|
| `GET ?action=<verified>&…` | Forwards to MovieBox-Pro. Only the 10 JSON actions are allowed, and only these params: `keyword, page, genre, year, subjectId, staffId, detailPath, se, ep`. |
| `GET ?espn=<encoded url>` | Forwards only ESPN soccer URLs |
| `GET ?sub=<encoded url>` | Fetches subtitle files from `*.aoneroom.com` / `*.hakunaymatata.com` only |

- Disk cache is stored in `cf/api/cache/` (access is denied over HTTP). If the upstream fails and a cached copy exists, the **stale copy is served**.
- The `X-CF-Cache` header shows `HIT`, `MISS` or `STALE`.
- CORS is limited to `*.t-lyfe.com.ng`.
- Video is **never** proxied through your hosting. The client streams through the upstream `action=video` endpoint.

Requirements: PHP 7.4+ with cURL, and a writable `cf/api/cache/` folder (permissions 755).

---

## 5. ChatXAP integrations (unchanged contracts)

| Feature | Endpoint |
|---|---|
| Session | `backend/auth_check.php` → `{status, user}` |
| Comments | `api/comments.php?action=fetch\|post\|delete\|fetch_replies\|reply`, `api/react_comment.php` |
| Watch progress | `api/watch_progress.php?action=get_progress\|save_progress\|log_view` (now also sends `season`/`episode`) |
| Active users | `backend/active_users_fetch.php` |
| Real-time | `ChatXAPRealtime` rooms `movie_<id>`, events `movie_comment:new\|delete\|react` |

Match comments use the thread id `fb_<matchId>` on the same `comments.php`. If your `movie_id` column is numeric, change it to `VARCHAR(64)`.

Host detection: on `c.x.t-lyfe.com.ng` the ChatXAP calls are root-relative (`/backend/…`). Everywhere else they use the absolute ChatXAP URL. The same files work on both hosts.

---

## 6. Configuration

To override settings, define `window.CF_CONFIG` in an inline `<script>` **before** the page's module script:

```html
<script>
  window.CF_CONFIG = {
    transport: 'auto',        // 'auto' | 'direct' | 'proxy'
    proxy: '/cf/api/proxy.php',
    legacyFallback: true,     // false = MovieBox-Pro only
    timeoutMs: 15000
  };
</script>
```

---

## 7. Page URLs

| Page | URL |
|---|---|
| Home app | `index.html#/home`, `#/movies?genre=Drama`, `#/series`, `#/football?league=eng.1`, `#/browse?genre=Action&year=2025&type=1`, `#/mylist` |
| Title + player | `player.html?id=<subjectId>&path=<detailPath>&type=movie\|series[&se=1&ep=3][&autoplay=1]` |
| Live match | `live.html?id=<matchId>&h=<home>&a=<away>` |

Old links like `player.html?id=…&title=…&poster=…&type=…` still work. `detailPath` is looked up from `detail` when it isn't in the URL.

---

## 8. Known upstream behaviour

1. **Empty streams.** `download` sometimes returns empty `qualities` and `availableStreams` (this happened for both test titles on 26 Nov 2026). The UI shows *Stream currently unavailable* with *Check again* and *Watch trailer*, and the client tries the legacy worker automatically.
2. **Response paths differ by action.** `search` uses `data.data.items`, `trending` uses `data.subjectList`, `detail` uses `data.subject`, and the rest use `data.items`. Only `cf-api.js` deals with this.
3. **`trending` pager.** `totalCount` is `0` even when `hasMore` is true. Rely on `hasMore`.
4. **Football streams are third-party pages** (`sportsnow.top`). They are embedded in a sandboxed iframe without `allow-popups`, which blocks pop-up ads. An *Open stream* button is always available, in case the site refuses to load in an iframe.
5. **Excluded actions:** `ranking`, `staff` and `platform` returned upstream errors during verification and are not used.

---

## 9. Speed and caching (v6.1)

| Layer | What it does |
|---|---|
| **esbuild bundle** | Each page has one minified entry file. Shared code is split into `core-*.js` chunks, which the browser downloads once and reuses on every page. About 50 KB gzipped in total, CSS included. |
| **Content-hashed files** | `cf/dist/*-HASH.js/css` are cached for a year (`immutable`). A new build gets new file names, so there's never a stale cache. |
| **`modulepreload`** | Each HTML page preloads its entry file and chunks in parallel. |
| **Inline SVG icons** | 48 icons (about 8 KB gzipped) replace the Font Awesome download (about 250 KB). |
| **Stale-while-revalidate feeds** | `home` and `trending` are also saved to `localStorage`. On repeat visits they render instantly from that copy while fresh data loads (`peekHome()`, `peekTrending()`). |
| **Service worker** (`cineflix-sw.js`) | Precaches the app shell. Pages: network first, falling back to cache when offline. Fonts and posters: served from cache while refreshing. The API, video and ChatXAP backend are never cached. It only registers on `cineflix.t-lyfe.com.ng`, so it can never take over ChatXAP. |
| **Preconnect** | API, poster CDN and fonts are preconnected in `<head>`. The video CDN is preconnected as soon as streams resolve. |

## 10. Quality engine (`src/quality.ts`)

The upstream API serves progressive MP4 files at fixed resolutions, not adaptive HLS/DASH streams. CineFliX adds the adaptive behaviour itself:

1. **Starting quality** — `pickInitial(streams, duration, prefs)`
   - Screen limit: `screenCap()` = the long side of the screen × device pixel ratio, mapped to the nearest step from 360p to 2160p. A phone never downloads 4K it can't show.
   - Bandwidth: measured throughput from past sessions (`localStorage.cf_bw_v1`, smoothed) → the Network Information hint (4G counts as at least 5 Mbps) → 3 Mbps default.
   - Bitrate per stream: `size × 8 / duration`. If the size is unknown, a typical bitrate for that resolution is used.
   - Picks the highest stream where bitrate × 1.25 fits the bandwidth. Data Saver forces 360p.
2. **Auto mode** — `AdaptiveQuality`
   - Every 2 s while playing, it measures throughput: how fast the buffer grows × the stream's bitrate.
   - **Step up:** at least 25 s since the last switch, more than 20 s buffered ahead, and the next quality's bitrate × 1.35 fits the measured throughput.
   - **Step down:** 2 stalls within 30 s, or one stall longer than 3.5 s.
3. **Seamless switch** — before changing the source, the current frame is drawn onto a `<canvas>` over the player. It stays visible until the new source is playing at the same position, so there is no black flash.
4. **Enhanced picture** (on by default, user can toggle) — a GPU colour pass (`contrast 1.06, saturate 1.14, brightness 1.02`) that makes low-bitrate sources look richer. Costs nothing on mobile.
5. **Viewer controls** — the gear menu has Auto plus each resolution (with SD/HD/Full HD/4K tags and file sizes), Enhanced or Original picture, and speed. The choice is remembered (`cf_quality_v1`). A badge in the player shows the current tier.

## 11. Building from source

```bash
cd cineflix-source
npm install
npm run build      # icons → type check (strict) → bundle → dist/
npm run dev        # rebuild on save
```
Upload the contents of `dist/` (see the README). Icons are Font Awesome Free 6.5.1 (CC BY 4.0).
