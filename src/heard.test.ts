import { describe, it, expect } from 'vitest';
import { cueIn, stillAd, quiet, tidyName, liveFromSlices, type Slice } from './heard';

describe('what Skipz makes of the words it hears', () => {
  it('starts a sponsor read on a cue phrase', () => {
    expect(cueIn('okay before we start this video is sponsored by Surfshark it is a VPN', [])?.brand).toBe('Surfshark');
  });
  it('does not start one on ordinary talk', () => {
    expect(cueIn('today we are looking at three tools that make building websites faster', [])).toBeNull();
  });
  it('starts one on a sales line that names a brand the page already named', () => {
    expect(cueIn('use code skipz for eighty percent off at surfshark dot com', ['Surfshark'])?.brand).toBe('Surfshark');
    expect(cueIn('use code skipz for eighty percent off', [])).toBeNull(); // a code alone, with no brand known, is not enough
  });
  it('tidies a name the speech model doubled', () => {
    expect(tidyName('Surfshark Surfshark')).toBe('Surfshark');
    expect(tidyName('Code Rabbit')).toBe('Code Rabbit');
    expect(tidyName(null)).toBeNull();
  });
  it('knows when it is still the ad, and when a stretch says nothing either way', () => {
    expect(stillAd('use code skipz for a discount', null)).toBe(true);
    expect(stillAd('the first tool is a framework that builds pages', 'Surfshark')).toBe(false);
    expect(quiet('')).toBe(true);
    expect(quiet('the first tool is a framework')).toBe(false);
  });
  it('places an ad from the slices alone and says when it has ended', () => {
    const s: Slice[] = [
      { at: 0, secs: 5, text: 'hey everyone welcome back to the channel' },
      { at: 5, secs: 5, text: 'this video is sponsored by Surfshark' },
      { at: 10, secs: 5, text: 'use code skipz for a discount' },
      { at: 15, secs: 5, text: 'okay back to the video the first tool' },
      { at: 20, secs: 5, text: 'is a framework that builds pages quickly' },
    ];
    expect(liveFromSlices(s, 'Surfshark')).toEqual({ brand: 'Surfshark', start: 3, end: 17, ended: true });
    expect(liveFromSlices(s.slice(0, 3), 'Surfshark')?.ended).toBe(false);
    expect(liveFromSlices([s[0]], 'Surfshark')).toBeNull();
  });
});
