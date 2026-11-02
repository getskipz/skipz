import { describe, it, expect } from 'vitest';
import { parseXmlCaptions, parseCaptionBody, textOverlap, otherText, type CaptionTrack } from './captions';

describe('route B: reading the caption track the player downloads', () => {
  it('reads the newer XML (<p t="ms"><s>words</s></p>) and the older <text start="s"> form', () => {
    const newer = '<?xml version="1.0"?><timedtext format="3"><body><p t="1500" d="2000"><s>hello</s><s t="400"> there</s></p><p t="1900" d="900">and &amp; welcome</p><p t="9000" d="100"></p></body></timedtext>';
    expect(parseXmlCaptions(newer)).toEqual([{ t: 1, text: 'hello there and & welcome' }]);
    const older = '<transcript><text start="2.5" dur="3">it&#39;s a sponsor</text><text start="9" dur="2">back to it</text></transcript>';
    expect(parseXmlCaptions(older)).toEqual([{ t: 2, text: "it's a sponsor" }, { t: 9, text: 'back to it' }]);
  });
  it('picks json3 or XML by how the file starts, and ignores anything else', () => {
    expect(parseCaptionBody(JSON.stringify({ events: [{ tStartMs: 4000, segs: [{ utf8: 'json line' }] }] }))).toEqual([{ t: 4, text: 'json line' }]);
    expect(parseCaptionBody('<transcript><text start="1" dur="1">xml line</text></transcript>')).toEqual([{ t: 1, text: 'xml line' }]);
    expect(parseCaptionBody('not captions')).toEqual([]);
  });
  it('says a copy of the panel text is not a second reading, and a different spelling is', () => {
    const panel = [{ t: 0, text: 'this video is sponsored by clover' }, { t: 5, text: 'the best way to get cash early' }];
    const same: CaptionTrack = { lang: 'en', auto: true, lines: [{ t: 1, text: 'This video is sponsored by Clover!' }, { t: 6, text: 'the best way to get cash early' }] };
    const other: CaptionTrack = { lang: 'en', auto: false, lines: [{ t: 0, text: 'Today we talk about something else entirely' }, { t: 5, text: 'a creator wrote this one by hand, with Klover' }] };
    expect(textOverlap(same.lines, panel)).toBeGreaterThanOrEqual(0.9);
    expect(otherText([same], panel)).toBeNull();
    expect(otherText([same, other], panel)).toBe(other);
    expect(otherText([other], null)).toBeNull();
  });
});
