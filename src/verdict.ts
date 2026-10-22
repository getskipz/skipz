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

/** What Skipz shows on the player: a brand and a time range, only when it is sure enough to point at one. */
export type Burst = { start: number; end: number };
export type Mark = { videoId: string; brand: string; start: number; end: number; confidence: number; from: 'index' | 'page' | 'heard'; live?: boolean; more?: Burst[] }; // start/end: the main burst; more: the others (a short plug up front, say)
/** Every burst of a mark, the main one first. */
export const burstsOfMark = (m: Mark): Burst[] => [{ start: m.start, end: m.end }, ...(m.more ?? [])];
export const SURE = 0.7; // under this, nothing is marked: a wrong mark is worse than a missed one
// Padding on what Skipz read from the page (2026-10-22, measured on 60 finds that SponsorBlock's crowd also marked, used only as a yardstick): the reading starts at the sentence that cues the ad, which runs a little
// behind the real start, and ends a little before the real end. Two seconds earlier on the start and three later on the end raised "end within 3 seconds" from 51 to 65 percent and "start within 3 seconds" from 40 to 47 percent.
export const START_LEAD = 2;
export const END_TAIL = 3;
const pad = (b: Burst): Burst => ({ start: Math.max(0, b.start - START_LEAD), end: b.end + END_TAIL });
export function markFrom(videoId: string, x: { brand: string | null; start: number | null; end: number | null; confidence: number; more?: Burst[] }, from: Mark['from']): Mark | null {
  if (!x.brand || x.start === null || x.end === null) return null;
  if (x.confidence < SURE || x.end - x.start < 5 || x.end - x.start > 900) return null;
  const more = (x.more ?? []).filter((b) => b.end - b.start >= 2 && b.end - b.start <= 900).slice(0, 4); // a short plug can be only a few seconds
  const padded = from === 'page'; // a mark from the Index already carries its own times
  const main = padded ? pad({ start: x.start, end: x.end }) : { start: x.start, end: x.end };
  const others = padded ? more.map(pad) : more;
  return { videoId, brand: x.brand, start: main.start, end: main.end, confidence: x.confidence, from, ...(others.length ? { more: others } : {}) };
}
