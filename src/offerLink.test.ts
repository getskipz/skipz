// The real description lines of videos from the maintainer's tests (2026-11-02), kept inline so this test runs anywhere. The link must be the sponsor's own address from the description, or nothing.
import { describe, it, expect } from 'vitest';
import { offerLink } from './offerLink';
import { endOffer } from './endOffer';

const ABACUS = `Try BrowOs : https://browos.site

support the project :) https://ko-fi.com/browos

Abacus ai agent:
Give the Abcaus AI agent a shot : https://agent.abacus.ai/ayl

Discord: https://discord.gg/wsJxszjdj`;
const SEEED = `Ad: Get the reSpeaker XVF3800 with XIAO ESP32-S3, 5% off with my affiliate link: https://www.seeedstudio.com/ReSpeaker-XVF3800-4-Mic-Array-With-XIAO-ESP32S3-p-6489.html?sensecap_affiliate=fz3LZ3Q&referring_service=link

Build your own:
Speaker, Gikfun 2" 4 Ω 5 W: https://link.amazon/B01NHZnor`;
const PROTON = `Join Proton's Black Friday Sale for FREE with our link: https://www.protonvpn.com/dylanpage
Join the Empire's Patreon: https://patreon.com/DylanPage?utm_medium=youtube`;
const XFCE = `Hacker Blueprint: over 400 lessons on Linux, networking and Python that teach hacking from zero, with a Kali terminal next to every lesson. Try it free at https://hackerblueprint.com/yt/rootsh

Chapters:
0:00 Intro`;

describe('the sponsor\'s own link from the description', () => {
  it('Abacus AI: the address on the sponsor line, not the creator\'s own project (browos.site)', () => {
    expect(offerLink(ABACUS, 'Abacus AI')).toBe('https://agent.abacus.ai/ayl');
  });
  it('Seeed Studio: the address that carries the channel\'s affiliate tag', () => {
    const u = offerLink(SEEED, 'Seeedstudio');
    expect(u).toMatch(/^https:\/\/www\.seeedstudio\.com\//);
    expect(u).toContain('sensecap_affiliate=fz3LZ3Q');
  });
  it('Proton: the link made for this creator', () => {
    expect(offerLink(PROTON, 'Proton')).toBe('https://www.protonvpn.com/dylanpage');
  });
  it('Hacker Blueprint: the "Try it free at" address', () => {
    expect(offerLink(XFCE, 'Hacker Blueprint')).toBe('https://hackerblueprint.com/yt/rootsh');
  });
  it('no link when the description has no address for the sponsor: no button', () => {
    expect(offerLink(PROTON, 'Hacker Blueprint')).toBeNull();
  });
  it('never returns YouTube, a non-web address, or a link for another brand', () => {
    expect(offerLink('Code SAVE10 at https://youtu.be/abc and javascript:alert(1)', 'Acme Tools')).toBeNull();
    expect(offerLink('Join Patreon: https://patreon.com/x', 'Acme Tools')).toBeNull();
    expect(offerLink('Acme Tools 10% off: https://acmetools.com/yx?ref=me.', 'Acme Tools')).toBe('https://acmetools.com/yx?ref=me');
    expect(offerLink(null, 'Acme')).toBeNull();
    expect(offerLink('x https://acme.com', null)).toBeNull();
  });
  it('a short link works when the sponsor is named on the same line', () => {
    expect(offerLink('Get Zorbix 20% off here: https://bit.ly/zorbix-ytc', 'Zorbix')).toBe('https://bit.ly/zorbix-ytc');
  });
});

describe('the end-of-video offer (who sees the button)', () => {
  const mark = { videoId: 'abc12345678', brand: 'Proton', link: 'https://www.protonvpn.com/dylanpage' };
  it('a person who pressed Support me, on the marked video, with a link: the button', () => {
    expect(endOffer(true, mark, 'abc12345678')).toEqual({ url: 'https://www.protonvpn.com/dylanpage', name: 'Proton' });
  });
  it('nobody else: not pressed, no link, another video, no mark, or a non-web address', () => {
    expect(endOffer(false, mark, 'abc12345678')).toBeNull();
    expect(endOffer(true, { ...mark, link: undefined }, 'abc12345678')).toBeNull();
    expect(endOffer(true, mark, 'zzz12345678')).toBeNull();
    expect(endOffer(true, null, 'abc12345678')).toBeNull();
    expect(endOffer(true, { ...mark, link: 'javascript:alert(1)' }, 'abc12345678')).toBeNull();
  });
  it('an unnamed sponsor reads "the offer"', () => {
    expect(endOffer(true, { ...mark, brand: 'Sponsor' }, 'abc12345678')?.name).toBe('the offer');
  });
});
