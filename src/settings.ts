import type { Mode } from './gate';

// What Skipz remembers, in the browser's own storage. Nothing here leaves the computer except findings, and those only after "I agree".
// listen: whether Skipz may listen to a video that has no captions it can read (the models are downloaded the first time): 'yes' is the default since 2026-10-24 (every detector runs on every video; maintainer's rule); an old stored 'ask' (the former default, never a choice) counts as 'yes'; only 'no' turns listening off
export type Listen = 'ask' | 'yes' | 'no';
export type Settings = { mode: Mode; agreed: string | null; lookBack: boolean; listen: Listen };
export const DEFAULTS: Settings = { mode: 'ask', agreed: null, lookBack: true, listen: 'yes' }; // ask before skipping is the default; "don't ask" (skips by itself) and "don't skip" (off) are the options (maintainer, 2026-10-22); lookBack is ON by default (maintainer, 2026-10-14); it runs only when the lock in gate.ts is open
export type StatKey = 'checked' | 'marked' | 'late' | 'asked' | 'skipped' | 'kept' | 'shared'; // late: marks that arrived after the sponsor had already begun (the speed check, maintainer 2026-11-01)
export type Stats = Record<StatKey, number>;
export const NO_STATS: Stats = { checked: 0, marked: 0, late: 0, asked: 0, skipped: 0, kept: 0, shared: 0 };

export async function loadSettings(): Promise<Settings> {
  try { return { ...DEFAULTS, ...((await chrome.storage.local.get('settings')).settings ?? {}) }; } catch { return DEFAULTS; }
}
export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await loadSettings()), ...patch };
  try { await chrome.storage.local.set({ settings: next }); } catch { /* storage unavailable: the choice lasts until the popup closes */ }
  return next;
}
export async function loadStats(): Promise<Stats> {
  try { return { ...NO_STATS, ...((await chrome.storage.local.get('stats')).stats ?? {}) }; } catch { return NO_STATS; }
}
export async function bump(key: StatKey): Promise<void> {
  try { const s = await loadStats(); s[key] += 1; await chrome.storage.local.set({ stats: s }); } catch { /* counting is never worth breaking the page for */ }
}
