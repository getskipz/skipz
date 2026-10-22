// The page reader's brain: turns the data YouTube already put on the page you opened into plain facts.
// Pure functions (tested on real page data in fixtures/). No key, no sign-in, nothing fetched here.
import type { ChannelFacts, VideoFacts } from '../../db/store';
import { classifyPage } from '../page';
import type { ReplayBar } from '../sponsor/replay';

export type Chapter = { title: string; startSeconds: number };
export type VideoRead = VideoFacts & {
  channelId: string | null;
  description: string | null;
  chapters: Chapter[];
  paidPromotion: boolean; // YouTube's own "Includes paid promotion" label
  lengthSeconds: number | null;
  category: string | null;
  replay?: ReplayBar[] | null; // the "most replayed" bars, when the page has them (lib/sponsor/replay.ts)
};
export type PageRead =
  | { kind: 'channel'; channel: ChannelFacts; videos: VideoFacts[]; tab: string | null }
  | { kind: 'video'; video: VideoRead; channel: ChannelFacts | null }
  // mismatch = YouTube still holds the previous page's data (it changes pages without reloading)
  // layout = the data isn't where Skipz expects it (YouTube changed its page)
  | { kind: 'unreadable'; reason: 'mismatch' | 'layout' | 'not-youtube' };

export type RawPage = {
  url: string;
  data: unknown;
  player: unknown;
  // What the watch page shows right now (YouTube keeps it updating); only trusted for the same video.
  live?: { videoId: string | null; viewsText: string | null; likesLabel: string | null } | null;
};

type Node = Record<string, any>;
const isObj = (v: unknown): v is Node => !!v && typeof v === 'object';

// Visit every object in a tree (YouTube's data is deep); stop descending when visit returns false.
function walk(root: unknown, visit: (key: string, value: Node) => boolean | void, depth = 0): void {
  if (!isObj(root) || depth > 80) return;
  for (const key of Object.keys(root)) {
    const v = root[key];
    if (!isObj(v)) continue;
    if (visit(key, v) === false) continue;
    walk(v, visit, depth + 1);
  }
}

// "like this video along with 58,560 other people" -> 58560. On big videos YouTube writes the number in words,
// "along with 406 thousand other people" -> 406000 (reading only "406" was the maintainer's Shorts bug, 2026-09-29).
export function othersCount(label: string | null | undefined): number | null {
  const m = label?.match(/along with (.+?) other/i);
  return m ? parseCount(m[1]) : null;
}

// Likes from YouTube's like button. It holds two states: the default one ("along with 406 thousand other people")
// and the one shown after YOU like it ("406,009 likes", exact). The exact one wins when present: minus your own
// like, unless you have already liked it. Checked on real Shorts in the maintainer's Chrome (2026-09-29).
export function likesFrom(vm: unknown): number | null {
  let others: number | null = null;
  let exactIfLiked: number | null = null;
  let status: string | null = null;
  let title: number | null = null;
  const visit = (node: unknown, parent: string, depth: number) => {
    if (!isObj(node) || depth > 30) return;
    if (typeof node.likeStatus === 'string') status = node.likeStatus;
    if (typeof node.accessibilityText === 'string') {
      const o = othersCount(node.accessibilityText);
      if (o !== null && others === null) others = o;
      const e = node.accessibilityText.match(/^([\d,]+) likes?$/i);
      if (e && parent === 'toggledButtonViewModel' && exactIfLiked === null) exactIfLiked = Number(e[1].replace(/,/g, ''));
    }
    if (parent !== 'toggledButtonViewModel' && /LIKE|HEART/.test(String(node.iconName)) && typeof node.title === 'string' && title === null) title = parseCount(node.title);
    for (const k of Object.keys(node)) visit(node[k], k === 'buttonViewModel' ? parent : k, depth + 1);
  };
  visit(vm, '', 0);
  if (exactIfLiked !== null) return status === 'LIKE' ? exactIfLiked : Math.max(0, exactIfLiked - 1);
  return others ?? title;
}

export function text(node: unknown): string {
  if (typeof node === 'string') return node;
  if (!isObj(node)) return '';
  if (typeof node.simpleText === 'string') return node.simpleText;
  if (typeof node.content === 'string') return node.content;
  if (Array.isArray(node.runs)) return node.runs.map((r: Node) => r.text || '').join('');
  return '';
}

const UNITS: Record<string, number> = { k: 1e3, thousand: 1e3, m: 1e6, million: 1e6, b: 1e9, billion: 1e9 };

// "1,821,100,547 views" / "4.55M subscribers" / "19M" / "25 million views" -> a number. English pages only
// for the short forms; anything else gives null (the card then shows YouTube's own text).
export function parseCount(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const s = raw.replace(/ /g, ' ').trim().toLowerCase();
  if (/^no\b/.test(s)) return 0;
  const m = s.match(/(\d[\d,]*(?:\.\d+)?)\s*(thousand|million|billion|k|m|b)?(?![a-z])/);
  if (!m) return null;
  const n = parseFloat(m[1].replace(/,/g, ''));
  return Math.round(n * (m[2] ? UNITS[m[2]] : 1));
}

const DAYS: Record<string, number> = { second: 1 / 86400, minute: 1 / 1440, hour: 1 / 24, day: 1, week: 7, month: 30.44, year: 365.25 };
const SHORT: Record<string, string> = { s: 'second', sec: 'second', min: 'minute', h: 'hour', hr: 'hour', d: 'day', w: 'week', wk: 'week', mo: 'month', y: 'year', yr: 'year' };

// "3 weeks ago" / "2y ago" / "Streamed 5 days ago" -> an approximate date (ISO). Null if not understood.
export function relativeToDate(raw: string | null | undefined, now: Date = new Date()): string | null {
  if (!raw) return null;
  const m = raw.toLowerCase().match(/(\d+)\s*(seconds?|minutes?|hours?|days?|weeks?|months?|years?|sec|min|hr|wk|mo|yr|s|h|d|w|y)\b[^\d]*ago/);
  if (!m) return null;
  const unit = m[2].replace(/s$/, '');
  const days = DAYS[unit] ?? DAYS[SHORT[m[2]] ?? SHORT[unit] ?? ''];
  if (days === undefined) return null;
  return new Date(now.getTime() - Number(m[1]) * days * 86400000).toISOString();
}

const lastThumb = (t: unknown): string | null => {
  const list = isObj(t) && Array.isArray(t.thumbnails) ? t.thumbnails : isObj(t) && Array.isArray(t.sources) ? t.sources : null;
  return list && list.length ? String(list[list.length - 1].url || '') || null : null;
};
// A video posted by two channels together ("Korra The Taymi and Korra The Taymi 2.0", maintainer 2026-10-01) has no
// thumbnail on its owner block; the pictures sit deeper, one per channel. Prefer the one next to this channel's ID,
// else the first channel picture found (YouTube serves them from yt3.* addresses).
export function ownerAvatar(o: unknown, channelId: string | null): string | null {
  const direct = isObj(o) ? lastThumb(o.thumbnail) : null;
  if (direct) return direct;
  const pictures = (x: unknown, depth = 0, out: string[] = []): string[] => {
    if (depth > 25 || !x || typeof x !== 'object') return out;
    for (const [k, v] of Object.entries(x as Record<string, unknown>)) {
      if (k === 'url' && typeof v === 'string' && /\/\/yt\d?\.(ggpht|googleusercontent)\.com\//.test(v)) out.push(v.startsWith('//') ? 'https:' + v : v);
      else pictures(v, depth + 1, out);
    }
    return out;
  };
  const ids = (x: unknown, depth = 0, out = new Set<string>()): Set<string> => {
    if (depth > 25 || !x || typeof x !== 'object') return out;
    for (const [k, v] of Object.entries(x as Record<string, unknown>)) {
      if (k === 'browseId' && typeof v === 'string') out.add(v);
      else ids(v, depth + 1, out);
    }
    return out;
  };
  // In any list, the entry that names only this channel holds its picture.
  let mine: string | null = null;
  const walk = (x: unknown, depth: number) => {
    if (mine || depth > 25 || !x || typeof x !== 'object') return;
    if (Array.isArray(x) && channelId) {
      for (const el of x) {
        const named = ids(el);
        if (named.size === 1 && named.has(channelId)) {
          const pic = pictures(el)[0];
          if (pic) { mine = pic; return; }
        }
      }
    }
    for (const v of Object.values(x as Record<string, unknown>)) walk(v, depth + 1);
  };
  walk(o, 0);
  return mine ?? pictures(o)[0] ?? null;
}

const handleFrom = (url: unknown): string | null => {
  const m = typeof url === 'string' ? url.match(/\/(@[^/?#]+)/) : null;
  return m ? decodeURIComponent(m[1]) : null;
};

// "videos" for https://www.youtube.com/@x/videos (also shorts / streams); null for Home and other tabs.
function listTabOf(url: string): string | null {
  try {
    const last = new URL(url).pathname.split('/').filter(Boolean).pop() || '';
    return ['videos', 'shorts', 'streams'].includes(last) ? last : null;
  } catch {
    return null;
  }
}

export function readPage(raw: RawPage, now: Date = new Date()): PageRead {
  const page = classifyPage(raw.url);
  if (page.kind === 'video') return readWatch(raw, page.videoId, !!page.short);
  if (page.kind === 'channel') return readChannel(raw, page, now);
  return { kind: 'unreadable', reason: 'not-youtube' };
}

// ---- A video page -------------------------------------------------------------------------------------
function readWatch(raw: RawPage, videoId: string, short: boolean): PageRead {
  const player = isObj(raw.player) ? raw.player : null;
  const vd = player && isObj(player.videoDetails) ? player.videoDetails : null;
  if (!vd) return { kind: 'unreadable', reason: 'layout' };
  if (vd.videoId !== videoId) return { kind: 'unreadable', reason: 'mismatch' };
  const mf: Node = (isObj(player!.microformat) && player!.microformat.playerMicroformatRenderer) || {};
  const data = isObj(raw.data) ? raw.data : {};

  let likes: number | null = null;
  let comments: number | null = null;
  let owner: Node | null = null;
  const chapters = new Map<number, string>();
  const heat: ReplayBar[] = [];
  walk(data, (key, v) => {
    // The "most replayed" graph: newer pages keep it in macroMarkersListEntity (MARKER_TYPE_HEATMAP), older ones as heatMarkerRenderer bars (checked only on made-up shapes: UNVERIFIED on real pages).
    if (key === 'macroMarkersListEntity' && isObj(v.markersList) && v.markersList.markerType === 'MARKER_TYPE_HEATMAP' && Array.isArray(v.markersList.markers)) {
      for (const m of v.markersList.markers) if (isObj(m) && Number.isFinite(Number(m.startMillis)) && Number.isFinite(Number(m.durationMillis)) && Number.isFinite(Number(m.intensityScoreNormalized))) heat.push({ start: Number(m.startMillis) / 1000, len: Number(m.durationMillis) / 1000, v: Number(m.intensityScoreNormalized) });
      return false;
    }
    if (key === 'heatMarkerRenderer' && Number.isFinite(Number(v.timeRangeStartMillis)) && Number.isFinite(Number(v.heatMarkerIntensityScoreNormalized))) {
      heat.push({ start: Number(v.timeRangeStartMillis) / 1000, len: Number(v.markerDurationMillis || 0) / 1000, v: Number(v.heatMarkerIntensityScoreNormalized) });
      return false;
    }
    if (key === 'likeButtonViewModel') {
      if (likes === null) likes = likesFrom(v);
      return false;
    }
    // A Short's comment button: "View 10,164 comments" (checked in the maintainer's Chrome, 2026-09-29).
    if (key === 'buttonViewModel' && /COMMENT/.test(String(v.iconName)) && comments === null) {
      const c = typeof v.accessibilityText === 'string' ? v.accessibilityText.match(/([\d.,]+(?:\s*(?:thousand|million|billion))?)\s+comments?/i) : null;
      if (c) comments = parseCount(c[1]);
    }
    if (key === 'videoOwnerRenderer' && !owner) owner = v;
    if (key === 'chapterRenderer') chapters.set(Math.round(Number(v.timeRangeStartMillis || 0) / 1000), text(v.title));
    if (key === 'macroMarkersListItemRenderer') {
      const start = v.onTap?.watchEndpoint?.startTimeSeconds;
      if (typeof start === 'number') chapters.set(start, text(v.title));
    }
  });

  const video: VideoRead = {
    videoId,
    title: vd.title || text(mf.title) || null,
    format: short ? 'short' : 'long',
    postedAt: mf.publishDate ? new Date(mf.publishDate).toISOString() : null,
    postedText: null,
    views: vd.viewCount ? Number(vd.viewCount) : null,
    likes,
    comments,
    source: 'page',
    channelId: vd.channelId || mf.externalChannelId || null,
    description: typeof vd.shortDescription === 'string' ? vd.shortDescription : null,
    chapters: [...chapters.entries()].filter(([, t]) => t).sort((a, b) => a[0] - b[0]).map(([startSeconds, title]) => ({ title, startSeconds })),
    paidPromotion: !!player!.paidContentOverlay,
    lengthSeconds: vd.lengthSeconds ? Number(vd.lengthSeconds) : null,
    category: mf.category || null,
    replay: heat.length >= 20 ? heat.sort((a, b) => a.start - b.start) : null,
  };

  // Newer numbers from the screen win, when the page says it is showing this same video.
  if (raw.live && raw.live.videoId === videoId) {
    const views = parseCount(raw.live.viewsText);
    const liveLikes = othersCount(raw.live.likesLabel);
    if (views !== null && views > (video.views ?? -1)) video.views = views;
    if (liveLikes !== null && liveLikes > (video.likes ?? -1)) video.likes = liveLikes;
  }

  let channel: ChannelFacts | null = null;
  const o = owner as Node | null;
  if (video.channelId) {
    const nav = o?.navigationEndpoint?.browseEndpoint;
    channel = {
      channelId: video.channelId,
      handle: handleFrom(nav?.canonicalBaseUrl) || handleFrom(mf.ownerProfileUrl),
      name: (o && text(o.title)) || vd.author || null,
      avatar: o ? ownerAvatar(o, video.channelId) : null,
      followers: o ? parseCount(o.subscriberCountText?.accessibility?.accessibilityData?.label || text(o.subscriberCountText)) : null,
      videoCount: null,
      source: 'page',
    };
  }
  return { kind: 'video', video, channel };
}

// ---- A channel page -----------------------------------------------------------------------------------
function readChannel(raw: RawPage, page: { handle?: string; channelId?: string; legacy?: string }, now: Date): PageRead {
  const data = isObj(raw.data) ? raw.data : null;
  const md: Node | null = data && isObj(data.metadata) && isObj(data.metadata.channelMetadataRenderer) ? data.metadata.channelMetadataRenderer : null;
  if (!md || !md.externalId) return { kind: 'unreadable', reason: 'layout' };
  const handle = handleFrom(md.vanityChannelUrl);
  const same =
    (page.channelId && page.channelId === md.externalId) ||
    (page.handle && handle && page.handle.toLowerCase() === handle.toLowerCase()) ||
    (page.legacy && String(md.vanityChannelUrl || '').toLowerCase().includes(page.legacy.toLowerCase())) ||
    (page.legacy && !page.channelId && !page.handle); // old-style address: nothing on the page to compare with
  if (!same) return { kind: 'unreadable', reason: 'mismatch' };

  // Subscribers and video count sit in the header as short texts ("19.2M subscribers", "442 videos").
  let followers: number | null = null;
  let videoCount: number | null = null;
  const consider = (label: string) => {
    if (followers === null && /subscriber/i.test(label)) followers = parseCount(label);
    else if (videoCount === null && /\bvideos?\b/i.test(label)) videoCount = parseCount(label);
  };
  walk(data!.header, (key, v) => {
    if (key === 'metadataParts' || Array.isArray(v)) return;
    if (typeof v.accessibilityLabel === 'string') consider(v.accessibilityLabel);
    const t = text(v.text ?? v);
    if (t) consider(t);
    if (key === 'subscriberCountText' || key === 'videosCountText') consider(v.accessibility?.accessibilityData?.label || text(v));
  });

  // Which tab is open. Videos are only taken from the channel's own lists (Videos / Shorts / Live),
  // never from Home, where shelves can hold other channels' videos.
  let tab: string | null = null;
  let tabUrl = '';
  let tabContent: unknown = null;
  walk(data!.contents, (key, v) => {
    if (key === 'tabRenderer' && v.selected) {
      tab = text(v.title) || v.title || null;
      tabUrl = v.endpoint?.commandMetadata?.webCommandMetadata?.url || '';
      tabContent = v.content;
      return false;
    }
  });
  // Same channel is not enough: moving Home -> Videos without a reload leaves the Home tab's data behind.
  // If the address names a list tab, the data must be for that tab (else wait / re-read).
  const urlTab = listTabOf(raw.url);
  if (urlTab && !tabUrl.endsWith('/' + urlTab)) return { kind: 'unreadable', reason: 'mismatch' };
  const ownList = /\/(videos|shorts|streams)$/.test(tabUrl);
  const shortsTab = /\/shorts$/.test(tabUrl);
  const videos: VideoFacts[] = [];
  const seen = new Set<string>();
  const add = (v: VideoFacts) => {
    if (v.videoId && !seen.has(v.videoId)) {
      seen.add(v.videoId);
      videos.push(v);
    }
  };
  if (ownList) {
    walk(tabContent, (key, v) => {
      if (key === 'videoRenderer' || key === 'gridVideoRenderer') {
        const when = text(v.publishedTimeText);
        add({ videoId: v.videoId, title: text(v.title) || null, format: 'long', postedText: when || null, postedAt: relativeToDate(when, now),
          views: parseCount(v.viewCountText?.accessibility?.accessibilityData?.label || text(v.viewCountText)), source: 'page' });
        return false;
      }
      if (key === 'lockupViewModel' && v.contentId) {
        let views: number | null = null;
        let when = '';
        walk(v.metadata, (k, part) => {
          if (k !== 'metadataParts' && !Array.isArray(part)) {
            const label = String(part.accessibilityLabel || text(part.text) || '');
            if (views === null && /views?/i.test(label)) views = parseCount(label);
            if (!when && /ago/i.test(label)) when = label;
          }
        });
        add({ videoId: v.contentId, title: text(v.metadata?.lockupMetadataViewModel?.title) || null, format: shortsTab ? 'short' : 'long',
          postedText: when || null, postedAt: relativeToDate(when, now), views, source: 'page' });
        return false;
      }
      if (key === 'shortsLockupViewModel' || key === 'reelItemRenderer') {
        const id = v.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId || v.videoId;
        const views = parseCount(v.overlayMetadata?.secondaryText?.content || text(v.viewCountText));
        if (id) add({ videoId: id, title: v.overlayMetadata?.primaryText?.content || text(v.headline) || null, format: 'short', views, source: 'page' });
        return false;
      }
    });
  }

  return {
    kind: 'channel',
    tab,
    videos,
    channel: { channelId: md.externalId, handle, name: md.title || null, avatar: lastThumb(md.avatar), followers, videoCount, source: 'page' },
  };
}

// ---- A channel's links (Instagram, TikTok, website...), from its About page -----------------------------------
// YouTube keeps them only in the About data (checked in the maintainer's Chrome, 2026-09-29: the channel page itself
// says just "Patreon and 7 more links"; /about held all 8 as channelExternalLinkViewModel). The real address sits in
// YouTube's redirect link (?q=...); the shown text ("instagram.com/tdrnetwork") is the fallback.
export type ChannelLink = { title: string; url: string };

export function channelLinks(data: unknown): { channelId: string | null; links: ChannelLink[] } {
  const links: ChannelLink[] = [];
  const seen = new Set<string>();
  let channelId: string | null = null;
  walk(data, (key, v) => {
    if (key === 'aboutChannelViewModel' && typeof v.channelId === 'string') channelId = v.channelId;
    if (key !== 'channelExternalLinkViewModel') return;
    const shown = String(v.link?.content || '').trim();
    const redirect = String(v.link?.commandRuns?.[0]?.onTap?.innertubeCommand?.commandMetadata?.webCommandMetadata?.url || '');
    let url = '';
    try {
      const q = redirect ? new URL(redirect, 'https://www.youtube.com').searchParams.get('q') : null;
      url = q || '';
    } catch {
      /* use what is shown */
    }
    if (!url && shown) url = /^https?:\/\//i.test(shown) ? shown : 'https://' + shown;
    if (!/^https?:\/\//i.test(url) || seen.has(url)) return false;
    seen.add(url);
    links.push({ title: text(v.title) || shown, url });
    return false;
  });
  return { channelId, links };
}

// ---- A channel's About facts (maintainer, 2026-10-04: "from their about page ... location, join date, number of uploads,
// sub count"). Same About data as the links: country, "Joined Mar 5, 2014", total views, videos, subscribers. Whatever
// YouTube leaves out stays null (nothing is guessed).
export type ChannelAbout = { channelId: string | null; country: string | null; joined: string | null; views: number | null; videos: number | null; subscribers: number | null; description: string | null };
export function channelAbout(data: unknown): ChannelAbout {
  const out: ChannelAbout = { channelId: null, country: null, joined: null, views: null, videos: null, subscribers: null, description: null };
  const str = (x: unknown): string => (typeof x === 'string' ? x : x && typeof x === 'object' ? String((x as { content?: unknown }).content ?? text(x) ?? '') : '');
  walk(data, (key, v) => {
    if (key !== 'aboutChannelViewModel') return;
    if (typeof v.channelId === 'string') out.channelId = v.channelId;
    const country = str(v.country).trim();
    if (country) out.country = country;
    const joined = str(v.joinedDateText).replace(/^joined\s*/i, '').trim();
    const t = joined ? Date.parse(joined) : NaN;
    if (Number.isFinite(t)) { const dt = new Date(t); out.joined = dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0'); }
    out.views = parseCount(str(v.viewCountText).replace(/views?/i, '')) ?? out.views;
    out.videos = parseCount(str(v.videoCountText).replace(/videos?/i, '')) ?? out.videos;
    out.subscribers = parseCount(str(v.subscriberCountText).replace(/subscribers?/i, '')) ?? out.subscribers;
    const description = str(v.description).trim(); // the channel's own words ("For collaboration: support@..."): only read for a contact address, never stored whole
    if (description) out.description = description.slice(0, 5000);
    return false;
  });
  return out;
}
