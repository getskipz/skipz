// Save only the misses (maintainer, 2026-11-01: "save only the misses ... yes"). When Skipz is sure there is a sponsor but could not place it, or could place it only by a best guess, the video's own words are kept on this
// computer (the same fields the fixture recorder uses, so a saved miss can be dropped straight into the replay tests). The person can save them to a file from the toolbar popup and send it. Nothing leaves the computer by itself.
export type Miss = {
  videoId: string; title: string | null; channel: string | null; lengthSeconds: number | null; paid: boolean; description: string | null;
  chapters: { title: string; startSeconds: number }[]; captionLines: { t: number; text: string }[] | null;
  brand: string | null; confidence: number; why: string; at: string; version: string;
};
export const MISS_KEY = 'skipzMisses';
export const MISS_CAP = 25; // oldest dropped first: a few hundred KB at most

/** The list with this miss in it once (a second look at the same video replaces the first), newest last, at most `cap`. */
export function withMiss(list: Miss[], m: Miss, cap = MISS_CAP): Miss[] {
  return [...list.filter((x) => x.videoId !== m.videoId), m].slice(-cap);
}

export async function keepMiss(m: Miss): Promise<void> {
  try {
    const cur = ((await chrome.storage.local.get(MISS_KEY))[MISS_KEY] as Miss[] | undefined) ?? [];
    await chrome.storage.local.set({ [MISS_KEY]: withMiss(cur, m) });
  } catch { /* storage full or not available: just not kept */ }
}

export async function loadMisses(): Promise<Miss[]> {
  try { return ((await chrome.storage.local.get(MISS_KEY))[MISS_KEY] as Miss[] | undefined) ?? []; } catch { return []; }
}
