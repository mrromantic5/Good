/* ═══════════════════════════════════════════════════════════════════════
   CineFliX Home App · v6.1 — hash router
   #/home  #/movies  #/series  #/football  #/browse  #/mylist
   First paint uses the last-seen feed from localStorage (stale-while-
   revalidate), so returning visitors see content before the network.
═══════════════════════════════════════════════════════════════════════ */
import * as API from '../api';
import * as C from '../core';
import { ic, esc, $, $$, fill, must } from '../core';
import type { Title, HomeFeed, Match, Paged } from '../types';

const app = must('#app');
const GENRES = ['Action', 'Adventure', 'Animation', 'Comedy', 'Crime', 'Documentary', 'Drama', 'Family', 'Fantasy', 'Horror', 'Mystery', 'Romance', 'Sci-Fi', 'Thriller', 'War', 'Western'];
const NOW_Y = new Date().getFullYear();

const V: { route: string; hero: { destroy(): void } | null; io: IntersectionObserver | null; timers: number[] } = { route: '', hero: null, io: null, timers: [] };
const FB = { league: 'eng.1', day: 0, live: [] as Match[] };

C.mountChrome({ active: 'home' });
C.registerSW();
C.loadUser().then(() => { const g = $('#greet'); if (g) g.textContent = C.greeting(); });

const homeP: Promise<HomeFeed> = API.getHome();
homeP.then((h) => C.setLiveIndicator(h.live.some((m) => m.status === 'live'))).catch(() => { /* */ });


/* ── Router ──────────────────────────────────────────────────────────── */
function hashParams(): URLSearchParams { return new URLSearchParams(location.hash.split('?')[1] || ''); }
function clearView(): void {
  V.timers.forEach(clearInterval); V.timers = [];
  V.hero?.destroy(); V.hero = null;
  V.io?.disconnect(); V.io = null;
}
const TITLES: Record<string, string> = {
  home: 'CineFliX — Movies, series and live football', movies: 'Movies — CineFliX', series: 'Series — CineFliX',
  football: 'Football — CineFliX', browse: 'Browse — CineFliX', mylist: 'My List — CineFliX'
};
function router(): void {
  let r = (location.hash.replace(/^#\/?/, '').split('?')[0] || 'home').toLowerCase();
  const views: Record<string, () => void> = { home: viewHome, movies: () => viewType(1), series: () => viewType(2), football: viewFootball, browse: viewBrowse, mylist: viewMyList };
  if (!views[r]) r = 'home';
  clearView(); C.closeSearch();
  V.route = r; C.setActive(r);
  $('#cfNav')?.classList.toggle('solid', r !== 'home' || window.scrollY > 40);
  window.scrollTo(0, 0);
  views[r]();
  document.title = TITLES[r];
}
const rowOf = (id: string) => $(`#${id} .row`);
const failRow = (id: string, msg = 'This row didn’t load. Try again shortly.') => { const r = rowOf(id); if (r) r.outerHTML = C.emptyHTML('warn', msg); };
const cards = (items: Title[]) => items.map((t) => C.posterCard(t)).join('');

/* ═════════════════════════════  HOME  ═════════════════════════════ */
function viewHome(): void {
  app.innerHTML =
    '<section class="hero" id="hero" aria-roledescription="carousel">' +
      '<div class="hero-art" id="heroArt"><div class="sk hero-sk"></div></div>' +
      `<div class="hero-body" id="heroBody"><p class="hero-greet" id="greet">${esc(C.greeting())}</p></div>` +
      `<button class="btn btn-ghost btn-icon btn-sm hero-mute" id="heroMute" hidden aria-label="Unmute trailer">${ic('vol-off')}</button>` +
      '<div class="hero-reel" id="heroReel" role="tablist" aria-label="Featured titles"></div>' +
    '</section>' +
    '<div id="cwSlot"></div><div id="liveSlot"></div>' +
    C.shelf({ id: 'shTrending', title: 'Top 10 today', html: C.skeletonRow(6) }) +
    '<div id="sections"></div><div id="peopleSlot"></div>' + C.footer();

  // Instant paint from the last visit, then replace with fresh data.
  const stale = API.peekHome();
  if (stale) paintHome(stale);
  homeP.then((h) => { if (V.route === 'home') paintHome(h, !!stale); })
    .catch(() => { if (!stale) fill('#sections', C.emptyHTML('wifi', 'CineFliX couldn’t reach the catalogue. Check your connection, then reload.', '<button class="btn btn-line btn-sm" data-act="reload">Reload</button>')); });

  const staleT = API.peekTrending();
  if (staleT) paintTrending(staleT);
  API.getTrending().then((t) => { if (V.route === 'home') paintTrending(t); })
    .catch(() => { if (!staleT) failRow('shTrending'); });

  renderContinue('#cwSlot');
  renderPeople('#peopleSlot');
}

function paintHome(h: HomeFeed, refresh = false): void {
  const banners = h.banners.filter((b) => b.bannerImage);
  if (banners.length && !(refresh && V.hero)) startHero(banners.slice(0, 8));
  if (h.live.length) {
    const live = API.sortMatches(h.live), n = live.filter((m) => m.status === 'live').length;
    fill('#liveSlot', C.shelf({ id: 'shLive', title: h.liveTitle || 'Football live', sub: n ? `${n} on now` : 'Coming up', more: '#/football', html: live.map(C.matchCard).join('') }));
  }
  fill('#sections', h.sections.map((s) => C.shelf({ id: 'sec' + s.id, title: s.title, more: '#/' + (s.kind === 'series' ? 'series' : 'movies'), html: cards(s.items) })).join(''));
}
function paintTrending(t: Paged<Title>): void {
  const items = t.items.slice(0, 10);
  if (!items.length) { failRow('shTrending'); return; }
  fill(rowOf('shTrending'), items.map((x, i) => C.posterCard(x, { rank: i + 1 })).join(''));
  // Trending only becomes the billboard when the home feed has no banners.
  const fallback = () => { if (!V.hero && V.route === 'home') startHero(items.slice(0, 6).map((x) => ({ ...x, bannerImage: x.backdrop || x.poster }))); };
  homeP.then((h) => { if (!h.banners.some((b) => b.bannerImage)) fallback(); }, fallback);
}

/* ── Hero billboard ──────────────────────────────────────────────────── */
function startHero(items: Title[]): void {
  if (V.route !== 'home') return;
  V.hero?.destroy();
  const art = $('#heroArt'), body = $('#heroBody'), reel = $('#heroReel'), mute = $<HTMLButtonElement>('#heroMute');
  if (!art || !body || !reel || !mute) return;
  let idx = -1, timer = 0, trailerT = 0, muted = true;
  const SLIDE = 9000;
  const canTrailer = matchMedia('(min-width: 760px)').matches && !matchMedia('(prefers-reduced-motion: reduce)').matches && !navigator.connection?.saveData;

  art.innerHTML = items.map((t, i) => `<img data-i="${i}" alt="" ${i === 0 ? 'fetchpriority="high" ' : 'loading="lazy" '}decoding="async" src="${esc(t.bannerImage)}">`).join('') + '<video id="heroVid" muted playsinline preload="none"></video>';
  reel.innerHTML = items.map((t, i) => `<button class="reel-frame" role="tab" data-i="${i}" aria-label="${esc(t.title)}"><img src="${esc(t.bannerImage)}" alt="" loading="lazy" decoding="async"><span class="bar"></span></button>`).join('');
  reel.style.setProperty('--reel-ms', SLIDE + 'ms');
  const vid = must<HTMLVideoElement>('#heroVid');
  const onReel = (e: Event) => { const b = (e.target as HTMLElement).closest<HTMLElement>('[data-i]'); if (b) go(+b.dataset.i!, true); };
  reel.addEventListener('click', onReel);
  vid.addEventListener('ended', () => next());
  mute.onclick = () => { muted = !muted; vid.muted = muted; mute.innerHTML = ic(muted ? 'vol-off' : 'vol-high'); mute.setAttribute('aria-label', muted ? 'Unmute trailer' : 'Mute trailer'); };

  function render(t: Title): void {
    const inList = C.myList.has(t.id);
    body!.innerHTML =
      `<p class="hero-greet">${esc(C.greeting())}</p>` +
      '<div class="hero-tags">' +
        (t.rating ? `<span class="pill pill-gold">${ic('star')}${t.rating.toFixed(1)}</span>` : '') +
        (t.year ? `<span class="pill">${esc(t.year)}</span>` : '') +
        `<span class="pill">${t.isSeries ? 'Series' : 'Movie'}</span>` +
        (t.genres[0] ? `<span class="pill">${esc(t.genres.slice(0, 2).join(', '))}</span>` : '') +
      '</div>' +
      `<h1 class="hero-title">${esc(t.title)}</h1>` +
      (t.description ? `<p class="hero-desc">${esc(t.description)}</p>` : '') +
      '<div class="hero-cta">' +
        `<a class="btn btn-primary" href="${esc(C.titleHref(t, { autoplay: 1 }))}">${ic('play')}${t.isSeries ? 'Play episode 1' : 'Play'}</a>` +
        `<a class="btn btn-ghost" href="${esc(C.titleHref(t))}">${ic('info')}<span class="lbl">More info</span></a>` +
        `<button class="btn btn-ghost btn-icon" id="heroList" aria-pressed="${inList}" aria-label="${inList ? 'Remove from My List' : 'Save to My List'}">${ic(inList ? 'bookmark' : 'bookmark-o')}</button>` +
      '</div>';
    const hl = must('#heroList');
    hl.onclick = () => { const on = C.myList.toggle(t); hl.innerHTML = ic(on ? 'bookmark' : 'bookmark-o'); hl.setAttribute('aria-pressed', String(on)); };
  }
  function go(i: number, user = false): void {
    if (i === idx) return;
    idx = (i + items.length) % items.length;
    const t = items[idx];
    $$<HTMLImageElement>('img', art!).forEach((im) => im.classList.toggle('on', +im.dataset.i! === idx));
    $$('.reel-frame', reel!).forEach((f) => {
      const on = +f.dataset.i! === idx; f.classList.remove('on'); void f.offsetWidth; f.classList.toggle('on', on); f.setAttribute('aria-selected', String(on));
      if (on && user) f.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    });
    vid.classList.remove('on'); vid.pause(); mute!.hidden = true;
    render(t);
    clearTimeout(timer); clearTimeout(trailerT);
    timer = window.setTimeout(next, SLIDE);
    if (canTrailer && t.trailer) {
      trailerT = window.setTimeout(() => {
        vid.src = t.trailer; vid.muted = muted;
        vid.play().then(() => {
          vid.classList.add('on'); mute!.hidden = false;
          clearTimeout(timer); timer = window.setTimeout(next, 45000);
          const bar = reel!.querySelector<HTMLElement>('.reel-frame.on .bar'); if (bar) bar.style.animationPlayState = 'paused';
        }).catch(() => { /* autoplay blocked */ });
      }, 2600);
    }
  }
  const next = () => go(idx + 1);
  go(0);
  const vis = () => { if (document.hidden) { clearTimeout(timer); vid.pause(); } else timer = window.setTimeout(next, SLIDE); };
  document.addEventListener('visibilitychange', vis);
  V.hero = { destroy: () => { clearTimeout(timer); clearTimeout(trailerT); vid.pause(); vid.removeAttribute('src'); document.removeEventListener('visibilitychange', vis); reel.removeEventListener('click', onReel); } };
}

/* ── Continue watching ───────────────────────────────────────────────── */
interface CWItem { id: string; title: string; poster: string; isSeries: boolean; detailPath: string; pct: number; se?: number; ep?: number; left: number }
function renderContinue(slot: string): void {
  const local: CWItem[] = C.progress.recent(20).map((r) => ({ id: r.id, title: r.title || 'Untitled', poster: r.poster || '', isSeries: !!r.se, detailPath: r.path || '', pct: Math.round((r.pos / r.dur) * 100), se: r.se, ep: r.ep, left: r.dur - r.pos }));
  const draw = (list: CWItem[]) => {
    if (!list.length) return;
    fill(slot, C.shelf({
      id: 'shCW', title: 'Continue watching', wide: true,
      html: list.map((x) => {
        const href = C.titleHref(x, x.se ? { se: x.se, ep: x.ep, autoplay: 1 } : { autoplay: 1 });
        return `<a class="poster still" href="${esc(href)}"><div class="poster-art">${x.poster ? `<img class="fade" src="${esc(x.poster)}" alt="" loading="lazy">` : ''}` +
          `<span class="poster-play">${ic('play')}</span><span class="poster-prog"><b style="width:${x.pct}%"></b></span></div>` +
          `<div class="poster-title">${esc(x.title)}</div><div class="poster-meta">${x.se ? `S${x.se} E${x.ep}  ` : ''}${x.left > 0 ? C.fmtRuntime(x.left) + ' left' : x.pct + '% watched'}</div></a>`;
      }).join('')
    }));
  };
  if (!C.state.user) { draw(local); return; }
  fetch(C.CX + 'api/watch_progress.php?action=get_progress', { credentials: 'include' }).then((r) => r.json()).then((d) => {
    const seen = new Set(local.map((x) => x.id)); const merged = [...local];
    for (const i of d.items || []) {
      if (seen.has(String(i.movie_id)) || !(i.duration_sec > 0)) continue;
      const pct = Math.min(100, Math.round((i.progress_sec / i.duration_sec) * 100)); if (pct > 96) continue;
      merged.push({ id: String(i.movie_id), title: i.movie_title, poster: i.poster_url, isSeries: /series|tv/i.test(i.movie_type || ''), detailPath: '', pct, se: i.season, ep: i.episode, left: i.duration_sec - i.progress_sec });
    }
    draw(merged.slice(0, 20));
  }).catch(() => draw(local));
}

function renderPeople(slot: string): void {
  fetch(C.CX + 'backend/active_users_fetch.php', { credentials: 'include' }).then((r) => r.json()).then((d) => {
    const users: { id: number; username?: string; avatar?: string; online?: number | string; is_v?: boolean }[] = (d.users || []).slice(0, 24);
    if (!users.length) return;
    fill(slot, C.shelf({
      id: 'shPeople', title: 'Active on ChatXAP', sub: users.length + ' online',
      html: users.map((u) => `<a class="person" href="${esc(C.links.userProfile(u.id))}"><span class="person-av">${C.avatarHTML(u.avatar, u.username)}${Number(u.online) === 1 ? '<span class="person-on"></span>' : ''}</span>` +
        `<div class="person-name">${esc(u.username || 'User')}${u.is_v ? ' ' + C.vBadge : ''}</div></a>`).join('')
    }));
  }).catch(() => { /* optional */ });
}

/* ═══════════════════════  MOVIES / SERIES  ════════════════════════ */
function viewType(type: 1 | 2): void {
  const label = type === 2 ? 'Series' : 'Movies', slug = type === 2 ? 'series' : 'movies';
  let g = hashParams().get('genre') || 'Action';
  app.innerHTML = '<div class="page">' +
    `<header class="page-head"><h1 class="h1">${label}</h1><p>${type === 2 ? 'Binge full seasons, from African originals to global hits.' : 'New releases, blockbusters and hidden gems, ready to stream.'}</p></header>` +
    `<div id="typeShelves">${C.shelf({ id: 'shTypeTrend', title: 'Trending ' + label.toLowerCase() })}</div>` +
    '<section class="section"><div class="section-head"><h2 class="h2">By genre</h2></div>' +
    `<div class="chips" id="genreChips">${GENRES.map((x) => `<button class="chip${x === g ? ' on' : ''}" data-g="${x}">${x}</button>`).join('')}</div>` +
    '<div class="grid" id="typeGrid"></div><div id="typeSentinel" class="sentinel"></div></section>' + C.footer() + '</div>';

  homeP.then((h) => {
    $('#typeShelves')?.insertAdjacentHTML('beforeend', h.sections.filter((s) => s.kind === (type === 2 ? 'series' : 'movie'))
      .map((s) => C.shelf({ id: 'ts' + s.id, title: s.title, html: cards(s.items) })).join(''));
  }).catch(() => { /* */ });
  Promise.all([API.getTrending(1), API.getTrending(2).catch(() => ({ items: [] as Title[] }))]).then(([a, b]) => {
    const items = [...a.items, ...b.items].filter((t) => t.type === type);
    if (!items.length) { $('#shTypeTrend')?.remove(); return; }
    fill(rowOf('shTypeTrend'), cards(items));
  }).catch(() => failRow('shTypeTrend'));

  const grid = pagedGrid('#typeGrid', '#typeSentinel', (page) => API.filterCatalog({ genre: g, page }).then((o) => ({ ...o, items: o.items.filter((t) => t.type === type) })));
  must('#genreChips').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-g]'); if (!b) return;
    g = b.dataset.g!;
    $$('#genreChips .chip').forEach((c) => c.classList.toggle('on', c === b));
    history.replaceState(null, '', `#/${slug}?genre=${encodeURIComponent(g)}`);
    grid.reset();
  });
}

/** Infinite grid. Keeps fetching while pages come back sparse (client-side filters). */
function pagedGrid(gridSel: string, sentSel: string, loader: (page: number) => Promise<Paged<Title>>): { reset(): void } {
  let page = 1, busy = false, done = false, seq = 0, sparse = 0;
  let shown = new Set<string>();
  let gridEl = must(gridSel); const sent = must(sentSel);
  const load = async (): Promise<void> => {
    if (busy || done) return;
    busy = true; const my = seq;
    if (page === 1) gridEl.innerHTML = C.skeletonRow(12);
    try {
      const o = await loader(page);
      if (my !== seq) return;
      if (page === 1) gridEl.innerHTML = '';
      const fresh = o.items.filter((t) => (shown.has(t.id) ? false : (shown.add(t.id), true)));
      gridEl.insertAdjacentHTML('beforeend', cards(fresh));
      done = !o.pager.hasMore; page = o.pager.nextPage || page + 1; busy = false;
      if (done && !gridEl.children.length) gridEl.outerHTML = C.emptyHTML('film', 'No titles here yet. Try another genre or year.');
      else if (!done) {
        sparse = fresh.length < 6 ? sparse + 1 : 0;
        if ((sparse && sparse < 5) || sent.getBoundingClientRect().top < innerHeight + 400) load();
      }
    } catch {
      if (my !== seq) return;
      busy = false; done = true;
      if (page === 1) gridEl.innerHTML = `<div class="span-all">${C.emptyHTML('wifi', 'Titles didn’t load. Check your connection.')}</div>`;
      else C.toast('Couldn’t load more titles');
    }
  };
  V.io = new IntersectionObserver((en) => { if (en[0].isIntersecting) load(); }, { rootMargin: '600px' });
  V.io.observe(sent);
  load();
  return {
    reset() {
      seq++; page = 1; done = false; busy = false; sparse = 0; shown = new Set();
      const cur = $(gridSel);
      if (!cur) {
        const prev = sent.previousElementSibling; if (prev?.classList.contains('empty')) prev.remove();
        sent.insertAdjacentHTML('beforebegin', `<div class="grid" id="${gridSel.slice(1)}"></div>`);
      }
      gridEl = must(gridSel);
      load();
    }
  };
}

/* ═════════════════════════════  BROWSE  ═══════════════════════════ */
function viewBrowse(): void {
  const q = hashParams();
  const st = { genre: q.get('genre') || 'Action', year: q.get('year') || '', type: q.get('type') || 'all' };
  const years = [''] as string[]; for (let y = NOW_Y + 1; y >= 1980; y--) years.push(String(y));
  app.innerHTML = '<div class="page"><header class="page-head"><h1 class="h1">Browse</h1><p>Filter the whole catalogue by genre, year and format.</p></header><div class="toolbar">' +
    `<label class="sr-only" for="bGenre">Genre</label><select class="select" id="bGenre">${GENRES.map((g) => `<option${g === st.genre ? ' selected' : ''}>${g}</option>`).join('')}</select>` +
    `<label class="sr-only" for="bYear">Year</label><select class="select" id="bYear">${years.map((y) => `<option value="${y}"${y === st.year ? ' selected' : ''}>${y || 'Any year'}</option>`).join('')}</select>` +
    `<div class="seg" id="bType" role="group" aria-label="Format">${[['all', 'All'], ['1', 'Movies'], ['2', 'Series']].map(([v, l]) => `<button data-t="${v}" class="${st.type === v ? 'on' : ''}">${l}</button>`).join('')}</div>` +
    '</div><div class="grid" id="bGrid"></div><div id="bSent" class="sentinel"></div>' + C.footer() + '</div>';
  const grid = pagedGrid('#bGrid', '#bSent', (page) => API.filterCatalog({ genre: st.genre, year: st.year, page }).then((o) => (st.type === 'all' ? o : { ...o, items: o.items.filter((t) => String(t.type) === st.type) })));
  const apply = () => { history.replaceState(null, '', '#/browse?' + new URLSearchParams(st).toString()); grid.reset(); };
  const gSel = must<HTMLSelectElement>('#bGenre'), ySel = must<HTMLSelectElement>('#bYear');
  gSel.onchange = () => { st.genre = gSel.value; apply(); };
  ySel.onchange = () => { st.year = ySel.value; apply(); };
  must('#bType').onclick = (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-t]'); if (!b) return;
    st.type = b.dataset.t!; $$('#bType button').forEach((x) => x.classList.toggle('on', x === b)); apply();
  };
}

/* ═════════════════════════════  MY LIST  ══════════════════════════ */
function viewMyList(): void {
  const list = C.myList.all();
  app.innerHTML = '<div class="page"><header class="page-head"><h1 class="h1">My List</h1><p>Titles you saved on this device, plus what you’re part-way through.</p></header><div id="mlCW"></div>' +
    `<section class="section"><div class="section-head"><h2 class="h2">Saved</h2><span class="section-sub">${list.length} title${list.length === 1 ? '' : 's'}</span></div>` +
    (list.length
      ? `<div class="grid">${list.map((x) => C.posterCard({ id: x.id, title: x.title, poster: x.poster, isSeries: x.isSeries, detailPath: x.detailPath, year: x.year, rating: x.rating || 0, genres: [] } as unknown as Title)).join('')}</div>`
      : C.emptyHTML('bookmark-o', 'Nothing saved yet. Tap the bookmark on any title to keep it here.', '<a class="btn btn-primary btn-sm" href="#/home">Find something to watch</a>')) +
    '</section>' + C.footer() + '</div>';
  renderContinue('#mlCW');
}

/* ═════════════════════════════  FOOTBALL  ═════════════════════════ */
function viewFootball(): void {
  const lq = hashParams().get('league'); if (lq) FB.league = lq;
  app.innerHTML = '<div class="page"><header class="page-head"><h1 class="h1">Football</h1><p>Watch matches live, follow scores as they happen and check the table.</p></header>' +
    '<div id="fbHero"><div class="fhero"><div class="sk" style="height:180px"></div></div></div><div id="fbLive"></div>' +
    '<section class="section" id="fbScores"><div class="section-head"><h2 class="h2">Scores and fixtures</h2><span class="section-sub" id="fbUpdated"></span></div>' +
    `<div class="chips" id="fbLeagues">${API.LEAGUES.map((l) => `<button class="chip${l.id === FB.league ? ' on' : ''}" data-l="${l.id}">${esc(l.name)}</button>`).join('')}</div>` +
    '<div class="dates" id="fbDates"></div><div class="fx-list" id="fbList"></div></section>' +
    '<section class="section"><div class="section-head"><h2 class="h2" id="fbTableTitle">Table</h2></div><div class="table-wrap" id="fbTableBody"></div></section>' + C.footer() + '</div>';

  API.getLiveMatches().then((list) => {
    FB.live = list; drawFeatured(list);
    if (list.length) fill('#fbLive', C.shelf({ id: 'shFbLive', title: 'Live streams', sub: list.filter((m) => m.status === 'live').length + ' on now', html: list.map(C.matchCard).join('') }));
    drawFixtures();
  }).catch(() => { fill('#fbHero', ''); fill('#fbLive', C.emptyHTML('futbol', 'Live streams didn’t load. Scores below still update.')); drawFixtures(); });
  drawDates(); drawTable();
  must('#fbLeagues').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-l]'); if (!b) return;
    FB.league = b.dataset.l!; $$('#fbLeagues .chip').forEach((c) => c.classList.toggle('on', c === b));
    history.replaceState(null, '', '#/football?league=' + FB.league);
    drawFixtures(); drawTable();
  });
  must('#fbList').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-e]'), r = (e.target as HTMLElement).closest('[data-retry]');
    if (r) { drawFixtures(); return; }
    if (b) { const ev = fixtures.find((x) => x.id === b.dataset.e); if (ev) openMatchSheet(ev); }
  });
  V.timers.push(window.setInterval(() => { if (!document.hidden) drawFixtures(true); }, 60000));
}

function drawFeatured(list: Match[]): void {
  const m = list.find((x) => x.status === 'live') || list.find((x) => x.status === 'upcoming');
  if (!m) { fill('#fbHero', ''); return; }
  const live = m.status === 'live';
  fill('#fbHero', `<div class="fhero"><div class="fhero-meta">${C.matchStatusPill(m)}<span class="pill pill-line">${esc(m.league)}</span></div>` +
    `<div class="fhero-teams"><div class="team">${C.teamLogo(m.home)}<span class="team-name">${esc(m.home.name)}</span></div>` +
    (live ? C.scoreHTML(m) : `<div><div class="fhero-count" id="fbCount">--:--:--</div><div class="fhero-sub">until kick-off</div></div>`) +
    `<div class="team">${C.teamLogo(m.away)}<span class="team-name">${esc(m.away.name)}</span></div></div>` +
    `<div class="fhero-cta"><a class="btn btn-primary" href="${esc(C.matchHref(m))}">${ic(live ? 'play' : 'tv')}${live ? 'Watch live' : 'Open match page'}</a></div></div>`);
  if (!live) { const tick = () => { const el = $('#fbCount'); if (el) el.textContent = C.countdown(m.start); }; tick(); V.timers.push(window.setInterval(tick, 1000)); }
}

const dayDate = (off: number): Date => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + off); return d; };
function drawDates(): void {
  let html = '';
  for (let i = -3; i <= 4; i++) { const d = dayDate(i); html += `<button class="date${i === FB.day ? ' on' : ''}" data-d="${i}"><small>${i === 0 ? 'Today' : d.toLocaleDateString([], { weekday: 'short' })}</small><b>${d.getDate()}</b></button>`; }
  const el = must('#fbDates'); el.innerHTML = html;
  el.onclick = (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-d]'); if (!b) return;
    FB.day = +b.dataset.d!; $$('#fbDates .date').forEach((x) => x.classList.toggle('on', x === b)); drawFixtures();
  };
}

let fixtures: Match[] = [];
function drawFixtures(silent = false): void {
  const list = $('#fbList'); if (!list) return;
  const league = FB.league, day = FB.day;
  if (!silent) list.innerHTML = '<div class="sk fx-sk"></div><div class="sk fx-sk"></div><div class="sk fx-sk"></div>';
  API.getScoreboard(league, dayDate(day)).then((evs) => {
    if (league !== FB.league || day !== FB.day) return;
    fixtures = evs.sort((a, b) => a.start - b.start);
    const up = $('#fbUpdated'); if (up) up.textContent = 'Updated ' + C.timeOf(Date.now());
    if (!evs.length) { list.innerHTML = C.emptyHTML('calendar', `No ${esc(API.leagueName(league))} matches on this day. Pick another date.`); return; }
    list.innerHTML = fixtures.map((e) => {
      const stream = API.findStreamFor(e, FB.live);
      const score = e.status === 'upcoming' ? C.timeOf(e.start) : `${esc(e.home.score)} – ${esc(e.away.score)}`;
      const time = e.status === 'live' ? esc(e.clock || 'Live') : e.status === 'ended' ? 'FT' : /postp|canc/i.test(e.clock || '') ? esc(e.clock) : '';
      return `<button class="fx${e.status === 'live' ? ' is-live' : ''}" data-e="${esc(e.id)}"><span class="fx-time">${time}</span>` +
        `<span class="fx-team home"><span>${esc(e.home.name)}</span>${e.home.logo ? `<img src="${esc(e.home.logo)}" alt="" loading="lazy" data-drop>` : ''}</span>` +
        `<span class="fx-score">${score}</span>` +
        `<span class="fx-team">${e.away.logo ? `<img src="${esc(e.away.logo)}" alt="" loading="lazy" data-drop>` : ''}<span>${esc(e.away.name)}</span></span>` +
        `<span class="fx-stream">${stream ? ic('broadcast') : ''}</span></button>`;
    }).join('');
  }).catch(() => { if (!silent) list.innerHTML = C.emptyHTML('wifi', 'Scores didn’t load. Check your connection.', '<button class="btn btn-line btn-sm" data-retry>Try again</button>'); });
}

function drawTable(): void {
  const body = $('#fbTableBody'); if (!body) return;
  const league = FB.league;
  must('#fbTableTitle').textContent = API.leagueName(league) + ' table';
  body.innerHTML = '<div class="sk" style="height:240px"></div>';
  const colors: Record<string, string> = { '#81D6AC': 'var(--pitch)', '#B2D7F5': '#5AA9FF', '#FF7F84': 'var(--red)' };
  API.getStandings(league).then((groups) => {
    if (league !== FB.league) return;
    if (!groups.length) { body.innerHTML = C.emptyHTML('table', 'No table for this competition right now.'); return; }
    body.innerHTML = groups.slice(0, 8).map((g) =>
      (groups.length > 1 && g.group ? `<h3 class="h3 group-h">${esc(g.group)}</h3>` : '') +
      '<table class="table"><thead><tr><th>#</th><th>Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GD</th><th>Pts</th></tr></thead><tbody>' +
      g.rows.map((r) => {
        const c = r.note ? colors[r.note.toUpperCase()] || r.note : '';
        return `<tr><td>${c ? `<i style="background:${esc(c)}"></i>` : ''}${r.rank || ''}</td><td class="t"><div>${r.logo ? `<img src="${esc(r.logo)}" alt="" loading="lazy" data-drop>` : ''}<span>${esc(r.team)}</span></div></td>` +
          `<td>${r.gp}</td><td>${r.w}</td><td>${r.d}</td><td>${r.l}</td><td>${r.gd > 0 ? '+' : ''}${r.gd}</td><td class="pts">${r.pts}</td></tr>`;
      }).join('') + '</tbody></table>').join('');
  }).catch(() => { body.innerHTML = C.emptyHTML('table', 'The table didn’t load. Try again shortly.'); });
}

function openMatchSheet(e: Match): void {
  const stream = API.findStreamFor(e, FB.live);
  openSheet(`<div class="fhero-meta left">${C.matchStatusPill(e)}<span class="pill pill-line">${esc(e.league)}</span></div>` +
    `<div class="fhero-teams sheet-teams${e.status === 'live' ? ' is-live' : ''}"><div class="team">${C.teamLogo(e.home)}<span class="team-name">${esc(e.home.name)}</span></div>` +
    (e.status === 'upcoming' ? `<div class="score"><span class="vs">${C.timeOf(e.start)}</span></div>` : C.scoreHTML(e)) +
    `<div class="team">${C.teamLogo(e.away)}<span class="team-name">${esc(e.away.name)}</span></div></div>` +
    (e.status === 'live' && e.clock ? `<p class="center muted strong">${esc(e.clock)}</p>` : '') +
    (e.venue ? `<p class="center dim small">${ic('pin')} ${esc(e.venue)}</p>` : '') +
    (stream ? `<div class="center pad"><a class="btn btn-primary" href="${esc(C.matchHref(stream))}">${ic('play')}Watch this match</a></div>` : '') +
    '<div id="msBody"><div class="sk" style="height:120px"></div></div>');
  if (e.status === 'upcoming') { fill('#msBody', '<p class="center muted">Events, stats and highlights appear here once the match starts.</p>'); return; }
  API.getMatchSummary(e.leagueId || FB.league, e.id).then((s) => {
    let html = '';
    if (s.highlights.length) {
      html += `<h3 class="h3 mb">Highlights</h3><video class="hl-video" controls playsinline preload="metadata" poster="${esc(s.highlights[0].thumb)}" src="${esc(s.highlights[0].url)}"></video>`;
      if (s.highlights.length > 1) html += `<div class="chips flush">${s.highlights.slice(0, 6).map((h, i) => `<button class="chip${i ? '' : ' on'}" data-hl="${esc(h.url)}" data-th="${esc(h.thumb)}">${esc(h.title.slice(0, 40))}</button>`).join('')}</div>`;
    }
    if (s.stats.length) html += '<h3 class="h3 mb mt">Match stats</h3>' + s.stats.map((st) => {
      const a = parseFloat(st.home) || 0, b = parseFloat(st.away) || 0, pct = a + b ? (a / (a + b)) * 100 : 50;
      return `<div class="stat-label">${esc(st.label)}</div><div class="stat-row"><span>${esc(st.home)}</span><span class="bar"><i style="width:${pct.toFixed(0)}%"></i></span><span>${esc(st.away)}</span></div>`;
    }).join('');
    if (s.events.length) html += '<h3 class="h3 mt">Key moments</h3><ul class="timeline">' + s.events.map((k) => `<li class="${k.scoring ? 'goal' : ''}"><b>${esc(k.minute)}</b><span>${k.scoring ? ic('futbol') + ' ' : ''}${esc(k.text)}</span></li>`).join('') + '</ul>';
    fill('#msBody', html || '<p class="center muted">No match details published yet.</p>');
    const chips = $('#msBody .chips');
    if (chips) chips.onclick = (ev) => {
      const b = (ev.target as HTMLElement).closest<HTMLElement>('[data-hl]'); if (!b) return;
      const v = must<HTMLVideoElement>('#msBody video'); v.poster = b.dataset.th || ''; v.src = b.dataset.hl!; v.play().catch(() => { /* */ });
      $$('#msBody .chips .chip').forEach((c) => c.classList.toggle('on', c === b));
    };
  }).catch(() => fill('#msBody', '<p class="center muted">Match details didn’t load.</p>'));
}

/* ── Sheet ───────────────────────────────────────────────────────────── */
const sheet = must('#sheet');
function openSheet(html: string): void { fill('#sheetBody', html); sheet.classList.add('open'); document.body.style.overflow = 'hidden'; }
function closeSheet(): void { sheet.classList.remove('open'); document.body.style.overflow = ''; $<HTMLVideoElement>('#sheetBody video')?.pause(); }
sheet.addEventListener('click', (e) => { if (e.target === sheet || (e.target as HTMLElement).closest('[data-close]')) closeSheet(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });

/* ── Boot (last, so every const above is initialised) ───────────────── */
window.addEventListener('hashchange', router);
router();
