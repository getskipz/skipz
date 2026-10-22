// Which kind of page the side panel is looking at. Pure: the URL in, a small description out.
// The panel picks its card from this (board W: "the side panel follows your page").

export type Page =
  | { kind: 'channel'; handle?: string; channelId?: string; legacy?: string }
  | { kind: 'video'; videoId: string; short?: boolean }
  | { kind: 'videoList'; query?: string }
  | { kind: 'gmail' }
  | { kind: 'check' } // Google's "unusual traffic" page: YouTube is asking the person to prove they are one
  | { kind: 'other'; host: string }
  | { kind: 'none' };

const YOUTUBE_HOSTS = new Set(['www.youtube.com', 'youtube.com', 'm.youtube.com']);
// Pages Chrome does not let any extension read (CLAUDE.md: Chrome's own limits).
const OFF_LIMITS_HOSTS = new Set(['chromewebstore.google.com', 'chrome.google.com']);

export function classifyPage(url: string | undefined): Page {
  let u: URL;
  try {
    u = new URL(url || '');
  } catch {
    return { kind: 'none' };
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { kind: 'none' };
  if (OFF_LIMITS_HOSTS.has(u.hostname)) return { kind: 'none' };

  if (u.hostname === 'youtu.be') {
    const id = u.pathname.slice(1).split('/')[0];
    return id ? { kind: 'video', videoId: id } : { kind: 'none' };
  }
  if (YOUTUBE_HOSTS.has(u.hostname)) return classifyYouTube(u);
  if (u.hostname === 'mail.google.com') return { kind: 'gmail' };
  if ((u.hostname === 'www.google.com' || u.hostname === 'google.com') && u.pathname.startsWith('/sorry')) return { kind: 'check' };
  return { kind: 'other', host: u.hostname.replace(/^www\./, '') };
}

function classifyYouTube(u: URL): Page {
  const parts = u.pathname.split('/').filter(Boolean);
  const first = parts[0] || '';
  if (first === 'watch') {
    const id = u.searchParams.get('v');
    return id ? { kind: 'video', videoId: id } : { kind: 'videoList' };
  }
  if (first === 'shorts' && parts[1]) return { kind: 'video', videoId: parts[1], short: true };
  if (first.startsWith('@')) return { kind: 'channel', handle: decodeURIComponent(first) };
  if (first === 'channel' && parts[1]) return { kind: 'channel', channelId: parts[1] };
  if ((first === 'c' || first === 'user') && parts[1]) return { kind: 'channel', legacy: first + '/' + parts[1] };
  if (first === 'results') {
    const q = u.searchParams.get('search_query');
    return q ? { kind: 'videoList', query: q } : { kind: 'videoList' };
  }
  return { kind: 'videoList' };
}
