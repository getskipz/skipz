// Skipz's worker. The page asks "is there a sponsor in this video?"; the worker asks the shared list first, then reads the page the person opened (one page, never in a loop),
// answers with a mark, and, after "I agree", sends what it found back to the Index. Nothing is ever sent for a video the person did not open.
import { readYouTubeTab } from '@detector/lib/youtube/reader';
import { readTranscript } from '@detector/lib/youtube/transcript';
import { parseJson3 } from '@detector/lib/youtube/innertube';
import type { ItTranscript } from '@detector/lib/youtube/innertube';
import { loadSettings, saveSettings, bump, type Listen } from './settings';
import { needleCandidates } from '@detector/lib/ai/needle';
import type { NeedleRead } from '@detector/lib/ai/needle';
import { effectiveMode } from './gate';
import { burstsOf } from '@detector/lib/sponsor/check';
import { verdictOf, markFrom, brandStretches, type Mark } from './verdict';
import { askIndex, sendFinding, INDEX_URL } from './sharedList';
import { isLocalCopy, readBuildId } from '@detector/lib/autoUpdate';

// capText: the caption file the page script already fetched (at the very start of the page load, before YouTube's scripts get busy); capMs/capWhy: how that went
export type Ask = { type: 'check'; videoId: string; url: string; capText?: string | null; capMs?: number; capWhy?: string };
// found: a sponsor was found but not where it is (no times); retry: the reading was incomplete (captions refused or not ready yet), so the page asks again in a moment;
// noCaptions: no caption could be read, so the page may LISTEN to the video instead (listen says whether the person agreed to that); known: the brands the page already names (the second ear spells them right)
// debug: a short record of what the check did and how long each step took, shown on the page as the attribute data-skipz (and in "Copy info for support"), so a slow or empty check can be seen without guessing
export type Debug = { via?: string; earlyMs?: number; earlyWhy?: string; calls?: string[]; pingMs?: number; pageMs?: number; captionsMs?: number; totalMs?: number; page?: string; captions?: string; why?: string; sponsored?: boolean; conf?: number; start?: number | null; end?: number | null; votes?: string[]; error?: string };
export type Answer = { debug?: Debug; mark: Mark | null; mode: 'off' | 'ask' | 'skip'; found?: string; retry?: boolean; noCaptions?: boolean; listen?: Listen; known?: string[] };

// This session's answers, so a video is read once. An INCOMPLETE answer (no captions read, or a sponsor found without times) is kept only for RETRY_AFTER and tried again, up to TRIES times:
// the first try can be too early (a video 43 minutes old may have no captions yet), and one refusal must not decide a video for good (2026-10-22, the Fireship video).
const EARS = typeof chrome.offscreen?.createDocument === 'function'; // Firefox has no such page: there Skipz reads captions and descriptions only
const ANSWER_WITHIN = 20000;
const RETRY_AFTER = 12000, TRIES = 4; // short: this runs on the video the person has just opened
// How long each call into the page took (which step is slow on a busy page), kept for the diagnostic trail.
const calls: string[] = [];
const realExecute = chrome.scripting.executeScript.bind(chrome.scripting) as (i: unknown) => Promise<unknown>;
(chrome.scripting as unknown as { executeScript: unknown }).executeScript = (i: { func?: { name?: string }; args?: unknown[] }) => { const t = Date.now(); const name = (i.func?.name || 'fn') + (typeof i.args?.[0] === 'string' ? ':' + String(i.args[0]).replace(/[?].*/, '').slice(-24) : ''); return realExecute(i).finally(() => { calls.push(name + ' ' + (Date.now() - t) + 'ms @' + new Date().toISOString().slice(17, 23)); if (calls.length > 40) calls.shift(); }); };
const done = new Map<string, { mark: Answer['mark']; found?: string; retryAt: number | null; tries: number; noCaptions: boolean; known: string[] }>();

// The page with no window that holds the listening models (ears.ts). Created the first time something needs it.
let openingEars: Promise<void> | null = null;
const openEars = () => (openingEars ??= (async () => {
  if (!(await chrome.offscreen.hasDocument())) await chrome.offscreen.createDocument({ url: 'ears.html', reasons: [chrome.offscreen.Reason.WORKERS], justification: 'Runs the small listening models, which need web workers' });
})().finally(() => { openingEars = null; }));
async function needleRead(candidates: string[], paid: boolean, all: string): Promise<NeedleRead | null> {
  try { await openEars(); return await Promise.race([chrome.runtime.sendMessage({ type: 'ears:needle', candidates, paid, all }), new Promise<null>((r) => setTimeout(() => r(null), 12000))]); } catch { return null; }
}
const sentToday = new Set<string>();

async function check(tabId: number, ask: Ask): Promise<Answer> {
  const s = await loadSettings();
  const mode = effectiveMode(s.mode);
  if (mode === 'off' || (INDEX_URL && !s.agreed)) return { mark: null, mode }; // nothing to agree to until findings can be shared
  const prev = done.get(ask.videoId);
  if (prev && (prev.retryAt === null || Date.now() < prev.retryAt)) return { mark: prev.mark, mode, found: prev.found, retry: prev.retryAt !== null, noCaptions: prev.noCaptions, listen: EARS ? s.listen : 'no', known: prev.known };
  if (!prev) void bump('checked');
  const known = await askIndex(ask.videoId);
  if (known) { done.set(ask.videoId, { mark: known, retryAt: null, tries: 1, noCaptions: false, known: [] }); void bump('marked'); return { mark: known, mode }; }
  // The page and the captions are read AT THE SAME TIME (the captions need only the video's id), so neither waits for the other.
  calls.length = 0;
  const t0 = Date.now(); let tPage = 0, tCaps = 0;
  let pinged = -1; // how long one trivial call into the page takes: a busy page makes every call wait
  const ping = chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: () => 1 }).then(() => { pinged = Date.now() - t0; }, () => { pinged = -1; });
  // The captions: first the file the page script fetched at the start of the page load (not queued behind YouTube's own scripts); only if that has none, through the page, as before.
  // (Tried 2026-10-23: asking from the background is refused by YouTube with a 403, so that route is not used.)
  let via = 'page';
  const getCaptions = async () => {
    if (ask.capText) { const lines = parseJson3(ask.capText); if (lines.length) { via = 'early'; return { state: 'ok' as const, lines }; } }
    return readTranscript(tabId, ask.videoId);
  };
  const [, page, tr] = await Promise.all([ping, readYouTubeTab(tabId, ask.url).finally(() => { tPage = Date.now() - t0; }), getCaptions().finally(() => { tCaps = Date.now() - t0; })]);
  if (page.kind !== 'video' || page.video.videoId !== ask.videoId) return { mark: null, mode, retry: true, debug: { pageMs: tPage, captionsMs: tCaps, page: page.kind === 'video' ? 'other video ' + page.video.videoId : page.kind } }; // the page was not ready or the person moved on: not remembered, asked again soon
  // YouTube's own captions: first the quiet route (the page's own interface, nothing shown); if YouTube refuses that, the Transcript panel is opened out of sight, read and closed again (the same two steps Skipz takes).
  // Until 2026-10-22 only the quiet route was tried, so a refused video got no times and so no mark.
  const captions: ItTranscript = tr.state === 'ok' ? tr : tr.state === 'none' ? { state: 'none' } : { state: 'trouble', why: tr.why ?? 'The transcript did not open in time.' };
  const v = verdictOf(page, captions);
  const needleWanted = v.sponsored && !v.brand; // a sponsor is certain but nobody named it: the naming model is asked AFTER the answer goes out (nothing on screen shows a name, so it must not make anyone wait); it only feeds the listening's brand list
  const named = [...new Set(v.votes.map((x) => x.brand).filter((x): x is string => !!x))];
  const noCaptions = captions.state !== 'ok';
  const more = burstsOf(v).filter((b) => !b.main && b.end !== null).map((b) => ({ start: b.start, end: b.end! })); // every other burst the reading found
  let found = { ...v, more } as typeof v & { more: { start: number; end: number }[] };
  if (v.sponsored && (v.start === null || v.end === null) && v.brand && captions.state === 'ok') { // sure there is a sponsor, but no spoken read found: an integrated sponsor, marked where the creator talks about the brand
    const s = brandStretches(captions.lines, v.brand).sort((a, b) => (b.end - b.start) - (a.end - a.start));
    if (s.length) found = { ...v, start: s[0].start, end: s[0].end, more: s.slice(1).sort((a, b) => a.start - b.start) };
  }
  const mark = v.sponsored ? markFrom(ask.videoId, found, 'page') : null;
  const tries = (prev?.tries ?? 0) + 1;
  const incomplete = captions.state !== 'ok' || (v.sponsored && !mark);
  const retryAt = incomplete && !mark && tries < TRIES ? Date.now() + RETRY_AFTER : null;
  const note = v.sponsored && !mark ? (v.brand ?? 'A sponsor') : undefined;
  done.set(ask.videoId, { mark, found: note, retryAt, tries, noCaptions, known: named });
  if (mark && !prev?.mark) void bump('marked');
  void chrome.storage.local.set({ lastCheck: { videoId: ask.videoId, pageMs: tPage, captionsMs: tCaps, totalMs: Date.now() - t0, captions: captions.state, sponsored: v.sponsored, marked: !!mark, at: new Date().toISOString() } }).catch(() => {}); // for "Copy info for support": where the time went
  if (needleWanted) void (async () => {
    const nr = await needleRead(needleCandidates(page.video.description, captions.state === 'ok' ? captions.lines : null, v.start, !!page.video.paidPromotion), !!page.video.paidPromotion, page.video.description ?? '');
    const e = done.get(ask.videoId);
    if (nr && 'brand' in nr && nr.brand && e) e.known = [...new Set([...e.known, nr.brand])];
  })();
  if (INDEX_URL && !sentToday.has(ask.videoId)) {
    sentToday.add(ask.videoId);
    const r = await sendFinding(ask.videoId, page.video.channelId, { ...v, methods: v.votes }, true);
    if (r === 'sent') void bump('shared'); else if (r === 'later') sentToday.delete(ask.videoId);
  }
  const debug: Debug = { via, earlyMs: ask.capMs, earlyWhy: ask.capWhy, calls: calls.slice(), pingMs: pinged, pageMs: tPage, captionsMs: tCaps, totalMs: Date.now() - t0, page: 'video', captions: captions.state === 'ok' ? 'ok ' + captions.lines.length + ' lines' : captions.state + (captions.state === 'trouble' ? ': ' + captions.why : ''), sponsored: v.sponsored, conf: Math.round(v.confidence * 100), start: v.start, end: v.end, votes: v.votes.map((x) => x.method + ':' + x.said + ':' + Math.round(x.score * 100)) };
  return { mark, mode, found: note, retry: retryAt !== null, noCaptions, listen: EARS ? s.listen : 'no', known: named, debug };
}

chrome.runtime.onMessage.addListener((msg: Ask | { type: 'stat'; key: 'asked' | 'skipped' | 'kept' } | { type: 'listen-open' } | { type: 'listen-choice'; yes: boolean }, sender, reply) => {
  if (msg.type === 'stat') { void bump(msg.key); return false; }
  if (msg.type === 'listen-open') { openEars().then(() => reply({ ok: true }), () => reply({ ok: false })); return true; }
  if (msg.type === 'listen-choice') { saveSettings({ listen: msg.yes ? 'yes' : 'no' }).then(() => reply({ ok: true })); return true; }
  const tabId = sender.tab?.id;
  if (msg.type !== 'check' || tabId === undefined) return false;
  // The page is never left waiting: after ANSWER_WITHIN the check answers "not yet" (the page asks again) and says which step was still running.
  Promise.race([check(tabId, msg), new Promise<Answer>((r) => setTimeout(() => r({ mark: null, mode: 'ask', retry: true, debug: { error: 'no answer after ' + ANSWER_WITHIN / 1000 + ' s', calls: calls.slice(-8) } }), ANSWER_WITHIN))]).then(reply, (e) => reply({ mark: null, mode: 'ask', retry: true, debug: { error: String((e as Error)?.stack ?? e).slice(0, 300) } } satisfies Answer)); // a failure is no longer silent: the page shows it and asks again
  return true; // the answer comes later
});

// Tabs that were already open when Skipz was installed or updated keep no working page script (the old copy is cut off from the extension): start a fresh one in each, once.
// The page script retires any older copy itself. Only the video pages: the same address list as the manifest.
async function startInOpenTabs() {
  const tabs = await chrome.tabs.query({ url: ['https://www.youtube.com/*', 'https://m.youtube.com/*'] });
  for (const t of tabs) if (t.id !== undefined) chrome.scripting.executeScript({ target: { tabId: t.id }, files: ['content.js'] }).catch(() => { /* a tab that is closing or asleep: it loads the new script itself */ });
}
chrome.runtime.onInstalled.addListener((d) => { if (d.reason === 'install' || d.reason === 'update') void startInOpenTabs(); });

// Local copy only ("Load unpacked"): when a new build changed the worker, the page script or the manifest, reload the whole extension, so nobody presses reload at chrome://extensions.
// A page you already have open keeps the old page script until it is reloaded; the popup and the worker are new at once.
const UPDATE_ALARM = 'skipz-local-update';
if (isLocalCopy()) {
  const remember = async () => { const id = await readBuildId(); if (id) await chrome.storage.local.set({ loadedWorker: id.worker }); };
  chrome.runtime.onInstalled.addListener(remember);
  chrome.runtime.onStartup.addListener(remember);
  chrome.alarms.create(UPDATE_ALARM, { periodInMinutes: 0.5 });
  chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name !== UPDATE_ALARM) return;
    const [id, saved] = await Promise.all([readBuildId(), chrome.storage.local.get('loadedWorker')]);
    if (!id) return;
    if (!saved.loadedWorker) return void chrome.storage.local.set({ loadedWorker: id.worker });
    if (id.worker !== saved.loadedWorker) { await chrome.storage.local.set({ loadedWorker: id.worker }); chrome.runtime.reload(); }
  });
}
