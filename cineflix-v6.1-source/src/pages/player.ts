/* ═══════════════════════════════════════════════════════════════════════
   CineFliX Title & Player · v6.1
   player.html?id=<subjectId>&path=<detailPath>&type=movie|series[&se=&ep=][&autoplay=1]
   Quality: smart start, adaptive auto mode, seamless switching (freeze
   frame), Enhanced picture, quality badge. Old links keep working.
═══════════════════════════════════════════════════════════════════════ */
import * as API from '../api';
import * as C from '../core';
import { ic, esc, $, $$, must, fill } from '../core';
import { mountComments } from '../comments';
import { AdaptiveQuality, loadPrefs, savePrefs, pickInitial, tier, screenCap, type QualityPrefs } from '../quality';
import type { Title, Season, Stream, Subtitle, CastMember, Dub } from '../types';

type Mode = 'idle' | 'trailer' | 'main';
const qp = new URLSearchParams(location.search);
const S = {
  id: qp.get('id') || '', path: qp.get('path') || '',
  isSeries: /series|tv|show/i.test(qp.get('type') || ''),
  se: Number(qp.get('se')) || 0, ep: Number(qp.get('ep')) || 0,
  autoplay: qp.get('autoplay') === '1',
  title: qp.get('title') || '', poster: qp.get('poster') || '',
  t: null as Title | null, seasons: [] as Season[],
  streams: [] as Stream[], cur: -1, subs: [] as Subtitle[], subOn: null as number | null,
  attempt: 0, resolving: null as Promise<void> | null, mode: 'idle' as Mode,
  lastSave: 0, nextTimer: 0, nextDismissed: false, hideT: 0, speed: 1, logged: false,
  dur: 0, prefs: loadPrefs() as QualityPrefs
};

const v = must<HTMLVideoElement>('#video'), player = must('#player');

/* ── Boot ────────────────────────────────────────────────────────────── */
C.mountChrome({ active: S.isSeries ? 'series' : 'movies', back: C.route('home') });
C.registerSW();
fill('#footSlot', C.footer());
hydrateIcons();
applyEnhance();
if (S.title) { must('#tName').textContent = S.title; must('#cTitle').textContent = S.title; document.title = S.title + ' — CineFliX'; }
if (S.poster) setArt(S.poster, S.poster);

if (!S.id) {
  must('#tName').textContent = 'Title not found';
  showState('This link is missing a title', 'Go back and pick something from the catalogue.', [['Browse CineFliX', () => { location.href = C.route('home'); }]]);
} else {
  Promise.all([C.loadUser(), C.domReady()]).then(() => mountComments(must('#cmtPanel'), S.id));
  loadTitle();
}

/** Static markup uses <i data-ic="name"> placeholders; swap them for inline SVG. */
function hydrateIcons(): void {
  $$<HTMLElement>('[data-ic]').forEach((el) => { el.outerHTML = ic(el.dataset.ic as Parameters<typeof ic>[0]); });
}
function setArt(bg: string, poster: string): void {
  if (bg) must('#tBg').style.backgroundImage = `url("${bg.replace(/"/g, '%22')}")`;
  if (poster) { fill('#tPoster', `<img src="${esc(poster)}" alt="" fetchpriority="high">`); must('#pPoster').style.backgroundImage = `url("${(bg || poster).replace(/"/g, '%22')}")`; }
}
function preconnect(url: string): void {
  try {
    const origin = new URL(url).origin;
    if ($(`link[rel=preconnect][href="${origin}"]`)) return;
    const l = document.createElement('link'); l.rel = 'preconnect'; l.href = origin; document.head.appendChild(l);
  } catch { /* bad url */ }
}

/* ── Title data ──────────────────────────────────────────────────────── */
async function loadTitle(): Promise<void> {
  API.getRecommendations(S.id).then((list) => {
    if (list.length) fill('#recSlot', C.shelf({ id: 'shRec', title: 'More like this', html: list.map((x) => C.posterCard(x)).join('') }));
  }).catch(() => { /* optional */ });
  try {
    const d = await API.getTitle(S.id);
    const t = d.subject; if (!t) throw new Error('empty');
    Object.assign(S, { t, path: t.detailPath || S.path, isSeries: t.isSeries, seasons: d.seasons, title: t.title, poster: t.poster || S.poster, dur: t.duration });
    document.title = t.title + ' — CineFliX';
    C.setActive(t.isSeries ? 'series' : 'movies');
    renderHeader(t, d.locked); renderFacts(t); renderCast(d.cast); renderLangs(d.dubs);
    if (S.isSeries) {
      const saved = C.progress.get(S.id);
      if (!S.se) { S.se = saved?.se || S.seasons[0]?.se || 1; S.ep = saved?.ep || 1; }
      if (!S.ep) S.ep = 1;
      renderSeasons();
    }
    updatePlayLabel();
    must<HTMLButtonElement>('#tPlay').disabled = false;
    await resolveStreams();
    if (S.autoplay) play();
  } catch {
    must('#tName').textContent = S.title || 'Title unavailable';
    showState('This title didn’t load', 'The catalogue didn’t respond. Check your connection and try again.', [['Try again', () => { hideState(); loadTitle(); }]]);
  }
}

function renderHeader(t: Title, locked: boolean): void {
  setArt(t.backdrop || t.poster, t.poster);
  must('#tName').textContent = t.title; must('#cTitle').textContent = t.title;
  fill('#tGenres', t.genres.map((g) => `<a href="${esc(C.route('browse?genre=' + encodeURIComponent(g)))}">${esc(g)}</a>`).join(', '));
  let tags = '';
  if (t.rating) tags += `<span class="pill pill-gold">${ic('star')}${t.rating.toFixed(1)}${t.ratingCount ? `<span class="dim">&nbsp;(${t.ratingCount > 999 ? Math.round(t.ratingCount / 1000) + 'k' : t.ratingCount})</span>` : ''}</span>`;
  if (t.year) tags += `<span class="pill">${esc(t.year)}</span>`;
  tags += `<span class="pill">${t.isSeries ? (S.seasons.length ? `${S.seasons.length} season${S.seasons.length > 1 ? 's' : ''}` : 'Series') : t.duration ? C.fmtRuntime(t.duration) : 'Movie'}</span>`;
  if (t.country) tags += `<span class="pill">${esc(t.country)}</span>`;
  if (locked) tags += '<span class="pill pill-line">Restricted</span>';
  fill('#tTags', tags);
  const desc = must('#tDesc'); desc.textContent = t.description;
  if (t.description.length > 220) {
    const more = must('#tMore'); more.hidden = false;
    more.onclick = () => { const c = desc.classList.toggle('clamp'); more.textContent = c ? 'Read more' : 'Show less'; };
  }
  if (t.trailer) { const tb = must('#tTrailer'); tb.hidden = false; tb.onclick = playTrailer; }
  const lb = must('#tList');
  const paint = (on: boolean) => { lb.innerHTML = ic(on ? 'bookmark' : 'bookmark-o'); lb.setAttribute('aria-label', on ? 'Remove from My List' : 'Save to My List'); lb.setAttribute('aria-pressed', String(on)); };
  paint(C.myList.has(t.id)); lb.onclick = () => paint(C.myList.toggle(t));
}

function renderFacts(t: Title): void {
  const rows: [string, string][] = [
    ['Type', t.isSeries ? 'Series' : 'Movie'],
    ['Released', t.releaseDate ? new Date(t.releaseDate).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' }) : ''],
    ['Runtime', !t.isSeries && t.duration ? C.fmtRuntime(t.duration) : ''],
    ['Seasons', t.isSeries ? S.seasons.map((s) => `S${s.se} (${s.maxEp} ep)`).join(', ') : ''],
    ['Country', t.country], ['Genres', t.genres.join(', ')],
    ['Subtitles', t.subtitles.slice(0, 8).join(', ') + (t.subtitles.length > 8 ? ` +${t.subtitles.length - 8}` : '')]
  ];
  fill('#facts', rows.filter((r) => r[1]).map(([k, val]) => `<dt>${k}</dt><dd>${esc(val)}</dd>`).join(''));
}

function renderCast(cast: CastMember[]): void {
  if (!cast.length) return;
  fill('#castSlot', C.shelf({
    id: 'shCast', title: 'Cast and crew',
    html: cast.slice(0, 30).map((p) => `<button class="person" data-staff="${esc(p.id)}" data-name="${esc(p.name)}"><span class="person-av">` +
      (p.avatar ? `<img src="${esc(p.avatar)}" alt="" loading="lazy" data-alt="${esc(p.name.charAt(0))}">` : esc(p.name.charAt(0))) +
      `</span><div class="person-name">${esc(p.name)}</div><div class="person-role">${esc(p.role)}</div></button>`).join('')
  }));
  must('#shCast').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-staff]'); if (!b?.dataset.staff) return;
    const name = b.dataset.name || '';
    openSheet(`<h3 class="h2 mb">More with ${esc(name)}</h3><div class="grid flush" id="staffGrid">${C.skeletonRow(6)}</div>`);
    API.getStaffRelated(b.dataset.staff).then((list) => {
      fill('#staffGrid', list.length ? list.map((x) => C.posterCard(x)).join('') : `<p class="muted span-all">No other titles listed for ${esc(name)}.</p>`);
    }).catch(() => fill('#staffGrid', '<p class="muted span-all">Titles didn’t load.</p>'));
  });
}

function renderLangs(dubs: Dub[]): void {
  if (dubs.length < 2) return;
  must('#langWrap').hidden = false;
  fill('#langs', dubs.map((x) => x.id === S.id ? `<span class="chip on">${esc(x.lang)}</span>`
    : `<a class="chip" href="${esc(C.titleHref({ id: x.id, title: S.title, detailPath: x.detailPath, poster: S.poster, isSeries: S.isSeries }, S.isSeries ? { se: S.se, ep: S.ep } : undefined))}">${esc(x.lang)}</a>`).join(''));
}

const sheet = must('#sheet');
function openSheet(html: string): void { fill('#sheetBody', html); sheet.classList.add('open'); }
sheet.addEventListener('click', (e) => { if (e.target === sheet) sheet.classList.remove('open'); });

/* ── Seasons & episodes ──────────────────────────────────────────────── */
function renderSeasons(): void {
  must('#epPanel').hidden = false;
  if (!S.seasons.length) S.seasons = [{ se: S.se || 1, maxEp: Math.max(S.ep, 10), resolutions: [] }];
  const box = must('#seasons');
  box.innerHTML = S.seasons.map((s) => `<button class="chip${s.se === S.se ? ' on' : ''}" data-se="${s.se}">Season ${s.se}</button>`).join('');
  box.onclick = (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-se]'); if (!b) return;
    $$('#seasons .chip').forEach((c) => c.classList.toggle('on', c === b)); renderEpisodes(+b.dataset.se!);
  };
  must('#eps').onclick = (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-ep]'); if (b) selectEpisode(+b.dataset.se!, +b.dataset.ep!, true);
  };
  renderEpisodes(S.se);
}
function renderEpisodes(se: number): void {
  const s = S.seasons.find((x) => x.se === se) || S.seasons[0];
  const seen = C.progress.get(S.id)?.seen || {};
  must('#epCount').textContent = `Season ${s.se}, ${s.maxEp} episode${s.maxEp === 1 ? '' : 's'}`;
  let h = '';
  for (let i = 1; i <= s.maxEp; i++) {
    const on = s.se === S.se && i === S.ep;
    h += `<button class="ep-btn${on ? ' on' : ''}${seen[s.se + 'x' + i] ? ' seen' : ''}" data-ep="${i}" data-se="${s.se}" aria-label="Season ${s.se} episode ${i}"${on ? ' aria-current="true"' : ''}>${i}</button>`;
  }
  fill('#eps', h);
}
function selectEpisode(se: number, ep: number, autoplay: boolean): void {
  saveProgress(true);
  Object.assign(S, { se, ep, streams: [], cur: -1, resolving: null, mode: 'idle' });
  hideNextUp();
  const u = new URL(location.href); u.searchParams.set('se', String(se)); u.searchParams.set('ep', String(ep)); u.searchParams.delete('autoplay');
  history.replaceState(null, '', u.toString());
  renderEpisodes(se); updatePlayLabel();
  v.pause(); v.removeAttribute('src'); v.load(); clearTracks();
  must('#pPoster').classList.remove('gone');
  resolveStreams().then(() => { if (autoplay) play(); });
  player.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
const epLabel = () => (S.isSeries ? `S${S.se} E${S.ep}` : '');
const curSeason = () => S.seasons.find((x) => x.se === S.se) || { se: S.se, maxEp: 0, resolutions: [] };
const nextSeason = () => S.seasons.find((x) => x.se > S.se) || null;
function nextEpisode(): { se: number; ep: number } | null {
  if (!S.isSeries) return null;
  if (S.ep < curSeason().maxEp) return { se: S.se, ep: S.ep + 1 };
  const ns = nextSeason(); return ns ? { se: ns.se, ep: 1 } : null;
}
function updatePlayLabel(): void {
  const p = C.progress.get(S.id);
  const resume = p && p.pos > 30 && p.dur && p.pos < p.dur - 60 && (!S.isSeries || (p.se === S.se && p.ep === S.ep));
  const label = resume ? `Resume ${S.isSeries ? epLabel() + ' ' : ''}from ${C.fmtClock(p!.pos)}` : S.isSeries ? 'Play ' + epLabel() : 'Play';
  must('#tPlay span').textContent = label; must('#pBigLabel').textContent = label;
  must('#cEp').textContent = epLabel();
  must('#bNext').hidden = !nextEpisode();
}

/* ── Streams ─────────────────────────────────────────────────────────── */
function resolveStreams(): Promise<void> {
  if (S.resolving) return S.resolving;
  const se = S.se, ep = S.ep;
  must('#dlPanel').hidden = true;
  S.resolving = API.getStreams({ subjectId: S.id, detailPath: S.path, isSeries: S.isSeries, se, ep }).then((r) => {
    if (se !== S.se || ep !== S.ep) return;
    S.streams = r.streams; S.subs = r.subtitles;
    S.cur = pickInitial(S.streams, S.dur, S.prefs);
    if (S.streams[0]) { preconnect(S.streams[0].url); preconnect(API.config.base); }
    renderDownloads();
    must('#bSub').hidden = !S.subs.length;
    buildMenus(); paintBadge();
    if (r.empty) must('#pBigLabel').textContent = 'Not available yet';
  });
  return S.resolving;
}

function renderDownloads(): void {
  if (!S.streams.length) return;
  must('#dlPanel').hidden = false;
  must('#dlNote').textContent = epLabel();
  const base = (S.title || 'video').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') + (S.isSeries ? `_S${String(S.se).padStart(2, '0')}E${String(S.ep).padStart(2, '0')}` : '');
  fill('#dlList', S.streams.map((s) => `<div class="dl-item"><b>${esc(s.label)}</b><span>${esc([tier(s.res), s.format.toUpperCase(), C.fmtSize(s.size)].filter(Boolean).join(', '))}</span>` +
    `<a class="btn btn-sm btn-line" href="${esc(s.url)}" download="${esc(base + '_' + s.label + '.mp4')}" target="_blank" rel="noopener">${ic('download')}Download</a></div>`).join(''));
}

/** 0: upstream video proxy · 1: raw CDN URL · 2: legacy worker stream */
function streamSrc(s: Stream, attempt: number): string {
  if (attempt === 0) return API.buildProxyVideoUrl(s.url);
  if (attempt === 1) return s.url;
  if (attempt === 2 && s.alt) return s.alt;
  return '';
}

/* ── Playback ────────────────────────────────────────────────────────── */
async function play(): Promise<void> {
  hideState();
  if (S.mode === 'main' && v.getAttribute('src')) { must('#pPoster').classList.add('gone'); v.play().catch(onPlayBlocked); return; }
  loading(true); must('#pPoster').classList.add('gone');
  try { await resolveStreams(); } catch { loading(false); unavailable(); return; }
  if (!S.streams.length) {
    loading(false); must('#pPoster').classList.remove('gone');
    const btns: [string, () => void][] = [['Check again', () => { S.resolving = null; hideState(); resolveStreams().then(() => (S.streams.length ? play() : unavailable())); }]];
    if (S.t?.trailer) btns.unshift(['Watch trailer', playTrailer]);
    const n = nextEpisode(); if (n) btns.push(['Next episode', () => selectEpisode(n.se, n.ep, true)]);
    showState('Stream currently unavailable', `${S.isSeries ? epLabel() + ' isn’t' : 'This title isn’t'} streaming right now. Sources refresh often, so check again in a few minutes.`, btns);
    return;
  }
  S.mode = 'main'; S.attempt = 0;
  if (S.cur < 0) S.cur = 0;
  setSource(S.cur, resumePoint(), true, false);
  player.focus({ preventScroll: true });
}
function unavailable(): void {
  showState('Stream currently unavailable', 'Sources didn’t respond. Check your connection and try again.', [['Try again', () => { S.resolving = null; hideState(); play(); }]]);
}
function resumePoint(): number {
  const p = C.progress.get(S.id);
  if (!p?.pos || (S.isSeries && (p.se !== S.se || p.ep !== S.ep))) return 0;
  return p.dur && p.pos > p.dur - 60 ? 0 : p.pos;
}

/* Freeze-frame: keep the last picture on screen while a new source seeks. */
const freeze = must<HTMLCanvasElement>('#freeze');
function freezeFrame(): void {
  if (v.readyState < 2 || !v.videoWidth) return;
  try {
    freeze.width = v.videoWidth; freeze.height = v.videoHeight;
    freeze.getContext('2d')?.drawImage(v, 0, 0, freeze.width, freeze.height);
    freeze.classList.add('show');
  } catch { /* drawing is best-effort */ }
}
const unfreeze = () => freeze.classList.remove('show');

function setSource(idx: number, at: number, autoplay: boolean, seamless: boolean): void {
  const s = S.streams[idx]; if (!s) return;
  S.cur = idx;
  const src = streamSrc(s, S.attempt);
  if (!src) { nextFallback(at); return; }
  if (seamless) freezeFrame();
  loading(true);
  v.src = src; v.playbackRate = S.speed;
  v.addEventListener('loadedmetadata', function once() {
    v.removeEventListener('loadedmetadata', once);
    if (at > 0 && at < v.duration - 5) v.currentTime = at;
    v.playbackRate = S.speed;
  });
  if (autoplay) v.play().catch(onPlayBlocked);
  buildMenus(); paintBadge();
  if (!S.logged) { S.logged = true; logView(); }
}

function onPlayBlocked(err: Error): void {
  if (err?.name === 'NotAllowedError') { loading(false); unfreeze(); player.classList.add('paused'); must('#pPoster').classList.remove('gone'); }
}

function nextFallback(at: number): void {
  S.attempt++;
  const s = S.streams[S.cur];
  if (S.attempt <= 2 && s && streamSrc(s, S.attempt)) { setSource(S.cur, at, true, false); return; }
  if (S.cur < S.streams.length - 1) { S.attempt = 0; C.toast(`Trying ${S.streams[S.cur + 1].label}…`); setSource(S.cur + 1, at, true, false); return; }
  loading(false); unfreeze();
  const btns: [string, () => void][] = [['Try again', () => { S.attempt = 0; hideState(); setSource(0, at, true, false); }]];
  if (S.t?.trailer) btns.push(['Watch trailer', playTrailer]);
  showState('Playback failed', 'None of the available sources would play on this device. Try downloading instead, or check again later.', btns);
}

function playTrailer(): void {
  if (!S.t?.trailer) return;
  hideState(); saveProgress(true);
  S.mode = 'trailer';
  must('#pPoster').classList.add('gone'); must('#cEp').textContent = 'Trailer';
  clearTracks();
  v.src = S.t.trailer;
  v.play().catch(() => { v.src = API.buildProxyVideoUrl(S.t!.trailer); v.play().catch(onPlayBlocked); });
  paintBadge();
  player.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

/* ── Quality ─────────────────────────────────────────────────────────── */
const abr = new AdaptiveQuality({
  video: v,
  streams: () => S.streams,
  current: () => S.cur,
  duration: () => v.duration || S.dur,
  isAuto: () => S.mode === 'main' && S.prefs.mode === 'auto',
  switchTo: (idx, why) => {
    S.attempt = 0;
    setSource(idx, v.currentTime, !v.paused, true);
    C.toast(why === 'up' ? `Picture upgraded to ${S.streams[idx].label}` : `Switched to ${S.streams[idx].label} for smoother playback`);
  }
});
function paintBadge(): void {
  const b = must('#qBadge');
  if (S.mode === 'trailer') { b.textContent = 'Trailer'; b.hidden = false; return; }
  const s = S.streams[S.cur];
  b.hidden = !s;
  if (s) b.innerHTML = `<b>${tier(s.res)}</b> ${s.res ? s.res + 'p' : esc(s.label)}${S.prefs.mode === 'auto' ? ' <span>Auto</span>' : ''}`;
  must('#bSetLbl').textContent = s ? (S.prefs.mode === 'auto' ? 'Auto' : s.label) : 'Auto';
}
function applyEnhance(): void { v.classList.toggle('enhance', S.prefs.enhance); }

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
function buildMenus(): void {
  const cap = screenCap();
  let m = '<h5>Quality</h5>';
  if (S.streams.length) {
    const cur = S.streams[S.cur];
    m += `<button data-q="auto" class="${S.prefs.mode === 'auto' ? 'on' : ''}">Auto${cur && S.prefs.mode === 'auto' ? `<span class="dim"> ${esc(cur.label)}</span>` : ''}<small>Best picture your connection can hold</small></button>`;
    m += S.streams.map((s, i) => `<button data-q="${i}" class="${S.prefs.mode !== 'auto' && i === S.cur ? 'on' : ''}">${esc(s.label)}<span class="q-tag">${tier(s.res)}</span>${s.size ? `<span class="dim">${C.fmtSize(s.size)}</span>` : ''}${s.res > cap ? '<small>Higher than this screen shows</small>' : ''}</button>`).join('');
  } else m += '<p class="dim small pad-x">Available once a stream loads.</p>';
  m += `<h5>Picture</h5><button data-enh="1" class="${S.prefs.enhance ? 'on' : ''}">Enhanced<small>Richer colour and contrast</small></button><button data-enh="0" class="${S.prefs.enhance ? '' : 'on'}">Original</button>`;
  m += '<h5>Speed</h5>' + SPEEDS.map((x) => `<button data-s="${x}" class="${x === S.speed ? 'on' : ''}">${x === 1 ? 'Normal' : x + '×'}</button>`).join('');
  fill('#mSet', m);
  fill('#mSub', `<h5>Subtitles</h5><button data-sub="-1" class="${S.subOn == null ? 'on' : ''}">Off</button>` + S.subs.map((s, i) => `<button data-sub="${i}" class="${S.subOn === i ? 'on' : ''}">${esc(s.label)}</button>`).join(''));
}
must('#mSet').addEventListener('click', (e) => {
  const t = e.target as HTMLElement;
  const q = t.closest<HTMLElement>('[data-q]'), sp = t.closest<HTMLElement>('[data-s]'), en = t.closest<HTMLElement>('[data-enh]');
  if (q) {
    if (q.dataset.q === 'auto') {
      S.prefs.mode = 'auto'; savePrefs(S.prefs);
      const best = pickInitial(S.streams, v.duration || S.dur, S.prefs);
      if (S.mode === 'main' && best !== S.cur) { S.attempt = 0; setSource(best, v.currentTime, !v.paused, true); }
      C.toast('Quality: Auto'); abr.noteSwitch();
    } else {
      const i = +q.dataset.q!; S.prefs.mode = S.streams[i].res || 'auto'; savePrefs(S.prefs);
      if (S.mode === 'main') { S.attempt = 0; setSource(i, v.currentTime || resumePoint(), !v.paused, true); }
      else S.cur = i;
      C.toast('Quality: ' + S.streams[i].label);
    }
    buildMenus(); paintBadge();
  }
  if (en) { S.prefs.enhance = en.dataset.enh === '1'; savePrefs(S.prefs); applyEnhance(); buildMenus(); C.toast(S.prefs.enhance ? 'Enhanced picture on' : 'Original picture'); }
  if (sp) { S.speed = parseFloat(sp.dataset.s!); v.playbackRate = S.speed; buildMenus(); }
  closeMenus();
});
must('#mSub').addEventListener('click', async (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-sub]'); if (!b) return;
  const i = +b.dataset.sub!; closeMenus();
  if (i < 0) { S.subOn = null; clearTracks(); buildMenus(); return; }
  const sub = S.subs[i];
  C.toast(`Loading ${sub.label} subtitles…`);
  try {
    const vtt = await API.fetchSubtitleVtt(sub.url);
    clearTracks();
    const tr = document.createElement('track');
    tr.kind = 'subtitles'; tr.label = sub.label; tr.srclang = (sub.lang || 'en').slice(0, 2); tr.default = true;
    tr.src = URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' }));
    v.appendChild(tr);
    setTimeout(() => { if (v.textTracks[0]) v.textTracks[0].mode = 'showing'; }, 50);
    S.subOn = i; buildMenus();
  } catch { C.toast('Those subtitles didn’t load. Try another language.'); }
});
function clearTracks(): void { $$<HTMLTrackElement>('track', v).forEach((t) => { if (t.src.startsWith('blob:')) URL.revokeObjectURL(t.src); t.remove(); }); }
function toggleMenu(id: string): void {
  const m = must(id), open = !m.classList.contains('open'); closeMenus();
  if (open) { m.classList.add('open'); player.classList.add('show-ctrl'); }
}
const closeMenus = () => $$('.menu', player).forEach((m) => m.classList.remove('open'));

/* ── Controls ────────────────────────────────────────────────────────── */
function togglePlay(): void { if (S.mode === 'idle') { play(); return; } if (v.paused) v.play().catch(onPlayBlocked); else v.pause(); }
function skip(n: number): void { if (v.duration) { v.currentTime = Math.max(0, Math.min(v.duration - 1, v.currentTime + n)); flashCtrl(); } }
const loading = (on: boolean) => must('#pLoad').classList.toggle('show', on);
function showState(h: string, p: string, btns: [string, () => void][] = []): void {
  must('#pStateH').textContent = h; must('#pStateP').textContent = p;
  const box = must('#pStateBtns'); box.innerHTML = '';
  btns.forEach(([label, fn], i) => { const el = document.createElement('button'); el.className = 'btn btn-sm ' + (i === 0 ? 'btn-primary' : 'btn-ghost'); el.textContent = label; el.onclick = fn; box.appendChild(el); });
  must('#pState').classList.add('show');
}
const hideState = () => must('#pState').classList.remove('show');
function flashCtrl(): void {
  player.classList.add('show-ctrl'); player.classList.remove('hide-cursor');
  clearTimeout(S.hideT);
  S.hideT = window.setTimeout(() => { if (!v.paused && !$$('.menu.open', player).length) { player.classList.remove('show-ctrl'); player.classList.add('hide-cursor'); } }, 3000);
}
function setPPIcons(): void {
  const i = ic(v.paused ? 'play' : 'pause'); must('#cPP').innerHTML = i; must('#bPP').innerHTML = i;
  player.classList.toggle('paused', v.paused);
}

must('#tPlay').onclick = () => { player.scrollIntoView({ behavior: 'smooth', block: 'center' }); play(); };
must('#tShare').onclick = () => C.share(S.title || 'CineFliX', location.href.replace(/&?autoplay=1/, ''));
must('#pBig').onclick = () => play();
must('#cPP').onclick = must('#bPP').onclick = togglePlay;
must('#cBack').onclick = () => skip(-10);
must('#cFwd').onclick = () => skip(10);
must('#bMute').onclick = () => { v.muted = !v.muted; };
const vol = must<HTMLInputElement>('#bVol');
vol.oninput = () => { v.volume = +vol.value; v.muted = v.volume === 0; };
must('#bSet').onclick = (e) => { e.stopPropagation(); toggleMenu('#mSet'); };
must('#bSub').onclick = (e) => { e.stopPropagation(); toggleMenu('#mSub'); };
must('#bNext').onclick = () => { const n = nextEpisode(); if (n) selectEpisode(n.se, n.ep, true); };
must('#bFs').onclick = () => {
  const d = document as Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => void };
  const vv = v as HTMLVideoElement & { webkitEnterFullscreen?: () => void };
  if (d.fullscreenElement || d.webkitFullscreenElement) (d.exitFullscreen ? d.exitFullscreen() : d.webkitExitFullscreen?.());
  else if (player.requestFullscreen) player.requestFullscreen().then(() => {
    const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    o.lock?.('landscape').catch(() => { /* not supported */ });
  }).catch(() => { /* denied */ });
  else vv.webkitEnterFullscreen?.();
};
if (document.pictureInPictureEnabled) {
  const pip = must('#bPip'); pip.hidden = false;
  pip.onclick = () => { (document.pictureInPictureElement ? document.exitPictureInPicture() : v.requestPictureInPicture()).catch(() => { /* */ }); };
}
document.addEventListener('fullscreenchange', () => { must('#bFs').innerHTML = ic(document.fullscreenElement ? 'compress' : 'expand'); });

let lastTap = 0, tapT = 0;
player.addEventListener('click', (e) => {
  if ((e.target as HTMLElement).closest('.ctrl-bot,.ctrl-mid button,.menu,.next-up,.p-state,.player-poster,.ctrl-top')) return;
  closeMenus();
  const now = Date.now(), r = player.getBoundingClientRect(), x = (e.clientX - r.left) / r.width;
  if (now - lastTap < 300) {
    clearTimeout(tapT);
    if (x < 0.35) { skip(-10); hint('#tapL'); } else if (x > 0.65) { skip(10); hint('#tapR'); } else must('#bFs').click();
    lastTap = 0; return;
  }
  lastTap = now;
  tapT = window.setTimeout(() => {
    if (matchMedia('(hover: hover)').matches) togglePlay();
    else if (player.classList.contains('show-ctrl')) player.classList.remove('show-ctrl'); else flashCtrl();
  }, 260);
});
player.addEventListener('mousemove', flashCtrl);
function hint(id: string): void { const h = must(id); h.classList.add('show'); setTimeout(() => h.classList.remove('show'), 450); }

player.addEventListener('keydown', (e) => {
  if (/input|textarea/i.test((e.target as HTMLElement).tagName)) return;
  const k = e.key.toLowerCase();
  const act: Record<string, () => void> = {
    ' ': togglePlay, k: togglePlay, arrowright: () => skip(10), l: () => skip(10), arrowleft: () => skip(-10), j: () => skip(-10),
    arrowup: () => { v.volume = Math.min(1, v.volume + 0.1); }, arrowdown: () => { v.volume = Math.max(0, v.volume - 0.1); },
    f: () => must('#bFs').click(), m: () => { v.muted = !v.muted; }, n: () => must('#bNext').click()
  };
  if (act[k]) { e.preventDefault(); act[k](); }
  flashCtrl();
});

// Seek bar (pointer events cover mouse + touch)
const seek = must('#seek'); let dragging = false;
const seekPct = (e: PointerEvent) => { const r = seek.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); };
const paintSeek = (p: number) => { must('#sFill').style.width = p * 100 + '%'; must('#sKnob').style.left = p * 100 + '%'; seek.setAttribute('aria-valuenow', String(Math.round(p * 100))); };
seek.addEventListener('pointerdown', (e) => { if (!v.duration) return; dragging = true; seek.classList.add('drag'); seek.setPointerCapture(e.pointerId); paintSeek(seekPct(e)); });
seek.addEventListener('pointermove', (e) => { const p = seekPct(e), tip = must('#sTip'); tip.style.left = p * 100 + '%'; tip.textContent = C.fmtClock(p * (v.duration || 0)); if (dragging) paintSeek(p); });
seek.addEventListener('pointerup', (e) => { if (!dragging) return; dragging = false; seek.classList.remove('drag'); v.currentTime = seekPct(e) * v.duration; });
seek.addEventListener('keydown', (e) => { if (e.key === 'ArrowRight') { skip(5); e.stopPropagation(); } if (e.key === 'ArrowLeft') { skip(-5); e.stopPropagation(); } });

/* ── Video events ────────────────────────────────────────────────────── */
v.addEventListener('play', () => { setPPIcons(); flashCtrl(); });
v.addEventListener('pause', () => { setPPIcons(); player.classList.add('show-ctrl'); saveProgress(true); });
v.addEventListener('waiting', () => loading(true));
v.addEventListener('playing', () => { loading(false); hideState(); unfreeze(); });
v.addEventListener('seeked', () => { if (v.paused && v.readyState >= 2) unfreeze(); });
v.addEventListener('canplay', () => loading(false));
v.addEventListener('volumechange', () => { must('#bMute').innerHTML = ic(v.muted || v.volume === 0 ? 'vol-off' : v.volume < 0.5 ? 'vol-low' : 'vol-high'); must<HTMLInputElement>('#bVol').value = String(v.muted ? 0 : v.volume); });
v.addEventListener('durationchange', () => { must('#tDur').textContent = C.fmtClock(v.duration); if (S.mode === 'main' && v.duration) S.dur = v.duration; });
v.addEventListener('progress', () => { if (v.duration && v.buffered.length) must('#sBuf').style.width = (v.buffered.end(v.buffered.length - 1) / v.duration) * 100 + '%'; });
v.addEventListener('timeupdate', () => {
  if (!v.duration) return;
  must('#tCur').textContent = C.fmtClock(v.currentTime);
  if (!dragging) paintSeek(v.currentTime / v.duration);
  if (S.mode === 'main') {
    if (Date.now() - S.lastSave > 10000) saveProgress();
    if (S.isSeries && v.duration - v.currentTime < 25 && v.duration > 300 && !S.nextTimer && !S.nextDismissed) showNextUp();
  }
});
v.addEventListener('ended', () => {
  if (S.mode === 'trailer') { S.mode = 'idle'; must('#pPoster').classList.remove('gone'); updatePlayLabel(); paintBadge(); return; }
  saveProgress(true);
  const n = nextEpisode(); if (n && !S.nextDismissed) selectEpisode(n.se, n.ep, true);
});
v.addEventListener('error', () => {
  if (!v.getAttribute('src')) return;
  if (S.mode === 'trailer') { loading(false); showState('Trailer unavailable', 'The trailer didn’t load.', [['Play ' + (S.isSeries ? epLabel() : 'title'), () => { S.mode = 'idle'; play(); }]]); return; }
  if (S.mode === 'main') nextFallback(v.currentTime || resumePoint());
});

/* ── Next-up ─────────────────────────────────────────────────────────── */
function showNextUp(): void {
  const n = nextEpisode(); if (!n) return;
  let left = 8;
  must('#nextLbl').textContent = `S${n.se} E${n.ep}`; must('#nextCount').textContent = String(left);
  must('#nextUp').classList.add('show');
  S.nextTimer = window.setInterval(() => { left--; must('#nextCount').textContent = String(left); if (left <= 0) { hideNextUp(); selectEpisode(n.se, n.ep, true); } }, 1000);
}
function hideNextUp(): void { clearInterval(S.nextTimer); S.nextTimer = 0; S.nextDismissed = false; must('#nextUp').classList.remove('show'); }
must('#nextGo').onclick = () => { const n = nextEpisode(); hideNextUp(); if (n) selectEpisode(n.se, n.ep, true); };
must('#nextX').onclick = () => { hideNextUp(); S.nextDismissed = true; };

/* ── Progress ────────────────────────────────────────────────────────── */
function saveProgress(force = false): void {
  if (S.mode !== 'main' || !v.duration || isNaN(v.duration) || v.currentTime < 5) return;
  if (!force && Date.now() - S.lastSave < 10000) return;
  S.lastSave = Date.now();
  C.progress.set(S.id, { pos: Math.floor(v.currentTime), dur: Math.floor(v.duration), title: S.title, poster: S.poster, path: S.path, se: S.isSeries ? S.se : 0, ep: S.isSeries ? S.ep : 0 });
  if (!C.state.user) return;
  const body: Record<string, unknown> = { movie_id: S.id, movie_title: S.title, poster_url: S.poster, movie_type: S.isSeries ? 'series' : 'movie', progress_sec: Math.floor(v.currentTime), duration_sec: Math.floor(v.duration) };
  if (S.isSeries) { body.season = S.se; body.episode = S.ep; }
  fetch(C.CX + 'api/watch_progress.php?action=save_progress', { method: 'POST', credentials: 'include', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => { /* */ });
}
function logView(): void {
  if (!C.state.user) return;
  fetch(C.CX + 'api/watch_progress.php?action=log_view', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ movie_id: S.id, movie_title: S.title, poster_url: S.poster, movie_type: S.isSeries ? 'series' : 'movie' }) }).catch(() => { /* */ });
}
window.addEventListener('pagehide', () => { saveProgress(true); abr.destroy(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) saveProgress(true); });
document.addEventListener('click', (e) => { if (!(e.target as HTMLElement).closest('.menu,#bSet,#bSub')) closeMenus(); });
