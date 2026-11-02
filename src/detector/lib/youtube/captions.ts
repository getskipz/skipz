// Route B of the transcript plan (maintainer, 2026-10-13: "build B"): the caption track YouTube's OWN player downloads, read while the player shows captions (hidden from view), with no transcript panel opened.
// It runs beside the panel reader (transcript.ts) and gives a second text: the other track when a video has both a creator-made and an automatic one, and a reading when the panel one fails.
// Nothing is forged: Skipz only reads what the page's own player asked YouTube for, with the page's own permission. Captions are put back the way they were. Never loops; once per video (useVideo).

import { parseJson3 } from './innertube';

export type CaptionLine = { t: number; text: string };
export type CaptionTrack = { lang: string; auto: boolean; lines: CaptionLine[] };
export type CaptionsRead = { state: 'ok'; tracks: CaptionTrack[] } | { state: 'none' } | { state: 'trouble'; why: string };

const entities = (s: string) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(Number(d)));

/** Timed lines from YouTube's caption XML: the newer <p t="ms"><s>word</s></p> form and the older <text start="s"> form. One line per second, in order. */
export function parseXmlCaptions(xml: string): CaptionLine[] {
  const out: CaptionLine[] = [];
  const clean = (raw: string) => entities(raw.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
  for (const m of xml.matchAll(/<p\b[^>]*?\bt="(\d+)"[^>]*>([\s\S]*?)<\/p>/g)) { const text = clean(m[2]); if (text) out.push({ t: Math.floor(Number(m[1]) / 1000), text }); }
  if (!out.length) for (const m of xml.matchAll(/<text\b[^>]*?\bstart="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/g)) { const text = clean(m[2]); if (text) out.push({ t: Math.floor(Number(m[1])), text }); }
  const merged = new Map<number, string>();
  for (const l of out.sort((a, b) => a.t - b.t)) merged.set(l.t, merged.has(l.t) ? merged.get(l.t) + ' ' + l.text : l.text);
  return [...merged].map(([t, text]) => ({ t, text }));
}

/** A caption file in whatever form the player asked for: json3 or XML. */
export function parseCaptionBody(body: string): CaptionLine[] {
  const s = body.trimStart();
  return s.startsWith('{') ? parseJson3(s) : s.startsWith('<') ? parseXmlCaptions(s) : [];
}

const words = (lines: CaptionLine[]) => new Set(lines.map((l) => l.text).join(' ').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean));
/** Do two readings say the same words? (Share of the smaller word set found in the other; 1 = the same text.) Used so a copy of the panel's own track is not counted as a second, independent text. */
export function textOverlap(a: CaptionLine[], b: CaptionLine[]): number {
  const A = words(a), B = words(b);
  if (!A.size || !B.size) return 0;
  const [small, big] = A.size <= B.size ? [A, B] : [B, A];
  let hit = 0;
  for (const w of small) if (big.has(w)) hit++;
  return hit / small.size;
}
/** The track that is a genuinely different text from the panel's (a different track, or the same speech written differently), or null. */
export function otherText(tracks: CaptionTrack[], panel: CaptionLine[] | null): CaptionTrack | null {
  if (!panel?.length) return null;
  return tracks.find((t) => t.lines.length && textOverlap(t.lines, panel) < 0.9) ?? null;
}

// Runs INSIDE the YouTube page (world MAIN). Self-contained: no imports, no outside variables.
type Got = { lang: string; auto: boolean; body: string };
type GrabResult = { state: 'ok'; got: Got[] } | { state: 'none' } | { state: 'trouble'; why: string };
export async function grabCaptions(): Promise<GrabResult> {
  const w = window as unknown as { __skipzCap?: { lang: string; auto: boolean; body: string; at: number }[]; __skipzCapHooked?: boolean };
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  type Player = { toggleSubtitlesOn?: () => void; toggleSubtitles?: () => void; getOption?: (m: string, o: string) => unknown; setOption?: (m: string, o: string, v: unknown) => void };
  const mp = document.querySelector('#movie_player') as unknown as Player | null;
  if (!mp || typeof mp.getOption !== 'function' || typeof mp.toggleSubtitlesOn !== 'function') return { state: 'trouble', why: 'The player is not ready.' };
  w.__skipzCap = w.__skipzCap ?? [];
  // The always-on hook (content/capHook.ts) may already hold the player's own download of THIS video: then nothing has to be switched on at all.
  {
    const now = new URL(location.href).searchParams.get('v') ?? '';
    const have = (w.__skipzCap as unknown as (Got & { v?: string })[]).filter((g) => g.body.length > 20 && (!g.v || g.v === now));
    if (have.length) return { state: 'ok', got: have.slice(0, 3).map((g) => ({ lang: g.lang, auto: g.auto, body: g.body })) };
  }
  const keep = (url: string, body: string) => {
    if (!body || url.indexOf('timedtext') < 0) return;
    let lang = '', auto = false;
    try { const u = new URL(url, location.href); lang = u.searchParams.get('lang') ?? ''; auto = u.searchParams.get('kind') === 'asr'; } catch { /* leave blank */ }
    (w.__skipzCap as { lang: string; auto: boolean; body: string; at: number }[]).push({ lang, auto, body: body.slice(0, 3000000), at: Date.now() });
  };
  if (!w.__skipzCapHooked) {
    w.__skipzCapHooked = true;
    const of = window.fetch;
    window.fetch = async function (this: unknown, ...a: Parameters<typeof fetch>) {
      const r = await of.apply(this, a);
      try { const u = String((a[0] as Request)?.url ?? a[0]); if (u.indexOf('timedtext') >= 0) r.clone().text().then((t) => keep(u, t)).catch(() => {}); } catch { /* not ours to break */ }
      return r;
    } as typeof fetch;
    const ox = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function (this: XMLHttpRequest, ...a: Parameters<XMLHttpRequest['send']>) {
      this.addEventListener('load', () => { try { if (String(this.responseURL).indexOf('timedtext') >= 0) keep(this.responseURL, this.responseText || ''); } catch { /* not ours to break */ } });
      return ox.apply(this, a);
    };
  }
  type Track = { languageCode?: string; kind?: string };
  const list = (() => { try { return (mp.getOption!('captions', 'tracklist') as Track[] | undefined) ?? []; } catch { return []; } })();
  // (An empty list is not "no captions": seen 2026-10-26, the player answers [] even with captions running; the switch below goes ahead.)
  const current = (() => { try { return (mp.getOption!('captions', 'track') as Track | undefined) ?? {}; } catch { return {}; } })();
  // What the viewer SEES is the captions button (aria-pressed); the player's own track answer can lag behind the saved choice (2026-10-26: a switch that read "off" too early turned captions off at the end).
  const button = () => document.querySelector('.ytp-subtitles-button') as HTMLElement | null;
  const shownOn = (): boolean | null => { const b = button(); return b ? b.getAttribute('aria-pressed') === 'true' : null; };
  // Wait until the button has SETTLED (the same value for 2.5 s, and at least 5 s since the page started): the player applies the viewer's saved choice a few seconds after the controls are drawn.
  {
    let seen: boolean | null = null; let since = Date.now();
    for (let i = 0; i < 40; i++) {
      const now = shownOn();
      if (now !== seen) { seen = now; since = Date.now(); }
      if (seen !== null && Date.now() - since >= 2500 && performance.now() >= 5000) break;
      await sleep(250);
    }
    Object.assign(current as object, (mp.getOption!('captions', 'track') as object | undefined) ?? {}); // the track the viewer really has, read after the wait
  }
  if (shownOn() === null) return { state: 'trouble', why: 'The captions button is not there yet.' }; // nothing was touched
  const wasOn = shownOn() === true;
  const style = document.createElement('style');
  style.id = 'skipz-cc-hide';
  style.textContent = '.ytp-caption-window-container,.caption-window{opacity:0!important}';
  if (!wasOn) document.documentElement.appendChild(style); // captions the viewer is SEEING are never hidden (2026-10-26); when they are off nothing is lost by hiding the box
  const start = (w.__skipzCap as unknown[]).length;
  const wait = async (n: number, ms: number) => { for (let i = 0; i < ms / 200 && (w.__skipzCap as unknown[]).length <= n; i++) await sleep(200); await sleep(300); };
  try {
    if (!wasOn) { mp.toggleSubtitlesOn!(); await wait(start, 6000); }
    // The player showed captions already (your choice): its download happened before Skipz was looking. Ask for its own track again so the download is seen.
    else { try { if ((current as { languageCode?: string }).languageCode) mp.setOption?.('captions', 'track', current); } catch { /* fine */ } await wait(start, 4000); }
    // The other kind of track in the same language (creator-made against automatic), when there is one.
    const first = (w.__skipzCap as Got[])[start];
    const lang = (first?.lang || current.languageCode || 'en').slice(0, 2);
    const other = list.find((t) => (t.languageCode ?? '').slice(0, 2) === lang && (t.kind === 'asr') !== !!first?.auto);
    if (first && other) { const n = (w.__skipzCap as unknown[]).length; try { mp.setOption?.('captions', 'track', other); } catch { /* fine */ } await wait(n, 4000); }
    const got = (w.__skipzCap as Got[]).slice(start).filter((g) => g.body.length > 20);
    return got.length ? { state: 'ok', got: got.slice(0, 3).map((g) => ({ lang: g.lang, auto: g.auto, body: g.body })) } : { state: 'trouble', why: 'The player did not download captions.' };
  } finally {
    // Put captions back the way they were, then show them again.
    try {
      await sleep(200);
      if (wasOn && shownOn() === false) mp.toggleSubtitlesOn?.();
      else if (!wasOn && shownOn() === true) mp.toggleSubtitles?.();
    } catch { /* fine */ }
    setTimeout(() => style.remove(), 600);
  }
}

/** Capture goes first (maintainer, 2026-11-01: "capture is most important"): what the always-on hook already holds for THIS video, read without asking YouTube for anything, and whether the viewer's saved choice is captions ON
 *  (then the player's own download is expected within about 2 s, so the quiet transcript request can wait for it). */
export async function peekCaptions(tabId: number, videoId: string): Promise<{ read: CaptionsRead | null; prefersOn: boolean }> {
  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId }, world: 'MAIN', args: [videoId],
      func: (v: string) => {
        const w = window as unknown as { __skipzCap?: { v?: string; lang: string; auto: boolean; body: string }[] };
        const got = (w.__skipzCap ?? []).filter((g) => g.body && g.body.length > 20 && (!g.v || g.v === v)).slice(0, 3).map((g) => ({ lang: g.lang, auto: g.auto, body: g.body }));
        const on = ['yt-player-sticky-caption', 'yt-player-caption-persistence'].some((k) => { try { return JSON.parse(JSON.parse(localStorage.getItem(k) || 'null')?.data ?? 'null') === true; } catch { return false; } });
        return { got, on };
      },
    });
    const r = res?.result as { got: Got[]; on: boolean } | undefined;
    if (!r) return { read: null, prefersOn: false };
    const tracks: CaptionTrack[] = [];
    for (const g of r.got) { const lines = parseCaptionBody(g.body); if (lines.length) tracks.push({ lang: g.lang, auto: g.auto, lines }); }
    return { read: tracks.length ? { state: 'ok', tracks } : null, prefersOn: r.on };
  } catch { return { read: null, prefersOn: false }; }
}

/** Read the video's own caption tracks through its player. ok: one or two tracks, parsed. */
export async function readCaptions(tabId: number): Promise<CaptionsRead> {
  try {
    const [res] = await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: grabCaptions });
    const r = res?.result as GrabResult | undefined;
    if (!r) return { state: 'trouble', why: 'The page gave nothing back.' };
    if (r.state !== 'ok') return r;
    const tracks: CaptionTrack[] = [];
    for (const g of r.got) { const lines = parseCaptionBody(g.body); if (lines.length) tracks.push({ lang: g.lang, auto: g.auto, lines }); }
    return tracks.length ? { state: 'ok', tracks } : { state: 'trouble', why: 'The captions could not be read.' };
  } catch {
    return { state: 'trouble', why: 'Skipz could not reach this YouTube tab.' };
  }
}
