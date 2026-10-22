// Skipz's ears: a page with no window that keeps the listening models open (an "offscreen" page: the browser's way to let an extension run web workers without a tab).
// It hears sound the YouTube tab sends it, turns it into words on this computer, and answers. The sound is never sent anywhere.
//   first ear  : a small speech model (fast, rough words)
//   second ear : a second speech model, asked only once a sponsor read is suspected, that spells the brand right and gives each word's time
//   Needle     : a small model that names a company from a line of text
import { transcribe, pcmFromBase64, hasSound } from '@detector/lib/ai/listen';
import { refineWithWhistle, findHeardAd } from '@detector/lib/ai/whistle';
import { readWithNeedle, type NeedleRead } from '@detector/lib/ai/needle';
import { cueIn, tidyName, stillAd, quiet, recent, liveFromSlices, LEAD, TAIL, type Slice, type Live } from './heard';

export type EarsMsg =
  | { type: 'ears:warm' }
  | { type: 'ears:heard'; videoId: string; b64: string; at: number; secs: number; known: string[] }
  | { type: 'ears:probe'; b64: string; brand: string | null }
  | { type: 'ears:needle'; candidates: string[]; paid: boolean; all: string }
  | { type: 'ears:forget'; videoId: string };
export type HeardReply = { live: Live | null; text: string };
export type ProbeReply = { ad: boolean | null; text: string };

const say = (m: unknown) => { void chrome.runtime.sendMessage(m).catch(() => { /* nobody is showing the progress */ }); };

type Sess = { slices: Slice[]; pcm: { at: number; pcm: Float32Array }[]; live: Live | null; ordinary: number };
const sessions = new Map<string, Sess>();
const sessOf = (tab: number | undefined, videoId: string): Sess => {
  const k = tab + ':' + videoId;
  let s = sessions.get(k);
  if (!s) { s = { slices: [], pcm: [], live: null, ordinary: 0 }; sessions.set(k, s); }
  return s;
};

const concat = (parts: Float32Array[]): Float32Array => { const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };

async function words(b64: string): Promise<{ text: string; pcm: Float32Array; ms: number }> {
  const pcm = pcmFromBase64(b64);
  if (!hasSound(pcm)) return { text: '', pcm, ms: 0 }; // silence is not sent to the model: it only wastes time and a model can invent words from nothing
  const r = await transcribe(pcm.slice());
  return { text: 'error' in r ? '' : r.text.trim(), pcm, ms: 'error' in r ? 0 : r.ms };
}

// Where a moment of the second ear's sound (seconds from the start of what it was given) sits in the video: slices are joined end to end, each knows where the video was.
function videoTime(parts: { at: number; pcm: Float32Array }[], t: number): number {
  let from = 0;
  for (const p of parts) { const len = p.pcm.length / 16000; if (t < from + len) return p.at + (t - from); from += len; }
  const last = parts[parts.length - 1]; return last.at + last.pcm.length / 16000;
}

// The second ear works while the first goes on listening (it takes a few seconds): it only sharpens the ad's start and the brand's spelling, never delays the first answer.
async function sharpen(s: Sess, live: Live, known: string[]): Promise<void> {
  const parts = s.pcm.slice();
  const brands = [...(live.brand ? [live.brand] : []), ...known];
  const r = await refineWithWhistle(concat(parts.map((p) => p.pcm)), brands);
  if ('error' in r || !r.words.length || s.live !== live) return;
  const ad = findHeardAd(r.text, r.words, brands);
  if (!ad) return;
  const start = Math.max(0, videoTime(parts, ad.start) - LEAD);
  if (start >= live.start - 10 && start <= live.start + 6) live.start = start; // a time far from what the first ear heard is not believed
  const spelled = tidyName(ad.brand);
  if (spelled && live.brand && spelled.toLowerCase().replace(/[^a-z0-9]/g, '') === live.brand.toLowerCase().replace(/[^a-z0-9]/g, '')) live.brand = spelled; // the same name, spelled right
}

async function heard(m: Extract<EarsMsg, { type: 'ears:heard' }>, tab: number | undefined): Promise<HeardReply> {
  const s = sessOf(tab, m.videoId);
  const w = await words(m.b64);
  s.slices.push({ at: m.at, secs: m.secs, text: w.text }); if (s.slices.length > 12) s.slices.shift();
  s.pcm.push({ at: m.at, pcm: w.pcm }); if (s.pcm.length > 6) s.pcm.shift();
  if (!s.live) {
    const cue = cueIn(recent(s.slices, 3), m.known);
    if (cue) {
      s.live = liveFromSlices(s.slices.slice(-6), cue.brand) ?? { brand: cue.brand, start: Math.max(0, m.at - LEAD), end: m.at + m.secs + TAIL, ended: false };
      s.ordinary = 0;
      void sharpen(s, s.live, m.known);
    }
  } else if (!s.live.ended) {
    if (stillAd(w.text, s.live.brand)) { s.live.end = m.at + m.secs + TAIL; s.ordinary = 0; }
    else if (!quiet(w.text) && ++s.ordinary >= 2) s.live.ended = true; // two slices of ordinary talk: back to the video
  }
  const out = s.live ? { ...s.live } : null;
  if (s.live?.ended) { s.live = null; s.slices = []; s.pcm = []; } // an ad that has ended is reported once; the next one is looked for from fresh words
  return { live: out, text: w.text };
}

chrome.runtime.onMessage.addListener((msg: EarsMsg, sender, reply) => {
  if (!msg || typeof msg.type !== 'string' || !msg.type.startsWith('ears:')) return false;
  const tab = sender.tab?.id;
  void (async () => {
    try {
      if (msg.type === 'ears:warm') {
        // Loads (and the first time, downloads) both speech models. Progress goes out as ears:progress.
        let a = 0, b = 0; const show = () => say({ type: 'ears:progress', pct: Math.round((a + b) / 2) });
        await Promise.all([
          transcribe(new Float32Array(16000), (p) => { a = p.total ? (p.loaded / p.total) * 100 : a; show(); }),
          refineWithWhistle(new Float32Array(16000), [], { onProgress: (p) => { b = p ?? b; show(); } }),
        ]);
        say({ type: 'ears:progress', pct: 100 });
        reply({ ok: true });
      } else if (msg.type === 'ears:heard') reply(await heard(msg, tab));
      else if (msg.type === 'ears:probe') { const w = await words(msg.b64); reply({ ad: quiet(w.text) ? null : stillAd(w.text, msg.brand), text: w.text } satisfies ProbeReply); }
      else if (msg.type === 'ears:needle') reply((await readWithNeedle(msg.candidates, msg.paid, msg.all)) satisfies NeedleRead);
      else if (msg.type === 'ears:forget') sessions.delete(tab + ':' + msg.videoId);
    } catch (e) { reply({ error: String((e as Error)?.message ?? e) }); }
  })();
  return true; // the answer comes later
});
