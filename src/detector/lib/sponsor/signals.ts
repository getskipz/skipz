// Ad signals (maintainer, 2026-10-05: classifiers "to improve Needle and Whistle ... implement them in Skipz when trying to
// figure out if there's a sponsor in the video"). Plain phrase lists, no AI: cheap computation first. Each group is its
// own signal; the creator's own promotion ("my course") is its own classifier, affiliate talk is kept apart from
// sponsors, and a brand named with no signal near it is a tracked negative case. Works on any text: a transcript
// window (YouTube's captions now, Whistle's speech-to-text later), a description line, or what Needle pulls out.
// A clue with its proof, never a verdict: the Sponsor check still combines it with the other methods.
export type Signal = 'sponsor' | 'partnership' | 'adMarker' | 'transition' | 'promo' | 'code' | 'cta' | 'affiliate' | 'self';
export type SignalHit = { signal: Signal; phrase: string };

export const SIGNAL_NAME: Record<Signal, string> = {
  sponsor: 'Sponsorship phrase', partnership: 'Paid partnership', adMarker: 'Ad marker', transition: 'Ad transition',
  promo: 'Product promotion', code: 'Discount or promo code', cta: 'Call to action', affiliate: 'Affiliate signal', self: "Creator's own promotion",
};

// Captions drop apostrophes ("ive been using", "lets take a quick break"), so they are optional everywhere.
const RULES: Record<Signal, RegExp> = {
  sponsor: /\b(?:(?:this (?:video|episode|show|podcast|one) )?(?:is|was) (?:sponsored|brought to you) by|(?:sponsored|brought to you) by(?! (?:the|a|an|some|other|another) (?:company|companies|brands?|people|person|folks|guys)\b)|thanks? (?:you )?to [\w .&'-]{2,40}? for (?:sponsoring|supporting)|(?:today|this (?:week|episode|video))'?s sponsor|(?:our|the) sponsors?\b)/i,
  partnership: /\b(?:paid (?:partnership|promotion|collab(?:oration)?)|(?:in )?partnership with|partnered with|includes paid promotion|collab with|(?:made|created|produced|done|filmed) in collab(?:oration)? with)\b/i,
  adMarker: /\b(?:this is (?:an? )?(?:ad|advert|advertisement|sponsored (?:segment|post|content))|(?:promotional|sponsored|paid) content|advertisement)\b|(?:^|\s)#(?:ad|sponsored|paidpartnership)\b/i,
  transition: /\b(?:before we (?:continue|go on|get back)|let'?s take a (?:quick |short |brief )?break|(?:a |the )?quick (?:break|word from)|but first,? a (?:quick )?word|short break)\b/i,
  promo: /\b(?:i'?ve|i have|we'?ve|we have) (?:been )?(?:using|loving)\b|\b(?:i )?(?:wanted|want) to (?:tell|share|show) you about\b|\blet me tell you about\b|\byou (?:need|should|have|must|gotta|ought) to (?:get|try|grab|download|check out|sign up for) (?!(?:a|an|the|some|your|my|more|enough|to|it|this|that|them|these|those|one|out|rid|back|up|ready|used)\b)\w/i,
  code: /\b(?:use|with|enter|apply) (?:my |the |our )?(?:promo |discount |coupon )?code\b|\b(?:promo|discount|coupon) code\b|\b\d{1,3} ?(?:%|percent) off\b|\bsave \d{1,3} ?(?:%|percent)(?![a-z])|\bget \$\d+\b|\btry (?:it |them )?(?:for )?free\b|\bfree trial\b|\b(?:in|of) (?:free )?credits\b|\bcoupon\b/i,
  cta: /\b(?:click (?:the |on the )?link|link (?:is )?(?:down )?(?:below|in (?:the )?(?:description|bio))|(?:sign up|signup|sign-up) (?:using|with|at|today|through)|use my link|(?:head|go) (?:over )?to [\w.]+ ?(?:dot )?(?:com|ai|io|co|app)|head over to)\b/i,
  affiliate: /\baffiliate\b|\bamazon associates?\b|\bqualifying purchases\b|\b(?:i|we) (?:may |will |might )?(?:earn|get|receive|make) (?:a |an )?(?:small )?(?:affiliate )?commission\b|\bcommission (?:from|if)\b/i,
  self: /\b(?:my|our) (?:own )?(?:course|courses|product|products|book|ebook|newsletter|merch|membership|community|app|template|templates|program|coaching|masterclass|workshop|cohort|shop|store)\b|\bjoin my\b/i,
};

const curly = (s: string) => s.replace(/[’‘]/g, "'");

// Every group that appears in the text, once each, with the words it went by.
export function signalsIn(text: string): SignalHit[] {
  const t = curly(text);
  const out: SignalHit[] = [];
  for (const [signal, re] of Object.entries(RULES) as [Signal, RegExp][]) {
    const m = re.exec(t);
    if (m) out.push({ signal, phrase: m[0].trim() });
  }
  return out;
}

export type AdRead = {
  kind: 'paid' | 'maybe' | 'affiliate' | 'self' | 'none';
  strength: number; // 0..1, how sure this text is a paid ad read
  hits: SignalHit[];
  mentioned: boolean; // the brand asked about is named in the text
  why: string;
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

export function classifyAd(text: string, brand?: string | null): AdRead {
  const hits = signalsIn(text);
  const has = (...s: Signal[]) => s.some((x) => hits.some((h) => h.signal === x));
  const mentioned = !!brand && norm(brand).length > 2 && norm(text).includes(norm(brand));
  const by = hits.map((h) => '“' + h.phrase + '”').join(', ');
  const done = (kind: AdRead['kind'], strength: number, why: string): AdRead => ({ kind, strength, hits, mentioned, why });
  // A sponsor line, a paid partnership or an ad marker is a paid read, whatever else is said.
  if (has('sponsor', 'partnership', 'adMarker')) return done('paid', has('sponsor') ? 0.9 : 0.85, 'Says it is paid: ' + by);
  // Not a sponsor: the creator earns a commission, or sells their own thing (the code and link are theirs).
  if (has('affiliate')) return done('affiliate', 0.7, 'Affiliate talk, not a sponsor: ' + by);
  if (has('self')) return done('self', 0.7, 'The creator promotes their own thing: ' + by);
  if (has('code') && has('cta', 'promo', 'transition')) return done('paid', 0.7, 'A deal code with a sales line: ' + by);
  if (has('transition') && has('promo', 'cta')) return done('paid', 0.6, 'A break cue, then product talk: ' + by);
  if (has('promo') && has('cta')) return done('paid', 0.5, 'Product talk with a call to action: ' + by);
  if (hits.length) return done('maybe', 0.3, 'Only a weak sign: ' + by);
  return done('none', 0, mentioned ? 'The brand is named, but nothing says anyone paid' : 'No ad signs');
}

// A brand name from a small model comes back messy: "Wispr Flow!", "Brilliant.org/veritasium", a promo code ("SKIPZ"),
// a whole sentence, a link. Cleaned here, or dropped when it is not a company name (Needle trial, 2026-10-05).
export function tidyBrand(raw: string | null | undefined, text = ''): string | null {
  let b = (raw ?? '').trim().replace(/^[“"'(]+|[“"'.,:;!?)]+$/g, '');
  if (!b || /^https?:\/\//i.test(b)) return null;
  const dom = /^([a-z0-9-]{3,})\.(?:com|org|net|io|ai|co|app|so|link|tv)\b/i.exec(b);
  if (dom) b = dom[1].charAt(0).toUpperCase() + dom[1].slice(1);
  if (b.split(/\s+/).length > 3 || b.length > 40) return null; // a sentence, not a name
  const code = new RegExp('\\bcode:?\\s+' + b.replace(/[^a-z0-9]/gi, '') + '\\b', 'i');
  if (/^[A-Z0-9]{3,}$/.test(b) && code.test(text.replace(/[^a-z0-9: ]/gi, ' '))) return null; // a promo code, not a brand
  return b;
}
