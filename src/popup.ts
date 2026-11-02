// The toolbar popup. First time: one screen, one button ("I agree"). After that: four big choices (Ask me / Skip by itself / Support the creator / Off), the numbers so far, and a copy button for support.
import { loadSettings, saveSettings, loadStats, type Stats } from './settings';
import { skipGate, effectiveMode, type Mode } from './gate';
import { INDEX_URL } from './sharedList';
import { loadMisses, type Miss } from './misses';

const app = document.getElementById('app')!;
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & { class?: string } = {}, ...kids: (Node | string)[]) => {
  const { class: cls, ...rest } = props;
  const n = Object.assign(document.createElement(tag), rest);
  if (cls) n.className = cls;
  n.append(...kids);
  return n;
};
const today = () => new Date().toISOString().slice(0, 10);

function agreeScreen() {
  app.replaceChildren(
    el('h1', {}, 'Skipz'),
    el('p', {}, 'Skipz marks sponsor segments on YouTube and skips them for you. It asks first, unless you tell it not to.'),
    el('p', { class: 'muted' }, 'When Skipz finds a sponsor, it adds the brand and the time to a shared list that everyone’s Skipz builds together, so others can skip it too. It never shares who you are or what else you watch.'),
    el('button', { class: 'go', type: 'button', onclick: async () => { await saveSettings({ agreed: today() }); void render(); } }, 'I agree'),
    el('p', { class: 'muted' }, 'Not for you? Remove Skipz on Chrome’s extensions page.'),
  );
}

const choice = (mode: Mode, now: Mode, title: string, sub: string, set: (m: Mode) => void, locked?: Node) => {
  const b = el('button', { class: 'mode', type: 'button', disabled: !!locked, onclick: () => set(mode) }, el('i', { class: 'dot' }), el('div', {}, el('b', {}, title), el('span', {}, sub), ...(locked ? [locked] : [])));
  b.setAttribute('aria-pressed', String(mode === now));
  return b;
};

// The listening switch: Skipz hears every video's sound as well as reading its captions (on this computer; the first time it downloads two small models).
const listenRow = (on: boolean, set: (yes: boolean) => void, status?: { state: string; pct: number; at: number }) => {
  const fresh = status && Date.now() - status.at < 6 * 3600 * 1000;
  const line = !on ? 'Off. Sound never leaves your computer.' : fresh && status!.state === 'getting ready' && status!.pct < 100 ? 'Getting ready: ' + status!.pct + '% (one-time 48 MB download)' : fresh && status!.state === 'could not get ready' ? 'Could not get ready; it tries again on the next video.' : fresh && status!.state === 'ready' ? 'Ready. Sound never leaves your computer.' : 'One-time 48 MB download. Sound never leaves your computer.';
  const getting = on && fresh && status!.state === 'getting ready' && status!.pct < 100;
  const b = el('button', { class: 'mode', type: 'button', onclick: () => set(!on) }, el('i', { class: 'dot' }), el('div', {}, el('b', {}, 'Listen to every video'), el('span', {}, line), ...(getting ? [(() => { const bar = el('div', { class: 'bar', role: 'progressbar' }, el('i')); bar.setAttribute('aria-valuenow', String(status!.pct)); (bar.firstChild as HTMLElement).style.width = status!.pct + '%'; return bar; })()] : [])));
  b.setAttribute('aria-pressed', String(on));
  return b;
};

async function render() {
  const s = await loadSettings();
  if (INDEX_URL && !s.agreed) return agreeScreen(); // there is nothing to agree to until findings can be shared
  const stats = await loadStats();
  const misses = await loadMisses();
  const gate = skipGate();
  const pick = (m: Mode) => { void saveSettings({ mode: m }).then(render); };
  const now = effectiveMode(s.mode);
  app.replaceChildren(
    el('h1', {}, 'Skipz', el('small', {}, now === 'off' ? 'Off' : 'On')),
    el('div', { class: 'modes' },
      choice('ask', now, 'Ask me before skipping', 'Marks the sponsor, then asks: Skip it?', pick),
      choice('skip', now, 'Don’t ask me before skipping', 'Skips the sponsor by itself. Undo is one tap.', pick),
      choice('support', now, 'Support the creator', 'Never skips. Shows the sponsor’s link for 10 seconds, and again at the end.', pick),
      choice('off', now, 'Don’t skip', 'Skipz does nothing', pick),
    ),
    ...(typeof chrome.offscreen?.createDocument === 'function' ? [el('div', { class: 'modes' }, listenRow(s.listen !== 'no', (yes) => { void saveSettings({ listen: yes ? 'yes' : 'no' }).then(render); }, (await chrome.storage.local.get('listenStatus')).listenStatus as { state: string; pct: number; at: number } | undefined))] : []), // browsers without the hidden page (Firefox) have no listening
    el('div', { class: 'nums' }, ...(['checked', 'marked', 'skipped', 'kept'] as (keyof Stats)[]).map((k) => el('div', {}, el('b', {}, String(stats[k])), el('span', {}, k === 'checked' ? 'looked at' : k === 'marked' ? 'marked' : k === 'kept' ? 'supported' : 'skipped')))),
    ...(stats.marked > 0 ? [el('p', { class: 'muted' }, 'Found before the sponsor began: ' + Math.max(0, stats.marked - stats.late) + ' of ' + stats.marked)] : []),
    el('p', { class: 'muted' }, 'Skipz reads the video’s captions and description and listens to every video, all on your computer. Nothing about you or your videos is sent anywhere.'),
    el('button', { class: 'link', type: 'button', onclick: async (e: Event) => { await navigator.clipboard.writeText(JSON.stringify({ version: chrome.runtime.getManifest().version, settings: s, stats, lastCheck: (await chrome.storage.local.get('lastCheck')).lastCheck ?? null, skipLockMissing: gate.missing, indexSet: !!INDEX_URL }, null, 2)); (e.target as HTMLElement).textContent = 'Copied'; } }, 'Copy info for support'),
    ...(misses.length ? [el('button', { class: 'link', type: 'button', onclick: () => saveMisses(misses) }, 'Save the ' + misses.length + (misses.length === 1 ? ' video' : ' videos') + ' Skipz was unsure about')] : []),
    el('p', { class: 'fine' }, el('b', {}, 'Skipz gets sharper with every miss you send.'), el('br'), 'Missed a sponsor or marked the wrong stretch? Undo is one tap, then tell us at github.com/getskipz/skipz.'),
  );
}
// The videos where Skipz was sure of a sponsor but could not place it exactly: saved to a file the person can send us (nothing is sent by Skipz itself).
function saveMisses(list: Miss[]) {
  const a = el('a', { href: URL.createObjectURL(new Blob([JSON.stringify(list, null, 1)], { type: 'application/json' })), download: 'skipz-unsure-videos-' + today() + '.json' });
  document.body.append(a); a.click(); a.remove();
}
void render();
