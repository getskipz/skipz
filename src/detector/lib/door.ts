// Door detection (Operating Plan, Oct 2026: "Apps Script rules match known affiliate domains, ref params and promo codes"; here the rules live in the extension). A "door" is a sign that a
// brand lets creators in: an affiliate network link, a referral tag on its own link, a link to its program or creators page, or a personal promo code. Plain rules, no AI. A sign on a
// sponsored description is a CLUE that the brand runs a program, never a promise it will answer you; the card shows which sign it was.
// Not built here (needs a per-site permission and the brand's own pages): the email route (15 points in the plan).

/** Whole addresses that are the creator's own channels, fan support, link pages and gear lists, never a brand's program. Shared with sponsorText. */
export const OWN_HOSTS = ['youtube.com', 'youtu.be', 'instagram.com', 'tiktok.com', 'twitter.com', 'x.com', 'facebook.com', 'discord.gg', 'discord.com', 'twitch.tv', 'patreon.com', 'ko-fi.com', 'buymeacoffee.com', 'linktr.ee', 'beacons.ai', 'threads.net', 'linkedin.com', 'reddit.com', 'github.com', 'spotify.com', 'podcasts.apple.com', 'amzn.to',
  // creator tools, not brands: gear lists, link shorteners, the creator's own shops
  'kit.co', 'geni.us', 'bit.ly', 'tinyurl.com', 'linkin.bio', 'stan.store', 'gumroad.com', 'teespring.com', 'creator-spring.com', 'fourthwall.com', 'shopmy.us'];

/** A personal code at a brand's checkout is a deal, even without YouTube's label. Shared with sponsorText. */
export const CODE = /\b(?:use|with|enter|apply)\s+(?:my\s+|the\s+)?(?:promo\s+|discount\s+|coupon\s+)?code:?\s+(?!(?:for|at|and|the|below|here|in|to|on|from)\b)[A-Z0-9]{3,}|\b(?:promo|discount|coupon)\s+code:?\s+(?!(?:for|at|and|the|below|here|in|to|on|from)\b)[A-Z0-9]{3,}/i;

export type DoorKind = 'network' | 'program-page' | 'ref' | 'code';
export type Door = { kind: DoorKind; via: string | null };

const NETWORKS: [RegExp, string][] = [
  [/(^|\.)(sjv\.io|pxf\.io|ojrq\.net|7eer\.net|impact\.com|impactradius\.com)$|(^|\.)i\d{4,}\.net$/, 'Impact'],
  [/(^|\.)shareasale\.com$/, 'ShareASale'],
  [/(^|\.)(awin1\.com|zenaps\.com)$/, 'Awin'],
  [/(^|\.)(anrdoezrs\.net|jdoqocy\.com|tkqlhce\.com|dpbolvw\.net|kqzyfj\.com)$/, 'CJ'],
  [/(^|\.)linksynergy\.com$/, 'Rakuten'],
  [/(^|\.)prf\.hn$/, 'Partnerize'],
  [/(^|\.)partnerstack\.com$/, 'PartnerStack'],
  [/(^|\.)go2cloud\.org$/, 'Tune'],
];
const REF_KEYS = new Set(['ref', 'via', 'aff', 'aff_id', 'affid', 'affiliate', 'affiliate_id', 'a_aid', 'referral', 'referrer', 'fpr', 'tap_a', 'sca_ref', 'partner', 'irclickid', 'rfsn']);
const PROGRAM_PATH = /^\/(affiliates?|partners?|creators?|ambassadors?|influencers?|referrals?|partner-program|creator-program)(?:[/?#]|$)/i;
const RANK: Record<DoorKind, number> = { network: 4, 'program-page': 3, ref: 2, code: 1 };

const isOwnHost = (h: string) => OWN_HOSTS.some((d) => h === d || h.endsWith('.' + d)) || /(^|\.)amazon\./.test(h);

/** What a single description line shows about the brand's door, or null. The strongest sign on the line wins. */
export function doorOfLine(line: string | null | undefined): Door | null {
  if (!line) return null;
  const found: Door[] = [];
  const take = (d: Door) => { found.push(d); };
  for (const m of line.matchAll(/https?:\/\/[^\s)>\]"']+/gi)) {
    let u: URL;
    try { u = new URL(m[0].replace(/[.,;:!]+$/, '')); } catch { continue; }
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    const net = NETWORKS.find(([re]) => re.test(host));
    if (net) { take({ kind: 'network', via: net[1] }); continue; }
    if (isOwnHost(host)) continue;
    const prog = u.pathname.match(PROGRAM_PATH);
    if (prog) take({ kind: 'program-page', via: '/' + prog[1].toLowerCase() });
    const key = [...u.searchParams.keys()].map((k) => k.toLowerCase()).find((k) => REF_KEYS.has(k));
    if (key) take({ kind: 'ref', via: key });
    else if (/^affiliate$/i.test(u.searchParams.get('utm_medium') ?? '')) take({ kind: 'ref', via: 'utm_medium=affiliate' });
  }
  if (!found.length && CODE.test(line)) found.push({ kind: 'code', via: null });
  return found.sort((a, b) => RANK[b.kind] - RANK[a.kind])[0] ?? null;
}

// The word kept in the content table's sponsor_door column: null = never checked, 'none' = a description was read and showed no sign.
export const DOOR_NONE = 'none';
export const doorWord = (d: Door | null): string => (d ? (d.via ? d.kind + ':' + d.via : d.kind) : DOOR_NONE);
export function readDoorWord(w: string | null | undefined): Door | null | undefined {
  if (!w) return undefined; // never checked
  if (w === DOOR_NONE) return null;
  const [kind, ...rest] = w.split(':');
  return (kind in RANK) ? { kind: kind as DoorKind, via: rest.length ? rest.join(':') : null } : undefined;
}

export type DoorSummary = { checked: number; open: number; route: 'program' | 'cold' | 'unknown'; points: 30 | 0 | null; via: string | null; kind: DoorKind | null };
/** A brand's door from the stored words of its videos: how many were checked, how many show a sign, and the strongest sign. 30 points when any video shows one, 0 when videos were read and none did; null points when none was read. */
export function doorSummary(words: (string | null | undefined)[]): DoorSummary {
  const ds = words.map(readDoorWord).filter((d): d is Door | null => d !== undefined);
  const open = ds.filter((d): d is Door => d !== null);
  if (!ds.length) return { checked: 0, open: 0, route: 'unknown', points: null, via: null, kind: null };
  if (!open.length) return { checked: ds.length, open: 0, route: 'cold', points: 0, via: null, kind: null };
  const top = [...open].sort((a, b) => RANK[b.kind] - RANK[a.kind])[0];
  return { checked: ds.length, open: open.length, route: 'program', points: 30, via: top.via, kind: top.kind };
}

const KIND_WORD: Record<DoorKind, string> = { network: 'affiliate network', 'program-page': 'program page', ref: 'referral link', code: 'promo code' };
/** Plain words for the sign: "affiliate network (Impact)". */
export const doorSign = (kind: DoorKind, via: string | null): string => KIND_WORD[kind] + (via && kind !== 'code' ? ' (' + via + ')' : '');

/** The door word for a brand named in a video, read from the description lines that mention the brand (its name or its address); 'none' when a description was read and showed no sign. */
export function doorForBrand(description: string | null | undefined, brand: string, site?: string | null): string | null {
  if (!description) return null;
  const name = brand.toLowerCase();
  const host = (site ?? '').toLowerCase().replace(/^www\./, '');
  const lines = description.split(/\n+/).map((l) => l.trim()).filter((l) => l && (l.toLowerCase().includes(name) || (host && l.toLowerCase().includes(host))));
  const rank = (d: Door | null) => (d ? RANK[d.kind] : 0);
  const best = lines.map(doorOfLine).sort((a, b) => rank(b) - rank(a))[0] ?? null;
  return doorWord(best);
}

/** A brand's door as the word a deal keeps: null when no description was read, 'none' when read with no sign. */
export const summaryWord = (s: DoorSummary): string | null => (s.route === 'unknown' ? null : s.route === 'cold' ? DOOR_NONE : doorWord({ kind: s.kind!, via: s.via }));
