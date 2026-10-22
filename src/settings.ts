import type { Mode } from './gate';

// What Skipz remembers, in the browser's own storage. Nothing here leaves the computer except findings, and those only after "I agree".
export type Settings = { mode: Mode; agreed: string | null; lookBack: boolean };
export const DEFAULTS: Settings = { mode: 'ask', agreed: null, lookBack: true }; // lookBack is ON by default (maintainer, 2026-10-14); it runs only when the lock in gate.ts is open // ask first: Skipz never skips by itself unless the lock is open AND the person chose it
export type StatKey = 'checked' | 'marked' | 'asked' | 'skipped' | 'kept' | 'shared';
export type Stats = Record<StatKey, number>;
export const NO_STATS: Stats = { checked: 0, marked: 0, asked: 0, skipped: 0, kept: 0, shared: 0 };

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
