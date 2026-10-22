// The two locks (maintainer, 2026-10-13). Both are plain rules written down once, so nobody argues them later.
//
// 1. SKIPPING BY ITSELF stays locked until Skipz's own numbers on videos the maintainer checked by hand are as good (SponsorBlock was retired as the yardstick on 2026-10-14; the figures below still come from the old comparison until a hand-checked scorecard replaces them): starts within 3 seconds on at least 80% of the compared finds,
//    the brand right on at least 85% of the decided ones, and no growth in wrong skips. A wrong skip is worse than a missed one, so until then Skipz marks the segment and asks.
//    Database size and coverage are exempt on purpose (maintainer: Skipz cannot match SponsorBlock's database yet, and does not need to for this lock).
// 2. THE 6-MONTH SEARCH (finding sponsored videos from the last six months in the background) opens when the shared list is online and the person has pressed "I agree"
//    (maintainer: "it comes on when we get our cloudflare"). Until then it never runs.
//
// MEASURED is the latest scorecard (the maintainer's scorecard). After each rescore the numbers here are updated by hand, in one place, with the date.

export const NEEDED = { startWithin3s: 0.8, brandRight: 0.85 } as const;
export type Measured = { startWithin3s: number | null; brandRight: number | null; wrongSkipsGrowing: boolean | null; asOf: string };
export const MEASURED: Measured = { startWithin3s: 0.49, brandRight: 0.77, wrongSkipsGrowing: null, asOf: '2026-10-12' }; // wrong skips: not measured yet, so the lock stays

export type SkipGate = { open: boolean; missing: ('start' | 'brand' | 'wrong')[] };
export function skipGate(m: Measured = MEASURED): SkipGate {
  const missing: SkipGate['missing'] = [];
  if (m.startWithin3s === null || m.startWithin3s < NEEDED.startWithin3s) missing.push('start');
  if (m.brandRight === null || m.brandRight < NEEDED.brandRight) missing.push('brand');
  if (m.wrongSkipsGrowing !== false) missing.push('wrong'); // unknown counts as not safe
  return { open: missing.length === 0, missing };
}

/** The 6-month search itself is not built yet; the popup says so instead of showing "On". Set to true when it exists. */
export const BACKFILL_BUILT = false;
export type BackfillGate = { open: boolean; why: 'off' | 'no-index' | 'not-agreed' | null };
export function backfillGate(a: { indexUrl: string; agreed: string | null; lookBack?: boolean }): BackfillGate {
  if (a.lookBack === false) return { open: false, why: 'off' }; // the person switched it off (it is on by default)
  if (!a.indexUrl) return { open: false, why: 'no-index' };
  if (!a.agreed) return { open: false, why: 'not-agreed' };
  return { open: true, why: null };
}

export type Mode = 'off' | 'ask' | 'skip';
/** The mode that is really used: "skip" falls back to "ask" while the lock is shut, whatever was stored. */
export const effectiveMode = (mode: Mode, m: Measured = MEASURED): Mode => (mode === 'skip' && !skipGate(m).open ? 'ask' : mode);
