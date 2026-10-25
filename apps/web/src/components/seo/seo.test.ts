import { describe, expect, it } from "vitest";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { allFaqs, homeFaq, moreFaqs } from "@/lib/faq";
import { SITE_DESCRIPTION, SITE_TITLE, absoluteUrl, footerGuides, guides, sitemapRoutes } from "@/lib/site";
import { serializeJsonLd } from "./JsonLd";
import { article, breadcrumbList, faqPage, siteGraph } from "./schema";

describe("serializeJsonLd", () => {
  it("escapes characters that could close the script tag", () => {
    const out = serializeJsonLd({ name: "</script><script>alert(1)</script>" });
    expect(out).not.toContain("<");
    expect(JSON.parse(out).name).toBe("</script><script>alert(1)</script>");
  });

  it("escapes line and paragraph separators", () => {
    const s = `a${String.fromCharCode(0x2028)}b${String.fromCharCode(0x2029)}c`;
    const out = serializeJsonLd({ s });
    expect(out).toContain("\\u2028");
    expect(out).toContain("\\u2029");
    expect(JSON.parse(out).s).toBe(s);
  });
});

describe("schema builders", () => {
  it("site graph has Organization, WebSite and a free WebApplication", () => {
    const g = siteGraph();
    const types = g["@graph"].map((n) => n["@type"]);
    expect(types).toEqual(["Organization", "WebSite", "WebApplication"]);
    const app = g["@graph"][2] as { offers: { price: string; priceCurrency: string } };
    expect(app.offers).toEqual({ "@type": "Offer", price: "0", priceCurrency: "USD" });
    // No ratings or reviews we can't back up.
    expect(JSON.stringify(g)).not.toMatch(/Rating|Review/);
  });

  it("breadcrumbs start at Home with 1-based positions and absolute URLs", () => {
    const b = breadcrumbList([{ name: "Guides", path: "/guides" }]);
    expect(b.itemListElement).toEqual([
      { "@type": "ListItem", position: 1, name: "Home", item: absoluteUrl("/") },
      { "@type": "ListItem", position: 2, name: "Guides", item: absoluteUrl("/guides") },
    ]);
  });

  it("FAQPage mirrors the visible Q&A", () => {
    const f = faqPage(homeFaq);
    expect(f.mainEntity).toHaveLength(homeFaq.length);
    expect(f.mainEntity[0]).toEqual({
      "@type": "Question",
      name: homeFaq[0].q,
      acceptedAnswer: { "@type": "Answer", text: homeFaq[0].a },
    });
  });

  it("articles use ISO dates", () => {
    const a = article({ headline: "h", description: "d", path: "/guides/x", published: "2026-10-25", updated: "2026-10-25" });
    expect(a.datePublished).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(a.url).toBe(absoluteUrl("/guides/x"));
  });
});

describe("FAQ copy", () => {
  it("has 6-10 home questions, unique across the site, plain text", () => {
    expect(homeFaq.length).toBeGreaterThanOrEqual(6);
    expect(homeFaq.length).toBeLessThanOrEqual(10);
    expect(moreFaqs.length).toBeGreaterThan(0);
    expect(new Set(allFaqs.map((f) => f.q)).size).toBe(allFaqs.length);
    for (const f of allFaqs) expect(f.a).not.toMatch(/[<>]/);
  });
});

describe("site metadata", () => {
  it("keeps the default title and description within snippet lengths", () => {
    expect(SITE_TITLE.length).toBeLessThanOrEqual(60);
    expect(SITE_DESCRIPTION.length).toBeLessThanOrEqual(160);
  });

  it("does not target third-party trademarks in guide labels", () => {
    const text = [...guides.map((g) => g.label + g.summary), ...footerGuides.map((g) => g.label)].join(" ");
    expect(text).not.toMatch(/youtube|instagram|tiktok|facebook|twitter|vimeo|netflix|spotify/i);
  });
});

describe("sitemap and robots", () => {
  it("lists every route once with absolute URLs", () => {
    const urls = sitemap().map((e) => e.url);
    expect(urls).toHaveLength(sitemapRoutes.length);
    expect(new Set(urls).size).toBe(urls.length);
    for (const u of urls) expect(u.startsWith(absoluteUrl("/"))).toBe(true);
    for (const g of guides) expect(urls).toContain(absoluteUrl(g.href));
    expect(urls).toContain(absoluteUrl("/faq"));
  });

  it("points crawlers at the sitemap", () => {
    expect(robots().sitemap).toBe(absoluteUrl("/sitemap.xml"));
  });
});
