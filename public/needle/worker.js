// Needle on this computer (maintainer, 2026-10-05: "bundle Needle"). Cactus-Compute/needle3 (Apache-2.0, see LICENSE here):
// a 121M-parameter model that runs as WebAssembly in this worker. Nothing is sent anywhere. It only names a brand from a
// short text when no other check could; the ad-signal check decides whether the text is an ad at all.
// Plain classic worker (not bundled): messages in {id, text}, out {id, brand, ms} or {id, error}; {ready} once loaded.
importScripts('needle.js');

const TOOLS = [{
  name: 'report_paid_sponsor',
  description: 'Call ONLY when the text says a company paid for or sponsors this video (sponsored by, thanks to X for sponsoring, try X free, use code, get credits, X is the sponsor). Never for the creators own links, merch, social accounts, donations, or the video topic.',
  parameters: { type: 'object', properties: { brand: { type: 'string', description: 'company name as written, e.g. NordVPN' }, time: { type: 'string', description: 'm:ss where the ad plays, only if written' } }, required: ['brand'] },
}];

let M = null;
let loading = null;
let out = 0;
const CAP = 8192;
const url = (p) => new URL(p, self.location.href).href;

async function load() {
  M = await createNeedle({ locateFile: url });
  const bytes = new Uint8Array(await (await fetch(url('needle3.cact'))).arrayBuffer());
  const ptr = M._malloc(bytes.length);
  M.HEAPU8.set(bytes, ptr);
  if (M._needle_load(ptr, BigInt(bytes.length)) < 0) throw new Error('Needle could not load its model.');
  M._free(ptr);
  const init = M.ccall('needle_init', 'number', ['string', 'string', 'number'], ['You read text from a YouTube video page and extract who paid for the video.', JSON.stringify(TOOLS), 0]);
  if (init < 0) throw new Error('Needle could not start.');
  out = M._malloc(CAP);
}

onmessage = async (e) => {
  const { id, text } = e.data;
  try {
    if (!loading) loading = load();
    await loading;
    M._needle_reset();
    const s = Date.now();
    const n = M.ccall('needle_complete', 'number', ['string', 'number', 'number', 'number'], [String(text).slice(0, 1500), 220, out, CAP]);
    let parsed = null;
    try { parsed = JSON.parse(n >= 0 ? M.UTF8ToString(out) : '{}'); } catch { /* no answer */ }
    const call = (parsed && (parsed.function_calls && parsed.function_calls[0])) || (parsed && parsed.suppressed_calls && parsed.suppressed_calls[0]);
    postMessage({ id, brand: (call && call.arguments && call.arguments.brand) || null, ms: Date.now() - s });
  } catch (err) {
    loading = null;
    postMessage({ id, error: String((err && err.message) || err) });
  }
};
