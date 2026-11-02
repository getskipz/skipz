import { describe, it, expect } from 'vitest';
import { withMiss, MISS_CAP, type Miss } from './misses';

const m = (id: string, why = 'found, not placed'): Miss => ({ videoId: id, title: 't', channel: 'c', lengthSeconds: 100, paid: true, description: 'd', chapters: [], captionLines: [{ t: 1, text: 'x' }], brand: 'B', confidence: 0.64, why, at: '2026-11-01', version: '0.4.0' });

describe('the misses Skipz keeps', () => {
  it('keeps a video once: a second look replaces the first', () => {
    const l = withMiss(withMiss([], m('aaaaaaaaaaa')), m('aaaaaaaaaaa', 'placed by a guess'));
    expect(l).toHaveLength(1);
    expect(l[0].why).toBe('placed by a guess');
  });
  it('keeps the newest ones when there are too many', () => {
    let l: Miss[] = [];
    for (let i = 0; i < MISS_CAP + 5; i++) l = withMiss(l, m('v' + String(i).padStart(10, '0')));
    expect(l).toHaveLength(MISS_CAP);
    expect(l[0].videoId).toBe('v' + String(5).padStart(10, '0'));
    expect(l[l.length - 1].videoId).toBe('v' + String(MISS_CAP + 4).padStart(10, '0'));
  });
});
