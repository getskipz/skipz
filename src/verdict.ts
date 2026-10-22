// The detector, run on the page you opened: YouTube's own label, the description, the chapters.
// What is only SAID in the video comes from YouTube's own captions, read by the quiet route (no panel opened, nothing shown, no key: src/detector/lib/youtube/innertube.ts); if YouTube refuses that route, Skipz
// goes on with the label, the description and the chapters.
import { byLabel, byDescription, byChapters, byTranscript, scrubOwnBrand, combine, type Verdict } from '@detector/lib/sponsor/check';
import { byNeedle, type NeedleRead } from '@detector/lib/ai/needle';
import type { ItTranscript } from '@detector/lib/youtube/innertube';
import type { PageRead } from '@detector/lib/youtube/parse';

type VideoPage = Extract<PageRead, { kind: 'video' }>;

export function verdictOf(page: VideoPage, transcript?: ItTranscript | null, needle?: NeedleRead | null): Verdict {
  const v = page.video;
  const own = [page.channel?.name, page.channel?.handle];
  const paid = !!v.paidPromotion;
  const first = [byLabel(paid), byDescription(v.description, paid, own, v.chapters)];
  // The brands the first checks name (a deal-code brand too) are what the chapters and the transcript look for, as in the sponsor check.
  const brands = [...new Set(first.filter((x) => x.said === 'yes' || (x.method === 'description' && x.brand)).map((x) => x.brand).filter((x): x is string => !!x))];
  const read = !transcript ? null : transcript.state === 'trouble' ? { state: 'timeout' as const, why: transcript.why } : transcript;
  return combine(scrubOwnBrand([...first, byChapters(v.chapters, brands, v.lengthSeconds), byTranscript(read, brands), ...(needle ? [byNeedle(needle)] : [])], own));
}

/**
 * An INTEGRATED sponsor (2026-10-22, YCImaging's iPhone video, "Sponsored By SmallRig"): the creator uses the sponsor's gear through the video and plugs it, with no spoken "sponsored by" read for the detector to find.
 * When the label and description make the sponsor certain but no read was found, the stretches where the creator talks about that brand are the sponsored part:
 * mentions less than GAP seconds apart make one stretch; a stretch needs two mentions, or one that is plainly a plug ("check out ...").
 */
export type Line = { t: number; text: string };
const GAP = 75; // seconds between two mentions that still belong to one stretch
const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const PLUG = /\b(check (?:them |it |this |that |out )?|link|grab|get yours|use code|buy|pick up|head over|go to)\b/i;
export function brandStretches(lines: Line[], brand: string): Burst[] {
  const b = squash(brand);
  if (b.length < 4) return [];
  const at = lines.map((l, i) => (squash(l.text).includes(b) || squash(l.text + ' ' + (lines[i + 1]?.text ?? '')).includes(b) && !squash(lines[i + 1]?.text ?? '').includes(b) ? i : -1)).filter((i) => i >= 0);
  const out: { first: number; last: number; n: number }[] = [];
  for (const i of at) {
    const c = out[out.length - 1];
    if (c && lines[i].t - lines[c.last].t <= GAP) { c.last = i; c.n++; } else out.push({ first: i, last: i, n: 1 });
  }
  const real = out.filter((c) => c.n >= 2 || PLUG.test(lines[c.first].text + ' ' + (lines[c.first + 1]?.text ?? '')));
  return real.map((c) => ({ start: lines[c.first].t, end: (lines[c.last + 1]?.t ?? lines[c.last].t + 5) + 4 }));
}

/** What Skipz shows on the player: a brand and a time range, only when it is sure enough to point at one. */
export type Burst = { start: number; end: number };
export type Mark = { videoId: string; brand: string; start: number; end: number; confidence: number; from: 'index' | 'page' | 'heard'; live?: boolean; more?: Burst[] }; // start/end: the main burst; more: the others (a short plug up front, say)
/** Every burst of a mark, the main one first. */
export const burstsOfMark = (m: Mark): Burst[] => [{ start: m.start, end: m.end }, ...(m.more ?? [])];
export const SURE = 0.7; // under this, nothing is marked: a wrong mark is worse than a missed one
// Padding on what Skipz read from the page (2026-10-22, measured on 60 finds that SponsorBlock's crowd also marked, used only as a yardstick): the reading starts at the sentence that cues the ad, which runs a little
// behind the real start, and ends a little before the real end. Two seconds earlier on the start and three later on the end raised "end within 3 seconds" from 51 to 65 percent and "start within 3 seconds" from 40 to 47 percent.
export const MIN_READ = 30; // seconds: the shortest read Skipz marks when it is sure there is one
export const START_LEAD = 2;
export const END_TAIL = 3;
const pad = (b: Burst): Burst => ({ start: Math.max(0, b.start - START_LEAD), end: b.end + END_TAIL });
export function markFrom(videoId: string, x: { brand: string | null; start: number | null; end: number | null; confidence: number; more?: Burst[] }, from: Mark['from']): Mark | null {
  if (x.start === null || x.end === null) return null; // no brand needed: nothing on screen names it (maintainer, 2026-10-22), so a sure, timed sponsor with no readable name is still marked
  if (x.confidence < SURE || x.end - x.start > 900) return null;
  // A sure sponsor whose read looks short is NOT thrown away (2026-10-22, a real Fireship video: the cue "is <brand>, the sponsor of today's video" at 5:38, then the creator describes the product with no sales line and the captions misspell the name, so the reading closed the read after 2 seconds).
  // A spoken sponsor read lasts a good while: such a read is given MIN_READ seconds. A wrong guess here shows the question or skips a little too much, never the whole video.
  const start = x.start;
  const end = x.end - x.start < MIN_READ && x.confidence >= 0.85 ? x.start + MIN_READ : x.end;
  if (end - start < 5) return null;
  const more = (x.more ?? []).filter((b) => b.end - b.start >= 2 && b.end - b.start <= 900).slice(0, 4); // a short plug can be only a few seconds
  const padded = from === 'page'; // a mark from the Index already carries its own times
  const main = padded ? pad({ start, end }) : { start, end };
  const others = padded ? more.map(pad) : more;
  return { videoId, brand: x.brand ?? 'Sponsor', start: main.start, end: main.end, confidence: x.confidence, from, ...(others.length ? { more: others } : {}) };
}
