// Reads the YouTube page in the given tab: only a page you opened, only while Skipz is checking it.
// Step 1 takes the data YouTube already holds in the page; if YouTube still holds the previous page's data
// (it changes pages without reloading), Skipz waits a moment and asks again, then as a last resort re-loads
// the same address once from inside that tab. Never other channels, never in the background.
import { readPage, channelLinks, channelAbout, type PageRead, type RawPage, type ChannelLink, type ChannelAbout } from './parse';

// Runs INSIDE the YouTube page (world MAIN) so it can see YouTube's own data. Must be self-contained:
// Chrome copies this function's source into the page. No key or secret ever goes in here.
function grabFromPage(): RawPage {
  const out: { url: string; data: unknown; player: unknown } = { url: location.href, data: null, player: null };
  try {
    const pm = document.querySelector('ytd-page-manager') as unknown as { getCurrentData?: () => { response?: unknown; playerResponse?: unknown } } | null;
    const cur = pm && typeof pm.getCurrentData === 'function' ? pm.getCurrentData() : null;
    if (cur) {
      out.data = cur.response || null;
      out.player = cur.playerResponse || null;
    }
  } catch { /* fall back below */ }
  try {
    const mp = document.querySelector('#movie_player') as unknown as { getPlayerResponse?: () => unknown } | null;
    const pr = mp && typeof mp.getPlayerResponse === 'function' ? mp.getPlayerResponse() : null;
    if (pr) out.player = pr;
  } catch { /* fall back below */ }
  const w = window as unknown as { ytInitialData?: unknown; ytInitialPlayerResponse?: unknown };
  if (!out.data) out.data = w.ytInitialData || null;
  if (!out.player) out.player = w.ytInitialPlayerResponse || null;
  // The numbers YouTube keeps updating on screen while you watch (the data above is fixed when the video opens).
  // Tagged with the video the watch page says it is showing, so the reader can ignore a previous video's numbers.
  let live: { videoId: string | null; viewsText: string | null; likesLabel: string | null } | null = null;
  // Where these live was checked on a real watch page in the maintainer's Chrome (2026-09-29): ytd-watch-flexy[video-id],
  // the exact count "58,560 views" in ytd-video-view-count-renderer, the like button "like this video along with N other people".
  try {
    const flexy = document.querySelector('ytd-watch-flexy');
    if (flexy) {
      live = { videoId: flexy.getAttribute('video-id') || null, viewsText: null, likesLabel: null };
      for (const s of Array.from(document.querySelectorAll('ytd-video-view-count-renderer span, ytd-watch-metadata span'))) {
        const t = (s.textContent || '').trim();
        if (/^[\d.,]+\s+views?$/i.test(t)) { live.viewsText = t; break; } // exact counts only, never "58K views"
      }
      for (const b of Array.from(document.querySelectorAll('like-button-view-model button[aria-label]'))) {
        const a = b.getAttribute('aria-label') || '';
        if (/along with [\d,]+ other/i.test(a)) { live.likesLabel = a; break; }
      }
    }
  } catch { /* the numbers above are enough */ }
  try {
    return JSON.parse(JSON.stringify({ ...out, live })); // plain data only
  } catch {
    return { url: out.url, data: null, player: null };
  }
}

// Last resort, also inside the page: load the SAME address again (same tab, your own session) and take
// the data YouTube embeds in it.
async function refetchSamePage(): Promise<RawPage> {
  const pick = (html: string, name: string): unknown => {
    const at = html.indexOf(name + ' = ');
    const start = at < 0 ? -1 : html.indexOf('{', at);
    if (start < 0) return null;
    let depth = 0, inStr = false, esc = false;
    for (let j = start; j < html.length; j++) {
      const c = html[j];
      if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) {
        try { return JSON.parse(html.slice(start, j + 1)); } catch { return null; }
      }
    }
    return null;
  };
  try {
    const res = await fetch(location.href, { credentials: 'same-origin' });
    const html = await res.text();
    return { url: location.href, data: pick(html, 'var ytInitialData'), player: pick(html, 'var ytInitialPlayerResponse') };
  } catch {
    return { url: location.href, data: null, player: null };
  }
}

// Inside the page too: the SAME channel's About page (its links live only there), fetched with your own session,
// the way the old extension did (background.js extractYoutubeLinksFromPage_). Only for the channel you opened.
async function grabAboutPage(): Promise<{ url: string; data: unknown }> {
  const parts = location.pathname.split('/').filter(Boolean);
  const base = parts[0]?.startsWith('@') ? '/' + parts[0] : ['channel', 'c', 'user'].includes(parts[0]) && parts[1] ? '/' + parts[0] + '/' + parts[1] : '';
  if (!base) return { url: location.href, data: null };
  try {
    const html = await (await fetch(base + '/about', { credentials: 'same-origin' })).text();
    const at = html.indexOf('var ytInitialData = ');
    const start = at < 0 ? -1 : html.indexOf('{', at);
    if (start < 0) return { url: location.href, data: null };
    let depth = 0, inStr = false, esc = false;
    for (let j = start; j < html.length; j++) {
      const c = html[j];
      if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) return { url: location.href, data: JSON.parse(html.slice(start, j + 1)) };
    }
  } catch {
    /* no links today; nothing breaks */
  }
  return { url: location.href, data: null };
}

// The channel's links and About facts (country, join date, views, videos, subscribers), only when the About data is
// about the channel you are on.
export async function readChannelLinks(tabId: number, channelId: string): Promise<{ links: ChannelLink[]; about: ChannelAbout } | null> {
  const got = await runInTab(tabId, grabAboutPage);
  if (!got?.data) return null;
  const r = channelLinks(got.data);
  if (r.channelId && r.channelId !== channelId) return null;
  return { links: r.links, about: channelAbout(got.data) };
}

async function runInTab<T>(tabId: number, func: () => T | Promise<T>): Promise<T | null> {
  try {
    const [res] = await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func });
    return (res?.result as T) ?? null;
  } catch {
    return null; // tab closed, not a YouTube page any more, or Chrome refused
  }
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function readYouTubeTab(tabId: number, expectedUrl: string, tries = 8): Promise<PageRead> {
  let last: PageRead = { kind: 'unreadable', reason: 'layout' };
  for (let i = 0; i < tries; i++) {
    const raw = await runInTab(tabId, grabFromPage);
    if (raw) {
      if (raw.url !== expectedUrl) return { kind: 'unreadable', reason: 'mismatch' }; // you moved on already
      last = readPage(raw);
      if (last.kind !== 'unreadable') return last;
    }
    await wait(400);
  }
  const again = await runInTab(tabId, refetchSamePage);
  return again && again.url === expectedUrl ? readPage(again) : last;
}

// "Jump there" / a chapter's time: moves the video in YOUR tab to that second (only when you press it).
export async function seekTo(tabId: number, seconds: number): Promise<boolean> {
  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      args: [seconds],
      func: (s: number) => {
        const mp = document.querySelector('#movie_player') as unknown as { seekTo?: (t: number, ahead: boolean) => void } | null;
        if (mp && typeof mp.seekTo === 'function') { mp.seekTo(s, true); return true; }
        const v = document.querySelector('video');
        if (v) { v.currentTime = s; return true; }
        return false;
      },
    });
    return res?.result === true;
  } catch {
    return false;
  }
}
