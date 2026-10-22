// Skipz's worker. The page asks "is there a sponsor in this video?"; the worker asks the shared list first, then reads the page the person opened (one page, never in a loop),
// answers with a mark, and, after "I agree", sends what it found back to the Index. Nothing is ever sent for a video the person did not open.
import { readYouTubeTab } from '@detector/lib/youtube/reader';
import { transcriptViaPage } from '@detector/lib/youtube/innertube';
import { loadSettings, bump } from './settings';
import { effectiveMode } from './gate';
import { burstsOf } from '@detector/lib/sponsor/check';
import { verdictOf, markFrom, type Mark } from './verdict';
import { askIndex, sendFinding, INDEX_URL } from './sharedList';
import { isLocalCopy, readBuildId } from '@detector/lib/autoUpdate';

export type Ask = { type: 'check'; videoId: string; url: string };
export type Answer = { mark: Mark | null; mode: 'off' | 'ask' | 'skip' };

const done = new Map<string, Answer['mark']>(); // this session's answers, so a video is read once
const sentToday = new Set<string>();

async function check(tabId: number, ask: Ask): Promise<Answer> {
  const s = await loadSettings();
  const mode = effectiveMode(s.mode);
  if (mode === 'off' || (INDEX_URL && !s.agreed)) return { mark: null, mode }; // nothing to agree to until findings can be shared
  if (done.has(ask.videoId)) return { mark: done.get(ask.videoId) ?? null, mode };
  void bump('checked');
  const known = await askIndex(ask.videoId);
  if (known) { done.set(ask.videoId, known); void bump('marked'); return { mark: known, mode }; }
  const page = await readYouTubeTab(tabId, ask.url);
  if (page.kind !== 'video' || page.video.videoId !== ask.videoId) return { mark: null, mode }; // the page was not ready or the person moved on: not remembered, asked again later
  const captions = await transcriptViaPage(tabId, ask.videoId); // YouTube's own captions through the page's own interface: no key, no panel, nothing shown; a refusal just leaves it out
  const v = verdictOf(page, captions);
  const more = burstsOf(v).filter((b) => !b.main && b.end !== null).map((b) => ({ start: b.start, end: b.end! })); // every other burst the reading found
  const mark = v.sponsored ? markFrom(ask.videoId, { ...v, more }, 'page') : null;
  done.set(ask.videoId, mark);
  if (mark) void bump('marked');
  if (INDEX_URL && !sentToday.has(ask.videoId)) {
    sentToday.add(ask.videoId);
    const r = await sendFinding(ask.videoId, page.video.channelId, { ...v, methods: v.votes }, true);
    if (r === 'sent') void bump('shared'); else if (r === 'later') sentToday.delete(ask.videoId);
  }
  return { mark, mode };
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
