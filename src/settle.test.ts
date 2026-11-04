import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { settle } from './settle';
import { burstsOfMark, type Mark } from './verdict';

// SYNTHETIC inputs shaped like the report (maintainer, 2026-11-04: "the skipz marker was in the right place then abandoned its true mark and went for a false positive"; a sponsor read at 6:46 to 7:43, another stretch just before it).
// They show the rule, not the cause: the real recording of that video was not available when this was written.
const mark = (o: Partial<Mark> = {}): Mark => ({ videoId: 'abc123DEF45', brand: 'Mobbin', start: 406, end: 463, confidence: 0.85, from: 'page', ...o });

describe('the page script carries the same rule', () => {
  const block = (file: string): string => {
    const text = readFileSync(resolve(import.meta.dirname, file), 'utf8');
    const a = text.indexOf('// settle:begin'), b = text.indexOf('// settle:end');
    expect(a, file + ' has the begin marker').toBeGreaterThan(-1);
    expect(b, file + ' has the end marker').toBeGreaterThan(a);
    return text.slice(a, b).replace(/^export /m, '').replace(/\r\n/g, '\n').replace(/^\/\/ settle:begin\n/, '').trim();
  };
  it('content.ts has exactly the code of settle.ts between the markers', () => {
    expect(block('content.ts')).toBe(block('settle.ts'));
  });
});

describe('an answer, once made, does not change its mind (maintainer, 2026-11-04)', () => {
  it('the first answer is kept when a later check puts a sponsor somewhere else', () => {
    const first = mark();
    const later = mark({ start: 330, end: 404, brand: 'Notion', confidence: 0.95 });
    expect(settle(first, later)).toBe(first);
  });
  it('a later check that finds nothing never takes the mark away', () => {
    const first = mark();
    expect(settle(first, null)).toBe(first);
    expect(settle(first, undefined)).toBe(first);
  });
  it('the first answer is the answer when there was none before', () => {
    const later = mark();
    expect(settle(null, later)).toBe(later);
    expect(settle(undefined, null)).toBeNull();
  });
  it('a later check that agrees only makes it surer: the times do not move', () => {
    const first = mark({ confidence: 0.75 });
    const later = mark({ start: 410, end: 470, confidence: 0.95 });
    const kept = settle(first, later)!;
    expect(kept.start).toBe(406);
    expect(kept.end).toBe(463);
    expect(kept.confidence).toBe(0.95);
  });
  it('a plain "Sponsor" can learn the brand\'s name, still without moving', () => {
    const kept = settle(mark({ brand: 'Sponsor' }), mark({ brand: 'Mobbin', start: 400, end: 470 }))!;
    expect(kept.brand).toBe('Mobbin');
    expect(kept.start).toBe(406);
  });
  it('another video is not held to this one', () => {
    const other = mark({ videoId: 'zzz123DEF45' });
    expect(settle(mark(), other)).toBe(other);
  });
  it('a stretch heard live is not final: the page\'s answer comes in and the heard stretch stays beside it when apart', () => {
    const heard = mark({ from: 'heard', start: 100, end: 140, confidence: 0.8 });
    const page = mark();
    const kept = settle(heard, page)!;
    expect(kept.start).toBe(406);
    expect(burstsOfMark(kept).map((b) => [b.start, b.end])).toEqual([[406, 463], [100, 140]]); // the main stretch first, then the others
  });
});
