// The channel's own link for the sponsor (maintainer, 2026-11-02: "the sponsor's own link from the description, opened in a new tab, shown only if a link was found (the channel's discount code to be precise)").
// Read from the video's description: the web address on the sponsor's line, the one that carries the channel's code or affiliate tag. Nothing is fetched and nothing is guessed: if no address in the
// description belongs to the sponsor, there is no link and no button. Only plain web addresses (http or https) are ever returned, never one that points back at YouTube.
const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const DEAL = /\b(code|coupon|discount|% ?off|off with|link|get|try|deal|save|sale|offer|free|sign ?up)\b/i;
const URL_RE = /https?:\/\/[^\s<>"')\]]+/gi;
const YT = /(^|\.)(youtube\.com|youtu\.be)$/i;

const clean = (u: string) => u.replace(/[.,;:!?…]+$/g, '');

export function offerLink(description: string | null | undefined, brand: string | null | undefined, site?: string | null): string | null {
  if (!description) return null;
  const b = squash(brand ?? '');
  const sh = squash((site ?? '').replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0]);
  if (b.length < 4 && !sh) return null;
  let best: { url: string; score: number } | null = null;
  const lines = description.split(/\r?\n/).slice(0, 60);
  for (const line of lines) {
    const urls = line.match(URL_RE);
    if (!urls) continue;
    for (const raw of urls) {
      const url = clean(raw);
      let u: URL;
      try { u = new URL(url); } catch { continue; }
      if (u.protocol !== 'https:' && u.protocol !== 'http:') continue;
      if (YT.test(u.hostname)) continue;
      const where = squash(u.hostname + u.pathname);
      let score = 0;
      if (b.length >= 4 && where.includes(b)) score += 3; // the sponsor's name is in the address (agent.abacus.ai, protonvpn.com/dylanpage)
      if (sh && squash(u.hostname).includes(sh)) score += 3; // or the address is the sponsor's own site
      if (b.length >= 4 && squash(line).includes(b)) score += 2; // the sponsor's name is on the same line (a short link such as bit.ly/xyz)
      if (DEAL.test(line)) score += 1;
      if (score >= 3 && (!best || score > best.score)) best = { url, score };
    }
  }
  return best ? best.url : null;
}

/**
 * What to offer when the video has ended (maintainer, 2026-11-02): only to a person who pressed "Support me", only when the description gave the sponsor's own link, only for the video that was marked, and only a plain web address.
 * Returns what the button says and where it goes, or null for no button.
 */
export function endOffer(supported: boolean, mark: { videoId: string; brand?: string | null; link?: string } | null, currentVideoId: string | null): { url: string; name: string } | null {
  if (!supported || !mark?.link || !currentVideoId || mark.videoId !== currentVideoId) return null;
  let u: URL;
  try { u = new URL(mark.link); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  return { url: u.href, name: mark.brand && mark.brand !== 'Sponsor' ? mark.brand : 'the offer' };
}
