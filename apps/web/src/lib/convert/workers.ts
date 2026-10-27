/** Promise-based clients for the codec worker and LibRaw's worker. */
import { ConvertError, type Raster } from "./raster";

class WorkerClient {
  private worker: Worker | null = null;
  private next = 0;
  private pending = new Map<number, { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void }>();

  constructor(private readonly create: () => Worker) {}

  call(msg: Record<string, unknown>, transfer: Transferable[] = []): Promise<Record<string, unknown>> {
    if (!this.worker) {
      this.worker = this.create();
      this.worker.onmessage = ({ data }) => {
        const p = this.pending.get(data?.id);
        if (!p) return;
        this.pending.delete(data.id);
        if (data.error) p.reject(new Error(data.error));
        else p.resolve(data);
      };
      this.worker.onerror = (e) => {
        // A crashed worker (often out of memory) fails every waiting job and is replaced next time.
        for (const p of this.pending.values()) p.reject(new Error(e.message || "worker error"));
        this.pending.clear();
        this.worker?.terminate();
        this.worker = null;
      };
    }
    const id = this.next++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker!.postMessage({ ...msg, id }, transfer);
    });
  }
}

const codecs = new WorkerClient(() => new Worker(new URL("./codec.worker.ts", import.meta.url), { type: "module" }));

/** LibRaw ships its own worker (served from /vendor/libraw); it takes { id, fn, args }. */
const libraw = new WorkerClient(() => new Worker("/vendor/libraw/worker.js", { type: "module" }));

export async function decodeInWorker(kind: string, bytes: Uint8Array): Promise<Raster> {
  const out = await codecs.call({ op: "decode", kind, bytes }, [bytes.buffer]);
  return out.raster as Raster;
}

export async function encodeInWorker(format: string, raster: Raster, quality: number): Promise<Uint8Array> {
  // Copy frames: the caller keeps its raster for the next file or format.
  const copy: Raster = { ...raster, frames: raster.frames.map((f) => ({ delay: f.delay, data: f.data.slice() })) };
  const out = await codecs.call(
    { op: "encode", format, raster: copy, quality },
    copy.frames.map((f) => f.data.buffer),
  );
  return out.bytes as Uint8Array;
}

export async function decodeRaw(bytes: Uint8Array): Promise<Raster> {
  if (!globalThis.crossOriginIsolated) {
    throw new ConvertError("RAW photos need a newer browser. Try the latest Chrome, Edge, Firefox or Safari.");
  }
  await libraw.call({ fn: "open", args: [bytes, { useCameraWb: true, outputBps: 8, outputColor: 1 }] }, [bytes.buffer]);
  const out = (await libraw.call({ fn: "imageData", args: [] })).out as {
    width: number;
    height: number;
    colors: number;
    data: Uint8Array;
  };
  const { width, height, colors, data } = out;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0, j = 0; i < width * height; i++, j += colors) {
    rgba[i * 4] = data[j];
    rgba[i * 4 + 1] = data[j + (colors > 1 ? 1 : 0)];
    rgba[i * 4 + 2] = data[j + (colors > 2 ? 2 : 0)];
    rgba[i * 4 + 3] = 255;
  }
  return { width, height, frames: [{ data: rgba, delay: 0 }] };
}
