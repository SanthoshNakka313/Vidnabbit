import { headers } from "next/headers";

type JsonLdData = Record<string, unknown> | Record<string, unknown>[];

// U+2028 / U+2029 (line and paragraph separators), built from char codes so
// the source file stays plain ASCII.
const LINE_SEP = String.fromCharCode(0x2028);
const PARA_SEP = String.fromCharCode(0x2029);

/** Serialises JSON-LD safely: "<" is escaped so the payload can't close the script tag. */
export function serializeJsonLd(data: JsonLdData): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .split(LINE_SEP)
    .join("\\u2028")
    .split(PARA_SEP)
    .join("\\u2029");
}

/**
 * Do NOT pass remote or user-supplied strings (e.g. extracted media titles).
 * Renders a JSON-LD <script> carrying the per-request CSP nonce that
 * src/proxy.ts puts in the `x-nonce` request header. JSON-LD is a data block,
 * but it still gets the nonce so the strict CSP stays consistent.
 */
export async function JsonLd({ data }: { data: JsonLdData }) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <script
      type="application/ld+json"
      nonce={nonce}
      // Only first-party, static data goes in here (never remote strings), and
      // serializeJsonLd escapes "<" so it can't break out of the script tag.
      // React would HTML-escape a text child, which corrupts JSON in <script>.
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }}
    />
  );
}
