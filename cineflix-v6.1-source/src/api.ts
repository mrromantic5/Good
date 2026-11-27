/* ═══════════════════════════════════════════════════════════════════════
   CineFliX API service layer (TypeScript) · v6.1
   MovieBox-Pro: country · home · trending · suggest · search · filter ·
                 detail · recommend · staffrel · download · video
   Football:     MovieBox SPORT_LIVE + ESPN public site API
   Transport:    direct → same-origin PHP proxy fallback; memory +
                 sessionStorage cache; stale-while-revalidate for feeds.
═══════════════════════════════════════════════════════════════════════ */
import type {
  CFConfig, Title, Pager, Paged, HomeFeed, Section, TitleDetail, Season, CastMember, Dub,
  Stream, Subtitle, StreamSet, Match, MatchStatus, Team, League, StandingGroup, MatchSummary, TitleType
} from './types';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any; // raw upstream payloads are validated by the normalizers below

const USER: CFConfig = (typeof window !== 'undefined' && window.CF_CONFIG) || {};
const ASSET_ROOT = (() => {
  try {
    const s = (document.currentScript as HTMLScriptElement | null)?.src || import.meta.url;
    return s.replace(/cf\/dist\/.*$/, '');
  } catch { return ''; }
})();

export const config = {
  base: USER.base || 'https://api.omegatech.app/api/movie/MovieBox-pro',
  proxy: USER.proxy || ASSET_ROOT + 'cf/api/proxy.php',
  transport: USER.transport || 'auto',
  timeoutMs: USER.timeoutMs || 15000,
  legacyFallback: USER.legacyFallback !== false,
  legacyBase: USER.legacyBase || 'https://cineflix-api.brainsjetai.workers.dev',
  espnBase: 'https://site.api.espn.com/apis/site/v2/sports/soccer',
  espnStandingsBase: 'https://site.api.espn.com/apis/v2/sports/soccer'
};

const TTL: Record<string, number> = {
  country: 86400, home: 300, trending: 300, suggest: 600, search: 600, filter: 900,
  detail: 1800, recommend: 1800, staffrel: 3600, download: 240, espn: 60, espnStandings: 1800
};
/** Feeds that render instantly from the last visit, then refresh (localStorage). */
const SWR_ACTIONS = new Set(['home', 'trending']);

interface CacheEntry<T = unknown> { val: T; exp: number }
const mem = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<unknown>>();
const PROXY_FLAG = 'cf_use_proxy';

const useProxy = (): boolean => {
  if (config.transport === 'proxy') return true;
  if (config.transport === 'direct') return false;
  try { return sessionStorage.getItem(PROXY_FLAG) === '1'; } catch { return false; }
};
const flipToProxy = () => { try { sessionStorage.setItem(PROXY_FLAG, '1'); } catch { /* private mode */ } };

function cacheGet<T>(key: string, allowStale = false): T | undefined {
  let hit = mem.get(key) as CacheEntry<T> | undefined;
  if (!hit) {
    try {
      const raw = sessionStorage.getItem('cfc:' + key) ?? (allowStale ? localStorage.getItem('cfs:' + key) : null);
      if (raw) { hit = JSON.parse(raw) as CacheEntry<T>; mem.set(key, hit); }
    } catch { /* ignore */ }
  }
  if (hit && (allowStale || hit.exp > Date.now())) return hit.val;
  return undefined;
}
function cacheSet(key: string, val: unknown, ttl: number, persist = false): void {
  const entry: CacheEntry = { val, exp: Date.now() + ttl * 1000 };
  mem.set(key, entry);
  const s = JSON.stringify(entry);
  try { sessionStorage.setItem('cfc:' + key, s); } catch { try { sessionStorage.clear(); } catch { /* */ } }
  if (persist) { try { localStorage.setItem('cfs:' + key, s); } catch { /* quota */ } }
}

class HttpError extends Error { constructor(public status: number) { super('HTTP ' + status); } }

async function fetchJson(url: string, timeout = config.timeoutMs): Promise<Json> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
    if (!r.ok) throw new HttpError(r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}

function qs(params: Record<string, string | number | undefined | null>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') q.append(k, String(v));
  return q.toString();
}

type Params = Record<string, string | number | undefined | null>;

/** Core MovieBox-Pro GET with validation, caching, de-dupe and proxy fallback. */
export function requestApi(action: string, params: Params = {}, ttl?: number): Promise<Json> {
  const query = qs({ action, ...params });
  const key = 'mb:' + query;
  const ttlSec = ttl ?? TTL[action] ?? 300;
  const cached = ttlSec > 0 ? cacheGet<Json>(key) : undefined;
  if (cached !== undefined) return Promise.resolve(cached);
  const existing = inflight.get(key); if (existing) return existing;

  const validate = (p: Json): Json => {
    if (!p || p.success === false || (p.statusCode && p.statusCode >= 400)) throw new Error(p?.error || p?.message || `API failed on action="${action}"`);
    return p;
  };
  const viaProxy = () => fetchJson(config.proxy + '?' + query).then(validate);

  const run = async (): Promise<Json> => {
    if (useProxy()) return viaProxy();
    try { return validate(await fetchJson(config.base + '?' + query)); }
    catch (err) {
      const e = err as Error & { status?: number };
      if (config.transport === 'auto' && (e.name === 'TypeError' || e.name === 'AbortError' || (e.status ?? 0) >= 500)) {
        try { const j = await viaProxy(); flipToProxy(); return j; } catch { throw err; }
      }
      throw err;
    }
  };

  const p = run().then((payload) => {
    if (ttlSec > 0) cacheSet(key, payload, ttlSec, SWR_ACTIONS.has(action));
    return payload;
  }).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/** Last-known payload for a feed (any age) — for instant first paint. */
export function peekStale(action: string, params: Params = {}): Json | undefined {
  return cacheGet<Json>('mb:' + qs({ action, ...params }), true);
}

/** Proxied playable URL for <video src>. Never fetch it as JSON. */
export const buildProxyVideoUrl = (raw: string): string =>
  raw ? `${config.base}?action=video&url=${encodeURIComponent(raw)}` : '';

/* ═══════════════════════════  NORMALIZERS  ═══════════════════════════ */
const img = (o: Json): string => (!o ? '' : typeof o === 'string' ? o : o.url || '');
const num = (v: unknown): number => { const n = parseFloat(String(v)); return isNaN(n) ? 0 : n; };
const int = (v: unknown, d = 0): number => { const n = parseInt(String(v), 10); return isNaN(n) ? d : n; };
const csv = (v: unknown): string[] => String(v || '').split(',').map((x) => x.trim()).filter(Boolean);

export function normTitle(s: Json): Title | null {
  if (!s) return null;
  if (s.subject && !s.subjectId) s = { ...s.subject, _banner: s };
  const id = s.subjectId || s.id;
  if (!id) return null;
  const type: TitleType = int(s.subjectType) === 2 ? 2 : 1;
  const cover = s.cover || {};
  const still = s.stills && (Array.isArray(s.stills) ? s.stills[0] : s.stills);
  return {
    id: String(id), type, isSeries: type === 2,
    title: s.title || s.name || 'Untitled',
    description: s.description || '',
    releaseDate: s.releaseDate || '',
    year: s.releaseDate ? String(s.releaseDate).slice(0, 4) : '',
    duration: int(s.duration),
    genres: csv(s.genre),
    country: s.countryName || '',
    rating: num(s.imdbRatingValue),
    ratingCount: int(s.imdbRatingCount),
    poster: img(cover) || img(s.image),
    posterHue: cover.avgHueDark || cover.avgHueLight || '',
    backdrop: img(still) || img(s.trailer?.cover) || img(cover),
    trailer: s.trailer?.videoAddress?.url || '',
    detailPath: s.detailPath || '',
    subtitles: csv(s.subtitles),
    corner: s.corner || '',
    hasResource: s.hasResource !== false,
    dubs: Array.isArray(s.dubs) ? s.dubs : []
  };
}
const normList = (arr: Json): Title[] => (Array.isArray(arr) ? arr : []).map(normTitle).filter((t): t is Title => !!t);

function normPager(p: Json = {}): Pager {
  return { page: int(p.page, 1), nextPage: p.nextPage != null ? int(p.nextPage) : null, hasMore: !!p.hasMore, perPage: int(p.perPage), total: int(p.totalCount) };
}

export function matchStatus(raw: unknown): MatchStatus {
  const s = String(raw || '').toLowerCase();
  if (/notstart|not_start|upcoming|scheduled|pre/.test(s)) return 'upcoming';
  if (/end|finish|over|full|ft|post/.test(s)) return 'ended';
  if (/liv|progress|half|playing|ongoing|in_/.test(s)) return 'live';
  return 'upcoming';
}

function normTeam(t: Json = {}): Team {
  return {
    id: String(t.id || ''),
    name: t.name || t.nameTag || t.abbreviation || 'TBD',
    short: t.abbreviation || String(t.name || '').slice(0, 3).toUpperCase(),
    logo: img(t.avatar || t.logo || t.icon || t.avatarUrl || t.image),
    score: t.score != null && t.score !== '' ? String(t.score) : '',
    votes: int(t.voteCount)
  };
}

export function normMatch(m: Json): Match | null {
  if (!m) return null;
  const start = int(m.startTime);
  let status = matchStatus(m.status);
  if (status === 'upcoming' && start && Date.now() > start && Date.now() - start < 2 * 3600e3) status = 'live';
  return {
    id: String(m.matchId || m.id || ''), source: 'moviebox',
    league: m.league || m.competition || 'Football',
    home: normTeam(m.team1), away: normTeam(m.team2),
    start, status, statusRaw: m.status || '',
    streamUrl: m.url || '', image: img(m.image),
    title: String(m.content || '').replace(/\s*\n\s*/g, ' ')
  };
}

/* ═══════════════════════════  ENDPOINTS  ═════════════════════════════ */

export const getCountry = (): Promise<string> => requestApi('country').then((r) => r.data?.countryCode || '');

export function parseHome(r: Json): HomeFeed {
  const d = r?.data || {};
  const out: HomeFeed = { banners: [], sections: [], live: [], liveTitle: 'Football Live', liveUrl: '', platforms: [] };
  out.platforms = (d.platformList || []).map((p: Json) => p.name).filter(Boolean);
  for (const op of d.operatingList || []) {
    const type = String(op.type || '').toUpperCase();
    if (type === 'BANNER' && Array.isArray(op.banner?.items)) {
      for (const b of op.banner.items) {
        const t = normTitle(b.subject || b); if (!t) continue;
        t.bannerImage = img(b.image) || t.backdrop; t.bannerTitle = b.title || t.title;
        out.banners.push(t);
      }
    } else if (type === 'SPORT_LIVE' || (Array.isArray(op.liveList) && op.liveList.length)) {
      out.liveTitle = op.title || out.liveTitle; out.liveUrl = op.url || '';
      for (const m of op.liveList || []) { const x = normMatch(m); if (x?.id) out.live.push(x); }
    } else if (Array.isArray(op.subjects) && op.subjects.length) {
      const items = normList(op.subjects); if (!items.length) continue;
      const series = items.filter((i) => i.isSeries).length;
      const sec: Section = { id: String(op.opId || op.title || out.sections.length), title: op.title || 'Featured', kind: series > items.length / 2 ? 'series' : 'movie', items };
      out.sections.push(sec);
    }
  }
  return out;
}
export const getHome = (): Promise<HomeFeed> => requestApi('home').then(parseHome);
export const peekHome = (): HomeFeed | null => { const s = peekStale('home'); return s ? parseHome(s) : null; };

export function parseTrending(r: Json): Paged<Title> { const d = r?.data || {}; return { items: normList(d.subjectList), pager: normPager(d.pager) }; }
export const getTrending = (page = 1): Promise<Paged<Title>> =>
  requestApi('trending', { page: page > 1 ? page : undefined }).then(parseTrending);
export const peekTrending = (): Paged<Title> | null => { const s = peekStale('trending'); return s ? parseTrending(s) : null; };

export function getSuggestions(keyword: string): Promise<string[]> {
  keyword = keyword.trim(); if (!keyword) return Promise.resolve([]);
  return requestApi('suggest', { keyword }).then((r) => (r.data?.items || []).map((i: Json) => i.word || i.title || '').filter(Boolean));
}

export function searchTitles(keyword: string, page = 1): Promise<Paged<Title>> {
  keyword = keyword.trim(); if (!keyword) return Promise.resolve({ items: [], pager: normPager() });
  return requestApi('search', { keyword, page }).then((r) => {
    const inner = r.data?.data || r.data || {}; // NB: double-nested
    return { items: normList(inner.items), pager: normPager(inner.pager) };
  });
}

export const filterCatalog = (o: { genre?: string; year?: string | number; page?: number }): Promise<Paged<Title>> =>
  requestApi('filter', { genre: o.genre, year: o.year, page: o.page || 1 }).then((r) => ({ items: normList(r.data?.items), pager: normPager(r.data?.pager) }));

export function getTitle(subjectId: string): Promise<TitleDetail> {
  return requestApi('detail', { subjectId }).then((r) => {
    const d = r.data || {};
    const subject = normTitle(d.subject);
    const seasons: Season[] = (d.resource?.seasons || []).map((s: Json) => ({
      se: int(s.se, 1), maxEp: int(s.maxEp),
      resolutions: (s.resolutions || []).map((x: Json) => ({ res: int(x.resolution), epNum: int(x.epNum) }))
    })).filter((s: Season) => s.maxEp > 0).sort((a: Season, b: Season) => a.se - b.se);
    const seen = new Set<string>();
    const cast: CastMember[] = (d.stars || []).filter((p: Json) => { const k = p.staffId + '|' + p.name; if (seen.has(k)) return false; seen.add(k); return true; })
      .map((p: Json) => ({ id: String(p.staffId || ''), name: p.name || '', role: p.character || '', avatar: p.avatarUrl || '', type: p.staffType }));
    const dubs: Dub[] = (subject?.dubs || []).map((x) => ({ id: String(x.subjectId || ''), lang: x.lanName || x.lanCode || '', code: x.lanCode || '', original: !!x.original, detailPath: x.detailPath || '' })).filter((x) => x.id);
    return { subject, seasons, cast, dubs, locked: !!d.isForbid };
  });
}

export const getRecommendations = (subjectId: string): Promise<Title[]> =>
  requestApi('recommend', { subjectId }).then((r) => normList(r.data?.items).filter((i) => i.id !== String(subjectId)));

export const getStaffRelated = (staffId: string): Promise<Title[]> =>
  requestApi('staffrel', { staffId }).then((r) => {
    const d = r.data; return normList(Array.isArray(d) ? d : d?.items || d?.subjectList || d?.list || []);
  });

/* ── Streams ─────────────────────────────────────────────────────────── */
const parseRes = (v: unknown): number => { const m = String(v || '').match(/(\d{3,4})/); return m ? parseInt(m[1], 10) : 0; };

function normStream(q: Json, i: number): Stream | null {
  if (!q) return null;
  if (typeof q === 'string') return { label: 'Source ' + (i + 1), res: parseRes(q), url: q, size: 0, format: 'mp4' };
  const url = q.url || q.downloadUrl || q.download_url || q.streamUrl || q.directUrl || q.link || q.src || q.resourceLink || '';
  if (!url) return null;
  const res = parseRes(q.resolution || q.quality || q.label || q.definition);
  return { label: res ? res + 'p' : q.label || q.quality || 'Source ' + (i + 1), res, url, size: int(q.size || q.fileSize), format: String(q.format || q.codecName || 'mp4').toLowerCase() };
}
function normSub(s: Json): Subtitle | null {
  const url = s?.url || s?.link || s?.src; if (!url) return null;
  return { lang: s.lan || s.lanCode || s.lang || s.language || '', label: s.lanName || s.label || s.language || s.lan || 'Subtitle', url };
}
function finalize(list: Stream[], subs: Subtitle[], source: StreamSet['source']): StreamSet {
  const seen = new Set<string>();
  list = list.filter((s) => (seen.has(s.url) ? false : (seen.add(s.url), true))).sort((a, b) => b.res - a.res);
  return { streams: list, best: list[0] || null, subtitles: subs, audio: [], empty: list.length === 0, source };
}

export async function getStreams(o: { subjectId: string; detailPath: string; isSeries: boolean; se?: number; ep?: number }): Promise<StreamSet> {
  const se = o.isSeries ? o.se || 1 : 0, ep = o.isSeries ? o.ep || 1 : 0;
  let out: StreamSet;
  try {
    const r = await requestApi('download', { subjectId: o.subjectId, detailPath: o.detailPath, se, ep });
    const list = [...(r.qualities || []), ...(r.availableStreams || [])].map(normStream).filter((x): x is Stream => !!x);
    if (r.bestQualityUrl && !list.some((x) => x.url === r.bestQualityUrl)) list.push({ label: r.bestQuality || 'Best', res: parseRes(r.bestQuality), url: r.bestQualityUrl, size: 0, format: 'mp4' });
    out = finalize(list, (r.subtitles || []).map(normSub).filter(Boolean) as Subtitle[], 'moviebox');
    out.audio = r.audioTracks || [];
  } catch { out = finalize([], [], 'moviebox'); }
  if (!out.empty || !config.legacyFallback) return out;
  try { const leg = await getLegacyStreams(o.subjectId, o.isSeries ? se : null, o.isSeries ? ep : null); return leg.empty ? out : leg; }
  catch { return out; }
}

export async function getLegacyStreams(id: string, season: number | null, episode: number | null): Promise<StreamSet> {
  let url = config.legacyBase + '/api/sources/' + encodeURIComponent(id);
  if (season != null) url += '?season=' + season + (episode != null ? '&episode=' + episode : '');
  const key = 'leg:' + url;
  const c = cacheGet<StreamSet>(key); if (c) return c;
  const j = await fetchJson(url, 12000);
  const d = j?.data || j;
  const raw: Json[] = d?.processedSources || d?.downloads || d?.sources || [];
  const list = raw.map((s, i): Stream | null => {
    const u = s.directUrl || s.downloadUrl || s.url || s.streamUrl;
    return u ? { label: s.quality ? parseRes(s.quality) + 'p' : 'Source ' + (i + 1), res: parseRes(s.quality), url: u, alt: s.streamUrl || '', size: int(s.size), format: 'mp4' } : null;
  }).filter((x): x is Stream => !!x);
  const out = finalize(list, (d?.captions || d?.subtitles || []).map(normSub).filter(Boolean) as Subtitle[], 'legacy');
  cacheSet(key, out, TTL.download);
  return out;
}

/** Subtitle file → WebVTT (converts SRT). Direct first, then proxy. */
export async function fetchSubtitleVtt(url: string): Promise<string> {
  const get = async (u: string) => { const r = await fetch(u); if (!r.ok) throw new HttpError(r.status); return r.text(); };
  let txt: string;
  try { txt = await get(url); } catch { txt = await get(config.proxy + '?sub=' + encodeURIComponent(url)); }
  txt = txt.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  if (/^WEBVTT/.test(txt)) return txt;
  return 'WEBVTT\n\n' + txt.replace(/^\d+\s*$/gm, '').replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

/* ═══════════════════════════  FOOTBALL  ══════════════════════════════ */
const ORDER: Record<MatchStatus, number> = { live: 0, upcoming: 1, ended: 2 };
export const sortMatches = (l: Match[]): Match[] => l.slice().sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.start - b.start);
export const getLiveMatches = (): Promise<Match[]> => getHome().then((h) => sortMatches(h.live));

export const LEAGUES: League[] = [
  { id: 'eng.1', name: 'Premier League', short: 'EPL' },
  { id: 'uefa.champions', name: 'Champions League', short: 'UCL' },
  { id: 'esp.1', name: 'LaLiga', short: 'LIGA' },
  { id: 'ita.1', name: 'Serie A', short: 'SA' },
  { id: 'ger.1', name: 'Bundesliga', short: 'BUN' },
  { id: 'fra.1', name: 'Ligue 1', short: 'L1' },
  { id: 'uefa.europa', name: 'Europa League', short: 'UEL' },
  { id: 'eng.fa', name: 'FA Cup', short: 'FA' }
];
export const leagueName = (id: string): string => LEAGUES.find((l) => l.id === id)?.name || id;

function espnFetch(url: string, ttl: number): Promise<Json> {
  const key = 'espn:' + url;
  const c = cacheGet<Json>(key); if (c !== undefined) return Promise.resolve(c);
  const ex = inflight.get(key); if (ex) return ex;
  const p = fetchJson(url, 12000)
    .catch((err) => { if (config.transport === 'direct') throw err; return fetchJson(config.proxy + '?espn=' + encodeURIComponent(url)); })
    .then((j) => { cacheSet(key, j, ttl); return j; })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}
const ymd = (d: Date): string => d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');

function espnTeam(c: Json = {}): Team {
  const t = c.team || {};
  return { id: String(t.id || ''), name: t.displayName || t.name || 'TBD', short: t.abbreviation || '', logo: t.logo || t.logos?.[0]?.href || '', score: c.score != null ? String(c.score) : '', votes: 0, winner: !!c.winner };
}
function normEspnEvent(e: Json, league: League): Match {
  const comp = e.competitions?.[0] || {};
  const cs: Json[] = comp.competitors || [];
  const st = e.status?.type || {};
  return {
    id: String(e.id), source: 'espn', league: league.name, leagueId: league.id,
    home: espnTeam(cs.find((c) => c.homeAway === 'home') || cs[0]),
    away: espnTeam(cs.find((c) => c.homeAway === 'away') || cs[1]),
    start: Date.parse(e.date) || 0,
    status: st.state === 'in' ? 'live' : st.state === 'post' ? 'ended' : 'upcoming',
    clock: st.shortDetail || st.detail || '', venue: comp.venue?.fullName || ''
  };
}

export function getScoreboard(leagueId: string, date: Date): Promise<Match[]> {
  const league = LEAGUES.find((l) => l.id === leagueId) || { id: leagueId, name: leagueId, short: '' };
  return espnFetch(`${config.espnBase}/${league.id}/scoreboard?dates=${ymd(date)}`, TTL.espn)
    .then((j) => (j.events || []).map((e: Json) => normEspnEvent(e, league)));
}

export function getStandings(leagueId: string): Promise<StandingGroup[]> {
  return espnFetch(`${config.espnStandingsBase}/${leagueId}/standings`, TTL.espnStandings).then((j) => {
    const groups: Json[] = j.children?.length ? j.children : [j];
    return groups.map((g) => {
      const rows = (g.standings?.entries || []).map((en: Json) => {
        const s: Record<string, number> = {};
        for (const x of en.stats || []) s[x.name] = num(x.value ?? x.displayValue);
        const t = en.team || {};
        return { rank: s.rank || 0, team: t.displayName || t.name || '', short: t.abbreviation || '', logo: t.logos?.[0]?.href || '', gp: s.gamesPlayed | 0, w: s.wins | 0, d: s.ties | 0, l: s.losses | 0, gd: s.pointDifferential | 0, pts: s.points | 0, note: en.note?.color || '' };
      }).sort((a: { rank: number; pts: number }, b: { rank: number; pts: number }) => (a.rank || 99) - (b.rank || 99) || b.pts - a.pts);
      return { group: g.name || g.abbreviation || '', rows };
    }).filter((g) => g.rows.length);
  });
}

export function getMatchSummary(leagueId: string, eventId: string): Promise<MatchSummary> {
  return espnFetch(`${config.espnBase}/${leagueId}/summary?event=${encodeURIComponent(eventId)}`, TTL.espn).then((j) => {
    const events = (j.keyEvents || []).map((k: Json) => ({ minute: k.clock?.displayValue || '', type: k.type?.text || k.type?.type || '', text: k.text || k.shortText || '', team: k.team?.displayName || '', scoring: !!k.scoringPlay })).filter((k: { text: string }) => k.text);
    const highlights = (j.videos || []).map((v: Json) => {
      const src = v.links?.source; const url = src?.HD?.href || src?.mezzanine?.href || src?.href;
      return url ? { title: v.headline || v.title || 'Highlights', thumb: v.thumbnail || '', url, duration: v.duration || 0 } : null;
    }).filter(Boolean);
    const stats: MatchSummary['stats'] = [];
    const box = j.boxscore?.teams;
    if (box?.length === 2) {
      const b: Json[] = box[1].statistics || [];
      for (const st of box[0].statistics || []) { const o = b.find((x) => x.name === st.name); if (o && st.label) stats.push({ label: st.label, home: st.displayValue, away: o.displayValue }); }
    }
    return { events, highlights, stats: stats.slice(0, 8) };
  });
}

/** Fuzzy-link an ESPN fixture to a MovieBox stream by team names. */
export function findStreamFor(match: Match, live: Match[]): Match | null {
  const key = (n: string) => n.toLowerCase().replace(/\b(fc|cf|afc|sc|club|de|the)\b|\./g, '').replace(/\s+/g, ' ').trim();
  const same = (a: string, b: string) => { a = key(a); b = key(b); return !!a && !!b && (a === b || a.includes(b) || b.includes(a)); };
  return live.find((l) => (same(l.home.name, match.home.name) && same(l.away.name, match.away.name)) || (same(l.home.name, match.away.name) && same(l.away.name, match.home.name))) || null;
}
