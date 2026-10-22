import { describe, expect, it } from 'vitest';
import { doorOfLine, doorWord, doorSummary, DOOR_NONE } from './door';

// The Operating Plan's door detection (Oct 2026): "Apps Script rules match known affiliate domains, ref params and promo codes". Plain rules, no AI.
describe('doorOfLine: how a sponsored description line shows a brand lets creators in', () => {
  it('names the affiliate network behind a click-counting link', () => {
    expect(doorOfLine('Try it free: https://imp.i384100.net/ABC123')).toEqual({ kind: 'network', via: 'Impact' });
    expect(doorOfLine('Get 20% off https://notion.sjv.io/fireship')).toEqual({ kind: 'network', via: 'Impact' });
    expect(doorOfLine('Sign up https://www.shareasale.com/r.cfm?b=1&u=2')).toEqual({ kind: 'network', via: 'ShareASale' });
    expect(doorOfLine('Deal https://www.awin1.com/cread.php?awinmid=1&awinaffid=2')).toEqual({ kind: 'network', via: 'Awin' });
    expect(doorOfLine('https://www.anrdoezrs.net/click-1-2')).toEqual({ kind: 'network', via: 'CJ' });
    expect(doorOfLine('https://prf.hn/click/camref:1/destination:https://x.com')).toEqual({ kind: 'network', via: 'Partnerize' });
    expect(doorOfLine('Join https://partnerstack.com/x')).toEqual({ kind: 'network', via: 'PartnerStack' });
  });
  it('sees a referral tag on the brand\'s own link', () => {
    expect(doorOfLine('Try Surfshark https://surfshark.com/?ref=abaandpreach')).toEqual({ kind: 'ref', via: 'ref' });
    expect(doorOfLine('Try it https://brand.com/signup?via=jane')).toEqual({ kind: 'ref', via: 'via' });
    expect(doorOfLine('https://brand.com/?fpr=jane&utm_source=yt')).toEqual({ kind: 'ref', via: 'fpr' });
    expect(doorOfLine('https://brand.com/x?utm_medium=affiliate')).toEqual({ kind: 'ref', via: 'utm_medium=affiliate' });
  });
  it('sees a link to the brand\'s own program or creators page', () => {
    expect(doorOfLine('Partner with us https://brand.com/affiliates')).toEqual({ kind: 'program-page', via: '/affiliates' });
    expect(doorOfLine('https://www.brand.io/creators/apply')).toEqual({ kind: 'program-page', via: '/creators' });
  });
  it('counts a personal promo code as a deal the brand runs with creators', () => {
    expect(doorOfLine('Use code ABAANDPREACH for 20% off at https://surfshark.com')).toEqual({ kind: 'code', via: null });
  });
  it('says nothing for plain brand links and the creator\'s own pages', () => {
    expect(doorOfLine('Try it here https://coderabbit.ai')).toBeNull();
    expect(doorOfLine('Follow me https://instagram.com/me?ref=profile')).toBeNull();
    expect(doorOfLine('https://www.youtube.com/watch?v=abc&ref=x')).toBeNull();
    expect(doorOfLine('')).toBeNull();
  });
  it('strongest sign wins: a network link beats a bare code', () => {
    expect(doorOfLine('Use code JANE at https://x.sjv.io/abc')?.kind).toBe('network');
  });
});

describe('door words and the summary across a brand\'s videos', () => {
  it('stores and reads back a compact word', () => {
    expect(doorWord({ kind: 'network', via: 'Impact' })).toBe('network:Impact');
    expect(doorWord({ kind: 'code', via: null })).toBe('code');
    expect(doorWord(null)).toBe(DOOR_NONE);
  });
  it('is not checked when no video was read for it', () => {
    expect(doorSummary([null, null])).toEqual({ checked: 0, open: 0, route: 'unknown', points: null, via: null, kind: null });
  });
  it('is a program door worth 30 when any checked video shows a sign, naming the strongest', () => {
    const s = doorSummary(['none', 'code', 'network:Impact', null]);
    expect(s).toMatchObject({ checked: 3, open: 2, route: 'program', points: 30, via: 'Impact', kind: 'network' });
  });
  it('is cold (0 points) when videos were read and none shows a sign', () => {
    expect(doorSummary(['none', 'none'])).toEqual({ checked: 2, open: 0, route: 'cold', points: 0, via: null, kind: null });
  });
});

import { doorForBrand } from './door';
describe('doorForBrand: the lines that mention the brand', () => {
  const d = 'New video!\nSurfshark VPN deal: https://surfshark.com/?ref=abaandpreach\nFollow me https://instagram.com/x';
  it('reads the door off the brand\'s own line', () => {
    expect(doorForBrand(d, 'Surfshark', 'surfshark.com')).toBe('ref:ref');
  });
  it('is none when the brand is on a line with no sign, and null when there is no description', () => {
    expect(doorForBrand('Thanks to CodeRabbit https://coderabbit.ai', 'CodeRabbit', 'coderabbit.ai')).toBe('none');
    expect(doorForBrand(null, 'X')).toBeNull();
  });
});
