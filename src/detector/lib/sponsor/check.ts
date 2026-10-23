// The Sponsor check (maintainer, 2026-09-29: "Each method gives a score, and Skipz combines them into one answer: 'Mux · 94%
// sure · 4 of 5 methods agree'. The slow Gemini watch only runs when the time is missing or the methods disagree";
// "Each will score themselves. it'll be hidden in an 'i' somewhere, we'll know who did what").
// Every method returns a Vote with its own score; the conductor (combine) is plain rules, so it is fast, testable and
// explainable. Needle was tried as the conductor on 2026-09-29 (NOTES #236): it named brands well once an ad line was
// found, but its confidence did not separate right from wrong, so it is a voice here, not the judge.
import { sponsorFromText, brandLink, pointerFromText, pointerTime } from '../sponsorText';
import { classifyAd } from './signals';

export type Method = 'label' | 'description' | 'pinned' | 'chapters' | 'transcript' | 'captions' | 'comments' | 'ai' | 'watch' | 'needle' | 'sponsorblock';
export type Vote = {
  method: Method;
  said: 'yes' | 'no' | 'unknown'; // does this method think a brand paid for the video?
  brand?: string | null;
  start?: number | null; // seconds
  end?: number | null;
  score: number; // the method's own confidence, 0..1
  proof: string; // what it saw, in plain words
  site?: string | null; // the brand's web address, when the method saw one
  ms?: number;
  quote?: string; // viewers' comments: the comment it went by, so the panel can name its writer and open it
  mentions?: number[]; // the transcript: when "sponsor" was said (seconds)
  who?: string; // which AI service read it, when several did ("Use all" in Checks for this video)
  late?: boolean; // the time is a closing line ("head over to…"), not the ad's start: another check's start goes first
  segments?: { start: number; end: number }[]; // the transcript: every ad burst it found (a short mention up front and the main read later are two); start/end above are the main one
};

export const METHOD_NAME: Record<Method, string> = {
  label: "YouTube's label", description: 'Description', pinned: 'Pinned comment', chapters: 'Chapters', transcript: 'Transcript', captions: 'Captions (the player’s own track)', comments: "Viewers' comments (hint)", ai: 'AI read', watch: 'Clinch', needle: 'Snap (on this computer)', sponsorblock: 'SponsorBlock (viewers)',
};

// ---- The methods (pure) -------------------------------------------------------------------------------------------
export function byLabel(paid: boolean): Vote {
  return paid
    ? { method: 'label', said: 'yes', score: 0.95, proof: 'YouTube shows "Includes paid promotion"' }
    : { method: 'label', said: 'unknown', score: 0, proof: 'No paid promotion label (many creators skip it)' };
}

export function byDescription(description: string | null | undefined, paid: boolean, own: (string | null | undefined)[] = [], chapters: { title: string; startSeconds: number }[] = []): Vote {
  const t = sponsorFromText(description);
  if (!t) {
    // The label says there is an ad; the only outside brand link near the top is probably who paid.
    const l = paid ? brandLink(description, own) : null;
    if (l) return { method: 'description', said: 'yes', brand: l.brand, site: l.site, score: 0.6, proof: 'The brand link near the top: “' + l.line + '”' };
    // "…why I switched to Proton Mail. Sign up free with the link in the pinned comment." (a sponsor woven into a news item): a clue that points to a
    // comment. With the label it counts; without, it backs another method (the pinned comment, the transcript) but cannot start an answer.
    const pt = pointerFromText(description);
    if (pt) {
      const when = pointerTime(description!, pt, chapters);
      return { method: 'description', said: paid ? 'yes' : 'unknown', brand: pt.brand, site: null, start: when?.at ?? null, end: when?.end ?? null, score: paid ? 0.6 : 0.35, proof: 'A line that sends you to a pinned comment (' + pt.brand + '), no label: “' + pt.line + '”' };
    }
    return { method: 'description', said: 'unknown', score: 0, proof: 'No sponsor line near the top' };
  }
  // A deal code or link with no YouTube label is an INDICATOR only (maintainer, 2026-10-05: "only if it's mentioned in video, it
  // can serve as indicator"; PureVPN's /aff link): it becomes a sponsor when the video itself mentions the brand (the
  // transcript, a chapter, the AI read) or YouTube's label confirms it.
  if (t.how === 'code' && !paid) return { method: 'description', said: 'unknown', brand: t.brand, site: t.site, score: 0.4, proof: 'A deal code and link (' + t.brand + ') in the description. It counts as a sponsor if the video mentions it: “' + t.line + '”' };
  if (t.how === 'link' && !paid) return { method: 'description', said: 'unknown', brand: t.brand, site: t.site, score: 0.3, proof: 'An offer link (' + t.brand + '), but no label to confirm it: “' + t.line + '”' };
  return { method: 'description', said: 'yes', brand: t.brand, site: t.site, score: t.how === 'said' ? 0.9 : t.how === 'code' ? (paid ? 0.85 : 0.75) : 0.8, proof: '“' + t.line + '”' };
}

// The pinned comment (read from the page): when the description sends you to it, an outside link there names the brand ("proton.me" for Proton Mail).
export function byPinned(pointer: { brand: string } | null, pinned: string | null, own: (string | null | undefined)[] = []): Vote {
  if (!pointer) return { method: 'pinned', said: 'unknown', score: 0, proof: 'The description does not point to a pinned comment' };
  if (pinned === null) return { method: 'pinned', said: 'unknown', score: 0, proof: 'The pinned comment is not read yet' };
  const l = brandLink(pinned, own);
  if (!l) return { method: 'pinned', said: 'unknown', score: 0, proof: 'The pinned comment has no outside link' };
  // The same company as the description's name? Use the name as the creator wrote it.
  const key = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, '');
  const brand = key(pointer.brand).includes(key(l.brand)) || key(l.brand).includes(key(pointer.brand)) ? pointer.brand : l.brand;
  return { method: 'pinned', said: 'yes', brand, site: l.site, score: 0.65, proof: 'The pinned comment links to ' + l.site + ': “' + l.line + '”' };
}

export function byChapters(chapters: { title: string; startSeconds: number }[], brands: string[], length: number | null): Vote {
  // A brand counts only as a whole word in the title (maintainer, 2026-10-01: "Turn Off Personalized Ads" got a $; the
  // title was squashed together before matching, so a brand could hide inside other words).
  const named = (title: string) => brands.find((b) => {
    const w = b.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
    return w.length > 2 && new RegExp('(^|[^a-z0-9])' + w + '($|[^a-z0-9])').test(title.toLowerCase());
  });
  const i = chapters.findIndex((c) => /\b(sponsor|sponsored|ad read|advert|partner)\b/i.test(c.title) || !!named(c.title));
  if (i < 0) return { method: 'chapters', said: 'unknown', score: 0, proof: chapters.length ? 'No chapter names a sponsor' : 'No chapters' };
  const c = chapters[i];
  const end = chapters[i + 1]?.startSeconds ?? length ?? null;
  const brand = named(c.title) ?? null;
  return { method: 'chapters', said: 'yes', brand, start: c.startSeconds, end, score: brand ? 0.75 : 0.6, proof: 'Chapter “' + c.title + '” at ' + clock(c.startSeconds) };
}

// Viewers often post the ad's time ("4:31 skip the sponsor"). Times near ad words, the most repeated wins.
export function byComments(comments: string[] | null, brands: string[], reading = false): Vote {
  if (comments === null) return { method: 'comments', said: 'unknown', score: 0, proof: reading ? "Reading viewers' comments…" : 'Not read (needs your YouTube key)' };
  const hits: { start: number; end: number | null; text: string }[] = [];
  for (const raw of comments) {
    const text = raw.replace(/\s+/g, ' ').trim();
    // "ads" is left out on purpose: viewers moan about YouTube's own ads ("0:12 a million ads?", MKBHD, 2026-10-01).
    if (!/\b(sponsor|sponsored|sponsorship|ad|advert|promo|segment|skip)\b/i.test(text) && !brands.some((b) => b.length > 2 && norm(text).includes(norm(b)))) continue;
    const times = [...text.matchAll(/\b(\d{1,2}):([0-5]\d)(?::([0-5]\d))?\b/g)].map((m) => (m[3] ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : Number(m[1]) * 60 + Number(m[2])));
    if (times.length) hits.push({ start: times[0], end: times[1] && times[1] > times[0] ? times[1] : null, text });
  }
  if (!hits.length) return { method: 'comments', said: 'unknown', score: 0, proof: comments.length ? 'No comment gives the ad a time (' + comments.length + ' read)' : 'No comments to read' };
  // Group times within 20 s of each other; the biggest group wins.
  const groups: (typeof hits)[] = [];
  for (const h of hits.sort((a, b) => a.start - b.start)) {
    const g = groups.find((x) => Math.abs(x[0].start - h.start) <= 20);
    if (g) g.push(h);
    else groups.push([h]);
  }
  const best = groups.sort((a, b) => b.length - a.length)[0];
  const brand = brands.find((b) => best.some((h) => norm(h.text).includes(norm(b)))) ?? null;
  const end = best.map((h) => h.end).find((e) => e !== null) ?? null;
  const proof = best.length + ' viewer' + (best.length === 1 ? '' : 's') + ' point to ' + clock(best[0].start) + ': “' + (best[0].text.length > 280 ? best[0].text.slice(0, 277) + '…' : best[0].text) + '”';
  // One viewer with no brand is a hint, not an answer: it can give another check's ad its time, but never calls a video
  // sponsored on its own (MKBHD "Dear YouTube!" had no ad; one joke about YouTube's ads made it "60% sure").
  // A hint, never a vote (maintainer, 2026-10-04: "searching viewer comments for ads might be counter intuitive ... would
  // serve better as a tool that hints"): it can give the ad found by other checks its time, nothing more.
  return { method: 'comments', said: 'unknown', brand, start: best[0].start, end, score: 0, proof, quote: best[0].text };
}

// The Transcript (maintainer, 2026-10-04: "Yes build the transcript check"): YouTube's own timed lines, read in your tab
// without playing the video. The ad starts at the line that introduces it ("this video is sponsored by", "thanks to X
// for", "brought to you by") or first names a known brand next to an ad word, and ends after the last line that still
// sells it (the brand, a code, "link in the description"), at most 3 minutes later. Auto-captions are lower case with
// no punctuation, so matching ignores case and uses whole words.
// Podcasts and shows say it more ways (maintainer, 2026-10-04: Zapier at 0:17 on The Next New Thing, missed): "our
// sponsor", "supported by", "presented by", "made possible by", "a word from", "this episode/show/podcast is …".
// "or getting sponsored by the company who released it" (maintainer's find, 2026-10-21) is a remark, not an ad read: "sponsored by" / "brought to you by" followed by a general noun phrase is no cue.
export const CUE = /\b(sponsored by(?! (?:the|a|an|some|other|another) (?:company|companies|brands?|people|person|folks|guys)\b)|sponsor(?:ing)? (?:of )?(?:this|today'?s)|brought to you by(?! (?:the|a|an|some|other|another) (?:company|companies|brands?|people|person|folks|guys)\b)|thanks? (?:you )?to [\w .&'-]{2,40}? for (?:sponsoring|supporting|partnering)|in partnership with|partnered with|today'?s sponsor|(?:our|this week'?s|this episode'?s|the) sponsors? (?:today |for today )?(?:is|are)|(?:supported|presented|made possible) by|a (?:quick )?word from (?:our|today'?s|this (?:video|episode|show)'?s?) sponsors?|\w[\w.&'-]* (?:is|are) (?:a|an|our|the|today'?s|this (?:video|episode)'?s) (?:proud )?sponsors?|this (?:video|episode|show|podcast) is (?:sponsored|brought|supported|presented|made possible))\b/i;
export const SELL = /\b(use (?:my |the )?code|promo code|discount|% off|percent off|link (?:is )?(?:in|down in) (?:the )?description|first link|free trial|sign up|check (?:them|it) out|go to [\w.]+\.(?:com|ai|io|co|app)|dot com|head over to|download (?:the |our |my )?(?:\w+ ){0,2}app|go ahead and (?:download|grab|try|sign)|link (?:is )?below|download (?:\w+ ){0,4}app|(?:get|grab) (?:it )?(?:on|from) (?:your |the )?(?:app ?store|google play)|pick up (?:the )?(?:\w+ ){1,3}app|link (?:is )?(?:in|down in) (?:the )?pinned comment)\b/i;
const words = (s: string) => ' ' + s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() + ' ';
// Captions split a one-word brand in two ("Code Rabbit" for CodeRabbit, Moonshine trial 2026-10-05): a brand of 6+ letters
// also matches when the text's words run together to spell it.
const mentions = (text: string, brand: string) => {
  const b = words(brand).trim();
  if (b.length <= 2) return false;
  const t = words(text);
  if (t.includes(' ' + b + ' ')) return true;
  const sq = b.replace(/ /g, '');
  if (sq.length < 6 || b.includes(' ')) return false;
  const w = t.trim().split(' ');
  return w.some((_, i) => w.slice(i, i + 2).join('') === sq || w.slice(i, i + 3).join('') === sq);
};
// Auto-captions mishear brand names (maintainer, 2026-10-04: "Kalam" came out as "kadama"). A one-word brand of 4+ letters
// is "heard" in a word that starts with the same letter and is one letter off (two for longer names), also when the
// captions ran the next word into it ("kadama" = "kadam" + "a"). Used only next to an ad line, never on its own.
const edits = (a: string, b: string) => {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
};
const misheard = (text: string, brand: string): string | null => {
  const b = words(brand).trim();
  if (b.length < 4 || b.includes(' ')) return null;
  const k = b.length <= 5 ? 1 : 2;
  return words(text).trim().split(' ').find((w) => w !== b && w[0] === b[0] && Math.abs(w.length - b.length) <= 2 &&
    (edits(w, b) <= k || (w.length > b.length && edits(w.slice(0, b.length), b) <= k))) ?? null;
};

// The brand said right after the cue, when no other check knew it ("brought to you by zapier the ai automation company"
// -> "Zapier"): one or two words, after fillers like "our friends at"; never a common word.
const NOT_A_NAME = new Set(['the', 'a', 'an', 'and', 'our', 'my', 'this', 'that', 'today', 'who', 'which', 'is', 'are', 'for', 'to', 'with', 'you', 'they', 'it', 'so', 'some', 'one', 'people', 'viewers', 'patreon', 'members', 'supporters']);
// Ordinary words are not brands (maintainer's 100-find review, 2026-10-13: "Any", "Physical", "Plug", "Sucks", "Micro" were named as sponsors from a transcript line alone, and "Joplain If" from a mis-heard one).
// Applies ONLY to a name Skipz pulled out of spoken words; a name from a link, the label or a brand Skipz already knows is never judged by this list.
const PLAIN = new Set(['any', 'all', 'none', 'some', 'many', 'much', 'more', 'most', 'other', 'another', 'same', 'own', 'real', 'whole', 'physical', 'plug', 'plugs', 'sucks', 'micro', 'mini', 'macro', 'new', 'free', 'best', 'good', 'great', 'big', 'small', 'top', 'first', 'last', 'next', 'little', 'long', 'high', 'low', 'full', 'simple', 'easy', 'hard', 'fast', 'quick', 'super', 'mega', 'ultra', 'plus', 'max', 'home', 'work', 'time', 'day', 'way', 'thing', 'things', 'video', 'videos', 'channel', 'app', 'apps', 'link', 'links', 'code', 'tomorrow', 'now', 'here', 'there', 'these', 'those', 'your', 'their', 'his', 'her', 'its', 'what', 'when', 'where', 'why', 'how', 'if', 'but', 'or', 'because', 'while', 'without', 'about', 'after', 'before', 'over', 'under', 'again', 'once', 'just', 'only', 'even', 'also', 'too', 'very', 'really', 'actually', 'basically', 'sponsor', 'sponsors', 'sponsored', 'brand', 'brands', 'company', 'companies', 'team', 'guys', 'everyone', 'everybody', 'someone', 'something', 'anything', 'nothing', 'folks', 'friends', 'fans', 'us', 'we', 'me', 'him', 'them', 'okay', 'ok', 'yes', 'no', 'um', 'uh', 'so', 'such', 'both', 'each', 'every', 'either', 'neither']);
const TAIL_WORD = new Set(['if', 'the', 'a', 'an', 'of', 'and', 'or', 'to', 'in', 'on', 'at', 'for', 'is', 'it', 'but', 'so', 'as', 'by']);
/** True for a name made only of ordinary words, or a short name that ends on a small joining word ("Joplain If"). */
export function plainWordsOnly(name: string): boolean {
  const w = name.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  if (!w.length) return true;
  if (w.every((x) => PLAIN.has(x) || NOT_A_NAME.has(x))) return true;
  return w.length <= 2 && w.length > 1 && TAIL_WORD.has(w[w.length - 1]);
}
const spoken = (n: string | null): string | null => (n && plainWordsOnly(n) ? null : n);

/** Is this name the channel's own (a creator promoting themselves is not a sponsor; maintainer's review: "Southern Adventures.", "ReStructure AI")? */
export function isOwnName(brand: string | null | undefined, own: (string | null | undefined)[]): boolean {
  const key = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, '');
  const b = brand ? key(brand) : '';
  if (b.length < 3) return false;
  return own.filter((x): x is string => !!x).map(key).some((o) => o.length >= 3 && (o === b || (Math.min(o.length, b.length) >= 6 && (o.includes(b) || b.includes(o)))));
}
/** Votes with the channel's own name taken out as the brand: the vote stays but no longer says a brand paid. */
export function scrubOwnBrand<T extends { method: string; said: string; brand?: string | null; proof: string }>(votes: T[], own: (string | null | undefined)[]): T[] {
  return votes.map((v) => (v.method !== 'label' && v.brand && isOwnName(v.brand, own)
    ? { ...v, brand: null, said: v.said === 'yes' ? 'unknown' : v.said, proof: 'That is the channel\u2019s own name, not a sponsor: ' + v.proof }
    : v));
}

export function nameAfterCue(text: string): string | null {
  return spoken(nameAfterCueRaw(text));
}
function nameAfterCueRaw(text: string): string | null {
  // "thanks to Notion for sponsoring this episode": the brand sits between the two (Moonshine trial, 2026-10-05).
  const th = /thanks? (?:you )?to\s+([a-z0-9][\w.&'-]*)(?:\s+([a-z0-9][\w.&'-]*))?\s+for\s+(?:sponsoring|supporting|partnering)/i.exec(text);
  if (th && !NOT_A_NAME.has(th[1].toLowerCase()) && th[1].length >= 3) {
    const up = (w: string) => (/[A-Z]/.test(w) ? w : w[0].toUpperCase() + w.slice(1));
    return up(th[1].replace(/[.,'-]+$/, '')) + (th[2] && !NOT_A_NAME.has(th[2].toLowerCase()) ? ' ' + up(th[2]) : '');
  }
  const m = /(?:sponsored by|brought to you by|(?:in |paid )?partnership with|partnered with|(?:supported|presented|made possible) by|sponsors? (?:today |for today )?(?:is|are)|word from (?:our|today'?s|this (?:video|episode|show)'?s?) sponsors?,?)\s+(?:(?:our|my|the) (?:good )?(?:friends|folks|team|people) (?:over )?at\s+)?([a-z0-9][\w.&'-]*)(?:\s+([a-z0-9][\w.&'-]*))?/i.exec(text);
  if (!m || NOT_A_NAME.has(m[1].toLowerCase()) || m[1].length < 3) return null;
  const two = m[2] && !/[.!?,;:]$/.test(m[1]) && !NOT_A_NAME.has(m[2].toLowerCase()) && /^[A-Z]/.test(m[2]) && /^[A-Z]/.test(m[1]) ? ' ' + m[2] : ''; // "sponsored by Squarespace. Go to …": a full stop ends the name
  const cap = (w: string) => (/[A-Z]/.test(w) ? w : w[0].toUpperCase() + w.slice(1));
  return cap(m[1].replace(/[.,'-]+$/, '')) + two;
}

// "I have decided that you need to get Proton VPN": a pitch with no cue word names the product after "get/try/download" (capitalised names only: lower-case captions give no name).
export function nameAfterNeed(text: string): string | null {
  const m = /\byou (?:need|should|have|must|gotta|ought) to (?:get|try|grab|download|check out|sign up for) ([A-Z][\w&'-]*(?: [A-Z][\w&'-]*)?)/.exec(text);
  return m ? spoken(m[1].replace(/[.,'-]+$/, '')) : null;
}

// "by the way, zapier is a sponsor" (maintainer's screenshot, 2026-10-04, 7:07): the brand comes before the cue.
export function nameBeforeCue(text: string): string | null {
  return spoken(nameBeforeCueRaw(text));
}
function nameBeforeCueRaw(text: string): string | null {
  const m = /([a-z0-9][\w.&'-]*)\s+(?:is|are)\s+(?:a|an|our|the|today'?s|this (?:video|episode)'?s)\s+(?:proud\s+)?sponsors?\b/i.exec(text);
  if (!m || NOT_A_NAME.has(m[1].toLowerCase()) || /^(?:it|this|that|he|she|which|who|what|there|here)$/i.test(m[1]) || m[1].length < 3) return null;
  return /[A-Z]/.test(m[1]) ? m[1] : m[1][0].toUpperCase() + m[1].slice(1);
}

// The times "sponsor" (sponsored, sponsoring, sponsors) is said; a word split across two caption lines counts once.
// A line that says the opposite ("they're not the sponsor of this video", "this video is not sponsored", "no sponsor", "unsponsored", maintainer's screenshot 2026-10-10) is never an ad cue.
export const NEGATED_SPONSOR = /\b(?:not|n't|never|no|without)\s+(?:\w+\s+){0,3}?sponsor|\b(?:un|non)-?sponsored\b/i;
// "supported by", "presented by" and "made possible by" are also ordinary speech (maintainer's screenshot, 2026-10-10: "ecosystem supported by physical discs and cartridges" was read as a sponsor called Physical, 90%).
// On their own they count only when the line also frames an ad: "this video/episode/show", "sponsor", "ad".
const WEAK_CUE = /\b(?:supported|presented|made possible) by\b/gi;
const AD_FRAME = /\b(?:this|today'?s|our|the) (?:video|episode|show|podcast|stream|newsletter)\b|\bsponsor|\badvert|\bad\b/i;
const cue = (s: string) => CUE.test(s) && !NEGATED_SPONSOR.test(s) && (CUE.test(s.replace(WEAK_CUE, ' ')) || AD_FRAME.test(s));
// A DISCLOSURE (maintainer's screenshot, 2026-10-14, Jeff Geerling / Formlabs at 1:34: "they did send me the printer and some resins to test, so I'm marking this video as sponsored"): no ad is read, the
// creator says out loud that the video is marked sponsored. The ad IS the disclosure, a few seconds long, starting where the creator explains what they were given.
const DISCLOSE = /\b(?:marking|marked|flagging|flagged|labell?ing|labell?ed|tagging|tagged|disclosing|declaring)\s+(?:this|the|it)\s+(?:video\s+|episode\s+|one\s+|stream\s+)?as\s+(?:a\s+)?(?:paid\s+)?(?:sponsored|promotion|promotional|advert(?:isement)?|ad)\b/i;
const NOT_DISCLOSING = /\b(?:not|n'?t|never)\s+(?:\w+\s+){0,2}?(?:marking|marked|flagging|flagged|labell?ing|labell?ed|tagging|tagged|disclosing|declaring)\b/i;
const GIFT = /\b(?:sent|send|gave|give|given|provided|provide|lent|loaned|supplied)\b[^.]*\b(?:me|us)\b|\b(?:did(?:n'?t| not)|do(?:n'?t| not)) pay\b|\beditorial (?:input|control)\b|\bto (?:test|review)\b|\bfor (?:this|the) (?:video|review|project)\b/i;
const GIFTED_BY = /(?:sent|provided|gave)(?: to)? (?:me|us)(?: [a-z ]{0,30})? by ([A-Z][\w.&'-]*)/;
export function sponsorSaid(lines: { t: number; text: string }[]): number[] {
  const out: number[] = [];
  for (const l of lines) if (!NEGATED_SPONSOR.test(l.text)) for (const _ of l.text.matchAll(/\bsponsor(?:s|ed|ing|ship)?\b/gi)) out.push(l.t);
  return out;
}

export const SHORT_READ = 20; // seconds: a cue-based read shorter than this is stretched (see byTranscript)
export const MIN_READ = 30;
export function byTranscript(t: { state: 'ok'; lines: { t: number; text: string }[] } | { state: 'none' } | { state: 'timeout'; why?: string } | { state: 'reading' } | null, brands: string[]): Vote {
  if (!t) return { method: 'transcript', said: 'unknown', score: 0, proof: 'Not read yet' };
  if (t.state === 'reading') return { method: 'transcript', said: 'unknown', score: 0, proof: "Reading YouTube's transcript…" };
  if (t.state === 'none') return { method: 'transcript', said: 'unknown', score: 0, proof: 'This video has no transcript' };
  if (t.state === 'timeout') return { method: 'transcript', said: 'unknown', score: 0, proof: "YouTube's transcript didn't open" + (t.why ? ' (' + t.why + ')' : '') };
  const lines = t.lines;
  const known = brands.filter((b) => b && b.length > 2);
  const brandOf = (text: string) => known.find((b) => mentions(text, b)) ?? null;
  // A line (with its neighbours, since a sentence spans lines) that introduces the ad.
  const around = (i: number) => lines.slice(i, i + 3).map((l) => l.text).join(' ');
  let start = -1;
  let brand: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const near = around(i);
    if (cue(lines[i].text) || (cue(near) && !cue(around(i + 1)))) {
      start = i;
      brand = brandOf(near) ?? nameAfterCue(near) ?? nameBeforeCue(near);
      break;
    }
  }
  if (start < 0 && known.length) {
    // No spoken cue: the first mention of a known brand with a selling line within 20 seconds.
    // Not when the creator is selling their own course or talking affiliate links near the brand (ad signals).
    // A name can be split across two caption lines ("...download yourself the just" / "pray app..."; maintainer's screenshot, 2026-10-13: Just Pray found at 2:02, not 1:36), so a line is read with the next one.
    // Only a name that really runs over the line break counts: a brand that starts on the NEXT line must not pull the start back a line.
    const spanned = (k: number): string | null => { const b = brandOf(lines[k].text + ' ' + (lines[k + 1]?.text ?? '')); return b && !mentions(lines[k + 1]?.text ?? '', b) ? b : null; };
    const two = (k: number) => brandOf(lines[k].text) ?? spanned(k);
    const i = lines.findIndex((l, k) => {
      const win = lines.slice(k, k + 6).filter((x) => x.t - l.t <= 20);
      if (!two(k) || !win.some((x) => SELL.test(x.text))) return false;
      const kind = classifyAd(win.map((x) => x.text).join(' '), two(k)).kind;
      return kind !== 'self' && kind !== 'affiliate';
    });
    if (i >= 0) {
      start = i; brand = two(i);
      // A break cue a few seconds earlier ("let's take a quick break") is where the ad really starts.
      for (let k = i - 1; k >= 0 && k >= i - 3 && lines[i].t - lines[k].t <= 15; k--) if (classifyAd(lines[k].text).hits.some((h) => h.signal === 'transition' || h.signal === 'adMarker')) start = k;
    }
  }
  // No cue and no known brand: the ad signals alone (a break cue + product talk, a code + a call to action). A guess,
  // so it scores lower, and the brand is whatever the lines name.
  let bySignals: string | null = null;
  // A read can be spread out: the pitch at 0:29, "try it for free" at 1:17, the link at 1:35 (maintainer's Proton VPN find, 2026-10-21), so a second, wider window is tried when the short one found nothing.
  if (start < 0) {
    for (const [count, secs] of [[5, 25], [20, 60]]) {
      for (let i = 0; i < lines.length && start < 0; i++) {
        const win = lines.slice(i, i + count).filter((x) => x.t - lines[i].t <= secs).map((x) => x.text).join(' ');
        if (NEGATED_SPONSOR.test(win)) continue; // "this video is not sponsored by anyone" says the opposite of an ad
        const r = classifyAd(win);
        if (r.kind === 'paid' && r.strength >= 0.6 && classifyAd(lines[i].text).kind !== 'none') { start = i; brand = brandOf(win) ?? nameAfterNeed(win); bySignals = r.hits.map((h) => '“' + h.phrase + '”').join(', '); }
      }
    }
  }
  // Still nothing: a known brand as the captions misheard it, in the same line as an ad line ("head over to the kadama").
  let heardAs: string | null = null;
  if (start < 0) {
    for (let i = 0; i < lines.length && start < 0; i++) {
      if (!SELL.test(lines[i].text)) continue;
      for (const b of known) { const w = misheard(lines[i].text, b); if (w) { start = i; brand = b; heardAs = w; break; } }
    }
  }
  // Still nothing: a disclosure ("...so I'm marking this video as sponsored"). Only when no ad read was found, so it never changes a video that has one.
  if (start < 0) {
    const di = lines.findIndex((l, i) => DISCLOSE.test(l.text) && !NOT_DISCLOSING.test(lines[i - 1] ? lines[i - 1].text + ' ' + l.text : l.text));
    if (di >= 0) {
      let s = di;
      for (let k = di - 1; k >= 0 && lines[di].t - lines[k].t <= 15 && GIFT.test(lines[k].text); k--) s = k; // back to where the creator starts saying what they were given
      const win = lines.slice(s, di + 3).map((l) => l.text).join(' ');
      const gifted = GIFTED_BY.exec(win);
      const dBrand = brandOf(win) ?? (gifted && !NOT_A_NAME.has(gifted[1].toLowerCase()) ? gifted[1] : null);
      const t0 = lines[s].t;
      const clip = (x: string) => (x.length > 110 ? x.slice(0, 107) + '…' : x);
      return {
        method: 'transcript', said: 'yes', brand: dBrand, start: t0, end: lines[di + 1]?.t ?? lines[di].t + 4,
        score: dBrand ? 0.85 : 0.6,
        proof: 'Said at ' + clock(t0) + ': “' + clip(lines.slice(s, di + 1).map((l) => l.text).join(' ')) + '” (the creator marks the video as sponsored)',
        mentions: sponsorSaid(lines),
      };
    }
  }
  // How many times "sponsor" is said, and when (maintainer, 2026-10-04: "number of times sponsor is mentioned in a video is
  // important"): Zapier was named at 0:17 and again at 7:10.
  const said = sponsorSaid(lines);
  const saidNote = said.length ? ' · “sponsor” said ' + said.length + '× (' + said.slice(0, 4).map(clock).join(', ') + (said.length > 4 ? '…' : '') + ')' : '';
  // What the ad signals found that is NOT a sponsor, so the "i" says why (own course, affiliate links).
  const other = (['self', 'affiliate'] as const).map((k) => { const l = lines.find((x) => classifyAd(x.text).kind === k); return l ? (k === 'self' ? 'own promotion' : 'affiliate talk (not a sponsor)') + ' at ' + clock(l.t) : null; }).filter(Boolean);
  const otherNote = other.length ? ' · ' + other.join(', ') : '';
  if (start < 0) return { method: 'transcript', said: 'no', score: 0.45, proof: 'No ad read in the transcript (' + lines.length + ' lines)' + saidNote + otherNote, mentions: said };
  // Every ad burst, not just the first (maintainer, 2026-10-12, after comparing 100 finds with SponsorBlock: Zapier was caught at 0:17, a 3 second mention, and the real read at 7:07 was missed). A burst is a run of
  // lines that sell, name the brand or cue the ad, with gaps under 100 seconds. It counts when it holds a cue or a selling line (a brand named in passing does not make one); the longest is the main read.
  const cueAt = (i: number) => cue(lines[i].text) || (cue(around(i)) && !cue(around(i + 1)));
  const isEv = (i: number) => SELL.test(lines[i].text) || cueAt(i) || !!(brand && (mentions(lines[i].text, brand) || (!mentions(lines[i + 1]?.text ?? '', brand) && mentions(lines[i].text + ' ' + (lines[i + 1]?.text ?? ''), brand)) || (heardAs !== null && misheard(lines[i].text, brand) !== null)));
  type Burst = { first: number; last: number; n: number; anchored: boolean };
  const bursts: Burst[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!isEv(i) && i !== start) continue;
    const anchor = SELL.test(lines[i].text) || cueAt(i) || i === start;
    const b = bursts[bursts.length - 1];
    if (b && lines[i].t - lines[b.last].t <= 100 && lines[i].t - lines[b.first].t <= 240) { b.last = i; b.n++; b.anchored = b.anchored || anchor; } else bursts.push({ first: i, last: i, n: 1, anchored: anchor });
  }
  const real = bursts.filter((b) => b.anchored && (b.n >= 2 || (b.first <= start && start <= b.last)));
  const own = real.find((b) => b.first <= start && start <= b.last);
  let main = own ?? { first: start, last: start, n: 1, anchored: true };
  for (const b of real) if (lines[b.last].t - lines[b.first].t > lines[main.last].t - lines[main.first].t + 5) main = b;
  if (main !== own && own !== undefined) {
    // the main read starts at its first cue or selling line; a break cue a few seconds earlier is where it really starts
    let s = main.first;
    for (let i = main.first; i <= main.last; i++) if (cueAt(i) || SELL.test(lines[i].text)) { s = i; break; }
    start = s;
    for (let k = s - 1; k >= 0 && k >= s - 3 && lines[s].t - lines[k].t <= 15; k--) if (classifyAd(lines[k].text).hits.some((h) => h.signal === 'transition' || h.signal === 'adMarker')) start = k;
    brand = brandOf(lines.slice(main.first, main.last + 1).map((l) => l.text).join(' ')) ?? brand;
  } else if (main !== own) start = main.first;
  const t0 = lines[start].t;
  const burstEnd = (b: Burst) => lines[b.last + 1]?.t ?? lines[b.last].t + 5;
  const last = Math.max(main.last, start);
  const rawEnd = lines[last + 1]?.t ?? lines[last].t + 5;
  // A spoken cue starts a read that lasts a good while, but the reading closes it at the last line that sells or names the brand (2026-10-22, real videos: "is Macroscope, the sponsor of today's video" at 5:38 ended at 5:40,
  // "they're sponsoring this part of the video" at 6:07 ended at 6:08: the creator then describes the product with no sales line, and the captions misspell the name). A cue-based read that looks shorter than
  // SHORT_READ seconds is shown as MIN_READ seconds (never past the last caption line), and the proof says the length is a guess.
  const stretched = !bySignals && !heardAs && rawEnd - lines[start].t < SHORT_READ;
  const end = stretched ? Math.max(rawEnd, Math.min(lines[start].t + MIN_READ, lines[lines.length - 1].t + 5)) : rawEnd;
  const segments = real.map((b) => ({ start: lines[b.first].t, end: burstEnd(b) })).slice(0, 5);
  const clip = (s: string) => (s.length > 90 ? s.slice(0, 87) + '…' : s);
  return {
    method: 'transcript', said: 'yes', brand, start: t0, end,
    score: bySignals ? (brand ? 0.65 : 0.5) : heardAs ? 0.75 : brand ? 0.9 : 0.7,
    ...(heardAs ? { late: true } : {}),
    ...(segments.length > 1 ? { segments } : {}),
    proof: 'Said at ' + clock(t0) + ': “' + clip(around(start)) + '”' + (bySignals ? ' (ad signs: ' + bySignals + ')' : '') + (heardAs ? ' (“' + heardAs + '” is how YouTube’s captions spelled ' + brand + ')' : '') + saidNote + (stretched && end > rawEnd ? ' · length is a guess: the lines after the cue do not sell or name the brand' : ''),
    mentions: said,
  };
}

// "Groq · openai/gpt-oss-20b" -> "Groq" (maintainer, 2026-10-04: "why not just Groq or just Mistral").
/** Every ad burst Skipz's own reading found (maintainer, 2026-10-13: "show every burst"): a short plug up front and the main read later are two. The main one first, then the others in time order. */
export type Burst = { start: number; end: number | null; main: boolean };
export function burstsOf(v: Pick<Verdict, 'start' | 'end' | 'votes'>): Burst[] {
  const out: Burst[] = v.start !== null ? [{ start: v.start, end: v.end, main: true }] : [];
  const more: Burst[] = [];
  for (const vote of v.votes) {
    if (vote.method !== 'transcript' && vote.method !== 'captions') continue;
    for (const s of vote.segments ?? []) if (![...out, ...more].some((b) => Math.abs(b.start - s.start) <= 10)) more.push({ start: s.start, end: s.end, main: false });
  }
  if (!out.length && more.length) { const first = more.shift()!; out.push({ ...first, main: true }); } // no main time (an unsure verdict), but the reading did find bursts
  return [...out, ...more.sort((a, b) => a.start - b.start)];
}

export const serviceOnly =(by: string | null | undefined) => (by ? by.split(' · ')[0] : null);
// Services whose sponsor answers are left out of the check (maintainer, 2026-10-12: "left out of the ad check"). They still read the audience and comments.
export const NO_AD_VOTE = ['Groq', 'Mistral'];
export const adReaders = <T extends { by: string | null }>(reads: T[]): T[] => reads.filter((r) => !NO_AD_VOTE.includes(serviceOnly(r.by) ?? ''));

// lines: the transcript, when Skipz has it: the AI gives a quote, the transcript gives that brand's time (maintainer,
// 2026-10-04: "service name ... and the proof ... time stamp pill that takes to the segment").
// The AI's quote must show a brand PAID (maintainer's ITG Gear video, 2026-10-04: Groq named "ASUS" from a parts list,
// "ASUS RTX 3060 12GB Single fan"; Gemini in Chrome rightly said affiliate links, no sponsor). A product named without
// a paid word is a hint, not a vote.
const PAID = /sponsor|partner|paid|brought to you|(?:presented|supported|made possible) by|thanks? (?:you )?to|#ad\b|\bad\b|advert|promo|code|discount|% off|percent off|collab|in association/i;
// The AI often quotes with its own quote marks; the "i" adds its own, so strip them (maintainer's screenshot, 2026-10-05:
// Groq: “"Incogn, the sponsor of today's video."”).
const unquote = (t: string) => t.replace(/^[\s"“”'‘’]+|[\s"“”‘’]+$/g, '');
export function byAiRead(sponsors: { brand: string; evidence: string }[] | null | undefined, by: string | null, lines?: { t: number; text: string }[] | null, affiliates?: { brand: string }[] | null, sponsorsAsked?: boolean): Vote {
  by = serviceOnly(by);
  // The short question was asked (no ad signs in the text): "no sponsors" is not an answer, it was never asked.
  if (sponsors && sponsorsAsked === false) return { method: 'ai', said: 'unknown', score: 0, proof: (by ?? 'The AI') + ' was not asked about sponsors: nothing in the text pointed to an ad' };
  const at = sponsors?.[0] && lines ? lines.find((l) => mentions(l.text, sponsors[0].brand))?.t ?? null : null;
  const aff = affiliates?.length ? ' · affiliate links: ' + [...new Set(affiliates.map((a) => a.brand))].slice(0, 3).join(', ') : '';
  if (!sponsors) return { method: 'ai', said: 'unknown', score: 0, proof: 'Not run yet (asks before sending anything)' };
  if (!sponsors.length) return { method: 'ai', said: 'no', score: 0.5, proof: (by ?? 'The AI') + ' found no sponsor in the text' + aff };
  const s = sponsors[0];
  if (!PAID.test(s.evidence || ''))
    return { method: 'ai', said: 'unknown', brand: s.brand, score: 0, proof: (by ?? 'The AI') + ' named ' + s.brand + ', but its quote doesn’t say anyone paid: “' + unquote(s.evidence || s.brand) + '”' + aff };
  return { method: 'ai', said: 'yes', brand: s.brand, start: at, score: 0.75, proof: (by ?? 'The AI') + ': “' + unquote(s.evidence || s.brand) + '”' };
}

// SponsorBlock viewers' marks (labelled, never kept for the shared list): when the ad is, not who paid. Nothing marked is
// no opinion (most videos are never marked), not a "no".
export function bySponsorBlock(r: { state: 'ok'; hit: { start: number; end: number; votes: number; marks: number } | null } | { state: 'failed'; why: string } | { state: 'reading' } | null | undefined): Vote {
  if (!r) return { method: 'sponsorblock', said: 'unknown', score: 0, proof: 'Not looked up (switch it on in Checks for this video)' };
  if (r.state === 'reading') return { method: 'sponsorblock', said: 'unknown', score: 0, proof: 'Looking it up…' };
  if (r.state === 'failed') return { method: 'sponsorblock', said: 'unknown', score: 0, proof: r.why };
  if (!r.hit) return { method: 'sponsorblock', said: 'unknown', score: 0, proof: 'No viewer has marked a sponsor part in this video' };
  const h = r.hit;
  const score = h.votes >= 5 ? 0.85 : h.votes >= 1 ? 0.75 : 0.6;
  return { method: 'sponsorblock', said: 'yes', start: h.start, end: h.end, score, proof: 'Viewers marked ' + clock(h.start) + '–' + clock(h.end) + ' as sponsored (' + h.votes + ' vote' + (h.votes === 1 ? '' : 's') + ')' };
}

export function byWatch(w: { sponsors: { brand: string; start: number | null; end: number | null; quote: string }[]; model: string; ms: number } | null | undefined): Vote {
  if (!w) return { method: 'watch', said: 'unknown', score: 0, proof: 'Not watched yet' };
  const s = w.sponsors[0];
  if (!s) return { method: 'watch', said: 'no', score: 0.7, proof: 'Found no paid part', ms: w.ms };
  return { method: 'watch', said: 'yes', brand: s.brand, start: s.start, end: s.end, score: 0.95, proof: '“' + (s.quote || s.brand) + '”', ms: w.ms };
}

// ---- The conductor --------------------------------------------------------------------------------------------------
export type Verdict = {
  sponsored: boolean;
  brand: string | null;
  confidence: number; // 0..1
  agree: number; // methods that back the answer
  ran: number; // methods that had an opinion
  start: number | null;
  end: number | null;
  timeBy: Method | null;
  needWatch: 'time' | 'disagree' | 'unsure' | null; // why the slow Gemini watch would help
  site: string | null; // the sponsor's web address, from the method that saw it
  votes: Vote[];
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const same = (a: string, b: string) => { const x = norm(a), y = norm(b); return !!x && !!y && (x === y || (Math.min(x.length, y.length) >= 3 && (x.includes(y) || y.includes(x)))); };
const clock = (s: number) => Math.floor(s / 60) + ':' + String(Math.round(s % 60)).padStart(2, '0');
const orSum = (ps: number[]) => 1 - ps.reduce((acc, p) => acc * (1 - Math.max(0, Math.min(1, p))), 1);

export function combine(votes: Vote[]): Verdict {
  const opinions = votes.filter((v) => v.said !== 'unknown');
  // Brand candidates (each spelled as the most trusted method wrote it), supported by every method naming it.
  const cands: { brand: string; by: Vote[] }[] = [];
  // Only a "yes" starts a candidate; an unsure mention (an offer link without a label) can only back one.
  for (const v of [...votes].sort((a, b) => b.score - a.score)) {
    if (!v.brand || v.said !== 'yes') continue;
    const c = cands.find((x) => same(x.brand, v.brand!));
    if (c) c.by.push(v);
    else cands.push({ brand: v.brand, by: [v] });
  }
  const somebodySaidYes = votes.some((v) => v.said === 'yes');
  for (const v of votes) {
    if (v.said !== 'unknown' || !v.brand || !v.score) continue;
    const c = cands.find((x) => same(x.brand, v.brand!));
    if (c) c.by.push(v);
    // Another method proved there IS an ad but could not name it (viewers' times, the label): the offer link names it.
    else if (!cands.length && somebodySaidYes) cands.push({ brand: v.brand, by: [v] });
  }
  // Spelled as the creator WROTE it (description, chapters) over how it was heard or guessed (maintainer's screenshot,
  // 2026-10-04: "Sponsored by Cruso", the captions' spelling of Crusoe).
  for (const c of cands) { const w = c.by.find((v) => (v.method === 'description' || v.method === 'chapters') && v.brand); if (w) c.brand = w.brand!; }
  const label = votes.find((v) => v.method === 'label' && v.said === 'yes');
  const scored = cands.map((c) => ({ ...c, p: orSum([...c.by.map((v) => v.score), ...(label ? [0.3] : [])]) })).sort((a, b) => b.p - a.p);
  const top = scored[0] ?? null;
  const noes = opinions.filter((v) => v.said === 'no');
  const yesNoBrand = opinions.filter((v) => v.said === 'yes' && !v.brand);
  const sponsored = !!top || yesNoBrand.length > 0;
  // "no" votes pull the confidence down; a rival brand does too.
  const rival = scored[1]?.p ?? 0;
  let confidence = top ? top.p : sponsored ? orSum(yesNoBrand.map((v) => v.score)) : noes.length ? orSum(noes.map((v) => v.score)) : 0;
  if (sponsored) confidence *= 1 - 0.5 * orSum(noes.map((v) => v.score)) * (top ? 1 : 0.5);
  if (top && rival) confidence *= 1 - rival / 2;
  const backers = top ? top.by.length + (label ? 1 : 0) : sponsored ? yesNoBrand.length : noes.length;
  // The ad's time: transcript (exact lines) > Gemini > chapters > a viewer's hint, from a method that agrees.
  // No sponsor, no ad time (maintainer's screenshot, 2026-10-04: "No sponsor found" with "3:59 · Jump there" from a viewer).
  const timedAll = !sponsored ? [] : ['transcript', 'captions', 'watch', 'sponsorblock', 'chapters', 'description', 'pinned', 'comments'].map((m) => votes.find((v) => v.method === m && v.start != null && (!top || !v.brand || same(v.brand, top.brand)))).filter((v): v is Vote => !!v);
  const timed = timedAll.find((v) => !v.late) ?? timedAll[0] ?? null;
  const disagree = (!!top && rival > 0.4) || (sponsored && noes.some((v) => v.score >= 0.5));
  return {
    sponsored,
    brand: top?.brand ?? null,
    confidence: Math.round(confidence * 100) / 100,
    agree: backers,
    ran: new Set([...opinions, ...(top ? top.by : [])]).size,
    start: timed?.start ?? null,
    end: timed?.end ?? null,
    timeBy: timed?.method ?? null,
    // maintainer, 2026-10-01 ("Ankerfast · 72% sure"): "I feel we can use gemini to verify": under 80% sure, Gemini checks.
    needWatch: disagree ? 'disagree' : sponsored && confidence < 0.8 ? 'unsure' : sponsored && !timed ? 'time' : null,
    site: top?.by.find((v) => v.site)?.site ?? null,
    votes,
  };
}

/** The order the "All checks" list shows its rows in (maintainer, 2026-10-14): the label, the description, Clinch with Gemini, the transcript, Snap, the captions when there are some, chapters, the pinned comment, viewers, then SponsorBlock (bench build only). The AI read is gone (it no longer votes). Display only: the combined answer does not depend on it. */
export const VOTE_ORDER: Method[] = ['label', 'description', 'watch', 'transcript', 'needle', 'captions', 'chapters', 'pinned', 'comments', 'sponsorblock', 'ai'];
export const inShowOrder = (votes: Vote[]): Vote[] => {
  const rank = (m: Method) => { const i = VOTE_ORDER.indexOf(m); return i < 0 ? VOTE_ORDER.length : i; };
  return votes.map((v, i) => ({ v, i })).sort((a, b) => rank(a.v.method) - rank(b.v.method) || a.i - b.i).map((x) => x.v);
};
