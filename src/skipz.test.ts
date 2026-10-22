import { describe, it, expect } from 'vitest';
import { skipGate, effectiveMode, NEEDED } from './gate';
import { markFrom, verdictOf, burstsOfMark, brandStretches } from './verdict';

const ok = { startWithin3s: 0.85, brandRight: 0.9, wrongSkipsGrowing: false as boolean | null, asOf: 'x' };

describe('the skip lock', () => {
  it('is shut on today\'s numbers', () => expect(skipGate().open).toBe(false));
  it('opens only when every number is met', () => {
    expect(skipGate(ok).open).toBe(true);
    expect(skipGate({ ...ok, startWithin3s: NEEDED.startWithin3s - 0.01 }).missing).toEqual(['start']);
    expect(skipGate({ ...ok, brandRight: 0.8 }).missing).toEqual(['brand']);
  });
  it('treats "wrong skips not measured" as not safe', () => expect(skipGate({ ...ok, wrongSkipsGrowing: null }).missing).toEqual(['wrong']));
  it('turns a stored "skip" back into "ask" while it is shut', () => {
    expect(effectiveMode('skip', undefined, false)).toBe('ask');
    expect(effectiveMode('skip', ok, false)).toBe('skip');
    expect(effectiveMode('skip')).toBe('skip'); // the maintainer opened the lock on 2026-10-22
    expect(effectiveMode('off')).toBe('off');
  });
});

describe('marks', () => {
  const good = { brand: 'Surfshark', start: 120, end: 190, confidence: 0.9 };
  it('marks a sure, timed sponsor', () => expect(markFrom('abcdefghijk', good, 'page')?.brand).toBe('Surfshark'));
  it('keeps the other bursts, dropping silly ones', () => {
    const m = markFrom('abcdefghijk', { ...good, more: [{ start: 71, end: 74 }, { start: 5, end: 5 }, { start: 10, end: 2000 }] }, 'page')!;
    expect(m.more).toEqual([{ start: 69, end: 77 }]);
    expect(burstsOfMark(m)).toEqual([{ start: 118, end: 193 }, { start: 69, end: 77 }]);
  });
  it('starts the mark 2 seconds early and ends it 3 seconds late when it read the page, but leaves an Index mark as it is', () => {
    expect(markFrom('a', good, 'page')).toMatchObject({ start: 118, end: 193 });
    expect(markFrom('a', good, 'index')).toMatchObject({ start: 120, end: 190 });
    expect(markFrom('a', { ...good, start: 1 }, 'page')?.start).toBe(0);
  });
  it('does not mark when unsure, unnamed, untimed or silly-long', () => {
    expect(markFrom('a', { ...good, confidence: 0.5 }, 'page')).toBeNull();
    expect(markFrom('a', { ...good, brand: null }, 'page')?.brand).toBe('Sponsor'); // a sure, timed sponsor is marked even when nobody could name it
    expect(markFrom('a', { ...good, end: null }, 'page')).toBeNull();
    expect(markFrom('a', { ...good, end: 1500 }, 'page')).toBeNull();
    expect(markFrom('a', { ...good, end: 122, confidence: 0.75 }, 'page')).toBeNull(); // short and not sure enough to stretch
    expect(markFrom('a', { ...good, end: 122 }, 'page')).toMatchObject({ start: 118, end: 153 }); // short but sure: given the minimum read, then padded
  });
});

describe('the detector on a page you opened', () => {
  it('finds a sponsor named in the description with a chapter', () => {
    const v = verdictOf({
      kind: 'video', channel: { channelId: 'UCaaaaaaaaaaaaaaaaaaaaaa', name: 'Some Channel', source: 'page' },
      video: { source: 'page', videoId: 'abcdefghijk', channelId: 'UCaaaaaaaaaaaaaaaaaaaaaa', description: 'Sponsored by Surfshark: https://surfshark.com/some\n\n0:00 Intro\n2:00 Surfshark\n3:10 Back to it', chapters: [{ title: 'Intro', startSeconds: 0 }, { title: 'Surfshark', startSeconds: 120 }, { title: 'Back to it', startSeconds: 190 }], paidPromotion: true, lengthSeconds: 600, category: null },
    });
    expect(v.sponsored).toBe(true);
    expect(v.brand?.toLowerCase()).toContain('surfshark');
  });
});

describe("YouTube's own captions join the vote (no key)", () => {
  const page = {
    kind: 'video' as const, channel: { channelId: 'UCaaaaaaaaaaaaaaaaaaaaaa', name: 'Some Channel', source: 'page' as const },
    video: { source: 'page' as const, videoId: 'abcdefghijk', channelId: 'UCaaaaaaaaaaaaaaaaaaaaaa', description: 'A video about plants.', lengthSeconds: 600, chapters: [] },
  };
  const lines = [{ t: 100, text: 'so welcome back to the garden' }, { t: 118, text: 'this video is sponsored by Surfshark' }, { t: 124, text: 'use code PLANTS for 80 percent off at surfshark dot com' }, { t: 175, text: 'anyway back to the plants' }];
  it('finds a spoken-only ad the description never mentions, with its time', () => {
    const v = verdictOf(page as never, { state: 'ok', lines });
    expect(v.sponsored).toBe(true);
    expect(v.brand?.toLowerCase()).toContain('surfshark');
    expect(v.start).toBeGreaterThanOrEqual(110);
    expect(v.start).toBeLessThanOrEqual(120);
  });
  it('goes on with the other checks when YouTube refuses the quiet route', () => {
    const v = verdictOf(page as never, { state: 'trouble', why: 'The quiet route is paused' });
    expect(v.sponsored).toBe(false);
  });
  it('says nothing for a video with no captions', () => expect(verdictOf(page as never, { state: 'none' }).sponsored).toBe(false));
});

describe('an integrated sponsor (YCImaging, "Sponsored By SmallRig", 2026-10-22)', () => {
  // The real lines that mention the brand in that video (captions as YouTube wrote them); the creator uses the gear through the video and plugs it at the end.
  const lines = [[74, 'brains of this all is the Creator Kit by'], [76, "SmallRig for the iPhone 18 Pro. It's"], [79, 'essentially this very minimal cage'], [144, 'then the next accessory I have connected'], [146, 'to this USB-C hub is the SmallRig power'], [148, 'bank. This battery is tight.'], [160, 'this uh creator kit using this magic arm'], [162, 'from SmallRig also. I\'m able to pivot'], [184, 'mounting system for this variable ND'], [186, 'filter, which is also by SmallRig. And I'], [209, 'entire setup, I got the wireless'], [211, 'SmallRig monitor. This is just to help'], [213, 'me monitor myself wirelessly from the'], [582, "I love Huckberry, it's one of my"], [1708, 'accessories to your iPhone, definitely'], [1710, 'check out this Creator Kit by SmallRig.'], [1713, 'Just the brains of this Creator Kit, the']].map(([t, text]) => ({ t: t as number, text: text as string }));
  it('marks the stretch where the creator talks about the brand, and the closing plug', () => {
    const s = brandStretches(lines, 'SmallRig');
    expect(s[0]).toEqual({ start: 76, end: 217 }); // 76 (name split over a line break) .. the last mention at 211, a line later, plus 4
    expect(s.length).toBe(2);
    expect(s[1].start).toBe(1710); // a single mention counts when it is plainly a plug ("check out")
  });
  it('does not mark a brand named once in passing', () => {
    expect(brandStretches([{ t: 10, text: 'I like Acme a lot' }, { t: 400, text: 'and that is all' }], 'Acme')).toEqual([]);
    expect(brandStretches(lines, 'Hi')).toEqual([]); // a very short name is never searched for
  });
});
