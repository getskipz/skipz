// Used ONLY by the page script (content.ts). Keep it in its own file: a page script cannot import another file, and a module shared with the worker makes the build split it out and breaks Skipz on every page (found 2026-11-02).
/**
 * What to offer when the video has ended (maintainer, 2026-11-02): only to a person who pressed "Support me", only when the description gave the sponsor's own link, only for the video that was marked, and only a plain web address.
 * Returns what the button says and where it goes, or null for no button.
 */
export function endOffer(supported: boolean, mark: { videoId: string; brand?: string | null; link?: string } | null, currentVideoId: string | null): { url: string; name: string } | null {
  if (!supported || !mark?.link || !currentVideoId || mark.videoId !== currentVideoId) return null;
  let u: URL;
  try { u = new URL(mark.link); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  return { url: u.href, name: mark.brand && mark.brand !== 'Sponsor' ? mark.brand : 'the offer' };
}
