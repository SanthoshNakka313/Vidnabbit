/** Bundles converted files into one ZIP (stored, not compressed: images and PDFs are already compressed). */
export async function zipFiles(files: { name: string; blob: Blob }[]): Promise<Blob> {
  const { zipSync } = await import("fflate");
  const entries: Record<string, [Uint8Array, { level: 0 }]> = {};
  for (const f of files) {
    entries[uniqueName(f.name, entries)] = [new Uint8Array(await f.blob.arrayBuffer()), { level: 0 }];
  }
  return new Blob([zipSync(entries) as BlobPart], { type: "application/zip" });
}

/** "a.png", "a.png" -> "a.png", "a (2).png" */
export function uniqueName(name: string, taken: Record<string, unknown>): string {
  if (!(name in taken)) return name;
  const dot = name.lastIndexOf(".");
  const [base, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
  for (let i = 2; ; i++) {
    const candidate = `${base} (${i})${ext}`;
    if (!(candidate in taken)) return candidate;
  }
}

/** Starts a browser download for a blob. */
export function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
