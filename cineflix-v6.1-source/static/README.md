# CineFliX v6.1 — deploy guide

A movies, series and live football platform on ChatXAP, by TECH♤LYFE. Netflix-red theme, TypeScript build.

## What's in this folder (upload as-is)

```
index.html  movie.html  player.html  live.html     pages (movie.html = ChatXAP host entry)
cineflix-sw.js                                       service worker (cineflix subdomain only)
cf/dist/*-HASH.js / *.css                            minified bundles — cached for a year
cf/api/proxy.php  cf/api/cache/                      same-origin API proxy + disk cache
.htaccess                                            HTTPS, caching, compression, security headers
docs/CINEFLIX_API.md                                 API, caching and quality-engine reference
```

## Deploy to cineflix.t-lyfe.com.ng (Host Africa)

1. **Delete the old `cf/js/` and `cf/css/` folders** from v6.0. They're replaced by `cf/dist/`.
2. Upload everything here to `/public_html/cineflix/`.
3. Keep your existing `images/cine.png` (the logo) and `js/chatxap-avatar.js`.
4. Set `cf/api/cache/` to permission 755.
5. Check the proxy: `https://cineflix.t-lyfe.com.ng/cf/api/proxy.php?action=country` should return JSON.

## Deploy on ChatXAP (c.x.t-lyfe.com.ng)

Upload `movie.html`, `player.html`, `live.html` and the `cf/` folder to the web root. Skip `index.html` and `cineflix-sw.js`: the service worker only runs on the CineFliX subdomain.

## Updating

Change the source, then run `npm run build` and upload `dist/`. File names change on every build, so there's nothing to cache-bust by hand.
