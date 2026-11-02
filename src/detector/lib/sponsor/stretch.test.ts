import { describe, expect, it } from 'vitest';
import salem from './fixtures/real-2026-11-01-salem.json';
import dt from './fixtures/real-2026-11-01-designtheory.json';
import { echoStretches, probableStretches } from './stretch';

// The sponsor is KNOWN (YouTube's label, the description) but no spoken cue or brand name placed it. Skipz must still mark where the description's own offer is repeated (maintainer, 2026-11-01: "not marking is not acceptable",
// then "no guesses, just certainty": echo only). Salem Techsperts (_Lwj9lmFkO8): War Thunder is read at 9:36 to 10:27 and plugged again at 32:45. Design Theory (bjE6HYuEA1k): AnyDesk is read at 6:15; the Theranos story at 15:01 is NOT an ad.
const mm = (t: number) => Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');

describe('echoStretches: the stretch that says the words of the description\'s offer', () => {
  it('finds the War Thunder read from the description line alone, without the brand or any cue', () => {
    const s = echoStretches(salem.read.lines, salem.description);
    expect(s.length).toBeGreaterThan(0);
    expect(s[0].start, mm(s[0].start)).toBeGreaterThanOrEqual(570);
    expect(s[0].start).toBeLessThanOrEqual(585);
    expect(s[0].end, mm(s[0].end)).toBeGreaterThanOrEqual(615);
    expect(s[0].end).toBeLessThanOrEqual(640);
  });
  it('finds the plug at the end of the video as well', () => {
    const s = echoStretches(salem.plug.lines, salem.description);
    expect(s.length).toBeGreaterThan(0);
    expect(s[0].start).toBeGreaterThanOrEqual(1940);
    expect(s[0].start).toBeLessThanOrEqual(1970);
  });
  it('finds nothing in ordinary talk of the same video', () => {
    expect(echoStretches(salem.talk.lines, salem.description)).toEqual([]);
  });
  it('finds nothing in the Theranos story even though the video is sponsored', () => {
    expect(echoStretches(dt.theranos.lines, 'Download AnyDesk for free today using my link: https://Anydesk.com/DesignTheory')).toEqual([]);
  });
  it('says nothing when the description has too few words of its own to match (no guess from selling lines)', () => {
    expect(echoStretches(salem.read.lines, 'Sponsored. Link: https://x.co/a')).toEqual([]);
    expect(echoStretches(salem.read.lines, null)).toEqual([]);
    expect(probableStretches(salem.read.lines, 'Sponsored. Link: https://x.co/a')).toEqual([]);
  });
});

describe('probableStretches', () => {
  it('says how it found the stretch', () => {
    expect(probableStretches(salem.read.lines, salem.description)[0].how).toBe('echo');
  });
});

// "too many false segments" (maintainer, 2026-11-01, mhGri6rcYmc, a speaker board review with a paid label): the creator talks about the product all video, so the description's product words match everywhere. Only a stretch that also SELLS
// (a discount code, a link in the description) is an ad moment; product talk alone is not.
import seeed from './fixtures/real-2026-11-01-seeed.json';
describe('echo stretches in a review of the sponsor\'s own product', () => {
  const s = echoStretches(seeed.all.lines, seeed.description);
  it('marks only the stretch that holds the discount code (about 14:57), not the product talk', () => {
    expect(s.length).toBe(1);
    expect(s[0].start).toBeLessThanOrEqual(897);
    expect(s[0].end).toBeGreaterThanOrEqual(905);
  });
});
