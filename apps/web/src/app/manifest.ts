import type { MetadataRoute } from "next";
import { BRAND_BACKGROUND, BRAND_COLOR, SITE_DESCRIPTION, SITE_NAME } from "@/lib/site";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE_NAME,
    short_name: SITE_NAME,
    description: SITE_DESCRIPTION,
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: BRAND_BACKGROUND,
    theme_color: BRAND_COLOR,
    lang: "en",
    categories: ["utilities", "productivity", "multimedia"],
    icons: [
      { src: "/brand/vidnabbit-icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/brand/vidnabbit-icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
