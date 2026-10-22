// The speech model for Listen: Moonshine tiny (UsefulSensors, MIT) through transformers.js, on this computer's processor.
// The runtime's own files ship inside the extension (public/ort, copied by tools/copy-ort.cjs); only the model is
// downloaded, once, from Hugging Face after Skipz asked.
import { pipeline, env } from '@huggingface/transformers';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let asr: any = null;
let loadMs = 0;
const post = (m: unknown) => (self as unknown as Worker).postMessage(m);

self.onmessage = async (e: MessageEvent<{ id: number; pcm: Float32Array; ortBase: string }>) => {
  const { id, pcm, ortBase } = e.data;
  try {
    if (!asr) {
      env.allowLocalModels = false;
      env.useWasmCache = false; // otherwise the runtime is re-wrapped as a blob: address, which an extension page may not run
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const wasm = (env.backends as any).onnx.wasm;
      wasm.wasmPaths = { mjs: ortBase + 'ort-wasm-simd-threaded.mjs', wasm: ortBase + 'ort-wasm-simd-threaded.wasm' };
      wasm.numThreads = 1;
      const t0 = Date.now();
      asr = await pipeline('automatic-speech-recognition', 'onnx-community/moonshine-tiny-ONNX', {
        dtype: 'q8',
        device: 'wasm',
        progress_callback: (p: unknown) => post({ id, progress: p }),
      });
      loadMs = Date.now() - t0;
    }
    const s = Date.now();
    const r = await asr(pcm);
    post({ id, text: String(r?.text ?? '').trim(), ms: Date.now() - s, loadMs });
  } catch (err) {
    asr = null;
    post({ id, error: String((err as Error)?.message ?? err) });
  }
};
