import { homeFaq } from "@/lib/faq";
import { JsonLd } from "./JsonLd";
import { faqPage } from "./schema";

/**
 * Home page structured data: FAQPage built from `homeFaq`, the same array the
 * home page renders visibly. Place it anywhere inside the home page body.
 * (Organization, WebSite and WebApplication are already in the root layout.)
 */
export function HomeJsonLd() {
  return <JsonLd data={faqPage(homeFaq)} />;
}
