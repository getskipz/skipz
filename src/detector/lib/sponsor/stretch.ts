// The probable stretch (maintainer, 2026-11-01, Salem Techsperts / War Thunder: "it knows there's a sponsor here but couldn't mark it ... Skipz has to always mark if it detects sponsors"; then "no guesses, just certainty": echo only).
// Used when YouTube's label or the description make a sponsor certain but the spoken read was not placed by a cue or a brand name. The stretch of the video that says the words of the description's OWN offer
// ("massive bonus pack", "vehicles", "consoles") is the read: the creator repeats the offer in it. A guess from selling language alone (a link, "limited time") was built and switched off on the maintainer's word.
// The caller marks it only because a sponsor is already certain; it never makes an unsponsored video look sponsored.

import { SELL } from './check';

export type Line = { t: number; text: string };
export type Stretch = { start: number; end: number; how: 'echo' };

const STOP = new Set(('about after again also always another because been before being below between both came click comment could description does done down during each even ever every first from gave get give going good great have here into just know like link links look made make many more most much never next only other over please really right same should show some something still such take than that their them then there these they thing things this those through today under until upon using very video videos want watch were what when where which while will with without would your youtube channel instagram twitter patreon subscribe follow business email free play now').split(' '));
const stems = (s: string): string[] => s.toLowerCase().replace(/https?:\/\/\S+/g, ' ').replace(/[^a-z0-9]+/g, ' ').split(' ').filter((w) => w.length >= 4 && !STOP.has(w)).map((w) => w.slice(0, 6));

const WINDOW = 50; // seconds one stretch is searched in
const SELL_NEAR = 8; // seconds either side of a stretch where a selling line still counts
const TAIL = 6; // seconds after the last matching line that still belong to the read

/** The distinct words of the description's own offer: its first three lines, links removed, common words and words the whole transcript says all the time removed. */
function offerStems(lines: Line[], description: string): Set<string> {
  const first = description.split(/\n+/).map((l) => l.trim()).filter(Boolean).slice(0, 3).join(' ');
  const all = new Set(stems(first));
  const freq = new Map<string, number>();
  for (const l of lines) for (const w of new Set(stems(l.text))) freq.set(w, (freq.get(w) ?? 0) + 1);
  const common = Math.max(6, lines.length * 0.06); // a word said in more than about 6 percent of the lines is the video's own talk, not the offer
  return new Set([...all].filter((w) => (freq.get(w) ?? 0) <= common));
}

/** Greedy: the best window first, then the best that does not overlap it, up to `max`. */
function pick(lines: Line[], score: (i: number, j: number) => number, need: number, hot: (i: number) => boolean, max = 4): { start: number; end: number }[] {
  const taken: { a: number; b: number }[] = [];
  const out: { start: number; end: number }[] = [];
  for (let round = 0; round < max; round++) {
    let best = -1, bestScore = 0, bestJ = -1;
    for (let i = 0; i < lines.length; i++) {
      let j = i;
      while (j + 1 < lines.length && lines[j + 1].t - lines[i].t <= WINDOW) j++;
      if (taken.some((x) => i <= x.b && j >= x.a)) continue;
      const sc = score(i, j);
      if (sc > bestScore) { best = i; bestScore = sc; bestJ = j; }
    }
    if (best < 0 || bestScore < need) break;
    // tighten: from the first to the last matching line in the window, plus a short tail
    let a = best, b = bestJ;
    while (a < b && !hot(a)) a++;
    while (b > a && !hot(b)) b--;
    let e = b;
    while (e + 1 < lines.length && lines[e + 1].t - lines[b].t <= TAIL) e++;
    taken.push({ a: best, b: bestJ });
    out.push({ start: lines[a].t, end: (lines[e + 1]?.t ?? lines[e].t + 3) });
  }
  return out.sort((x, y) => x.start - y.start);
}

export function echoStretches(lines: Line[], description: string | null | undefined): { start: number; end: number }[] {
  if (!description || lines.length < 5) return [];
  const K = offerStems(lines, description);
  if (K.size < 4) return []; // too few words of its own: a match would be chance
  const hits = lines.map((l) => stems(l.text).filter((w) => K.has(w)));
  const need = Math.min(5, Math.max(4, Math.ceil(K.size * 0.4)));
  const found = pick(lines, (i, j) => { const seen = new Set<string>(); for (let k = i; k <= j; k++) for (const w of hits[k]) seen.add(w); return seen.size; }, need, (i) => hits[i].length > 0);
  // A review of the sponsor's own product repeats the description's product words all video long (maintainer, 2026-11-01, mhGri6rcYmc: four marked stretches of product talk). A stretch is an ad moment only when it also SELLS:
  // a code, a discount, a link in the description, inside it or a few seconds either side.
  const sells = (s: { start: number; end: number }) => lines.some((l) => l.t >= s.start - SELL_NEAR && l.t <= s.end + SELL_NEAR && SELL.test(l.text));
  return found.filter(sells);
}

export function probableStretches(lines: Line[], description: string | null | undefined): Stretch[] {
  return echoStretches(lines, description).map((s) => ({ ...s, how: 'echo' as const }));
}
