import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { hashPrefix, pickCrowd, crowdFor, withCrowd, type Crowd } from './crowd';
import type { Mark } from './verdict';

// All SponsorBlock answers below are SYNTHETIC (made up to exercise the rules).
const seg = (start: number, end: number, o: Record<string, unknown> = {}) => ({ segment: [start, end], category: 'sponsor', actionType: 'skip', votes: 3, locked: 0, UUID: 'u' + start, ...o });
const answer = (id: string, segments: unknown[]) => [{ videoID: 'otherVideo1', segments: [seg(1, 99)] }, { videoID: id, segments }];
const mark = (o: Partial<Mark> = {}): Mark => ({ videoId: 'abc123DEF45', brand: 'Surfshark', start: 120, end: 190, confidence: 0.85, from: 'page', ...o });

describe('the private way of asking', () => {
  it('sends only the first 4 characters of the scrambled video id', async () => {
    const id = 'dQw4w9WgXcQ';
    expect(await hashPrefix(id)).toBe(createHash('sha256').update(id).digest('hex').slice(0, 4));
  });
});

describe('picking this video’s sponsor parts out of the answer', () => {
  const id = 'abc123DEF45';
  it('keeps only this video’s sponsor skips that were not voted down, in time order', () => {
    const got = pickCrowd(answer(id, [seg(300, 360), seg(100, 160), seg(500, 560, { votes: -2 }), seg(600, 660, { votes: 0 }), seg(700, 760, { votes: 0, locked: 1 }), seg(800, 860, { category: 'selfpromo' }), seg(900, 960, { actionType: 'mute' })]), id);
    expect(got.map((c) => [c.start, c.end])).toEqual([[100, 160], [300, 360], [700, 760]]); // not -2, not 0 votes unless locked, not another category, not a mute
  });
  it('ignores a part that is too short or too long, or malformed, and a video that is not this one', () => {
    expect(pickCrowd(answer(id, [seg(10, 12), seg(0, 1000), { segment: ['a', 'b'], category: 'sponsor' }, { category: 'sponsor' }, null, 5]), id)).toEqual([]);
    expect(pickCrowd(answer('someOtherId1', [seg(100, 160)]), id)).toEqual([]);
    expect(pickCrowd('not json', id)).toEqual([]);
    expect(pickCrowd(null, id)).toEqual([]);
  });
});

describe('asking SponsorBlock', () => {
  const ok = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
  it('returns this video’s marks, and asks with the 4-character prefix and the sponsor category only', async () => {
    let url = '';
    const got = await crowdFor('abc123DEF45', (async (u: string) => { url = String(u); return new Response(JSON.stringify(answer('abc123DEF45', [seg(120, 190)]))); }) as unknown as typeof fetch);
    expect(got).toEqual([{ start: 120, end: 190, votes: 3, locked: false }]);
    expect(url).toContain('/api/skipSegments/' + (await hashPrefix('abc123DEF45')) + '?');
    expect(url).not.toContain('abc123DEF45');
    expect(decodeURIComponent(url)).toContain('categories=["sponsor"]');
  });
  it('nothing marked (404), an error, a bad answer or no network all mean "no crowd" and never throw', async () => {
    expect(await crowdFor('v404v404v40', ok({}, 404))).toEqual([]);
    expect(await crowdFor('v500v500v50', ok({}, 500))).toEqual([]);
    expect(await crowdFor('vbadvbadvba', ok('x'))).toEqual([]);
    expect(await crowdFor('vnetvnetvne', (async () => { throw new Error('offline'); }) as unknown as typeof fetch)).toEqual([]);
  });
  it('does not wait on a slow SponsorBlock, and keeps what it was told so a retry does not ask again', async () => {
    let calls = 0;
    const f = (async () => { calls++; return new Response(JSON.stringify(answer('vkeptvkeptv', [seg(50, 110)]))); }) as unknown as typeof fetch;
    await crowdFor('vkeptvkeptv', f); await crowdFor('vkeptvkeptv', f);
    expect(calls).toBe(1);
    const never = ((_u: string, init: RequestInit) => new Promise((_r, rej) => init.signal?.addEventListener('abort', () => rej(new Error('aborted'))))) as unknown as typeof fetch;
    const t0 = Date.now();
    expect(await crowdFor('vslowvslowv', never)).toEqual([]);
    expect(Date.now() - t0).toBeLessThan(4000);
  }, 8000);
});

describe('folding the crowd into the detector’s mark', () => {
  const crowd = (...c: [number, number, Partial<Crowd>?][]): Crowd[] => c.map(([start, end, o]) => ({ start, end, votes: 3, locked: false, ...o }));
  it('does nothing when the crowd marked nothing', () => {
    const m = mark();
    expect(withCrowd(m, [], 'Surfshark', m.videoId)).toBe(m);
    expect(withCrowd(null, [], null, 'x')).toBeNull();
  });
  it('confirms where the detector found the same ad and NEVER moves its times (measured: a crowd start a few seconds before the detector’s read took a confirmed answer out of its range)', () => {
    const m = mark({ confidence: 0.95 });
    expect(withCrowd(m, crowd([118, 197]), 'Surfshark', m.videoId)).toBe(m); // already surer than a 3-vote part: nothing changes, not even a copy
    const less = withCrowd(mark({ confidence: 0.72 }), crowd([118, 197]), 'Surfshark', 'abc123DEF45')!;
    expect(less).toMatchObject({ start: 120, end: 190, from: 'page', confidence: 0.9 }); // times kept, the crowd's agreement raises the confidence
    expect(less.more).toBeUndefined();
  });
  it('marks the video when the detector found a sponsor but not where, or nothing at all (a locked part is surest)', () => {
    const a = withCrowd(null, crowd([300, 380, { locked: true }]), 'Acme', 'abc123DEF45')!;
    expect(a).toMatchObject({ brand: 'Acme', start: 300, end: 380, from: 'crowd', confidence: 0.95 });
    const b = withCrowd(null, crowd([300, 380, { votes: 1 }]), null, 'abc123DEF45')!;
    expect(b).toMatchObject({ brand: 'Sponsor', confidence: 0.8 });
    expect(withCrowd(null, crowd([300, 380, { votes: 0 }]), null, 'x')!.confidence).toBe(0.7); // not voted down, but nobody has confirmed it: just sure enough to mark
    expect(withCrowd(null, crowd([300, 380, { votes: 5 }]), null, 'x')!.confidence).toBe(0.9);
  });
  it('adds a second crowd part only when it is as long as a real read, at most four more, and keeps the longest as the main one', () => {
    const got = withCrowd(mark(), crowd([118, 197], [600, 612], [900, 960], [1200, 1260]), 'Surfshark', 'abc123DEF45')!;
    expect(got.more).toEqual([{ start: 900, end: 960 }, { start: 1200, end: 1260 }]); // the 12-second plug is not added
    expect(got.start).toBe(120); // the detector's own main part stays exactly where it was
  });
  it('keeps the detector’s own mark, its brand and its link, when the crowd only adds a part elsewhere', () => {
    const got = withCrowd(mark({ link: 'https://surfshark.com/x' }), crowd([900, 960]), 'Surfshark', 'abc123DEF45')!;
    expect(got).toMatchObject({ brand: 'Surfshark', start: 120, end: 190, link: 'https://surfshark.com/x', from: 'page' });
    expect(got.more).toEqual([{ start: 900, end: 960 }]);
  });
});
