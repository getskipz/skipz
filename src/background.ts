// Skipz's worker. The page asks "is there a sponsor in this video?"; the worker asks the shared list first, then reads the page the person opened (one page, never in a loop),
// answers with a mark, and, after "I agree", sends what it found back to the Index. Nothing is ever sent for a video the person did not open.
import { readYouTubeTab } from '@detector/lib/youtube/reader';
import { readTranscript } from '@detector/lib/youtube/transcript';
import { parseCaptionBody } from '@detector/lib/youtube/captions';
import { recordFixture } from './fixture';
import { keepMiss } from './misses';
import type { ItTranscript } from '@detector/lib/youtube/innertube';
import { loadSettings, saveSettings, bump, type Listen } from './settings';
import { needleCandidates } from '@detector/lib/ai/needle';
import type { NeedleRead } from '@detector/lib/ai/needle';
import { effectiveMode, type Mode } from './gate';

import { verdictOf, decide, type Mark } from './verdict';
import { askIndex, sendFinding, INDEX_URL } from './sharedList';
import { isLocalCopy, readBuildId } from '@detector/lib/autoUpdate';
import { offerLink } from './offerLink';
import { crowdFor, withCrowd } from './crowd';
import { settle } from './settle';

// capText: the caption file the page script already fetched (at the very start of the page load, before YouTube's scripts get busy); capMs/capWhy: how that went
export type Ask = { type: 'check'; videoId: string; url: string; capText?: string | null; capMs?: number; capWhy?: string; capVia?: string; capText2?: string | null; force?: boolean }; // capText2: the player's other caption track (Capture); force: look again with it, ignoring the saved answer
// found: a sponsor was found but not where it is (no times); retry: the reading was incomplete (captions refused or not ready yet), so the page asks again in a moment;
// noCaptions: no caption could be read, so the page may LISTEN to the video instead (listen says whether the person agreed to that); known: the brands the page already names (the second ear spells them right)
// debug: a short record of what the check did and how long each step took, shown on the page as the attribute data-skipz (and in "Copy info for support"), so a slow or empty check can be seen without guessing
export type Debug = { cached?: boolean; ver?: string; via?: string; earlyMs?: number; earlyWhy?: string; calls?: string[]; pingMs?: number; pageMs?: number; captionsMs?: number; totalMs?: number; page?: string; captions?: string; why?: string; sponsored?: boolean; conf?: number; start?: number | null; end?: number | null; votes?: string[]; error?: string; probable?: string };
export type Answer = { debug?: Debug; mark: Mark | null; mode: Mode; found?: string; retry?: boolean; noCaptions?: boolean; listen?: Listen; known?: string[] };

// This session's answers, so a video is read once. An INCOMPLETE answer (no captions read, or a sponsor found without times) is kept only for RETRY_AFTER and tried again, up to TRIES times:
// the first try can be too early (a video 43 minutes old may have no captions yet), and one refusal must not decide a video for good (2026-10-22, the Fireship video).
const EARS = typeof chrome.offscreen?.createDocument === 'function'; // Firefox has no such page: there Skipz reads captions and descriptions only
const ANSWER_WITHIN = 20000;
const RETRY_AFTER = 12000, TRIES = 4; // short: this runs on the video the person has just opened
// How long each call into the page took (which step is slow on a busy page), kept for the diagnostic trail.
const calls: string[] = [];
const realExecute = chrome.scripting.executeScript.bind(chrome.scripting) as (i: unknown) => Promise<unknown>;
(chrome.scripting as unknown as { executeScript: unknown }).executeScript = (i: { func?: { name?: string }; args?: unknown[] }) => { const t = Date.now(); const name = (i.func?.name || 'fn') + (typeof i.args?.[0] === 'string' ? ':' + String(i.args[0]).replace(/[?].*/, '').slice(-24) : ''); return realExecute(i).finally(() => { calls.push(name + ' ' + (Date.now() - t) + 'ms @' + new Date().toISOString().slice(17, 23)); if (calls.length > 40) calls.shift(); }); };
const done = new Map<string, { mark: Answer['mark']; found?: string; retryAt: number | null; tries: number; noCaptions: boolean; known: string[]; debug?: Debug }>();

// The page with no window that holds the listening models (ears.ts). Created the first time something needs it.
let openingEars: Promise<void> | null = null;
const openEars = () => (openingEars ??= (async () => {
  if (!(await chrome.offscreen.hasDocument())) await chrome.offscreen.createDocument({ url: 'ears.html', reasons: [chrome.offscreen.Reason.WORKERS], justification: 'Runs the small listening models, which need web workers' });
})().finally(() => { openingEars = null; }));
async function needleRead(candidates: string[], paid: boolean, all: string): Promise<NeedleRead | null> {
  try { await openEars(); return await Promise.race([chrome.runtime.sendMessage({ type: 'ears:needle', candidates, paid, all }), new Promise<null>((r) => setTimeout(() => r(null), 45000))]); } catch { return null; }
}
// The listening models are fetched right after install (maintainer, 2026-10-24: "yes do this"), so nobody waits on the first video. Progress: the toolbar badge and a bar in the popup.
// (The hidden page reports it as ears:progress; until 2026-10-24 that went nowhere, which is why the old notice sat at 1%.)
let lastBadge = '';
const badge = (pct: number | null) => { const t = pct === null || pct >= 100 ? '' : pct + '%'; if (t === lastBadge) return; lastBadge = t; void chrome.action.setBadgeText({ text: t }).catch(() => {}); if (t) void chrome.action.setBadgeBackgroundColor({ color: '#111' }).catch(() => {}); };
const setListenStatus = (state: string, pct: number) => { badge(state === 'getting ready' ? pct : null); return chrome.storage.local.set({ listenStatus: { state, pct, at: Date.now() } }).catch(() => {}); };
chrome.runtime.onMessage.addListener((m: { type?: string; pct?: number }) => {
  if (m?.type === 'ears:progress') void setListenStatus((m.pct ?? 0) >= 100 ? 'ready' : 'getting ready', Math.max(1, Math.round(m.pct ?? 0)));
  return false;
});
async function prefetchEars() {
  if (!EARS) return;
  const st = (await chrome.storage.local.get(['listenStatus', 'settings'])) as { listenStatus?: { state: string; at: number }; settings?: { listen?: string } };
  if (st.settings?.listen === 'no' || (st.listenStatus?.state === 'ready' && Date.now() - st.listenStatus.at < 14 * 864e5)) return;
  await setListenStatus('getting ready', 1);
  try {
    await openEars();
    let r: { ok?: boolean } | undefined;
    for (let i = 0; i < 8 && !r; i++) { r = await chrome.runtime.sendMessage({ type: 'ears:warm' }).catch(() => undefined); if (!r) await new Promise((res) => setTimeout(res, 500)); }
    if (r?.ok) await setListenStatus('ready', 100); // (if the worker slept meanwhile, the final ears:progress above says it)
  } catch { /* the page script tries again on the first video */ }
}
chrome.runtime.onInstalled.addListener(() => void prefetchEars());
chrome.runtime.onStartup.addListener(() => void prefetchEars());
async function keepCaptions(id: string, lines: { t: number; text: string }[]) {
  try {
    const recent: string[] = ((await chrome.storage.session.get('capRecent')).capRecent as string[] | undefined) ?? [];
    const next = [id, ...recent.filter((x) => x !== id)];
    const drop = next.slice(15).map((x) => 'cap:' + x);
    await chrome.storage.session.set({ ['cap:' + id]: lines, capRecent: next.slice(0, 15) });
    if (drop.length) await chrome.storage.session.remove(drop);
  } catch { /* storage full or not available: just not kept */ }
}
const sentToday = new Set<string>();

async function check(tabId: number, ask: Ask): Promise<Answer> {
  const s = await loadSettings();
  const mode = effectiveMode(s.mode);
  if (mode === 'off' || (INDEX_URL && !s.agreed)) return { mark: null, mode }; // nothing to agree to until findings can be shared
  const prev = done.get(ask.videoId);
  if (!ask.force && prev && (prev.retryAt === null || Date.now() < prev.retryAt)) return { mark: prev.mark, mode, found: prev.found, retry: prev.retryAt !== null, noCaptions: prev.noCaptions, listen: EARS && s.listen !== 'no' ? 'yes' : 'no', known: prev.known, debug: prev.debug && { ...prev.debug, cached: true } }; // a repeat answer still says how the first one was reached
  if (!prev) void bump('checked');
  const known = await askIndex(ask.videoId);
  if (known) { done.set(ask.videoId, { mark: known, retryAt: null, tries: 1, noCaptions: false, known: [] }); void bump('marked'); return { mark: known, mode }; }
  const crowdP = crowdFor(ask.videoId); // SponsorBlock's marks (crowd.ts): asked of SponsorBlock, not YouTube, so it runs beside the page and caption reads below; a slow or missing answer is left out
  // The page and the captions are read AT THE SAME TIME (the captions need only the video's id), so neither waits for the other.
  calls.length = 0;
  const t0 = Date.now(); let tPage = 0, tCaps = 0;
  let pinged = -1; // how long one trivial call into the page takes: a busy page makes every call wait
  const ping = chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: () => 1 }).then(() => { pinged = Date.now() - t0; }, () => { pinged = -1; });
  // The captions: first the file the page script fetched at the start of the page load (not queued behind YouTube's own scripts); only if that has none, through the page, as before.
  // (Tried 2026-10-23: asking from the background is refused by YouTube with a 403, so that route is not used.)
  let via = 'page';
  // The captions are kept for this browser session (the last 15 videos): opening a video again, or a retry, never asks YouTube twice, so there is less to be refused.
  const getCaptions = async () => {
    const key = 'cap:' + ask.videoId;
    const kept = (await chrome.storage.session.get(key).catch(() => ({})) as Record<string, { t: number; text: string }[] | undefined>)[key];
    if (kept?.length) { via = 'kept'; return { state: 'ok' as const, lines: kept }; }
    let got: Awaited<ReturnType<typeof readTranscript>> | null = null;
    if (ask.capText) { const lines = parseCaptionBody(ask.capText); if (lines.length) { via = ask.capVia ?? 'early'; got = { state: 'ok' as const, lines }; } }
    got ??= await readTranscript(tabId, ask.videoId, { panel: false }); // never YouTube's transcript panel (maintainer, 2026-10-24: it ruins the page); no captions then means the listening does the work
    if (got.state === 'ok') void keepCaptions(ask.videoId, got.lines);
    return got;
  };
  const [, page, tr] = await Promise.all([ping, readYouTubeTab(tabId, ask.url).finally(() => { tPage = Date.now() - t0; }), getCaptions().finally(() => { tCaps = Date.now() - t0; })]);
  if (page.kind !== 'video' || page.video.videoId !== ask.videoId) return { mark: null, mode, retry: true, debug: { pageMs: tPage, captionsMs: tCaps, page: page.kind === 'video' ? 'other video ' + page.video.videoId : page.kind } }; // the page was not ready or the person moved on: not remembered, asked again soon
  // YouTube's own captions: first the quiet route (the page's own interface, nothing shown); if YouTube refuses that there are no captions, and the listening hears the video instead.
  // (2026-10-22 added the panel as a fallback; 2026-10-24 removed it again on the maintainer's word: it must never show. The listening covers a video the quiet route cannot read.)
  if (tr.state !== 'ok' && /refus|paused/i.test(String((tr as { why?: string }).why ?? ''))) void chrome.storage.local.set({ skipzYtPausedUntil: Date.now() + 600000 }).catch(() => {}); // the page script and the switch read the same pause
  const captions: ItTranscript = tr.state === 'ok' ? tr : tr.state === 'none' ? { state: 'none' } : { state: 'trouble', why: tr.why ?? 'The transcript did not open in time.' };
  const second = ask.capText2 ? parseCaptionBody(ask.capText2) : null;
  const v = verdictOf(page, captions, null, second);
  void recordFixture(ask.videoId, { source: 'skipz', title: page.video.title ?? null, channel: page.channel?.name ?? null, lengthSeconds: page.video.lengthSeconds ?? null, paid: !!page.video.paidPromotion, description: page.video.description ?? null, chapters: page.video.chapters ?? [], captionLines: captions.state === 'ok' ? captions.lines : null, captionsVia: via, secondTrackLines: second, answer: { sponsored: v.sponsored, brand: v.brand, confidence: v.confidence, start: v.start, end: v.end, votes: v.votes.map((x) => ({ method: x.method, said: x.said, brand: x.brand ?? null, score: x.score, start: x.start ?? null, end: x.end ?? null, proof: x.proof })) } });
  const needleWanted = true; // the naming model runs on EVERY video (maintainer's rule, 2026-10-24: every detector, every time), AFTER the answer goes out so nobody waits; it feeds the listening's brand list
  const named = [...new Set(v.votes.map((x) => x.brand).filter((x): x is string => !!x))];
  const noCaptions = captions.state !== 'ok';
  const decided = decide(ask.videoId, v, captions.state === 'ok' ? captions.lines : null, page.video.description); // the same function the replay tests run (src/replay.test.ts)
  const link = offerLink(page.video.description, v.brand, v.site); // the channel's own link for this sponsor, if the description has one (maintainer, 2026-11-02)
  const detected = decided.mark ? { ...decided.mark, ...(link ? { link } : {}) } : null;
  // The crowd's marks are folded in AFTER the detector decided (and what is sent to the Index below is the detector's verdict only, never the crowd's).
  const mark = settle(prev?.mark, withCrowd(detected, await crowdP, v.brand ?? null, ask.videoId)); // an answer already made stands: a later look can make it surer, never move or remove it (settle.ts)
  const probable = decided.probable;
  // Only the misses are kept (maintainer, 2026-11-01): sure there is a sponsor, but not placed, or placed only by a best guess. Kept on this computer; the popup can save them to a file.
  if (v.sponsored && !mark) void keepMiss({ videoId: ask.videoId, title: page.video.title ?? null, channel: page.channel?.name ?? null, lengthSeconds: page.video.lengthSeconds ?? null, paid: !!page.video.paidPromotion, description: (page.video.description ?? '').slice(0, 3000), chapters: page.video.chapters ?? [], captionLines: captions.state === 'ok' ? captions.lines : null, brand: v.brand, confidence: v.confidence, why: !mark ? 'found, not placed' : 'placed by the words of the description (' + probable + ')', at: new Date().toISOString(), version: chrome.runtime.getManifest().version });
  const tries = (prev?.tries ?? 0) + 1;
  const incomplete = captions.state !== 'ok' || (v.sponsored && !mark);
  const retryAt = incomplete && !mark && tries < TRIES ? Date.now() + RETRY_AFTER : null;
  const note = v.sponsored && !mark ? (v.brand ?? 'A sponsor') : undefined;
  done.set(ask.videoId, { mark, found: note, retryAt, tries, noCaptions, known: named });
  if (mark && !prev?.mark) void bump('marked');
  void chrome.storage.local.set({ lastCheck: { videoId: ask.videoId, pageMs: tPage, captionsMs: tCaps, totalMs: Date.now() - t0, captions: captions.state, sponsored: v.sponsored, marked: !!mark, at: new Date().toISOString() } }).catch(() => {}); // for "Copy info for support": where the time went
  if (needleWanted) void (async () => {
    const needleT0 = Date.now();
    const nr = await needleRead(needleCandidates(page.video.description, captions.state === 'ok' ? captions.lines : null, v.start, !!page.video.paidPromotion), !!page.video.paidPromotion, page.video.description ?? '');
    const e = done.get(ask.videoId);
    if (nr && 'brand' in nr && nr.brand && e) e.known = [...new Set([...e.known, nr.brand])];
    void recordFixture(ask.videoId, { needle: nr ?? null, needleWaitedMs: Date.now() - needleT0 }); // fixture recorder: what the naming model returned, and how long it took
  })();
  if (INDEX_URL && !sentToday.has(ask.videoId)) {
    sentToday.add(ask.videoId);
    const r = await sendFinding(ask.videoId, page.video.channelId, { ...v, methods: v.votes }, true);
    if (r === 'sent') void bump('shared'); else if (r === 'later') sentToday.delete(ask.videoId);
  }
  const debug: Debug = { ver: chrome.runtime.getManifest().version, via, earlyMs: ask.capMs, earlyWhy: ask.capWhy, calls: calls.slice(), pingMs: pinged, pageMs: tPage, captionsMs: tCaps, totalMs: Date.now() - t0, page: 'video', captions: captions.state === 'ok' ? 'ok ' + captions.lines.length + ' lines' : captions.state + (captions.state === 'trouble' ? ': ' + captions.why : ''), sponsored: v.sponsored, conf: Math.round(v.confidence * 100), start: v.start, end: v.end, ...(probable ? { probable } : {}), votes: v.votes.map((x) => x.method + ':' + x.said + ':' + Math.round(x.score * 100) + (x.brand ? ':' + x.brand : '') + (x.start != null ? '@' + Math.round(x.start) + '-' + Math.round(x.end ?? 0) : '')) };
  { const e = done.get(ask.videoId); if (e) e.debug = debug; }
  return { mark, mode, found: note, retry: retryAt !== null, noCaptions, listen: EARS && s.listen !== 'no' ? 'yes' : 'no', known: named, debug };
}

chrome.runtime.onMessage.addListener((msg: Ask | { type: 'stat'; key: 'asked' | 'skipped' | 'kept' | 'late' } | { type: 'listen-open' } | { type: 'listen-allowed' } | { type: 'listen-choice'; yes: boolean } | { type: 'rec-heard'; videoId: string; at: number; secs: number; text: string }, sender, reply) => {
  if (msg.type === 'rec-heard') { void recordFixture(msg.videoId, { heardAppend: [{ t: Math.round(msg.at), secs: Math.round(msg.secs), text: msg.text }] }); return false; }
  if (msg.type === 'stat') { void bump(msg.key); return false; }
  if (msg.type === 'listen-open') { openEars().then(() => reply({ ok: true }), () => reply({ ok: false })); return true; }
  if (msg.type === 'listen-allowed') { loadSettings().then((s) => reply({ ok: EARS && s.listen !== 'no' && s.mode !== 'off' }), () => reply({ ok: false })); return true; }
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
