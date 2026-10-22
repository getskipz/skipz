// YouTube's "most replayed" graph (maintainer, 2026-10-12: "add" to the ideas for doing SponsorBlock's job better). Viewers skip ads, so the graph often dips over a sponsor read and rises where
// the video picks up again. Skipz reads the bars from the watch page (no key, nothing fetched) and uses them only as EVIDENCE for the quality of a find, never as a finding on its own.
// UNVERIFIED on real pages: how clean the dip is. The "i" shows what it saw so the maintainer can judge on his own Chrome.
export type ReplayBar = { start: number; len: number; v: number }; // seconds into the video, how long the bar lasts, 0..1 (YouTube's own normalised height)
export type ReplayLook = { state: 'agrees' | 'neutral' | 'none'; note: string };

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const inside = (b: ReplayBar, a: number, z: number) => b.start + b.len > a && b.start < z;

/** Does the graph back a find at [start, end]? "agrees" = a dip over the ad (under 85% of the usual height), or a rise just after it (over 115%). */
export function replayLook(bars: ReplayBar[] | null | undefined, start: number | null, end: number | null): ReplayLook {
  if (!bars || bars.length < 20) return { state: 'none', note: 'No "most replayed" graph on this video' };
  if (start === null) return { state: 'none', note: 'No time to compare with the graph' };
  const stop = end ?? start + 60;
  const during = bars.filter((b) => inside(b, start, stop)).map((b) => b.v);
  const after = bars.filter((b) => inside(b, stop, stop + 30)).map((b) => b.v);
  const rest = bars.filter((b) => !inside(b, start, stop)).map((b) => b.v);
  if (!during.length || !rest.length) return { state: 'none', note: 'The graph does not cover this part' };
  const usual = mean(rest) || 1e-9;
  const dip = mean(during) / usual;
  const rise = after.length ? Math.max(...after) / usual : 0;
  if (dip < 0.85) return { state: 'agrees', note: 'Viewers dip over the ad: ' + Math.round(dip * 100) + '% of the usual replays' };
  if (rise > 1.15) return { state: 'agrees', note: 'Viewers jump back in just after it: ' + Math.round(rise * 100) + '% of the usual replays' };
  return { state: 'neutral', note: 'The graph shows nothing unusual there' };
}
