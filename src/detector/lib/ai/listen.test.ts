import { describe, expect, it } from 'vitest';
import { listenInSlices, type Heard, type Transcribed } from './listen';

const slice = (secs = 5): Heard => ({ ok: true, pcm: new Float32Array(16000 * secs).fill(0.05), secs }); // a steady tone, so there is sound to read
const hush = (secs = 5): Heard => ({ ok: true, pcm: new Float32Array(16000 * secs), secs });
const words = (t: string): Transcribed => ({ text: t, ms: 100, loadMs: 0 });

describe('Skipz Transcribe listens in short slices', () => {
  it('stops as soon as the brand is found and does not use the full 15 seconds', async () => {
    const said = ['Hey everyone welcome back to the channel today', 'this video is sponsored by Anker and their new charger', 'more words nobody needs'];
    let i = 0;
    const r = await listenInSlices(1, { hearFn: async () => slice(), transcribeFn: async () => words(said[i++] ?? 'x'), enough: async (t) => /sponsored by Anker/.test(t) });
    expect(r.ok && r.early).toBe(true);
    expect(r.ok && r.secs).toBe(10); // two slices, not three
    expect(r.ok && r.text).toContain('sponsored by Anker');
  });
  it('goes on to the 15-second limit when no brand is found', async () => {
    const r = await listenInSlices(1, { hearFn: async () => slice(), transcribeFn: async () => words('just talking about nothing in particular here for a while'), enough: async () => false });
    expect(r.ok && r.early).toBe(false);
    expect(r.ok && r.secs).toBe(15);
  });
  it('keeps what it heard when the video is paused part way', async () => {
    let n = 0;
    const r = await listenInSlices(1, { hearFn: async () => (++n <= 2 ? slice() : { ok: false, why: 'paused' }), transcribeFn: async () => words('some words that fill the slice nicely here'), enough: async () => false });
    expect(r.ok && r.secs).toBe(10);
  });
  it('says why when it cannot hear anything at all', async () => {
    const r = await listenInSlices(1, { hearFn: async () => ({ ok: false, why: 'Press play first' }), transcribeFn: async () => words(''), enough: async () => false });
    expect(r).toEqual({ ok: false, why: 'Press play first' });
  });
  it('keeps all the sound it heard and where the video was when it began, for the second pass', async () => {
    let at = 61;
    const r = await listenInSlices(1, { hearFn: async () => ({ ...slice(), at: at++ }), transcribeFn: async (p) => { p.fill(1); return words('some words that fill the slice nicely here'); }, enough: async () => false });
    expect(r.ok && r.pcm.length).toBe(16000 * 15);
    expect(r.ok && r.startAt).toBe(61);
    expect(r.ok && r.pcm.every((x) => x === Math.fround(0.05))).toBe(true); // a copy taken before the speech model got the original
  });
  it('does not send silence to the speech model', async () => {
    let read = 0;
    const r = await listenInSlices(1, { hearFn: async () => hush(), transcribeFn: async () => { read++; return words('invented words from nothing at all'); }, enough: async () => false });
    expect(read).toBe(0);
    expect(r.ok && r.text).toBe('');
    expect(r.ok && r.secs).toBe(15);
  });
  it('does not ask Needle about a handful of words', async () => {
    let asked = 0;
    await listenInSlices(1, { hearFn: async () => slice(), transcribeFn: async () => words('uh'), enough: async () => { asked++; return true; } });
    expect(asked).toBe(0);
  });
  it('passes on a speech model failure', async () => {
    const r = await listenInSlices(1, { hearFn: async () => slice(), transcribeFn: async () => ({ error: 'model failed' }), enough: async () => false });
    expect(r).toEqual({ ok: false, why: 'model failed' });
  });
});
