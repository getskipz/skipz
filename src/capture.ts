// Capture, in the YouTube page's own world (maintainer, 2026-10-26: "add capture to Skipz and run it concurrently with the other method"). It runs at the very start of the page.
// 1) Always: whenever the PLAYER downloads a caption file (YouTube's own request, with the page's own permission), the file is kept and the page script is told. Nothing is asked for, nothing is changed.
// 2) On request ('skipz-cap-ask'): the player's captions are switched on with the caption box made see-through, so it downloads one; then they are put back the way they were. A caption box that was already on is asked for its track again.
// Self-contained: no imports (it is a separate file the manifest runs in the page's world). Chrome only for now (Firefox does not run it).
(() => {
  const W = window as unknown as { __skipzCapHooked?: boolean };
  if (W.__skipzCapHooked) return;
  W.__skipzCapHooked = true;
  let told = 0;
  const tell = (url: string, body: string) => {
    if (!body || url.indexOf('timedtext') < 0) return;
    const ok = (b: string): boolean => { const s = b.trimStart(); return (s.startsWith('{') && s.includes('"events"')) || (s.startsWith('<') && !/^<(!doctype|html)/i.test(s) && /<(transcript|timedtext|text|p)\b/i.test(s)); }; // an error page is not a caption file (seen 2026-10-26: YouTube answered the player's own caption request with a 1 KB web page, and it was taken for captions)
    if (!ok(body)) return;
    told++;
    let v = '', lang = '', auto = false;
    try { const u = new URL(url, location.href); v = u.searchParams.get('v') ?? ''; lang = u.searchParams.get('lang') ?? ''; auto = u.searchParams.get('kind') === 'asr'; } catch { /* leave blank */ }
    document.dispatchEvent(new CustomEvent('skipz-cap', { detail: JSON.stringify({ v, lang, auto, body: body.slice(0, 3000000), at: Date.now() }) }));
  };
  const of = window.fetch;
  window.fetch = async function (this: unknown, ...a: Parameters<typeof fetch>) {
    const r = await of.apply(this, a);
    try { const u = String((a[0] as Request)?.url ?? a[0]); if (u.indexOf('timedtext') >= 0) r.clone().text().then((t) => tell(u, t)).catch(() => {}); } catch { /* not ours to break */ }
    return r;
  } as typeof fetch;
  const ox = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (this: XMLHttpRequest, ...a: Parameters<XMLHttpRequest['send']>) {
    this.addEventListener('load', () => { try { if (String(this.responseURL).indexOf('timedtext') >= 0) tell(this.responseURL, this.responseText || ''); } catch { /* not ours to break */ } });
    return ox.apply(this, a);
  };

  type Track = { languageCode?: string; kind?: string };
  type Player = { toggleSubtitlesOn?: () => void; toggleSubtitles?: () => void; getOption?: (m: string, o: string) => unknown; setOption?: (m: string, o: string, v: unknown) => void };
  let busy = false;
  document.addEventListener('skipz-cap-ask', async () => {
    if (busy) return;
    busy = true;
    const done = (why: string) => { busy = false; document.dispatchEvent(new CustomEvent('skipz-cap-done', { detail: why })); };
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const mp = document.querySelector('#movie_player') as unknown as Player | null;
    if (!mp || typeof mp.getOption !== 'function' || typeof mp.toggleSubtitlesOn !== 'function') return done('the player is not ready');
    let wasOn = false; let current: Track = {}; let switched = false; let styled = false;
    // What the viewer SEES is the captions button (aria-pressed): it is right from the moment the controls exist, while the player's own track answer can lag behind the viewer's saved choice (seen 2026-10-26: a switch that read "off" too early turned the viewer's captions off at the end).
    const button = () => document.querySelector('.ytp-subtitles-button') as HTMLElement | null;
    const shownOn = (): boolean | null => { const b = button(); return b ? b.getAttribute('aria-pressed') === 'true' : null; };
    const style = document.createElement('style');
    style.textContent = '.ytp-caption-window-container,.caption-window{opacity:0!important}';
    try {
      // Seen on real YouTube (2026-10-26): the player can answer an EMPTY track list even with captions running, so an empty list is not "no captions": the switch goes ahead without it (the other-track step below needs the list).
      // Wait until the viewer's captions button has SETTLED: the player applies the saved choice a few seconds after the controls are drawn, and a switch that looked too early turned captions off at the end (2026-10-26).
      // Settled = the same value for 2.5 s, and at least 5 s since the page started. Never guess: if it does not settle, nothing is touched.
      let seen: boolean | null = null; let since = Date.now();
      for (let i = 0; i < 40; i++) {
        const now = shownOn();
        if (now !== seen) { seen = now; since = Date.now(); }
        if (seen !== null && Date.now() - since >= 2500 && performance.now() >= 5000) break;
        await sleep(250);
        if (i === 39) seen = null;
      }
      if (seen === null) return done('the captions button did not settle');
      wasOn = seen;
      // Captions the viewer is SEEING are never touched or hidden: the player's own download is kept by the hook above as it happens, and that is all this needs.
      if (wasOn) return done('captions are on: nothing to switch');
      let list: Track[] = [];
      try { list = (mp.getOption('captions', 'tracklist') as Track[] | undefined) ?? []; } catch { list = []; }
      current = (mp.getOption('captions', 'track') as Track | undefined) ?? {}; // read AFTER the wait: the track the viewer really has
      document.documentElement.appendChild(style); styled = true;
      if (!wasOn) { mp.toggleSubtitlesOn(); switched = true; } else if (current.languageCode) { mp.setOption?.('captions', 'track', current); switched = true; } // already on: ask for its own track again so the download is seen
      // Wait for the player's own download (up to 8 s); if none came in 3.5 s, press the switch once more (the captions part of the player may not have been ready the first time).
      const base = told;
      for (let i = 0; i < 40 && told === base; i++) {
        await sleep(200);
        if (i === 17 && told === base && !wasOn) { try { mp.toggleSubtitles?.(); await sleep(300); mp.toggleSubtitlesOn(); } catch { /* fine */ } }
      }
      await sleep(300);
      // The other kind of track in the same language (creator-made against automatic), when there is one.
      const lang = (current.languageCode || list[0]?.languageCode || 'en').slice(0, 2);
      const other = list.find((t) => (t.languageCode ?? '').slice(0, 2) === lang && (t.kind === 'asr') !== (current.kind === 'asr'));
      if (other) { try { mp.setOption?.('captions', 'track', other); } catch { /* fine */ } await sleep(3000); }
      done('ok');
    } catch (e) {
      done(String((e as Error)?.message ?? e).slice(0, 80));
    } finally {
      // Only what this run changed is put back (a run that found no tracks touched nothing).
      try {
        if (switched) {
          await sleep(200);
          if (wasOn && shownOn() === false) { mp.toggleSubtitlesOn?.(); }
          else if (!wasOn && shownOn() === true) { mp.toggleSubtitles?.(); }
        }
      } catch { /* fine */ }
      if (styled) setTimeout(() => style.remove(), 600);
    }
  });
})();
