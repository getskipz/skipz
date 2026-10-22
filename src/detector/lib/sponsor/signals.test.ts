import { describe, it, expect } from 'vitest';
import { signalsIn, classifyAd, tidyBrand } from './signals';

// The maintainer's classifier list (2026-10-05, "to improve Needle and Whistle"): each group is its own signal, the
// creator's own promotion is its own classifier, and an ordinary brand mention is a tracked negative case.
const names = (t: string) => signalsIn(t).map((h) => h.signal).sort();

describe('ad signals: each group of phrases is recognised', () => {
  it('sponsorship phrases', () => {
    for (const t of ['this video is sponsored by Brilliant', 'this one is brought to you by Mux', 'thanks to Surfshark for sponsoring this video', "today's sponsor is Notion", 'our sponsor for this episode'])
      expect(names(t), t).toContain('sponsor');
  });
  it('partnership phrases', () => {
    for (const t of ['this is a paid partnership with Ridge', 'we partnered with Squarespace', 'in partnership with Google', 'includes paid promotion'])
      expect(names(t), t).toContain('partnership');
  });
  it('advertisement markers', () => {
    for (const t of ['this is an ad', 'quick advertisement', 'this is promotional content', 'Great trip #ad', '#sponsored'])
      expect(names(t), t).toContain('adMarker');
  });
  it('ad transition cues', () => {
    for (const t of ['before we continue', "let's take a quick break", 'lets take a short break', 'but first a quick word from'])
      expect(names(t), t).toContain('transition');
  });
  it('product promotion phrases (apostrophes optional, as in auto-captions)', () => {
    for (const t of ["I've been using this for months", 'ive been using it every day', 'i wanted to tell you about something', 'let me tell you about a tool'])
      expect(names(t), t).toContain('promo');
  });
  it('discount and promo codes', () => {
    for (const t of ['use my code SKIPZ', 'get 10 percent off', 'get 10% off your first order', 'with promo code SAVE', 'save 20% today', 'Try it free: https://coderabbit.link/x', 'Get $20 in credits', 'the first 1000 people get a free trial'])
      expect(names(t), t).toContain('code');
  });
  it('calls to action', () => {
    for (const t of ['click the link below', 'sign up using my link', 'the link is in the description', 'head over to surfshark dot com'])
      expect(names(t), t).toContain('cta');
  });
  it('affiliate signals', () => {
    for (const t of ['this is an affiliate link', 'i earn a commission if you buy', 'i may earn a small commission'])
      expect(names(t), t).toContain('affiliate');
  });
  it("the creator's own promotion is its own classifier", () => {
    for (const t of ['check out my course', 'my product launches friday', 'join my newsletter', 'grab my template'])
      expect(names(t), t).toContain('self');
  });
  it('plain talk has no signal', () => {
    expect(names('so i tried notion for a month and it is fine honestly')).toEqual([]);
  });
});

describe('classifyAd: what the signals add up to', () => {
  it('a sponsor, partnership or ad marker is a paid read', () => {
    expect(classifyAd('this video is sponsored by Brilliant').kind).toBe('paid');
    expect(classifyAd('this is an ad').kind).toBe('paid');
    expect(classifyAd('paid partnership with Ridge').kind).toBe('paid');
  });
  it('a code with a call to action is probably paid; a code alone is only a maybe', () => {
    expect(classifyAd('use my code SKIPZ and click the link below').kind).toBe('paid');
    expect(classifyAd('use my code SKIPZ').kind).toBe('maybe');
  });
  it('a break cue plus product talk is probably paid', () => {
    expect(classifyAd("let's take a quick break, i've been using Notion for years").kind).toBe('paid');
    expect(classifyAd('before we continue').kind).toBe('maybe');
  });
  it('affiliate links and commissions are not a sponsor', () => {
    const r = classifyAd('links below are affiliate links, i earn a commission, use my code SAVE10');
    expect(r.kind).toBe('affiliate');
  });
  it("the creator's own course or product is not a sponsor", () => {
    const r = classifyAd('check out my course, link in the description, use code EARLY for 20% off');
    expect(r.kind).toBe('self');
  });
  it('but a real sponsor read still wins over the rest', () => {
    expect(classifyAd('this video is sponsored by Brilliant, also check out my course').kind).toBe('paid');
  });
  it('an ordinary brand mention is a tracked negative', () => {
    const r = classifyAd('i opened Notion and wrote the script there', 'Notion');
    expect(r).toMatchObject({ kind: 'none', mentioned: true });
    expect(r.why).toMatch(/nothing says anyone paid/i);
  });
  it('says which phrases it went by', () => {
    const r = classifyAd('this video is sponsored by Brilliant');
    expect(r.hits[0]).toMatchObject({ signal: 'sponsor' });
    expect(r.hits[0].phrase.toLowerCase()).toContain('sponsored by');
  });
});

describe('tidyBrand: a small model\'s brand name is cleaned or dropped', () => {
  it('strips punctuation, reduces an address to its name, drops codes, links and sentences', () => {
    expect(tidyBrand('Wispr Flow!')).toBe('Wispr Flow');
    expect(tidyBrand('Brilliant.org/veritasium')).toBe('Brilliant');
    expect(tidyBrand('SKIPZ', 'I have been using Notion. Use my code SKIPZ')).toBeNull();
    expect(tidyBrand('NordVPN', 'use code NORD')).toBe('NordVPN');
    expect(tidyBrand('https://amzn.to/x')).toBeNull();
    expect(tidyBrand('SPONSOR THOUSANDS OF NEW MUSLIMS AND SHAHADAHS AROUND THE GLOBE!')).toBeNull();
    expect(tidyBrand(null)).toBeNull();
  });
});
