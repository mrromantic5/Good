/* ═══════════════════════════════════════════════════════════════════════
   CineFliX Core · v6.1 — chrome, ChatXAP auth, My List, progress, cards,
   search, icons, utilities. Shared by every page (bundled once, cached).
═══════════════════════════════════════════════════════════════════════ */
import * as API from './api';
import { ICONS, type IconName } from './icons.gen';
import type { Title, Match, ChatXAPUser, Team } from './types';

/* ── Environment ─────────────────────────────────────────────────────── */
export const onChatXAP = /^c\.x\.t-lyfe\.com\.ng$/i.test(location.hostname);
export const CX = onChatXAP ? '/' : 'https://c.x.t-lyfe.com.ng/';
const R2 = 'https://pub-abef3ded14bb475bab5e6cbee8e2a7d5.r2.dev';

const file = location.pathname.split('/').pop() || 'index.html';
const isHomeFile = /^(index|movie)\.html$/.test(file) || file === '';
if (isHomeFile && file) { try { localStorage.setItem('cf_home', file); } catch { /* */ } }
export const HOME = (() => { try { return localStorage.getItem('cf_home') || 'index.html'; } catch { return 'index.html'; } })();

export const state: { user: ChatXAPUser | null } = { user: null };

export const links = {
  login: () => CX + 'login.html?redirect=' + encodeURIComponent(location.href),
  profile: CX + 'profile.html',
  chatxap: CX + 'updates.html',
  userProfile: (id: string | number) => CX + 'user_profile.html?user=' + encodeURIComponent(String(id))
};

/* ── Utilities ───────────────────────────────────────────────────────── */
export const esc = (s: unknown): string =>
  s == null ? '' : String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export function $<T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T | null { return root.querySelector<T>(sel); }
export function $$<T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T[] { return Array.from(root.querySelectorAll<T>(sel)); }
export function must<T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T {
  const el = root.querySelector<T>(sel); if (!el) throw new Error('Missing element ' + sel); return el;
}
export const fill = (sel: string | Element | null, html: string): void => {
  const el = typeof sel === 'string' ? $(sel) : sel; if (el) el.innerHTML = html;
};

export function ic(name: IconName, cls = ''): string {
  const [vb, d] = ICONS[name];
  return `<svg class="ic${cls ? ' ' + cls : ''}" viewBox="${vb}" aria-hidden="true" focusable="false"><path d="${d}"/></svg>`;
}

export const fmtClock = (s: number): string => {
  s = Math.max(0, Math.floor(s || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0');
};
export const fmtRuntime = (s: number): string => {
  if (!s) return '';
  const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
  return h ? `${h}h${m ? ' ' + m + 'm' : ''}` : m + 'm';
};
export const fmtSize = (b: number): string => {
  if (!b) return '';
  const u = ['B', 'KB', 'MB', 'GB']; let i = 0; while (b >= 1024 && i < 3) { b /= 1024; i++; }
  return b.toFixed(i > 1 ? 1 : 0) + ' ' + u[i];
};
export const ago = (d: string): string => {
  if (!d) return '';
  const t = new Date(String(d).replace(' ', 'T')).getTime();
  const diff = Math.floor((Date.now() - t) / 1000);
  if (isNaN(diff) || diff < 60) return 'Just now';
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  if (diff < 604800) return Math.floor(diff / 86400) + 'd ago';
  return new Date(t).toLocaleDateString();
};
export const timeOf = (ms: number): string => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
export function kickoff(ms: number): string {
  if (!ms) return '';
  const d = new Date(ms), now = new Date();
  const day0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dd = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - day0) / 864e5);
  const t = timeOf(ms);
  if (dd === 0) return 'Today ' + t;
  if (dd === 1) return 'Tomorrow ' + t;
  if (dd === -1) return 'Yesterday ' + t;
  return d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }) + ', ' + t;
}
export function countdown(ms: number): string {
  let s = Math.max(0, Math.floor((ms - Date.now()) / 1000));
  const d = Math.floor(s / 86400); s %= 86400;
  return (d ? d + 'd ' : '') + [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((n) => String(n).padStart(2, '0')).join(':');
}
export function debounce<A extends unknown[]>(fn: (...a: A) => void, ms: number): (...a: A) => void {
  let t = 0; return (...a: A) => { clearTimeout(t); t = window.setTimeout(() => fn(...a), ms); };
}
export const domReady = (): Promise<void> => new Promise((r) => {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => r()); else r();
});

let toastT = 0;
export function toast(msg: string, ms = 2600): void {
  let el = $('#cfToast');
  if (!el) { el = document.createElement('div'); el.id = 'cfToast'; el.className = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toastT); toastT = window.setTimeout(() => el!.classList.remove('show'), ms);
}

/* ── Images: fade-in + graceful fallback, via one capture listener ───── */
document.addEventListener('load', (e) => {
  const t = e.target as HTMLElement; if (t.tagName === 'IMG' && t.classList.contains('fade')) t.classList.add('ok');
}, true);
document.addEventListener('error', (e) => {
  const t = e.target as HTMLImageElement; if (t.tagName !== 'IMG') return;
  if (t.dataset.alt != null) t.replaceWith(document.createTextNode(t.dataset.alt)); else if (t.classList.contains('fade') || t.dataset.drop != null) t.remove();
}, true);
const imgTag = (src: string, extra = ''): string =>
  src ? `<img class="fade" src="${esc(src)}" alt="" loading="lazy" decoding="async"${extra}>` : '';

/* ── Avatars ─────────────────────────────────────────────────────────── */
export function avatarUrl(avatar?: string): string {
  if (window.ChatXAP?.getAvatarUrl) return window.ChatXAP.getAvatarUrl(avatar || '');
  if (!avatar) return '';
  if (/^https?:/.test(avatar)) return avatar;
  if (avatar.startsWith('profile-pictures/')) return R2 + '/' + avatar;
  if (avatar.startsWith('avatar')) return CX + 'avatars/' + avatar + '.png';
  return CX + 'uploads/avatars/' + avatar;
}
export function avatarHTML(avatar?: string, name?: string): string {
  const u = avatarUrl(avatar), init = esc((name || '?').charAt(0).toUpperCase());
  return u ? `<img src="${esc(u)}" alt="" loading="lazy" data-alt="${init}">` : init;
}
export const vBadge = '<svg class="vbadge" viewBox="0 0 24 24" aria-label="Verified"><circle cx="12" cy="12" r="11" fill="#1D9BF0"/><path d="M7 12.5l3.5 3.5 6.5-7" stroke="#fff" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/* ── Links ───────────────────────────────────────────────────────────── */
export interface TitleRef { id: string; title?: string; detailPath?: string; poster?: string; isSeries?: boolean }
export function titleHref(t: TitleRef, extra?: Record<string, string | number | undefined>): string {
  const p = new URLSearchParams({ id: t.id });
  if (t.title) p.set('title', t.title);
  if (t.detailPath) p.set('path', t.detailPath);
  if (t.poster) p.set('poster', t.poster);
  p.set('type', t.isSeries ? 'series' : 'movie');
  if (extra) for (const [k, v] of Object.entries(extra)) if (v != null) p.set(k, String(v));
  return 'player.html?' + p.toString();
}
export const matchHref = (m: Match): string => 'live.html?' + new URLSearchParams({ id: m.id, h: m.home.name, a: m.away.name }).toString();
export const route = (r: string): string => HOME + '#/' + r;

/* ── Auth (ChatXAP) ──────────────────────────────────────────────────── */
export async function loadUser(opts: { required?: boolean } = {}): Promise<ChatXAPUser | null> {
  try { const c = localStorage.getItem('chatxap_user'); if (c) state.user = JSON.parse(c); } catch { /* */ }
  renderAvatar();
  try {
    const r = await fetch(CX + 'backend/auth_check.php', { credentials: 'include', cache: 'no-store' });
    const d = await r.json();
    if (d.status === 'authenticated' && d.user) {
      state.user = d.user;
      try { localStorage.setItem('chatxap_user', JSON.stringify(d.user)); localStorage.setItem('chatxap_auth_ts', String(Date.now())); } catch { /* */ }
    } else if (d.status === 'restricted') location.replace(CX + 'restricted.html');
    else if (d.status === 'not_authenticated' && opts.required) location.replace(links.login());
  } catch { /* offline: keep cached user */ }
  renderAvatar();
  return state.user;
}
function renderAvatar(): void {
  const el = $<HTMLAnchorElement>('#navAvatar'); if (!el) return;
  if (state.user) { el.innerHTML = avatarHTML(state.user.avatar, state.user.username); el.title = state.user.username || 'Profile'; el.href = links.profile; }
  else { el.innerHTML = ic('user'); el.href = links.login(); }
}
export function greeting(): string {
  const h = new Date().getHours();
  const g = h < 5 ? 'Late night' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  return state.user?.username ? `${g}, ${state.user.username}` : g;
}

/* ── My List ─────────────────────────────────────────────────────────── */
export interface ListItem { id: string; title: string; poster: string; isSeries: boolean; detailPath: string; year: string; rating: number; added: number }
const LIST_KEY = 'cf_mylist_v1';
const readList = (): ListItem[] => { try { return JSON.parse(localStorage.getItem(LIST_KEY) || '[]'); } catch { return []; } };
export const myList = {
  all: readList,
  has: (id: string) => readList().some((x) => x.id === id),
  toggle(t: Title): boolean {
    const l = readList(), i = l.findIndex((x) => x.id === t.id);
    if (i >= 0) { l.splice(i, 1); save(l); toast('Removed from My List'); return false; }
    l.unshift({ id: t.id, title: t.title, poster: t.poster, isSeries: t.isSeries, detailPath: t.detailPath, year: t.year, rating: t.rating, added: Date.now() });
    save(l); toast('Saved to My List'); return true;
    function save(x: ListItem[]) { try { localStorage.setItem(LIST_KEY, JSON.stringify(x.slice(0, 300))); } catch { /* */ } }
  }
};

/* ── Local watch progress ────────────────────────────────────────────── */
export interface Progress { pos: number; dur: number; title?: string; poster?: string; path?: string; se?: number; ep?: number; at: number; seen?: Record<string, 1> }
const PROG_KEY = 'cf_progress_v1';
const readProg = (): Record<string, Progress> => { try { return JSON.parse(localStorage.getItem(PROG_KEY) || '{}'); } catch { return {}; } };
export const progress = {
  get: (id: string): Progress | null => readProg()[id] || null,
  set(id: string, rec: Omit<Progress, 'at' | 'seen'>): void {
    const all = readProg();
    const prev = all[id];
    const next: Progress = { ...(prev || {}), ...rec, at: Date.now() };
    if (rec.se && rec.ep) next.seen = { ...(prev?.seen || {}), [rec.se + 'x' + rec.ep]: 1 };
    all[id] = next;
    const keys = Object.keys(all);
    if (keys.length > 120) keys.sort((a, b) => all[a].at - all[b].at).slice(0, keys.length - 120).forEach((k) => delete all[k]);
    try { localStorage.setItem(PROG_KEY, JSON.stringify(all)); } catch { /* */ }
  },
  recent(n = 20): (Progress & { id: string })[] {
    const all = readProg();
    return Object.keys(all).map((id) => ({ id, ...all[id] }))
      .filter((r) => r.dur && r.pos > 30 && r.pos < r.dur - 60).sort((a, b) => b.at - a.at).slice(0, n);
  }
};

/* ── Cards ───────────────────────────────────────────────────────────── */
export function posterCard(t: Title, opts: { progress?: number; sub?: string; rank?: number } = {}): string {
  const meta = opts.sub ?? [t.year, t.isSeries ? 'Series' : t.duration ? fmtRuntime(t.duration) : 'Movie'].filter(Boolean).join('  ');
  const art = `<div class="poster-art">${imgTag(t.poster)}` +
    (t.isSeries ? '<span class="poster-badge">Series</span>' : t.corner ? `<span class="poster-badge">${esc(t.corner)}</span>` : '') +
    (t.rating ? `<span class="poster-rate">${ic('star')}${t.rating.toFixed(1)}</span>` : '') +
    (opts.progress != null ? `<span class="poster-prog"><b style="width:${opts.progress}%"></b></span>` : '') + '</div>';
  const isRank = opts.rank != null;
  return `<a class="poster${isRank ? ' rank-card' : ''}" href="${esc(titleHref(t))}" title="${esc(t.title)}"${isRank ? ` aria-label="Number ${opts.rank}: ${esc(t.title)}"` : ''}>` +
    (isRank ? `<div class="rank-art"><span class="rank-n" aria-hidden="true">${opts.rank}</span>${art}</div>` : art) +
    `<div class="poster-title">${esc(t.title)}</div><div class="poster-meta">${esc(meta)}</div></a>`;
}

export function teamLogo(team: Team): string {
  return `<span class="team-logo">${team.logo ? `<img src="${esc(team.logo)}" alt="" loading="lazy" data-alt="${esc(team.short || '?')}">` : esc(team.short || team.name.slice(0, 3))}</span>`;
}
export function matchStatusPill(m: Match): string {
  if (m.status === 'live') return '<span class="pill pill-live"><span class="live-pip light"></span>Live</span>';
  if (m.status === 'ended') return '<span class="pill pill-line">Full time</span>';
  return `<span class="pill pill-line">${esc(kickoff(m.start))}</span>`;
}
export function scoreHTML(m: Match): string {
  const has = m.status !== 'upcoming' && (m.home.score !== '' || m.away.score !== '');
  return `<div class="score">${has ? `${esc(m.home.score || '0')}<span class="vs">:</span>${esc(m.away.score || '0')}` : '<span class="vs">vs</span>'}</div>`;
}
export function matchCard(m: Match): string {
  const live = m.status === 'live';
  return `<a class="match${live ? ' is-live' : ''}" href="${esc(matchHref(m))}">` +
    `<div class="match-top">${matchStatusPill(m)}<span class="when">${esc(m.league)}</span></div>` +
    `<div class="match-teams"><div class="team">${teamLogo(m.home)}<span class="team-name">${esc(m.home.name)}</span></div>${scoreHTML(m)}` +
    `<div class="team">${teamLogo(m.away)}<span class="team-name">${esc(m.away.name)}</span></div></div>` +
    `<div class="match-cta"><span class="btn btn-sm ${live ? 'btn-primary' : 'btn-ghost'}">${ic(live ? 'play' : 'bell')}${live ? 'Watch live' : 'Match page'}</span></div></a>`;
}

export const skeletonRow = (n = 8, wide = false): string =>
  Array.from({ length: n }, () => `<div class="${wide ? 'poster still' : 'poster'}"><div class="poster-art sk"></div><div class="sk" style="height:12px;width:80%;margin-top:10px"></div></div>`).join('');

export function shelf(o: { id?: string; title: string; sub?: string; more?: string; html?: string; wide?: boolean }): string {
  const id = o.id || 'sh' + Math.random().toString(36).slice(2, 8);
  return `<section class="section" id="${esc(id)}"><div class="section-head"><h2 class="h2">${esc(o.title)}</h2>` +
    (o.sub ? `<span class="section-sub">${esc(o.sub)}</span>` : '') +
    (o.more ? `<a class="more" href="${esc(o.more)}">See all ${ic('chevron-right')}</a>` : '') + '</div>' +
    `<div class="shelf"><button class="shelf-btn prev" aria-label="Scroll left" data-act="scroll" data-dir="-1">${ic('chevron-left')}</button>` +
    `<div class="row">${o.html ?? skeletonRow(8, o.wide)}</div>` +
    `<button class="shelf-btn next" aria-label="Scroll right" data-act="scroll" data-dir="1">${ic('chevron-right')}</button></div></section>`;
}
export const emptyHTML = (icon: IconName, msg: string, action = ''): string => `<div class="empty">${ic(icon, 'ic-lg')}<p>${msg}</p>${action}</div>`;
export const footer = (): string =>
  `<footer class="foot"><span class="brand-name sm">CineFliX</span><span>Part of <a href="${esc(links.chatxap)}">ChatXAP</a></span>` +
  '<span>Built by TECH♤LYFE</span><a href="https://wa.link/paw1ej" target="_blank" rel="noopener">Get a website like this</a></footer>';

/* ── Chrome: nav + tab bar ───────────────────────────────────────────── */
const NAV: { r: string; label: string; icon: IconName; live?: boolean }[] = [
  { r: 'home', label: 'Home', icon: 'house' }, { r: 'movies', label: 'Movies', icon: 'film' },
  { r: 'series', label: 'Series', icon: 'tv' }, { r: 'football', label: 'Football', icon: 'futbol', live: true },
  { r: 'browse', label: 'Browse', icon: 'compass' }, { r: 'mylist', label: 'My List', icon: 'bookmark' }
];
const TABS = ['home', 'movies', 'series', 'football', 'mylist'];

export const brandHTML = (href: string): string =>
  `<a class="brand" href="${esc(href)}" aria-label="CineFliX home"><img class="brand-logo" src="images/cine.png" alt="" width="28" height="28" data-drop>` +
  '<span class="brand-name">CineFliX</span></a>';

export function mountChrome(o: { active?: string; solid?: boolean; back?: string } = {}): void {
  const href = (r: string) => (isHomeFile ? '#/' + r : route(r));
  const nav = document.createElement('header');
  nav.className = 'nav' + (o.solid ? ' solid' : ''); nav.id = 'cfNav';
  nav.innerHTML =
    `<a class="nav-back" href="${esc(o.back || links.chatxap)}" data-act="back" aria-label="${o.back ? 'Back' : 'Back to ChatXAP'}">${ic('chevron-left')}</a>` +
    brandHTML(href('home')) +
    '<nav class="nav-links" aria-label="Primary">' + NAV.map((n) => `<a class="nav-link" data-r="${n.r}" href="${esc(href(n.r))}">${n.label}${n.live ? '<span class="live-pip" hidden></span>' : ''}</a>`).join('') + '</nav>' +
    `<div class="nav-end"><button class="nav-search" data-act="search" aria-label="Search">${ic('search')}<span>Titles, people, genres</span><kbd>/</kbd></button>` +
    `<a class="avatar" id="navAvatar" href="#" aria-label="Profile">${ic('user')}</a></div>`;
  document.body.prepend(nav);

  const tab = document.createElement('nav');
  tab.className = 'tabbar'; tab.setAttribute('aria-label', 'Sections');
  tab.innerHTML = TABS.map((r) => { const n = NAV.find((x) => x.r === r)!; return `<a class="tab" data-r="${r}" href="${esc(href(r))}">${ic(n.icon)}${n.label}${n.live ? '<span class="live-pip" hidden></span>' : ''}</a>`; }).join('');
  document.body.appendChild(tab);

  if (!o.solid) {
    const onScroll = () => nav.classList.toggle('solid', window.scrollY > 40);
    window.addEventListener('scroll', onScroll, { passive: true }); onScroll();
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !/input|textarea|select/i.test((e.target as HTMLElement).tagName)) { e.preventDefault(); openSearch(); }
  });
  renderAvatar(); setActive(o.active); mountSearch();
}
export function setActive(r?: string): void {
  $$('.nav-link,.tab').forEach((a) => { const on = a.dataset.r === r; a.classList.toggle('active', on); a.toggleAttribute('aria-current', on); });
}
export const setLiveIndicator = (on: boolean): void => { $$('.nav .live-pip,.tab .live-pip').forEach((p) => { p.hidden = !on; }); };

/* ── Global delegated actions (no inline JS in markup) ───────────────── */
document.addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act]'); if (!el) return;
  switch (el.dataset.act) {
    case 'scroll': {
      const row = el.parentElement?.querySelector<HTMLElement>('.row');
      row?.scrollBy({ left: Number(el.dataset.dir) * row.clientWidth * 0.85, behavior: 'smooth' });
      break;
    }
    case 'search': e.preventDefault(); openSearch(el.dataset.q); break;
    case 'search-more': runSearch(el.dataset.q || '', Number(el.dataset.page)); break;
    case 'close-search': closeSearch(); break;
    case 'reload': location.reload(); break;
    case 'back':
      if (history.length > 1 && document.referrer.includes(location.host)) { e.preventDefault(); history.back(); }
      break;
  }
});

/* ── Search overlay ──────────────────────────────────────────────────── */
let searchSeq = 0;
function mountSearch(): void {
  const el = document.createElement('div');
  el.className = 'search'; el.id = 'cfSearch'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Search');
  el.innerHTML = `<div class="search-bar">${ic('search')}<input id="cfSearchInput" type="search" placeholder="Search movies and series" autocomplete="off" enterkeyhint="search">` +
    '<button class="btn btn-sm btn-ghost" data-act="close-search">Close</button></div>' +
    '<div class="search-body"><div class="search-sugg" id="cfSugg"></div><div id="cfSearchRes"></div></div>';
  document.body.appendChild(el);
  const input = must<HTMLInputElement>('input', el);
  const suggest = debounce((q: string) => {
    if (q.length < 2) { fill('#cfSugg', ''); return; }
    API.getSuggestions(q).then((words) => {
      if (input.value.trim() !== q) return;
      fill('#cfSugg', words.slice(0, 8).map((w) => `<button class="chip" data-act="search" data-q="${esc(w)}">${esc(w)}</button>`).join(''));
    }).catch(() => { /* suggestions are optional */ });
  }, 280);
  const run = debounce((q: string) => runSearch(q), 450);
  input.addEventListener('input', () => { const q = input.value.trim(); suggest(q); if (q.length >= 2) run(q); else searchIdle(); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') runSearch(input.value.trim()); if (e.key === 'Escape') closeSearch(); });
  searchIdle();
}
function recentQueries(): string[] { try { return JSON.parse(localStorage.getItem('cf_recent_q') || '[]'); } catch { return []; } }
function searchIdle(): void {
  const recent = recentQueries();
  fill('#cfSearchRes', recent.length
    ? '<div class="section-head"><h2 class="h2">Recent searches</h2></div><div class="chips">' + recent.map((q) => `<button class="chip" data-act="search" data-q="${esc(q)}">${esc(q)}</button>`).join('') + '</div>'
    : emptyHTML('clapper', 'Search the full catalogue by title.'));
}
export function openSearch(q?: string): void {
  const el = $('#cfSearch'); if (!el) return;
  el.classList.add('open'); document.body.style.overflow = 'hidden';
  const input = must<HTMLInputElement>('#cfSearchInput');
  setTimeout(() => input.focus(), 50);
  if (q) { input.value = q; runSearch(q); }
}
export function closeSearch(): void {
  const el = $('#cfSearch'); if (!el || !el.classList.contains('open')) return;
  el.classList.remove('open'); document.body.style.overflow = '';
}
export async function runSearch(q: string, page = 1): Promise<void> {
  if (!q) return;
  const seq = ++searchSeq;
  const res = must('#cfSearchRes');
  if (page === 1) {
    res.innerHTML = `<div class="grid">${skeletonRow(12)}</div>`;
    try { const r = recentQueries().filter((x) => x.toLowerCase() !== q.toLowerCase()); r.unshift(q); localStorage.setItem('cf_recent_q', JSON.stringify(r.slice(0, 8))); } catch { /* */ }
  }
  try {
    const out = await API.searchTitles(q, page);
    if (seq !== searchSeq) return;
    if (page === 1) {
      if (!out.items.length) { res.innerHTML = emptyHTML('search', `Nothing matches “${esc(q)}”. Check the spelling or try a shorter title.`); return; }
      res.innerHTML = `<div class="section-head"><h2 class="h2">Results for “${esc(q)}”</h2></div><div class="grid"></div><div class="center pad" id="cfSearchMore"></div>`;
    }
    $('.grid', res)?.insertAdjacentHTML('beforeend', out.items.map((t) => posterCard(t)).join(''));
    fill('#cfSearchMore', out.pager.hasMore ? `<button class="btn btn-line" data-act="search-more" data-q="${esc(q)}" data-page="${out.pager.nextPage || page + 1}">Show more results</button>` : '');
  } catch {
    if (seq !== searchSeq) return;
    if (page === 1) res.innerHTML = emptyHTML('wifi', 'Search didn’t respond. Check your connection, then try again.', `<button class="btn btn-line btn-sm" data-act="search" data-q="${esc(q)}">Try again</button>`);
    else toast('Couldn’t load more results');
  }
}

export function share(title: string, url = location.href): void {
  if (navigator.share) { navigator.share({ title, url }).catch(() => { /* cancelled */ }); return; }
  (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(() => toast('Link copied'), () => toast(url, 5000));
}

/* ── Service worker (app-shell cache for instant repeat loads) ───────── */
export function registerSW(): void {
  // Only on the CineFliX subdomain — on ChatXAP a root-scoped worker would control the whole social app.
  if (!('serviceWorker' in navigator) || location.protocol !== 'https:' || onChatXAP) return;
  window.addEventListener('load', () => { navigator.serviceWorker.register('cineflix-sw.js').catch(() => { /* optional */ }); });
}
