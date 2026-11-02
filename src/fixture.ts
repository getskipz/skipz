// Fixture recorder (maintainer, 2026-10-26: "build the fixture recorder"; replaces yt-dlp for test data). In a `npm run build:bridge` build only: what Skipz's worker already has for a video (the page's description, label and chapters, the caption lines, the answer
// and the votes) is sent to the local program on this computer (skipz-extension/tools/skipz-bridge.cjs), which keeps it as skipz-extension/bridge-fixtures/<id>.json. No new request is made to YouTube. Every other build has no address, so this does nothing.
declare const __BRIDGE__: string; // '' = off, else 'http://127.0.0.1:PORT|SECRET'
const TARGET = typeof __BRIDGE__ === 'string' ? __BRIDGE__ : '';
export async function recordFixture(videoId: string, part: Record<string, unknown>): Promise<void> {
  if (!TARGET) return;
  const [base, secret] = TARGET.split('|');
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 3000);
  try { await fetch(base + '/fixture', { method: 'POST', headers: { 'content-type': 'application/json', 'x-skipz-bridge': secret }, body: JSON.stringify({ videoId, ...part }), signal: ctl.signal }); } catch { /* the program is not running: nothing to record */ } finally { clearTimeout(timer); }
}
