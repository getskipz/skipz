// The second pair of ears (maintainer, 2026-10-21: "go, build both"): after Skipz Transcribe's fast first pass (Moonshine), Whistle (Cactus Compute, Apache-2.0,
// 16.9 MB) listens to the same sound again WITH the brands Skipz already knows, so a brand is spelled right ("Squarespace", not "Square Space"), and it gives
// each word's start time, so the ad's start and end can be told. On this computer, in a worker; the model is downloaded once from Hugging Face after Skipz asked.
// Trial 2026-10-21 (NOTES #641): the brand list lifted brand spelling from 4 of 6 to 5 of 6; Moonshine alone is faster, so it stays the first pass.
import { CUE, SELL, nameAfterCue, nameAfterNeed } from '../sponsor/check';

export type Word = { word: string; start: number; end: number };
export type Refined = { text: string; words: Word[]; ms: number; loadMs: number } | { error: string };
type Session = { transcribe(audio: Float32Array, o: { language: string; keywords: string[]; wordTimestamps: boolean }): Promise<{ text: string; words?: Word[] }>; close(): Promise<void> };
export type MakeSession = (onProgress: (pct: number | null) => void) => Promise<Session>;

const makeSession: MakeSession = async (onProgress) => {
  const { createWhistle } = await import('cactus-needle/browser'); // loaded only when the second pass really runs
  return (await createWhistle({ onDownloadProgress: (p: { percentage?: number | null }) => onProgress(p.percentage ?? null) })) as unknown as Session;
};

let session: Promise<Session> | null = null;
let onPct: ((pct: number | null) => void) | undefined; // whoever is waiting for the download right now (the warm-up starts it before anyone waits)
export async function closeWhistle(): Promise<void> {
  const s = session; session = null;
  try { await (await s)?.close(); } catch { /* already gone */ }
}

const MAX_KEYWORDS = 100; // Whistle's own limit
/** The brands to listen for: the ones in this video first, then the ones Skipz has seen most; clean names only, no repeats, at most 100. */
export function whistleKeywords(...lists: (string | null | undefined)[][]): string[] {
  const seen = new Set<string>(); const out: string[] = [];
  for (const l of lists) for (const raw of l) {
    const n = (raw ?? '').replace(/\s+/g, ' ').trim();
    if (n.length < 3 || n.length > 40 || /[<>@\\/]|https?:/i.test(n)) continue;
    const k = n.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k); out.push(n);
    if (out.length >= MAX_KEYWORDS) return out;
  }
  return out;
}

/** Starts the second model loading in the background (download and start), so it is ready when the first listen ends (maintainer, 2026-10-22: "yes"). Never throws. */
export function warmWhistle(o: { make?: MakeSession } = {}): void {
  if (session) return;
  const s = (o.make ?? makeSession)((p) => onPct?.(p));
  session = s;
  s.catch(() => { if (session === s) session = null; }); // a failed warm-up is tried again when the second listen asks
}

// Music or noise with no talking comes out as a stray "Thank you." (trial 2026-10-22: chords alone and drums alone both did, at 55 and 96 percent sure, so confidence cannot tell them apart); a short stock phrase is dropped, an ad is never that short.
const FILLER = /^(?:thank you|thanks|thanks for watching|thank you for watching|bye|goodbye|you|okay|ok|so|oh|hmm|yeah)[s.!?,]*$/i;
export const isFiller = (text: string): boolean => FILLER.test(text.trim());
const LIMIT_MS = 40000; // one pass on 30 s of sound should take seconds; if it does not, it is stopped and the first pass stands

/** Listens again with the brand list. Never throws: a failure comes back as `error` and the first pass stands. */
export async function refineWithWhistle(pcm: Float32Array, keywords: string[], o: { onProgress?: (pct: number | null) => void; make?: MakeSession; limitMs?: number } = {}): Promise<Refined> {
  const t0 = Date.now();
  try {
    onPct = o.onProgress;
    if (!session) session = (o.make ?? makeSession)((p) => onPct?.(p));
    const s = await session;
    const loadMs = Date.now() - t0;
    const t1 = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<never>((_, no) => { timer = setTimeout(() => no(new Error('It took too long')), o.limitMs ?? LIMIT_MS); });
    const r = await Promise.race([s.transcribe(pcm.slice(0, 16000 * 30), { language: 'en', keywords: whistleKeywords(keywords), wordTimestamps: true }), late]).finally(() => clearTimeout(timer)); // one pass takes up to 30 s of sound
    const text = String(r.text ?? '').trim();
    return isFiller(text) ? { text: '', words: [], ms: Date.now() - t1, loadMs } : { text, words: r.words ?? [], ms: Date.now() - t1, loadMs };
  } catch (e) {
    void closeWhistle(); // a stuck or broken session is closed so the next listen starts clean
    return { error: String((e as Error)?.message ?? e) };
  }
}

// ---- Where the ad sits in what was heard --------------------------------------------------------------------------------
export type HeardAd = { brand: string | null; start: number; end: number };
const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const mentions = (text: string, brand: string) => squash(brand).length > 2 && squash(text).includes(squash(brand));

/**
 * From the words with their start times: the sentences that cue the ad, sell it, or name the brand, from the first to the last.
 * The brand is a known one heard in the text, else the one named after a cue ("sponsored by X") or a pitch ("you need to get X").
 * Times are seconds from the start of what was heard. Null when nothing in it reads as an ad.
 */
export function findHeardAd(text: string, words: Word[], known: string[]): HeardAd | null {
  if (!words.length) return null;
  const brand = known.find((k) => mentions(text, k)) ?? nameAfterCue(text) ?? nameAfterNeed(text);
  const sentences: { text: string; start: number; end: number }[] = [];
  let cur: Word[] = [];
  const flush = () => { if (cur.length) sentences.push({ text: cur.map((w) => w.word).join(' '), start: cur[0].start, end: cur[cur.length - 1].end }); cur = []; };
  for (const w of words) { cur.push(w); if (/[.!?]$/.test(w.word)) flush(); }
  flush();
  const ad = sentences.filter((s) => CUE.test(s.text) || SELL.test(s.text) || (brand !== null && mentions(s.text, brand)));
  if (!ad.length) return null;
  return { brand, start: ad[0].start, end: ad[ad.length - 1].end };
}
