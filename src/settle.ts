// An answer, once made, does not change its mind (maintainer, 2026-11-04: "the skipz marker was in the right place then abandoned its true mark and went for a false positive"; "the fix should be an answer that does not change its mind once it's made up").
// Every later look at the same video (the retry, the second caption track, a repeat check) used to REPLACE the mark that was already drawn. Now the first mark stands: a later look can only make it surer (and name the brand),
// never move it, remove it, or swap it for a stretch somewhere else. A stretch heard live is the one exception, because the listening has not finished: the page's answer comes in and the heard stretch stays beside it.
import type { Burst, Mark } from './verdict';
// The page script (content.ts) cannot import a file the worker also uses, so it carries a copy of everything between these two markers; settle.test.ts fails if the two copies differ.
// settle:begin
const spans = (m: Mark): Burst[] => [{ start: m.start, end: m.end }, ...(m.more ?? [])];

const overlaps = (a: Burst, b: Burst): boolean => a.start <= b.end && a.end >= b.start; // the same ad only when the stretches really overlap (as crowd.ts judges it): one that ends 2 seconds before the other begins is a different place

export function settle(prev: Mark | null | undefined, next: Mark | null | undefined): Mark | null {
  if (!prev) return next ?? null;
  if (!next || next === prev) return prev;
  if (prev.videoId !== next.videoId) return next;
  if (prev.from === 'heard') {
    const mine = spans(next);
    const apart = spans(prev).filter((b) => !mine.some((o) => overlaps(o, b)));
    if (!apart.length) return next;
    const more = [...(next.more ?? []), ...apart].sort((a, b) => a.start - b.start).slice(0, 4);
    return { ...next, more };
  }
  const agrees = spans(next).some((b) => spans(prev).some((p) => overlaps(p, b)));
  if (!agrees) return prev;
  const brand = prev.brand === 'Sponsor' && next.brand !== 'Sponsor' ? next.brand : prev.brand;
  const confidence = Math.max(prev.confidence, next.confidence);
  return brand === prev.brand && confidence === prev.confidence ? prev : { ...prev, brand, confidence };
}
// settle:end
