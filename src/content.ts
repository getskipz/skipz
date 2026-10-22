// Skipz on the YouTube watch page: draws every sponsor burst on the seek bar and, a moment before each one starts, asks "Skip it?" with two big buttons (maintainer, 2026-10-13: "show every burst":
// a short plug up front and the main read later are two bursts, each marked and each asked about).
// It never skips on its own unless the person chose that AND the lock in gate.ts is open (the worker reports the mode that is really in force).
import type { Answer, Ask } from './background';
import type { Burst, Mark } from './verdict'; // types only: a content script cannot import code from another file
const burstsOfMark = (m: Mark): Burst[] => [{ start: m.start, end: m.end }, ...(m.more ?? [])]; // the same one-liner as in verdict.ts

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
.skipz-chip button:active{transform:scale(.96)}.skipz-chip button:focus-visible{outline:2px solid #fff;outline-offset:2px}
@keyframes skipz-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.skipz-chip{animation:none}}`;
  document.head.appendChild(s);
}

function clear() {
  drawn.forEach((d) => d.remove()); drawn = [];
  chip?.remove(); chip = null;
  clearTimeout(hideTimer);
  mark = null; bursts = []; dismissed.clear(); skippedAt = null;
}

function draw() {
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
    d.title = 'Sponsor: ' + mark!.brand + ' ' + clock(b.start) + '–' + clock(b.end);
    bar!.appendChild(d);
    return d;
  });
  drawn = [...marks, ...drawn];
}

function show(html: (c: HTMLElement) => void, forMs = 0) {
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
const words = (c: HTMLElement, brand: string, rest: string) => { const b = document.createElement('b'); b.textContent = brand; const s = document.createElement('span'); s.textContent = rest; c.append(b, s); };

function skip(b: Burst) {
  const v = video();
  if (!v || !mark) return;
  skippedAt = v.currentTime;
  v.currentTime = b.end;
  dismissed.add(b.start);
  stat('skipped');
  show((c) => { words(c, 'Skipped', ' ' + clock(b.end - b.start) + ' of ' + mark!.brand); c.append(button('Undo', 'go', () => { v.currentTime = skippedAt ?? b.start; skippedAt = null; chip?.remove(); chip = null; })); }, 7000);
}

function ask(b: Burst) {
  if (!mark || chip) return;
  const m = mark;
  stat('asked');
  show((c) => {
    words(c, m.brand, ' sponsor · ' + clock(b.end - b.start));
    c.append(button('Skip it', 'go', () => skip(b)), button('Keep watching', 'stay', () => { dismissed.add(b.start); stat('kept'); chip?.remove(); chip = null; }));
  });
}

function tick() {
  const v = video();
  if (!v || !mark || skippedAt !== null || mode === 'off') return;
  const t = v.currentTime;
  const b = bursts.find((x) => !dismissed.has(x.start) && t >= x.start - LEAD && t < x.end - 1);
  if (!b) { if (chip && !bursts.some((x) => t >= x.start - LEAD && t < x.end)) { chip.remove(); chip = null; } return; }
  if (mode === 'skip' && t >= b.start) skip(b); // only reachable when the lock is open and the person chose it
  else if (!chip) ask(b);
}

let current: string | null = null;
async function open() {
  const id = idOf();
  if (id === current) return;
  clear();
  current = id;
  if (!id) return;
  style();
  const msg: Ask = { type: 'check', videoId: id, url: location.href };
  try {
    const a: Answer | undefined = await chrome.runtime.sendMessage(msg);
    if (idOf() !== id || !a) return; // the person moved on
    mode = a.mode; mark = a.mark; bursts = a.mark ? burstsOfMark(a.mark) : [];
    const v = video();
    if (v && isFinite(v.duration) && v.duration > 0) draw(); // the length may not be known yet (it arrives a moment after the page opens): then draw when it is
    else v?.addEventListener('durationchange', draw, { once: true });
  } catch { /* the extension was reloaded: the next page load starts fresh */ }
}

document.addEventListener('yt-navigate-finish', () => { current = null; void open(); });
// The phone site does not send that event the same way, so the address is also checked once a second (a plain string compare)
window.setInterval(() => { if (idOf() !== current) { current = null; void open(); } }, 1000);
document.addEventListener('timeupdate', tick, true);
void open();
