import { describe, it, expect } from 'vitest';
import { skipGate, effectiveMode, NEEDED } from './gate';
import { markFrom, verdictOf, burstsOfMark } from './verdict';

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
    expect(effectiveMode('skip')).toBe('ask');
    expect(effectiveMode('skip', ok)).toBe('skip');
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
    expect(markFrom('a', { ...good, brand: null }, 'page')).toBeNull();
    expect(markFrom('a', { ...good, end: null }, 'page')).toBeNull();
    expect(markFrom('a', { ...good, end: 1500 }, 'page')).toBeNull();
    expect(markFrom('a', { ...good, end: 122 }, 'page')).toBeNull();
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
