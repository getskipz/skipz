// Skipz's worker. The page asks "is there a sponsor in this video?"; the worker asks the shared list first, then reads the page the person opened (one page, never in a loop),
// answers with a mark, and, after "I agree", sends what it found back to the Index. Nothing is ever sent for a video the person did not open.
import { readYouTubeTab } from '@detector/lib/youtube/reader';
import { readTranscript } from '@detector/lib/youtube/transcript';
import type { ItTranscript } from '@detector/lib/youtube/innertube';
import { loadSettings, bump } from './settings';
import { effectiveMode } from './gate';
import { burstsOf } from '@detector/lib/sponsor/check';
import { verdictOf, markFrom, type Mark } from './verdict';
import { askIndex, sendFinding, INDEX_URL } from './sharedList';
import { isLocalCopy, readBuildId } from '@detector/lib/autoUpdate';

export type Ask = { type: 'check'; videoId: string; url: string };
// found: a sponsor was found but not where it is (no times); retry: the reading was incomplete (captions refused or not ready yet), so the page asks again in a while
export type Answer = { mark: Mark | null; mode: 'off' | 'ask' | 'skip'; found?: string; retry?: boolean };

// This session's answers, so a video is read once. An INCOMPLETE answer (no captions read, or a sponsor found without times) is kept only for RETRY_AFTER and tried again, up to TRIES times:
// the first try can be too early (a video 43 minutes old may have no captions yet), and one refusal must not decide a video for good (2026-10-22, the Fireship video).
const RETRY_AFTER = 90000, TRIES = 3;
const done = new Map<string, { mark: Answer['mark']; found?: string; retryAt: number | null; tries: number }>();
const sentToday = new Set<string>();

async function check(tabId: number, ask: Ask): Promise<Answer> {
  const s = await loadSettings();
  const mode = effectiveMode(s.mode);
  if (mode === 'off' || (INDEX_URL && !s.agreed)) return { mark: null, mode }; // nothing to agree to until findings can be shared
  const prev = done.get(ask.videoId);
  if (prev && (prev.retryAt === null || Date.now() < prev.retryAt)) return { mark: prev.mark, mode, found: prev.found, retry: prev.retryAt !== null };
  if (!prev) void bump('checked');
  const known = await askIndex(ask.videoId);
  if (known) { done.set(ask.videoId, { mark: known, retryAt: null, tries: 1 }); void bump('marked'); return { mark: known, mode }; }
  const page = await readYouTubeTab(tabId, ask.url);
  if (page.kind !== 'video' || page.video.videoId !== ask.videoId) return { mark: null, mode }; // the page was not ready or the person moved on: not remembered, asked again later
  // YouTube's own captions: first the quiet route (the page's own interface, nothing shown); if YouTube refuses that, the Transcript panel is opened out of sight, read and closed again (the same two steps Skipz takes).
  // Until 2026-10-22 only the quiet route was tried, so a refused video got no times and so no mark.
  const tr = await readTranscript(tabId, ask.videoId);
  const captions: ItTranscript = tr.state === 'ok' ? tr : tr.state === 'none' ? { state: 'none' } : { state: 'trouble', why: tr.why ?? 'The transcript did not open in time.' };
  const v = verdictOf(page, captions);
  const more = burstsOf(v).filter((b) => !b.main && b.end !== null).map((b) => ({ start: b.start, end: b.end! })); // every other burst the reading found
  const mark = v.sponsored ? markFrom(ask.videoId, { ...v, more }, 'page') : null;
  const tries = (prev?.tries ?? 0) + 1;
  const incomplete = captions.state !== 'ok' || (v.sponsored && !mark);
  const retryAt = incomplete && !mark && tries < TRIES ? Date.now() + RETRY_AFTER : null;
  const found = v.sponsored && !mark ? (v.brand ?? 'A sponsor') : undefined;
  done.set(ask.videoId, { mark, found, retryAt, tries });
  if (mark && !prev?.mark) void bump('marked');
  if (INDEX_URL && !sentToday.has(ask.videoId)) {
    sentToday.add(ask.videoId);
    const r = await sendFinding(ask.videoId, page.video.channelId, { ...v, methods: v.votes }, true);
    if (r === 'sent') void bump('shared'); else if (r === 'later') sentToday.delete(ask.videoId);
  }
  return { mark, mode, found, retry: retryAt !== null };
}

chrome.runtime.onMessage.addListener((msg: Ask | { type: 'stat'; key: 'asked' | 'skipped' | 'kept' }, sender, reply) => {
  if (msg.type === 'stat') { void bump(msg.key); return false; }
  const tabId = sender.tab?.id;
  if (msg.type !== 'check' || tabId === undefined) return false;
  check(tabId, msg).then(reply, () => reply({ mark: null, mode: 'ask' } satisfies Answer));
  return true; // the answer comes later
});

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
