// YouTube's own page interface ("Innertube"), called from INSIDE the user's YouTube tab with the page's own settings and the user's own session, the same calls the page makes when
// you open the transcript or scroll to the comments (maintainer, 2026-10-08: "now we need the feature and simply cannot use it", "let what you've built be a fallback"). No key, no outside
// server, nothing leaves the browser. It is undocumented: YouTube can change it any week, so EVERY caller has a fallback (the on-screen readers in transcript.ts and pageComments.ts), and
// every parser below returns "nothing" instead of guessing. The method follows pc035860/YCS-cont (MIT): ytcfg for the page's context, /next for the transcript's token, /get_transcript.
// Pure parsers live here (tested with fixtures); the one function that runs in the page is `itPost`.

export type ItReply = { ok: true; json: unknown } | { ok: false; why: string; status?: number };

// Runs INSIDE the YouTube page (world MAIN). Self-contained: no imports, no outside variables.
export async function itPost(path: string, body: Record<string, unknown>): Promise<ItReply> {
  try {
    const cfg = (window as unknown as { ytcfg?: { get?: (k: string) => unknown; data_?: Record<string, unknown> } }).ytcfg;
    const get = (k: string) => (cfg && typeof cfg.get === 'function' ? cfg.get(k) : cfg?.data_?.[k]);
    const context = get('INNERTUBE_CONTEXT');
    const key = get('INNERTUBE_API_KEY');
    if (!context) return { ok: false, why: "This page does not carry YouTube's settings yet." };
    const r = await fetch('/youtubei/v1/' + path + '?prettyPrint=false' + (typeof key === 'string' && key ? '&key=' + encodeURIComponent(key) : ''), {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ context, ...body }),
    });
    if (r.status === 429 || r.status === 403) return { ok: false, why: 'YouTube asked Skipz to slow down (' + r.status + ').', status: r.status };
    if (!r.ok) {
      let said = '';
      try { said = String(((await r.json()) as { error?: { message?: string } })?.error?.message ?? '').slice(0, 80); } catch { /* no readable reason */ }
      return { ok: false, why: 'YouTube answered ' + r.status + (said ? ' (' + said + ')' : '') + ' to /' + path.split('?')[0] + '.', status: r.status };
    }
    return { ok: true, json: await r.json() };
  } catch {
    return { ok: false, why: 'The request did not go through.' };
  }
}

// Runs INSIDE the YouTube page (world MAIN): one caption file, from YouTube's own address, as text.
export async function itGetText(url: string): Promise<{ ok: true; text: string } | { ok: false; why: string; status?: number }> {
  try {
    const u = new URL(url, location.href);
    if (!/(^|\.)youtube\.com$/.test(u.hostname)) return { ok: false, why: 'Not a YouTube address.' };
    const r = await fetch(u.toString(), { credentials: 'same-origin' });
    if (!r.ok) return { ok: false, why: 'YouTube answered ' + r.status + ' for the captions.', status: r.status };
    return { ok: true, text: await r.text() };
  } catch {
    return { ok: false, why: 'The request did not go through.' };
  }
}

export async function callIt(tabId: number, path: string, body: Record<string, unknown>): Promise<ItReply> {
  try {
    const [res] = await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: itPost, args: [path, body] });
    return (res?.result as ItReply | undefined) ?? { ok: false, why: 'The page gave nothing back.' };
  } catch {
    return { ok: false, why: 'Skipz could not reach this YouTube tab.' };
  }
}

// ---- pure helpers -----------------------------------------------------------------------------------------------------
type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => !!x && typeof x === 'object' && !Array.isArray(x);

/** Every object anywhere inside `root` that has the key (depth-first, in page order). */
export function findAll(root: unknown, key: string, out: Obj[] = [], depth = 0): Obj[] {
  if (depth > 60 || root === null || typeof root !== 'object') return out;
  if (Array.isArray(root)) { for (const x of root) findAll(x, key, out, depth + 1); return out; }
  const o = root as Obj;
  if (key in o && isObj(o[key])) out.push(o[key] as Obj);
  for (const k of Object.keys(o)) findAll(o[k], key, out, depth + 1);
  return out;
}
const text = (x: unknown): string => {
  if (typeof x === 'string') return x;
  if (!isObj(x)) return '';
  if (typeof x.simpleText === 'string') return x.simpleText;
  if (typeof x.content === 'string') return x.content;
  if (Array.isArray(x.runs)) return x.runs.map((r) => (isObj(r) && typeof r.text === 'string' ? r.text : '')).join('');
  return '';
};

// ---- transcript: the player's caption tracks ----------------------------------------------------------------------------
// CHECKED in the maintainer's real Chrome on 2026-10-08 (his "YouTube answered 400"): /get_transcript answers 400 "Precondition check failed" to every direct call (tried with and without the key,
// with the page's own headers, with the token read from the page itself, and as another client). What works: ask /player, as the Android client, for the video's caption tracks (200, six
// tracks for the test video), then read the chosen caption file as json3 from YouTube's own address (200, 61 timed lines). The method the maintained transcript tools use.
export const ANDROID_CONTEXT = { client: { clientName: 'ANDROID', clientVersion: '20.10.38', hl: 'en', gl: 'US', androidSdkVersion: 34, osName: 'Android', osVersion: '14' } };

export type CaptionTrack = { lang: string; auto: boolean; url: string };
/** The caption tracks the answer to /player lists (none when the video has no captions or YouTube would not play it to this client). */
export function captionTracks(player: unknown): CaptionTrack[] {
  const out: CaptionTrack[] = [];
  for (const r of findAll(player, 'playerCaptionsTracklistRenderer')) {
    for (const t of Array.isArray(r.captionTracks) ? r.captionTracks : []) {
      if (isObj(t) && typeof t.baseUrl === 'string' && t.baseUrl) out.push({ lang: typeof t.languageCode === 'string' ? t.languageCode : '', auto: t.kind === 'asr', url: t.baseUrl });
    }
  }
  return out;
}

/** Which track to read: the people-written one in the wanted language, then YouTube's own speech-to-text in it, then any people-written one, then the first. */
export function pickTrack(tracks: CaptionTrack[], prefer = 'en'): CaptionTrack | null {
  const p = prefer.toLowerCase();
  const l = (t: CaptionTrack) => t.lang.toLowerCase();
  return tracks.find((t) => !t.auto && l(t) === p) ?? tracks.find((t) => !t.auto && l(t).startsWith(p)) ?? tracks.find((t) => t.auto && l(t).startsWith(p)) ?? tracks.find((t) => !t.auto) ?? tracks[0] ?? null;
}

/** The same caption address, asking for the json3 form. */
export function json3Url(url: string): string {
  try { const u = new URL(url, 'https://www.youtube.com'); u.searchParams.set('fmt', 'json3'); return u.toString(); } catch { return url; }
}

/** Timed lines from a json3 caption file: one per start time, in order; empty rows left out. */
export function parseJson3(text: string): { t: number; text: string }[] {
  let j: unknown;
  try { j = JSON.parse(text); } catch { return []; }
  const events = isObj(j) && Array.isArray(j.events) ? j.events : [];
  const out: { t: number; text: string }[] = [];
  for (const e of events) {
    if (!isObj(e) || !Array.isArray(e.segs)) continue;
    const s = e.segs.map((x) => (isObj(x) && typeof x.utf8 === 'string' ? x.utf8 : '')).join('').replace(/\s+/g, ' ').trim();
    const ms = Number(e.tStartMs ?? 0);
    if (s && Number.isFinite(ms)) out.push({ t: Math.floor(ms / 1000), text: s }); // whole seconds, like the on-screen reader (a clock never shows 2:29.919)
  }
  const merged = new Map<number, string>(); // two captions in the same second become one line instead of one being lost
  for (const l of out.sort((a, b) => a.t - b.t)) merged.set(l.t, merged.has(l.t) ? merged.get(l.t) + ' ' + l.text : l.text);
  return [...merged].map(([t, text]) => ({ t, text }));
}

export type ItTranscript = { state: 'ok'; lines: { t: number; text: string }[] } | { state: 'none' } | { state: 'trouble'; why: string; status?: number };

async function callText(tabId: number, url: string): Promise<{ ok: true; text: string } | { ok: false; why: string; status?: number }> {
  try {
    const [res] = await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: itGetText, args: [url] });
    return (res?.result as { ok: true; text: string } | { ok: false; why: string; status?: number } | undefined) ?? { ok: false, why: 'The page gave nothing back.' };
  } catch {
    return { ok: false, why: 'Skipz could not reach this YouTube tab.' };
  }
}

/** A video's transcript through YouTube's page interface: the player's caption tracks, then the caption file. No panel opened, nothing shown on your page. */
// A circuit breaker (maintainer, 2026-10-12: Google showed his network an "unusual traffic" page after many quick page loads, and jdepoix/youtube-transcript-api's own README says the same two calls get blocked):
// once YouTube refuses this quiet route (the Android client is told to sign in, a 429/403, or the caption file comes back empty because it wants a proof token), it is not tried again for a while, so Skipz
// stops sending two failing requests per video. The on-screen reader (transcript.ts) carries on. In memory only: a new panel starts clean.
let pausedUntil = 0;
const HOUR = 3600000;
export const quietRoutePaused = (now = Date.now()) => now < pausedUntil;
export const pauseQuietRoute = (ms = 2 * HOUR, now = Date.now()) => { pausedUntil = now + ms; };
export const _resetQuietRoute = () => { pausedUntil = 0; };

export async function transcriptViaPage(tabId: number, videoId: string, prefer = 'en'): Promise<ItTranscript> {
  if (quietRoutePaused()) return { state: 'trouble', why: 'The quiet route is paused: YouTube refused it a moment ago.', status: 0 };
  const player = await callIt(tabId, 'player', { context: ANDROID_CONTEXT, videoId, contentCheckOk: true, racyCheckOk: true });
  if (!player.ok) { if (player.status === 429 || player.status === 403) pauseQuietRoute(); return { state: 'trouble', why: player.why, status: player.status }; }
  const play = findAll(player.json, 'playabilityStatus')[0] ?? (isObj(player.json) && isObj(player.json.playabilityStatus) ? player.json.playabilityStatus : null);
  const status = play && typeof play.status === 'string' ? play.status : 'OK';
  if (status === 'LOGIN_REQUIRED') { pauseQuietRoute(); return { state: 'trouble', why: 'YouTube asked the Android client to sign in.', status: 0 }; }
  const track = pickTrack(captionTracks(player.json), prefer);
  if (!track) return { state: 'none' };
  // "&exp=xpe" marks a caption file that needs a proof token only YouTube's own player makes (the same marker the youtube-transcript-api library stops on): do not ask for it.
  if (/[?&]exp=xpe/.test(track.url)) return { state: 'trouble', why: 'This video’s captions need YouTube’s own player.', status: 0 };
  const file = await callText(tabId, json3Url(track.url));
  if (!file.ok) { if (file.status === 429 || file.status === 403) pauseQuietRoute(); return { state: 'trouble', why: file.why, status: file.status }; }
  if (!file.text.trim()) { pauseQuietRoute(HOUR); return { state: 'trouble', why: 'YouTube sent an empty caption file.', status: 0 }; }
  const lines = parseJson3(file.text);
  return lines.length ? { state: 'ok', lines } : { state: 'none' };
}

// ---- comments ---------------------------------------------------------------------------------------------------------
export type ItComment = { author: string; text: string; likes: string; when: string; pinned: boolean };

/** The token that loads a video's comments, from the answer to /next. */
export function commentsToken(next: unknown): string | null {
  for (const sec of findAll(next, 'itemSectionRenderer')) {
    if (sec.sectionIdentifier !== 'comment-item-section') continue;
    for (const c of findAll(sec, 'continuationCommand')) if (typeof c.token === 'string' && c.token) return c.token;
  }
  return null;
}

/** Comments and the real total from the answer that carries them (old comment rows, and the newer rows whose words sit in a separate list). */
export function parseComments(json: unknown, max = 20): { total: number | null; comments: ItComment[] } {
  const entities = new Map<string, Obj>();
  for (const m of findAll(json, 'commentEntityPayload')) {
    const key = isObj(m.properties) && typeof m.properties.commentId === 'string' ? m.properties.commentId : typeof m.key === 'string' ? m.key : '';
    if (key) entities.set(key, m);
  }
  const fromEntity = (p: Obj): ItComment | null => {
    const props = isObj(p.properties) ? p.properties : {};
    const author = isObj(p.author) ? text(p.author.displayName) : '';
    const body = text(isObj(props.content) ? props.content : props.content);
    const tool = isObj(p.toolbar) ? p.toolbar : {};
    return body ? { author, text: body.replace(/\s+/g, ' ').trim(), likes: text(tool.likeCountNotliked ?? tool.likeCountLiked ?? ''), when: text(props.publishedTime), pinned: !!props.pinnedText } : null;
  };
  const comments: ItComment[] = [];
  // newer: threads list their comment ids in page order; the words are in the entities
  const order: string[] = [];
  for (const vm of findAll(json, 'commentViewModel')) if (typeof vm.commentId === 'string') order.push(vm.commentId);
  for (const id of order) { const e = entities.get(id); const c = e ? fromEntity(e) : null; if (c) comments.push(c); }
  if (!comments.length) for (const e of entities.values()) { const c = fromEntity(e); if (c) comments.push(c); }
  // older: the thread holds the comment
  if (!comments.length) {
    for (const r of findAll(json, 'commentRenderer')) {
      const body = text(r.contentText).replace(/\s+/g, ' ').trim();
      if (body) comments.push({ author: text(r.authorText), text: body, likes: text(r.voteCount), when: text(r.publishedTimeText), pinned: !!r.pinnedCommentBadge });
    }
  }
  let total: number | null = null;
  for (const h of findAll(json, 'commentsHeaderRenderer')) {
    const d = text(h.countText).replace(/[^\d]/g, '');
    if (d) { total = Number(d); break; }
  }
  return { total, comments: comments.slice(0, max) };
}

export type ItComments = { ok: true; total: number | null; comments: ItComment[] } | { ok: false; why: string };

/** A video's top comments through YouTube's page interface (no scrolling the page). ok:false = use the on-screen reader instead. */
export async function commentsViaPage(tabId: number, videoId: string, max = 20): Promise<ItComments> {
  const next = await callIt(tabId, 'next', { videoId });
  if (!next.ok) return { ok: false, why: next.why };
  const token = commentsToken(next.json);
  if (!token) return { ok: false, why: 'No comments section in the answer.' };
  const got = await callIt(tabId, 'next', { continuation: token });
  if (!got.ok) return { ok: false, why: got.why };
  const r = parseComments(got.json, max);
  return r.comments.length ? { ok: true, total: r.total, comments: r.comments } : { ok: false, why: 'The comments came back in a shape Skipz does not read.' };
}

// ---- related channels: who else the page lists beside a video ------------------------------------------------------------
/** Channel ids named in the "up next" list of a /next answer (the old and the new list shapes both carry a browseEndpoint), in page order, the video's own channel left out. */
export function relatedChannels(next: unknown, ownChannelId: string | null = null, max = 40): string[] {
  const side = findAll(next, 'secondaryResults');
  const out: string[] = [];
  for (const root of side.length ? side : [next]) {
    for (const e of findAll(root, 'browseEndpoint')) {
      const id = typeof e.browseId === 'string' ? e.browseId : '';
      if (/^UC[\w-]{22}$/.test(id) && id !== ownChannelId && !out.includes(id)) out.push(id);
      if (out.length >= max) return out;
    }
  }
  return out;
}

export type ItRelated = { ok: true; channels: string[] } | { ok: false; why: string; status?: number };

/** The channels listed beside a video, through the YouTube tab the person has open (one /next call, the same one the page makes). */
export async function relatedViaPage(tabId: number, videoId: string, ownChannelId: string | null = null): Promise<ItRelated> {
  const r = await callIt(tabId, 'next', { videoId });
  if (!r.ok) return { ok: false, why: r.why, status: r.status };
  return { ok: true, channels: relatedChannels(r.json, ownChannelId) };
}

/** The video id in a YouTube page address. */
export const videoIdOf = (url: string | undefined | null): string | null => {
  try {
    const u = new URL(url ?? '');
    if (u.pathname === '/watch') return u.searchParams.get('v');
    const m = /^\/shorts\/([\w-]{11})/.exec(u.pathname);
    return m ? m[1] : null;
  } catch { return null; }
};
