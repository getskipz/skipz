// Skipz on the YouTube watch page: draws every sponsor burst on the seek bar and, a moment before each one starts, asks "Skip it?" with two big buttons (maintainer, 2026-10-13: "show every burst":
// a short plug up front and the main read later are two bursts, each marked and each asked about).
// It never skips on its own unless the person chose that AND the lock in gate.ts is open (the worker reports the mode that is really in force).
import type { Answer, Ask } from './background';
import { endOffer } from './endOffer';
import type { Burst, Mark } from './verdict'; // types only: a content script cannot import code from another file
const burstsOfMark = (m: Mark): Burst[] => [{ start: m.start, end: m.end }, ...(m.more ?? [])].reduce<Burst[]>((out, b) => { // the same as in verdict.ts: overlapping bursts are drawn as one
  const hit = out.find((o) => b.start <= o.end && b.end >= o.start);
  if (hit) { hit.start = Math.min(hit.start, b.start); hit.end = Math.max(hit.end, b.end); } else out.push({ ...b });
  return out;
}, []);

// A bookmark after "Support me" that saves the sponsor to look at later (maintainer, 2026-10-22: "hide for now, it'll be used in the future"). Built but OFF: the build turns it on with SKIPZ_SAVE=1.
declare const __SAVE__: boolean;
const LEAD = 7; // seconds before a burst when the question appears (maintainer, 2026-10-24: 'show 7 seconds before the sponsor segment')
let mark: Mark | null = null;
let bursts: Burst[] = [];
let mode: Answer['mode'] = 'ask';
let supported = false; // the person pressed "Support me" on this video: at the end of the video the sponsor's own link is offered (maintainer, 2026-11-02)
const dismissed = new Set<number>(); // bursts ("Support me" or an Undo) the person has answered on this video, by their start
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
const stat = (key: 'asked' | 'skipped' | 'kept' | 'late') => { try { void chrome.runtime.sendMessage({ type: 'stat', key }); } catch { /* the extension was reloaded */ } };
const clock = (s: number) => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');

function style() {
  if (document.getElementById('skipz-style')) return;
  const s = document.createElement('style');
  s.id = 'skipz-style';
  s.textContent = `
.skipz-mark{position:absolute;top:0;height:100%;background:#ffd23f;opacity:.95;pointer-events:none;z-index:40;border-radius:1px;min-width:3px}
.skipz-chip{position:absolute;left:12px;bottom:64px;z-index:2600;display:flex;align-items:center;gap:6px;box-sizing:border-box;height:40px;padding:0 4px 0 14px;border-radius:999px;background:rgba(0,0,0,.3);color:#eee;font:500 13px/1.2 'YouTube Noto',Roboto,Arial,sans-serif;white-space:nowrap;animation:skipz-in .25s ease-out}
.skipz-strip{position:absolute;left:0;right:0;bottom:0;height:5px;background:rgba(255,255,255,.18);pointer-events:none;z-index:2500}.skipz-strip .skipz-mark{height:100%}
@media (max-width:640px){.skipz-chip{left:10px;right:10px;bottom:56px;height:auto;padding:4px 4px 4px 14px;flex-wrap:wrap;justify-content:space-between;border-radius:24px;font-size:14px;background:rgba(0,0,0,.55)}.skipz-chip button{flex:1 1 auto;min-height:44px;font-size:14px}}
.skipz-chip b{color:#ffd23f}.skipz-chip span{opacity:.75;font-weight:500}.skipz-chip.tight{padding-left:4px;gap:4px}.skipz-chip.tight button{padding:0 10px;font-size:12.5px}.skipz-chip.tight b,.skipz-chip.tight span{display:none}
.skipz-chip button{min-height:32px;padding:0 13px;border:0;border-radius:999px;font:600 13px 'YouTube Noto',Roboto,Arial,sans-serif;cursor:pointer}
.skipz-chip .go{background:#ffd23f;color:#111}.skipz-chip .stay{background:#fff;color:#000}
.skipz-chip .save{display:inline-flex;align-items:center;justify-content:center;min-width:32px;padding:0;background:rgba(255,255,255,.14);color:#fff}.skipz-chip .save svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:2;stroke-linejoin:round}.skipz-chip .save[aria-pressed=true]{color:#ffd23f}.skipz-chip .save[aria-pressed=true] svg{fill:currentColor}
.skipz-chip button:active{transform:scale(.96)}.skipz-chip button:focus-visible{outline:2px solid #fff;outline-offset:2px}
@keyframes skipz-in{from{opacity:0}to{opacity:1}}
@media (prefers-reduced-motion:reduce){.skipz-chip{animation:none}}`;
  (document.head ?? document.documentElement).appendChild(s);
}

function clear() {
  drawn.forEach((d) => d.remove()); drawn = [];
  chip?.remove(); chip = null;
  clearTimeout(hideTimer);
  window.clearTimeout(drawTimer);
  mark = null; bursts = []; dismissed.clear(); skippedAt = null; supported = false;
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
    d.style.width = ((Math.min(b.end, v.duration) - b.start) / v.duration) * 100 + '%'; // never past the end of the video
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
  place();
  clearTimeout(hideTimer);
  if (forMs) hideTimer = window.setTimeout(() => { chip?.remove(); chip = null; }, forMs);
}

// Where the pill sits (maintainer, 2026-11-02, marked rectangle on a screenshot): in the empty space of YouTube's control row, right of the chapter name, so it does not float over the picture. It is only put there when the space is wide enough
// (and not on a phone-width window); otherwise it keeps the old place above the seek bar. YouTube's own element names are read, never changed.
function place() {
  const player = playerBox();
  if (!chip || !player) return;
  // Full pill first; when the gap is too small (the player is narrow: Skipz's panel open, a small window), the compact pill: just the buttons, without the "Sponsor · 2:03" words. Measured again on every tick, so it follows the player as it resizes.
  chip.classList.remove('tight');
  const wide = window.innerWidth > 640;
  let slot = wide ? freeSlot(player, chip.offsetWidth, chip.offsetHeight) : null;
  if (!slot && wide) {
    chip.classList.add('tight');
    slot = freeSlot(player, chip.offsetWidth, chip.offsetHeight);
    if (!slot) chip.classList.remove('tight');
  }
  chip.style.left = slot ? slot.left + 'px' : '';
  chip.style.bottom = slot ? slot.bottom + 'px' : '';
}
function freeSlot(player: HTMLElement, w: number, h: number): { left: number; bottom: number } | null {
  const controls = player.querySelector<HTMLElement>('.ytp-chrome-controls');
  const right = player.querySelector<HTMLElement>('.ytp-right-controls');
  if (!controls || !right || !w) return null;
  const left = ['.ytp-chapter-container', '.ytp-time-display', '.ytp-volume-area', '.ytp-play-button'].map((s) => player.querySelector<HTMLElement>(s)).filter((e): e is HTMLElement => !!e && e.getBoundingClientRect().width > 0);
  if (!left.length) return null;
  const gap = 12;
  const from = Math.max(...left.map((e) => e.getBoundingClientRect().right));
  const to = right.getBoundingClientRect().left;
  if (to - from - 2 * gap < w) return null; // not enough room: keep the old place
  const pr = player.getBoundingClientRect();
  const cr = controls.getBoundingClientRect();
  return { left: from - pr.left + gap, bottom: pr.bottom - (cr.top + cr.height / 2 + h / 2) };
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
    c.append(button('Skip it', 'go', () => skip(b)), button('Support me', 'stay', () => { dismissed.add(b.start); supported = true; stat('kept'); chip?.remove(); chip = null; offerNow(10000); }), ...saveButton(b));
  });
}

// The video has ended and the person pressed "Support me": offer the sponsor's own link (the channel's discount link from the description), opened in a new tab by a click, never by itself.
// maintainer, 2026-11-02: the sponsor's link shows for 10 seconds right after "Support me" (the moment the person said yes), and again when the video ends.
function offerNow(ms: number) {
  const offer = endOffer(supported, mark, idOf());
  if (!offer) return;
  show((c) => {
    words(c, 'Thank you', ' for supporting');
    c.append(button('Visit ' + offer.name, 'go', () => { window.open(offer.url, '_blank', 'noopener,noreferrer'); chip?.remove(); chip = null; }), button('Close', 'stay', () => { chip?.remove(); chip = null; }));
  }, ms);
}
function onEnded() { offerNow(30000); }

function tick() {
  if (chip) place();
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
declare const __BRIDGE__: string; // the fixture recorder's address in a `npm run build:bridge` build, else ''
const REC = typeof __BRIDGE__ === 'string' && __BRIDGE__ !== '';
let loopToken = 0;
let slices = 0;
let lastPct = 0;
// What the listening is doing, for the toolbar popup to say (nothing is drawn over the video).
const listenStatus = (state: string, pct: number) => { lastPct = pct; try { void chrome.storage.local.set({ listenStatus: { state, pct, at: Date.now() } }); } catch { /* the extension was reloaded */ } };
// What the listening is doing, readable from the page like data-skipz (so it can be checked without opening anything).
let heardSecs = 0; let heardMs = 0; // sound the first ear has been given, and the time it took (only slices with sound), for the speed check
let listenT0 = 0; // when (ms since the page started) the listening was first started for this page: checks that it runs beside Capture
const ears = (o: Record<string, unknown>) => { try { document.documentElement.setAttribute('data-skipz-ears', JSON.stringify({ video: idOf(), startedAtMs: listenT0, ...o })); } catch { /* nothing to show */ } };
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
  if (m?.type === 'ears:progress' && warming) { const pct = Math.max(1, Math.round(m.pct ?? 0)); if (pct - lastPct >= 3 || pct >= 100) listenStatus('getting ready', pct); }
});

async function startListening(id: string, known: string[]) {
  const token = ++loopToken;
  listenT0 = Math.round(performance.now());
  listeningFor = id;
  warming = true;
  listenStatus('getting ready', 1); // said in the toolbar popup, not over the video (maintainer, 2026-10-24: "make less intrusive")
  ears({ state: 'warming' });
  await toEars({ type: 'listen-open' });
  let w: { ok?: boolean; error?: string } | undefined;
  for (let i = 0; i < 8 && !w; i++) { w = await toEars<{ ok?: boolean; error?: string }>({ type: 'ears:warm' }); if (!w) await sleep(500); } // the page that holds the models may still be starting
  warming = false;
  if (token !== loopToken || idOf() !== id) return;
  if (!w?.ok) { listeningFor = null; listenStatus('could not get ready', 0); return; } // the next video tries again
  listenStatus('ready', 100);
  ears({ state: 'listening' });
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
    const r = await toEars<{ live: LiveAd | null; text?: string; ms?: number }>({ type: 'ears:heard', videoId: id, b64: cap.b64, at: cap.at, secs: cap.secs, known: knownNow.length ? knownNow : known });
    if (token !== loopToken || idOf() !== id) return;
    slices++; if ((r?.ms ?? 0) > 0) { heardSecs += cap.secs; heardMs += r!.ms!; }
    // speedTimes = how many times faster than real time the first ear works on this computer (sound heard divided by time the model took; slices of silence are skipped by the model and left out)
    ears({ state: 'listening', slices, lastAt: Math.round(cap.at), lastMs: r?.ms ?? 0, lastSecs: Math.round(cap.secs * 10) / 10, speedTimes: heardMs > 0 ? Math.round((heardSecs / (heardMs / 1000)) * 10) / 10 : null });
    if (REC && r?.text) void chrome.runtime.sendMessage({ type: 'rec-heard', videoId: id, at: cap.at, secs: cap.secs, text: r.text }).catch(() => {}); // fixture recorder: the words heard, not the sound
    if (r?.live) heardAd(r.live);
  }
}

// An ad is being heard now (or has just ended): mark it on the timeline and ask, or skip, once.
function heardAd(l: LiveAd) {
  const brand = l.brand ?? 'Sponsor';
  const had = mark && mark.from !== 'heard' ? bursts.slice() : []; // the captions or the page already marked this video
  const near = had.find((b) => l.start <= b.end + 15 && l.end >= b.start - 15);
  if (near) { // the same ad: the listening CONFIRMS it and sharpens its end instead of replacing it (and does not ask a second time)
    if (l.ended && l.end > near.end) near.end = l.end;
    bursts = had; ears({ state: 'listening', slices, confirmed: { start: Math.round(near.start), end: Math.round(near.end) } }); draw();
    return;
  }
  mark = { videoId: idOf() ?? '', brand, start: l.start, end: l.end, confidence: 0.8, from: 'heard', live: !l.ended };
  bursts = [...had, ...burstsOfMark(mark)];
  ears({ state: 'heard', slices, heard: { start: Math.round(l.start), end: Math.round(l.end) } });
  draw();
  if (l.ended) { handledAd = false; return; } // reported once; the next ad is asked about afresh
  if (handledAd || mode === 'off') return;
  handledAd = true;
  if (mode === 'skip') { void skipAhead(); return; }
  stat('asked');
  show((c) => {
    words(c, 'Sponsor', ' started');
    c.append(button('Skip it', 'go', () => void skipAhead()), button('Support me', 'stay', () => { supported = true; stat('kept'); chip?.remove(); chip = null; offerNow(10000); }), ...saveButton({ start: l.start, end: l.end }));
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
// When YouTube refuses a caption request, EVERY caption request waits: Skipz keeps one shared pause in storage (10 minutes) that the early request, the switch and the worker all read, so a refusal is not followed by five more requests (2026-10-26: the repeats were what got his Chrome refused).
const looksLikeCaptions = (b: string): boolean => { const s = b.trimStart(); return (s.startsWith('{') && s.includes('"events"')) || (s.startsWith('<') && !/^<(!doctype|html)/i.test(s) && /<(transcript|timedtext|text|p)\b/i.test(s)); }; // an error page is not a caption file (seen 2026-10-26: YouTube answered the player's own caption request with a 1 KB web page, and it was taken for captions)
const pauseYt = (ms: number) => { try { void chrome.storage.local.set({ skipzYtPausedUntil: Date.now() + ms }); } catch { /* the extension was reloaded */ } };
const pausedYt = async (): Promise<boolean> => { try { return (((await chrome.storage.local.get('skipzYtPausedUntil')).skipzYtPausedUntil as number | undefined) ?? 0) > Date.now(); } catch { return false; } };
async function earlyCaptions(id: string): Promise<{ text: string | null; ms: number; why: string }> {
  const t0 = Date.now();
  const out = (text: string | null, why: string) => ({ text, ms: Date.now() - t0, why });
  if (await pausedYt()) return out(null, 'paused');
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 6000);
  try {
    const r = await fetch('/youtubei/v1/player?key=' + EARLY_KEY + '&prettyPrint=false', { method: 'POST', signal: ctl.signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ context: { client: { clientName: 'ANDROID', clientVersion: '20.10.38', hl: 'en', gl: 'US', androidSdkVersion: 34, osName: 'Android', osVersion: '14' } }, videoId: id, contentCheckOk: true, racyCheckOk: true }) });
    if (!r.ok) { if (r.status === 403 || r.status === 429) pauseYt(600000); return out(null, 'player ' + r.status); }
    const j = await r.json() as { playabilityStatus?: { status?: string }; captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: { baseUrl?: string; languageCode?: string; kind?: string }[] } } };
    if (j.playabilityStatus?.status === 'LOGIN_REQUIRED') { pauseYt(600000); return out(null, 'asked to sign in'); }
    const tracks = j.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
    const pick = tracks.find((t) => !t.kind && /^en/i.test(t.languageCode ?? '')) ?? tracks.find((t) => t.kind === 'asr' && /^en/i.test(t.languageCode ?? '')) ?? tracks.find((t) => !t.kind) ?? tracks[0];
    if (!pick?.baseUrl) return out(null, 'no track');
    if (/[?&]exp=xpe/.test(pick.baseUrl)) return out(null, 'needs the player');
    const u = new URL(pick.baseUrl, location.origin); u.searchParams.set('fmt', 'json3');
    const f = await fetch(u.toString(), { signal: ctl.signal });
    if (!f.ok) { if (f.status === 403 || f.status === 429) pauseYt(600000); return out(null, 'file ' + f.status); }
    const text = await f.text();
    if (!text.trim()) return out(null, 'empty file');
    if (!looksLikeCaptions(text)) { pauseYt(600000); return out(null, 'refused (a web page, not captions)'); }
    return out(text, 'ok');
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

// Capture (src/capture.ts, in the page's own world): every caption file the player downloads is told to this script as it happens.
type Caught = { v: string; lang: string; auto: boolean; body: string; at: number };
const caught: Caught[] = [];
document.addEventListener('skipz-cap', (e) => { try { const c = JSON.parse((e as CustomEvent<string>).detail) as Caught; if (c?.body && looksLikeCaptions(c.body)) { caught.push(c); if (caught.length > 8) caught.shift(); capNote({ lastLang: c.lang, lastAuto: c.auto, lastBytes: c.body.length }); } } catch { /* not ours */ } });
const sleep2 = (ms: number) => new Promise((r) => setTimeout(r, ms));
const capNote = (o: Record<string, unknown>) => { try { document.documentElement.setAttribute('data-skipz-cap', JSON.stringify({ code: 'cap3', caught: caught.length, ...o })); } catch { /* nothing to show */ } }; // what Capture did, readable from the page like data-skipz
// YouTube keeps the viewer's caption choice in the page's own storage (read 2026-11-01 in the maintainer's Chrome: both keys said "false" with captions off; the "true" value is expected but not yet seen).
const captionsPreferredOn = (): boolean => ['yt-player-sticky-caption', 'yt-player-caption-persistence'].some((k) => { try { return JSON.parse(JSON.parse(localStorage.getItem(k) || 'null')?.data ?? 'null') === true; } catch { return false; } });
const CAPTURE_HEAD_START = 2500; // ms the player's own file gets before Skipz asks YouTube itself (measured 2026-10-26: the player's file arrived about 2 s after page start with captions on)
// The captions from whichever route gets there first (maintainer, 2026-10-26: both run at once): Skipz's own early request, or the file the player downloads by itself (Capture).
// If neither has come by 5 s (or the early request failed at once), the hidden captions switch asks the player for one.
async function anyText(id: string): Promise<{ text: string | null; ms: number; why: string; via: string }> {
  const t0 = Date.now();
  let early: { text: string | null; ms: number; why: string } | null = null;
  // Capture goes FIRST (maintainer, 2026-11-01: "capture is most important"): the file the player downloads by itself costs YouTube no extra request. Skipz's own early request starts only if that file has not come within CAPTURE_HEAD_START, and never when it has.
  // The head start is given only when the viewer's saved choice is captions ON: then the player downloads the file by itself within about 2 s. With captions off (the usual case) nothing would arrive that early, so the head start would only delay the answer (seen 2026-11-01: +2.5 s for nothing).
  const headStart = captionsPreferredOn() ? CAPTURE_HEAD_START : 0;
  const runEarly = () => {
    if (idOf() !== id) return;
    if (caught.some((x) => x.v === id || !x.v)) { capNote({ earlySkipped: true }); return; }
    void earlyCaptions(id).then((r) => { early = r; });
  };
  const startEarly = window.setTimeout(runEarly, headStart);
  let asked = false;
  const refused = await pausedYt(); // while YouTube is refusing, nothing will arrive from the early request: wait only a moment for the player's own file, then ask the worker (the page's label and description still give the sponsor)
  try {
  for (let i = 0; i < (refused ? 15 : 40); i++) {
    if (idOf() !== id) return { text: null, ms: Date.now() - t0, why: 'moved on', via: 'none' };
    const e = early as { text: string | null; ms: number; why: string } | null;
    if (e?.text) return { text: e.text, ms: Date.now() - t0, why: 'ok', via: 'early' };
    const c = caught.filter((x) => x.v === id || !x.v).slice(-1)[0];
    if (c) return { text: c.body, ms: Date.now() - t0, why: 'ok', via: 'player' };
    const waited = Date.now() - t0;
    if (!asked && (waited > 5000 || (e && !e.text && waited > 1500))) { asked = true; if (!(await pausedYt())) document.dispatchEvent(new CustomEvent('skipz-cap-ask')); } // not while YouTube is refusing: the switch makes the player download again
    await sleep2(200);
  }
  } finally { clearTimeout(startEarly); }
  const e = early as { text: string | null; ms: number; why: string } | null;
  return { text: null, ms: Date.now() - t0, why: e?.why ?? 'timed out', via: 'none' };
}
// Once the answer is out, the hidden captions switch runs on every video (once) to bring the player's OTHER caption track; it goes to the worker as a second text.
let secondFor: string | null = null;
async function captureSecond(id: string, used: string | null) {
  if (secondFor === id) return;
  secondFor = id;
  await sleep2(2500);
  if (await pausedYt()) return;
  if (idOf() !== id) return;
  const finished = new Promise<string>((r) => { const h = (e: Event) => { document.removeEventListener('skipz-cap-done', h); r(String((e as CustomEvent<string>).detail ?? 'ok')); }; document.addEventListener('skipz-cap-done', h); setTimeout(() => h(new CustomEvent('skipz-cap-done', { detail: 'timed out' })), 12000); });
  document.dispatchEvent(new CustomEvent('skipz-cap-ask'));
  const why = await finished;
  capNote({ switchDone: why ?? 'ok' });
  if (idOf() !== id) return;
  const mine = caught.filter((c) => c.v === id || !c.v);
  const other = mine.filter((c) => c.body !== used).slice(-1)[0];
  if (!other) return;
  try {
    const a = await chrome.runtime.sendMessage({ type: 'check', videoId: id, url: location.href, capText: used ?? mine[0]?.body ?? null, capText2: used ? other.body : mine.length > 1 ? mine[mine.length - 1].body : null, force: true, capVia: 'player' } satisfies Ask) as Answer | undefined;
    if (idOf() !== id || !a?.mark || mark?.from === 'heard') return;
    mode = a.mode; mark = a.mark; bursts = burstsOfMark(a.mark);
    drawWhenReady();
  } catch { /* the extension was reloaded */ }
}

let current: string | null = null;
let retired = false;
let retryTimer = 0;
let retriesLeft = 4;
let noted: string | null = null; // the video the "found a sponsor, not where" note was shown for
// One more look when YouTube's refusal has ended (2026-10-26): a video opened while captions were refused used to stay without marks for good; now it asks once more, after the shared pause.
const lateTried = new Set<string>();
const lateChecked = new Set<string>(); // videos whose first mark has been checked for being late
async function lateLook(id: string) {
  if (lateTried.has(id)) return;
  lateTried.add(id);
  let until = 0; try { until = ((await chrome.storage.local.get('skipzYtPausedUntil')).skipzYtPausedUntil as number | undefined) ?? 0; } catch { return; }
  const wait = Math.min(11 * 60000, Math.max(20000, until - Date.now() + 3000));
  window.setTimeout(() => { if (idOf() === id && !mark && !retired) void open(true, true); }, wait);
}
// Listening starts as soon as the page opens, beside the caption routes. The worker says whether listening is allowed here (the setting, the build); the brands the page names are filled in later, when the answer comes (knownNow).
async function listenAlongside(id: string) {
  try {
    const r = await chrome.runtime.sendMessage({ type: 'listen-allowed' }) as { ok?: boolean } | undefined;
    if (r?.ok && idOf() === id && listeningFor !== id) void startListening(id, knownNow);
  } catch { /* the extension was reloaded */ }
}
async function open(again = false, force = false) {
  const id = idOf();
  if (id === current && !again) return;
  if (retired) return;
  window.clearTimeout(retryTimer);
  if (!again) { clear(); retriesLeft = 4; }
  current = id;
  if (!id) return;
  if (!again) void listenAlongside(id); // the listening (yt2captions) starts with Capture, not after the caption answer (maintainer, 2026-11-01)
  const early = again && !force ? { text: null as string | null, ms: 0, why: 'retry', via: 'retry' } : await anyText(id); // a retry asks the page route (the file may not have been ready)
  if (idOf() !== id) return; // the person moved on while the file loaded
  const msg: Ask = { type: 'check', videoId: id, url: location.href, capText: early.text, capMs: early.ms, capWhy: early.why, capVia: early.via, ...(force ? { force: true } : {}) };
  const asked = Date.now();
  const trail = (o: unknown) => { try { document.documentElement.setAttribute('data-skipz', JSON.stringify(o)); } catch { /* nothing to show */ } }; // readable from the page: what Skipz asked, when it was answered, and what the check found
  trail({ video: id, asking: true });
  try {
    const a: Answer | undefined = await chrome.runtime.sendMessage(msg);
    trail({ video: id, capVia: early.via, capMs: early.ms, capWhy: early.why, answeredAfterMs: Date.now() - asked, marked: !!a?.mark, retry: !!a?.retry, mode: a?.mode, noCaptions: a?.noCaptions, listen: a?.listen, debug: a?.debug ?? null });
    if (idOf() !== id || !a) return; // the person moved on
    mode = a.mode; mark = a.mark; bursts = a.mark ? burstsOfMark(a.mark) : [];
    // The speed check (maintainer, 2026-11-01): was the mark found before the sponsor began? Counted once per video, the first time a mark is shown.
    if (a.mark && !lateChecked.has(id)) { lateChecked.add(id); const pv = video(); if (pv && bursts.some((b) => pv.currentTime >= b.start && pv.currentTime < b.end - 1)) stat('late'); }
    if (a.retry && retriesLeft-- > 0) retryTimer = window.setTimeout(() => { if (idOf() === id) void open(true); }, 13000); // the first reading was incomplete: look again in a moment (a few times)
    knownNow = a.known ?? [];
    if (a.noCaptions && !a.mark && !force) void lateLook(id);
    // Every detector runs on every video (maintainer, 2026-10-24: "always use, with or without caption, for accuracy and fewer false starts"): the captions and the page above, and the listening here, side by side.
    if (mode !== 'off' && a.listen !== 'no' && listeningFor !== id) void startListening(id, knownNow);
    if (a.found && !a.mark && noted !== id && mode !== 'off') { noted = id; show((c) => { words(c, 'Sponsor found', ''); c.append(button('OK', 'stay', () => { chip?.remove(); chip = null; })); }, 8000); }
    drawWhenReady();
    if (!a.mark || a.mark.confidence < 0.85 || a.found) void captureSecond(id, early.text); // a clear answer needs no second track: every extra caption request is a chance to be refused
  } catch (e) { trail({ video: id, error: String((e as Error)?.message ?? e).slice(0, 200) }); /* usually: the extension was reloaded, the next page load starts fresh */ }
}

// When the extension updates, an open YouTube tab keeps the old copy of this script, cut off from the extension. The worker starts a fresh copy in every open YouTube tab (background.ts, 'startInOpenTabs');
// the fresh copy tells the old one to stand down (copies from before this event existed cannot hear it, so their leftovers on the page are removed too).
// YouTube's transcript panel is invisible from its first paint while Skipz reads it (the page carries data-skipz-reading for the whole read); it still lays out, so the reading works.
if (!document.getElementById('skipz-reading-rule')) { const hr = document.createElement('style'); hr.id = 'skipz-reading-rule'; hr.textContent = 'html[data-skipz-reading] ytd-engagement-panel-section-list-renderer[target-id*="transcript" i],html[data-skipz-reading] ytd-engagement-panel-section-list-renderer[target-id*="macro-markers" i],html[data-skipz-reading] ytd-engagement-panel-section-list-renderer[target-id*="in-this-video" i],html[data-skipz-reading] ytd-engagement-panel-section-list-renderer[target-id*="in_this_video" i]{position:fixed!important;left:0!important;top:0!important;width:420px!important;height:640px!important;opacity:0!important;pointer-events:none!important;z-index:-1!important}'; document.documentElement.appendChild(hr); }
// A copy of this script left on the page after the extension updated cannot reach the extension any more; its failed calls are not errors worth listing (chrome://extensions > Errors showed a pile of them, 2026-11-02).
window.addEventListener('unhandledrejection', (e) => { if (/context invalidated/i.test(String((e.reason as Error | undefined)?.message ?? e.reason))) e.preventDefault(); });
const RETIRE = 'skipz-retire';
document.dispatchEvent(new CustomEvent(RETIRE));
document.querySelectorAll('.skipz-chip,.skipz-mark,.skipz-strip,#skipz-style').forEach((e) => e.remove());
const mine = new AbortController();
document.addEventListener('yt-navigate-finish', () => { current = null; void open(); }, { signal: mine.signal });
// The phone site does not send that event the same way, so the address is also checked once a second (a plain string compare)
const poll = window.setInterval(() => { if (idOf() !== current) { current = null; void open(); } }, 1000);
document.addEventListener('timeupdate', tick, { capture: true, signal: mine.signal });
document.addEventListener('ended', onEnded, { capture: true, signal: mine.signal });
document.addEventListener(RETIRE, () => { retired = true; mine.abort(); window.clearInterval(poll); window.clearTimeout(retryTimer); clear(); }, { once: true });
void open();
