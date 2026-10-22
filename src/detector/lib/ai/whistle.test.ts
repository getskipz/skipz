import { beforeEach, describe, expect, it } from 'vitest';
import { closeWhistle, findHeardAd, isFiller, refineWithWhistle, warmWhistle, whistleKeywords, type MakeSession, type Word } from './whistle';

// Word times are what Whistle gave on a computer-voice sponsor read in the 2026-10-21 trial (scratchpad/wh), each word 0.3 s long.
const at = (s: string): Word[] => s.split(' ').map((p) => { const [word, t] = p.split('@'); return { word, start: Number(t), end: Number(t) + 0.3 }; });
const READ = at('So@0.2 that@0.4 is@0.6 how@0.6 the@0.8 mount@1.0 works.@1.1 This@2.3 video@2.6 is@2.9 sponsored@3.0 by@3.5 Squarespace.@3.7 Go@5.2 to@5.4 Squarespace.com@5.8 slash@6.6 creator@7.0 for@7.4 10%@7.5 off@8.2 your@8.3 first@8.5 website.@8.7 And@10.1 now,@10.2 back@10.8 to@11.0 the@11.2 video.@11.4');
const text = (w: Word[]) => w.map((x) => x.word).join(' ');

describe('The brand list for the second pass', () => {
  it('puts this video\'s brands first, drops repeats and junk, and stops at Whistle\'s limit of 100', () => {
    expect(whistleKeywords(['Zapier', ' zapier ', 'ab', 'https://x.com', null], ['Proton VPN', 'Zapier'])).toEqual(['Zapier', 'Proton VPN']);
    const many = Array.from({ length: 150 }, (_, i) => 'Brand' + i);
    expect(whistleKeywords(many)).toHaveLength(100);
  });
});

describe('The second pass', () => {
  beforeEach(async () => { await closeWhistle(); });
  const fake = (log: { kw: string[][]; len: number[]; made: number }): MakeSession => async () => {
    log.made++;
    return { transcribe: async (a, o) => { log.kw.push(o.keywords); log.len.push(a.length); return { text: ' Hello there. ', words: at('Hello@0.1 there.@0.5') }; }, close: async () => undefined };
  };
  it('listens with the brand list and word times, and loads the model once for many listens', async () => {
    const log = { kw: [] as string[][], len: [] as number[], made: 0 };
    const a = await refineWithWhistle(new Float32Array(16000 * 5), ['Zapier'], { make: fake(log) });
    await refineWithWhistle(new Float32Array(16000 * 5), ['Zapier'], { make: fake(log) });
    expect(a).toMatchObject({ text: 'Hello there.' });
    expect(log.kw[0]).toEqual(['Zapier']);
    expect(log.made).toBe(1);
  });
  it('can load the model ahead of time, and the listen that follows reuses it', async () => {
    const log = { kw: [] as string[][], len: [] as number[], made: 0 };
    warmWhistle({ make: fake(log) });
    warmWhistle({ make: fake(log) }); // a second warm-up changes nothing
    await refineWithWhistle(new Float32Array(16000), [], { make: fake(log) });
    expect(log.made).toBe(1);
  });
  it('tries again when the warm-up failed', async () => {
    let made = 0;
    warmWhistle({ make: async () => { made++; throw new Error('Offline'); } });
    await new Promise((r) => setTimeout(r, 0));
    const log = { kw: [] as string[][], len: [] as number[], made: 0 };
    expect(await refineWithWhistle(new Float32Array(16000), [], { make: fake(log) })).toMatchObject({ text: 'Hello there.' });
    expect(made).toBe(1);
    expect(log.made).toBe(1);
  });
  it('drops the stray "Thank you." a model makes up from music, but never a real ad line', async () => {
    expect(['Thank you.', 'thanks for watching!', ' You ', 'Okay.'].every(isFiller)).toBe(true);
    expect(isFiller('Thank you to Squarespace for sponsoring this video.')).toBe(false);
    const make: MakeSession = async () => ({ transcribe: async () => ({ text: 'Thank you.', words: at('Thank@0.1 you.@0.4') }), close: async () => undefined });
    expect(await refineWithWhistle(new Float32Array(16000), [], { make })).toMatchObject({ text: '', words: [] });
  });
  it('stops a pass that takes too long and says so', async () => {
    const make: MakeSession = async () => ({ transcribe: () => new Promise(() => undefined), close: async () => undefined });
    expect(await refineWithWhistle(new Float32Array(16000), [], { make, limitMs: 30 })).toEqual({ error: 'It took too long' });
  });
  it('never hands it more than 30 seconds', async () => {
    const log = { kw: [] as string[][], len: [] as number[], made: 0 };
    await refineWithWhistle(new Float32Array(16000 * 45), [], { make: fake(log) });
    expect(log.len[0]).toBe(16000 * 30);
  });
  it('says why when the model will not load, and tries again next time', async () => {
    let made = 0;
    const bad: MakeSession = async () => { made++; throw new Error('Download failed'); };
    expect(await refineWithWhistle(new Float32Array(16000), [], { make: bad })).toEqual({ error: 'Download failed' });
    await refineWithWhistle(new Float32Array(16000), [], { make: bad });
    expect(made).toBe(2);
  });
});

describe('Where the ad sits in what was heard', () => {
  it('runs from the sentence that cues the ad to the last sentence that sells it, and names the brand', () => {
    const r = findHeardAd(text(READ), READ, ['Zapier']);
    expect(r).toEqual({ brand: 'Squarespace', start: 2.3, end: expect.closeTo(9.0, 0) });
    expect(r!.end).toBeLessThan(10); // "And now, back to the video." is not the ad
  });
  it('uses a known brand heard in the words', () => {
    const r = findHeardAd(text(READ), READ, ['Squarespace']);
    expect(r?.brand).toBe('Squarespace');
  });
  it('finds a pitch with no cue word, from "you need to get Proton VPN" to the link line', () => {
    const w = at('Hey@0.0 there.@0.4 I@2.0 have@2.1 decided@2.3 that@2.6 you@2.8 need@3.0 to@3.1 get@3.2 Proton@3.4 VPN.@3.7 It@5.0 masks@5.2 your@5.5 address.@5.8 Click@8.0 on@8.2 the@8.3 link@8.4 in@8.6 the@8.7 description@8.8 to@9.1 get@9.3 started.@9.5');
    const r = findHeardAd(text(w), w, []);
    expect(r?.brand).toBe('Proton VPN');
    expect(r?.start).toBe(2.0);
    expect(r?.end).toBeCloseTo(9.8, 1);
  });
  it('says nothing when the words are only talk', () => {
    const w = at('Then@0.0 drag@0.3 the@0.5 layer@0.7 to@0.9 the@1.0 left.@1.2 Export@2.0 it@2.3 as@2.4 a@2.5 PNG.@2.7');
    expect(findHeardAd(text(w), w, [])).toBeNull();
    expect(findHeardAd('', [], [])).toBeNull();
  });
});
