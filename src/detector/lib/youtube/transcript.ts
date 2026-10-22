// The Transcript check (maintainer, 2026-10-04: "Yes build the transcript check"). In YOUR YouTube tab, Skipz presses
// YouTube's own "Show transcript" button (the same one you would press), reads the timed lines from the panel that
// opens, and closes the panel again if it opened it. The video is never played; no hidden YouTube addresses are called
// by Skipz (YouTube's own page loads the lines). The lines stay in memory only, never stored (like comments).
// Selectors from helioLJ/youtube-transcript-copier (MIT), with a fallback that reads any "0:00 text" row in the panel.

import { transcriptViaPage } from './innertube';

export type TranscriptLine = { t: number; text: string };
export type TranscriptRead = { state: 'ok'; lines: TranscriptLine[] } | { state: 'none' } | { state: 'timeout'; why?: string; again?: boolean }; // again: Skipz tries once more in a moment

// Runs INSIDE the YouTube page (world MAIN). Must be self-contained: no imports, no outside variables.
// ONE read at a time per page (maintainer, 2026-10-08, screenshot of YouTube's "In this video" panel left open: "this needs to stop"): the panel is read for every video you
// open, with a quiet second try, and two reads in one tab used to share ONE hiding rule: the first to finish un-hid the panel while the other was still using it, and
// the other saw the panel already open, so never closed it. A read that starts while another is running now simply joins it and gets the same answer.
type TxResult = { state: string; lines?: { t: number; text: string }[]; why?: string };
async function grabTranscript(): Promise<TxResult> {
  const w = window as unknown as { __skipzTx?: Promise<TxResult> };
  if (w.__skipzTx) return w.__skipzTx;
  // While Skipz reads, the page says so: the panel guard (content script) leaves the panel alone then; Skipz hides and closes it itself.
  document.documentElement.setAttribute('data-skipz-reading', '1');
  const mine = grab();
  w.__skipzTx = mine;
  try { return await mine; } finally { if (w.__skipzTx === mine) { w.__skipzTx = undefined; document.documentElement.removeAttribute('data-skipz-reading'); } }

async function grab(): Promise<TxResult> {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  // maintainer, 2026-10-04: "This needs to be sub 10 seconds": one budget for the whole read. If YouTube is slower, Skipz
  // says so and tries again later in the background (see useVideo).
  const deadline = Date.now() + 9500;
  const left = () => deadline - Date.now();
  const clockOf = (s: string) => { const p = s.trim().split(':').map(Number); return p.some((x) => Number.isNaN(x)) ? null : p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p.length === 2 ? p[0] * 60 + p[1] : null; };
  const panelSel = 'ytd-engagement-panel-section-list-renderer[target-id*="transcript"]';
  // YouTube's newer "In this video" panel (Timeline · Chapters · Transcript tabs; maintainer's screenshot, 2026-10-04) is
  // not the old transcript panel: the open side panel showing timed lines is taken first, then the old one.
  const isTime = (s: string) => /^\d{1,2}:\d{2}(:\d{2})?$/.test(s.trim());
  const timed = (p: Element) => { let n = 0; for (const el of p.querySelectorAll('*')) if (!el.children.length && isTime(el.textContent || '') && ++n >= 3) return true; return false; };
  const expanded = (p: Element) => (p.getAttribute('visibility') || '').includes('EXPANDED');
  const panel = () => {
    const all = [...document.querySelectorAll('ytd-engagement-panel-section-list-renderer')] as HTMLElement[];
    // Seen on real YouTube (2026-10-04): the page holds TWO transcript panels, a hidden "PAmodern_transcript_view" first
    // and the "engagement-panel-searchable-transcript" that actually opens; the first match was the hidden one, so Skipz
    // read nothing and closed the wrong panel. The open one wins.
    const tp = [...document.querySelectorAll(panelSel)] as HTMLElement[];
    // Never YouTube's Ask chat, comments, ads, search or description panels: Ask's answer has timed links too ("0:17"),
    // and Skipz once quoted it as the transcript (maintainer's screenshot, 2026-10-04).
    const other = (p: Element) => /youchat|chat|comment|ads|search_preview|description/i.test(p.getAttribute('target-id') || '');
    return tp.find((p) => expanded(p) && timed(p)) ?? all.find((p) => expanded(p) && !other(p) && timed(p)) ?? tp.find(expanded) ?? tp[0] ??
      (document.querySelector('ytd-transcript-segment-renderer, transcript-segment-view-model')?.closest('ytd-engagement-panel-section-list-renderer') as HTMLElement | null) ?? null;
  };
  const isOpen = () => { const p = panel(); return !!p && expanded(p); };
  // While Skipz reads, the panel YouTube opens is parked off-screen and see-through (not display:none: a hidden box may not fill). Off-screen it still lays out and
  // scrolls, so the reading below works as before. Removed when done, and after 90 s whatever happens.
  // Two ways to keep it out of sight, and it is NEVER shown (maintainer, 2026-10-08): 'away' = far to the left, 'inview' = inside the page but fully see-through, behind
  // everything and untouchable, for when YouTube does not fill a panel that is off-screen. Removed when done, and after 90 s whatever happens.
  const HIDE = 'skipz-transcript-hide';
  let mode = 'off' as 'off' | 'away' | 'inview'; // (cast: park() changes it from inside a function, which the type checker cannot follow)
  const park = (to: 'off' | 'away' | 'inview') => {
    document.getElementById(HIDE)?.remove();
    mode = to;
    if (to === 'off') return;
    const st = document.createElement('style');
    st.id = HIDE;
    const sel = ['transcript', 'macro-markers', 'in-this-video', 'in_this_video'].map((k) => 'ytd-engagement-panel-section-list-renderer[target-id*="' + k + '" i]').join(',');
    st.textContent = sel + '{position:fixed!important;left:' + (to === 'away' ? '-10000px' : '0') + '!important;top:0!important;width:420px!important;height:640px!important;opacity:0!important;pointer-events:none!important;z-index:-1!important}';
    document.documentElement.appendChild(st);
    setTimeout(() => st.remove(), 600000); // a last resort only (10 minutes): the watcher below lifts it the moment the panel is really shut
  };
  // Close what Skipz opened (a panel you had open yourself is left alone).
  // Every panel of the kinds Skipz parks that is open, not just the one it read from: the maintainer's screenshot (2026-10-12) showed "In this video" left open beside the video.
  const ourKinds = ['transcript', 'macro-markers', 'in-this-video', 'in_this_video'].map((k) => 'ytd-engagement-panel-section-list-renderer[target-id*="' + k + '" i]').join(',');
  const openOnes = () => ([...document.querySelectorAll(ourKinds)] as HTMLElement[]).filter(expanded);
  const closeOurs = (force = false) => {
    for (const p of openOnes()) {
      const close = p.querySelector('#visibility-button button, button[aria-label*="close" i], [aria-label*="close" i] button, button[aria-label*="collapse" i], button[aria-label*="hide" i]') as HTMLElement | null;
      if (close && !force) close.click();
      else p.setAttribute('visibility', 'ENGAGEMENT_PANEL_VISIBILITY_HIDDEN');
    }
  };
  const read = (allowAny?: boolean): { t: number; text: string }[] => {
    const root = panel() || document;
    const out: { t: number; text: string }[] = [];
    const segs = root.querySelectorAll('ytd-transcript-segment-renderer, transcript-segment-view-model');
    // A row is a time and words. YouTube's class names change (a newer layout was not read at all, 2026-10-13), so the row is read by what it holds: the first leaf that is only a time,
    // and every other piece of text in it except buttons ("Sync to video time" shows on hover) and hidden bits.
    const rowOf = (s: Element): { t: number; text: string } | null => {
      let ts: Element | null = null;
      for (const el of s.querySelectorAll('*')) if (!el.children.length && isTime(el.textContent || '')) { ts = el; break; }
      if (!ts) return null;
      const t = clockOf(ts.textContent || '');
      const parts: string[] = [];
      const walk = document.createTreeWalker(s, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        const p = n.parentElement;
        if (!p || ts.contains(p) || p.closest('button, [role="button"], [aria-hidden="true"], style, script')) continue;
        const x = (n.textContent || '').replace(/\s+/g, ' ').trim();
        if (x) parts.push(x);
      }
      const text = parts.join(' ').replace(/\s+/g, ' ').trim();
      return t !== null && text ? { t, text } : null;
    };
    segs.forEach((s) => { const r = rowOf(s); if (r) out.push(r); });
    // The "In this video" panel (Chapters / Transcript chips) shows its transcript as real segment rows (seen 2026-10-04);
    // any other "0:41 Title" rows there are chapters, so the any-row fallback is not used in it.
    if (out.length || !panel() || (allowAny === undefined ? !!panel()!.querySelector('chip-view-model') : !allowAny)) return out;
    // Fallback: any leaf that is just a time, with the rest of its row as the words.
    panel()!.querySelectorAll('*').forEach((el) => {
      if (el.children.length) return;
      const tt = (el.textContent || '').trim();
      if (!/^\d{1,2}:\d{2}(:\d{2})?$/.test(tt)) return;
      let row: Element | null = el;
      for (let i = 0; i < 4 && row && (row.textContent || '').trim() === tt; i++) row = row.parentElement;
      const text = (row?.textContent || '').replace(tt, '').replace(/\s+/g, ' ').trim();
      const t = clockOf(tt);
      if (t !== null && text) out.push({ t, text });
    });
    return out;
  };
  // The whole transcript, not just its first screen (maintainer, 2026-10-04: a 15-minute video gave 32 lines and missed
  // the 7:36 ad). YouTube fills the panel in stages and adds lines as it is scrolled (and may drop the top ones), so
  // Skipz scrolls the list to its end, collecting every line it sees, until the times reach the video's end or nothing
  // new arrives for a second. At most about 12 seconds; the list is scrolled back where it was afterwards.
  const SEG = 'ytd-transcript-segment-renderer, transcript-segment-view-model';
  const scroller = (): HTMLElement | null => {
    const segs = (panel() || document).querySelectorAll(SEG);
    let box = (segs[segs.length - 1] as HTMLElement | undefined)?.parentElement ?? null;
    while (box && box !== document.body && !(box.scrollHeight > box.clientHeight + 4 && /(auto|scroll)/.test(getComputedStyle(box).overflowY))) box = box.parentElement;
    return box && box !== document.body ? box : null;
  };
  const whole = async (first: { t: number; text: string }[]) => {
    const got = new Map<number, string>();
    const keep = (ls: { t: number; text: string }[]) => { let added = 0; for (const l of ls) if (!got.has(l.t)) { got.set(l.t, l.text); added++; } return added; };
    keep(first);
    const dur = (document.querySelector('video') as HTMLVideoElement | null)?.duration;
    const box = scroller();
    const was = box?.scrollTop ?? 0;
    let still = 0;
    for (let i = 0; i < 48 && still < 3 && left() > 0; i++) {
      const b = scroller();
      // Already at the end, nothing new: step back a little first, so moving to the end again counts as a scroll.
      if (b && still) { b.scrollTop = Math.max(0, b.scrollHeight - b.clientHeight - 80); await sleep(80); }
      if (b) b.scrollTop = b.scrollHeight;
      await sleep(150);
      still = keep(read()) ? 0 : still + 1;
      const last = Math.max(...got.keys());
      if (dur && Number.isFinite(dur) && last >= dur - 30 && still >= 2) break;
    }
    if (box) box.scrollTop = was;
    return [...got].map(([t, text]) => ({ t, text }));
  };
  const wasOpen = isOpen();
  let opened = false; // Skipz opened the panel itself
  // YouTube keeps a panel open when you move to the next video, so a panel Skipz opened on the last video looks "already open" on this one (maintainer's second screenshot, 2026-10-12: the
  // panel still showing). This page remembers that Skipz opened it: then it is Skipz's to hide and to close, not yours.
  const flag = window as unknown as { __skipzOpened?: boolean };
  const leftover = wasOpen && flag.__skipzOpened === true;
  if (leftover) park('away');
  try {
  let lines = wasOpen ? read() : [];
  if (lines.length) lines = await whole(lines);
  if (!lines.length) {
    const btn = (document.querySelector('ytd-video-description-transcript-section-renderer button') ||
      document.querySelector('button[aria-label="Show transcript"]') ||
      document.querySelector('[aria-label*="Show transcript"]')) as HTMLElement | null;
    if (!btn && !panel()) return { state: 'none' };
    park('away');
    opened = !wasOpen;
    if (opened) flag.__skipzOpened = true;
    if (btn) btn.click();
    else panel()!.setAttribute('visibility', 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED');
    // Seen on real YouTube (2026-10-04, The Next New Thing): the panel is "In this video" with Chapters / Transcript chips.
    // If it opens on Chapters, its times are chapter times, not the transcript: press the Transcript chip first.
    // Returns false while the Transcript chip exists but isn't the one selected (what shows then is chapters).
    const onTranscript = (press: boolean) => {
      const p = panel();
      const chips = p ? ([...p.querySelectorAll('chip-view-model, yt-chip-cloud-chip-renderer, [role="tab"]')] as HTMLElement[]) : [];
      const t = chips.find((c) => /^\s*transcript\s*$/i.test(c.textContent || ''));
      if (!t) return true;
      const on = t.getAttribute('aria-selected') === 'true' || !!t.querySelector('[aria-selected="true"], [aria-pressed="true"]');
      if (!on && press) (t.querySelector('button') ?? t).click();
      return on;
    };
    // The first lines within the budget, leaving ~0.5 s to collect the rest (seen: 543 lines ~8 s after opening in a
    // background tab; 721 lines once the tab was in front).
    for (let i = 0; !lines.length && left() > 500; i++) {
      if (mode === 'away' && left() < 3000) park('inview'); // nothing came in about 6.5 s far away: move it into the page, still see-through (never shown)
      const ready = onTranscript(i % 10 === 0);
      await sleep(150);
      const rows = read(false); // real transcript rows are never chapters, so they count whichever tab YouTube says is selected
      lines = rows.length ? rows : ready && onTranscript(false) ? read(true) : [];
    }
    if (lines.length) lines = await whole(lines);
    if (!lines.length) {
      const p = panel();
      const tabs = p ? [...p.querySelectorAll('chip-view-model, yt-chip-cloud-chip-renderer, [role="tab"]')].map((c) => (c.textContent || '').trim().slice(0, 12)).filter(Boolean).join('/') : '';
      return { state: 'timeout', why: 'rows ' + (p || document).querySelectorAll(SEG).length + ', panel ' + (p?.getAttribute('target-id') ?? 'none').slice(0, 30) + (tabs ? ', tabs ' + tabs : '') };
    }
  }
  // One line per time, in order.
  const seen = new Set<number>();
  return { state: 'ok', lines: lines.filter((l) => (seen.has(l.t) ? false : (seen.add(l.t), true))).sort((a, b) => a.t - b.t) };
  } finally {
    // However this read ended (lines, none, a timeout, an error): close what Skipz opened FIRST, then stop hiding, so the panel is never left open on your page.
    // Wait until YouTube has really closed it before the hiding is lifted (maintainer, 2026-10-12: "transcript pops up in youtube, I thought we solved this"): lifting it the same instant showed the panel
    // for a moment. If it will not close, it stays see-through (the hiding removes itself after 90 s) rather than appearing.
    let stuck = false;
    if (opened || leftover) {
      closeOurs();
      for (let i = 0; i < 10 && openOnes().length; i++) await sleep(100);
      // The close button did nothing (YouTube's newer "In this video" panel): shut it by its own state, and again until it is shut.
      for (let i = 0; i < 15 && openOnes().length; i++) { closeOurs(true); await sleep(100); }
      stuck = openOnes().length > 0;
      if (!stuck) flag.__skipzOpened = false;
    }
    if (!stuck) park('off');
    else {
      // It will not close. It stays see-through (never shown: maintainer, 2026-10-13, "its not acceptable") and Skipz keeps trying every 2 seconds, for up to 10 minutes, then lifts the hiding.
      let tries = 0;
      const again = window.setInterval(() => {
        closeOurs(true);
        if (!openOnes().length || ++tries > 300) { window.clearInterval(again); if (!openOnes().length) flag.__skipzOpened = false; park('off'); }
      }, 2000);
    }
  }
}
}

// First YouTube's own page interface (innertube.ts: two calls, no panel opened, nothing shown on your page), and only if that gives no lines, the on-screen reader below
// (maintainer, 2026-10-08: "let what you've built be a fallback"). A video id is needed for the first route.
export async function readTranscript(tabId: number, videoId?: string | null): Promise<TranscriptRead> {
  if (videoId) {
    const via = await transcriptViaPage(tabId, videoId);
    if (via.state === 'ok') return { state: 'ok', lines: via.lines.map((l) => ({ t: l.t, text: l.text })) };
  }
  try {
    const [res] = await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: grabTranscript });
    const r = res?.result as { state: string; lines?: TranscriptLine[]; why?: string } | undefined;
    if (r?.state === 'ok' && r.lines?.length) return { state: 'ok', lines: r.lines };
    return r?.state === 'none' ? { state: 'none' } : { state: 'timeout', why: r?.why };
  } catch {
    return { state: 'timeout' }; // tab closed or not a YouTube page any more
  }
}

// For Skipz's test tools: the same function, to run on a stand-in page.
export const _grabTranscript = grabTranscript;
