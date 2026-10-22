// Needle as a voice in the Sponsor check (maintainer, 2026-10-05: "bundle Needle"). It runs on this computer in a Web Worker
// (public/needle/worker.js; the 35 MB model ships with the extension), costs nothing and sends nothing out.
// Trial (NOTES #269): on 25 texts it named brands the plain rules sometimes miss, but it also invents sponsors, and its own
// confidence is no guide. So it runs alongside the other checks (maintainer: "it should work with them"), its answer must be
// written in the text it read, and the vote is a hint (said "unknown"): it can back another check's brand or name it,
// never judge alone.
// More active (maintainer, 2026-10-05: "automatic and more active than YouTube label", Switch and Click / Soundcore: the
// description line "Buy Space 2 Pro on Official Web: https://soundcore.tech/..." has no ad words, so Needle never ran): it
// now reads every description line near the top that carries a link, and trusts a name when ANY of these holds:
//  - YouTube's paid label is on (an ad is certain, Needle only names it),
//  - the text reads as an ad (the ad signals),
//  - the name is the link's own address in that line (soundcore.tech -> Soundcore).
// A creator's own course / shop or affiliate talk is still refused unless the paid label is on.
import { classifyAd, tidyBrand } from '../sponsor/signals';
import type { Vote } from '../sponsor/check';
import { hasBrandLink } from '../sponsorText';

export type NeedleRead = { brand: string | null; quote: string; ms: number; times?: number } | { state: 'reading' } | { state: 'failed'; why: string };

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

// The main part of every outside address in a text: "https://shop.soundcore.tech/x" -> "soundcore".
function hostNames(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/https?:\/\/([^\s/?#]+)/gi)) {
    const parts = m[1].toLowerCase().replace(/^www\./, '').split('.').filter(Boolean);
    const main = parts.length >= 3 && /^(co|com|org|net|ac)$/.test(parts[parts.length - 2]) ? parts[parts.length - 3] : parts[Math.max(0, parts.length - 2)];
    if (main && main.length >= 4) out.push(main.replace(/[^a-z0-9]/g, ''));
  }
  return out;
}
const hasLink = hasBrandLink; // an outside company's link (not your own channels, shop links or link pages)

// The pieces of text worth showing Needle: description lines near the top that read as an ad or carry a link (never your own
// course or affiliate talk, unless YouTube's paid label is on), and the stretch of transcript where the ad starts.
export function needleCandidates(description: string | null | undefined, lines: { t: number; text: string }[] | null | undefined, startSeconds: number | null | undefined, paid = false): string[] {
  const out: string[] = [];
  for (const line of (description ?? '').split(/\n+/).map((l) => l.trim()).filter(Boolean).slice(0, 8)) {
    const k = classifyAd(line).kind;
    if (k === 'self' && !paid) continue;
    if (k === 'affiliate' && !paid) continue;
    if (k === 'paid' || k === 'maybe' || hasLink(line)) out.push(line.slice(0, 400));
  }
  // A timestamp line that says "Sponsor: Saily eSIM & Travel Privacy" (maintainer, 2026-10-05: "it's in the timestamp in the
  // description, it appeared twice"): lines further down that name a sponsor, without the time and bullets in front.
  for (const line of (description ?? '').split(/\n+/).slice(8, 120)) {
    const clean = line.replace(/^[\s*•\-–]*\d{1,2}:\d{2}(?::\d{2})?[\s*•\-–:]*/, '').trim();
    if (clean && /\b(sponsor|sponsored|partner(?:ed)?|paid promotion)\b/i.test(clean) && !out.includes(clean)) out.push(clean.slice(0, 300));
  }
  if (lines?.length && startSeconds != null) {
    const near = lines.filter((l) => l.t >= startSeconds - 3 && l.t <= startSeconds + 25).map((l) => l.text).join(' ');
    const k = classifyAd(near).kind;
    if (near && (k === 'paid' || k === 'maybe' || paid)) out.push(near.slice(0, 600));
  }
  return out.slice(0, 5);
}

// A small model garbles names ("Saily" came back as "Sdaily eSIM & Travel Privacy", NOTES #280 trial): take its first word and
// put back the word really written in the text that is one or two letters away from it.
const edits = (a: string, b: string) => {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
};
export function repairName(raw: string, text: string): string {
  if (raw.trim().split(/\s+/).length <= 3 && norm(text).includes(norm(raw))) return raw;
  const first = raw.trim().split(/\s+/)[0].replace(/[^A-Za-z0-9]/g, '');
  if (first.length < 4) return raw;
  const want = first.toLowerCase();
  const words = [...new Set(text.split(/[^A-Za-z0-9]+/).filter((w) => w.length >= 4))];
  const hit = words.find((w) => w.toLowerCase() === want) ?? words.find((w) => w[0].toLowerCase() === want[0] && Math.abs(w.length - want.length) <= 1 && edits(w.toLowerCase(), want) <= (want.length <= 5 ? 1 : 2));
  return hit ?? raw;
}

// The company a text links to ("https://saily.com/x" -> "Saily"), when nothing else names it.
export const linkedCompany = (text: string): string | null => { const h = hostNames(text)[0]; return h ? h.charAt(0).toUpperCase() + h.slice(1) : null; };

// Needle's answer, accepted only if it is a clean company name that is really written in the text AND one of the three
// reasons above holds.
export function acceptNeedle(raw: string | null | undefined, text: string, paid = false): string | null {
  const b = tidyBrand(raw ? repairName(raw, text) : raw, text);
  if (!b || !norm(text).includes(norm(b))) return null;
  const k = classifyAd(text, b).kind;
  if (k === 'self' || (k === 'affiliate' && !paid)) return null;
  const nb = norm(b);
  const hosts = hostNames(text);
  const linked = hosts.some((h) => nb.length >= 4 && (h.includes(nb) || nb.includes(h)));
  // The ad is certain (paid label) but Needle named a PRODUCT ("Space 2 Pro" from "Buy Space 2 Pro on Official Web:
  // https://soundcore.tech/...", maintainer's screenshot): the company is the one whose link it is.
  if (paid && !linked && k !== 'paid' && hosts.length) return hosts[0].charAt(0).toUpperCase() + hosts[0].slice(1);
  return paid || k === 'paid' || k === 'maybe' || linked ? b : null;
}

export function byNeedle(r: NeedleRead | null | undefined): Vote {
  if (!r) return { method: 'needle', said: 'unknown', score: 0, proof: 'Runs on this computer alongside the other checks' };
  if ('state' in r) return { method: 'needle', said: 'unknown', score: 0, proof: r.state === 'reading' ? 'Reading on this computer…' : r.why };
  if (!r.brand) return { method: 'needle', said: 'unknown', score: 0, proof: 'Found no brand in the ad lines', ms: r.ms };
  return { method: 'needle', said: 'unknown', brand: r.brand, score: 0.5, proof: 'Named from “' + (r.quote.length > 160 ? r.quote.slice(0, 157) + '…' : r.quote) + '”' + (r.times ? ' · named ' + r.times + '× in the description' : ''), ms: r.ms };
}

// ---- The worker (one per panel) --------------------------------------------------------------------------------------
let worker: Worker | null = null;
let seq = 0;
const waiting = new Map<number, (m: { brand?: string | null; ms?: number; error?: string }) => void>();

function ask(text: string, timeoutMs: number): Promise<{ brand?: string | null; ms?: number; error?: string }> {
  if (!worker) {
    worker = new Worker(chrome.runtime.getURL('needle/worker.js'));
    worker.onmessage = (e) => { const f = waiting.get(e.data.id); if (f) { waiting.delete(e.data.id); f(e.data); } };
    worker.onerror = (e) => { for (const [id, f] of waiting) { waiting.delete(id); f({ error: e.message || 'Snap stopped.' }); } worker?.terminate(); worker = null; };
  }
  const id = ++seq;
  return new Promise((resolve) => {
    const t = setTimeout(() => { waiting.delete(id); worker?.terminate(); worker = null; resolve({ error: 'Snap took too long.' }); }, timeoutMs); // the worker may be stuck: the next call starts a fresh one
    waiting.set(id, (m) => { clearTimeout(t); resolve(m); });
    worker!.postMessage({ id, text });
  });
}

// The first accepted brand from the candidates, or null. The first run also loads the model (a few seconds).
export async function readWithNeedle(candidates: string[], paid = false, all = ''): Promise<NeedleRead> {
  let ms = 0;
  for (const text of candidates) {
    const r = await ask(text, 45000);
    if (r.error) return { state: 'failed', why: r.error };
    ms += r.ms ?? 0;
    // Needle found nothing in a line that links to a company and reads as an ad (or the paid label is on): that company.
    const brand = acceptNeedle(r.brand, text, paid) ?? (classifyAd(text).kind === 'paid' || classifyAd(text).kind === 'maybe' || paid ? linkedCompany(text) : null);
    if (brand) {
      const times = all ? (norm(all).split(norm(brand)).length - 1) : undefined;
      return { brand, quote: text, ms, ...(times && times > 1 ? { times } : {}) };
    }
  }
  return { brand: null, quote: '', ms };
}
