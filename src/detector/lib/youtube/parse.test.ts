import { describe, it, expect } from 'vitest';
import { readPage, parseCount, relativeToDate, likesFrom, othersCount, channelLinks, channelAbout, ownerAvatar, type RawPage } from './parse';
import watch from './fixtures/watch-real.json';
import channel from './fixtures/channel-videos-synthetic.json';
import realChannel from './fixtures/channel-videos-real.json';

const NOW = new Date('2026-09-28T12:00:00Z');
const daysBefore = (iso: string | null | undefined) => (iso ? Math.round((NOW.getTime() - Date.parse(iso)) / 86400000) : null);

describe('numbers and dates as YouTube writes them', () => {
  it('counts', () => {
    expect(parseCount('1,821,100,547 views')).toBe(1821100547);
    expect(parseCount('4.55M subscribers')).toBe(4550000);
    expect(parseCount('4.55 million subscribers')).toBe(4550000);
    expect(parseCount('412K views')).toBe(412000);
    expect(parseCount('19M')).toBe(19000000);
    expect(parseCount('1.2B')).toBe(1200000000);
    expect(parseCount('318 videos')).toBe(318);
    expect(parseCount('No views')).toBe(0);
    expect(parseCount('Subscribe')).toBeNull();
    expect(parseCount('')).toBeNull();
  });
  it('relative dates', () => {
    expect(daysBefore(relativeToDate('5 days ago', NOW))).toBe(5);
    expect(daysBefore(relativeToDate('3 weeks ago', NOW))).toBe(21);
    expect(daysBefore(relativeToDate('2 months ago', NOW))).toBe(61);
    expect(daysBefore(relativeToDate('2y ago', NOW))).toBe(731);
    expect(daysBefore(relativeToDate('Streamed 1 day ago', NOW))).toBe(1);
    expect(relativeToDate('Premieres tomorrow', NOW)).toBeNull();
  });
});

describe('a real video page', () => {
  const r = readPage(watch as RawPage, NOW);
  it('reads the video exactly', () => {
    expect(r.kind).toBe('video');
    if (r.kind !== 'video') return;
    expect(r.video.videoId).toBe('dQw4w9WgXcQ');
    expect(r.video.title).toMatch(/Never Gonna Give You Up/);
    expect(r.video.views).toBe(1821100547);
    expect(r.video.likes).toBe(19427125);
    expect(r.video.postedAt).toBe('2009-10-25T06:57:33.000Z');
    expect(r.video.format).toBe('long');
    expect(r.video.lengthSeconds).toBe(213);
    expect(r.video.paidPromotion).toBe(false);
    expect(r.video.chapters).toEqual([]); // this video has a "most replayed" heat map, not chapters
    expect(r.video.description).toMatch(/official video/i);
  });
  it('reads who made it', () => {
    if (r.kind !== 'video') throw new Error('not a video');
    expect(r.channel).toMatchObject({ channelId: 'UCuAXFkgsw1L7xaCfnd5JJOw', handle: '@RickAstleyYT', name: 'Rick Astley', followers: 4550000 });
    expect(r.channel?.avatar).toMatch(/^https:\/\/yt3/);
  });
  it('refuses data from the previous page', () => {
    expect(readPage({ ...(watch as RawPage), url: 'https://www.youtube.com/watch?v=somethingElse' }).kind === 'unreadable').toBe(true);
    const m = readPage({ ...(watch as RawPage), url: 'https://www.youtube.com/watch?v=other' });
    expect(m).toEqual({ kind: 'unreadable', reason: 'mismatch' });
  });
  it('says so when the layout is not what Skipz expects', () => {
    expect(readPage({ url: 'https://www.youtube.com/watch?v=x', data: {}, player: {} })).toEqual({ kind: 'unreadable', reason: 'layout' });
  });
  it('finds chapters and the paid-promotion label when present', () => {
    const data = { chapters: [
      { chapterRenderer: { title: { simpleText: 'Intro' }, timeRangeStartMillis: 0 } },
      { chapterRenderer: { title: { simpleText: 'Sponsor: Acme' }, timeRangeStartMillis: 95000 } },
    ] };
    const player = { ...(watch as RawPage & { player: Record<string, unknown> }).player, paidContentOverlay: { paidContentOverlayRenderer: {} } };
    const r2 = readPage({ url: (watch as RawPage).url, data, player });
    if (r2.kind !== 'video') throw new Error('not a video');
    expect(r2.video.chapters).toEqual([{ title: 'Intro', startSeconds: 0 }, { title: 'Sponsor: Acme', startSeconds: 95 }]);
    expect(r2.video.paidPromotion).toBe(true);
  });
  it('reads the "most replayed" bars in both shapes (made-up shapes: UNVERIFIED on real pages)', () => {
    const player = (watch as RawPage & { player: Record<string, unknown> }).player;
    const newer = { frameworkUpdates: { entityBatchUpdate: { mutations: [{ payload: { macroMarkersListEntity: { markersList: { markerType: 'MARKER_TYPE_HEATMAP', markers: Array.from({ length: 100 }, (_, i) => ({ startMillis: String(i * 2000), durationMillis: '2000', intensityScoreNormalized: i === 3 ? 1 : 0.4 })) } } } }] } } };
    const r = readPage({ url: (watch as RawPage).url, data: newer, player });
    if (r.kind !== 'video') throw new Error('not a video');
    expect(r.video.replay).toHaveLength(100);
    expect(r.video.replay![3]).toEqual({ start: 6, len: 2, v: 1 });
    const older = { heatSeekerRenderer: { markers: Array.from({ length: 40 }, (_, i) => ({ heatMarkerRenderer: { timeRangeStartMillis: i * 3000, markerDurationMillis: 3000, heatMarkerIntensityScoreNormalized: 0.5 } })) } };
    const r2 = readPage({ url: (watch as RawPage).url, data: older, player });
    if (r2.kind !== 'video') throw new Error('not a video');
    expect(r2.video.replay).toHaveLength(40);
    const none = readPage({ url: (watch as RawPage).url, data: {}, player });
    if (none.kind !== 'video') throw new Error('not a video');
    expect(none.video.replay).toBeNull();
  });
  it('uses the newer on-screen numbers for the same video, never a previous video\'s', () => {
    const base = watch as RawPage;
    const live = { videoId: 'dQw4w9WgXcQ', viewsText: '1,900,000,000 views', likesLabel: 'like this video along with 19,500,000 other people' };
    const r1 = readPage({ ...base, live });
    expect(r1.kind === 'video' && [r1.video.views, r1.video.likes]).toEqual([1900000000, 19500000]);
    const r2 = readPage({ ...base, live: { ...live, videoId: 'previousVid' } });
    expect(r2.kind === 'video' && [r2.video.views, r2.video.likes]).toEqual([1821100547, 19427125]);
    const r3 = readPage({ ...base, live: { ...live, viewsText: '5 views', likesLabel: null } });
    expect(r3.kind === 'video' && r3.video.views).toBe(1821100547); // an older, lower number never replaces a newer one
  });

  it("a Short's likes and comments as YouTube writes them (real shapes, maintainer's Chrome 2026-09-29)", () => {
    const button = (dflt: string, title: string, toggled: string | null, status = 'INDIFFERENT') => ({ likeButtonViewModel: { likeStatusEntity: { likeStatus: status }, toggleButtonViewModel: { toggleButtonViewModel: {
      defaultButtonViewModel: { buttonViewModel: { iconName: 'EMPTY_HEART', title, accessibilityText: dflt } },
      ...(toggled ? { toggledButtonViewModel: { buttonViewModel: { iconName: 'FULL_HEART', title, accessibilityText: toggled } } } : {}) } } } });
    expect(likesFrom(button('like this video along with 406 thousand other people', '406K', '406,009 likes'))).toBe(406008);
    expect(likesFrom(button('like this video along with 406 thousand other people', '406K', '406,009 likes', 'LIKE'))).toBe(406009);
    expect(likesFrom(button('like this video along with 6.2 thousand other people', '6.2K', null))).toBe(6200); // was read as 6
    expect(likesFrom(button('like this video along with 36 other people', '36', '37 likes'))).toBe(36);
    expect(likesFrom(button('like this video', 'Like', '1 like'))).toBe(0);
    expect(othersCount('like this video along with 19,500,000 other people')).toBe(19500000);
    const data = { overlay: { actionBar: { buttonViewModels: [button('like this video along with 406 thousand other people', '406K', '406,009 likes'), { buttonViewModel: { iconName: 'SHORTS_COMMENT', title: '10K', accessibilityText: 'View 10,164 comments' } }] } } };
    const r = readPage({ ...(watch as RawPage), url: 'https://www.youtube.com/shorts/dQw4w9WgXcQ', data });
    expect(r.kind === 'video' && [r.video.likes, r.video.comments]).toEqual([406008, 10164]);
  });

  it('a Short is marked short', () => {
    const r3 = readPage({ ...(watch as RawPage), url: 'https://www.youtube.com/shorts/dQw4w9WgXcQ' });
    expect(r3.kind === 'video' && r3.video.format).toBe('short');
  });
});

describe('a REAL channel Videos tab (Marvel, captured 2026-09-29)', () => {
  const r = readPage(realChannel as RawPage, NOW);
  it('reads the channel exactly as YouTube shows it', () => {
    expect(r.kind).toBe('channel');
    if (r.kind !== 'channel') return;
    expect(r.channel).toMatchObject({ channelId: 'UCvC4D8onUfXzvjTOM-dBfEA', handle: '@marvel', name: 'Marvel Entertainment', followers: 23800000, videoCount: 10000 });
    expect(r.tab).toBe('Videos');
  });
  it('reads every listed video with its views and age', () => {
    if (r.kind !== 'channel') throw new Error('not a channel');
    expect(r.videos.map((v) => [v.videoId, v.views, v.postedText])).toEqual([
      ['1VJXur9ZfQQ', 58000, '2 hours ago'],
      ['nxDMRvDr4AQ', 1200000, '5 hours ago'],
      ['U-hHF_mLdSs', 119000, '9 hours ago'],
      ['uUmR6HBc-XI', 311000, '1 day ago'],
    ]);
    expect(r.videos[0].title).toMatch(/^Paul on Vision/);
  });
});

describe('a channel Videos tab (synthetic sample)', () => {
  const r = readPage(channel as RawPage, NOW);
  it('reads the channel', () => {
    expect(r.kind).toBe('channel');
    if (r.kind !== 'channel') return;
    expect(r.channel).toMatchObject({ channelId: 'UCsample0000000000000001', handle: '@SampleScience', name: 'Sample Science', followers: 1240000, videoCount: 318 });
    expect(r.tab).toBe('Videos');
  });
  it('reads the listed videos, new and old layouts', () => {
    if (r.kind !== 'channel') throw new Error('not a channel');
    expect(r.videos.map((v) => [v.videoId, v.views, daysBefore(v.postedAt)])).toEqual([
      ['vidAAAAAAA1', 412000, 5],
      ['vidAAAAAAA2', 1100000, 21],
      ['vidAAAAAAA3', 98120, 61],
    ]);
    expect(r.videos[1].postedText).toBe('3 weeks ago');
  });
  it('matches the handle whatever its capitals', () => {
    expect(readPage({ ...(channel as RawPage), url: 'https://www.youtube.com/@samplescience' }).kind).toBe('channel');
  });
  it('refuses another channel\'s leftover data', () => {
    expect(readPage({ ...(channel as RawPage), url: 'https://www.youtube.com/@SomeoneElse' })).toEqual({ kind: 'unreadable', reason: 'mismatch' });
  });
  it("refuses the Home tab's leftover data when the address is the Videos tab (Home -> Videos without a reload)", () => {
    const home = JSON.parse(JSON.stringify(channel));
    const tabs = home.data.contents.twoColumnBrowseResultsRenderer.tabs;
    tabs[0].tabRenderer.selected = true;
    tabs[1].tabRenderer.selected = false;
    expect(readPage({ ...home, url: 'https://www.youtube.com/@SampleScience/videos' })).toEqual({ kind: 'unreadable', reason: 'mismatch' });
  });

  it('takes no videos from the Home tab', () => {
    const home = JSON.parse(JSON.stringify(channel));
    const tabs = home.data.contents.twoColumnBrowseResultsRenderer.tabs;
    tabs[0].tabRenderer.selected = true;
    tabs[1].tabRenderer.selected = false;
    tabs[0].tabRenderer.content = tabs[1].tabRenderer.content;
    const r2 = readPage({ ...home, url: 'https://www.youtube.com/@SampleScience' }, NOW);
    expect(r2.kind === 'channel' && r2.videos.length).toBe(0);
    expect(r2.kind === 'channel' && r2.channel.followers).toBe(1240000);
  });
});

describe("a channel's links (About data, shaped like the real one checked 2026-09-29)", () => {
  it('reads every link, prefers the real address inside the redirect, keeps the channel id to check', () => {
    const link = (title: string, shown: string, q?: string) => ({ channelExternalLinkViewModel: { title: { content: title }, link: { content: shown,
      commandRuns: q ? [{ onTap: { innertubeCommand: { commandMetadata: { webCommandMetadata: { url: 'https://www.youtube.com/redirect?event=channel_description&q=' + encodeURIComponent(q) } } } } }] : undefined } } });
    const data = { onResponseReceivedEndpoints: [{ aboutChannelViewModel: { channelId: 'UCabc', links: [
      link('Instagram', 'instagram.com/tdrnetwork', 'https://www.instagram.com/tdrnetwork'),
      link('Website', 'thedailyreminder.org'),
      link('Twitter', 'twitter.com/TDR_Network', 'https://twitter.com/TDR_Network'),
      link('Instagram again', 'instagram.com/tdrnetwork', 'https://www.instagram.com/tdrnetwork'),
    ] } }] };
    expect(channelLinks(data)).toEqual({ channelId: 'UCabc', links: [
      { title: 'Instagram', url: 'https://www.instagram.com/tdrnetwork' },
      { title: 'Website', url: 'https://thedailyreminder.org' },
      { title: 'Twitter', url: 'https://twitter.com/TDR_Network' },
    ] });
    expect(channelLinks({})).toEqual({ channelId: null, links: [] });
  });
});

describe('a video posted by two channels together (maintainer, 2026-10-01: the picture showed "K")', () => {
  // Made-up shape: the owner block has no thumbnail; each channel's picture sits deeper beside its channel ID.
  const collab = {
    title: { runs: [{ text: 'Korra The Taymi and Korra The Taymi 2.0' }] },
    avatarStack: { avatars: [
      { image: { sources: [{ url: 'https://yt3.ggpht.com/second=s88' }] }, endpoint: { browseEndpoint: { browseId: 'UCsecond' } } },
      { image: { sources: [{ url: 'https://yt3.ggpht.com/first=s88' }] }, endpoint: { browseEndpoint: { browseId: 'UCfirst' } } },
    ] },
  };
  it("finds this channel's picture beside its ID", () => expect(ownerAvatar(collab, 'UCfirst')).toBe('https://yt3.ggpht.com/first=s88'));
  it('else the first channel picture', () => expect(ownerAvatar(collab, 'UCother')).toBe('https://yt3.ggpht.com/second=s88'));
  it('an ordinary owner block still uses its own thumbnail', () => expect(ownerAvatar({ thumbnail: { thumbnails: [{ url: 'https://yt3.ggpht.com/a=s48' }, { url: 'https://yt3.ggpht.com/a=s88' }] } }, 'UCx')).toBe('https://yt3.ggpht.com/a=s88'));
});

describe("a channel's About facts (maintainer, 2026-10-04)", () => {
  it('reads country, join date, total views, videos and subscribers; leaves out what is missing', () => {
    const data = { onResponseReceivedEndpoints: [{ aboutChannelViewModel: { channelId: 'UCabc', country: 'Nigeria', joinedDateText: { content: 'Joined Mar 5, 2014' }, viewCountText: '12,345,678 views', videoCountText: '312 videos', subscriberCountText: '1.2M subscribers' } }] };
    expect(channelAbout(data)).toEqual({ channelId: 'UCabc', country: 'Nigeria', joined: '2014-03-05', views: 12345678, videos: 312, subscribers: 1200000, description: null });
    const withText = { x: { aboutChannelViewModel: { channelId: 'UCabc', description: 'For collaboration: support@bytegrad.com\n\nHi, I am Wesley.' } } };
    expect(channelAbout(withText).description).toBe('For collaboration: support@bytegrad.com\n\nHi, I am Wesley.');
    expect(channelAbout({ x: { aboutChannelViewModel: { channelId: 'UCx' } } })).toEqual({ channelId: 'UCx', country: null, joined: null, views: null, videos: null, subscribers: null, description: null });
  });
});
