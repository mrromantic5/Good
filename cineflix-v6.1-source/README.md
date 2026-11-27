# CineFliX — source (TypeScript)

```bash
npm install
npm run build   # → dist/  (upload its contents)
npm run dev     # watch mode
```

```
src/types.ts          domain models (Title, Match, Stream …)
src/api.ts            MovieBox-Pro + ESPN service layer, caching, proxy fallback
src/quality.ts        starting quality, adaptive bitrate, bandwidth memory
src/core.ts           nav/tab bar, auth, cards, search, My List, progress, icons
src/comments.ts       ChatXAP comments
src/pages/home.ts     home router: Home, Movies, Series, Football, Browse, My List
src/pages/player.ts   title page + custom player
src/pages/live.ts     live match page
src/sw.ts             service worker
styles/cineflix.css   Netflix-red design system
public/*.html         page templates ({{HEAD}}, {{JS}}, <i data-ic> icons are filled at build)
static/               .htaccess, proxy.php, deploy README
scripts/build.mjs     esbuild + lightningcss build
scripts/icons.mjs     generates src/icons.gen.ts from Font Awesome Free (CC BY 4.0)
```

See `docs/CINEFLIX_API.md` for the API, caching and quality-engine reference.
