// Listen (maintainer, 2026-10-05: "Moonshine ... build the small version"): the video's own sound, turned into words ON THIS
// COMPUTER, for videos YouTube has no transcript for. This small version listens for ~30 seconds of what is PLAYING in the
// tab (it never starts or changes the video), and shows the words, so we can judge it on a real video before building more.
// The speech model (Moonshine tiny, MIT, 31 MB) is downloaded from Hugging Face once, after Skipz asks (ask-first 'huggingface');
// the sound itself never leaves the computer.

export type Heard = { ok: true; pcm: Float32Array; secs: number; at?: number } | { ok: false; why: string }; // at: where the video was (seconds) when the listening began

// Runs INSIDE the YouTube page (chrome.scripting serialises it): it must not use anything from outside this function.
// Captures what the page's video is playing, 16 kHz mono, for `seconds` of real time. Returns 16-bit samples as base64.
export async function captureInPage(seconds: number): Promise<{ ok: true; b64: string; secs: number; at: number } | { ok: false; why: string }> {
  const v = (document.querySelector('video.html5-main-video') || document.querySelector('video')) as (HTMLVideoElement & { captureStream?: () => MediaStream }) | null;
  if (!v) return { ok: false, why: 'No video found on this page.' };
  if (v.paused || v.ended) return { ok: false, why: 'Press play first: Skipz listens to what is playing, it never starts the video.' };
  if (!v.captureStream) return { ok: false, why: "This page's video can't be listened to." };
  let tracks: MediaStreamTrack[];
  try { tracks = v.captureStream().getAudioTracks(); } catch (e) { return { ok: false, why: "Chrome wouldn't let Skipz listen to this video: " + String((e as Error).message || e) }; }
  if (!tracks.length) return { ok: false, why: 'No sound yet. Let the video play a moment and try again.' };
  const at = v.currentTime;
  const ctx = new AudioContext({ sampleRate: 16000 });
  const chunks: Float32Array[] = [];
  let n = 0;
  const want = 16000 * seconds;
  // Whatever happens, the listening is switched off again (CodeRabbit review, 2026-10-05): the processor and source are
  // disconnected, the captured tracks stopped and the audio context closed, even when one of them throws.
  let src: MediaStreamAudioSourceNode | null = null;
  let proc: ScriptProcessorNode | null = null;
  try {
    src = ctx.createMediaStreamSource(new MediaStream(tracks));
    proc = ctx.createScriptProcessor(4096, 1, 1);
    proc.onaudioprocess = (e) => { const d = e.inputBuffer.getChannelData(0); chunks.push(new Float32Array(d)); n += d.length; };
    src.connect(proc);
    proc.connect(ctx.destination); // silent: nothing is written to the output
    await new Promise<void>((done) => {
      const t0 = Date.now();
      const iv = setInterval(() => { if (n >= want || Date.now() - t0 > (seconds + 6) * 1000 || v.paused || (window as unknown as { __skipzStopListen?: boolean }).__skipzStopListen) { clearInterval(iv); done(); } }, 200);
    });
  } finally {
    try { proc?.disconnect(); } catch { /* already gone */ }
    try { src?.disconnect(); } catch { /* already gone */ }
    for (const t of tracks) { try { t.stop(); } catch { /* fine */ } }
    try { await ctx.close(); } catch { /* already closed */ }
  }
  if (n < 16000) return { ok: false, why: 'Skipz heard less than a second. Was the video paused?' };
  const len = Math.min(n, want);
  const pcm = new Int16Array(len);
  let o = 0;
  for (const c of chunks) { for (let i = 0; i < c.length && o < len; i++, o++) pcm[o] = Math.max(-1, Math.min(1, c[i])) * 32767; if (o >= len) break; }
  const bytes = new Uint8Array(pcm.buffer);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { ok: true, b64: btoa(bin), secs: len / 16000, at };
}

// 16-bit samples (base64) -> the floats the speech model takes.
export function pcmFromBase64(b64: string): Float32Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const i16 = new Int16Array(bytes.buffer, 0, bytes.length >> 1);
  const out = new Float32Array(i16.length);
  for (let i = 0; i < i16.length; i++) out[i] = i16[i] / 32768;
  return out;
}

export async function hear(tabId: number, seconds = 30): Promise<Heard> {
  try {
    const [res] = await chrome.scripting.executeScript({ target: { tabId }, func: captureInPage, args: [seconds] });
    const r = res?.result as Awaited<ReturnType<typeof captureInPage>> | undefined;
    if (!r) return { ok: false, why: "Skipz couldn't listen to this tab." };
    return r.ok ? { ok: true, pcm: pcmFromBase64(r.b64), secs: r.secs, at: r.at } : r;
  } catch (e) {
    return { ok: false, why: "Skipz couldn't listen to this tab: " + String((e as Error).message || e) };
  }
}

// ---- The speech model (a worker; the first run downloads it) ------------------------------------------------------------
export type ListenProgress = { loaded: number; total: number };
export type Transcribed = { text: string; ms: number; loadMs: number } | { error: string };

let worker: Worker | null = null;
let seq = 0;
const waiting = new Map<number, { done: (m: Transcribed) => void; progress?: (p: ListenProgress) => void }>();

export function transcribe(pcm: Float32Array, progress?: (p: ListenProgress) => void): Promise<Transcribed> {
  if (!worker) {
    worker = new Worker(new URL('./listen.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const m = e.data as { id: number; progress?: { status?: string; loaded?: number; total?: number }; text?: string; ms?: number; loadMs?: number; error?: string };
      const w = waiting.get(m.id);
      if (!w) return;
      if (m.progress) { if (m.progress.status === 'progress' && m.progress.total) w.progress?.({ loaded: m.progress.loaded ?? 0, total: m.progress.total }); return; }
      waiting.delete(m.id);
      w.done(m.error ? { error: m.error } : { text: m.text ?? '', ms: m.ms ?? 0, loadMs: m.loadMs ?? 0 });
    };
    worker.onerror = (e) => { for (const [id, w] of waiting) { waiting.delete(id); w.done({ error: e.message || 'The speech model stopped.' }); } worker?.terminate(); worker = null; };
  }
  const id = ++seq;
  return new Promise((done) => {
    waiting.set(id, { done, progress });
    worker!.postMessage({ id, pcm, ortBase: chrome.runtime.getURL('ort/') }, [pcm.buffer]);
  });
}

// Runs INSIDE the page: tells a capture that is still running to stop (or clears the sign before a new listening starts).
function setStopSign(on: boolean): void { (window as unknown as { __skipzStopListen?: boolean }).__skipzStopListen = on; }
async function stopSign(tabId: number, on: boolean) { try { await chrome.scripting.executeScript({ target: { tabId }, func: setStopSign, args: [on] }); } catch { /* the tab is gone: nothing to stop */ } }

// Listens in short slices instead of one long stretch (maintainer, 2026-10-06: "shrinking that time will be better"): each slice is turned
// into words while the next one is being heard, and `enough` looks at the words so far (Skipz asks Needle for the brand). The moment it
// says yes the listening stops; otherwise it goes on until `max` seconds. The video is never started, paused or changed.
// pcm and startAt: all the sound heard and where the video was when it began, kept for the second pass (whistle.ts), which needs the sound again.
export type Listened = { ok: true; text: string; secs: number; ms: number; loadMs: number; early: boolean; pcm: Float32Array; startAt: number | null } | { ok: false; why: string };
// Silence is not sent to the speech model at all (it only wastes time, and a model can invent words from nothing).
export const hasSound = (pcm: Float32Array, floor = 0.003): boolean => { let s = 0; for (let i = 0; i < pcm.length; i++) s += pcm[i] * pcm[i]; return Math.sqrt(s / Math.max(1, pcm.length)) >= floor; };
export async function listenInSlices(tabId: number, o: { slice?: number; max?: number; enough: (text: string) => Promise<boolean>; onHeard?: (secs: number) => void; onReading?: (pct: number | null) => void; hearFn?: typeof hear; transcribeFn?: typeof transcribe }): Promise<Listened> {
  const hearIt = o.hearFn ?? hear;
  const readIt = o.transcribeFn ?? transcribe;
  const slice = o.slice ?? 5;
  const max = o.max ?? 15;
  const slices = Math.max(1, Math.round(max / slice));
  await stopSign(tabId, false);
  let text = '';
  let secs = 0, ms = 0, loadMs = 0;
  let early = false;
  const kept: Float32Array[] = [];
  let startAt: number | null = null;
  let pending: Promise<Heard> | null = hearIt(tabId, slice);
  for (let i = 0; i < slices && pending; i++) {
    const h = await pending;
    pending = null;
    if (!h.ok) { if (secs > 0) break; return h; }
    if (startAt === null && typeof h.at === 'number') startAt = h.at;
    const quiet = !hasSound(h.pcm);
    kept.push(h.pcm.slice()); // the speech model takes the original (it is handed over, so it cannot be used again)
    secs += h.secs;
    o.onHeard?.(secs);
    if (i < slices - 1) pending = hearIt(tabId, slice); // the next slice is heard while this one is read: no sound is missed
    o.onReading?.(null);
    const r = quiet ? { text: '', ms: 0, loadMs: 0 } : await readIt(h.pcm, (pr) => o.onReading?.(Math.round((pr.loaded / pr.total) * 100)));
    if ('error' in r) { await stopSign(tabId, true); await pending?.catch(() => undefined); return { ok: false, why: r.error }; }
    text = (text ? text + ' ' : '') + r.text.trim();
    ms += r.ms;
    loadMs += r.loadMs;
    if (i < slices - 1 && text.length >= 40 && (await o.enough(text))) { early = true; break; }
  }
  await stopSign(tabId, true);
  await pending?.catch(() => undefined); // a capture still running ends before a later listening can start
  const pcm = new Float32Array(kept.reduce((n, k) => n + k.length, 0));
  kept.reduce((o2, k) => { pcm.set(k, o2); return o2 + k.length; }, 0);
  return { ok: true, text, secs, ms, loadMs, early, pcm, startAt };
}
