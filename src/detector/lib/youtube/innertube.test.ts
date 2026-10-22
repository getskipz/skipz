import { describe, it, expect } from 'vitest';
import { captionTracks, pickTrack, json3Url, parseJson3, commentsToken, parseComments, findAll, videoIdOf } from './innertube';

// Shapes copied from what the maintainer's real Chrome answered on 2026-10-08 (the /player track list: six tracks for the test video; the json3 caption file: 61 events; the comments answer: 20 comment
// entities with commentId, content.content, author.displayName, toolbar.likeCountNotliked, publishedTime).
const player = { playabilityStatus: { status: 'OK' }, captions: { playerCaptionsTracklistRenderer: { captionTracks: [
  { baseUrl: 'https://www.youtube.com/api/timedtext?v=x&lang=en&kind=asr&sig=1', languageCode: 'en', kind: 'asr' },
  { baseUrl: 'https://www.youtube.com/api/timedtext?v=x&lang=de-DE&sig=2', languageCode: 'de-DE' },
  { baseUrl: 'https://www.youtube.com/api/timedtext?v=x&lang=en&sig=3&fmt=srv3', languageCode: 'en' },
  { baseUrl: 'https://www.youtube.com/api/timedtext?v=x&lang=ja&sig=4', languageCode: 'ja' },
] } } };

describe('the transcript: caption tracks, then the caption file', () => {
  it('lists the tracks the player offers', () => {
    expect(captionTracks(player).map((t) => [t.lang, t.auto])).toEqual([['en', true], ['de-DE', false], ['en', false], ['ja', false]]);
    expect(captionTracks({ playabilityStatus: { status: 'UNPLAYABLE' } })).toEqual([]);
    expect(captionTracks(null)).toEqual([]);
  });
  it('picks the people-written track in the wanted language, then speech-to-text, then any written one', () => {
    const t = captionTracks(player);
    expect(pickTrack(t, 'en')).toMatchObject({ lang: 'en', auto: false });
    expect(pickTrack(t.filter((x) => !(x.lang === 'en' && !x.auto)), 'en')).toMatchObject({ lang: 'en', auto: true });
    expect(pickTrack(t, 'de')).toMatchObject({ lang: 'de-DE' });
    expect(pickTrack(t.filter((x) => x.auto), 'fr')).toMatchObject({ auto: true }); // only speech-to-text exists
    expect(pickTrack([], 'en')).toBeNull();
  });
  it('asks for the json3 form of the address, replacing any other format', () => {
    expect(json3Url('https://www.youtube.com/api/timedtext?v=x&lang=en&fmt=srv3')).toBe('https://www.youtube.com/api/timedtext?v=x&lang=en&fmt=json3');
    expect(json3Url('https://www.youtube.com/api/timedtext?v=x')).toBe('https://www.youtube.com/api/timedtext?v=x&fmt=json3');
  });
  it('reads timed lines, skipping empty rows and repeated times', () => {
    const file = JSON.stringify({ events: [
      { tStartMs: 0, dDurationMs: 1000 },
      { tStartMs: 1360, segs: [{ utf8: '[♪♪♪]' }] },
      { tStartMs: 18640, segs: [{ utf8: "♪ We're no" }, { utf8: '  strangers to love ♪' }] },
      { tStartMs: 20000, segs: [{ utf8: '\n' }] },
      { tStartMs: 18640, segs: [{ utf8: 'a repeated time' }] },
    ] });
    expect(parseJson3(file)).toEqual([{ t: 1, text: '[♪♪♪]' }, { t: 18, text: "♪ We're no strangers to love ♪ a repeated time" }]); // whole seconds; two captions in one second join
    expect(parseJson3('not json')).toEqual([]);
    expect(parseJson3('{}')).toEqual([]);
  });
});

describe('the comments token in the answer to /next', () => {
  const next = { contents: { results: { contents: [
    { itemSectionRenderer: { sectionIdentifier: 'comment-item-section', contents: [{ continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: 'COMMENT_TOKEN' } } } }] } },
  ] } } };
  it('finds it, and says nothing when there is none', () => {
    expect(commentsToken(next)).toBe('COMMENT_TOKEN');
    expect(commentsToken({ itemSectionRenderer: { sectionIdentifier: 'related', contents: [{ continuationCommand: { token: 'x' } }] } })).toBeNull();
    expect(commentsToken(null)).toBeNull();
  });
});

describe('the comments', () => {
  it('reads the shape real YouTube answers: threads list ids in order, the words sit in separate entities', () => {
    const j = {
      onResponseReceivedEndpoints: [{ reloadContinuationItemsCommand: { continuationItems: [
        { commentsHeaderRenderer: { countText: { runs: [{ text: '2,458' }, { text: ' Comments' }] } } },
        { commentThreadRenderer: { commentViewModel: { commentViewModel: { commentId: 'B' } } } },
        { commentThreadRenderer: { commentViewModel: { commentViewModel: { commentId: 'A' } } } },
      ] } }],
      frameworkUpdates: { entityBatchUpdate: { mutations: [
        { payload: { commentEntityPayload: { properties: { commentId: 'A', content: { content: 'first in the list of mutations' }, publishedTime: '2 days ago' }, author: { displayName: '@ann' }, toolbar: { likeCountNotliked: '12' } } } },
        { payload: { commentEntityPayload: { properties: { commentId: 'B', content: { content: 'shown first on the page' }, publishedTime: '1 day ago', pinnedText: 'Pinned' }, author: { displayName: '@bob' }, toolbar: { likeCountNotliked: '3' } } } },
      ] } },
    };
    const r = parseComments(j);
    expect(r.total).toBe(2458);
    expect(r.comments.map((c) => c.author)).toEqual(['@bob', '@ann']); // the order on the page, not the order of the list of changes
    expect(r.comments[0]).toMatchObject({ text: 'shown first on the page', pinned: true, likes: '3', when: '1 day ago' });
  });
  it('reads the older shape too: the thread holds the comment', () => {
    const j = { items: [{ commentThreadRenderer: { comment: { commentRenderer: { authorText: { simpleText: '@old' }, contentText: { runs: [{ text: 'old ' }, { text: 'shape' }] }, voteCount: { simpleText: '7' }, publishedTimeText: { runs: [{ text: '3 weeks ago' }] } } } } }] };
    expect(parseComments(j).comments).toEqual([{ author: '@old', text: 'old shape', likes: '7', when: '3 weeks ago', pinned: false }]);
  });
  it('is capped, and says nothing for an answer it does not understand', () => {
    const many = { items: Array.from({ length: 30 }, (_, i) => ({ commentThreadRenderer: { comment: { commentRenderer: { contentText: { simpleText: 'c' + i } } } } })) };
    expect(parseComments(many, 20).comments).toHaveLength(20);
    expect(parseComments({ nothing: true })).toEqual({ total: null, comments: [] });
  });
});

describe('small helpers', () => {
  it('finds objects by key anywhere, in order', () => { expect(findAll({ a: [{ k: { n: 1 } }, { b: { k: { n: 2 } } }] }, 'k').map((x) => x.n)).toEqual([1, 2]); });
  it('takes the video id from a watch or shorts address', () => {
    expect(videoIdOf('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=5')).toBe('dQw4w9WgXcQ');
    expect(videoIdOf('https://www.youtube.com/shorts/abcdefghijk')).toBe('abcdefghijk');
    expect(videoIdOf('https://www.youtube.com/@mkbhd')).toBeNull();
    expect(videoIdOf(undefined)).toBeNull();
  });
});
