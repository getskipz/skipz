// The detector, run on the page you opened: YouTube's own label, the description, the chapters.
// What is only SAID in the video comes from YouTube's own captions, read by the quiet route (no panel opened, nothing shown, no key: src/detector/lib/youtube/innertube.ts); if YouTube refuses that route, Skipz
// goes on with the label, the description and the chapters.
import { byLabel, byDescription, byChapters, byTranscript, scrubOwnBrand, combine, burstsOf, sounds, type Verdict } from '@detector/lib/sponsor/check';
import { probableStretches } from '@detector/lib/sponsor/stretch';
import { byNeedle, type NeedleRead } from '@detector/lib/ai/needle';
import type { ItTranscript } from '@detector/lib/youtube/innertube';
import { textOverlap } from '@detector/lib/youtube/captions';
import type { PageRead } from '@detector/lib/youtube/parse';

type VideoPage = Extract<PageRead, { kind: 'video' }>;

// second: the other caption track the player downloaded (Capture): a vote of its own when it is a genuinely different text and finds an ad read, and the text itself when the first route gave none.
export function verdictOf(page: VideoPage, transcript?: ItTranscript | null, needle?: NeedleRead | null, second?: { t: number; text: string }[] | null): Verdict & { extra: Burst[] } {
  const v = page.video;
  const own = [page.channel?.name, page.channel?.handle];
  const paid = !!v.paidPromotion;
  const first = [byLabel(paid), byDescription(v.description, paid, own, v.chapters)];
  // The brands the first checks name (a deal-code brand too) are what the chapters and the transcript look for, as in the sponsor check.
  const brands = [...new Set(first.filter((x) => x.said === 'yes' || (x.method === 'description' && x.brand)).map((x) => x.brand).filter((x): x is string => !!x))];
  const got = !transcript ? null : transcript.state === 'trouble' ? { state: 'timeout' as const, why: transcript.why } : transcript;
  const read = got?.state !== 'ok' && second?.length ? { state: 'ok' as const, lines: second } : got; // Capture stands in when the first route read nothing
  const other = got?.state === 'ok' && second?.length && textOverlap(second, got.lines) < 0.9 ? byTranscript({ state: 'ok', lines: second }, brands) : null;
  const votes = scrubOwnBrand([...first, byChapters(v.chapters, brands, v.lengthSeconds), byTranscript(read, brands), ...(other && other.said === 'yes' ? [{ ...other, method: 'captions' as const, proof: 'The player’s other caption track: ' + other.proof }] : []), ...(needle ? [byNeedle(needle)] : [])], own, v.title);
  // TWO SPONSORS in one video (2026-10-24, PewDiePie "I Google Myself": the description names Saily, the spoken read is NordVPN's): Skipz's combiner takes a second brand for a RIVAL and cuts the confidence to 51%, so nothing was marked.
  // When the brand the description names is also really spoken about in the video, it is a second sponsor, not a rival: that vote stops naming a brand, and its stretches are marked too.
  const extra: Burst[] = [];
  const spoken = votes.find((x) => x.method === 'transcript' && x.said === 'yes' && x.brand);
  if (spoken && read && read.state === 'ok') {
    for (const d of votes) {
      if ((d.method !== 'description' && d.method !== 'pinned' && d.method !== 'chapters') || !d.brand || squash(d.brand).includes(squash(spoken.brand!)) || squash(spoken.brand!).includes(squash(d.brand))) continue;
      // A second sponsor's read is short and sits beside the main one. A brand talked about for minutes, in a stretch that even holds the main read, is the creator's own project (Allysun's BrowOS video, 2026-11-02:
      // BrowOS stretched 2:30 to 9:53 around the real Abacus AI read at 3:35), not a second sponsor.
      const all = brandStretches(read.lines, d.brand);
      const s = all.filter((b) => b.end - b.start <= SECOND_MAX && !(spoken.start != null && b.start <= spoken.start && spoken.start <= b.end));
      if (all.length) { extra.push(...s); d.brand = null; } // really spoken about: no longer a rival of the spoken sponsor, marked only when it looks like a read
    }
  }
  return { ...combine(votes), extra };
}

/**
 * An INTEGRATED sponsor (2026-10-22, YCImaging's iPhone video, "Sponsored By SmallRig"): the creator uses the sponsor's gear through the video and plugs it, with no spoken "sponsored by" read for the detector to find.
 * When the label and description make the sponsor certain but no read was found, the stretches where the creator talks about that brand are the sponsored part:
 * mentions less than GAP seconds apart make one stretch; a stretch needs two mentions, or one that is plainly a plug ("check out ...").
 */
export type Line = { t: number; text: string };
const SECOND_MAX = 150; // seconds: the longest stretch that can be a second sponsor's read
const GAP = 75; // seconds between two mentions that still belong to one stretch
const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const PLUG = /\b(check (?:them |it |this |that |out )?|link|grab|get yours|use code|buy|pick up|head over|go to)\b/i;
export function brandStretches(lines: Line[], brand: string): Burst[] {
  const b = squash(brand);
  if (b.length < 4) return [];
  const sb = sounds(brand);
  const has = (txt: string) => squash(txt).includes(b) || (sb.length >= 5 && sounds(txt.replace(/\s+/g, '')).includes(sb)); // exact, or how it sounds ("Saily" heard as "Saylite")
  const at = lines.map((l, i) => (has(l.text) || has(l.text + ' ' + (lines[i + 1]?.text ?? '')) && !has(lines[i + 1]?.text ?? '') ? i : -1)).filter((i) => i >= 0);
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
export type Mark = { videoId: string; brand: string; start: number; end: number; confidence: number; from: 'index' | 'page' | 'heard' | 'crowd'; live?: boolean; more?: Burst[]; link?: string }; // start/end: the main burst; more: the others (a short plug up front, say)
/** Every burst of a mark, the main one first. */
// The main burst first, then the others; bursts that overlap (a short plug up front inside the main read) are drawn as one.
export const burstsOfMark = (m: Mark): Burst[] => [{ start: m.start, end: m.end }, ...(m.more ?? [])].reduce<Burst[]>((out, b) => {
  const hit = out.find((o) => b.start <= o.end && b.end >= o.start);
  if (hit) { hit.start = Math.min(hit.start, b.start); hit.end = Math.max(hit.end, b.end); } else out.push({ ...b });
  return out;
}, []);
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
  // Only LONG segments are marked (maintainer, 2026-11-01: "we have 2 markers but the longer one is the real sponsored segment ... stick to the long marked segments"): an extra burst counts only when it is as long as a read (MIN_READ).
  // This replaces the 2026-10-22 rule that kept a plug of a few seconds. A second long read (a mid-roll and an end read, two sponsors) is still marked.
  const more = (x.more ?? []).filter((b) => b.end - b.start >= MIN_READ && b.end - b.start <= 900).slice(0, 4);
  const padded = from === 'page'; // a mark from the Index already carries its own times
  const main = padded ? pad({ start, end }) : { start, end };
  const others = padded ? more.map(pad) : more;
  return { videoId, brand: x.brand ?? 'Sponsor', start: main.start, end: main.end, confidence: x.confidence, from, ...(others.length ? { more: others } : {}) };
}

/**
 * From the combined answer to what Skipz marks: the other bursts the reading found, a second sponsor's stretches, an integrated sponsor's candidate stretch (never marked: a guess), and the mark itself (or none).
 * The worker and the replay tests (src/replay.test.ts) both call this, so a test sees exactly what a viewer would.
 */
export function decide(videoId: string, v: Verdict & { extra: Burst[] }, lines: Line[] | null, description?: string | null): { found: Verdict & { extra: Burst[]; more: Burst[] }; mark: Mark | null; probable?: 'integrated' | 'echo'; candidate?: Burst } {
  const more = [...burstsOf(v).filter((b) => !b.main && b.end !== null).map((b) => ({ start: b.start, end: b.end! })), ...v.extra];
  let found = { ...v, more } as Verdict & { extra: Burst[]; more: Burst[] };
  let probable: 'integrated' | 'echo' | undefined;
  if (v.sponsored && (v.start === null || v.end === null) && v.brand && lines) { // sure there is a sponsor, but no spoken read found: an integrated sponsor
    const s = brandStretches(lines, v.brand).sort((a, b) => (b.end - b.start) - (a.end - a.start));
    // A guessed time is ONE stretch (maintainer, 2026-11-02: "typically a sponsor segment is one part of the video, excessive marks are often bad guesses"): the longest. Only cued reads can add a second marker.
    if (s.length) { found = { ...v, start: s[0].start, end: s[0].end, more: [...v.extra].sort((a, b) => a.start - b.start) }; probable = 'integrated'; }
  }
  // Still no time (maintainer, 2026-11-01: "Skipz has to always mark if it detects sponsors"): the sponsor is certain (label or description) but no cue and no brand name placed the read. The stretch that says the words of the
  // description's offer, else the stretch with the most selling lines, is marked as the best guess. It is only reached for a video already known to be sponsored, so it can never make an ordinary video look sponsored.
  if (v.sponsored && (found.start === null || found.end === null) && lines) {
    const p = probableStretches(lines, description).sort((a, b) => (b.end - b.start) - (a.end - a.start)); // the longest first
    if (p.length) {
      found = { ...found, start: p[0].start, end: p[0].end, confidence: Math.max(found.confidence, SURE), more: [...found.more].sort((a, b) => a.start - b.start) };
      probable = p[0].how;
    }
  }
  // A GUESSED time is never marked (maintainer, 2026-11-02: "stop marking guessed times", "stop guessing, use truth"). A time is CONFIRMED when the video itself shows an ad there: a spoken cue, a chapter named for the brand, a
  // finding from the shared list, the listening. It is a GUESS when it was inferred from where the creator talks about the brand (integrated) or repeats the description's words (echo). A guess is kept as a CANDIDATE only: the worker
  // saves the video as a miss, and a later check (listening, YouTube's own Ask) may confirm it. The sponsor is still reported (brand, confidence); only the time is withheld.
  if (probable) return { found, mark: null, probable, candidate: { start: found.start!, end: found.end! } };
  return { found, mark: v.sponsored ? markFrom(videoId, found, 'page') : null };
}
