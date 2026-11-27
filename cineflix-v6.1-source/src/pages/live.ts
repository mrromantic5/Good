/* CineFliX Live Football · v6.1 — live.html?id=<matchId>&h=<home>&a=<away>
   Stream: MovieBox SPORT_LIVE → match.streamUrl (third-party, sandboxed iframe). */
import * as API from '../api';
import * as C from '../core';
import { esc, fill, must, $ } from '../core';
import { mountComments } from '../comments';
import type { Match } from '../types';

const qp = new URLSearchParams(location.search);
const ID = qp.get('id') || '';
const fallbackName = `${qp.get('h') || 'Home'} vs ${qp.get('a') || 'Away'}`;
let M: Match | null = null, countT = 0, embedded = false;

C.mountChrome({ active: 'football', solid: true, back: C.route('football') });
C.registerSW();
fill('#footSlot', C.footer());
must<HTMLAnchorElement>('#lvAll').href = C.route('football');
document.title = fallbackName + ' — CineFliX';
must('#lvShare').onclick = () => C.share(fallbackName + ' live on CineFliX');
$$icons();
Promise.all([C.loadUser(), C.domReady()]).then(() => { if (ID) mountComments(must('#cmtPanel'), 'fb_' + ID); });

load();
setInterval(() => { if (!document.hidden) load(true); }, 60000);

function $$icons(): void { document.querySelectorAll<HTMLElement>('[data-ic]').forEach((el) => { el.outerHTML = C.ic(el.dataset.ic as Parameters<typeof C.ic>[0]); }); }

async function load(silent = false): Promise<void> {
  try {
    const list = await API.getLiveMatches();
    M = list.find((m) => m.id === ID) || null;
    C.setLiveIndicator(list.some((m) => m.status === 'live'));
    renderOthers(list);
    if (!M) { if (!silent) notFound(); return; }
    document.title = `${M.home.name} vs ${M.away.name} — CineFliX`;
    renderHead(); renderStream();
  } catch {
    if (!silent) setState('<h4>Match data didn’t load</h4><p>Check your connection and try again.</p><div class="row-btns"><button class="btn btn-sm btn-primary" data-act="reload">Try again</button></div>');
  }
}

function setState(html: string): void {
  if (!$('#lvState')) { must('#lvFrame').innerHTML = '<div class="p-state show" id="lvState"></div>'; embedded = false; }
  const s = must<HTMLElement>('#lvState');
  s.innerHTML = `<div>${html}</div>`; s.classList.add('show');
}
function notFound(): void {
  fill('#lvHead', `<div class="fhero"><div class="fhero-count">${esc(fallbackName)}</div></div>`);
  setState(`<h4>This match has left the live schedule</h4><p>It has probably finished. Check scores and highlights on the football page.</p><div class="row-btns"><a class="btn btn-sm btn-primary" href="${esc(C.route('football'))}">Go to football</a></div>`);
}

function renderHead(): void {
  const m = M!;
  const votes = m.home.votes + m.away.votes;
  const pct = votes ? Math.round((m.home.votes / votes) * 100) : 50;
  fill('#lvHead', `<div class="fhero${m.status === 'live' ? ' is-live' : ''}"><div class="fhero-meta">${C.matchStatusPill(m)}<span class="pill pill-line">${esc(m.league)}</span></div>` +
    `<div class="fhero-teams"><div class="team">${C.teamLogo(m.home)}<span class="team-name">${esc(m.home.name)}</span></div>` +
    (m.status === 'upcoming' ? '<div><div class="fhero-count" id="lvCount">--:--:--</div><div class="fhero-sub">until kick-off</div></div>' : C.scoreHTML(m)) +
    `<div class="team">${C.teamLogo(m.away)}<span class="team-name">${esc(m.away.name)}</span></div></div>` +
    (votes ? `<div class="votes"><div class="stat-label">Fan predictions</div><div class="stat-row"><span>${pct}%</span><span class="bar"><i style="width:${pct}%"></i></span><span>${100 - pct}%</span></div></div>` : '') +
    '</div>');
  clearInterval(countT);
  if (m.status === 'upcoming') {
    const tick = () => { const el = $('#lvCount'); if (!el) return; el.textContent = C.countdown(m.start); if (m.start <= Date.now()) { clearInterval(countT); load(true); } };
    tick(); countT = window.setInterval(tick, 1000);
  }
}

function renderStream(): void {
  const m = M!, open = must<HTMLAnchorElement>('#lvOpen');
  if (m.streamUrl) { open.href = m.streamUrl; open.hidden = false; }
  if (!m.streamUrl) { setState('<h4>No stream for this match yet</h4><p>Streams usually appear shortly before kick-off.</p>'); return; }
  if (m.status === 'ended') { setState(`<h4>Full time</h4><p>This match has finished. Highlights and the final score are on the football page.</p><div class="row-btns"><a class="btn btn-sm btn-primary" href="${esc(C.route('football'))}">See scores</a></div>`); return; }
  if (m.status !== 'live' && (m.start - Date.now()) / 60000 > 20) { setState(`<h4>Stream opens at kick-off</h4><p>${esc(C.kickoff(m.start))}. Keep this page open and the player loads automatically.</p>`); return; }
  if (embedded) return;
  embedded = true;
  must('#lvFrame').innerHTML = `<iframe src="${esc(m.streamUrl)}" title="${esc(m.home.name + ' vs ' + m.away.name)} live stream" allow="autoplay; fullscreen; encrypted-media; picture-in-picture" allowfullscreen referrerpolicy="no-referrer" sandbox="allow-scripts allow-same-origin allow-presentation allow-forms"></iframe>`;
}

function renderOthers(list: Match[]): void {
  const others = list.filter((m) => m.id !== ID).slice(0, 8);
  fill('#lvOthers', others.length ? others.map((m) => {
    const score = m.status === 'upcoming' ? C.timeOf(m.start) : `${esc(m.home.score || '0')} – ${esc(m.away.score || '0')}`;
    return `<a class="fx fx-mini${m.status === 'live' ? ' is-live' : ''}" href="${esc(C.matchHref(m))}"><span class="fx-team home"><span>${esc(m.home.name)}</span></span><span class="fx-score">${score}</span><span class="fx-team"><span>${esc(m.away.name)}</span></span></a>`;
  }).join('') : '<p class="dim small">No other matches scheduled right now.</p>');
}
