// What Skipz makes of the words it HEARS (the video's own sound, turned into text on this computer) when a video has no captions it can read.
// The ears (a small speech model, then a second one that gives each word's time) live in ears.ts; this file is the plain rules on top, so they can be tested without any sound.
import { CUE, SELL, nameAfterCue, nameAfterNeed } from '@detector/lib/sponsor/check';

export type Slice = { at: number; secs: number; text: string }; // at: where the video was (seconds) when this slice began
export type Live = { brand: string | null; start: number; end: number; ended: boolean }; // an ad heard while it plays; end grows while it goes on

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
export const mentions = (text: string, brand: string | null | undefined): boolean => !!brand && squash(brand).length > 2 && squash(text).includes(squash(brand));

/** A brand as heard can come out doubled ("Surfshark Surfshark": the speech model drops the comma between a name and the next sentence's first word). */
export const tidyName = (b: string | null): string | null => (b ? b.replace(/\b([\w.&'-]+)(?:\s+\1\b)+/gi, '$1').trim() || null : null);

/** Does this stretch of words start a sponsor read? A cue phrase ("sponsored by X"), or a sales line that also names a brand the page already named. */
export function cueIn(text: string, known: string[]): { brand: string | null } | null {
  const named = known.find((k) => mentions(text, k)) ?? null;
  const brand = tidyName(named ?? nameAfterCue(text) ?? nameAfterNeed(text));
  if (CUE.test(text) || (named && SELL.test(text))) return { brand };
  return null;
}

/** Is it still the ad? Sales words, a cue, or the brand's name. A little silence or music does not end it (see `quiet`). */
export const stillAd = (text: string, brand: string | null): boolean => CUE.test(text) || SELL.test(text) || mentions(text, brand);
export const quiet = (text: string): boolean => text.replace(/[^a-z0-9]/gi, '').length < 12; // nothing, or a stray word or two: no call either way

/** The words of the last `n` slices as one text. */
export const recent = (slices: Slice[], n: number): string => slices.slice(-n).map((s) => s.text).filter(Boolean).join(' ');

export const LEAD = 2; // seconds before the first cue sentence that the mark starts (the cue runs a little behind the real start)
export const TAIL = 2; // seconds after the last ad sentence

/** Where the ad sits, from the slices alone (no word times): from the first slice of the window that holds the cue to the end of the last slice that is still the ad. */
export function liveFromSlices(slices: Slice[], brand: string | null): Live | null {
  let first = -1, last = -1;
  slices.forEach((s, i) => { if (s.text && stillAd(s.text, brand)) { if (first < 0) first = i; last = i; } });
  if (first < 0) return null;
  const a = slices[first], b = slices[last];
  return { brand, start: Math.max(0, a.at - LEAD), end: b.at + b.secs + TAIL, ended: last < slices.length - 2 }; // two slices of ordinary talk after it: the ad has ended
}
