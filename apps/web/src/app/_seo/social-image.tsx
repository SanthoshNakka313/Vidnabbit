import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { SOCIAL_IMAGE_ALT } from "@/lib/site";

/**
 * Shared 1200x630 social card. Uses the brand stacked logo file as-is (never
 * redrawn) plus the tagline, on the brand surface colour with the brand
 * gradient as a bottom bar. Generated once at build time.
 */
export const socialImageSize = { width: 1200, height: 630 };
export const socialImageAlt = SOCIAL_IMAGE_ALT;

const logo = readFile(join(process.cwd(), "public/brand/vidnabbit-logo-stacked.png")).then(
  (b) => `data:image/png;base64,${b.toString("base64")}`,
);

export async function renderSocialImage() {
  const logoSrc = await logo;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: "#FAF8FC",
        }}
      >
        <div style={{ flex: 1, display: "flex", alignItems: "center", padding: "0 80px", gap: 64 }}>
          {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */}
          <img src={logoSrc} width={436} height={303} />
          <div style={{ display: "flex", flexDirection: "column", gap: 20, flex: 1 }}>
            <div style={{ fontSize: 68, color: "#1E1B2E", letterSpacing: -1, lineHeight: 1.1 }}>
              Paste it. Nab it.
            </div>
            <div style={{ fontSize: 32, color: "#6B6880", lineHeight: 1.35 }}>
              Save video, audio and images you own or have the right to download.
            </div>
            <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
              {["MP4", "MP3", "M4A", "Images"].map((t) => (
                <div
                  key={t}
                  style={{
                    fontSize: 24,
                    color: "#1E1B2E",
                    background: "#FFFFFF",
                    border: "2px solid #ECE8F2",
                    borderRadius: 999,
                    padding: "6px 20px",
                  }}
                >
                  {t}
                </div>
              ))}
            </div>
          </div>
        </div>
        <div style={{ height: 16, background: "linear-gradient(135deg, #FF4D6D, #7C3AED)" }} />
      </div>
    ),
    socialImageSize,
  );
}
