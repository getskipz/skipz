import { describe, it, expect } from 'vitest';
import { needleCandidates, acceptNeedle, byNeedle, repairName, linkedCompany } from './needle';
import { combine, byLabel, byDescription } from '../sponsor/check';

// Needle is a voice, not a judge (NOTES #269): it sees only ad-like text and its answer must be a clean name written there.
describe('Needle as a voice', () => {
  const DESC = 'Follow me on Instagram https://instagram.com/me\nThis video is sponsored by Wispr Flow. Try it free: https://wisprflow.ai\nJoin my course at https://mycourse.com\nPlain notes about the video.';
  it('shows Needle only description lines that read as an ad (not own-course, plain or social lines)', () => {
    expect(needleCandidates(DESC, null, null)).toEqual(['This video is sponsored by Wispr Flow. Try it free: https://wisprflow.ai']);
  });
  it('adds the stretch of transcript where the ad starts, when it reads as an ad', () => {
    const lines = [{ t: 5, text: 'welcome back' }, { t: 60, text: "let's take a quick break" }, { t: 63, text: "i've been using wispr flow for years" }, { t: 66, text: 'use my code skipz' }, { t: 200, text: 'back to it' }];
    const c = needleCandidates(null, lines, 60);
    expect(c).toHaveLength(1);
    expect(c[0]).toContain('wispr flow');
    expect(c[0]).not.toContain('back to it');
  });
  it('accepts a brand only if it is clean and written in an ad-like text', () => {
    expect(acceptNeedle('Wispr Flow!', 'This video is sponsored by Wispr Flow. Try it free')).toBe('Wispr Flow');
    expect(acceptNeedle('Notion', 'I opened Notion and wrote the script there')).toBeNull(); // not an ad
    expect(acceptNeedle('Surfshark', 'This video is sponsored by Brilliant')).toBeNull(); // not written there
    expect(acceptNeedle('SKIPZ', 'sponsored by Notion use my code SKIPZ')).toBeNull(); // a promo code
    expect(acceptNeedle(null, 'sponsored by Notion')).toBeNull();
  });
  it('its vote is a hint: it names the brand of an ad another check proved, and never calls a video sponsored alone', () => {
    const named = byNeedle({ brand: 'Ridge', quote: 'Paid partnership with Ridge', ms: 1500 });
    expect(named).toMatchObject({ method: 'needle', said: 'unknown', brand: 'Ridge' });
    expect(combine([byLabel(false), named]).sponsored).toBe(false);
    expect(combine([byLabel(true), byDescription('Paid partnership.', true), named])).toMatchObject({ sponsored: true, brand: 'Ridge' });
  });
  it('says what it is doing in the panel', () => {
    expect(byNeedle(null).proof).toMatch(/alongside the other checks/);
    expect(byNeedle({ state: 'reading' }).proof).toMatch(/Reading/);
    expect(byNeedle({ brand: null, quote: '', ms: 900 }).proof).toMatch(/no brand/i);
    expect(byNeedle({ state: 'failed', why: 'Needle took too long.' }).proof).toBe('Needle took too long.');
  });
});

describe('Needle works alongside the other checks (maintainer, 2026-10-05)', () => {
  it('when it names the same brand as another check it adds to the agreement; it never lowers it', () => {
    const base = combine([byLabel(true), byDescription('Use code CYBER at the link below and get 60% off. Sponsored by Incogni.', true)]);
    const withNeedle = combine([byLabel(true), byDescription('Use code CYBER at the link below and get 60% off. Sponsored by Incogni.', true), byNeedle({ brand: 'Incogni', quote: 'Sponsored by Incogni', ms: 1200 })]);
    expect(withNeedle.brand).toBe('Incogni');
    expect(withNeedle.agree).toBeGreaterThan(base.agree);
    expect(withNeedle.confidence).toBeGreaterThanOrEqual(base.confidence);
  });
});

describe('Needle is more active (maintainer, 2026-10-05: Switch and Click / Soundcore)', () => {
  const SOUND = 'Buy Space 2 Pro on Official Web: https://soundcore.tech/Thus_launch_Switch_and_Click_2_277614';
  it('reads a brand link line even when it has no ad words', () => {
    expect(needleCandidates('Follow me https://instagram.com/me\n' + SOUND + '\nPlain notes.', null, null)).toEqual([SOUND]);
  });
  it('trusts a name that is the link\'s own address, with or without the paid label', () => {
    expect(acceptNeedle('Soundcore', SOUND)).toBe('Soundcore');
    expect(acceptNeedle('Soundcore', SOUND, true)).toBe('Soundcore');
    expect(acceptNeedle('Space 2 Pro', SOUND)).toBeNull(); // a product, not the link's name, no ad words
    expect(acceptNeedle('Space 2 Pro', SOUND, true)).toBe('Soundcore'); // paid label + a product name: the company is the link's name
  });
  it('still refuses invented names, own-course lines and affiliate talk without the label', () => {
    expect(acceptNeedle('Acme', SOUND, true)).toBeNull(); // not written in the text
    expect(acceptNeedle('MyCourse', 'Join my course https://mycourse.com/me')).toBeNull();
    expect(acceptNeedle('Amazon', 'Affiliate link, I earn a commission https://amazon.com/x')).toBeNull();
  });
  it('with the paid label on, the transcript\'s ad stretch is shown even without ad words', () => {
    const lines = [{ t: 100, text: 'the new space two pro earbuds' }, { t: 110, text: 'have great battery' }];
    expect(needleCandidates(null, lines, 100, true)).toHaveLength(1);
    expect(needleCandidates(null, lines, 100, false)).toHaveLength(0);
  });
});

describe('Needle on Cyb3rMaddy\'s Saily video (maintainer\'s screenshot, 2026-10-05)', () => {
  const DESC = 'Get an exclusive 15% discount on Saily data plans! Use code CYBERMADDY at checkout. Download Saily app or go to https://saily.com/cybermaddy\n\ncheck out my wifi sensing video here\n\nTIMESTAMPS\n*0:00* Public Wi-Fi Security Risks\n*0:30* Wi-Fi Pineapple Pager Explained\n*1:09* The History of Wireless Security\n*1:50* What the Wi-Fi Pineapple Can Reveal\n*2:31* Wi-Fi Geolocation & Privacy Risks\n*3:19* Creating a Fake Wi-Fi Network\n*3:43* Sponsor: Saily eSIM & Travel Privacy\n*4:55* Fake Wi-Fi Networks Explained';
  it('also reads the timestamp line that says "Sponsor: ...", without the time and bullets', () => {
    const c = needleCandidates(DESC, null, null, true);
    expect(c).toContain('Sponsor: Saily eSIM & Travel Privacy');
    expect(c[0]).toMatch(/^Get an exclusive 15% discount on Saily/);
  });
  it('puts a garbled name back to what is written ("Sdaily eSIM & Travel Privacy" -> Saily)', () => {
    expect(repairName('Sdaily eSIM & Travel Privacy', 'Sponsor: Saily eSIM & Travel Privacy')).toBe('Saily');
    expect(acceptNeedle('Sdaily eSIM & Travel Privacy', 'Sponsor: Saily eSIM & Travel Privacy', true)).toBe('Saily');
    expect(repairName('Notion', 'sponsored by Notion')).toBe('Notion');
  });
  it('names the company a paid ad line links to when Needle found nothing', () => {
    expect(linkedCompany('Download Saily app or go to https://saily.com/cybermaddy')).toBe('Saily');
    expect(linkedCompany('no link here')).toBeNull();
  });
  it('says when the description names it more than once', () => {
    expect(byNeedle({ brand: 'Saily', quote: 'Sponsor: Saily eSIM', ms: 4000, times: 3 }).proof).toMatch(/named 3× in the description/);
  });
});
