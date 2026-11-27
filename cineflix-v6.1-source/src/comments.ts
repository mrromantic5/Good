/* CineFliX Comments · v6.1 — ChatXAP comments for titles ('<subjectId>') and matches ('fb_<matchId>').
   Endpoints unchanged: api/comments.php (fetch|post|delete|fetch_replies|reply), api/react_comment.php */
import { CX, state, esc, ic, ago, avatarHTML, vBadge, toast, links, $, must } from './core';

interface Comment { id: number; user_id: number | string; username: string; avatar?: string; comment: string; created_at: string; like_count?: number | string; reply_count?: number | string; my_reaction?: string; verification_status?: string }
interface Reply { username: string; avatar?: string; reply: string; created_at?: string }

const S = { id: '', page: 1, root: null as HTMLElement | null };
const api = (p: string) => CX + 'api/' + p;
const post = (p: string, body: unknown) =>
  fetch(api(p), { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());

function needLogin(): boolean {
  if (state.user) return false;
  toast('Sign in to ChatXAP to join the conversation');
  setTimeout(() => { location.href = links.login(); }, 1200);
  return true;
}
const text = (t: string) => esc(t).replace(/@([A-Za-z0-9_.]+)/g, '<span class="mention">@$1</span>');

function cmtHTML(c: Comment): string {
  const own = state.user && String(state.user.id) === String(c.user_id);
  const liked = c.my_reaction === 'like', lc = Number(c.like_count) || 0, rc = Number(c.reply_count) || 0;
  return `<div class="cmt" id="cmt-${c.id}"><span class="avatar">${avatarHTML(c.avatar, c.username)}</span><div class="cmt-body">` +
    `<div class="cmt-meta"><b>${esc(c.username)}</b>${c.verification_status === 'active' ? vBadge : ''}<span class="dim">${ago(c.created_at)}</span></div>` +
    `<div class="cmt-text">${text(c.comment)}</div><div class="cmt-acts">` +
    `<button class="${liked ? 'liked' : ''}" data-c="like" data-id="${c.id}">${ic(liked ? 'heart' : 'heart-o')}${lc || 'Like'}</button>` +
    `<button data-c="reply" data-id="${c.id}">${ic('comment-o')}${rc ? rc + (rc === 1 ? ' reply' : ' replies') : 'Reply'}</button>` +
    (own ? `<button data-c="del" data-id="${c.id}">${ic('trash-o')}Delete</button>` : '') +
    `</div><div class="replies" id="reps-${c.id}"></div></div></div>`;
}
const replyHTML = (r: Reply, now = false) =>
  `<div class="reply"><span class="avatar">${avatarHTML(r.avatar, r.username)}</span><div class="cmt-body"><div class="cmt-meta"><b>${esc(r.username)}</b><span class="dim">${now ? 'Just now' : ago(r.created_at || '')}</span></div><div class="cmt-text">${text(r.reply)}</div></div></div>`;

async function load(page = 1): Promise<void> {
  const root = S.root!; const list = must('.cmt-list', root);
  try {
    const d = await fetch(api(`comments.php?action=fetch&movie_id=${encodeURIComponent(S.id)}&page=${page}`), { credentials: 'include' }).then((r) => r.json());
    S.page = page;
    must('.cmt-count', root).textContent = String(d.total || 0);
    if (page === 1) list.innerHTML = '';
    const cs: Comment[] = d.comments || [];
    if (!cs.length && page === 1) list.innerHTML = '<p class="dim pad-y">No comments yet. Start the conversation.</p>';
    else list.insertAdjacentHTML('beforeend', cs.map(cmtHTML).join(''));
    must('.cmt-more', root).hidden = !d.has_more;
  } catch { list.innerHTML = '<p class="dim pad-y">Comments are unavailable right now.</p>'; }
}

async function send(): Promise<void> {
  if (needLogin()) return;
  const root = S.root!, ta = must<HTMLTextAreaElement>('textarea', root), btn = must<HTMLButtonElement>('.cmt-send', root);
  const t = ta.value.trim(); if (!t) return;
  btn.disabled = true;
  try {
    const d = await post('comments.php?action=post', { movie_id: S.id, comment: t });
    if (!d.success) { toast(d.error || 'Comment wasn’t posted. Try again.'); return; }
    ta.value = ''; ta.style.height = '';
    const list = must('.cmt-list', root); list.querySelector('p')?.remove();
    list.insertAdjacentHTML('afterbegin', cmtHTML(d.comment));
    const cnt = must('.cmt-count', root); cnt.textContent = String((Number(cnt.textContent) || 0) + 1);
    toast('Comment posted');
  } catch { toast('Comment wasn’t posted. Check your connection.'); }
  finally { btn.disabled = !ta.value.trim(); }
}

async function onClick(e: Event): Promise<void> {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-c]'); if (!b) return;
  const id = b.dataset.id!, root = S.root!;
  switch (b.dataset.c) {
    case 'more': load(S.page + 1); break;
    case 'like': {
      if (needLogin()) return;
      const d = await post('react_comment.php', { comment_id: id, reaction: 'like' }).catch(() => null);
      if (!d?.success) return;
      b.classList.toggle('liked', d.reacted === true);
      b.innerHTML = ic(d.reacted ? 'heart' : 'heart-o') + (d.count > 0 ? d.count : 'Like');
      break;
    }
    case 'del': {
      if (!confirm('Delete this comment?')) return;
      const d = await post('comments.php?action=delete', { comment_id: id }).catch(() => null);
      if (!d?.success) return;
      $('#cmt-' + id)?.remove();
      const cnt = must('.cmt-count', root); cnt.textContent = String(Math.max(0, (Number(cnt.textContent) || 0) - 1));
      toast('Comment deleted');
      break;
    }
    case 'reply': {
      const box = must('#reps-' + id);
      if (box.classList.toggle('open') && !box.dataset.loaded) {
        box.dataset.loaded = '1';
        box.innerHTML = `<div class="reply-list"></div><form class="reply-form" data-id="${id}"><input placeholder="Write a reply" maxlength="500" aria-label="Reply"><button class="btn btn-sm btn-primary btn-icon" aria-label="Send reply">${ic('send')}</button></form>`;
        fetch(api('comments.php?action=fetch_replies&comment_id=' + id), { credentials: 'include' }).then((r) => r.json())
          .then((d) => { must('.reply-list', box).innerHTML = (d.replies || []).map((r: Reply) => replyHTML(r)).join(''); })
          .catch(() => { /* replies optional */ });
      }
      break;
    }
  }
}

async function onSubmit(e: Event): Promise<void> {
  const f = (e.target as HTMLElement).closest<HTMLFormElement>('.reply-form'); if (!f) return;
  e.preventDefault();
  if (needLogin()) return;
  const inp = must<HTMLInputElement>('input', f), t = inp.value.trim(); if (!t) return;
  const d = await post('comments.php?action=reply', { comment_id: f.dataset.id, reply: t }).catch(() => null);
  if (!d?.success) { toast(d?.error || 'Reply wasn’t posted'); return; }
  inp.value = '';
  f.previousElementSibling?.insertAdjacentHTML('beforeend', replyHTML(d.reply, true));
}

export function mountComments(root: HTMLElement, threadId: string): void {
  S.id = threadId; S.root = root;
  root.innerHTML = '<div class="panel-head"><h3 class="h3">Comments</h3><span class="pill pill-line cmt-count">0</span></div>' +
    `<div class="cmt-form"><textarea rows="1" maxlength="1000" aria-label="Comment" placeholder="${state.user ? 'Share what you think' : 'Sign in to comment'}"></textarea>` +
    `<button class="btn btn-primary btn-icon cmt-send" aria-label="Post comment" disabled>${ic('send')}</button></div>` +
    '<div class="cmt-list"></div><div class="center"><button class="btn btn-line btn-sm cmt-more" data-c="more" hidden>Show more comments</button></div>';
  const ta = must<HTMLTextAreaElement>('textarea', root), btn = must<HTMLButtonElement>('.cmt-send', root);
  ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 120) + 'px'; btn.disabled = !ta.value.trim(); });
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send(); });
  ta.addEventListener('focus', () => { if (!state.user) toast('Sign in to ChatXAP to post a comment'); }, { once: true });
  btn.addEventListener('click', send);
  root.addEventListener('click', onClick);
  root.addEventListener('submit', onSubmit);
  load(1);

  const rt = window.ChatXAPRealtime;
  if (rt) {
    try {
      rt.init(); rt.joinRoom('movie_' + S.id.replace(/[^a-zA-Z0-9_-]/g, '_'));
      ['movie_comment:new', 'movie_comment:delete', 'movie_comment:react'].forEach((ev) => rt.on(ev, (d) => { if (d && String(d.movie_id) === S.id) load(1); }));
    } catch { /* realtime optional */ }
  }
}
