import type { MetadataRoute } from "next";
import { SITE_INDEXABLE, absoluteUrl } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  if (!SITE_INDEXABLE) {
    return { rules: { userAgent: "*", disallow: "/" } };
  }
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Mock fixtures are dev-only test files, not content.
      disallow: ["/mock/"],
    },
    sitemap: absoluteUrl("/sitemap.xml"),
  };
}
