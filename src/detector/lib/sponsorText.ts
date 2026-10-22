// Naming the sponsor from the video's own description, without AI (maintainer, 2026-09-29: "Sponsor Image 4": Fireship's
// card said "includes paid promotion" while line 1 of the description read "CodeRabbit Triage ... Try it free:
// https://coderabbit.link/fireship-014"). Only the first lines count: that is where creators put the paid read.
// A clue, not proof: the card shows the line it came from.
// how: 'said' (the creator says who sponsored), 'code' (a brand link with the creator's own code: a deal, label or not;
// maintainer, 2026-09-30, Aba N Preach's "use code ABAANDPREACH" Surfshark line had no label and was missed), 'link'.
// site: the brand's web address from that line ("surfshark.com"), when it has one (maintainer, 2026-10-01: "Website link
// should be there somewhere").
// The version of Skipz's sponsor rules (this file, description chapters, label-only naming). Raise it whenever they
// change: every channel built with an older version rebuilds once the next time it is opened (maintainer, 2026-10-02:
// "Yes for rules"), so a fix reaches channels built before it. 1 = Oct 2 (capital "Sponsored by", sites stop at "?",
// affiliate middlemen, label-only names, ad times from chapters).
export const SPONSOR_RULES = 6; // 6 = Oct 14 (an app name inside quotation marks and a link typed without https are read: an app ad line, The Orthodox Muslim 2.0); 5 = Oct 10 (a demo / "get your ... today" / start-free line with an outside link is an ad line; the brand is taken from the written word when it starts the address's name); 4 = Oct 9 (door detection: each sponsored line's link is read for a network, referral tag, program page or code); 3 = Oct 5 (ad signals: "Paid partnership with X", own-course and affiliate lines are not sponsors)

import { classifyAd } from './sponsor/signals';
import { OWN_HOSTS, CODE, doorOfLine, doorWord } from './door';

export type TextSponsor = { brand: string; line: string; how: 'said' | 'code' | 'link' | 'pointer'; site?: string | null; door?: string | null }; // door: what the link on that line shows (lib/door.ts)

// The words may start a sentence ("Sponsored by Wispr Flow!", HowToMen, maintainer 2026-10-01: missed because only a
// lowercase "sponsored by" matched) or be in capitals; the brand itself must still start with a capital.
const SAID = [
  /\b(?:[Ss]ponsored|SPONSORED)\s+(?:by|BY)\s+([A-Z][\w&'-]*(?:\s+[A-Z][\w&'-]*){0,2})/,
  /\bthanks? (?:you )?to\s+([A-Z][\w&'-]*(?:\s+[A-Z][\w&'-]*){0,2})\s+for\s+(?:sponsoring|supporting|partnering)/i,
  /\b(?:[Ii]n )?(?:[Pp]artnership|PARTNERSHIP)\s+(?:with|WITH)\s+([A-Z][\w&'-]*(?:\s+[A-Z][\w&'-]*){0,2})/,
  /\b(?:[Bb]rought|BROUGHT)\s+(?:to you by|TO YOU BY)\s+([A-Z][\w&'-]*(?:\s+[A-Z][\w&'-]*){0,2})/,
  // "Presented by Zapier: https://zapier.com/" (The Next New Thing, maintainer's screenshot 2026-10-04), "Supported by X".
  /\b(?:[Pp]resented|PRESENTED|[Ss]upported|SUPPORTED|[Mm]ade possible|MADE POSSIBLE)\s+(?:by|BY)\s+([A-Z][\w&'-]*(?:\s+[A-Z][\w&'-]*){0,2})/,
  // "Paid partnership with Ridge" (the ad-signal list, maintainer 2026-10-05).
  /\b(?:[Pp]aid\s+(?:[Pp]artnership|[Pp]romotion)|PAID\s+(?:PARTNERSHIP|PROMOTION))\s+(?:with|WITH|for|FOR|from|FROM)\s+([A-Z][\w&'-]*(?:\s+[A-Z][\w&'-]*){0,2})/,
];
// Words that make a line with a link look like an ad read (not just "my Instagram").
// ("Get $20 in credits": Fireship's real Exa line, 2026-09-29.)
// A personal code at a brand's checkout is a deal, even without YouTube's label (CODE and OWN_HOSTS now live in door.ts, which reads the same lines).
const ADS = /\b(sponsor|try (?:it )?(?:for )?free|free trial|use (?:my )?code|with (?:the |my )?code|promo code|coupon|discount|% off|get \d+%|save \d+ ?%|sign up|download .* free|check out|credits?|(?:free |book a |request a |get (?:your|a) )?demo|start (?:your |a )?free)\b|get \$\d+|save \d+ ?%|get your [\w ]{0,30}\btoday\b|\bdownload (?:the |our |my )?(?:[A-Z][\w&'-]*\s+){1,3}app\b/i;
// Links that are never a paying brand: the creator's own channels, fan support, link pages.
// Whole addresses only: "mux.com" must not match "x.com" (bug found 2026-09-29).
// Click-counting middlemen (affiliate networks, link shorteners): the address names the middleman, not the brand
// (maintainer, 2026-10-01: "I384100 · imp.i384100.net" listed as a sponsor). Skipz doesn't guess the brand behind them.
const REDIRECTS = ['sjv.io', 'pxf.io', 'ojrq.net', '7eer.net', 'shareasale.com', 'awin1.com', 'rebrand.ly', 'dub.sh', 'short.io', 'go2cloud.org', 'partnerstack.com'];
const isRedirect = (h: string) => REDIRECTS.some((d) => h === d || h.endsWith('.' + d)) || /(^|\.)i\d{4,}\.net$/.test(h);
const isOwn = (host: string) => { const h = host.toLowerCase(); return OWN_HOSTS.some((d) => h === d || h.endsWith('.' + d)) || /(^|\.)amazon\./.test(h) || isRedirect(h); };

export function sponsorFromText(description: string | null | undefined): TextSponsor | null {
  if (!description) return null;
  // Quotation marks come out first: DOWNLOAD "JUST PRAY" APP NOW! (The Orthodox Muslim 2.0, maintainer's screenshot 2026-10-14) was missed because the quote hid the app's name.
  const lines = description.split(/\n+/).map((l) => l.trim().replace(/["“”]/g, '')).filter(Boolean).slice(0, 6);
  for (const line of lines) {
    for (const re of SAID) {
      const m = line.match(re);
      if (m) return { brand: tidy(m[1]), line: clip(line), how: 'said', site: siteOf(line), door: doorWord(doorOfLine(line)) };
    }
  }
  for (const [li, line] of lines.entries()) {
    if (!ADS.test(line)) continue;
    // The creator's own course/product and affiliate lines are not a sponsor, even with a deal link on them.
    const kind = classifyAd(line).kind;
    if (kind === 'self' || kind === 'affiliate') continue;
    // The address may sit alone on the next line ("Download the Just Pray App:" then the link).
    // A link typed without "https://" (justprayapp.co/orthodox) counts too, on this line or the next.
    const BARE = /(?:^|\s)((?:[a-z0-9-]+\.)+(?:com|co|io|ai|app|net|org|me|ly|tv|so|xyz|gg|link|shop|store|dev|us|uk))(?:\/\S*)?(?=\s|$)/i;
    const next = lines[li + 1] ?? '';
    const url = line.match(/https?:\/\/([^\s/?#]+)[^\s]*/i) ?? next.match(/^https?:\/\/([^\s/?#]+)[^\s]*/i) ?? line.match(BARE) ?? next.match(BARE);
    if (!url || isOwn(url[1])) continue;
    // The main part of the address: dashboard.exa.ai -> exa, coderabbit.link -> coderabbit, shop.brand.co.uk -> brand.
    const parts = url[1].toLowerCase().split('.').filter(Boolean);
    const main = parts.length >= 3 && /^(co|com|org|net|ac)$/.test(parts[parts.length - 2]) ? parts[parts.length - 3] : parts[Math.max(0, parts.length - 2)];
    const name = main.replace(/[^a-z0-9]/g, '');
    if (name.length < 3) continue;
    // The brand as the creator wrote it ("CodeRabbit"), else the address's name ("Coderabbit").
    // "Download the Just Pray App: <link>": the name is the words before "app", when they are what the address says (justprayapp.co).
    const appName = (line.match(/\bdownload (?:the |our |my )?((?:[A-Z][\w&'-]*\s+){1,3})app\b/i)?.[1] ?? '').trim();
    const appOk = appName && appName.toLowerCase().replace(/[^a-z0-9]/g, '') && name.startsWith(appName.toLowerCase().replace(/[^a-z0-9]/g, '')) ? appName : null;
    const written = appOk ?? line.split(/[^\w&'-]+/).find((w) => { const k = w.toLowerCase().replace(/[^a-z0-9]/g, ''); return /[A-Z]/.test(w) && (k === name || (k.length >= 4 && name.startsWith(k) && name.length - k.length <= 12)); }); // "Keeper" for keepersecurity.com
    const shown = written && /[A-Z]/.test(written) ? written : name.charAt(0).toUpperCase() + name.slice(1);
    const brand = !/[a-z]/.test(shown) && shown.length > 4 ? shown.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()) : shown; // "JUST PRAY" -> "Just Pray"
    return { brand, line: clip(line), how: CODE.test(line) ? 'code' : 'link', site: url[1].toLowerCase().replace(/^www\./, ''), door: doorWord(doorOfLine(line)) };
  }
  return null;
}

// The first outside web address on a line, without "www." (the creator's own channels and link pages are skipped).
function siteOf(line: string): string | null {
  for (const m of line.matchAll(/https?:\/\/([^\s/?#]+)/gi)) if (!isOwn(m[1])) return m[1].toLowerCase().replace(/^www\./, '');
  return null;
}

// With YouTube's paid promotion label on, an ad is certain; the first outside brand link near the top (no ad words
// needed) is then the likely payer (maintainer, 2026-10-01: "Why not add the name of sponsor instead of digging for it").
// own: the channel's name and handle, so the creator's own website is not taken for the sponsor.
export function brandLink(description: string | null | undefined, own: (string | null | undefined)[] = []): TextSponsor | null {
  if (!description) return null;
  const mine = own.filter((x): x is string => !!x).map((x) => x.toLowerCase().replace(/[^a-z0-9]/g, '')).filter((x) => x.length > 2);
  for (const line of description.split(/\n+/).map((l) => l.trim()).filter(Boolean).slice(0, 6)) {
    for (const m of line.matchAll(/https?:\/\/([^\s/?#]+)/gi)) {
      const host = m[1].toLowerCase().replace(/^www\./, '');
      if (isOwn(host)) continue;
      const parts = host.split('.').filter(Boolean);
      const main = (parts.length >= 3 && /^(co|com|org|net|ac)$/.test(parts[parts.length - 2]) ? parts[parts.length - 3] : parts[Math.max(0, parts.length - 2)]).replace(/[^a-z0-9]/g, '');
      if (main.length < 3 || mine.some((w) => w.includes(main) || main.includes(w))) continue;
      // The name as written in the line: the whole address name ("Notion" for notion.so), or a capitalised word it starts
      // with ("Crusoe" for crusoecloud.com, maintainer's screenshot 2026-10-04: the card said "Cruso"/"Crusoecloud").
      const words = line.split(/[^\w&'-]+/);
      const written = words.find((w) => /[A-Z]/.test(w) && w.toLowerCase().replace(/[^a-z0-9]/g, '') === main) ??
        words.find((w) => /^[A-Z]/.test(w) && w.length >= 4 && main.startsWith(w.toLowerCase().replace(/[^a-z0-9]/g, '')));
      return { brand: written && /[A-Z]/.test(written) ? written : main.charAt(0).toUpperCase() + main.slice(1), line: clip(line), how: 'link', site: host, door: doorWord(doorOfLine(line)) };
    }
  }
  return null;
}

const tidy = (s: string) => s.replace(/[.,:;!]+$/, '').trim();
const clip = (s: string) => (s.length > 120 ? s.slice(0, 117) + '…' : s);

// Does this line carry a link to an outside company (not the creator's own channels, shop links or link pages)?
export const hasBrandLink = (line: string): boolean => siteOf(line) !== null;

// A sponsor woven into a news item (maintainer, 2026-10-08, Dylan Page "Russia Plague could be worse than we thought…": the only trace was the line
// "…why I switched to Proton Mail. Sign up free with the link in the pinned comment." in a list of stories; no "sponsored by", no link in the
// description, the chapter "GOOGLE DID WHAT?" does not name the brand). The creator points to a comment for the offer. A CLUE, never proof:
// a creator may simply use a product. It is read anywhere in the description, not only near the top, because news lists put it last.
const POINTER = /\blinks?\b[^.\n]{0,40}\b(?:pinned|first|top)\s+comment\b|\b(?:pinned|first)\s+comment\b|\blinks?\s+(?:is\s+|are\s+)?(?:in|down in)\s+(?:the\s+)?comments?\b/i;
const OFFER = /\b(?:sign\s*up|try|get|claim|join|grab|start|check\s*out|use|free)\b/i;
const NAME_AFTER = /\b(?:switched to|switch to|moved to|moving to|using|use|try|trying|with|from|join|get|grab|sign up (?:for|to|with|at)|check out)\s+([A-Z][\w&'-]*(?:\s+[A-Z][\w&'-]*){0,2})/;
const NOT_A_BRAND = new Set(['I', 'The', 'My', 'Our', 'This', 'That', 'It', 'You', 'We', 'Link', 'Sign', 'Free', 'Here', 'Patreon', 'Google', 'YouTube']);

export type Pointer = TextSponsor & { lineNo: number };
export function pointerFromText(description: string | null | undefined): Pointer | null {
  if (!description) return null;
  const lines = description.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  for (let i = 0; i < Math.min(lines.length, 80); i++) {
    const line = lines[i];
    if (!POINTER.test(line) || !OFFER.test(line)) continue;
    // The first name after a cue that is not a plain word ("Proton Mail" in "switched to Proton Mail. Sign up free ...").
    for (const m of line.matchAll(new RegExp(NAME_AFTER.source, 'g'))) {
      const name = tidy(m[1]);
      if (!NOT_A_BRAND.has(name.split(/\s+/)[0]) && name.length >= 3) return { brand: name, line: clip(line), how: 'pointer', site: null, lineNo: i };
    }
  }
  return null;
}

// The chapter a news item sits in: the item's heading (the line before) shares a word with exactly one chapter title ("GOOGLE PRIVACY POLICY
// UPDATE" and "GOOGLE DID WHAT?"). Where that chapter starts is where the ad plays, to the start of the next one.
const STOP = new Set(['what', 'when', 'where', 'this', 'that', 'with', 'from', 'about', 'update', 'news', 'did', 'does', 'the', 'and', 'for', 'new', 'why', 'how']);
const words = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length >= 4 && !STOP.has(w)));
export function pointerTime(description: string, p: Pointer, chapters: { title: string; startSeconds: number }[]): { at: number; end: number | null } | null {
  if (chapters.length < 2 || p.lineNo < 1) return null;
  const lines = description.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const heading = words(lines[p.lineNo - 1]);
  if (!heading.size) return null;
  const scored = chapters.map((c, i) => ({ i, n: [...words(c.title)].filter((w) => heading.has(w)).length })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n);
  if (!scored.length || (scored[1] && scored[1].n === scored[0].n)) return null;
  const c = chapters[scored[0].i];
  return { at: c.startSeconds, end: chapters[scored[0].i + 1]?.startSeconds ?? null };
}
