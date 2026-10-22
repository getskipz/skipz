import { describe, it, expect } from 'vitest';
import { sponsorSaid, nameAfterCue, nameBeforeCue, byLabel, byDescription, byChapters, byTranscript, byComments, byAiRead, byWatch, combine, serviceOnly, adReaders, plainWordsOnly, isOwnName, scrubOwnBrand, burstsOf, type Vote } from './check';

// Real cases from the maintainer's Chrome (2026-09-29) where known.
const EXA = 'Exa gives your agents the largest index of public and private data. Get $20 in credits - https://dashboard.exa.ai/billing?coupon=x';
const DONATE = 'SPONSOR THOUSANDS OF NEW MUSLIMS AND SHAHADAHS AROUND THE GLOBE! DONATE: https://www.launchgood.com/v4/campaign/x';

describe('the Sponsor check: every method scores itself, the conductor combines', () => {
  it('Fireship / Exa: label + description name it at once; the time is missing, so watching would help', () => {
    const v = combine([byLabel(true), byDescription(EXA, true), byChapters([], ['Exa'], 400), byComments(null, ['Exa'])]);
    expect(v).toMatchObject({ sponsored: true, brand: 'Exa', agree: 2, ran: 2, needWatch: 'time', start: null });
    expect(v.confidence).toBeGreaterThan(0.8);
  });

  it('Fireship / Mux after Gemini watched: brand, time 4:24–5:21, 3 methods agree, nothing more to run', () => {
    const w = { sponsors: [{ brand: 'Mux', start: 264, end: 321, quote: 'check out Mux, the sponsor of today’s video' }], model: 'gemini-3.5-flash', ms: 73000 };
    const v = combine([byLabel(true), byDescription('Mux makes video easy. Try it free: https://mux.com/fireship', true), byWatch(w)]);
    expect(v).toMatchObject({ brand: 'Mux', agree: 3, start: 264, end: 321, timeBy: 'watch', needWatch: null });
    expect(v.confidence).toBeGreaterThan(0.95);
  });

  it("viewers' comments are a hint: they give the time to an ad another check found, never a vote (2026-10-04)", () => {
    const comments = ['4:31 skip the sponsor', 'the ad at 4:32 lol', 'great video', '4:30 sponsor ends 5:27'];
    const c = byComments(comments, ['Exa']);
    expect(c).toMatchObject({ said: 'unknown', start: 270, end: 327, score: 0 });
    expect(combine([byLabel(false), byDescription(EXA, false), c]).sponsored).toBe(false); // comments alone: no
    const v = combine([byLabel(true), byDescription(EXA, true), c]);
    expect(v).toMatchObject({ sponsored: true, brand: 'Exa', start: 270, timeBy: 'comments' });
  });

  it('Ali Dawah donation line: not a brand sponsor', () => {
    const v = combine([byLabel(false), byDescription(DONATE, false), byComments(['great reminder'], [])]);
    expect(v).toMatchObject({ sponsored: false, brand: null });
  });

  it('a chapter called "Sponsor" gives the time; the next chapter gives the end', () => {
    const ch = byChapters([{ title: 'Intro', startSeconds: 0 }, { title: 'Sponsor: NordVPN', startSeconds: 95 }, { title: 'Main part', startSeconds: 160 }], ['NordVPN'], 600);
    expect(ch).toMatchObject({ said: 'yes', brand: 'NordVPN', start: 95, end: 160 });
  });

  it('methods that disagree lower the confidence and ask for the watch', () => {
    const v = combine([byDescription('This video is sponsored by Brilliant.', false), byAiRead([{ brand: 'Skillshare', evidence: 'use code' }], 'Groq'), byAiRead([], 'Groq')]);
    expect(v.brand).toBe('Brilliant');
    expect(v.needWatch).toBe('disagree');
    expect(v.confidence).toBeLessThan(0.9);
  });

  it('nothing found anywhere: not sponsored, nothing to watch', () => {
    const v = combine([byLabel(false), byDescription('Just a video.', false), byAiRead([], 'Gemini')]);
    expect(v).toMatchObject({ sponsored: false, needWatch: null, ran: 1 });
  });
});

describe('viewers\' comments alone (maintainer, 2026-10-01: MKBHD "Dear YouTube!" has no ad)', () => {
  it('one viewer joking about YouTube\'s ads is not a sponsor', () => {
    const v = combine([byLabel(false), byDescription("Let's talk about this new video A/B testing feature", false), byChapters([], [], 600), byComments(['0:12 a million ads?', 'great video', 'love the red hoodie'], [])]);
    expect(v.sponsored).toBe(false);
  });
  it('one viewer can still give the time of an ad another check found', () => {
    const v = combine([byLabel(true), byDescription('Thanks to Brilliant for sponsoring this video', true), byComments(['skip the ad 3:10'], ['Brilliant'])]);
    expect(v).toMatchObject({ sponsored: true, brand: 'Brilliant', start: 190, timeBy: 'comments' });
  });
  it('even two viewers agreeing are only a hint', () => {
    expect(byComments(['3:10 sponsor', 'skip to 3:12 to skip the sponsor'], []).said).toBe('unknown');
  });
});

describe('the label is on but no ad words: name the brand from its link (maintainer, 2026-10-01)', () => {
  const DESC = 'New phone day!\nGrab the Motorola Razr here: https://www.motorola.com/us/razr\nMy gear: https://kit.co/shanecraig\nhttps://shanecraig.tech';
  it('names Motorola with its website; the creator\'s own site is skipped', () => {
    const v = combine([byLabel(true), byDescription(DESC, true, ['Shane Craig', '@shanecraigtech'])]);
    expect(v).toMatchObject({ sponsored: true, brand: 'Motorola', site: 'motorola.com' });
  });
  it('without the label, a plain link is not called a sponsor', () => {
    expect(combine([byLabel(false), byDescription(DESC, false, ['Shane Craig'])]).sponsored).toBe(false);
  });
  it('the creator\'s own website is never the sponsor', () => {
    expect(byDescription('Visit https://shanecraig.tech for more', true, ['Shane Craig', '@shanecraigtech']).said).toBe('unknown');
  });
});

describe('under 80% sure, Gemini checks (maintainer, 2026-10-01: "I feel we can use gemini to verify")', () => {
  it('the Ankerfast case (label + a bare Amazon-style brand link, 72%) asks Gemini to confirm', () => {
    const v = combine([byLabel(true), byDescription('Buy on Amazon: https://ankerfast.club/210CCampaign_SAMTIME_539126', true, ['SAMTIME'])]);
    expect(v.confidence).toBeLessThan(0.8);
    expect(v.needWatch).toBe('unsure');
  });
  it('a sure answer with its time needs nothing more', () => {
    const w = { sponsors: [{ brand: 'Mux', start: 264, end: 321, quote: 'Mux' }], model: 'g', ms: 1 };
    expect(combine([byLabel(true), byDescription('Mux makes video easy. Try it free: https://mux.com/fireship', true), byWatch(w)]).needWatch).toBeNull();
  });
});

describe('chapters name a sponsor only as a whole word (maintainer, 2026-10-01)', () => {
  it('"Turn Off Personalized Ads" is not a sponsor chapter', () => {
    const ch = [{ title: 'Your Channel Settings', startSeconds: 47 }, { title: 'Turn Off Personalized Ads', startSeconds: 184 }, { title: 'YouTube Location Settings', startSeconds: 239 }];
    expect(byChapters(ch, ['Ad', 'Personal', 'Set'], 400).said).toBe('unknown');
  });
  it('"Sponsor: NordVPN" and "NordVPN deal" still count', () => {
    expect(byChapters([{ title: 'NordVPN deal', startSeconds: 60 }, { title: 'Main', startSeconds: 120 }], ['NordVPN'], 400)).toMatchObject({ said: 'yes', brand: 'NordVPN', start: 60 });
  });
});

describe("the Transcript check (maintainer, 2026-10-04): YouTube's own lines, read without playing the video", () => {
  const L = (pairs: [number, string][]) => ({ state: 'ok' as const, lines: pairs.map(([t, text]) => ({ t, text })) });
  // Auto-captions: lower case, no punctuation, sentences split across lines.
  const T = L([[370, "and that's the camera app"], [392, 'this video is sponsored by wispr flow'], [395, "it's dictation that actually works"],
    [430, 'you can try it free'], [470, 'use code howtomen for a month of pro'], [488, 'link is in the description'], [494, "alright back to the apps"], [520, 'number seven is']]);
  it('finds where the ad starts and ends, and the brand Skipz already knows', () => {
    expect(byTranscript(T, ['Wispr Flow'])).toMatchObject({ said: 'yes', brand: 'Wispr Flow', start: 392, end: 494, score: 0.9 });
  });
  it('gives the ad its exact time ahead of chapters and viewers', () => {
    const v = combine([byLabel(false), byDescription('Sponsored by Wispr Flow! https://wisprflow.ai', false), byTranscript(T, ['Wispr Flow']), byComments(['6:40 skip the sponsor'], ['Wispr Flow'])]);
    expect(v).toMatchObject({ sponsored: true, brand: 'Wispr Flow', start: 392, end: 494, timeBy: 'transcript' });
  });
  it('a known brand next to a selling line counts even without "sponsored by"', () => {
    const t = L([[0, 'hey everyone'], [61, 'quick word about nordvpn'], [66, 'go to nordvpn.com slash shane'], [90, 'anyway the phone']]);
    expect(byTranscript(t, ['NordVPN'])).toMatchObject({ said: 'yes', start: 61, end: 90 });
  });
  // maintainer's Chrome (2026-10-04, Korra The Taymi): captions heard "Kalam" as "kadama"; AI read + Gemini named Kalam.
  it('hears a brand the captions misspelled, next to an ad line ("head over to the kadama")', () => {
    const t = L([[34, 'able to properly study islam and'], [44, 'everything in between'], [51, 'go ahead and head over to the kadama'], [55, 'all right and we are going to move on']]);
    const v = byTranscript(t, ['KALAM', 'Kalam']);
    expect(v).toMatchObject({ said: 'yes', brand: 'KALAM', start: 51 });
    expect(v.proof).toMatch(/kadama/);
    expect(v.proof).toMatch(/captions/i);
  });
  it('does not hear a brand in ordinary words, or without an ad line', () => {
    expect(byTranscript(L([[10, 'head over to the kitchen'], [20, 'the karma of it all']]), ['Kalam']).said).toBe('no');
    expect(byTranscript(L([[10, 'we talked about kadama today'], [20, 'nothing else']]), ['Kalam']).said).toBe('no');
  });
  it('download the app counts as an ad line', () => {
    expect(byTranscript(L([[12, 'download the kalam app now'], [20, 'back to it']]), ['Kalam'])).toMatchObject({ said: 'yes', start: 12 });
  });
  it('no ad words: says no, gently; no transcript or a closed panel: no opinion', () => {
    expect(byTranscript(L([[0, 'welcome back'], [30, 'today we test phones']]), [])).toMatchObject({ said: 'no' });
    expect(byTranscript({ state: 'none' }, []).said).toBe('unknown');
    expect(byTranscript({ state: 'timeout' }, []).said).toBe('unknown');
  });
});

describe('AI read shows the service, not the model (maintainer, 2026-10-04)', () => {
  it('Groq, not "Groq · openai/gpt-oss-20b"', () => {
    expect(serviceOnly('Groq · openai/gpt-oss-20b')).toBe('Groq');
    expect(byAiRead([{ brand: 'Notion', evidence: 'sponsored by Notion' }], 'Mistral · mistral-small').proof).toMatch(/^Mistral: /);
  });
});

describe('a misheard brand at a closing line', () => {
  it("leaves the ad's start to Gemini, and is the time only when nothing else has one", () => {
    const t = { state: 'ok' as const, lines: [[51, 'go ahead and head over to the kadama'], [55, 'all right moving on']].map(([s, text]) => ({ t: s as number, text: text as string })) };
    const watch = { method: 'watch' as const, said: 'yes' as const, brand: 'Kalam', start: 37, end: 54, score: 0.95, proof: 'The Kalam app' };
    expect(combine([byLabel(false), byTranscript(t, ['Kalam']), watch])).toMatchObject({ sponsored: true, start: 37, timeBy: 'watch' });
    expect(combine([byLabel(false), byTranscript(t, ['Kalam'])])).toMatchObject({ start: 51, timeBy: 'transcript' });
  });
});

describe("AI read must quote a payment (maintainer's ITG Gear video, 2026-10-04)", () => {
  it('a product named from a parts list is a hint, not a sponsor; affiliate links are named', () => {
    const v = byAiRead([{ brand: 'ASUS', evidence: 'ASUS RTX 3060 12GB Single fan' }], 'Groq · openai/gpt-oss-20b', null, [{ brand: 'Amazon' }, { brand: 'AliExpress' }]);
    expect(v).toMatchObject({ said: 'unknown', score: 0 });
    expect(v.proof).toMatch(/doesn’t say anyone paid/);
    expect(v.proof).toMatch(/affiliate links: Amazon, AliExpress/);
    expect(combine([byLabel(false), v, byWatch({ sponsors: [], model: 'g', ms: 31000 })]).sponsored).toBe(false);
  });
  it('a quote that says it paid still counts; no sponsor mentions the affiliate links', () => {
    expect(byAiRead([{ brand: 'NordVPN', evidence: 'Thanks to NordVPN for sponsoring this video' }], 'Groq', null)).toMatchObject({ said: 'yes', brand: 'NordVPN' });
    expect(byAiRead([], 'Groq', null, [{ brand: 'Amazon' }]).proof).toBe('Groq found no sponsor in the text · affiliate links: Amazon');
  });
});

describe("podcast-style sponsor reads (maintainer's screenshot, 2026-10-04: Zapier at 0:17, missed)", () => {
  const L = (pairs: [number, string][]) => ({ state: 'ok' as const, lines: pairs.map(([t, text]) => ({ t, text })) });
  it('hears "brought to you by", "our sponsor is", "supported by" and names the brand itself', () => {
    expect(byTranscript(L([[5, 'welcome back to the show'], [17, 'this episode is brought to you by zapier the ai automation company'], [40, 'ok first repo']]), [])).toMatchObject({ said: 'yes', brand: 'Zapier', start: 17 });
    expect(nameAfterCue('our sponsor today is notion and')).toBe('Notion');
    expect(nameAfterCue('this video is supported by our friends at Wispr Flow who')).toBe('Wispr Flow');
    expect(nameAfterCue('sponsored by the people who watch')).toBeNull();
  });
  it('"supported by" in ordinary speech is not an ad (maintainer\'s screenshot, 2026-10-10: Physical, 90%)', () => {
    const v = byTranscript(L([[660, 'the ecosystem supported by physical discs and cartridges'], [665, 'and because of that there is no real way around it']]), []);
    expect(v.said).toBe('no');
    expect(byTranscript(L([[5, 'this episode is supported by zapier the ai automation company'], [30, 'ok back to the news']]), [])).toMatchObject({ said: 'yes', brand: 'Zapier' });
    expect(byTranscript(L([[5, 'quick word from our sponsor'], [8, 'supported by notion the all in one workspace'], [30, 'ok back']]), [])).toMatchObject({ said: 'yes' });
  });
  it('"powered by" in a tech video is not an ad', () => {
    expect(byTranscript(L([[5, 'this pc is powered by an rtx 4090'], [20, 'and it runs cool']]), []).said).toBe('no');
  });
  it('no sponsor means no ad time, even when a viewer gave one', () => {
    const v = combine([byLabel(false), byTranscript(L([[5, 'welcome'], [20, 'today we test']]), []), { method: 'comments', said: 'unknown', score: 0, start: 239, proof: '3:59 skip' }]);
    expect(v).toMatchObject({ sponsored: false, start: null });
  });
});

describe("The Next New Thing (maintainer's screenshots, 2026-10-04): Zapier said and presented", () => {
  const L = (pairs: [number, string][]) => ({ state: 'ok' as const, lines: pairs.map(([t, text]) => ({ t, text })) });
  it('"by the way, Zapier is a sponsor" across two caption lines names Zapier', () => {
    const t = L([[404, "can see it. I'm glad to see that it's"], [425, 'doing better. We\'ve seen people use it'], [427, 'really well. Uh by the way, Zapier is a'], [430, "sponsor. I've got to tell you something"], [431, 'about the way that Zapier MCP has been']]);
    expect(byTranscript(t, [])).toMatchObject({ said: 'yes', brand: 'Zapier', start: 427 });
    expect(nameBeforeCue('honestly this is a sponsor')).toBeNull();
  });
  it('"Presented by Zapier: https://zapier.com/" counts in the description and as an AI quote', () => {
    expect(byDescription('Presented by Zapier: https://zapier.com/', false)).toMatchObject({ said: 'yes', brand: 'Zapier' });
    expect(byAiRead([{ brand: 'Zapier', evidence: 'Presented by Zapier: https://zapier.com/' }], 'Groq', null)).toMatchObject({ said: 'yes', brand: 'Zapier' });
  });
});

describe("Tina Huang (maintainer's screenshot, 2026-10-04): \"Sponsored by Cruso\"", () => {
  const d = 'Claim your free $5 on Crusoe Intelligence Foundry today 👉 https://console.crusoecloud.com/request?utm=tina\nIn this video I test every size local AI';
  it('names the brand as written in the line, not from the address', () => {
    expect(byDescription(d, true, ['Tina Huang'])).toMatchObject({ brand: 'Crusoe' });
  });
  it("the creator's spelling wins over the captions'", () => {
    const L = { state: 'ok' as const, lines: [{ t: 11, text: 'this video is sponsored by cruso' }, { t: 15, text: 'go claim your free credits' }] };
    const v = combine([byLabel(true), byDescription(d, true, ['Tina Huang']), byTranscript(L, ['Crusoe'])]);
    expect(v).toMatchObject({ sponsored: true, brand: 'Crusoe', start: 11 });
  });
});

describe('how many times "sponsor" is said (maintainer, 2026-10-04: "important")', () => {
  it('counts each mention with its time, shown on the Transcript row', () => {
    const t = { state: 'ok' as const, lines: [{ t: 17, text: 'this episode is sponsored by zapier' }, { t: 300, text: 'nothing here' }, { t: 427, text: 'by the way zapier is a' }, { t: 430, text: 'sponsor. I have to tell you' }] };
    expect(sponsorSaid(t.lines)).toEqual([17, 430]);
    const v = byTranscript(t, []);
    expect(v.mentions).toEqual([17, 430]);
    expect(v.proof).toMatch(/“sponsor” said 2× \(0:17, 7:10\)/);
    expect(sponsorSaid([{ t: 1, text: 'sponsorblock and unsponsored' }])).toEqual([]);
  });
});

describe('ad signals in the checks (maintainer, 2026-10-05: the classifier list)', () => {
  const T = (pairs: [number, string][]) => ({ state: 'ok' as const, lines: pairs.map(([t, text]) => ({ t, text })) });
  it('Transcript: a break cue, product talk and a code is an ad read even with no "sponsored by"', () => {
    const v = byTranscript(T([[10, 'so that is the setup'], [60, "let's take a quick break"], [63, "i've been using notion for years"], [67, 'use my code skipz and click the link below'], [80, 'ok back to the video']]), ['Notion']);
    expect(v).toMatchObject({ said: 'yes', brand: 'Notion', start: 60 });
    expect(v.proof).toMatch(/break|code|promo/i);
  });
  it('Transcript: signals alone, with no known brand, give a lower-scored guess with the phrases as proof', () => {
    const v = byTranscript(T([[10, 'so that is the setup'], [60, "let's take a quick break"], [63, "i've been using this app for years"], [67, 'sign up using my link']]), []);
    expect(v).toMatchObject({ said: 'yes', start: 60, score: 0.5 });
    expect(v.proof).toMatch(/ad signs/);
  });
  it('Transcript: the creator selling their own course is not a sponsor, even next to a known brand', () => {
    const v = byTranscript(T([[30, 'i edit everything in notion'], [34, 'and if you want to learn this check out my course'], [38, 'the link is in the description']]), ['Notion']);
    expect(v.said).toBe('no');
    expect(v.proof).toMatch(/own promotion/i);
  });
  it('Transcript: affiliate talk is noted but is not a sponsor', () => {
    const v = byTranscript(T([[20, 'the gear is linked below'], [24, 'those are affiliate links and i earn a commission']]), ['Amazon']);
    expect(v.said).toBe('no');
    expect(v.proof).toMatch(/affiliate/i);
  });
  it('Transcript: a brand merely named is still not a sponsor', () => {
    expect(byTranscript(T([[5, 'i opened notion and wrote the script there'], [9, 'it is fine honestly']]), ['Notion']).said).toBe('no');
  });
  it('Description: "Paid partnership with X" names the sponsor', () => {
    expect(byDescription('Paid partnership with Ridge Wallet. https://ridge.com/x', false)).toMatchObject({ said: 'yes', brand: 'Ridge Wallet' });
  });
  it("Description: a link on a line about the creator's own course is not a sponsor", () => {
    expect(byDescription('Join my course and sign up here: https://learncourse.com/me', false).said).toBe('unknown');
    expect(byDescription('Join my course and sign up here: https://learncourse.com/me', false).brand).toBeUndefined();
  });
  it('Description: an affiliate-link line is not a sponsor either', () => {
    expect(byDescription('Get 10% off with my affiliate link: https://somebrand.com/x', false).brand).toBeUndefined();
  });
});

describe('text from speech-to-text (Moonshine trial, 2026-10-05): spoken sponsor reads go through the same checks', () => {
  const T = (text: string) => ({ state: 'ok' as const, lines: text.split(/(?<=[.!?])\s+/).map((t, i) => ({ t: i * 3, text: t.toLowerCase().replace(/[^a-z0-9' ]/g, '') })) });
  it('names the brand in "thanks to X for sponsoring" and "paid partnership with X"', () => {
    expect(nameAfterCue('thanks to notion for sponsoring this episode')).toBe('Notion');
    expect(nameAfterCue('thanks to wispr flow for sponsoring this video')).toBe('Wispr Flow');
    expect(nameAfterCue('this is a paid partnership with kalam the new writing app')).toBe('Kalam');
  });
  it('a known one-word brand the captions split in two still matches ("Code Rabbit")', () => {
    const v = byTranscript(T('And now a word from our sponsor, Code Rabbit. Code Rabbit reviews your poll requests. Try it free using the link in the description.'), ['CodeRabbit']);
    expect(v).toMatchObject({ said: 'yes', brand: 'CodeRabbit' });
  });
  it('the "no ad" clips stay no (a brand merely named; the creator\'s own course)', () => {
    expect(byTranscript(T('So I opened Notion and wrote the whole script there. Honestly it is fine.'), ['Notion']).said).toBe('no');
    expect(byTranscript(T('If you want to learn this properly, check out my course. The link is in the description.'), ['Notion']).said).toBe('no');
  });
});

describe('the short AI question (2026-10-05)', () => {
  it('an AI read that was not asked about sponsors gives no "no" vote', () => {
    const v = byAiRead([], 'Groq · gpt-oss', null, [], false);
    expect(v).toMatchObject({ said: 'unknown', score: 0 });
    expect(v.proof).toMatch(/not asked about sponsors/);
    expect(byAiRead([], 'Groq · gpt-oss', null, [], true).said).toBe('no');
    expect(byAiRead([], 'Groq · gpt-oss').said).toBe('no'); // reads from before the short question
  });
});

describe('the AI quote is shown with one pair of quote marks (maintainer screenshot, Incogni, 2026-10-05)', () => {
  it('strips the quote marks the AI put around its own quote', () => {
    const v = byAiRead([{ brand: 'Incogni', evidence: '"Incogn, the sponsor of today\'s video."' }], 'Groq · gpt-oss', null);
    expect(v.proof).toBe('Groq: “Incogn, the sponsor of today\'s video.”');
  });
});

describe('a deal code in the description is an indicator until the video mentions it (maintainer, 2026-10-05: PureVPN /aff)', () => {
  const PURE = 'Do internet the right way and go anonymous online with PureVPN. Save 20% on 1 and 2 year plans with the code POLADR0ID20: https://billing.purevpn.com/aff?x=1';
  it('on its own it is only a hint: no sponsor', () => {
    const d = byDescription(PURE, false);
    expect(d).toMatchObject({ said: 'unknown', brand: 'PureVPN', score: 0.4 });
    expect(combine([byLabel(false), d]).sponsored).toBe(false);
  });
  it('with YouTube\'s paid label it is a sponsor, as before', () => {
    expect(combine([byLabel(true), byDescription(PURE, true)])).toMatchObject({ sponsored: true, brand: 'PureVPN' });
  });
  it('when the video says it (spoken near a sales line), the transcript makes it a sponsor and the description backs it', () => {
    const t = { state: 'ok' as const, lines: [{ t: 40, text: 'so i use purevpn when i travel' }, { t: 44, text: 'use my code and the link is in the description' }] };
    const v = combine([byLabel(false), byDescription(PURE, false), byTranscript(t, ['PureVPN'])]);
    expect(v).toMatchObject({ sponsored: true, brand: 'PureVPN' });
    expect(v.agree).toBeGreaterThanOrEqual(2);
  });
});

describe('a real Listen result (maintainer\'s Chrome, 2026-10-05: Arctic thermal paste video)', () => {
  const heard = "But before we get into that, here's a quick word from this video sponsor. Well, this is what's action. The Arctic MX7 Ultimate Performance Thermal Paste made to meet the";
  const lines = heard.split(/(?<=[.!?])\s+/).map((t, i) => ({ t: i * 4, text: t.toLowerCase().replace(/[^a-z0-9' ]/g, '') }));
  it('"a quick word from this video sponsor" starts the ad', () => {
    const v = byTranscript({ state: 'ok', lines }, ['Arctic']);
    expect(v).toMatchObject({ said: 'yes', brand: 'Arctic' });
  });
});

describe('a line that says the opposite is not an ad cue (DevOps Toolbox 7:38, maintainer\'s screenshot 2026-10-10)', () => {
  const lines = [
    { t: 282, text: 'Keeper DB is cleaning that up. It is Keeper Security\'s secure database tool' },
    { t: 300, text: 'head over to the link in the description to get started' },
    { t: 458, text: 'they\'re not the sponsor of this video, so even if you had the shred of bias' },
  ];
  it('does not start an ad at "they\'re not the sponsor of this video"', () => {
    const v = byTranscript({ state: 'ok', lines }, ['Keeper']);
    expect(v).toMatchObject({ said: 'yes', brand: 'Keeper' });
    expect(v.start).toBe(282);
  });
  it('without the brand known, a negated line alone is no ad', () => {
    expect(byTranscript({ state: 'ok', lines: [{ t: 10, text: 'this video is not sponsored by anyone' }, { t: 12, text: 'I paid for it myself' }] }, [])).toMatchObject({ said: 'no' });
  });
  it('does not count a negated mention in "sponsor said N times"', () => {
    expect(sponsorSaid([{ t: 5, text: 'this is not sponsored' }, { t: 9, text: 'sponsored by Acme' }])).toEqual([9]);
  });
});

describe('the main read, not the teaser (maintainer, 2026-10-12: Skipz said Zapier 0:17-0:20, SponsorBlock had the read at 7:09-8:24)', () => {
  const L = (pairs: [number, string][]) => ({ state: 'ok' as const, lines: pairs.map(([t, text]) => ({ t, text })) });
  const T = L([[5, 'welcome back to the show'], [17, 'this episode is brought to you by zapier the ai automation company'], [20, 'ok first repo'], [200, 'so that is the model'],
    [427, 'really well. uh by the way zapier is a'], [430, "sponsor. i've got to tell you something"], [433, 'zapier mcp lets you connect agents to 8000 apps'], [450, 'use my link below to try zapier free'], [470, 'zapier makes it easy'], [504, 'alright back to the repo'], [520, 'next up']]);
  it('picks the longer read as the ad and keeps both as segments', () => {
    const v = byTranscript(T, []);
    expect(v).toMatchObject({ said: 'yes', brand: 'Zapier', start: 427 });
    expect(v.end).toBeGreaterThanOrEqual(470);
    expect(v.end).toBeLessThanOrEqual(520);
    expect(v.segments).toEqual([{ start: 17, end: 20 }, expect.objectContaining({ start: 427 })]);
  });
  it('keeps a lone read as one ad with no segment list', () => {
    const v = byTranscript(L([[5, 'welcome'], [17, 'this episode is brought to you by zapier the ai automation company'], [30, 'use my link below to try zapier free'], [45, 'ok first repo']]), []);
    expect(v).toMatchObject({ said: 'yes', start: 17 });
    expect(v.segments).toBeUndefined();
  });
});

describe('Groq and Mistral do not vote on sponsors (maintainer, 2026-10-12)', () => {
  it('drops their reads from the ad check and keeps the others', () => {
    const reads = [{ by: 'Groq · openai/gpt-oss-20b' }, { by: 'Mistral · small' }, { by: 'Gemini · flash' }, { by: null }];
    expect(adReaders(reads).map((r) => r.by)).toEqual(['Gemini · flash', null]);
  });
});


describe("Just Pray: no \"sponsored by\" anywhere (maintainer, 2026-10-12: \"no one caught it, but its a tricky one\")", () => {
  const L = (pairs: [number, string][]) => ({ state: 'ok' as const, lines: pairs.map(([t, text]) => ({ t, text })) });
  const desc = 'Download the Just Pray App:\nhttps://justprayapp.co/farid\n\nWhy the Companions Converted to Islam:\nhttps://www.daral-arqam.co.uk/products/why-the-companions-converted';
  const T = L([[9, 'not. in fact usually when i have conversations with non muslims'], [90, 'and if your family struggles with worshiping on time then i got just the app for you'], [96, 'get on your app store and download yourself the just pray app it helps you with reminders for'],
    [105, 'prayer times and a kids mode'], [121, 'it up so that your kids get into the habit. just pick up the just pray app now. link in the pinned comment below.'], [130, 'so what is the core message of islam'], [200, 'the prophet was able to accomplish']]);
  it('names the app from the description as an indicator', () => {
    expect(byDescription(desc, false, ['Farid Responds'])).toMatchObject({ said: 'unknown', brand: 'Just Pray', site: 'justprayapp.co' });
  });
  it('hears the app read in the transcript and, with the description, calls it a sponsor', () => {
    const tv = byTranscript(T, ['Just Pray']);
    expect(tv).toMatchObject({ said: 'yes', brand: 'Just Pray' });
    expect(tv.start).toBeGreaterThanOrEqual(85);
    expect(tv.start).toBeLessThanOrEqual(96);
    expect(tv.end).toBeGreaterThanOrEqual(121);
    expect(tv.end).toBeLessThanOrEqual(135);
    expect(combine([byLabel(false), byDescription(desc, false, ['Farid Responds']), tv])).toMatchObject({ sponsored: true, brand: 'Just Pray' });
  });
  it('a plain mention of an app is still not an ad', () => {
    expect(byTranscript(L([[10, 'i use the just pray app sometimes'], [20, 'it is fine']]), ['Just Pray']).said).toBe('no');
  });
});

describe('a brand name split across two caption lines (maintainer, 2026-10-13: Just Pray read at 1:36 but Skipz said 2:02)', () => {
  const L = (pairs: [number, string][]) => ({ state: 'ok' as const, lines: pairs.map(([t, text]) => ({ t, text })) });
  it('starts at the first line of the read, not the first line that holds the whole name', () => {
    const T = L([[9, 'not. in fact usually when i have conversations'], [90, 'and if your family struggles with worshiping on time then i got just the app for you'], [96, 'get on your app store and download yourself the just'], [99, 'pray app it helps you with reminders for'], [105, 'prayer times and a kids mode'],
      [121, 'it up so that your kids get into the habit. just pick up the just pray'], [124, 'app now. link in the pinned comment below.'], [130, 'so what is the core message of islam']]);
    const v = byTranscript(T, ['Just Pray']);
    expect(v).toMatchObject({ said: 'yes', brand: 'Just Pray' });
    expect(v.start).toBeLessThanOrEqual(96);
    expect(v.start).toBeGreaterThanOrEqual(85);
  });
});

describe('junk brands (maintainer, 2026-10-13: "Fix junk brands", from the 100-find review)', () => {
  it('ordinary words and joining words are not brands, real names are', () => {
    for (const bad of ['Any', 'Physical', 'Plug', 'Sucks', 'Micro', 'Joplain If', 'The', 'Just Okay']) expect(plainWordsOnly(bad)).toBe(true);
    for (const ok of ['Notion', 'Zapier', 'Wispr Flow', 'Just Pray', 'Boot', 'Surfshark', 'Linear', 'Incogni']) expect(plainWordsOnly(ok)).toBe(false);
  });
  it('a name pulled out of spoken words is dropped when it is only ordinary words', () => {
    expect(nameAfterCue('this video is sponsored by any of the')).toBeNull();
    expect(nameAfterCue('this video is sponsored by Notion the all in one')).toBe('Notion');
    expect(nameBeforeCue('plug is a sponsor of this video')).toBeNull();
    expect(nameBeforeCue('Incogni is a sponsor of this video')).toBe('Incogni');
  });
  it('the channel\'s own name is not a sponsor', () => {
    expect(isOwnName('Southern Adventures.', ['Southern Adventures', '@southernadventures'])).toBe(true);
    expect(isOwnName('ReStructure AI', ['ReStructure AI'])).toBe(true);
    expect(isOwnName('Notion', ['Thomas Frank'])).toBe(false);
    expect(isOwnName('Anker', ['Anker Innovations Reviews'])).toBe(false);
    const v = scrubOwnBrand([{ method: 'transcript', said: 'yes', brand: 'ReStructure AI', proof: 'Said at 0:12' }, { method: 'label', said: 'yes', brand: null, proof: 'Paid promotion' }], ['ReStructure AI']);
    expect(v[0]).toMatchObject({ said: 'unknown', brand: null });
    expect(v[1]).toMatchObject({ said: 'yes' });
  });
});

describe('burstsOf: every ad burst Skipz found', () => {
  const v = (start: number | null, votes: Vote[]) => ({ start, end: start === null ? null : start + 60, votes });
  const tx = (segments?: { start: number; end: number }[]): Vote => ({ method: 'transcript', said: 'yes', score: 0.9, proof: '', ...(segments ? { segments } : {}) });
  it('is the main time alone when there is one burst', () => expect(burstsOf(v(263, [tx()]))).toEqual([{ start: 263, end: 323, main: true }]));
  it('lists the short plug and the main read, the main one first', () => {
    const b = burstsOf(v(263, [tx([{ start: 71, end: 74 }, { start: 263, end: 332 }])]));
    expect(b.map((x) => x.start + (x.main ? '*' : ''))).toEqual(['263*', '71']);
  });
  it('does not count the same burst twice (within 10 s)', () => expect(burstsOf(v(263, [tx([{ start: 258, end: 330 }])])).length).toBe(1));
  it('keeps the others in time order', () => {
    const b = burstsOf(v(300, [tx([{ start: 20, end: 25 }, { start: 300, end: 360 }, { start: 150, end: 160 }])]));
    expect(b.map((x) => x.start)).toEqual([300, 20, 150]);
  });
  it('finds bursts even when the verdict has no main time', () => expect(burstsOf(v(null, [tx([{ start: 71, end: 74 }])]))).toEqual([{ start: 71, end: 74, main: true }]));
  it('ignores segments of other methods', () => expect(burstsOf(v(263, [{ method: 'comments', said: 'yes', score: 0.4, proof: '', segments: [{ start: 5, end: 9 }] }])).length).toBe(1));
});
