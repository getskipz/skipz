// The toolbar popup. First time: one screen, one button ("I agree"). After that: three big choices (Ask me / Skip by itself / Off), the numbers so far, and a copy button for support.
import { loadSettings, saveSettings, loadStats, type Stats } from './settings';
import { skipGate, effectiveMode, type Mode } from './gate';
import { INDEX_URL } from './sharedList';

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

async function render() {
  const s = await loadSettings();
  if (INDEX_URL && !s.agreed) return agreeScreen(); // there is nothing to agree to until findings can be shared
  const stats = await loadStats();
  const gate = skipGate();
  const pick = (m: Mode) => { void saveSettings({ mode: m }).then(render); };
  const now = effectiveMode(s.mode);
  app.replaceChildren(
    el('h1', {}, 'Skipz', el('small', {}, now === 'off' ? 'Off' : 'On')),
    el('div', { class: 'modes' },
      choice('ask', now, 'Ask me before skipping', 'Marks the sponsor, then asks: Skip it?', pick),
      choice('skip', now, 'Don’t ask me before skipping', 'Skips the sponsor by itself. Undo is one tap.', pick),
      choice('off', now, 'Don’t skip', 'Skipz does nothing', pick),
    ),
    el('div', { class: 'nums' }, ...(['checked', 'marked', 'skipped'] as (keyof Stats)[]).map((k) => el('div', {}, el('b', {}, String(stats[k])), el('span', {}, k === 'checked' ? 'looked at' : k === 'marked' ? 'marked' : 'skipped')))),
    el('p', { class: 'muted' }, 'Skipz reads the video’s own captions and description on your computer. Nothing is sent anywhere.'),
    el('button', { class: 'link', type: 'button', onclick: async (e: Event) => { await navigator.clipboard.writeText(JSON.stringify({ version: chrome.runtime.getManifest().version, settings: s, stats, skipLockMissing: gate.missing, indexSet: !!INDEX_URL }, null, 2)); (e.target as HTMLElement).textContent = 'Copied'; } }, 'Copy info for support'),
    el('p', { class: 'fine' }, 'Skipz isn’t perfect. It can miss a sponsor or mark the wrong stretch, so Undo is always one tap. Spot a mistake? Tell us at github.com/getskipz/skipz and you help everyone.'),
  );
}
void render();
