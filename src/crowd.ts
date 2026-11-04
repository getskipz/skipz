// SponsorBlock's marks, as one more voice in Skipz (maintainer, 2026-11-04: "add SB to Skipz ... I think it ads accuracy"; "Only credit in readme"). SponsorBlock is a free, community-run list of the parts of videos
// viewers marked as sponsored (sponsor.ajay.app); its data is CC BY-NC-SA 4.0, credited in the README. This file belongs to the extension itself: the shared detector code never holds SponsorBlock's address, and what this
// returns is never sent to the shared list. It asks the private way: only the first 4 characters of a scrambled (SHA-256) copy of the video id go out, SponsorBlock answers with every marked video sharing them, and the
// video is picked out here, so SponsorBlock cannot tell which video is being watched. It asks SponsorBlock, not YouTube, so it runs beside the page and caption reads and a slow answer is simply left out.
// A crowd mark counts as CONFIRMED (viewers saw the ad there): it fixes the time where the detector found the same ad, and marks the video where the detector found a sponsor but not where.
import { burstsOfMark, MIN_READ, type Burst, type Mark } from './verdict';

export type Crowd = { start: number; end: number; votes: number; locked: boolean };
const API = 'https://sponsor.ajay.app/api/skipSegments/';
const WAIT_MS = 2500; // the most the check waits for SponsorBlock (a route that needs no request to YouTube, with a time budget)
const KEEP_MS = 600000; // what was asked is kept 10 minutes, so a retry or a second open never asks again

export async function hashPrefix(videoId: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(videoId));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 4);
}

/** This video's marked sponsor parts that viewers did not vote down (locked, or at least one vote up), each 5 to 900 seconds long, in time order. Everything else in the answer is ignored. */
export function pickCrowd(json: unknown, videoId: string): Crowd[] {
  if (!Array.isArray(json)) return [];
  const mine = json.find((x) => x && typeof x === 'object' && (x as { videoID?: unknown }).videoID === videoId) as { segments?: unknown } | undefined;
  const out: Crowd[] = [];
  for (const s of Array.isArray(mine?.segments) ? (mine!.segments as unknown[]) : []) {
    const o = s as { segment?: unknown; category?: unknown; actionType?: unknown; votes?: unknown; locked?: unknown } | null;
    if (!o || typeof o !== 'object' || o.category !== 'sponsor' || (o.actionType !== undefined && o.actionType !== 'skip')) continue;
    const seg = o.segment;
    if (!Array.isArray(seg) || typeof seg[0] !== 'number' || typeof seg[1] !== 'number' || !Number.isFinite(seg[0]) || !Number.isFinite(seg[1])) continue;
    const votes = typeof o.votes === 'number' ? o.votes : 0;
    const locked = o.locked === 1 || o.locked === true;
    const len = seg[1] - seg[0];
    if (len < 5 || len > 900 || seg[0] < 0 || (!locked && votes < 1)) continue;
    out.push({ start: Math.round(seg[0]), end: Math.round(seg[1]), votes, locked });
  }
  return out.sort((a, b) => a.start - b.start);
}

const kept = new Map<string, { at: number; crowd: Crowd[] }>();
/** The crowd's marks for a video, or none. Never throws, never waits longer than WAIT_MS, and a failed or slow answer is not kept (the next try asks again). */
export async function crowdFor(videoId: string, fetchFn: typeof fetch = fetch, now: () => number = Date.now): Promise<Crowd[]> {
  const had = kept.get(videoId);
  if (had && now() - had.at < KEEP_MS) return had.crowd;
  try {
    const url = API + (await hashPrefix(videoId)) + '?categories=' + encodeURIComponent('["sponsor"]') + '&actionTypes=' + encodeURIComponent('["skip"]');
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), WAIT_MS);
    try {
      const res = await fetchFn(url, { headers: { Accept: 'application/json' }, signal: ctl.signal });
      if (res.status === 404) { kept.set(videoId, { at: now(), crowd: [] }); return []; } // nothing marked near this video
      if (!res.ok) return [];
      const crowd = pickCrowd(await res.json(), videoId);
      kept.set(videoId, { at: now(), crowd });
      return crowd;
    } finally { clearTimeout(timer); }
  } catch { return []; }
}

const sure = (c: Crowd): number => (c.locked ? 0.95 : c.votes >= 3 ? 0.9 : 0.8);
const overlaps = (a: Burst, b: Burst): boolean => a.start <= b.end && a.end >= b.start;

/**
 * The mark with the crowd folded in. No crowd: the mark as it was. A crowd part that overlaps a part the detector marked replaces its times (people saw the ad there); a crowd part elsewhere is added when it is as long as a real
 * read (MIN_READ), at most four extra; with no mark at all, the best crowd part becomes the mark (the brand, when the detector knew it, else "Sponsor"). Times are exact, so they are not padded.
 */
export function withCrowd(mark: Mark | null, crowd: Crowd[], brand: string | null, videoId: string): Mark | null {
  if (!crowd.length) return mark;
  const best = [...crowd].sort((a, b) => Number(b.locked) - Number(a.locked) || b.votes - a.votes || (b.end - b.start) - (a.end - a.start))[0];
  const bursts: Burst[] = mark ? burstsOfMark(mark).map((b) => ({ ...b })) : [];
  let fixed = false;
  for (const c of crowd) {
    const hit = bursts.find((b) => overlaps(b, c));
    if (hit) { hit.start = c.start; hit.end = c.end; fixed = true; }
    else if (c === best || c.end - c.start >= MIN_READ) bursts.push({ start: c.start, end: c.end });
  }
  // two parts that now overlap are one
  const merged = bursts.sort((a, b) => a.start - b.start).reduce<Burst[]>((out, b) => { const last = out[out.length - 1]; if (last && overlaps(last, b)) last.end = Math.max(last.end, b.end); else out.push({ ...b }); return out; }, []);
  const main = [...merged].sort((a, b) => (b.end - b.start) - (a.end - a.start))[0];
  const rest = merged.filter((b) => b !== main).sort((a, b) => a.start - b.start).slice(0, 4);
  const confidence = Math.max(mark?.confidence ?? 0, sure(best));
  return { videoId, brand: mark?.brand ?? brand ?? 'Sponsor', start: main.start, end: main.end, confidence, from: mark && !fixed ? mark.from : 'crowd', ...(rest.length ? { more: rest } : {}), ...(mark?.link ? { link: mark.link } : {}) };
}
