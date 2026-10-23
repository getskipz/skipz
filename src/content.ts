// Skipz on the YouTube watch page: draws every sponsor burst on the seek bar and, a moment before each one starts, asks "Skip it?" with two big buttons (maintainer, 2026-10-13: "show every burst":
// a short plug up front and the main read later are two bursts, each marked and each asked about).
// It never skips on its own unless the person chose that AND the lock in gate.ts is open (the worker reports the mode that is really in force).
import type { Answer, Ask } from './background';
import type { Burst, Mark } from './verdict'; // types only: a content script cannot import code from another file
const burstsOfMark = (m: Mark): Burst[] => [{ start: m.start, end: m.end }, ...(m.more ?? [])]; // the same one-liner as in verdict.ts

// A bookmark after "Keep watching" that saves the sponsor to look at later (maintainer, 2026-10-22: "hide for now, it'll be used in the future"). Built but OFF: the build turns it on with SKIPZ_SAVE=1.
declare const __SAVE__: boolean;
const LEAD = 3; // seconds before a burst when the question appears
let mark: Mark | null = null;
let bursts: Burst[] = [];
let mode: Answer['mode'] = 'ask';
const dismissed = new Set<number>(); // bursts ("Keep watching" or an Undo) the person has answered on this video, by their start
let skippedAt: number | null = null; // where the person was before a skip, for Undo
let drawn: HTMLElement[] = [];
let chip: HTMLElement | null = null;
let hideTimer = 0;

const idOf = () => (location.pathname === '/watch' ? new URLSearchParams(location.search).get('v') : null);
const video = () => document.querySelector<HTMLVideoElement>('video.html5-main-video, #movie_player video') ?? document.querySelector<HTMLVideoElement>('video');
// Where the question and the strip go. The desktop player is #movie_player; the phone site and other layouts are found from the video itself, so nothing here assumes one page layout.
const playerBox = (): HTMLElement | null => {
  const v = video();
  const box = document.getElementById('movie_player') ?? v?.closest<HTMLElement>('.html5-video-player') ?? v?.parentElement ?? null;
  if (box && getComputedStyle(box).position === 'static') box.style.position = 'relative';
  return box;
};
const stat = (key: 'asked' | 'skipped' | 'kept') => { try { void chrome.runtime.sendMessage({ type: 'stat', key }); } catch { /* the extension was reloaded */ } };
const clock = (s: number) => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');

function style() {
  if (document.getElementById('skipz-style')) return;
  const s = document.createElement('style');
  s.id = 'skipz-style';
  s.textContent = `
.skipz-mark{position:absolute;top:0;height:100%;background:#ffd23f;opacity:.95;pointer-events:none;z-index:40;border-radius:1px;min-width:3px}
.skipz-chip{position:absolute;left:16px;bottom:78px;z-index:2600;display:flex;align-items:center;gap:8px;padding:8px 8px 8px 16px;border-radius:999px;background:#111;color:#fff;font:600 14px/1.2 system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.45);animation:skipz-in .18s ease-out}
.skipz-strip{position:absolute;left:0;right:0;bottom:0;height:5px;background:rgba(255,255,255,.18);pointer-events:none;z-index:2500}.skipz-strip .skipz-mark{height:100%}
@media (max-width:640px){.skipz-chip{left:10px;right:10px;bottom:56px;flex-wrap:wrap;justify-content:space-between;border-radius:24px}.skipz-chip button{flex:1 1 auto}}
.skipz-chip b{color:#ffd23f}.skipz-chip span{opacity:.75;font-weight:500}
.skipz-chip button{min-height:44px;padding:0 18px;border:0;border-radius:999px;font:600 14px system-ui,sans-serif;cursor:pointer}
.skipz-chip .go{background:#ffd23f;color:#111}.skipz-chip .stay{background:#2a2a2a;color:#fff}
.skipz-chip .save{display:inline-flex;align-items:center;justify-content:center;min-width:44px;padding:0;background:#2a2a2a;color:#fff}.skipz-chip .save svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:2;stroke-linejoin:round}.skipz-chip .save[aria-pressed=true]{color:#ffd23f}.skipz-chip .save[aria-pressed=true] svg{fill:currentColor}
.skipz-chip button:active{transform:scale(.96)}.skipz-chip button:focus-visible{outline:2px solid #fff;outline-offset:2px}
@keyframes skipz-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.skipz-chip{animation:none}}`;
  (document.head ?? document.documentElement).appendChild(s);
}

function clear() {
  drawn.forEach((d) => d.remove()); drawn = [];
  chip?.remove(); chip = null;
  clearTimeout(hideTimer);
  window.clearTimeout(drawTimer);
  mark = null; bursts = []; dismissed.clear(); skippedAt = null;
  loopToken++; listeningFor = null; handledAd = false; warming = false; // a listening that is running stops
}

function draw() {
  style();
  const v = video();
  if (!mark || !bursts.length || !v || !isFinite(v.duration) || v.duration <= 0) return;
  drawn.forEach((d) => d.remove()); drawn = [];
  // YouTube's own seek bar when the page has one (desktop); otherwise a thin strip of our own along the bottom of the video, so the yellow marks show on any layout
  let bar = document.querySelector<HTMLElement>('.ytp-progress-bar');
  if (!bar) {
    const box = playerBox();
    if (!box) return;
    bar = document.createElement('div'); bar.className = 'skipz-strip'; box.appendChild(bar);
    drawn.push(bar);
  }
  const marks: HTMLElement[] = bursts.map((b) => {
    const d = document.createElement('div');
    d.className = 'skipz-mark';
    d.style.left = (b.start / v.duration) * 100 + '%';
    d.style.width = ((b.end - b.start) / v.duration) * 100 + '%';
    d.title = 'Sponsor ' + clock(b.start) + '–' + clock(b.end);
    bar!.appendChild(d);
    return d;
  });
  drawn = [...marks, ...drawn];
}

function show(html: (c: HTMLElement) => void, forMs = 0) {
  style();
  const player = playerBox();
  if (!player) return;
  chip?.remove();
  chip = document.createElement('div');
  chip.className = 'skipz-chip';
  chip.setAttribute('role', 'status');
  html(chip);
  player.appendChild(chip);
  clearTimeout(hideTimer);
  if (forMs) hideTimer = window.setTimeout(() => { chip?.remove(); chip = null; }, forMs);
}

const button = (label: string, cls: string, on: () => void) => { const b = document.createElement('button'); b.type = 'button'; b.className = cls; b.textContent = label; b.addEventListener('click', on); return b; };
// The bookmark button (only when the build has it on). Pressing it keeps this sponsor in the browser's own storage: where it was, which video, when. Nothing is sent anywhere.
const saveButton = (b: Burst): HTMLElement[] => {
  if (!__SAVE__ || !mark) return [];
  const m = mark;
  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'save'; btn.title = 'Save this sponsor for later'; btn.setAttribute('aria-label', 'Save this sponsor for later'); btn.setAttribute('aria-pressed', 'false');
  btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18l-6-4.5L6 21z"/></svg>';
  btn.addEventListener('click', () => {
    const on = btn.getAttribute('aria-pressed') !== 'true';
    btn.setAttribute('aria-pressed', String(on));
    try {
      void chrome.storage.local.get('savedSponsors').then((r) => {
        const all: { videoId: string; start: number }[] = Array.isArray(r.savedSponsors) ? r.savedSponsors : [];
        const rest = all.filter((x) => !(x.videoId === m.videoId && x.start === b.start));
        void chrome.storage.local.set({ savedSponsors: on ? [{ videoId: m.videoId, title: document.title.replace(/ - YouTube$/, ''), brand: m.brand, start: b.start, end: b.end, savedAt: new Date().toISOString() }, ...rest].slice(0, 200) : rest });
      });
    } catch { /* the extension was reloaded */ }
  });
  return [btn];
};
const words = (c: HTMLElement, brand: string, rest: string) => { const b = document.createElement('b'); b.textContent = brand; const s = document.createElement('span'); s.textContent = rest; c.append(b, s); };

function skip(b: Burst) {
  const v = video();
  if (!v || !mark) return;
  skippedAt = v.currentTime;
  v.currentTime = b.end;
  dismissed.add(b.start);
  stat('skipped');
  show((c) => { words(c, 'Skipped', ' ' + clock(b.end - b.start)); c.append(button('Undo', 'go', () => { v.currentTime = skippedAt ?? b.start; skippedAt = null; chip?.remove(); chip = null; })); }, 7000);
}

function ask(b: Burst) {
  if (!mark || chip) return;
  stat('asked');
  show((c) => {
    words(c, 'Sponsor', ' · ' + clock(b.end - b.start));
    c.append(button('Skip it', 'go', () => skip(b)), button('Keep watching', 'stay', () => { dismissed.add(b.start); stat('kept'); chip?.remove(); chip = null; }), ...saveButton(b));
  });
}

function tick() {
  const v = video();
  if (!v || !mark || skippedAt !== null || mode === 'off' || mark.live) return; // a sponsor still being heard is handled by heardAd
  const t = v.currentTime;
  const b = bursts.find((x) => !dismissed.has(x.start) && t >= x.start - LEAD && t < x.end - 1);
  if (!b) { if (chip && !bursts.some((x) => t >= x.start - LEAD && t < x.end)) { chip.remove(); chip = null; } return; }
  if (mode === 'skip' && t >= b.start) skip(b); // only reachable when the lock is open and the person chose it
  else if (!chip) ask(b);
}

// ---- Listening: for a video whose captions cannot be read, Skipz hears what is playing (5-second slices, on this computer) and the ears (ears.ts) tell it when a sponsor read starts ----
// Nothing is sent anywhere: the sound goes to a page of this extension, is turned into words there, and is dropped. It never starts, pauses or changes the video, except to jump past a sponsor when asked.
type Heard = { ok: true; b64: string; secs: number; at: number } | { ok: false; why: string };
type LiveAd = { brand: string | null; start: number; end: number; ended: boolean };
// YouTube's own ads play in the same player: Skipz never listens to them (it would hear YouTube's ad as a sponsor read)
const adShowing = () => !!document.querySelector('.html5-video-player.ad-showing, #movie_player.ad-showing');
const SLICE = 4; // seconds heard at a time
let loopToken = 0;
let listeningFor: string | null = null; // the video a listening loop is running for
let handledAd = false; // the person has been asked (or it was skipped) for the ad being heard now
let warming = false;
let knownNow: string[] = []; // the brands the page already names, so the second ear spells them right

// The video's own sound, 16 kHz mono, for `seconds` of real time, as 16-bit samples in base64 (the same capture Skipz uses; a content script cannot import it, so it is written out here).
async function capture(seconds: number, token: number): Promise<Heard> {
  const v = video() as (HTMLVideoElement & { captureStream?: () => MediaStream }) | null;
  if (!v) return { ok: false, why: 'No video found on this page.' };
  if (v.paused || v.ended || adShowing()) return { ok: false, why: 'paused' };
  if (!v.captureStream) return { ok: false, why: 'This page’s video cannot be listened to.' };
  let tracks: MediaStreamTrack[];
  try { tracks = v.captureStream().getAudioTracks(); } catch (e) { return { ok: false, why: String((e as Error).message || e) }; }
  if (!tracks.length) return { ok: false, why: 'No sound yet.' };
  const at = v.currentTime;
  const ctx = new AudioContext({ sampleRate: 16000 });
  const chunks: Float32Array[] = []; let n = 0; const want = 16000 * seconds;
  let src: MediaStreamAudioSourceNode | null = null; let proc: ScriptProcessorNode | null = null;
  try {
    src = ctx.createMediaStreamSource(new MediaStream(tracks));
    proc = ctx.createScriptProcessor(4096, 1, 1);
    proc.onaudioprocess = (e) => { const d = e.inputBuffer.getChannelData(0); chunks.push(new Float32Array(d)); n += d.length; };
    src.connect(proc); proc.connect(ctx.destination); // silent: nothing is written to the output
    await new Promise<void>((done) => { const t0 = Date.now(); const iv = setInterval(() => { if (n >= want || Date.now() - t0 > (seconds + 6) * 1000 || v.paused || token !== loopToken) { clearInterval(iv); done(); } }, 200); });
  } finally {
    try { proc?.disconnect(); } catch { /* already gone */ }
    try { src?.disconnect(); } catch { /* already gone */ }
    for (const t of tracks) { try { t.stop(); } catch { /* fine */ } }
    try { await ctx.close(); } catch { /* already closed */ }
  }
  if (n < 8000) return { ok: false, why: 'less than half a second' };
  const len = Math.min(n, want); const pcm = new Int16Array(len); let o = 0;
  for (const c of chunks) { for (let i = 0; i < c.length && o < len; i++, o++) pcm[o] = Math.max(-1, Math.min(1, c[i])) * 32767; if (o >= len) break; }
  const bytes = new Uint8Array(pcm.buffer); let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { ok: true, b64: btoa(bin), secs: len / 16000, at };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const toEars = <T,>(m: unknown): Promise<T | undefined> => chrome.runtime.sendMessage(m).catch(() => undefined);

chrome.runtime.onMessage.addListener((m: { type?: string; pct?: number }) => {
  if (m?.type === 'ears:progress' && warming && chip) { const s = chip.querySelector('span'); if (s) s.textContent = ' ' + Math.max(1, Math.round(m.pct ?? 0)) + '%'; }
});

// The question, once, the first time a video has no captions: Skipz can listen instead. The models are downloaded once (about 48 MB).
function askToListen(id: string, known: string[]) {
  show((c) => {
    words(c, 'No captions here.', ' Let Skipz listen? One-time 48 MB download.');
    c.append(button('Yes', 'go', () => { void toEars({ type: 'listen-choice', yes: true }); void startListening(id, known); }), button('No thanks', 'stay', () => { void toEars({ type: 'listen-choice', yes: false }); chip?.remove(); chip = null; }));
  });
}

async function startListening(id: string, known: string[]) {
  const token = ++loopToken;
  listeningFor = id;
  warming = true;
  show((c) => words(c, 'Getting ready', ' 1%'));
  await toEars({ type: 'listen-open' });
  let w: { ok?: boolean; error?: string } | undefined;
  for (let i = 0; i < 8 && !w; i++) { w = await toEars<{ ok?: boolean; error?: string }>({ type: 'ears:warm' }); if (!w) await sleep(500); } // the page that holds the models may still be starting
  warming = false;
  if (token !== loopToken || idOf() !== id) return;
  if (!w?.ok) { listeningFor = null; show((c) => { words(c, 'Could not get ready to listen.', ''); c.append(button('OK', 'stay', () => { chip?.remove(); chip = null; })); }, 8000); return; }
  chip?.remove(); chip = null;
  void listenLoop(id, token, known);
}

async function listenLoop(id: string, token: number, known: string[]) {
  let fails = 0;
  let pending: Promise<Heard> | null = null;
  while (token === loopToken && idOf() === id && mode !== 'off') {
    const v = video();
    if (!v || v.paused || v.ended || adShowing()) { pending = null; await sleep(700); continue; }
    const cap: Heard = await (pending ?? capture(SLICE, token));
    pending = null;
    if (!cap.ok) { if (cap.why !== 'paused' && ++fails > 6) { listeningFor = null; return; } await sleep(800); continue; }
    fails = 0;
    pending = capture(SLICE, token); // the next slice is heard while this one is read: no sound is missed
    const r = await toEars<{ live: LiveAd | null }>({ type: 'ears:heard', videoId: id, b64: cap.b64, at: cap.at, secs: cap.secs, known });
    if (token !== loopToken || idOf() !== id) return;
    if (r?.live) heardAd(r.live);
  }
}

// An ad is being heard now (or has just ended): mark it on the timeline and ask, or skip, once.
function heardAd(l: LiveAd) {
  const brand = l.brand ?? 'Sponsor';
  mark = { videoId: idOf() ?? '', brand, start: l.start, end: l.end, confidence: 0.8, from: 'heard', live: !l.ended };
  bursts = burstsOfMark(mark);
  draw();
  if (l.ended) { handledAd = false; return; } // reported once; the next ad is asked about afresh
  if (handledAd || mode === 'off') return;
  handledAd = true;
  if (mode === 'skip') { void skipAhead(); return; }
  stat('asked');
  show((c) => {
    words(c, 'Sponsor', ' started');
    c.append(button('Skip it', 'go', () => void skipAhead()), button('Keep watching', 'stay', () => { stat('kept'); chip?.remove(); chip = null; }), ...saveButton({ start: l.start, end: l.end }));
  });
}

// Jumps past an ad that is still being read: ten seconds ahead, listen for three, and again, until the talk is ordinary. Undo goes back to where the ad began.
async function skipAhead() {
  const v = video(); const m = mark; const id = idOf();
  if (!v || !m || !id) return;
  const resume = listeningFor === id;
  const token = ++loopToken; // the listening loop waits while this runs
  const back = Math.max(0, m.start);
  show((c) => words(c, 'Skipping', ' …'));
  let quietRuns = 0;
  for (let i = 0; i < 12; i++) {
    v.currentTime = Math.min(isFinite(v.duration) ? v.duration - 1 : v.currentTime + 10, v.currentTime + 10);
    await sleep(700);
    const here = v.currentTime;
    const cap = await capture(3, token);
    if (!cap.ok) break; // paused or no sound: stop here
    const r = await toEars<{ ad: boolean | null }>({ type: 'ears:probe', b64: cap.b64, brand: m.brand });
    if (r?.ad === false) { v.currentTime = here; break; } // ordinary talk again: stay where this listen began
    if (r?.ad === null && ++quietRuns >= 2) { v.currentTime = here; break; } // music or silence twice in a row: the ad has ended
    if (r?.ad) quietRuns = 0;
  }
  const to = v.currentTime;
  skippedAt = back; stat('skipped');
  mark = { ...m, end: to, live: false }; bursts = burstsOfMark(mark); draw();
  show((c) => { words(c, 'Skipped', ' ' + clock(Math.max(0, to - back))); c.append(button('Undo', 'go', () => { v.currentTime = back; skippedAt = null; chip?.remove(); chip = null; })); }, 8000);
  if (resume && idOf() === id) { handledAd = true; void listenLoop(id, token, knownNow); }
}

// The captions, asked for the moment the page starts to load (2026-10-23): on a cold open YouTube's own scripts keep the page busy for 9 to 25 seconds, and every call Skipz makes INTO the page waited behind them.
// This is the same two requests the page route makes (the video's caption list, then the caption file), from the page's own address, so YouTube sees what it always sees; a refusal pauses it for the page's life.
const EARLY_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8'; // YouTube's public web key, the one every open-source YouTube client uses
let earlyPausedUntil = 0;
async function earlyCaptions(id: string): Promise<{ text: string | null; ms: number; why: string }> {
  const t0 = Date.now();
  const out = (text: string | null, why: string) => ({ text, ms: Date.now() - t0, why });
  if (Date.now() < earlyPausedUntil) return out(null, 'paused');
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 6000);
  try {
    const r = await fetch('/youtubei/v1/player?key=' + EARLY_KEY + '&prettyPrint=false', { method: 'POST', signal: ctl.signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ context: { client: { clientName: 'ANDROID', clientVersion: '20.10.38', hl: 'en', gl: 'US', androidSdkVersion: 34, osName: 'Android', osVersion: '14' } }, videoId: id, contentCheckOk: true, racyCheckOk: true }) });
    if (!r.ok) { if (r.status === 403 || r.status === 429) earlyPausedUntil = Date.now() + 3600000; return out(null, 'player ' + r.status); }
    const j = await r.json() as { playabilityStatus?: { status?: string }; captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: { baseUrl?: string; languageCode?: string; kind?: string }[] } } };
    if (j.playabilityStatus?.status === 'LOGIN_REQUIRED') { earlyPausedUntil = Date.now() + 3600000; return out(null, 'asked to sign in'); }
    const tracks = j.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
    const pick = tracks.find((t) => !t.kind && /^en/i.test(t.languageCode ?? '')) ?? tracks.find((t) => t.kind === 'asr' && /^en/i.test(t.languageCode ?? '')) ?? tracks.find((t) => !t.kind) ?? tracks[0];
    if (!pick?.baseUrl) return out(null, 'no track');
    if (/[?&]exp=xpe/.test(pick.baseUrl)) return out(null, 'needs the player');
    const u = new URL(pick.baseUrl, location.origin); u.searchParams.set('fmt', 'json3');
    const f = await fetch(u.toString(), { signal: ctl.signal });
    if (!f.ok) { if (f.status === 403 || f.status === 429) earlyPausedUntil = Date.now() + 3600000; return out(null, 'file ' + f.status); }
    const text = await f.text();
    return text.trim() ? out(text, 'ok') : out(null, 'empty file');
  } catch (e) {
    return out(null, (e as Error)?.name === 'AbortError' ? 'timed out' : String((e as Error)?.message ?? e).slice(0, 60));
  } finally { clearTimeout(timer); }
}

// The marks are drawn as soon as the video's length is known: on YouTube's own seek bar when it exists, else on a thin strip of our own along the video's bottom edge, which moves onto the seek bar the moment YouTube builds it
// (on a cold open YouTube builds the bar several seconds after the video exists). It looks every 0.4 s, for up to 30 s.
let drawTimer = 0;
function drawWhenReady(n = 0, onStrip = false) {
  window.clearTimeout(drawTimer);
  const v = video();
  const bar = !!document.querySelector('.ytp-progress-bar');
  if (v && isFinite(v.duration) && v.duration > 0 && (bar || !onStrip)) { draw(); if (bar) return; onStrip = true; }
  if (n < 75) drawTimer = window.setTimeout(() => drawWhenReady(n + 1, onStrip), 400);
}

let current: string | null = null;
let retired = false;
let retryTimer = 0;
let retriesLeft = 4;
let noted: string | null = null; // the video the "found a sponsor, not where" note was shown for
async function open(again = false) {
  const id = idOf();
  if (id === current && !again) return;
  if (retired) return;
  window.clearTimeout(retryTimer);
  if (!again) { clear(); retriesLeft = 4; }
  current = id;
  if (!id) return;
  const early = again ? { text: null, ms: 0, why: 'retry' } : await earlyCaptions(id); // a retry asks the page route (the file may not have been ready)
  if (idOf() !== id) return; // the person moved on while the file loaded
  const msg: Ask = { type: 'check', videoId: id, url: location.href, capText: early.text, capMs: early.ms, capWhy: early.why };
  const asked = Date.now();
  const trail = (o: unknown) => { try { document.documentElement.setAttribute('data-skipz', JSON.stringify(o)); } catch { /* nothing to show */ } }; // readable from the page: what Skipz asked, when it was answered, and what the check found
  trail({ video: id, asking: true });
  try {
    const a: Answer | undefined = await chrome.runtime.sendMessage(msg);
    trail({ video: id, answeredAfterMs: Date.now() - asked, marked: !!a?.mark, retry: !!a?.retry, mode: a?.mode, noCaptions: a?.noCaptions, listen: a?.listen, debug: a?.debug ?? null });
    if (idOf() !== id || !a) return; // the person moved on
    mode = a.mode; mark = a.mark; bursts = a.mark ? burstsOfMark(a.mark) : [];
    if (a.retry && retriesLeft-- > 0) retryTimer = window.setTimeout(() => { if (idOf() === id) void open(true); }, 13000); // the first reading was incomplete: look again in a moment (a few times)
    knownNow = a.known ?? [];
    const canListen = a.noCaptions && !a.mark && mode !== 'off' && a.listen !== 'no';
    if (canListen && a.listen === 'yes') { if (listeningFor !== id) void startListening(id, knownNow); }
    else if (canListen && a.listen === 'ask') { if (!chip) askToListen(id, knownNow); }
    else if (a.found && !a.mark && noted !== id && mode !== 'off') { noted = id; show((c) => { words(c, 'Sponsor found', ''); c.append(button('OK', 'stay', () => { chip?.remove(); chip = null; })); }, 8000); }
    drawWhenReady();
  } catch (e) { trail({ video: id, error: String((e as Error)?.message ?? e).slice(0, 200) }); /* usually: the extension was reloaded, the next page load starts fresh */ }
}

// When the extension updates, an open YouTube tab keeps the old copy of this script, cut off from the extension. The worker starts a fresh copy in every open YouTube tab (background.ts, 'startInOpenTabs');
// the fresh copy tells the old one to stand down (copies from before this event existed cannot hear it, so their leftovers on the page are removed too).
const RETIRE = 'skipz-retire';
document.dispatchEvent(new CustomEvent(RETIRE));
document.querySelectorAll('.skipz-chip,.skipz-mark,.skipz-strip,#skipz-style').forEach((e) => e.remove());
const mine = new AbortController();
document.addEventListener('yt-navigate-finish', () => { current = null; void open(); }, { signal: mine.signal });
// The phone site does not send that event the same way, so the address is also checked once a second (a plain string compare)
const poll = window.setInterval(() => { if (idOf() !== current) { current = null; void open(); } }, 1000);
document.addEventListener('timeupdate', tick, { capture: true, signal: mine.signal });
document.addEventListener(RETIRE, () => { retired = true; mine.abort(); window.clearInterval(poll); window.clearTimeout(retryTimer); clear(); }, { once: true });
void open();
